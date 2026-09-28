"use client";

import { useEffect, useState } from "react";

/*
 * 이미지·동영상 생성 진행률 표시.
 *
 * 이미지 API는 결과가 나올 때까지 진행률을 알려 주지 않고, 동영상 API도
 * 모델에 따라 진행률을 주기도 하고 안 주기도 합니다. 그래서
 * - 공급자가 진행률(progress)을 보내 주면 그 값을 그대로 쓰고,
 * - 없으면 경과 시간과 보통 걸리는 시간으로 추정합니다. 추정치는 끝나기 전에
 *   97%를 넘지 않고, 화면에 '예상'이라고 표시합니다.
 */

export interface GenerationJob {
  id: string;
  startedAt: number;
  /** 보통 걸리는 시간(ms). 추정 진행률 계산에 씁니다. */
  expectedMs: number;
  /** 공급자가 알려 준 진행률(0~100). */
  reported: number | null;
  status: string;
  state: "running" | "done" | "failed";
}

export function estimateProgress(job: GenerationJob, now: number): { percent: number; estimated: boolean } {
  if (job.state === "done") return { percent: 100, estimated: false };
  if (job.reported !== null) return { percent: Math.max(1, Math.min(99, Math.round(job.reported))), estimated: false };
  const elapsed = Math.max(0, now - job.startedAt);
  // 보통 걸리는 시간에 90%가 되도록 하는 완만한 곡선(1 - e^(-t/τ)).
  const tau = job.expectedMs / 2.3;
  const percent = Math.min(97, Math.max(1, Math.round((1 - Math.exp(-elapsed / tau)) * 100)));
  return { percent, estimated: true };
}

export function useNow(active: boolean, intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

/** ChatGPT 이미지 생성처럼 흐릿한 빛이 흐르는 자리표시 타일과 진행률. */
export function GenerationTile({ job, now, wide }: { job: GenerationJob; now: number; wide?: boolean }) {
  const { percent, estimated } = estimateProgress(job, now);
  const seconds = Math.floor((now - job.startedAt) / 1000);
  return (
    <div className={`gen-tile${wide ? " wide" : ""}${job.state === "failed" ? " failed" : ""}`} role="status" aria-live="polite">
      <div className="gen-tile-glow" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="gen-tile-info">
        <div className="gen-tile-percent">
          {job.state === "failed" ? "실패" : `${percent}%`}
          {estimated && job.state === "running" ? <small> 예상</small> : null}
        </div>
        <div className="gen-tile-bar">
          <span style={{ width: `${job.state === "failed" ? 100 : percent}%` }} />
        </div>
        <div className="gen-tile-status">
          {job.status}
          {job.state === "running" ? ` · ${seconds}초` : ""}
        </div>
      </div>
    </div>
  );
}
