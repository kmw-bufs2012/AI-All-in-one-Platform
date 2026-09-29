import { NextRequest, NextResponse } from "next/server";
import { deleteObject, getObjectBuffer, putObject, updateJsonDoc, usingR2 } from "@/lib/object-store";

/*
 * 채팅 대화 기록을 Cloudflare R2 에 보관합니다.
 * - chats/<id>.json   대화 전체(메시지·첨부 메타데이터)
 * - chats/index.json  목록 화면용 요약(id·제목·수정 시각·메시지 수)
 * R2 가 설정되지 않은 서버에서는 { enabled: false } 를 돌려주고, 브라우저는
 * 기존처럼 localStorage 7일 보관만 씁니다(lib/chat-archive.ts).
 */

const ID_PATTERN = /^[a-z0-9-]{4,60}$/i;
const INDEX_KEY = "chats/index.json";
const MAX_BODY_CHARS = 5_000_000;
const MAX_ITEMS = 500;

interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

async function readIndex(): Promise<ChatSummary[]> {
  const buffer = await getObjectBuffer(INDEX_KEY).catch(() => null);
  if (!buffer) return [];
  try {
    const parsed = JSON.parse(buffer.toString("utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(items: ChatSummary[]): Promise<void> {
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ITEMS);
  await putObject(INDEX_KEY, Buffer.from(JSON.stringify(sorted)), "application/json");
}

export async function GET(request: NextRequest) {
  if (!usingR2()) return NextResponse.json({ enabled: false, conversations: [] });
  const id = request.nextUrl.searchParams.get("id");
  try {
    if (id) {
      if (!ID_PATTERN.test(id)) return NextResponse.json({ error: "대화 ID가 올바르지 않습니다." }, { status: 400 });
      const buffer = await getObjectBuffer(`chats/${id}.json`);
      if (!buffer) return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
      return new Response(buffer.toString("utf8"), { headers: { "Content-Type": "application/json" } });
    }
    return NextResponse.json({ enabled: true, conversations: await readIndex() });
  } catch (error) {
    console.error("[chats] read failed:", error);
    return NextResponse.json({ error: "Cloudflare R2 에서 대화 기록을 읽지 못했습니다." }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  if (!usingR2()) return NextResponse.json({ enabled: false });
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "대화가 너무 커서 저장하지 못했습니다." }, { status: 413 });
  }
  let body: { id?: unknown; title?: unknown; updatedAt?: unknown; messages?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!ID_PATTERN.test(id) || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "대화 ID와 메시지가 필요합니다." }, { status: 400 });
  }
  const summary: ChatSummary = {
    id,
    title: typeof body.title === "string" ? body.title.slice(0, 120) : "대화",
    updatedAt: typeof body.updatedAt === "number" ? body.updatedAt : Date.now(),
    messageCount: body.messages.length,
  };
  try {
    await putObject(`chats/${id}.json`, Buffer.from(JSON.stringify({ ...summary, messages: body.messages })), "application/json");
    // 목록 문서는 조건부 쓰기로 갱신해 동시에 저장해도 항목이 빠지지 않게 합니다.
    await updateJsonDoc<ChatSummary[], void>(INDEX_KEY, [], (items) => ({
      next: [summary, ...items.filter((item) => item.id !== id)].slice(0, MAX_ITEMS),
      result: undefined,
    }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[chats] save failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cloudflare R2 에 대화 기록을 저장하지 못했습니다." }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!usingR2()) return NextResponse.json({ enabled: false });
  const id = request.nextUrl.searchParams.get("id");
  const all = request.nextUrl.searchParams.get("all") === "1";
  try {
    const index = await readIndex();
    if (all) {
      await Promise.all(index.map((item) => deleteObject(`chats/${item.id}.json`)));
      await writeIndex([]);
      return NextResponse.json({ ok: true });
    }
    if (!id || !ID_PATTERN.test(id)) return NextResponse.json({ error: "대화 ID가 올바르지 않습니다." }, { status: 400 });
    await deleteObject(`chats/${id}.json`);
    await updateJsonDoc<ChatSummary[], void>(INDEX_KEY, [], (items) => ({ next: items.filter((item) => item.id !== id), result: undefined }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[chats] delete failed:", error);
    return NextResponse.json({ error: "Cloudflare R2 에서 대화 기록을 지우지 못했습니다." }, { status: 502 });
  }
}
