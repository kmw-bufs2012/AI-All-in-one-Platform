import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { generateImage, politeVeniceError, readJson } from "@/lib/venice";
import { extractImages } from "@/lib/extract";
import { dataUrlToBuffer, saveGeneratedFile } from "@/lib/storage";
import { resolveUploadPath, mimeFromPath } from "@/lib/attachments";

export async function POST(request: NextRequest) {
  let body: { model?: unknown; prompt?: unknown; styleImageIds?: unknown; width?: unknown; height?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!model || !prompt) {
    return NextResponse.json({ error: "모델과 프롬프트가 필요합니다." }, { status: 400 });
  }

  const styleImageIds: string[] = Array.isArray(body.styleImageIds)
    ? (body.styleImageIds as unknown[]).filter((id): id is string => typeof id === "string").slice(0, 10)
    : [];

  const styleReferences = [];
  for (const id of styleImageIds) {
    let dir: string | null = null;
    try {
      dir = resolveUploadPath(path.join("attachments", id));
    } catch {
      continue;
    }
    if (!dir) continue;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const entry = entries.find((item) => item.isFile());
    if (!entry) continue;
    const buffer = await readFile(path.join(dir, entry.name));
    styleReferences.push({
      image: `data:${mimeFromPath(entry.name)};base64,${buffer.toString("base64")}`,
    });
  }

  const payload: Record<string, unknown> = { model, prompt };
  if (styleReferences.length > 0) {
    payload.style_references = styleReferences;
  }

  // 비율을 고르지 않으면 두 값 모두 생략되어 기존과 동일하게 모델 기본값으로 생성됩니다.
  const width = typeof body.width === "number" && Number.isFinite(body.width) ? Math.round(body.width) : null;
  const height = typeof body.height === "number" && Number.isFinite(body.height) ? Math.round(body.height) : null;
  if (width !== null && height !== null && width > 0 && height > 0) {
    payload.width = width;
    payload.height = height;
  }

  try {
    const upstream = await generateImage(payload);
    const bodyText = await readJson(upstream);
    if (!upstream.ok) {
      throw politeVeniceError(upstream, bodyText, "Venice.ai 이미지 생성에 실패했습니다.");
    }
    const images = extractImages(bodyText);
    const urls: string[] = [];
    for (const image of images) {
      if (/^https?:\/\//.test(image)) {
        urls.push(image);
        continue;
      }
      const decoded = dataUrlToBuffer(image);
      if (!decoded) continue;
      const relative = await saveGeneratedFile(decoded.buffer, decoded.mime);
      urls.push(`/api/files/${relative}`);
    }
    return NextResponse.json({ ok: true, urls, count: urls.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Venice.ai 이미지 생성에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}