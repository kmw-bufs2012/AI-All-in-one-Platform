import { acceptDataUrl, MISSING_ATTACHMENT_MESSAGE } from "@/lib/inline-media";
import { NextRequest, NextResponse } from "next/server";
import { proxyChatCompletion, politeNanoGptError, readJson } from "@/lib/nanogpt";
import {
  MAX_IMAGES,
  MAX_VIDEO_FILES,
  MAX_AUDIO_FILES,
  MAX_DOCS,
} from "@/lib/attachments";
import { findAttachment, getObjectBuffer } from "@/lib/object-store";
import { docFormat, extractDocumentText } from "@/lib/doc-extract";

// Vercel Hobby(Fluid compute) 함수 최대 실행 시간은 300초입니다.
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 문서(txt·md·Word·PowerPoint·한글)는 본문 텍스트를 뽑아 메시지에 붙여 넣습니다.
 * PDF는 capabilities.pdf_upload 가 true인 모델에는 파일 파트로, 아닌 모델에는
 * 텍스트를 뽑아 보냅니다(lib/doc-extract.ts). */
const MAX_INLINE_DOC_CHARS = 60000;

interface OutgoingPart {
  type: string;
  [key: string]: unknown;
}

async function resolveAttachmentFile(id: string): Promise<{ key: string; mime: string; name: string } | null> {
  if (!UUID_PATTERN.test(id)) return null;
  return findAttachment(id).catch(() => null);
}

async function readAttachment(key: string): Promise<Buffer> {
  const buffer = await getObjectBuffer(key);
  if (!buffer) throw new Error("첨부 파일을 읽지 못했습니다.");
  return buffer;
}

async function toDataUrl(key: string, mime: string): Promise<string> {
  return `data:${mime};base64,${(await readAttachment(key)).toString("base64")}`;
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
    /** 브라우저 7일 보관 사본(id → data URL). 서버 디스크에 없을 때 대신 씁니다. */
    inlineMedia?: unknown;
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
  const inlineMedia = body.inlineMedia && typeof body.inlineMedia === "object" && !Array.isArray(body.inlineMedia)
    ? (body.inlineMedia as Record<string, unknown>)
    : {};
  const inlineFor = (id: string, kind: "image" | "video" | "audio") => acceptDataUrl(inlineMedia[id], kind);
  const missing: string[] = [];
  for (const [ids, kind] of [[imageIds, "image"], [videoIds, "video"], [audioIds, "audio"], [docIds, null]] as const) {
    for (const id of ids) {
      if (await resolveAttachmentFile(id)) continue;
      if (kind && inlineFor(id, kind)) continue;
      missing.push(id);
    }
  }
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: MISSING_ATTACHMENT_MESSAGE,
        missing,
      },
      { status: 409 },
    );
  }

  for (const id of imageIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) {
      const inline = inlineFor(id, "image");
      if (inline) parts.push({ type: "image_url", image_url: { url: inline } });
      continue;
    }
    parts.push({ type: "image_url", image_url: { url: await toDataUrl(file.key, file.mime) } });
  }
  for (const id of videoIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) {
      const inline = inlineFor(id, "video");
      if (inline) parts.push({ type: "video_url", video_url: { url: inline } });
      continue;
    }
    parts.push({ type: "video_url", video_url: { url: await toDataUrl(file.key, file.mime) } });
  }
  for (const id of audioIds) {
    const file = await resolveAttachmentFile(id);
    if (!file) {
      const inline = inlineFor(id, "audio");
      const match = inline?.match(/^data:audio\/([\w.+-]+);base64,(.*)$/);
      if (match) parts.push({ type: "input_audio", input_audio: { data: match[2], format: audioFormat(`audio/${match[1]}`) } });
      continue;
    }
    const buffer = await readAttachment(file.key);
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
    const format = docFormat(file.name, file.mime);
    if (format === "pdf" && pdfAllowed) {
      parts.push({
        type: "file",
        file: { file_data: await toDataUrl(file.key, "application/pdf"), filename: file.name },
      });
      continue;
    }
    let text: string;
    try {
      text = (await extractDocumentText(await readAttachment(file.key), file.name, file.mime)).trim();
    } catch (error) {
      return NextResponse.json(
        { error: `«${file.name}»: ${error instanceof Error ? error.message : "문서 내용을 읽지 못했습니다."}` },
        { status: 422 },
      );
    }
    if (!text) {
      return NextResponse.json(
        { error: `«${file.name}»에서 글자를 찾지 못했습니다. 스캔한 이미지 문서라면 이미지로 첨부해 주세요.` },
        { status: 422 },
      );
    }
    const clipped = text.length > MAX_INLINE_DOC_CHARS;
    parts.push({
      type: "text",
      text: `첨부 문서 «${file.name}»${clipped ? ` (앞부분 ${MAX_INLINE_DOC_CHARS.toLocaleString("ko-KR")}자만 전달)` : ""}\n\n${text.slice(0, MAX_INLINE_DOC_CHARS)}`,
    });
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
