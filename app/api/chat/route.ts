import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { proxyChatCompletion, politeNanoGptError, readJson } from "@/lib/nanogpt";
import {
  resolveUploadPath,
  mimeFromPath,
  MAX_IMAGES,
  MAX_VIDEO_FILES,
  MAX_AUDIO_FILES,
  MAX_DOCS,
} from "@/lib/attachments";

// Vercel Hobby(Fluid compute) 함수 최대 실행 시간은 300초입니다.
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 텍스트 문서는 파일 파트 대신 본문에 그대로 붙여 넣습니다. PDF만 파일 파트로
 * 보내며, 그마저도 capabilities.pdf_upload 가 true인 모델에서만 허용됩니다. */
const MAX_INLINE_DOC_CHARS = 20000;

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

/** OpenAI 호환 input_audio 파트의 format 값. */
function audioFormat(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes("wav")) return "wav";
  if (lower.includes("ogg") || lower.includes("opus")) return "ogg";
  if (lower.includes("flac")) return "flac";
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("aac")) return "m4a";
  if (lower.includes("webm")) return "webm";
  return "mp3";
}

function idList(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter((id): id is string => typeof id === "string").slice(0, limit)
    : [];
}

export async function POST(request: NextRequest) {
  let body: {
    model?: unknown;
    messages?: unknown;
    attachments?: { images?: unknown; docs?: unknown; videos?: unknown; audios?: unknown };
    frames?: unknown;
    frameGroups?: unknown;
    inlineImages?: unknown;
    pdfAllowed?: unknown;
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

  const imageIds = idList(body.attachments?.images, MAX_IMAGES);
  const videoIds = idList(body.attachments?.videos, MAX_VIDEO_FILES);
  const audioIds = idList(body.attachments?.audios, MAX_AUDIO_FILES);
  const docIds = idList(body.attachments?.docs, MAX_DOCS);
  const pdfAllowed = body.pdfAllowed === true;
  const frames: string[] = Array.isArray(body.frames)
    ? (body.frames as unknown[]).filter((value): value is string =>
        typeof value === "string" && value.startsWith("data:image/")).slice(0, 12)
    : [];

  const parts: OutgoingPart[] = [];
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    return NextResponse.json({ error: "마지막 메시지는 사용자 메시지여야 합니다." }, { status: 400 });
  }
  if (lastMessage.content) {
    parts.push({ type: "text", text: lastMessage.content });
  }

  const inlineImages: string[] = Array.isArray(body.inlineImages)
    ? (body.inlineImages as unknown[]).filter((value): value is string =>
        typeof value === "string" && value.startsWith("data:image/")).slice(0, MAX_IMAGES)
    : [];
  for (const url of inlineImages) {
    parts.push({ type: "image_url", image_url: { url } });
  }

  /*
   * 서버리스 환경에서는 업로드 파일이 다른 인스턴스의 /tmp 에 있어 찾지 못할 수
   * 있습니다. 조용히 빼고 보내면 모델이 "첨부가 없다"고 답하므로 오류로 알립니다.
   */
  const missing: string[] = [];
  for (const id of [...imageIds, ...videoIds, ...audioIds, ...docIds]) {
    if (!(await resolveAttachmentFile(id))) missing.push(id);
  }
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error:
          "서버에서 첨부 파일을 찾지 못했습니다. 서버리스 환경의 임시 저장소가 바뀌었을 수 있습니다. 파일을 다시 첨부한 뒤 보내 주세요.",
        missing,
      },
      { status: 409 },
    );
  }

  for (const id of imageIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) continue;
    parts.push({ type: "image_url", image_url: { url: await toDataUrl(file.filePath, file.mime) } });
  }
  for (const id of videoIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) continue;
    parts.push({ type: "video_url", video_url: { url: await toDataUrl(file.filePath, file.mime) } });
  }
  for (const id of audioIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) continue;
    const buffer = await readFile(file.filePath);
    parts.push({
      type: "input_audio",
      input_audio: { data: buffer.toString("base64"), format: audioFormat(file.mime) },
    });
  }
  if (frames.length > 0) {
    // 설명 없이 이미지만 보내면 모델이 "동영상이 없다"고 답하므로, 이 이미지들이
    // 첨부 동영상에서 시간 순으로 뽑은 프레임이라는 사실을 함께 알려 줍니다.
    const groups = Array.isArray(body.frameGroups)
      ? (body.frameGroups as unknown[])
          .map((group) => group as { name?: unknown; count?: unknown })
          .filter((group) => typeof group.name === "string" && typeof group.count === "number")
          .map((group) => ({ name: String(group.name), count: Number(group.count) }))
      : [];
    const described = groups.length > 0 ? groups : [{ name: "첨부 동영상", count: frames.length }];
    let offset = 0;
    for (const group of described) {
      const slice = frames.slice(offset, offset + group.count);
      offset += group.count;
      if (slice.length === 0) continue;
      parts.push({
        type: "text",
        text: `[사용자가 동영상 «${group.name}»을(를) 첨부했습니다. 아래 ${slice.length}장의 이미지는 이 동영상의 처음부터 끝까지 시간 순으로 고르게 뽑은 프레임입니다. 이 프레임들을 동영상으로 보고 내용을 파악해 답해 주세요.]`,
      });
      for (const frame of slice) parts.push({ type: "image_url", image_url: { url: frame } });
    }
    for (const frame of frames.slice(offset)) parts.push({ type: "image_url", image_url: { url: frame } });
  }
  for (const id of docIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) continue;
    if (file.mime === "application/pdf") {
      // PDF는 capabilities.pdf_upload 를 지원하는 모델에만 파일 파트로 보냅니다.
      if (!pdfAllowed) continue;
      parts.push({
        type: "file",
        file: { file_data: await toDataUrl(file.filePath, file.mime), filename: file.name },
      });
      continue;
    }
    const text = (await readFile(file.filePath, "utf8")).slice(0, MAX_INLINE_DOC_CHARS);
    parts.push({ type: "text", text: `첨부 문서 «${file.name}»\n\n${text}` });
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
    stream_options: { include_usage: true },
  };

  try {
    const upstream = await proxyChatCompletion(payload);
    if (!upstream.ok) {
      const bodyText = await readJson(upstream);
      throw politeNanoGptError(upstream, bodyText, "NanoGPT 채팅 요청에 실패했습니다.");
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NanoGPT 채팅 요청에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
