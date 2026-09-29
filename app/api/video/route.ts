import { acceptDataUrl, MISSING_ATTACHMENT_MESSAGE } from "@/lib/inline-media";
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { queueVideo, politeNanoGptError, readJson, sanitizeExtraParams } from "@/lib/nanogpt";
import { extractRunId, extractStatus, extractCost } from "@/lib/extract";
import { findAttachment, getObjectBuffer } from "@/lib/object-store";
import { findVideoOverlay } from "@/lib/model-capability-overlay";

// Vercel Hobby(Fluid compute) 함수 최대 실행 시간은 300초입니다.
export const maxDuration = 300;

/*
 * NanoGPT 동영상 생성(POST /api/generate-video)은 비동기입니다. 요청은 즉시
 * runId 와 status: "pending" 을 돌려주고, 결과는 /api/video/status 로 폴링합니다.
 *
 * 입력 미디어는 모델마다 다릅니다.
 * - image-to-video 모델: imageDataUrl(base64) 또는 imageUrl(공개 HTTPS URL).
 * - 동영상 확장·편집 모델: videoUrl.
 * 어떤 모델이 무엇을 받는지는 /v1/video-models 의 supported_parameters 로
 * 판정해 클라이언트에서 걸러 보냅니다(lib/attachment-policy.ts).
 */
async function resolveDataUrl(id: string): Promise<string | null> {
  const found = await findAttachment(id).catch(() => null);
  if (!found) return null;
  const buffer = await getObjectBuffer(found.key).catch(() => null);
  if (!buffer) return null;
  return `data:${found.mime};base64,${buffer.toString("base64")}`;
}

const REFERENCE_FIELDS = new Set([
  "reference_images", "referenceimages", "reference_image_urls", "referenceimageurls",
  "reference_image_data_urls", "referenceimagedataurls", "image_urls", "imageurls", "imagedataurls", "input_references",
]);
const MAX_REFERENCE_IMAGES = 16;

export async function POST(request: NextRequest) {
  let body: {
    model?: unknown;
    prompt?: unknown;
    startImageId?: unknown;
    sourceVideoId?: unknown;
    endImageId?: unknown;
    /** 브라우저 7일 보관 사본. 서버 디스크에 없을 때 대신 씁니다(lib/inline-media.ts). */
    startImageDataUrl?: unknown;
    sourceVideoDataUrl?: unknown;
    endImageDataUrl?: unknown;
    /** 참조 이미지 여러 장(카탈로그가 공개한 파라미터 이름과 함께). */
    referenceImageIds?: unknown;
    referenceImageDataUrls?: unknown;
    referenceImageKey?: unknown;
    params?: unknown;
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

  const payload: Record<string, unknown> = { model, prompt };
  const missing: string[] = [];
  if (typeof body.startImageId === "string") {
    const dataUrl = (await resolveDataUrl(body.startImageId)) ?? acceptDataUrl(body.startImageDataUrl, "image");
    if (dataUrl) payload.imageDataUrl = dataUrl;
    else missing.push("시작 이미지");
  }
  if (typeof body.sourceVideoId === "string") {
    const dataUrl = (await resolveDataUrl(body.sourceVideoId)) ?? acceptDataUrl(body.sourceVideoDataUrl, "video");
    if (dataUrl) payload.videoDataUrl = dataUrl;
    else missing.push("원본(참조) 동영상");
  }
  // 끝 프레임(예: Kling의 image_tail)은 원 개발사 자료로 확인된 모델에서만
  // 지원합니다. 필드 이름은 클라이언트가 아니라 서버가
  // lib/model-capability-overlay.ts에서 찾아 붙입니다 — 클라이언트가 임의의
  // 필드 이름을 주입하지 못하게 하기 위함입니다.
  let endImageField: string | null = null;
  if (typeof body.endImageId === "string") {
    const overlay = findVideoOverlay(model, model);
    const endFrameRole = overlay?.imageRoles?.find((role) => role.role === "end_frame");
    if (endFrameRole) {
      const dataUrl = (await resolveDataUrl(body.endImageId)) ?? acceptDataUrl(body.endImageDataUrl, "image");
      if (!dataUrl) missing.push("끝 프레임");
      if (dataUrl) {
        payload[endFrameRole.field] = dataUrl;
        endImageField = endFrameRole.field;
      }
    }
  }
  // 참조 이미지 여러 장. 필드 이름은 카탈로그에서 찾은 값이지만 클라이언트가 보내므로,
  // 허용 목록에 있는 이름만 받습니다.
  let referenceField: string | null = null;
  const referenceKey = typeof body.referenceImageKey === "string" ? body.referenceImageKey : "";
  if (Array.isArray(body.referenceImageIds) && REFERENCE_FIELDS.has(referenceKey.toLowerCase())) {
    const ids = (body.referenceImageIds as unknown[]).filter((id): id is string => typeof id === "string").slice(0, MAX_REFERENCE_IMAGES);
    const inlineList = Array.isArray(body.referenceImageDataUrls) ? (body.referenceImageDataUrls as unknown[]) : [];
    const urls: string[] = [];
    for (let index = 0; index < ids.length; index++) {
      const dataUrl = (await resolveDataUrl(ids[index])) ?? acceptDataUrl(inlineList[index], "image");
      if (dataUrl) urls.push(dataUrl);
      else missing.push(`참조 이미지 ${index + 1}`);
    }
    if (urls.length > 0) {
      payload[referenceKey] = urls;
      referenceField = referenceKey;
    }
  }
  if (missing.length > 0) {
    return NextResponse.json({ error: `${missing.join(", ")}: ${MISSING_ATTACHMENT_MESSAGE}`, missing }, { status: 409 });
  }
  // 길이·해상도·품질 등 모델이 supported_parameters로 공개한 나머지 설정.
  const reservedKeys = new Set(["model", "prompt", "imagedataurl", "videodataurl", "imageurl", "videourl"]);
  if (endImageField) reservedKeys.add(endImageField.toLowerCase());
  if (referenceField) reservedKeys.add(referenceField.toLowerCase());
  const extraParams = sanitizeExtraParams(body.params, reservedKeys);
  if (typeof extraParams.seed === "string" && /^\d+$/.test(extraParams.seed)) extraParams.seed = Number(extraParams.seed);
  Object.assign(payload, extraParams);

  try {
    let upstream = await queueVideo(payload);
    let bodyText = await readJson(upstream);
    // 참조 동영상(reference-to-video)은 NanoGPT가 받지 않을 수 있습니다. 거부(4xx)되면
    // 참조 동영상만 빼고 한 번 더 요청하고, 뺐다는 사실을 알려 줍니다.
    let droppedReference = false;
    if (!upstream.ok && upstream.status >= 400 && upstream.status < 500 && ![401, 402].includes(upstream.status)
      && payload.videoDataUrl && /reference/i.test(model)) {
      delete payload.videoDataUrl;
      droppedReference = true;
      upstream = await queueVideo(payload);
      bodyText = await readJson(upstream);
    }
    if (!upstream.ok) {
      throw politeNanoGptError(upstream, bodyText, "NanoGPT 동영상 생성 요청에 실패했습니다.");
    }
    const runId = extractRunId(bodyText);
    if (!runId) {
      throw new Error("동영상 생성 요청 응답에서 작업 번호를 확인할 수 없습니다.");
    }
    // 응답에 "runId, id, status, model, cost, remainingBalance" 형태로
    // 실제 청구액이 함께 실리는 경우가 있어(NanoGPT 공식 문서), 있으면 즉시
    // 돌려줍니다. 없으면 완료 시점에 /api/video/retrieve 에서 다시 확인합니다.
    const cost = extractCost(bodyText);
    return NextResponse.json({
      ok: true,
      runId,
      status: extractStatus(bodyText) ?? "pending",
      cost: cost ? { amount: cost.amount, currency: cost.currency ?? "USD" } : null,
      droppedReference,
      raw: bodyText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NanoGPT 동영상 생성 요청에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
