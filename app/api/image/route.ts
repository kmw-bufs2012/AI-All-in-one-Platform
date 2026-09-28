import { acceptDataUrl, MISSING_ATTACHMENT_MESSAGE } from "@/lib/inline-media";
import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { generateImage, politeNanoGptError, readJson, sanitizeExtraParams } from "@/lib/nanogpt";
import { extractImages, extractCost } from "@/lib/extract";
import { dataUrlToBuffer, saveGeneratedFile } from "@/lib/storage";
import { resolveUploadPath, mimeFromPath, MAX_REFERENCE_BYTES } from "@/lib/attachments";

// Vercel Hobby(Fluid compute) 함수 최대 실행 시간은 300초입니다.
export const maxDuration = 300;

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
    params?: unknown;
    /** 브라우저 7일 보관 사본(id → data URL). 서버 디스크에 없을 때 대신 씁니다. */
    inlineReferences?: unknown;
    officialParams?: unknown;
    officialResolution?: unknown;
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

  const inlineReferences = body.inlineReferences && typeof body.inlineReferences === "object" && !Array.isArray(body.inlineReferences)
    ? (body.inlineReferences as Record<string, unknown>)
    : {};
  const inputReferences: string[] = [];
  const missing: string[] = [];
  for (const id of referenceIds) {
    let dir: string | null = null;
    try {
      dir = resolveUploadPath(path.join("attachments", id));
    } catch {
      dir = null;
    }
    const entries = dir ? await readdir(dir, { withFileTypes: true }).catch(() => []) : [];
    const entry = entries.find((item) => item.isFile());
    if (dir && entry) {
      const buffer = await readFile(path.join(dir, entry.name));
      if (buffer.byteLength > MAX_REFERENCE_BYTES) {
        return NextResponse.json({
          error: `${entry.name} 참조 이미지가 허용 크기를 초과합니다.`,
        }, { status: 400 });
      }
      inputReferences.push(`data:${mimeFromPath(entry.name)};base64,${buffer.toString("base64")}`);
      continue;
    }
    // 서버 임시 저장소에 없으면 브라우저 7일 보관 사본을 씁니다(lib/inline-media.ts).
    const inline = acceptDataUrl(inlineReferences[id], "image");
    if (inline) inputReferences.push(inline);
    else missing.push(id);
  }
  if (missing.length > 0) {
    return NextResponse.json({ error: MISSING_ATTACHMENT_MESSAGE, missing }, { status: 409 });
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
  // 비율·품질·스타일 등 모델이 supported_parameters로 공개한 나머지 설정.
  // model/prompt/input_references/resolution/n은 이미 직접 채우므로 덮어쓰지 못하게 막습니다.
  const extraParams = sanitizeExtraParams(
    body.params,
    new Set(["model", "prompt", "input_references", "resolution", "n", "size", "sizes"]),
  );
  Object.assign(payload, extraParams);

  /*
   * 카탈로그에는 없지만 제작사 공식 문서로 확인한 설정(lib/image-settings-overlay.ts).
   * NanoGPT가 받지 않을 수 있으므로, 4xx로 거부되면 이 설정만 빼고 한 번 더
   * 시도해 생성 자체는 막히지 않게 합니다. 뺀 설정은 응답에 알려 줍니다.
   */
  const officialParams = sanitizeExtraParams(
    body.officialParams,
    new Set(["model", "prompt", "input_references", "resolution", "n", "size", "sizes"]),
  );
  for (const [key, value] of Object.entries(officialParams)) {
    if (value === "true") officialParams[key] = true;
    else if (value === "false") officialParams[key] = false;
  }
  const officialKeys = Object.keys(officialParams);
  if (body.officialResolution === true && typeof payload.resolution === "string") officialKeys.push("resolution");
  Object.assign(payload, officialParams);
  let droppedParams: string[] = [];

  try {
    let upstream = await generateImage(payload);
    let bodyText = await readJson(upstream);
    if (!upstream.ok && upstream.status >= 400 && upstream.status < 500 && upstream.status !== 401 && upstream.status !== 402 && officialKeys.length > 0) {
      const retryPayload = { ...payload };
      for (const key of officialKeys) delete retryPayload[key];
      droppedParams = officialKeys;
      upstream = await generateImage(retryPayload);
      bodyText = await readJson(upstream);
    }
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
    // NanoGPT 공식 문서: "Every API response includes a cost field showing
    // what you were charged for that request" — 응답에 실제 청구액이 실려
    // 있으면 카탈로그 추정 단가 대신 이 값을 그대로 보여 줍니다.
    const cost = extractCost(bodyText);
    return NextResponse.json({
      ok: true,
      urls,
      count: urls.length,
      droppedParams,
      cost: cost ? { amount: cost.amount, currency: cost.currency ?? "USD" } : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NanoGPT 이미지 생성에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
