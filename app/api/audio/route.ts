import { NextRequest, NextResponse } from "next/server";
import { generateSpeech, politeNanoGptError, readJson } from "@/lib/nanogpt";
import { saveGeneratedFile } from "@/lib/storage";

/*
 * NanoGPT 동기 TTS(POST /api/v1/speech).
 * 본문: model, input, voice, format(mp3·wav·ogg·opus·aac·flac·pcm16), speed, language.
 * 최대 입력 길이는 모델마다 다르고 /v1/audio-models 의 max_input_size 로
 * 공개되므로, 화면에서 모델 값으로 제한하고 서버에서는 넉넉한 방어선만 둡니다.
 */
const ALLOWED_FORMATS = new Set(["mp3", "wav", "ogg", "opus", "aac", "flac", "pcm16"]);
const HARD_INPUT_LIMIT = 100000;

export async function POST(request: NextRequest) {
  let body: {
    model?: unknown;
    voice?: unknown;
    input?: unknown;
    format?: unknown;
    speed?: unknown;
    language?: unknown;
  };
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
  if (input.length > HARD_INPUT_LIMIT) {
    return NextResponse.json({ error: `텍스트는 ${HARD_INPUT_LIMIT}자 이내로 입력해 주세요.` }, { status: 400 });
  }

  const payload: Record<string, unknown> = { model, input };
  if (typeof body.voice === "string" && body.voice) {
    payload.voice = body.voice;
  }
  if (typeof body.format === "string" && ALLOWED_FORMATS.has(body.format)) {
    payload.format = body.format;
  }
  if (typeof body.speed === "number" && Number.isFinite(body.speed)) {
    payload.speed = body.speed;
  }
  if (typeof body.language === "string" && body.language) {
    payload.language = body.language;
  }

  try {
    const upstream = await generateSpeech(payload);
    if (!upstream.ok) {
      const bodyText = await readJson(upstream);
      throw politeNanoGptError(upstream, bodyText, "NanoGPT 음성 생성에 실패했습니다.");
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
    const message = error instanceof Error ? error.message : "NanoGPT 음성 생성에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
