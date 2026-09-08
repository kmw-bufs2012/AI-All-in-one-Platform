import { NextRequest, NextResponse } from "next/server";
import { retrieveVideo, politeNanoGptError, readJson } from "@/lib/nanogpt";
import { extractStatus, extractCost, extractVideoUrl, isFailureStatus, isVideoResponse } from "@/lib/extract";
import { saveGeneratedFile } from "@/lib/storage";

/*
 * NanoGPT 영상 작업 상태 조회(GET /api/video/status?requestId=<runId>).
 * status 가 COMPLETED 가 되면 결과 영상 URL이 함께 들어옵니다. FAILED 면 실패입니다.
 */
export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("run_id") || request.nextUrl.searchParams.get("queue_id") || "";
  if (!runId) {
    return NextResponse.json({ error: "작업 번호가 필요합니다." }, { status: 400 });
  }

  try {
    const upstream = await retrieveVideo(runId);
    if (!upstream.ok) {
      const body = await readJson(upstream);
      throw politeNanoGptError(upstream, body, "NanoGPT 영상 결과 확인에 실패했습니다.");
    }
    // 드물게 영상 바이너리를 그대로 돌려주는 경우도 받아 둡니다.
    if (isVideoResponse(upstream)) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const mime = upstream.headers.get("content-type") || "video/mp4";
      const relative = await saveGeneratedFile(buffer, mime);
      return NextResponse.json({ status: "completed", url: `/api/files/${relative}`, size: buffer.length });
    }

    const parsed = await readJson(upstream);
    const status = extractStatus(parsed) ?? "PROCESSING";
    if (isFailureStatus(status)) {
      return NextResponse.json({ status: "failed", detail: status, raw: parsed });
    }

    const videoUrl = extractVideoUrl(parsed);
    if (videoUrl) {
      return NextResponse.json({ status: "completed", url: videoUrl, cost: extractCost(parsed) ?? null });
    }

    const cost = extractCost(parsed);
    return NextResponse.json({
      status,
      cost: cost ? { amount: cost.amount, currency: cost.currency ?? null } : null,
      raw: parsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NanoGPT 영상 결과 확인에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
