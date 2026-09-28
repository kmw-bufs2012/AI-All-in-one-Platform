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
  Audio: dialogue in quotes with speaker ID, sound effects, ambience, music genre/tempo. If silent, write "ambient sound only".
  Transition: cut / match cut / fade / continuous to the next shot.
- Use concrete, observable, positive visual language inside [MAIN PROMPT] (describe what to show). Put everything that must NOT appear in [NEGATIVE PROMPT] instead.

[NEGATIVE PROMPT]
- One comma-separated line of things to avoid, always including artifacts relevant to this video (e.g. character appearance drift, face morphing, outfit change, extra fingers, distorted hands, flicker, jitter, warped background, text or watermark, blurry frames) plus anything specific to the reference.

[MOTION INTENSITY]
- One line: "level: low | medium | high, value: N/10" followed by a short reason based on how much the subjects and camera move in the reference. Use one value for the whole video, then per-shot values if they differ, e.g. "[00:00-00:03] 3/10, [00:03-00:08] 7/10".

General rules:
- Maximum ${SEEDANCE_MAX_SECONDS} seconds per generation. If the reference is longer, cover the first ${SEEDANCE_MAX_SECONDS} seconds and say so in the notes.
- Do not invent things you cannot see. If something is unclear, choose the most likely option.
- Resolution, duration and aspect ratio values are set in the generation UI; include them only in the first line of [MAIN PROMPT].

Output format (exactly):
1. The whole master prompt (all six sections) in English inside a single \`\`\`text code block.
2. After the code block, a short section in Korean titled "설정 참고" listing the recommended UI settings (duration, aspect ratio, resolution, the negative prompt and motion intensity fields if the generation UI has them) and anything that could not be reproduced.`;

/** 비전(LMM) 모델에 직접 동영상을 보여 주고 마스터 프롬프트를 받을 때. */
export function buildDirectPrompt(meta: VideoMeta, userNote: string): string {
  return `${MASTER_RULES}

Reference video metadata:
${metaLines(meta)}
${userNote.trim() ? `\nExtra instructions from the user:\n${userNote.trim()}\n` : ""}
The attached video (or its frames in time order) is the reference.`;
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
  const match = text.match(/```(?:text|txt)?\s*\n([\s\S]*?)```/);
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
