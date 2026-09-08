/*
 * NanoGPT 호스팅 공급자 클라이언트.
 *
 * 근거: NanoGPT 공식 API 문서(docs.nano-gpt.com, 2026-09 확인).
 * - 베이스 URL: https://nano-gpt.com/api
 * - 인증: Authorization: Bearer <API_KEY> (일부 카탈로그 라우트는 x-api-key도
 *   허용하므로 두 헤더를 함께 보냅니다.)
 * - 채팅은 OpenAI 호환(/v1/chat/completions), 이미지는 정규화된 Image API
 *   (/v1/images, input_references), 영상은 비동기 큐(/generate-video +
 *   /video/status), TTS는 동기(/v1/speech)입니다.
 */

export const NANOGPT_BASE_URL = "https://nano-gpt.com/api";

export class NanoGptError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "NanoGptError";
    this.status = status;
  }
}

export function requireNanoGptKey(): string {
  const key = process.env.NANOGPT_API_KEY;
  if (!key) {
    throw new NanoGptError(
      "NANOGPT_API_KEY 환경 변수가 설정되지 않았습니다. NanoGPT 계정에서 API 키를 발급받아 서버 환경 변수에 추가해 주세요.",
      503,
    );
  }
  return key;
}

export async function nanoFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<Response> {
  const key = requireNanoGptKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${NANOGPT_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "x-api-key": key,
        ...init.headers,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFromBody(body: unknown): string | null {
  if (typeof body === "string" && body.trim()) return body.slice(0, 500);
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const direct = record.message ?? record.detail;
    if (typeof direct === "string" && direct) return direct.slice(0, 500);
    const error = record.error;
    if (typeof error === "string" && error) return error.slice(0, 500);
    if (error && typeof error === "object") {
      const nested = (error as Record<string, unknown>).message;
      if (typeof nested === "string" && nested) return nested.slice(0, 500);
    }
  }
  return null;
}

export function politeNanoGptError(
  response: Response,
  body: unknown,
  fallback = "NanoGPT API 요청에 실패했습니다.",
): NanoGptError {
  return new NanoGptError(messageFromBody(body) ?? fallback, response.status);
}

/*
 * 모델 카탈로그. 텍스트 모델만 /v1/models 이고, 이미지·영상·오디오는 각각
 * 전용 카탈로그 라우트를 씁니다(공식 문서: "for image, video, audio, and
 * embedding catalogs, use the dedicated model catalog endpoints").
 * detailed=true 를 붙여야 capabilities / supported_parameters /
 * input_reference_constraints 같은 첨부 제한 정보가 함께 내려옵니다.
 */
export type CatalogType = "text" | "image" | "video" | "tts";

const CATALOG_PATHS: Record<CatalogType, string> = {
  text: "/v1/models?detailed=true",
  image: "/v1/image-models?detailed=true",
  video: "/v1/video-models?detailed=true",
  tts: "/v1/audio-models?type=tts&detailed=true",
};

function collectModelArray(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["data", "models", "results", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  // { "model-id": { ... } } 형태의 맵으로 내려오는 라우트도 있어 값 배열로 폅니다.
  for (const key of ["data", "models"]) {
    const value = record[key];
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>).map(([id, entry]) =>
        entry && typeof entry === "object" ? { id, ...(entry as Record<string, unknown>) } : { id },
      );
    }
  }
  return null;
}

export async function fetchNanoGptModels(type: CatalogType): Promise<unknown[]> {
  const response = await nanoFetch(CATALOG_PATHS[type], {}, 30000);
  const body = await readJson(response);
  if (!response.ok) {
    throw politeNanoGptError(response, body, "NanoGPT 모델 목록을 불러오지 못했습니다.");
  }
  const models = collectModelArray(body);
  if (!models) {
    throw new NanoGptError("NanoGPT 모델 목록 응답 형식을 인식하지 못했습니다.");
  }
  return models;
}

/** OpenAI 호환 채팅 완성(스트리밍). */
export async function proxyChatCompletion(payload: Record<string, unknown>): Promise<Response> {
  return nanoFetch("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 300000);
}

/** 정규화된 Image API. 참조 이미지는 input_references 로 보냅니다. */
export async function generateImage(payload: Record<string, unknown>): Promise<Response> {
  return nanoFetch("/v1/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 180000);
}

/** 비동기 영상 생성 요청. 응답의 runId 를 상태 조회에 사용합니다. */
export async function queueVideo(payload: Record<string, unknown>): Promise<Response> {
  return nanoFetch("/generate-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 60000);
}

/** 영상 작업 상태 조회. status 가 COMPLETED/FAILED 가 될 때까지 폴링합니다. */
export async function retrieveVideo(runId: string): Promise<Response> {
  return nanoFetch(`/video/status?requestId=${encodeURIComponent(runId)}`, {}, 60000);
}

/** 동기 TTS. 오디오 바이너리를 그대로 돌려줍니다. */
export async function generateSpeech(payload: Record<string, unknown>): Promise<Response> {
  return nanoFetch("/v1/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 120000);
}

/*
 * 이미지·영상 생성 화면은 선택한 모델이 supported_parameters로 공개한 값만
 * 그대로 NanoGPT에 전달합니다(비율·품질·스타일·길이 등, lib/models.ts의
 * ExtraParam). 클라이언트가 보내는 키·값이 요청 본문에 그대로 섞여 들어가므로,
 * model/prompt/첨부 관련 필드처럼 이 라우트가 이미 직접 채우는 예약 키는
 * 클라이언트 값으로 덮어쓰지 못하게 막고, 키 형식과 값 타입도 검증합니다.
 */
const PARAM_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

/*
 * 알려진 위험 파라미터의 절대 상한. 선택한 모델이 실제로 허용하는 정확한
 * 범위(예: Kling은 duration 5~10초)까지 서버에서 재검증하려면 매 생성
 * 요청마다 그 모델의 카탈로그 항목을 다시 조회해야 하는데, 그 비용(지연·
 * NanoGPT 요청 횟수 증가)이 크다고 판단해 이번 작업에서는 하지 않았습니다.
 * 대신 어느 모델에도 통하지 않는 명백히 비정상적인 값(예: duration=99999)만
 * 여기서 막고, 나머지 정확한 범위 검증은 NanoGPT 응답(4xx) 에 맡깁니다.
 * → PR 설명의 "남은 위험 요소"에 이 한계를 명시했습니다.
 */
const NUMERIC_PARAM_BOUNDS: Record<string, { min: number; max: number }> = {
  duration: { min: 0, max: 300 },
  seconds: { min: 0, max: 300 },
  cfg_scale: { min: 0, max: 100 },
  guidance_scale: { min: 0, max: 100 },
  num_inference_steps: { min: 1, max: 500 },
  strength: { min: 0, max: 1 },
  n: { min: 1, max: 50 },
};

export function sanitizeExtraParams(
  input: unknown,
  reservedKeys: Set<string>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!PARAM_KEY_PATTERN.test(key)) continue;
    if (reservedKeys.has(key.toLowerCase())) continue;
    if (typeof value === "string" && value.length > 0 && value.length <= 500) {
      result[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      const bounds = NUMERIC_PARAM_BOUNDS[key.toLowerCase()];
      if (bounds && (value < bounds.min || value > bounds.max)) continue;
      result[key] = value;
    } else if (typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}
