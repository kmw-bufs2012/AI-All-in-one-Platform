import { NextRequest, NextResponse } from "next/server";
import {
  sanitizeFileName,
  kindFromFile,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_DOC_BYTES,
} from "@/lib/attachments";
import { deletePrefix, ensureStorageReady, getObjectBuffer, listKeys, putObject } from "@/lib/object-store";

// Vercel Hobby(Fluid compute) 함수 최대 실행 시간은 300초입니다.
export const maxDuration = 300;

/*
 * 청크 업로드. Vercel Serverless Function은 요청 본문을 4.5MB로 강제 제한합니다
 * (인프라 레벨이라 next.config.ts의 middlewareClientMaxBodySize로는 우회할 수
 * 없습니다 — 그 설정은 Next.js 미들웨어 자체의 버퍼링 한도일 뿐입니다). 동영상은
 * 대부분 이 한도를 넘기므로, 파일을 여러 조각으로 나눠 각 조각을 한도보다 훨씬
 * 작게(CHUNK_SIZE) 순차 전송한 뒤 서버에서 이어 붙입니다.
 * 참고: https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 4.5MB 한도에 멀티파트 오버헤드·헤더 여유를 두기 위해 3MB로 설정합니다.
const CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_CHUNKS = 4000; // 3MB * 4000 ≈ 12GB 상한(개별 종류별 크기 제한이 실제 상한을 정함)

function sizeLimitFor(kind: string): number {
  if (kind === "image") return MAX_IMAGE_BYTES;
  if (kind === "video" || kind === "audio") return MAX_VIDEO_BYTES;
  return MAX_DOC_BYTES;
}

function limitText(kind: string): string {
  return kind === "video" || kind === "audio" ? "50MB" : kind === "doc" ? "25MB" : "10MB";
}

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error("[attachments/chunk] formData parse error:", err);
    return NextResponse.json({ error: "파일 업로드 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const chunk = formData.get("chunk");
  const uploadId = String(formData.get("uploadId") ?? "");
  const index = Number(formData.get("index"));
  const total = Number(formData.get("total"));
  const name = String(formData.get("name") ?? "");
  const mime = String(formData.get("mime") ?? "");

  if (!(chunk instanceof File) || chunk.size === 0) {
    return NextResponse.json({ error: "업로드할 조각이 없습니다." }, { status: 400 });
  }
  if (!UUID_PATTERN.test(uploadId)) {
    return NextResponse.json({ error: "업로드 식별자가 올바르지 않습니다." }, { status: 400 });
  }
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total <= 0 || index >= total || total > MAX_CHUNKS) {
    return NextResponse.json({ error: "업로드 조각 정보가 올바르지 않습니다." }, { status: 400 });
  }
  if (chunk.size > CHUNK_SIZE * 2) {
    // 클라이언트가 정상적으로 나눠 보냈다면 있을 수 없는 크기입니다.
    return NextResponse.json({ error: "업로드 조각 크기가 올바르지 않습니다." }, { status: 400 });
  }
  const kind = kindFromFile(name, mime);
  if (!kind) {
    return NextResponse.json({
      error: `${name} 파일은 지원되지 않는 형식입니다. 이미지, 동영상, 오디오, 문서(txt/md/pdf)만 업로드할 수 있습니다.`,
    }, { status: 400 });
  }

  try {
    ensureStorageReady();
  } catch (error) {
    console.error("[attachments/chunk] storage unavailable:", error);
    return NextResponse.json({
      error: "파일을 저장할 공간을 준비하지 못했습니다. Cloudflare R2 설정 또는 서버 저장소(UPLOAD_DIR)를 확인해 주세요.",
    }, { status: 500 });
  }

  /*
   * 조각을 uploads-tmp/<uploadId>/<순번> 으로 따로 저장하고, 마지막 조각이 오면
   * 순서대로 이어 붙여 attachments/<uploadId>/<파일명> 한 개로 만듭니다.
   * 조각이 서로 다른 서버 인스턴스에 도착해도 R2 에서는 모두 모입니다.
   */
  const safeName = sanitizeFileName(name);
  const tmpPrefix = `uploads-tmp/${uploadId}/`;
  const sizeLimit = sizeLimitFor(kind);
  try {
    const buffer = Buffer.from(await chunk.arrayBuffer());
    await putObject(`${tmpPrefix}${String(index).padStart(5, "0")}`, buffer, "application/octet-stream");
  } catch (error) {
    console.error("[attachments/chunk] write failed:", error);
    return NextResponse.json({
      error: "파일 저장에 실패했습니다. Cloudflare R2 설정 또는 서버 저장 공간을 확인해 주세요.",
    }, { status: 500 });
  }

  if (index < total - 1) {
    if ((index + 1) * CHUNK_SIZE > sizeLimit + CHUNK_SIZE) {
      await deletePrefix(tmpPrefix);
      return NextResponse.json({ error: `${name} 파일의 크기가 ${limitText(kind)}를 초과합니다.` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, received: index + 1, total });
  }

  let written = 0;
  try {
    const keys = (await listKeys(tmpPrefix)).sort();
    if (keys.length !== total) {
      await deletePrefix(tmpPrefix);
      return NextResponse.json({ error: "업로드 조각 일부가 누락되었습니다. 다시 업로드해 주세요." }, { status: 400 });
    }
    const parts: Buffer[] = [];
    for (const key of keys) {
      const part = await getObjectBuffer(key);
      if (!part) throw new Error(`조각을 읽지 못했습니다: ${key}`);
      parts.push(part);
    }
    const combined = Buffer.concat(parts);
    written = combined.length;
    if (written > sizeLimit) {
      await deletePrefix(tmpPrefix);
      return NextResponse.json({ error: `${name} 파일의 크기가 ${limitText(kind)}를 초과합니다.` }, { status: 400 });
    }
    await putObject(`attachments/${uploadId}/${safeName}`, combined, mime || "application/octet-stream");
    await deletePrefix(tmpPrefix);
  } catch (error) {
    console.error("[attachments/chunk] combine failed:", error);
    return NextResponse.json({ error: "업로드한 조각을 합치지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    file: {
      id: uploadId,
      kind,
      name: safeName,
      size: written,
      mime: mime || "application/octet-stream",
      url: `/api/files/attachments/${uploadId}/${encodeURIComponent(safeName)}`,
    },
  });
}
