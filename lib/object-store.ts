import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { mimeFromPath, resolveUploadPath, uploadRoot } from "@/lib/attachments";

/*
 * 파일 저장소 추상화.
 *
 * Cloudflare R2 환경 변수가 설정돼 있으면 모든 첨부·생성 파일·채팅 기록을 R2에
 * 저장하고, 없으면 기존처럼 서버 로컬 디렉터리(uploadRoot)에 저장합니다.
 *
 * R2 는 S3 호환 API 를 제공하므로 aws4fetch(서명 v4)로 직접 호출합니다.
 * 필요한 환경 변수(Cloudflare 대시보드 → R2 → API 토큰에서 발급):
 * - R2_ACCOUNT_ID         Cloudflare 계정 ID
 * - R2_ACCESS_KEY_ID      R2 API 토큰의 Access Key ID
 * - R2_SECRET_ACCESS_KEY  R2 API 토큰의 Secret Access Key
 * - R2_BUCKET             버킷 이름
 * - R2_ENDPOINT           (선택) 기본 엔드포인트 대신 쓸 S3 호환 주소(EU 관할 구역 등)
 * 참고: https://developers.cloudflare.com/r2/api/s3/api/
 *
 * 키 구조:
 * - attachments/<uuid>/<파일명>   사용자가 올린 첨부
 * - generated/<uuid>.<확장자>     모델이 만든 이미지·동영상·음성
 * - uploads-tmp/<uuid>/<순번>     청크 업로드 중간 조각(완료되면 삭제)
 * - chats/<id>.json               채팅 대화 기록
 */

interface R2Config {
  client: AwsClient;
  endpoint: string;
}

let cachedConfig: R2Config | null | undefined;

/*
 * 대시보드에서 복사한 값이 이름 대신 주소로 들어오는 경우가 많습니다.
 * - R2_BUCKET 에 "https://<계정>.r2.cloudflarestorage.com/my-bucket" 같은 S3 주소나
 *   "my-bucket.<계정>.r2.cloudflarestorage.com", "r2://my-bucket" 가 들어오면 버킷 이름만 꺼냅니다.
 * - R2 버킷 이름은 소문자·숫자·하이픈만 허용되므로 소문자로 맞춥니다.
 */
export function normalizeBucket(raw: string | undefined): string | undefined {
  let value = raw?.trim().replace(/^["']|["']$/g, "");
  if (!value) return undefined;
  value = value.replace(/^r2:\/\//i, "");
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const segment = url.pathname.split("/").filter(Boolean)[0];
      value = segment ?? url.hostname.split(".")[0];
    } catch {
      // 주소 형식이 아니면 그대로 씁니다.
    }
  } else if (value.includes(".r2.cloudflarestorage.com")) {
    value = value.split(".")[0];
  }
  return value.replace(/\/+$/, "").toLowerCase();
}

/** R2_ACCOUNT_ID 에 엔드포인트 주소 전체가 들어온 경우 계정 ID(32자리 16진수)만 꺼냅니다. */
export function normalizeAccountId(raw: string | undefined): string | undefined {
  const value = raw?.trim().replace(/^["']|["']$/g, "");
  if (!value) return undefined;
  return /[0-9a-f]{32}/i.exec(value)?.[0] ?? value;
}

const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function r2Config(): R2Config | null {
  if (cachedConfig !== undefined) return cachedConfig;
  // 복사·붙여넣기로 앞뒤 공백·줄바꿈이 섞이면 서명이 틀려 403 이 나므로 잘라 냅니다.
  const accountId = normalizeAccountId(process.env.R2_ACCOUNT_ID);
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = normalizeBucket(process.env.R2_BUCKET);
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    cachedConfig = null;
    return null;
  }
  cachedConfig = {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
    // R2_ENDPOINT 로 다른 S3 호환 주소(관할 구역별 엔드포인트, 테스트 서버 등)를 지정할 수 있습니다.
    endpoint: `${(process.env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, "")}/${bucket}`,
  };
  return cachedConfig;
}

/*
 * R2 오류 응답(XML)의 Code·Message 를 꺼내 원인을 알 수 있게 합니다.
 * 예: SignatureDoesNotMatch(비밀 키 오류), InvalidAccessKeyId(액세스 키 오류),
 *     AccessDenied(토큰 권한·버킷 범위 부족), NoSuchBucket(버킷 이름 오류).
 */
const R2_HINTS: Record<string, string> = {
  SignatureDoesNotMatch: "R2_SECRET_ACCESS_KEY 값이 틀렸습니다(다른 토큰의 값이거나 일부만 복사됨)",
  InvalidAccessKeyId: "R2_ACCESS_KEY_ID 값이 틀렸거나, 토큰이 삭제되었습니다",
  AccessDenied: "API 토큰 권한이 부족합니다. 'Object Read & Write' 권한과 이 버킷이 포함된 토큰인지 확인하세요",
  NoSuchBucket: "R2_BUCKET 이름의 버킷이 없습니다(이름 오타 또는 EU 관할 구역 버킷이면 R2_ENDPOINT 필요)",
  InvalidBucketName: "R2_BUCKET 값이 버킷 이름이 아닙니다. 주소가 아닌 버킷 이름(소문자·숫자·하이픈)만 넣어 주세요. /api/storage/status 에서 인식된 이름을 확인할 수 있습니다",
  Unauthorized: "인증에 실패했습니다. R2_ACCOUNT_ID·액세스 키가 같은 계정의 값인지 확인하세요",
};

async function r2Error(action: string, response: Response): Promise<Error> {
  const text = await response.text().catch(() => "");
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "";
  const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? "";
  const hint = R2_HINTS[code];
  const detail = [code, hint ?? message].filter(Boolean).join(": ");
  return new Error(`Cloudflare R2 ${action}에 실패했습니다. (HTTP ${response.status}${detail ? ` · ${detail}` : ""})`);
}

export function usingR2(): boolean {
  return r2Config() !== null;
}

function objectUrl(config: R2Config, key: string): string {
  // 서명(aws4fetch)과 같은 RFC 3986 규칙으로 인코딩해 ( ) ! * ' 가 든 파일명도 서명이 어긋나지 않게 합니다.
  const encode = (part: string) =>
    encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${config.endpoint}/${key.split("/").map(encode).join("/")}`;
}

function safeKey(key: string): string | null {
  const normalized = path.posix.normalize(key).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("..") || normalized.includes("/../")) return null;
  return normalized;
}

function localPath(key: string): string | null {
  return resolveUploadPath(key);
}

export async function putObject(key: string, body: Buffer | Uint8Array, mime: string): Promise<void> {
  const clean = safeKey(key);
  if (!clean) throw new Error("저장 경로가 올바르지 않습니다.");
  const config = r2Config();
  if (config) {
    // aws4fetch.fetch 는 본문을 Request 스트림으로 감싸 Content-Length 없이(chunked) 보내는데,
    // S3 호환 PutObject 는 길이가 필요합니다. 서명만 받아 바이트 배열로 직접 보냅니다.
    const bytes = new Uint8Array(body);
    const signed = await config.client.sign(objectUrl(config, clean), {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": mime },
    });
    const response = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes });
    if (!response.ok) throw await r2Error("저장", response);
    return;
  }
  const target = localPath(clean);
  if (!target) throw new Error("저장 경로가 올바르지 않습니다.");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

export interface StoredObject {
  body: ReadableStream<Uint8Array> | Buffer;
  mime: string;
  size: number | null;
  status: 200 | 206;
  contentRange: string | null;
}

/** 파일을 읽습니다. range("bytes=0-1023")를 주면 부분 응답을 돌려줍니다(R2만). */
export async function getObject(key: string, range?: string | null): Promise<StoredObject | null> {
  const clean = safeKey(key);
  if (!clean) return null;
  const config = r2Config();
  if (config) {
    const response = await config.client.fetch(objectUrl(config, clean), {
      method: "GET",
      headers: range ? { Range: range } : undefined,
    });
    if (response.status === 404) return null;
    if (!response.ok || !response.body) {
      throw await r2Error("읽기", response);
    }
    const length = response.headers.get("content-length");
    return {
      body: response.body,
      mime: response.headers.get("content-type") || mimeFromPath(clean),
      size: length ? Number(length) : null,
      status: response.status === 206 ? 206 : 200,
      contentRange: response.headers.get("content-range"),
    };
  }
  const target = localPath(clean);
  if (!target) return null;
  try {
    const buffer = await readFile(target);
    return { body: buffer, mime: mimeFromPath(target), size: buffer.length, status: 200, contentRange: null };
  } catch {
    return null;
  }
}

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  const found = await getObject(key);
  if (!found) return null;
  if (Buffer.isBuffer(found.body)) return found.body;
  return Buffer.from(await new Response(found.body).arrayBuffer());
}

/** prefix 아래의 키 목록(최대 1000개). */
export async function listKeys(prefix: string): Promise<string[]> {
  const config = r2Config();
  if (config) {
    const url = `${config.endpoint}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
    const response = await config.client.fetch(url, { method: "GET" });
    if (!response.ok) throw await r2Error("목록 조회", response);
    const xml = await response.text();
    return Array.from(xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)).map((match) =>
      match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
    );
  }
  const dir = localPath(prefix.replace(/\/+$/, ""));
  if (!dir) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return entries.filter((entry) => entry.isFile()).map((entry) => `${base}${entry.name}`);
}

export async function deleteObject(key: string): Promise<void> {
  const clean = safeKey(key);
  if (!clean) return;
  const config = r2Config();
  if (config) {
    await config.client.fetch(objectUrl(config, clean), { method: "DELETE" }).catch(() => undefined);
    return;
  }
  const target = localPath(clean);
  if (target) await rm(target, { force: true }).catch(() => {});
}

export async function deletePrefix(prefix: string): Promise<void> {
  if (usingR2()) {
    const keys = await listKeys(prefix).catch(() => []);
    await Promise.all(keys.map((key) => deleteObject(key)));
    return;
  }
  const dir = localPath(prefix.replace(/\/+$/, ""));
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
}

export async function objectSize(key: string): Promise<number | null> {
  const clean = safeKey(key);
  if (!clean) return null;
  const config = r2Config();
  if (config) {
    const response = await config.client.fetch(objectUrl(config, clean), { method: "HEAD" });
    if (!response.ok) return null;
    const length = response.headers.get("content-length");
    return length ? Number(length) : null;
  }
  const target = localPath(clean);
  if (!target) return null;
  return stat(target).then((info) => info.size).catch(() => null);
}

/** 로컬 저장소를 쓸 때 저장 디렉터리가 쓰기 가능한지 미리 확인합니다(R2면 확인 생략). */
export function ensureStorageReady(): void {
  if (!usingR2()) uploadRoot();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 첨부 ID로 저장된 파일을 찾습니다. */
export async function findAttachment(id: string): Promise<{ key: string; name: string; mime: string } | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const keys = await listKeys(`attachments/${id}/`).catch(() => [] as string[]);
  const key = keys[0];
  if (!key) return null;
  const name = key.slice(key.lastIndexOf("/") + 1);
  return { key, name, mime: mimeFromPath(name) };
}

/** 설정 점검: 버킷 목록을 1개만 조회해 인증·권한·버킷 이름이 맞는지 확인합니다. */
export async function checkR2(): Promise<{ enabled: boolean; ok: boolean; detail: string; endpointHost: string | null; bucket: string | null }> {
  const config = r2Config();
  if (!config) return { enabled: false, ok: false, detail: "R2 환경 변수 4개 중 하나 이상이 비어 있습니다.", endpointHost: null, bucket: null };
  const endpointHost = new URL(config.endpoint).host;
  const bucket = new URL(config.endpoint).pathname.split("/").filter(Boolean).pop() ?? null;
  if (bucket && !BUCKET_NAME_PATTERN.test(bucket)) {
    return {
      enabled: true,
      ok: false,
      detail: `R2_BUCKET 값("${bucket}")이 버킷 이름 형식이 아닙니다. Cloudflare R2 버킷 목록에 보이는 이름(소문자·숫자·하이픈, 3~63자)만 넣어 주세요.`,
      endpointHost,
      bucket,
    };
  }
  try {
    const response = await config.client.fetch(`${config.endpoint}?list-type=2&max-keys=1`, { method: "GET" });
    if (!response.ok) return { enabled: true, ok: false, detail: (await r2Error("점검", response)).message, endpointHost, bucket };
    const probeKey = `healthcheck/${Date.now()}.txt`;
    await putObject(probeKey, Buffer.from("ok"), "text/plain");
    await deleteObject(probeKey);
    return { enabled: true, ok: true, detail: "읽기·쓰기 모두 정상입니다.", endpointHost, bucket };
  } catch (error) {
    return { enabled: true, ok: false, detail: error instanceof Error ? error.message : String(error), endpointHost, bucket };
  }
}
