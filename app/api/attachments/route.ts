import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  ensureUploadDirs,
  uploadRoot,
  sanitizeFileName,
  kindFromFile,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_FILES,
  MAX_VIDEO_BYTES,
  MAX_DOCS,
  MAX_DOC_BYTES,
} from "@/lib/attachments";

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
  let docCount = 0;

  for (const file of files) {
    const kind = kindFromFile(file.name, file.type);
    if (kind === "image") imageCount += 1;
    else if (kind === "video") videoCount += 1;
    else if (kind === "doc") docCount += 1;
    else {
      return NextResponse.json({
        error: `${file.name} 파일은 지원되지 않는 형식입니다. 이미지, 영상, 문서(txt/md/pdf)만 업로드할 수 있습니다.`,
      }, { status: 400 });
    }
  }
  if (imageCount > MAX_IMAGES) {
    return NextResponse.json({ error: `이미지는 최대 ${MAX_IMAGES}개까지 첨부할 수 있습니다.` }, { status: 400 });
  }
  if (videoCount > MAX_VIDEO_FILES) {
    return NextResponse.json({ error: "동영상은 최대 1개까지 첨부할 수 있습니다." }, { status: 400 });
  }
  if (docCount > MAX_DOCS) {
    return NextResponse.json({ error: "문서는 최대 1개까지 첨부할 수 있습니다." }, { status: 400 });
  }

  ensureUploadDirs();

  const saved: Array<{ id: string; kind: string; name: string; size: number; mime: string; url: string }> = [];
  for (const file of files) {
    const kind = kindFromFile(file.name, file.type);
    if (!kind) continue;
    const sizeLimit = kind === "image" ? MAX_IMAGE_BYTES : kind === "video" ? MAX_VIDEO_BYTES : MAX_DOC_BYTES;
    if (file.size > sizeLimit) {
      const limitText = kind === "video" ? "50MB" : "10MB";
      return NextResponse.json({
        error: `${file.name} 파일의 크기가 ${limitText}를 초과합니다.`,
      }, { status: 400 });
    }
    const id = randomUUID();
    const dir = path.join(uploadRoot(), "attachments", id);
    await mkdir(dir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, sanitizeFileName(file.name)), buffer);
    saved.push({
      id,
      kind,
      name: sanitizeFileName(file.name),
      size: buffer.length,
      mime: file.type || "application/octet-stream",
      url: `/api/files/attachments/${id}/${encodeURIComponent(sanitizeFileName(file.name))}`,
    });
  }

  return NextResponse.json({ ok: true, files: saved });
}