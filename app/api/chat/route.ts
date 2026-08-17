import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { proxyChatCompletion, politeVeniceError, readJson } from "@/lib/venice";
import { resolveUploadPath, mimeFromPath, MAX_IMAGES, MAX_VIDEO_FILES, MAX_DOCS } from "@/lib/attachments";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OutgoingPart {
  type: string;
  [key: string]: unknown;
}

async function resolveAttachmentFile(id: string): Promise<{ filePath: string; mime: string; name: string } | null> {
  if (!UUID_PATTERN.test(id)) return null;
  let dir: string | null = null;
  try {
    dir = resolveUploadPath(path.join("attachments", id));
  } catch {
    return null;
  }
  if (!dir) return null;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const fileEntry = entries.find((entry) => entry.isFile());
  if (!fileEntry) return null;
  const filePath = path.join(dir, fileEntry.name);
  return { filePath, mime: mimeFromPath(filePath), name: fileEntry.name };
}

async function toDataUrl(filePath: string, mime: string): Promise<string> {
  const buffer = await readFile(filePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export async function POST(request: NextRequest) {
  let body: {
    model?: unknown;
    messages?: unknown;
    attachments?: { images?: unknown; docs?: unknown; videos?: unknown };
    frames?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model : "";
  if (!model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "모델과 메시지가 필요합니다." }, { status: 400 });
  }

  const messages: Array<{ role: string; content: string | OutgoingPart[] }> = body.messages.map((message) => {
    if (typeof message !== "object" || message === null) return { role: "", content: "" };
    const cast = message as { role?: unknown; content?: unknown };
    return {
      role: typeof cast.role === "string" ? cast.role : "",
      content: typeof cast.content === "string" ? cast.content : "",
    };
  });
  if (messages.some((message) => !message || (message.role !== "user" && message.role !== "assistant"))) {
    return NextResponse.json({ error: "메시지 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const imageIds: string[] = Array.isArray(body.attachments?.images)
    ? (body.attachments.images as unknown[]).filter((id): id is string => typeof id === "string").slice(0, MAX_IMAGES)
    : [];
  const docIds: string[] = Array.isArray(body.attachments?.docs)
    ? (body.attachments.docs as unknown[]).filter((id): id is string => typeof id === "string").slice(0, MAX_DOCS)
    : [];
  // video_url 콘텐츠 파트는 API 차원에서 "At most 3 videos" 제한이 있어
  // MAX_VIDEO_FILES(3)로 잘라냅니다.
  const videoIds: string[] = Array.isArray(body.attachments?.videos)
    ? (body.attachments.videos as unknown[]).filter((id): id is string => typeof id === "string").slice(0, MAX_VIDEO_FILES)
    : [];
  const frames: string[] = Array.isArray(body.frames)
    ? (body.frames as unknown[]).filter((value): value is string =>
        typeof value === "string" && value.startsWith("data:image/")).slice(0, 12)
    : [];

  const parts: OutgoingPart[] = [];
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    return NextResponse.json({ error: "마지막 메시지는 사용자 메시지여야 합니다." }, { status: 400 });
  }  if (lastMessage.content) {
    parts.push({ type: "text", text: lastMessage.content });
  }

  for (const id of imageIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) continue;
    const dataUrl = await toDataUrl(file.filePath, file.mime);
    parts.push({ type: "image_url", image_url: { url: dataUrl } });
  }
  for (const id of videoIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) continue;
    const dataUrl = await toDataUrl(file.filePath, file.mime);
    parts.push({ type: "video_url", video_url: { url: dataUrl } });
  }
  for (const frame of frames) {
    parts.push({ type: "image_url", image_url: { url: frame } });
  }
  for (const id of docIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) continue;
    const dataUrl = await toDataUrl(file.filePath, file.mime);
    parts.push({ type: "file", file: { file_data: dataUrl, filename: file.name } });
  }
  if (parts.length === 0) {
    return NextResponse.json({ error: "전송할 메시지 내용이 없습니다." }, { status: 400 });
  }
  lastMessage.content = parts;

  const payload = {
    model,
    messages: messages.map((message) => ({
      role: message?.role,
      content: message.content,
    })),
    stream: true,
    venice_parameters: { include_venice_system_prompt: false },
  };

  try {
    const upstream = await proxyChatCompletion(payload);
    if (!upstream.ok) {
      const bodyText = await readJson(upstream);
      throw politeVeniceError(upstream, bodyText, "Venice.ai 채팅 요청에 실패했습니다.");
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Venice.ai 채팅 요청에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}