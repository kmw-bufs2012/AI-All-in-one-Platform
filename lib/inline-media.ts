/*
 * 서버리스(Vercel 등)에서는 업로드한 첨부가 한 인스턴스의 /tmp 에만 있어, 생성
 * 요청이 다른 인스턴스로 가면 파일을 찾지 못합니다. 그래서 브라우저가 7일간
 * 보관하는 사본(lib/attachment-cache.ts)을 data URL 로 함께 보내고, 서버는
 * 디스크에서 못 찾을 때 이 값을 대신 씁니다.
 *
 * Vercel 함수 요청 본문 한도(4.5MB)를 넘지 않도록 클라이언트는
 * INLINE_BUDGET_CHARS 안에서만 data URL 을 싣습니다.
 */

export const INLINE_BUDGET_CHARS = 3_800_000;
const DATA_URL_PATTERN = /^data:(image|video|audio)\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/;

/** 클라이언트가 보낸 data URL 이 허용된 형식(image/·video/ base64)인지 검사합니다. */
export function acceptDataUrl(value: unknown, kind: "image" | "video" | "audio"): string | null {
  if (typeof value !== "string" || value.length > INLINE_BUDGET_CHARS * 1.2) return null;
  if (!value.startsWith(`data:${kind}/`)) return null;
  return DATA_URL_PATTERN.test(value) ? value : null;
}

export const MISSING_ATTACHMENT_MESSAGE =
  "서버 임시 저장소에서 첨부 파일을 찾지 못했고, 이 브라우저의 7일 보관 사본도 없습니다(용량이 커서 함께 보내지 못했거나 다른 기기·브라우저에서 올린 파일). 파일을 다시 첨부해 주세요.";
