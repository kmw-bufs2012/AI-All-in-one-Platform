"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { EmptyState, Lightbox } from "@/components/studio-ui";

type AssetKind = "image" | "video" | "audio";
type Filter = "all" | AssetKind;

interface Asset {
  id: string;
  jobId: number;
  kind: AssetKind;
  url: string;
  model: string | null;
  prompt: string;
  createdAt: string;
}

interface JobRecord {
  id: number;
  mode: string;
  model: string | null;
  prompt: string | null;
  status: string;
  result: { kind?: string; urls?: string[] } | null;
  createdAt: string;
}

const FILTERS: Array<{ value: Filter; label: string; icon: IconName }> = [
  { value: "all", label: "전체", icon: "grid" },
  { value: "image", label: "이미지", icon: "image" },
  { value: "video", label: "영상", icon: "video" },
  { value: "audio", label: "음성", icon: "audio" },
];

const KIND_LABEL: Record<AssetKind, string> = { image: "이미지", video: "영상", audio: "음성" };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-08-17T09:30:00" → "2026년 8월 17일 (월)" */
function formatDateGroup(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  if (Number.isNaN(date.getTime())) return key;
  return `${year}년 ${month}월 ${day}일 (${WEEKDAYS[date.getDay()]})`;
}

/** 작업 기록을 자산 단위로 펼칩니다. 완료되었고 결과 URL이 있는 것만 남깁니다. */
function toAssets(jobs: JobRecord[]): Asset[] {
  const assets: Asset[] = [];
  for (const job of jobs) {
    if (job.status !== "completed") continue;
    const kind = job.mode === "image" ? "image" : job.mode === "video" ? "video" : job.mode === "audio" ? "audio" : null;
    if (!kind) continue;
    const urls = job.result?.urls ?? [];
    urls.forEach((url, index) => {
      if (typeof url !== "string" || !url) return;
      assets.push({
        id: `${job.id}-${index}`,
        jobId: job.id,
        kind,
        url,
        model: job.model,
        prompt: job.prompt ?? "",
        createdAt: job.createdAt,
      });
    });
  }
  return assets;
}

export default function LibraryPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "라이브러리를 불러오지 못했습니다.");
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "라이브러리를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const assets = useMemo(() => toAssets(jobs), [jobs]);
  const counts = useMemo(() => {
    const base: Record<Filter, number> = { all: assets.length, image: 0, video: 0, audio: 0 };
    for (const asset of assets) base[asset.kind] += 1;
    return base;
  }, [assets]);

  const groups = useMemo(() => {
    const filtered = filter === "all" ? assets : assets.filter((asset) => asset.kind === filter);
    const map = new Map<string, Asset[]>();
    for (const asset of filtered) {
      const key = asset.createdAt.slice(0, 10);
      const list = map.get(key);
      if (list) list.push(asset);
      else map.set(key, [asset]);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [assets, filter]);

  return (
    <div className="page-pad">
      <div className="page-head">
        <h1>라이브러리</h1>
        <p>생성한 이미지·영상·음성이 만든 날짜별로 모입니다. 사용량과 비용은 작업 기록에서 확인하세요.</p>
      </div>

      <div className="lib-bar">
        <div className="seg" role="group" aria-label="자산 종류 필터">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={filter === item.value ? "on" : ""}
              onClick={() => setFilter(item.value)}
              aria-pressed={filter === item.value}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
              <span className="lib-count">{counts[item.value]}</span>
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto" }} />
        <button type="button" className="secondary" onClick={load} disabled={loading} title="새로 고침">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Icon name="refresh" size={15} />
            새로 고침
          </span>
        </button>
      </div>

      {error ? <div className="error-box" style={{ marginBottom: 16 }}>{error}</div> : null}

      {loading ? (
        <div className="progress-note">
          <span className="spinner" /> 라이브러리를 불러오고 있습니다…
        </div>
      ) : null}

      {!loading && groups.length === 0 ? (
        <EmptyState
          icon="library"
          title={assets.length === 0 ? "아직 모인 자산이 없습니다" : "이 종류의 자산이 없습니다"}
          body={
            assets.length === 0
              ? "이미지·영상·음성을 만들면 여기에 자동으로 쌓입니다. 무엇이든 하나 만들어 보세요."
              : "다른 종류를 골라 보거나 새로 만들어 보세요."
          }
        >
          <Link href="/create/image" className="topbar-link">
            <Icon name="image" size={15} />
            이미지 만들기
          </Link>
          <Link href="/create/video" className="topbar-link">
            <Icon name="video" size={15} />
            영상 만들기
          </Link>
          <Link href="/create/audio" className="topbar-link">
            <Icon name="audio" size={15} />
            음성 만들기
          </Link>
        </EmptyState>
      ) : null}

      {groups.map(([dateKey, items]) => (
        <section className="lib-group" key={dateKey}>
          <h2 className="lib-date">
            {formatDateGroup(dateKey)}
            <span className="lib-count">{items.length}</span>
          </h2>
          <div className="result-grid">
            {items.map((asset) => {
              if (asset.kind === "audio") {
                return (
                  <div key={asset.id} className="asset-tile audio-tile" title={asset.prompt}>
                    <span className="asset-badge" style={{ alignSelf: "flex-start" }}>
                      {KIND_LABEL.audio}
                    </span>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "var(--text-dim)",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {asset.prompt || "내용 없음"}
                    </div>
                    <audio src={asset.url} controls preload="metadata" style={{ width: "100%" }} />
                  </div>
                );
              }
              if (asset.kind === "video") {
                return (
                  <div key={asset.id} className="asset-tile video-tile" title={asset.prompt}>
                    <video src={asset.url} controls preload="metadata" />
                    <div className="asset-overlay">
                      <span className="asset-badge">{KIND_LABEL.video}</span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={asset.id} className="asset-tile" title={asset.prompt} onClick={() => setLightbox(asset.url)}>
                  <img src={asset.url} alt={asset.prompt || "생성 이미지"} loading="lazy" />
                  <div className="asset-overlay">
                    <span className="asset-badge">{KIND_LABEL.image}</span>
                    <a
                      className="asset-action"
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      title="새 창에서 열기"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Icon name="expand" size={14} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
