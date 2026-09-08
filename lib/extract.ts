const IMAGE_KEYS = ["images", "image", "data", "b64_json", "base64", "url"];
const WRAPPER_KEYS = ["data", "result", "output", "generation", "usage", "pricing"];
const ID_KEYS = ["queue_id", "id", "request_id", "task_id", "job_id", "generation_id", "video_id", "uuid"];
/* NanoGPT 영상 생성은 runId 를 돌려주고 그 값으로 /video/status 를 폴링합니다. */
const RUN_ID_KEYS = ["runId", "run_id", "requestId", "request_id", "queue_id", "id", "task_id", "job_id"];
/* 결과 영상 URL. 모델·제공자에 따라 키 이름이 달라 영상 전용 키를 먼저 봅니다. */
const VIDEO_URL_KEYS = ["videoUrl", "video_url", "outputUrl", "output_url", "resultUrl", "result_url"];
const GENERIC_URL_KEYS = ["url", "video", "output", "result"];
const STATUS_KEYS = ["status", "state"];
/*
 * NanoGPT 공식 문서: "Every API response includes a cost field showing what
 * you were charged for that request" — 이미지 생성 응답은 cost_usd, 영상
 * 생성/상태 조회 응답은 cost, 채팅은 스트리밍 마지막 청크의 usage 안에
 * cost/total_cost로 실린다고 알려져 있어 후보 키를 폭넓게 봅니다.
 */
const COST_KEYS = ["estimated_cost", "cost", "cost_usd", "price", "total_cost", "amount", "total"];
const CURRENCY_KEYS = ["currency", "unit", "denomination"];
const FAILURE_PATTERN = /FAIL|ERROR|REJECT|CANCEL|BLOCK|MODERAT|DENIED|ABORT/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(value: unknown, keys: string[]): unknown | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = walk(entry, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  for (const key of keys) {
    if (key in value) return value[key];
  }
  for (const wrapper of WRAPPER_KEYS) {
    if (wrapper in value) {
      const found = walk(value[wrapper], keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function extractImages(body: unknown): string[] {
  const found = walk(body, IMAGE_KEYS);
  const format = typeof found === "object" && found !== null && typeof (found as { format?: unknown }).format === "string"
    ? (found as { format: string }).format
    : "webp";
  const results: string[] = [];
  const collect = (entry: unknown): void => {
    if (typeof entry === "string") {
      if (entry.startsWith("data:") || /^https?:\/\//.test(entry)) {
        results.push(entry);
      } else {
        results.push(`data:image/${format};base64,${entry}`);
      }
      return;
    }
    if (isObject(entry)) {
      const data = entry.b64_json ?? entry.data ?? entry.base64 ?? entry.url;
      if (typeof data === "string") {
        if (data.startsWith("data:") || /^https?:\/\//.test(data)) {
          results.push(data);
        } else {
          results.push(`data:image/${format};base64,${data}`);
        }
      }
    }
  };
  if (Array.isArray(found)) {
    found.forEach(collect);
  } else if (found !== undefined) {
    collect(found);
  }
  return results;
}

export function extractId(body: unknown): string | null {
  const found = walk(body, ID_KEYS);
  return typeof found === "string" && found ? found : null;
}

export function extractRunId(body: unknown): string | null {
  const found = walk(body, RUN_ID_KEYS);
  return typeof found === "string" && found ? found : null;
}

function firstHttpUrl(value: unknown): string | null {
  if (typeof value === "string") return /^https?:\/\//.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstHttpUrl(entry);
      if (found) return found;
    }
    return null;
  }
  if (isObject(value)) {
    for (const key of [...VIDEO_URL_KEYS, ...GENERIC_URL_KEYS]) {
      const found = firstHttpUrl(value[key]);
      if (found) return found;
    }
  }
  return null;
}

export function extractVideoUrl(body: unknown): string | null {
  return firstHttpUrl(walk(body, VIDEO_URL_KEYS))
    ?? firstHttpUrl(walk(body, GENERIC_URL_KEYS));
}

export function extractStatus(body: unknown): string | null {
  const found = walk(body, STATUS_KEYS);
  return typeof found === "string" && found ? found : null;
}

export function extractCost(body: unknown): { amount: number; currency?: string } | undefined {
  const found = walk(body, COST_KEYS);
  if (typeof found === "number" && Number.isFinite(found)) {
    const currency = walk(body, CURRENCY_KEYS);
    return { amount: found, currency: typeof currency === "string" ? currency : undefined };
  }
  return undefined;
}

export function isFailureStatus(status: string): boolean {
  return FAILURE_PATTERN.test(status);
}

export function isVideoResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") || "";
  return contentType.toLowerCase().startsWith("video/");
}

export function readableError(body: unknown): string {
  if (typeof body === "string" && body) return body.slice(0, 500);
  if (isObject(body)) {
    const candidates = ["error", "message", "detail", "error_message"];
    for (const key of candidates) {
      const value = body[key];
      if (typeof value === "string" && value) return value.slice(0, 500);
      if (isObject(value)) {
        const message = value.error ?? value.message;
        if (typeof message === "string" && message) return message.slice(0, 500);
      }
    }
  }
  return "요청 처리에 실패했습니다.";
}