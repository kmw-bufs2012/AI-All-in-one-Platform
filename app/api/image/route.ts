import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { generateImage, politeNanoGptError, readJson } from "@/lib/nanogpt";
import { extractImages } from "@/lib/extract";
import { dataUrlToBuffer, saveGeneratedFile } from "@/lib/storage";
import { resolveUploadPath, mimeFromPath, MAX_REFERENCE_BYTES } from "@/lib/attachments";

/*
 * NanoGPT Image API (POST /api/v1/images).
 * 참조 이미지는 input_references 배열로 보냅니다. 공식 문서에 따르면
 * imageDataUrl / imageDataUrls / image_url / images 같은 구형 별칭과 섞어
 * 보내면 안 되므로 input_references 만 사용합니다. 장수 상한은 모델의
 * input_reference_constraints.max_items 이며, 클라이언트에서 이미 검증하지만
 * 서버에서도 방어적으로 자릅니다.
 */
const HARD_REFERENCE_LIMIT = 16;

export async function POST(request: NextRequest) {
  let body: {
    model?: unknown;
    prompt?: unknown;
    referenceIds?: unknown;
    resolution?: unknown;
    n?: unknown;
  };
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

  const referenceIds: string[] = Array.isArray(body.referenceIds)
    ? (body.referenceIds as unknown[])
        .filter((id): id is string => typeof id === "string")
        .slice(0, HARD_REFERENCE_LIMIT)
    : [];

  const inputReferences: string[] = [];
  for (const id of referenceIds) {
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
    if (buffer.byteLength > MAX_REFERENCE_BYTES) {
      return NextResponse.json({
        error: `${entry.name} 참조 이미지가 허용 크기를 초과합니다.`,
      }, { status: 400 });
    }
    inputReferences.push(`data:${mimeFromPath(entry.name)};base64,${buffer.toString("base64")}`);
  }

  const payload: Record<string, unknown> = { model, prompt };
  if (inputReferences.length > 0) {
    payload.input_references = inputReferences;
  }
  // 해상도와 장수는 모델이 supported_parameters 로 공개한 값만 클라이언트가
  // 보내옵니다. 고르지 않으면 생략되어 모델 기본값으로 생성됩니다.
  if (typeof body.resolution === "string" && body.resolution) {
    payload.resolution = body.resolution;
  }
  const count = typeof body.n === "number" && Number.isFinite(body.n) ? Math.round(body.n) : null;
  if (count !== null && count > 1) {
    payload.n = count;
  }

  try {
    const upstream = await generateImage(payload);
    const bodyText = await readJson(upstream);
    if (!upstream.ok) {
      throw politeNanoGptError(upstream, bodyText, "NanoGPT 이미지 생성에 실패했습니다.");
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
    const message = error instanceof Error ? error.message : "NanoGPT 이미지 생성에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
