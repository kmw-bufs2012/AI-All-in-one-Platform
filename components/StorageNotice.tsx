"use client";

import { useEffect, useState } from "react";

/*
 * 이 페이지의 데이터가 실제로 어디에 저장되는지 서버 상태(/api/storage/status)에
 * 맞춰 보여 줍니다. R2 가 켜져 있으면 Cloudflare R2, 꺼져 있으면 서버 임시
 * 저장소(재시작 시 초기화될 수 있음), 오류면 오류 내용을 안내합니다.
 */
type Status = { enabled: boolean; ok: boolean; detail: string } | null;

let cached: Promise<Status> | null = null;
function loadStatus(): Promise<Status> {
  cached ??= fetch("/api/storage/status", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return cached;
}

export function StorageNotice({ what, extra }: { what: string; extra?: string }) {
  const [status, setStatus] = useState<Status | undefined>(undefined);

  useEffect(() => {
    loadStatus().then(setStatus);
  }, []);

  if (status === undefined) return null;
  let tone: "ok" | "warn" | "error";
  let text: string;
  if (status?.enabled && status.ok) {
    tone = "ok";
    text = `${what}은(는) Cloudflare R2에 저장되어 서버가 재시작되거나 다른 기기에서 접속해도 유지됩니다.`;
  } else if (status?.enabled) {
    tone = "error";
    text = `Cloudflare R2 연결에 문제가 있어 ${what}이(가) 저장되지 않을 수 있습니다: ${status.detail}`;
  } else {
    tone = "warn";
    text = `Cloudflare R2가 설정되지 않아 ${what}은(는) 서버 임시 저장소에 저장됩니다. 서버가 재시작되면 초기화될 수 있습니다.`;
  }
  return (
    <div className={`storage-notice ${tone}`} role="status">
      <span className="storage-notice-dot" aria-hidden />
      <span>
        {text}
        {extra ? ` ${extra}` : ""}
      </span>
    </div>
  );
}
