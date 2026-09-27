"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStudioState } from "@/components/StudioState";
import { AssetViewer, type ViewerAsset } from "@/components/AssetViewer";
import { uploadFiles, type AttachedFile } from "@/lib/client-api";
import { Icon, type IconName } from "@/components/Icon";
import { EmptyState, formatFileSize } from "@/components/studio-ui";
import {
  MAX_TOTAL_BYTES,
  RETENTION_DAYS,
  cleanupVault,
  daysLeft,
  getVaultBlob,
  listVault,
  removeVaultItems,
  setVaultPinned,
  type VaultItem,
} from "@/lib/local-vault";

type AssetKind = "image" | "video" | "audio";
type Filter = "all" | AssetKind;

interface Asset {
  id: string;
  jobId: number;
  kind: AssetKind;
  url: string;
  /** 원래 파일 주소(보관함 사본으로 바뀌기 전). */
  sourceUrl: string;
  /** 같은 작업에서 나온 결과 개수. 1개면 삭제 시 작업 기록도 지웁니다. */
  siblings: number;
  references: AttachedFile[];
  cost: number | null;
  currency: string | null;
  model: string | null;
  prompt: string;
  createdAt: string;
  /** 이 기기 보관함에 저장된 항목이면 그 정보. */
  vault?: VaultItem;
}

interface JobRecord {
  id: number;
  mode: string;
  model: string | null;
  prompt: string | null;
  status: string;
  attachments: AttachedFile[] | null;
  cost: number | null;
  currency: string | null;
  result: { kind?: string; urls?: string[] } | null;
  createdAt: string;
}

const FILTERS: Array<{ value: Filter; label: string; icon: IconName }> = [
  { value: "all", label: "전체", icon: "grid" },
  { value: "image", label: "이미지", icon: "image" },
  { value: "video", label: "동영상", icon: "video" },
  { value: "audio", label: "음성", icon: "audio" },
];

const KIND_LABEL: Record<AssetKind, string> = { image: "이미지", video: "동영상", audio: "음성" };
const KIND_ORDER: AssetKind[] = ["image", "video", "audio"];

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
        sourceUrl: url,
        siblings: urls.length,
        references: Array.isArray(job.attachments)
          ? job.attachments.filter((item) => item && (item.kind === "image" || item.kind === "video") && typeof item.url === "string")
          : [],
        cost: typeof job.cost === "number" ? job.cost : null,
        currency: job.currency ?? null,
        model: job.model,
        prompt: job.prompt ?? "",
        createdAt: job.createdAt,
      });
    });
  }
  return assets;
}

/* 태그·숨김 기록은 이 브라우저에만 저장합니다(원래 파일 주소 기준). */
const TAGS_KEY = "library:tags";
const HIDDEN_KEY = "library:hidden";

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장소를 쓸 수 없으면 이번 세션에서만 유지됩니다.
  }
}

export default function LibraryPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [tags, setTagsState] = useState<Record<string, string[]>>({});
  const router = useRouter();
  const [, setVideoPrompt] = useStudioState<string>("video:prompt", "");
  const [, setVideoStartImage] = useStudioState<AttachedFile | null>("video:startImage", null);
  const [, setImagePrompt] = useStudioState<string>("image:prompt", "");
  const [, setImageRefs] = useStudioState<AttachedFile[]>("image:refs", []);

  useEffect(() => {
    setHidden(readStore<string[]>(HIDDEN_KEY, []));
    setTagsState(readStore<Record<string, string[]>>(TAGS_KEY, {}));
  }, []);

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

  /*
   * 이 기기 보관함. 서버 파일이 사라져도 보관함의 사본(object URL)으로 표시합니다.
   */
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [vaultUrls, setVaultUrls] = useState<Record<string, string>>({});

  const loadVault = useCallback(async () => {
    try {
      await cleanupVault();
      const items = await listVault();
      const urls: Record<string, string> = {};
      for (const item of items) {
        const blob = await getVaultBlob(item.id);
        if (blob) urls[item.id] = URL.createObjectURL(blob);
      }
      setVaultItems(items);
      setVaultUrls((previous) => {
        Object.values(previous).forEach((url) => URL.revokeObjectURL(url));
        return urls;
      });
    } catch {
      // 사생활 보호 모드 등 IndexedDB 를 쓸 수 없으면 서버 라이브러리만 보여 줍니다.
    }
  }, []);

  useEffect(() => {
    loadVault();
  }, [loadVault]);

  useEffect(() => () => Object.values(vaultUrls).forEach((url) => URL.revokeObjectURL(url)), [vaultUrls]);

  const vaultBytes = vaultItems.reduce((sum, item) => sum + item.size, 0);

  async function togglePin(item: VaultItem) {
    await setVaultPinned(item.id, !item.pinned).catch(() => {});
    setVaultItems((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, pinned: !item.pinned } : entry)));
  }

  async function removeFromVault(item: VaultItem) {
    await removeVaultItems([item.id]).catch(() => {});
    await loadVault();
  }

  async function clearVault() {
    const targets = vaultItems.filter((item) => !item.pinned).map((item) => item.id);
    if (targets.length === 0) return;
    if (!window.confirm(`고정하지 않은 보관 파일 ${targets.length}개를 이 기기에서 지웁니다. 계속할까요?`)) return;
    await removeVaultItems(targets).catch(() => {});
    await loadVault();
  }

  const assets = useMemo(() => {
    const serverAssets = toAssets(jobs);
    const bySource = new Map(vaultItems.map((item) => [item.sourceUrl, item]));
    const matched = new Set<string>();
    const merged = serverAssets.map((asset) => {
      const item = bySource.get(asset.url);
      if (!item || !vaultUrls[item.id]) return asset;
      matched.add(item.id);
      return { ...asset, url: vaultUrls[item.id], vault: item };
    });
    // 서버 기록이 사라진 보관 항목도 표시합니다.
    for (const item of vaultItems) {
      if (matched.has(item.id) || !vaultUrls[item.id]) continue;
      merged.push({
        id: `vault-${item.id}`,
        jobId: -1,
        kind: item.kind,
        url: vaultUrls[item.id],
        sourceUrl: item.sourceUrl,
        siblings: 1,
        references: [],
        cost: null,
        currency: null,
        model: item.model,
        prompt: item.prompt,
        createdAt: new Date(item.savedAt - new Date().getTimezoneOffset() * 60000).toISOString(),
        vault: item,
      });
    }
    const hiddenSet = new Set(hidden);
    return merged
      .filter((asset) => !hiddenSet.has(asset.sourceUrl))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [jobs, vaultItems, vaultUrls, hidden]);
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
    // 같은 날짜 안에서는 이미지 → 동영상 → 음성 순으로 나눠 보여 줍니다.
    for (const list of map.values()) list.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [assets, filter]);

  /* 상세 보기에서 이동할 목록: 화면에 보이는 순서의 이미지·영상. */
  const viewerAssets: Array<Asset & { kind: "image" | "video" }> = useMemo(
    () =>
      groups.flatMap(([, items]) =>
        items.filter((asset): asset is Asset & { kind: "image" | "video" } => asset.kind !== "audio"),
      ),
    [groups],
  );

  function openViewer(asset: Asset) {
    const index = viewerAssets.findIndex((item) => item.id === asset.id);
    if (index >= 0) setViewerIndex(index);
  }

  async function assetAsAttachment(asset: ViewerAsset): Promise<AttachedFile> {
    const blob = await fetch(asset.url).then((response) => {
      if (!response.ok) throw new Error("파일을 불러오지 못했습니다.");
      return response.blob();
    });
    const extension = asset.kind === "video" ? "mp4" : (blob.type.split("/")[1] || "png");
    const [uploaded] = await uploadFiles([new File([blob], `library-${asset.id}.${extension}`, { type: blob.type })]);
    return uploaded;
  }

  const viewerActions = {
    onMakeVideo: async (asset: ViewerAsset) => {
      try {
        setVideoStartImage(await assetAsAttachment(asset));
        router.push("/create/video");
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "영상 만들기로 넘기지 못했습니다.");
      }
    },
    onRemakeImage: async (asset: ViewerAsset) => {
      try {
        setImageRefs([await assetAsAttachment(asset)]);
        setImagePrompt(asset.prompt);
        router.push("/create/image");
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "이미지 만들기로 넘기지 못했습니다.");
      }
    },
    onRecreateVideo: (asset: ViewerAsset) => {
      setVideoPrompt(asset.prompt);
      const startImage = asset.references.find((ref) => ref.kind === "image");
      if (startImage) setVideoStartImage(startImage);
      router.push("/create/video");
    },
    onDelete: async (asset: ViewerAsset) => {
      if (!window.confirm("이 결과물을 라이브러리와 이 기기 보관함에서 삭제할까요?")) return;
      const full = assets.find((item) => item.id === asset.id);
      if (full?.vault) await removeVaultItems([full.vault.id]).catch(() => {});
      if (full && full.jobId > 0 && full.siblings <= 1) {
        await fetch(`/api/jobs?id=${full.jobId}`, { method: "DELETE" }).catch(() => {});
      }
      const nextHidden = Array.from(new Set([...hidden, asset.sourceUrl]));
      setHidden(nextHidden);
      writeStore(HIDDEN_KEY, nextHidden);
      setViewerIndex(null);
      loadVault();
    },
    getTags: (asset: ViewerAsset) => tags[asset.sourceUrl] ?? [],
    setTags: (asset: ViewerAsset, next: string[]) => {
      const updated = { ...tags, [asset.sourceUrl]: next };
      if (next.length === 0) delete updated[asset.sourceUrl];
      setTagsState(updated);
      writeStore(TAGS_KEY, updated);
    },
  };

  return (
    <div className="page-pad">
      <div className="page-head">
        <h1>라이브러리</h1>
        <p>생성한 이미지·영상·음성이 만든 날짜별로 모입니다. 이미지·영상은 이 브라우저에도 임시 보관되어 서버 파일이 사라져도 볼 수 있습니다.</p>
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
        <button type="button" className="secondary" onClick={() => { load(); loadVault(); }} disabled={loading} title="새로 고침">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Icon name="refresh" size={15} />
            새로 고침
          </span>
        </button>
      </div>

      <div className="muted" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12.5, margin: "-4px 0 16px" }}>
        <span>
          이 기기 보관함: {formatFileSize(vaultBytes)} / {formatFileSize(MAX_TOTAL_BYTES)} · {vaultItems.length}개 ·
          생성한 이미지·영상을 이 브라우저에 {RETENTION_DAYS}일간 보관합니다(고정한 파일은 계속 보관).
        </span>
        <button type="button" className="secondary" onClick={clearVault} disabled={vaultItems.every((item) => item.pinned)}>
          보관함 비우기
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
          {KIND_ORDER.filter((kind) => items.some((asset) => asset.kind === kind)).map((kind) => (
          <div className="lib-kind" key={kind}>
          <h3 className="lib-kind-title">
            <Icon name={kind} size={14} />
            {KIND_LABEL[kind]}
            <span className="lib-count">{items.filter((asset) => asset.kind === kind).length}</span>
          </h3>
          <div className="result-grid">
            {items.filter((asset) => asset.kind === kind).map((asset) => {
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
                  <div key={asset.id} className="asset-tile video-tile" title={asset.prompt} onClick={() => openViewer(asset)}>
                    <video
                      src={asset.url}
                      muted
                      playsInline
                      preload="metadata"
                      onMouseEnter={(event) => event.currentTarget.play().catch(() => {})}
                      onMouseLeave={(event) => {
                        event.currentTarget.pause();
                        event.currentTarget.currentTime = 0;
                      }}
                    />
                    <div className="asset-overlay">
                      <span className="asset-badge">{KIND_LABEL.video}</span>
                      {asset.vault ? <VaultControls item={asset.vault} onPin={togglePin} onRemove={removeFromVault} /> : null}
                    </div>
                  </div>
                );
              }
              return (
                <div key={asset.id} className="asset-tile" title={asset.prompt} onClick={() => openViewer(asset)}>
                  <img src={asset.url} alt={asset.prompt || "생성 이미지"} loading="lazy" />
                  <div className="asset-overlay">
                    <span className="asset-badge">{KIND_LABEL.image}</span>
                    {asset.vault ? <VaultControls item={asset.vault} onPin={togglePin} onRemove={removeFromVault} /> : null}
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
          </div>
          ))}
        </section>
      ))}

      {viewerIndex !== null && viewerAssets[viewerIndex] ? (
        <AssetViewer
          assets={viewerAssets.map((asset) => ({ ...asset, size: asset.vault?.size ?? null }))}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          actions={viewerActions}
        />
      ) : null}
    </div>
  );
}

function VaultControls({
  item,
  onPin,
  onRemove,
}: {
  item: VaultItem;
  onPin: (item: VaultItem) => void;
  onRemove: (item: VaultItem) => void;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }} onClick={(event) => event.stopPropagation()}>
      <span className="asset-badge" title="이 기기 보관함에 저장됨">
        {item.pinned ? "고정됨" : `보관 ${daysLeft(item)}일 남음`}
      </span>
      <button
        type="button"
        className="asset-badge"
        style={{ cursor: "pointer", border: "none" }}
        onClick={() => onPin(item)}
        title={item.pinned ? "고정 해제 (보존 기간이 지나면 자동 삭제)" : "고정 (자동 삭제 제외)"}
      >
        {item.pinned ? "고정 해제" : "고정"}
      </button>
      <button
        type="button"
        className="asset-badge"
        style={{ cursor: "pointer", border: "none" }}
        onClick={() => onRemove(item)}
        title="이 기기 보관함에서 삭제"
      >
        삭제
      </button>
    </span>
  );
}
