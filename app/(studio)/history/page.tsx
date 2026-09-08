"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbox } from "@/components/studio-ui";

interface JobAttachment {
  id: string;
  kind: string;
  name: string;
  url: string;
}

interface JobResult {
  kind?: string;
  text?: string;
  urls?: string[];
}

interface Job {
  id: number;
  mode: string;
  model: string | null;
  prompt: string | null;
  attachments: JobAttachment[] | null;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; estimated?: boolean } | null;
  unitPrice: unknown;
  cost: number | null;
  currency: string | null;
  /** "actual"(NanoGPT가 실제로 청구한 금액) | "estimated"(모델 카탈로그 단가로 계산한 추정치). */
  costSource: string | null;
  status: string;
  result: JobResult | null;
  createdAt: string;
}

const MODE_LABELS: Record<string, string> = { chat: "채팅", image: "이미지", video: "영상", audio: "음성" };

function formatCostValue(cost: number, currency: string | null): string {
  return `${currency ?? "USD"} ${cost < 0.01 ? cost.toFixed(6) : cost.toFixed(4)}`;
}

/*
 * 결과물 단가 총 합계. NanoGPT가 실제로 청구한 금액(costSource === "actual")이
 * 있는 작업은 그대로 더하고, 없는 작업은 카탈로그 단가 기반 추정치로 더합니다.
 * 통화가 여러 개 섞일 가능성은 낮지만(NanoGPT는 USD 단일 통화), 방어적으로
 * 통화별로 따로 합산합니다.
 */
function summarizeCosts(jobs: Job[]): {
  totals: Array<{ currency: string; actual: number; estimated: number; hasEstimate: boolean }>;
  countedJobs: number;
  uncountedJobs: number;
} {
  const byCurrency = new Map<string, { actual: number; estimated: number; hasEstimate: boolean }>();
  let countedJobs = 0;
  let uncountedJobs = 0;
  for (const job of jobs) {
    if (job.cost === null) {
      uncountedJobs += 1;
      continue;
    }
    countedJobs += 1;
    const currency = job.currency ?? "USD";
    const entry = byCurrency.get(currency) ?? { actual: 0, estimated: 0, hasEstimate: false };
    if (job.costSource === "actual") {
      entry.actual += job.cost;
    } else {
      entry.estimated += job.cost;
      entry.hasEstimate = true;
    }
    byCurrency.set(currency, entry);
  }
  const totals = Array.from(byCurrency.entries()).map(([currency, value]) => ({ currency, ...value }));
  return { totals, countedJobs, uncountedJobs };
}

export default function HistoryPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mode, setMode] = useState("");
  const [date, setDate] = useState("");
  const [model, setModel] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (mode) params.set("mode", mode);
    if (date) params.set("date", date);
    if (model) params.set("model", model);
    try {
      const response = await fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "작업 기록을 불러오지 못했습니다.");
      const list: Job[] = Array.isArray(body.jobs) ? body.jobs : [];
      setJobs(list);
      if (!model) {
        setModelOptions(Array.from(new Set(list.map((job) => job.model ?? "").filter(Boolean))).sort());
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "작업 기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [mode, date, model]);

  useEffect(() => {
    loadJobs();
    // 최초 진입 시 한 번만 자동으로 조회하고, 이후에는 조회 버튼으로 갱신합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page-pad">
      <div className="page-head">
        <h1>작업 기록</h1>
        <p>수행한 작업의 모델·프롬프트·사용량·비용이 남습니다. 결과물만 보려면 라이브러리를 이용하세요.</p>
      </div>

      <div className="filters">
        <div className="field">
          <label htmlFor="filter-mode">모드</label>
          <select id="filter-mode" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="">전체</option>
            <option value="chat">채팅</option>
            <option value="image">이미지</option>
            <option value="video">영상</option>
            <option value="audio">음성</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-date">날짜</label>
          <input id="filter-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="filter-model">모델</label>
          <select id="filter-model" value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="">전체</option>
            {modelOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <button onClick={loadJobs} disabled={loading}>
          조회
        </button>
      </div>

      {error ? <div className="error-box" style={{ marginBottom: 12 }}>{error}</div> : null}
      {loading ? (
        <div className="progress-note">
          <span className="spinner" /> 작업 기록을 불러오고 있습니다…
        </div>
      ) : null}
      {!loading && jobs.length === 0 ? <div className="empty-note">조회된 작업 기록이 없습니다.</div> : null}
      {!loading && jobs.length > 0 ? <CostSummary jobs={jobs} /> : null}

      <div className="job-list">
        {jobs.map((job) => (
          <div key={job.id} className="job-card">
            <div className="job-meta">
              <span className="mode-badge">{MODE_LABELS[job.mode] ?? job.mode}</span>
              <span>{job.model ?? "모델 정보 없음"}</span>
              <span>{job.createdAt.replace("T", " ").slice(0, 19)}</span>
              <span className={`status-badge ${job.status === "completed" ? "completed" : "failed"}`}>
                {job.status === "completed" ? "완료" : "실패"}
              </span>
            </div>
            {job.prompt ? <div className="job-prompt">{job.prompt}</div> : null}
            {job.attachments && job.attachments.length > 0 ? (
              <div className="muted">
                첨부:{" "}
                {job.attachments
                  .map(
                    (item) =>
                      `${item.kind === "image" ? "이미지" : item.kind === "video" ? "동영상" : "문서"}(${item.name})`,
                  )
                  .join(", ")}
              </div>
            ) : null}
            {job.usage ? (
              <div className="cost-line">
                사용량: 입력 {job.usage.promptTokens ?? 0} · 출력 {job.usage.completionTokens ?? 0} · 합계{" "}
                {job.usage.totalTokens ?? 0} 토큰{job.usage.estimated ? " (추정)" : ""}
                {job.cost !== null
                  ? ` · 비용: ${formatCostValue(job.cost, job.currency)}${job.costSource === "actual" ? "" : " (추정)"}`
                  : " · 비용: 정보 없음"}
              </div>
            ) : (
              <div className="cost-line">
                {job.cost !== null
                  ? `비용: ${formatCostValue(job.cost, job.currency)}${job.costSource === "actual" ? "" : " (추정)"}`
                  : "비용 정보 없음"}
              </div>
            )}
            {job.result ? (
              <div className="job-result">
                {job.result.kind === "text" && job.result.text ? (
                  <div className="job-prompt" style={{ maxHeight: 160 }}>
                    {job.result.text}
                  </div>
                ) : null}
                {job.result.kind === "images" && job.result.urls
                  ? job.result.urls.map((url, index) => (
                      <img key={`${url}-${index}`} src={url} alt={`결과 ${index + 1}`} onClick={() => setLightbox(url)} />
                    ))
                  : null}
                {job.result.kind === "video" && job.result.urls ? (
                  <video src={job.result.urls[0]} controls preload="metadata" />
                ) : null}
                {job.result.kind === "audio" && job.result.urls ? (
                  <audio src={job.result.urls[0]} controls preload="metadata" />
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function CostSummary({ jobs }: { jobs: Job[] }) {
  const { totals, countedJobs, uncountedJobs } = summarizeCosts(jobs);
  if (totals.length === 0) {
    return (
      <div className="cost-summary">
        <span className="cost-summary-label">현재 조회된 {jobs.length}건에는 비용 정보가 없습니다.</span>
      </div>
    );
  }
  return (
    <div className="cost-summary">
      <span className="cost-summary-label">결과물 단가 총 합계 ({countedJobs}건 반영)</span>
      <div className="cost-summary-values">
        {totals.map(({ currency, actual, estimated, hasEstimate }) => {
          const total = actual + estimated;
          return (
            <span key={currency} className="cost-summary-value">
              {formatCostValue(total, currency)}
              {hasEstimate ? (
                actual > 0 ? (
                  <span className="cost-summary-note"> (실제 청구 {formatCostValue(actual, currency)} + 추정 {formatCostValue(estimated, currency)})</span>
                ) : (
                  <span className="cost-summary-note"> (전액 추정치)</span>
                )
              ) : null}
            </span>
          );
        })}
      </div>
      {uncountedJobs > 0 ? (
        <span className="cost-summary-note">비용 정보가 없는 {uncountedJobs}건은 합계에서 제외했습니다.</span>
      ) : null}
    </div>
  );
}
