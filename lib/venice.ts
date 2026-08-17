export const VENICE_BASE_URL = "https://api.venice.ai/api/v1";

export class VeniceError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "VeniceError";
    this.status = status;
  }
}

export function requireVeniceKey(): string {
  const key = process.env.VENICE_API_KEY;
  if (!key) {
    throw new VeniceError(
      "VENICE_API_KEY 환경 변수가 설정되지 않았습니다. Venice.ai 계정에서 API 키를 발급받아 서버 환경 변수에 추가해 주세요.",
      503,
    );
  }
  return key;
}

export async function veniceFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<Response> {
  const key = requireVeniceKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${VENICE_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
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

export function politeVeniceError(response: Response, body: unknown, fallback = "Venice.ai API 요청에 실패했습니다."): VeniceError {
  const message = typeof body === "string" && body ? body.slice(0, 500) : fallback;
  return new VeniceError(message, response.status);
}

export async function fetchVeniceModels(type: string): Promise<unknown[]> {
  const response = await veniceFetch(`/models?type=${encodeURIComponent(type)}`, {}, 20000);
  const body = await readJson(response);
  if (!response.ok) {
    throw politeVeniceError(response, body, "Venice.ai 모델 목록을 불러오지 못했습니다.");
  }
  if (body && typeof body === "object" && Array.isArray((body as { data?: unknown[] }).data)) {
    return (body as { data: unknown[] }).data;
  }
  throw new VeniceError("Venice.ai 모델 목록 응답 형식을 인식하지 못했습니다.");
}

export async function proxyChatCompletion(payload: Record<string, unknown>): Promise<Response> {
  return veniceFetch("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 300000);
}

export async function generateImage(payload: Record<string, unknown>): Promise<Response> {
  return veniceFetch("/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 180000);
}

export async function queueVideo(payload: Record<string, unknown>): Promise<Response> {
  return veniceFetch("/video/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 60000);
}

export async function retrieveVideo(queueId: string, model: string): Promise<Response> {
  return veniceFetch("/video/retrieve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queue_id: queueId, model }),
  }, 60000);
}

export async function quoteVideo(payload: Record<string, unknown>): Promise<Response> {
  return veniceFetch("/video/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 60000);
}

export async function generateSpeech(payload: Record<string, unknown>): Promise<Response> {
  return veniceFetch("/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 120000);
}