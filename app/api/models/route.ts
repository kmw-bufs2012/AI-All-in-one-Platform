import { NextRequest, NextResponse } from "next/server";
import { fetchVeniceModels, VeniceError } from "@/lib/venice";
import { normalizeModel } from "@/lib/models";

const ALLOWED_TYPES = new Set(["text", "image", "video", "tts"]);

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") || "text";
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: "지원하지 않는 모델 유형입니다." }, { status: 400 });
  }
  try {
    const rawModels = await fetchVeniceModels(type);
    const models = rawModels.map(normalizeModel).filter((model) => model.id);
    return NextResponse.json({ source: "live", type, models });
  } catch (error) {
    const message = error instanceof VeniceError ? error.message : "Venice.ai 모델 목록을 불러오지 못했습니다.";
    const status = error instanceof VeniceError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}