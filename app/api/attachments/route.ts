import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  sanitizeFileName,
  kindFromFile,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_FILES,
  MAX_VIDEO_BYTES,
  MAX_AUDIO_FILES,
  MAX_DOCS,
  MAX_DOC_BYTES,
} from "@/lib/attachments";
import { ensureStorageReady, putObject } from "@/lib/object-store";

// Vercel Hobby(Fluid compute) 함수 최대 실행 시간은 300초입니다.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error("[attachments] formData parse error:", err);
    return NextResponse.json({ error: "파일 업로드 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);

  let imageCount = 0;
  let videoCount = 0;
  let audioCount = 0;
  let docCount = 0;

  for (const file of files) {
    const kind = kindFromFile(file.name, file.type);
    if (kind === "image") imageCount += 1;
    else if (kind === "video") videoCount += 1;
    else if (kind === "audio") audioCount += 1;
    else if (kind === "doc") docCount += 1;
    else {
      return NextResponse.json({
        error: `${file.name} 파일은 지원되지 않는 형식입니다. 이미지, 동영상, 오디오, 문서(txt/md/pdf)만 업로드할 수 있습니다.`,
      }, { status: 400 });
    }
  }
  if (imageCount > MAX_IMAGES) {
    return NextResponse.json({ error: `이미지는 최대 ${MAX_IMAGES}개까지 첨부할 수 있습니다.` }, { status: 400 });
  }
  if (videoCount > MAX_VIDEO_FILES) {
    return NextResponse.json({ error: `동영상은 최대 ${MAX_VIDEO_FILES}개까지 첨부할 수 있습니다.` }, { status: 400 });
  }
  if (audioCount > MAX_AUDIO_FILES) {
    return NextResponse.json({ error: `오디오는 최대 ${MAX_AUDIO_FILES}개까지 첨부할 수 있습니다.` }, { status: 400 });
  }
  if (docCount > MAX_DOCS) {
    return NextResponse.json({ error: `문서는 최대 ${MAX_DOCS}개까지 첨부할 수 있습니다.` }, { status: 400 });
  }

  try {
    ensureStorageReady();
  } catch (error) {
    console.error("[attachments] upload root unavailable:", error);
    return NextResponse.json({
      error: "파일을 저장할 공간을 준비하지 못했습니다. 서버에 쓰기 가능한 저장소(UPLOAD_DIR 등)가 있는지 확인해 주세요.",
    }, { status: 500 });
  }

  const saved: Array<{ id: string; kind: string; name: string; size: number; mime: string; url: string }> = [];
  for (const file of files) {
    const kind = kindFromFile(file.name, file.type);
    if (!kind) continue;
    // 오디오는 동영상과 같은 상한을 적용합니다(길이가 길면 파일이 커지기 때문).
    const sizeLimit = kind === "image"
      ? MAX_IMAGE_BYTES
      : kind === "video" || kind === "audio"
        ? MAX_VIDEO_BYTES
        : MAX_DOC_BYTES;
    if (file.size > sizeLimit) {
      const limitText = kind === "video" || kind === "audio" ? "50MB" : kind === "doc" ? "25MB" : "10MB";
      return NextResponse.json({
        error: `${file.name} 파일의 크기가 ${limitText}를 초과합니다.`,
      }, { status: 400 });
    }
    const id = randomUUID();
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await putObject(`attachments/${id}/${sanitizeFileName(file.name)}`, buffer, file.type || "application/octet-stream");
    } catch (error) {
      console.error("[attachments] save failed:", error);
      return NextResponse.json({
        error: "파일 저장에 실패했습니다. 서버에 쓰기 가능한 저장 공간이 있는지 확인해 주세요.",
      }, { status: 500 });
    }
    saved.push({
      id,
      kind,
      name: sanitizeFileName(file.name),
      size: file.size,
      mime: file.type || "application/octet-stream",
      url: `/api/files/attachments/${id}/${encodeURIComponent(sanitizeFileName(file.name))}`,
    });
  }

  return NextResponse.json({ ok: true, files: saved });
}