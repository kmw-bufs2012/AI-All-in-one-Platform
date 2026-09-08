import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { queueVideo, politeNanoGptError, readJson, sanitizeExtraParams } from "@/lib/nanogpt";
import { extractRunId, extractStatus, extractCost } from "@/lib/extract";
import { resolveUploadPath, mimeFromPath } from "@/lib/attachments";
import { findVideoOverlay } from "@/lib/model-capability-overlay";

/*
 * NanoGPT 영상 생성(POST /api/generate-video)은 비동기입니다. 요청은 즉시
 * runId 와 status: "pending" 을 돌려주고, 결과는 /api/video/status 로 폴링합니다.
 *
 * 입력 미디어는 모델마다 다릅니다.
 * - image-to-video 모델: imageDataUrl(base64) 또는 imageUrl(공개 HTTPS URL).
 * - 영상 확장·편집 모델: videoUrl.
 * 어떤 모델이 무엇을 받는지는 /v1/video-models 의 supported_parameters 로
 * 판정해 클라이언트에서 걸러 보냅니다(lib/attachment-policy.ts).
 */
async function resolveDataUrl(id: string): Promise<string | null> {
  let dir: string | null = null;
  try {
    dir = resolveUploadPath(path.join("attachments", id));
  } catch {
    return null;
  }
  if (!dir) return null;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const entry = entries.find((item) => item.isFile());
  if (!entry) return null;
  const buffer = await readFile(path.join(dir, entry.name));
  return `data:${mimeFromPath(entry.name)};base64,${buffer.toString("base64")}`;
}

export async function POST(request: NextRequest) {
  let body: {
    model?: unknown;
    prompt?: unknown;
    startImageId?: unknown;
    sourceVideoId?: unknown;
    endImageId?: unknown;
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
  if (typeof body.startImageId === "string") {
    const dataUrl = await resolveDataUrl(body.startImageId);
    if (dataUrl) payload.imageDataUrl = dataUrl;
  }
  if (typeof body.sourceVideoId === "string") {
    const dataUrl = await resolveDataUrl(body.sourceVideoId);
    if (dataUrl) payload.videoDataUrl = dataUrl;
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
      const dataUrl = await resolveDataUrl(body.endImageId);
      if (dataUrl) {
        payload[endFrameRole.field] = dataUrl;
        endImageField = endFrameRole.field;
      }
    }
  }
  // 길이·해상도·품질 등 모델이 supported_parameters로 공개한 나머지 설정.
  const reservedKeys = new Set(["model", "prompt", "imagedataurl", "videodataurl", "imageurl", "videourl"]);
  if (endImageField) reservedKeys.add(endImageField.toLowerCase());
  const extraParams = sanitizeExtraParams(body.params, reservedKeys);
  Object.assign(payload, extraParams);

  try {
    const upstream = await queueVideo(payload);
    const bodyText = await readJson(upstream);
    if (!upstream.ok) {
      throw politeNanoGptError(upstream, bodyText, "NanoGPT 영상 생성 요청에 실패했습니다.");
    }
    const runId = extractRunId(bodyText);
    if (!runId) {
      throw new Error("영상 생성 요청 응답에서 작업 번호를 확인할 수 없습니다.");
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
      raw: bodyText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NanoGPT 영상 생성 요청에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
