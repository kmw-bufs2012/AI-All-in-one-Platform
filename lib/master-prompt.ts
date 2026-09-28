/*
 * 동영상 → Seedance 2.0 Mini 마스터 프롬프트 생성용 지시문.
 *
 * Seedance 2.0 계열 프롬프트 작성 원칙(2026-09 조사, 근거는
 * docs/model-capability-research.md 의 "Seedance 2.0 Mini 마스터 프롬프트" 절):
 * - 샷 수·총 길이·화면비를 프롬프트 맨 위에 적는다.
 * - 주체(피사체)를 먼저 쓰고, 구체적인 카메라 용어를 쓴다.
 * - 소리(대사·효과음·음악)를 프롬프트에 직접 적는다(네이티브 오디오 생성).
 * - 부정문 대신 긍정문으로 쓴다.
 * - 해상도·길이·화면비 값 자체는 생성 화면의 설정으로 지정한다.
 * - 한 번 생성할 때 최대 15초.
 *
 * 앱의 필수 구조(사용자 요구사항):
 *   [VIDEO STYLE] → [CHARACTER STYLE] → [BACKGROUND] → [MAIN PROMPT]
 *   → [NEGATIVE PROMPT] → [MOTION INTENSITY]
 * - 메인 프롬프트 앞에 동영상 스타일·캐릭터 스타일·배경을 반드시 명시.
 * - 메인 프롬프트는 장면마다 초 단위 구간([00:00-00:03])으로 나누고, 구간마다
 *   정확한 카메라샷(Camera)·동작(Action)·캐릭터 일관성(Consistency)을 적음.
 *   캐릭터는 C1·C2 같은 ID로 고정해 모든 장면에서 같은 묘사를 유지.
 * - 메인 프롬프트는 긍정문으로 쓰고(Seedance 원칙), 피해야 할 것은 뒤의
 *   [NEGATIVE PROMPT]에 모음. 마지막에 [MOTION INTENSITY]로 모션 강도를 적음.
 * - 생성 후 checkMasterPrompt 로 구조를 검사해 화면에 알려 줌.
 */

export interface VideoMeta {
  name: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

const SEEDANCE_MAX_SECONDS = 15;

function aspectLabel(width: number | null, height: number | null): string {
  if (!width || !height) return "unknown";
  const ratio = width / height;
  const candidates: Array<[string, number]> = [
    ["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["21:9", 21 / 9],
  ];
  return candidates.reduce((best, current) =>
    Math.abs(current[1] - ratio) < Math.abs(best[1] - ratio) ? current : best,
  )[0];
}

function metaLines(meta: VideoMeta): string {
  const duration = meta.durationSec ? `${meta.durationSec.toFixed(1)}s` : "unknown";
  const size = meta.width && meta.height ? `${meta.width}x${meta.height}` : "unknown";
  return `- file: ${meta.name}\n- duration: ${duration}\n- resolution: ${size}\n- aspect ratio: ${aspectLabel(meta.width, meta.height)}`;
}

const MASTER_RULES = `Write ONE copy-paste-ready master prompt for ByteDance Seedance 2.0 Mini that recreates the reference video as exactly as possible.

The master prompt MUST contain these six sections, in this exact order, each starting with its exact header on its own line. Never skip, merge or rename a section.

[VIDEO STYLE]
- Overall visual style of the video: live-action / 3D animation / 2D anime / stop-motion etc., film look and color grade, lighting (direction, quality, contrast), frame-rate feel, aspect-ratio framing.

[CHARACTER STYLE]
- One line per character, each with a fixed ID: "C1: ...", "C2: ...".
- Exact, reusable appearance for each: age range, gender presentation, build, face, hair (color, length, style), clothing (items, colors, materials), accessories, props, rendering style of the character.
- These descriptors are the single source of truth for character consistency. If there are no people or creatures, describe the main subject the same way as "C1".

[BACKGROUND]
- Location, time of day, weather, key background elements and their positions, color palette. Keep it constant unless the video actually changes location; if it changes, state the time range for each location.

[MAIN PROMPT]
- First line: number of shots, total duration, aspect ratio (e.g. "3 shots, 10s, 16:9").
- Then one block per scene/shot, ALWAYS split by seconds with a timestamp: "[00:00-00:03]". Timestamps must be contiguous, start at 00:00 and end at the total duration.
- Every shot block must state, in this order:
  Camera: exact shot size (extreme wide / wide / full / medium / medium close-up / close-up / extreme close-up / over-the-shoulder / POV), camera angle (eye level / high / low / top-down / dutch), lens feel (e.g. 24mm wide, 50mm, 85mm telephoto), and exact camera movement (static / dolly in / dolly out / pan left / pan right / tilt up / tilt down / tracking / orbit / crane / handheld / zoom) with its speed.
  Action: exact, observable action of each character referenced by ID (C1, C2), with body part, direction, speed and ending pose, plus facial expression.
  Consistency: restate the character IDs present in the shot and keep their appearance identical to [CHARACTER STYLE] (same outfit, hair, colors, props); never change a character's look between shots unless the reference does.
  Audio: every spoken line VERBATIM in its original language, in quotes, with speaker ID and the exact seconds it is spoken, followed by "(lip-sync: mouth movements match these words exactly)"; the speaker's voice (gender, age range, tone, pace, accent); sound effects; ambience; music genre/tempo. If silent, write "ambient sound only".
  Transition: cut / match cut / fade / continuous to the next shot.
- Use concrete, observable, positive visual language inside [MAIN PROMPT] (describe what to show). Put everything that must NOT appear in [NEGATIVE PROMPT] instead.

[NEGATIVE PROMPT]
- One comma-separated line of things to avoid, always including artifacts relevant to this video (e.g. character appearance drift, face morphing, outfit change, extra fingers, distorted hands, flicker, jitter, warped background, text or watermark, blurry frames) plus anything specific to the reference.

[MOTION INTENSITY]
- One line: "level: low | medium | high, value: N/10" followed by a short reason based on how much the subjects and camera move in the reference. Use one value for the whole video, then per-shot values if they differ, e.g. "[00:00-00:03] 3/10, [00:03-00:08] 7/10".

Dialogue and voice:
- If you can hear the audio, transcribe every spoken line exactly (do not translate or paraphrase) and place each line in the shot where it is spoken, with the character ID of the person whose mouth moves.
- If you cannot hear the audio (frames only), do not invent dialogue; write "dialogue could not be verified" in the notes.

General rules:
- Maximum ${SEEDANCE_MAX_SECONDS} seconds per generation. If the reference is longer, cover the first ${SEEDANCE_MAX_SECONDS} seconds and say so in the notes.
- Do not invent things you cannot see. If something is unclear, choose the most likely option.
- Resolution, duration and aspect ratio values are set in the generation UI; include them only in the first line of [MAIN PROMPT].

Output format (exactly):
1. The whole master prompt (all six sections) in English inside a single \`\`\`text code block.
2. Immediately after it, a single \`\`\`json code block with the machine-readable settings, exactly these keys (use null when unknown):
{"duration": <total seconds>, "aspect_ratio": "16:9", "resolution": "720p", "fps": <number>, "negative_prompt": "<same text as [NEGATIVE PROMPT]>", "motion_intensity": <1-10>, "shots": [{"start": 0, "end": 3}], "dialogue": [{"start": 1.2, "end": 2.5, "speaker": "C1", "language": "ko", "text": "<verbatim>"}]}
3. After that, a short section in Korean titled "설정 참고" listing the recommended UI settings (duration, aspect ratio, resolution, the negative prompt and motion intensity fields if the generation UI has them) and anything that could not be reproduced.`;

/** 비전(LMM) 모델에 직접 동영상을 보여 주고 마스터 프롬프트를 받을 때. */
export function buildDirectPrompt(
  meta: VideoMeta,
  userNote: string,
  audio: "in-video" | "separate-file" | "none" = "none",
): string {
  const audioLine =
    audio === "separate-file"
      ? "The attached audio file is the soundtrack of the same video (same timeline, starting at 00:00). Use it to transcribe dialogue and describe voices and sounds."
      : audio === "in-video"
        ? "The attached video includes its soundtrack. Listen to it to transcribe dialogue and describe voices and sounds."
        : "No audio is available to you; only visuals.";
  return `${MASTER_RULES}

Reference video metadata:
${metaLines(meta)}
${userNote.trim() ? `\nExtra instructions from the user:\n${userNote.trim()}\n` : ""}
The attached video (or its frames in time order) is the reference.
${audioLine}`;
}

/* 마스터 프롬프트 화면에서 동영상 생성 화면으로 넘기는 장면별 첫 프레임. */
export interface ShotFrame {
  start: number;
  end: number;
  image: import("./client-api").AttachedFile | null;
}

export interface MasterSettings {
  duration: number | null;
  aspect_ratio: string | null;
  resolution: string | null;
  fps: number | null;
  negative_prompt: string | null;
  motion_intensity: number | null;
  shots: Array<{ start: number; end: number }>;
  dialogue: Array<{ start: number; end: number; speaker: string; language: string; text: string }>;
}

function toSeconds(value: string): number {
  const parts = value.split(":").map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : Number(value);
}

/** 메인 프롬프트의 [00:00-00:03] 구간을 읽습니다. */
export function parseShotRanges(prompt: string): Array<{ start: number; end: number; block: string }> {
  const upper = prompt.toUpperCase();
  const mainStart = upper.indexOf("[MAIN PROMPT]");
  const negStart = upper.indexOf("[NEGATIVE PROMPT]");
  const main = mainStart >= 0 ? prompt.slice(mainStart, negStart > mainStart ? negStart : undefined) : prompt;
  const pattern = /\[(\d{1,2}:\d{2}(?:\.\d+)?)\s*[-–~]\s*(\d{1,2}:\d{2}(?:\.\d+)?)\]/g;
  const matches = Array.from(main.matchAll(pattern));
  return matches.map((match, index) => ({
    start: toSeconds(match[1]),
    end: toSeconds(match[2]),
    block: main.slice(match.index ?? 0, matches[index + 1]?.index ?? main.length).trim(),
  }));
}

/** 응답의 \`\`\`json 설정 블록을 읽습니다. 없거나 깨졌으면 프롬프트에서 최대한 복원합니다. */
export function extractMasterSettings(text: string, prompt: string): MasterSettings {
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  let raw: Record<string, unknown> = {};
  const match = text.match(/\`\`\`json\s*\n([\s\S]*?)\`\`\`/);
  if (match) {
    try {
      raw = JSON.parse(match[1]) as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  const ranges = parseShotRanges(prompt);
  const shots = Array.isArray(raw.shots)
    ? (raw.shots as Array<Record<string, unknown>>)
        .map((shot) => ({ start: num(shot.start), end: num(shot.end) }))
        .filter((shot): shot is { start: number; end: number } => shot.start !== null && shot.end !== null && shot.end > shot.start)
    : [];
  const upper = prompt.toUpperCase();
  const negIndex = upper.indexOf("[NEGATIVE PROMPT]");
  const motionIndex = upper.indexOf("[MOTION INTENSITY]");
  const negativeFromPrompt =
    negIndex >= 0 ? prompt.slice(negIndex + "[NEGATIVE PROMPT]".length, motionIndex > negIndex ? motionIndex : undefined).trim() : null;
  const motionFromPrompt = motionIndex >= 0 ? prompt.slice(motionIndex).match(/(\d{1,2})\s*\/\s*10/) : null;
  const dialogue = Array.isArray(raw.dialogue)
    ? (raw.dialogue as Array<Record<string, unknown>>)
        .map((line) => ({
          start: num(line.start) ?? 0,
          end: num(line.end) ?? 0,
          speaker: str(line.speaker) ?? "",
          language: str(line.language) ?? "",
          text: str(line.text) ?? "",
        }))
        .filter((line) => line.text)
    : [];
  const motion = num(raw.motion_intensity) ?? (motionFromPrompt ? Number(motionFromPrompt[1]) : null);
  return {
    duration: num(raw.duration) ?? (ranges.length ? ranges[ranges.length - 1].end : null),
    aspect_ratio: str(raw.aspect_ratio),
    resolution: str(raw.resolution),
    fps: num(raw.fps),
    negative_prompt: str(raw.negative_prompt) ?? negativeFromPrompt,
    motion_intensity: motion !== null ? Math.max(1, Math.min(10, motion)) : null,
    shots: shots.length > 0 ? shots : ranges.map(({ start, end }) => ({ start, end })),
    dialogue,
  };
}

/**
 * 장면 하나만 생성할 때 쓸 프롬프트. 스타일·캐릭터·배경·네거티브·모션 구역은
 * 그대로 두고 메인 프롬프트는 해당 장면 블록만 남깁니다(시간은 00:00부터 다시).
 */
export function buildShotPrompt(prompt: string, shotIndex: number): string | null {
  const ranges = parseShotRanges(prompt);
  const shot = ranges[shotIndex];
  if (!shot) return null;
  const upper = prompt.toUpperCase();
  const mainStart = upper.indexOf("[MAIN PROMPT]");
  const negStart = upper.indexOf("[NEGATIVE PROMPT]");
  if (mainStart < 0) return null;
  const length = Math.max(0.1, shot.end - shot.start);
  const fmt = (value: number) => `00:${String(Math.floor(value)).padStart(2, "0")}${value % 1 ? `.${Math.round((value % 1) * 10)}` : ""}`;
  const block = shot.block.replace(/^\[[^\]]+\]/, `[00:00-${fmt(length)}]`);
  return `${prompt.slice(0, mainStart)}[MAIN PROMPT]\n1 shot, ${Math.round(length * 10) / 10}s (shot ${shotIndex + 1} of ${ranges.length} from the reference)\n${block}\n\n${negStart > mainStart ? prompt.slice(negStart) : ""}`.trim();
}

/* 마스터 프롬프트가 반드시 갖춰야 하는 구역(순서대로). */
export const MASTER_SECTIONS = [
  { header: "[VIDEO STYLE]", label: "동영상 스타일" },
  { header: "[CHARACTER STYLE]", label: "캐릭터 스타일" },
  { header: "[BACKGROUND]", label: "배경" },
  { header: "[MAIN PROMPT]", label: "메인 프롬프트" },
  { header: "[NEGATIVE PROMPT]", label: "네거티브 프롬프트" },
  { header: "[MOTION INTENSITY]", label: "모션 강도" },
] as const;

export interface MasterPromptCheck {
  missing: string[];
  outOfOrder: boolean;
  /** 메인 프롬프트에 [00:00-00:03] 같은 초 단위 구간이 있는지. */
  hasTimestamps: boolean;
  /** 초 단위 구간마다 Camera:/Action: 이 있는지. */
  shotsComplete: boolean;
  ok: boolean;
}

/** 생성된 마스터 프롬프트가 필수 구조를 지켰는지 확인합니다. */
export function checkMasterPrompt(prompt: string): MasterPromptCheck {
  const upper = prompt.toUpperCase();
  const positions = MASTER_SECTIONS.map((section) => upper.indexOf(section.header));
  const missing = MASTER_SECTIONS.filter((_, index) => positions[index] < 0).map((section) => section.label);
  const found = positions.filter((position) => position >= 0);
  const outOfOrder = found.some((position, index) => index > 0 && position < found[index - 1]);
  const mainStart = positions[3];
  const mainEnd = positions[4] > mainStart ? positions[4] : prompt.length;
  const main = mainStart >= 0 ? prompt.slice(mainStart, mainEnd) : "";
  const blocks = main.split(/(?=\[\d{1,2}:\d{2}(?:\.\d+)?\s*[-–~]\s*\d{1,2}:\d{2}(?:\.\d+)?\])/).slice(1);
  const hasTimestamps = blocks.length > 0;
  const shotsComplete = hasTimestamps && blocks.every((block) => /camera\s*:/i.test(block) && /action\s*:/i.test(block));
  return {
    missing,
    outOfOrder,
    hasTimestamps,
    shotsComplete,
    ok: missing.length === 0 && !outOfOrder && hasTimestamps && shotsComplete,
  };
}

/** 응답에서 복사할 프롬프트(첫 번째 코드 블록)를 꺼냅니다. 없으면 전체 텍스트. */
export function extractMasterPrompt(text: string): string {
  const match = text.match(/```(?:text|txt)\s*\n([\s\S]*?)```/) ?? text.match(/```(?!json)[a-z]*\s*\n([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

/** 브라우저에서 동영상 길이·해상도를 읽습니다. */
export async function readVideoMeta(url: string, name: string): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const done = () =>
      resolve({
        name,
        durationSec: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    const timer = setTimeout(done, 10000);
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      done();
    };
    video.onerror = () => {
      clearTimeout(timer);
      resolve({ name, durationSec: null, width: null, height: null });
    };
    video.src = url;
  });
}

/** /api/chat 스트리밍 응답을 읽어 누적 텍스트를 콜백으로 넘깁니다. */
export async function streamChat(body: Record<string, unknown>, onText: (text: string) => void): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || "모델 요청에 실패했습니다.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return text;
      try {
        const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          text += delta;
          onText(text);
        }
      } catch {
        // 잘린 JSON 조각은 무시합니다.
      }
    }
  }
  return text;
}
