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
  status: string;
  result: JobResult | null;
  createdAt: string;
}

const MODE_LABELS: Record<string, string> = { chat: "채팅", image: "이미지", video: "영상", audio: "음성" };

function formatCostValue(cost: number, currency: string | null): string {
  return `${currency ?? "USD"} ${cost < 0.01 ? cost.toFixed(6) : cost.toFixed(4)}`;
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
                {job.cost !== null ? ` · 비용: ${formatCostValue(job.cost, job.currency)}` : " · 비용: 정보 없음"}
              </div>
            ) : (
              <div className="cost-line">
                {job.cost !== null ? `비용: ${formatCostValue(job.cost, job.currency)}` : "비용 정보 없음"}
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
