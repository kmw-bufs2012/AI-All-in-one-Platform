import { NextRequest, NextResponse } from "next/server";
import { fetchNanoGptModels, NanoGptError, type CatalogType } from "@/lib/nanogpt";
import { normalizeModel } from "@/lib/models";

const ALLOWED_TYPES = new Set<CatalogType>(["text", "image", "video", "tts"]);

function isCatalogType(value: string): value is CatalogType {
  return ALLOWED_TYPES.has(value as CatalogType);
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") || "text";
  if (!isCatalogType(type)) {
    return NextResponse.json({ error: "지원하지 않는 모델 유형입니다." }, { status: 400 });
  }
  try {
    const rawModels = await fetchNanoGptModels(type);
    const models = rawModels.map((raw) => normalizeModel(raw, type)).filter((model) => model.id);
    return NextResponse.json({ source: "live", type, models });
  } catch (error) {
    const message = error instanceof NanoGptError ? error.message : "NanoGPT 모델 목록을 불러오지 못했습니다.";
    const status = error instanceof NanoGptError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
