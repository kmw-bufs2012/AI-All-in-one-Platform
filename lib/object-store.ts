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

function r2Config(): R2Config | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    cachedConfig = null;
    return null;
  }
  cachedConfig = {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
    // R2_ENDPOINT 로 다른 S3 호환 주소(관할 구역별 엔드포인트, 테스트 서버 등)를 지정할 수 있습니다.
    endpoint: `${(process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, "")}/${bucket}`,
  };
  return cachedConfig;
}

export function usingR2(): boolean {
  return r2Config() !== null;
}

function objectUrl(config: R2Config, key: string): string {
  return `${config.endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`;
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
    if (!response.ok) {
      throw new Error(`Cloudflare R2 저장에 실패했습니다. (HTTP ${response.status})`);
    }
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
      throw new Error(`Cloudflare R2 읽기에 실패했습니다. (HTTP ${response.status})`);
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
    if (!response.ok) throw new Error(`Cloudflare R2 목록 조회에 실패했습니다. (HTTP ${response.status})`);
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
