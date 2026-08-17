import { NextRequest, NextResponse } from "next/server";
import { retrieveVideo, politeVeniceError, readJson } from "@/lib/venice";
import { extractStatus, extractCost, isFailureStatus, isVideoResponse } from "@/lib/extract";
import { saveGeneratedFile } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const queueId = request.nextUrl.searchParams.get("queue_id") || "";
  const model = request.nextUrl.searchParams.get("model") || "";
  if (!queueId || !model) {
    return NextResponse.json({ error: "작업 번호와 모델이 필요합니다." }, { status: 400 });
  }

  try {
    const upstream = await retrieveVideo(queueId, model);
    if (!upstream.ok) {
      const body = await readJson(upstream);
      throw politeVeniceError(upstream, body, "Venice.ai 영상 결과 확인에 실패했습니다.");
    }
    if (isVideoResponse(upstream)) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const mime = upstream.headers.get("content-type") || "video/mp4";
      const relative = await saveGeneratedFile(buffer, mime);
      return NextResponse.json({ status: "completed", url: `/api/files/${relative}`, size: buffer.length });
    }
    const text = await upstream.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const buffer = Buffer.from(text, "binary");
      const mime = upstream.headers.get("content-type") || "video/mp4";
      const relative = await saveGeneratedFile(buffer, mime);
      return NextResponse.json({ status: "completed", url: `/api/files/${relative}`, size: buffer.length });
    }
    const status = extractStatus(parsed) ?? "PROCESSING";
    if (isFailureStatus(status)) {
      return NextResponse.json({ status: "failed", detail: status, raw: parsed });
    }
    const cost = extractCost(parsed);
    return NextResponse.json({
      status,
      cost: cost ? { amount: cost.amount, currency: cost.currency ?? null } : null,
      raw: parsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Venice.ai 영상 결과 확인에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}