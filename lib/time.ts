/*
 * 시각 표시 도우미. 서버는 모든 시각을 UTC 로 저장합니다(SQLite datetime('now')
 * 와 R2 기록 모두 "YYYY-MM-DD HH:MM:SS" UTC). 화면에는 대한민국 시각(KST, UTC+9)
 * 으로 바꿔 보여 주고, 날짜별 묶음도 KST 날짜 기준으로 나눕니다.
 */

export const APP_TIME_ZONE = "Asia/Seoul";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** "YYYY-MM-DD HH:MM:SS"(시간대 없음 = UTC) 또는 ISO 문자열을 Date 로 읽습니다. */
export function parseUtc(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const text = value.trim();
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text);
  return new Date(hasZone ? text : `${text.replace(" ", "T")}Z`);
}

/** 서버 저장 형식을 ISO(UTC, Z 포함)로 바꿉니다. API 응답에 씁니다. */
export function toIsoUtc(value: string): string {
  const date = parseUtc(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** KST 기준 날짜 키 "YYYY-MM-DD". */
export function kstDateKey(value: string | number | Date): string {
  const date = parseUtc(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 예: "2026. 9. 29. 오후 4:39:40" */
export function formatKst(value: string | number | Date, options: Intl.DateTimeFormatOptions = {}): string {
  const date = parseUtc(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const hasFields = Object.keys(options).length > 0;
  return date.toLocaleString("ko-KR", {
    timeZone: APP_TIME_ZONE,
    ...(hasFields ? options : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  });
}
