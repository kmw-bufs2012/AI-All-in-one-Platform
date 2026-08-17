import { NextRequest, NextResponse } from "next/server";
import { translateToKorean } from "@/lib/azure";

export async function POST(request: NextRequest) {
  let body: { texts?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!Array.isArray(body.texts)) {
    return NextResponse.json({ error: "texts 항목이 필요합니다." }, { status: 400 });
  }
  const texts = body.texts.filter((item): item is string => typeof item === "string").slice(0, 50);
  if (texts.length === 0) {
    return NextResponse.json({ available: true, translations: [] });
  }
  const result = await translateToKorean(texts);
  return NextResponse.json(result);
}