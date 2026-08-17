import { NextRequest, NextResponse } from "next/server";
import { getDb, deletePrompt } from "@/lib/db";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return NextResponse.json({ error: "프롬프트 번호가 올바르지 않습니다." }, { status: 400 });
  }
  const deleted = deletePrompt(getDb(), parsed);
  if (!deleted) {
    return NextResponse.json({ error: "프롬프트를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}