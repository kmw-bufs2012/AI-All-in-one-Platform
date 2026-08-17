import { NextRequest, NextResponse } from "next/server";
import { generateSpeech, politeVeniceError, readJson } from "@/lib/venice";
import { saveGeneratedFile } from "@/lib/storage";

const ALLOWED_FORMATS = new Set(["mp3", "opus", "aac", "flac", "wav", "pcm"]);
const MAX_INPUT_LENGTH = 4096;

export async function POST(request: NextRequest) {
  let body: { model?: unknown; voice?: unknown; input?: unknown; response_format?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model : "";
  const input = typeof body.input === "string" ? body.input : "";
  if (!model || !input) {
    return NextResponse.json({ error: "모델과 음성 생성할 텍스트가 필요합니다." }, { status: 400 });
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return NextResponse.json({ error: `텍스트는 ${MAX_INPUT_LENGTH}자 이내로 입력해 주세요.` }, { status: 400 });
  }

  const payload: Record<string, unknown> = { model, input };
  if (typeof body.voice === "string" && body.voice) {
    payload.voice = body.voice;
  }
  if (typeof body.response_format === "string" && ALLOWED_FORMATS.has(body.response_format)) {
    payload.response_format = body.response_format;
  }

  try {
    const upstream = await generateSpeech(payload);
    if (!upstream.ok) {
      const bodyText = await readJson(upstream);
      throw politeVeniceError(upstream, bodyText, "Venice.ai 음성 생성에 실패했습니다.");
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const mime = upstream.headers.get("content-type") || "audio/mpeg";
    const relative = await saveGeneratedFile(buffer, mime);
    return NextResponse.json({
      ok: true,
      url: `/api/files/${relative}`,
      format: mime,
      size: buffer.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Venice.ai 음성 생성에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}