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

Seedance 2.0 Mini rules:
- Maximum ${SEEDANCE_MAX_SECONDS} seconds per generation. If the reference is longer, cover the first ${SEEDANCE_MAX_SECONDS} seconds and say so in the notes.
- First line: number of shots, total duration, aspect ratio (e.g. "3 shots, 10s, 16:9").
- Lead with the main subject: exact appearance (age range, build, hair, clothing, colors, materials, props).
- Then the setting: location, time of day, weather, background elements, color palette.
- Then a timestamped shot list, one line per shot: [00:00-00:03] shot size, camera angle, lens feel, camera movement (dolly in, pan left, orbit, handheld, static...), exact subject action and expression, transitions.
- Lighting and look: light direction and quality, contrast, film/grade style, frame rate feel, motion speed.
- Audio: dialogue lines in quotes with speaker, sound effects, ambience, music genre/tempo. If silent, write "no dialogue, ambient sound only" style positive phrasing.
- Use concrete, observable visual language. Phrase everything positively (describe what to show, never "no X" / "avoid X").
- Do not invent things you cannot see. If something is unclear, choose the most likely option.
- Resolution, duration and aspect ratio values are set in the generation UI; include them only in the first line.

Output format (exactly):
1. The master prompt in English inside a single \`\`\`text code block.
2. After the code block, a short section in Korean titled "설정 참고" listing the recommended UI settings (duration, aspect ratio, resolution) and anything that could not be reproduced.`;

/** 비전(LMM) 모델에 직접 동영상을 보여 주고 마스터 프롬프트를 받을 때. */
export function buildDirectPrompt(meta: VideoMeta, userNote: string): string {
  return `${MASTER_RULES}

Reference video metadata:
${metaLines(meta)}
${userNote.trim() ? `\nExtra instructions from the user:\n${userNote.trim()}\n` : ""}
The attached video (or its frames in time order) is the reference.`;
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
