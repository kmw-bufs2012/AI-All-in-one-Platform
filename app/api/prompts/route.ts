import { NextRequest, NextResponse } from "next/server";
import { getDb, insertPrompt, listPrompts } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const prompts = listPrompts(db).map((row) => ({
    id: row.id,
    name: row.name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return NextResponse.json({ prompts });
}

export async function POST(request: NextRequest) {
  let body: { name?: unknown; content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!name || name.length > 100) {
    return NextResponse.json({ error: "프롬프트 이름은 1자 이상 100자 이내로 입력해 주세요." }, { status: 400 });
  }
  if (!content || content.length > 20000) {
    return NextResponse.json({ error: "프롬프트 내용은 1자 이상 20,000자 이내로 입력해 주세요." }, { status: 400 });
  }
  const row = insertPrompt(getDb(), name, content);
  return NextResponse.json({ ok: true, id: row.id });
}