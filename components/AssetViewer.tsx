"use client";

import { useEffect, useState } from "react";
import { formatFileSize } from "@/components/studio-ui";
import { extractVideoFrames, type AttachedFile } from "@/lib/client-api";

/*
 * 라이브러리 상세 보기. 왼쪽에 이미지·영상 미리보기, 오른쪽에 작성자·프롬프트·
 * 참조 미디어·정보·태그와 작업 버튼을 보여 줍니다. 좌우 화살표(또는 ← →
 * 키)로 같은 목록의 이전·다음 항목으로 이동합니다.
 */

export interface ViewerAsset {
  id: string;
  kind: "image" | "video";
  /** 화면에 표시할 주소(보관함 사본이면 object URL). */
  url: string;
  /** 원래 파일 주소. 태그·숨김 기록의 키로 씁니다. */
  sourceUrl: string;
  model: string | null;
  prompt: string;
  createdAt: string;
  references: AttachedFile[];
  cost: number | null;
  currency: string | null;
  size: number | null;
}

export interface ViewerActions {
  onMakeVideo: (asset: ViewerAsset) => void;
  onRemakeImage: (asset: ViewerAsset) => void;
  onRecreateVideo: (asset: ViewerAsset) => void;
  onDelete: (asset: ViewerAsset) => void;
  getTags: (asset: ViewerAsset) => string[];
  setTags: (asset: ViewerAsset, tags: string[]) => void;
}

const PROMPT_PREVIEW_CHARS = 180;

function formatDate(value: string): { date: string; time: string } {
  const date = new Date(value.includes("T") || value.includes("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return { date: value, time: "" };
  return {
    date: date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }),
    time: date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

function downloadName(asset: ViewerAsset): string {
  const stamp = asset.createdAt.slice(0, 19).replace(/[^0-9]/g, "");
  return `${asset.kind}-${stamp || asset.id}.${asset.kind === "video" ? "mp4" : "png"}`;
}

export function AssetViewer({
  assets,
  index,
  onIndexChange,
  onClose,
  actions,
}: {
  assets: ViewerAsset[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  actions: ViewerActions;
}) {
  const asset = assets[index];
  const [author, setAuthor] = useState("");
  const [dimensions, setDimensions] = useState<{ width: number; height: number; duration?: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [tagText, setTagText] = useState("");
  const [notice, setNotice] = useState("");
  const [frames, setFrames] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setAuthor(typeof body.username === "string" ? body.username : ""))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setDimensions(null);
    setExpanded(false);
    setNotice("");
    setFrames([]);
    if (asset) setTagText(actions.getTags(asset).join(", "));
    // 항목이 바뀔 때만 초기화합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (event.key === "ArrowRight" && index < assets.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, assets.length, onClose, onIndexChange]);

  if (!asset) return null;
  const created = formatDate(asset.createdAt);
  const longPrompt = asset.prompt.length > PROMPT_PREVIEW_CHARS;
  const shownPrompt = expanded || !longPrompt ? asset.prompt : `${asset.prompt.slice(0, PROMPT_PREVIEW_CHARS)}…`;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(asset.prompt);
      setNotice("프롬프트를 복사했습니다.");
    } catch {
      setNotice("복사하지 못했습니다.");
    }
  }

  async function share() {
    // 보관함 사본(blob:)은 다른 기기에서 열 수 없으므로 원래 주소를 공유합니다.
    const link = new URL(asset.sourceUrl, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: asset.prompt.slice(0, 80) || "AI 생성물", url: link });
      else {
        await navigator.clipboard.writeText(link);
        setNotice("링크를 복사했습니다. 이 앱에 로그인한 사용자만 열 수 있습니다.");
      }
    } catch {
      // 사용자가 공유 창을 닫은 경우 등은 무시합니다.
    }
  }

  async function extractFrames() {
    setExtracting(true);
    setNotice("");
    try {
      const blob = await fetch(asset.url).then((response) => response.blob());
      setFrames(await extractVideoFrames(new File([blob], "video", { type: blob.type || "video/mp4" }), 8));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "프레임을 추출하지 못했습니다.");
    } finally {
      setExtracting(false);
    }
  }

  function saveTags(value: string) {
    const tags = value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 30);
    actions.setTags(asset, tags);
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="자산 상세 보기">
      <div className="viewer-stage" onClick={onClose}>
        <button
          type="button"
          className="viewer-nav prev"
          disabled={index === 0}
          onClick={(event) => {
            event.stopPropagation();
            onIndexChange(index - 1);
          }}
          aria-label="이전"
        >
          ‹
        </button>
        <div className="viewer-media" onClick={(event) => event.stopPropagation()}>
          {asset.kind === "video" ? (
            <video
              key={asset.id}
              src={asset.url}
              controls
              autoPlay
              playsInline
              onLoadedMetadata={(event) =>
                setDimensions({
                  width: event.currentTarget.videoWidth,
                  height: event.currentTarget.videoHeight,
                  duration: event.currentTarget.duration,
                })
              }
            />
          ) : (
            <img
              key={asset.id}
              src={asset.url}
              alt={asset.prompt || "생성 이미지"}
              onLoad={(event) =>
                setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              }
            />
          )}
        </div>
        <button
          type="button"
          className="viewer-nav next"
          disabled={index >= assets.length - 1}
          onClick={(event) => {
            event.stopPropagation();
            onIndexChange(index + 1);
          }}
          aria-label="다음"
        >
          ›
        </button>
      </div>

      <aside className="viewer-panel">
        <div className="viewer-head">
          <span className="viewer-avatar">{(author || "나").slice(0, 1).toUpperCase()}</span>
          <div>
            <div className="viewer-author">{author || "나"}</div>
            <div className="viewer-label">작성자</div>
          </div>
          <button type="button" className="viewer-close" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="viewer-body">
          {asset.prompt ? (
            <section>
              <div className="viewer-section-title">
                <span>프롬프트</span>
                <button type="button" className="viewer-link" onClick={copyPrompt}>복사</button>
              </div>
              <div className="viewer-box viewer-prompt">{shownPrompt}</div>
              {longPrompt ? (
                <button type="button" className="viewer-link viewer-more" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? "접기" : "더 보기"}
                </button>
              ) : null}
            </section>
          ) : null}

          {asset.references.length > 0 ? (
            <section>
              <div className="viewer-section-title"><span>참조 미디어</span></div>
              <div className="viewer-refs">
                {asset.references.map((ref) =>
                  ref.kind === "video" ? (
                    <video key={ref.id} src={ref.url} muted preload="metadata" title={ref.name} />
                  ) : (
                    <a key={ref.id} href={ref.url} target="_blank" rel="noreferrer" title={ref.name}>
                      <img src={ref.url} alt={ref.name} />
                    </a>
                  ),
                )}
              </div>
            </section>
          ) : null}

          <section>
            <div className="viewer-section-title"><span>정보</span></div>
            <div className="viewer-box viewer-info">
              <div><span>크기</span><b>{dimensions ? `${dimensions.width} × ${dimensions.height}` : "—"}</b></div>
              {asset.kind === "video" ? (
                <div><span>길이</span><b>{dimensions?.duration && Number.isFinite(dimensions.duration) ? `${dimensions.duration.toFixed(1)}초` : "—"}</b></div>
              ) : null}
              <div><span>생성 시각</span><b>{created.date}<small>{created.time}</small></b></div>
              {asset.model ? <div><span>모델</span><b>{asset.model}</b></div> : null}
              {asset.size ? <div><span>파일 크기</span><b>{formatFileSize(asset.size)}</b></div> : null}
              {asset.cost !== null ? (
                <div><span>비용</span><b>{asset.cost.toFixed(4)} {asset.currency ?? ""}</b></div>
              ) : null}
            </div>
          </section>

          <section>
            <div className="viewer-section-title"><span>태그</span></div>
            <input
              type="text"
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
              onBlur={(event) => saveTags(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveTags(event.currentTarget.value);
              }}
              placeholder="태그 추가 (쉼표로 구분)"
            />
          </section>

          {frames.length > 0 ? (
            <section>
              <div className="viewer-section-title"><span>추출한 프레임</span></div>
              <div className="viewer-refs">
                {frames.map((frame, frameIndex) => (
                  <a key={frameIndex} href={frame} download={`frame-${frameIndex + 1}.jpg`} title="눌러서 저장">
                    <img src={frame} alt={`프레임 ${frameIndex + 1}`} />
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {notice ? <div className="muted" style={{ fontSize: 12 }}>{notice}</div> : null}
        </div>

        <div className="viewer-actions">
          <div className="viewer-row">
            <button type="button" className="secondary" onClick={share}>공유</button>
            <a className="button secondary" href={asset.url} download={downloadName(asset)}>다운로드</a>
          </div>
          {asset.kind === "image" ? (
            <>
              <button type="button" className="viewer-primary" onClick={() => actions.onMakeVideo(asset)}>
                이 이미지로 영상 만들기
              </button>
              <button type="button" className="secondary" onClick={() => actions.onRemakeImage(asset)}>
                참조 이미지로 다시 만들기
              </button>
            </>
          ) : (
            <>
              <button type="button" className="secondary" onClick={extractFrames} disabled={extracting}>
                {extracting ? "프레임을 추출하고 있습니다…" : "프레임 추출"}
              </button>
              <button type="button" className="secondary" onClick={() => actions.onRecreateVideo(asset)}>
                다시 만들기
              </button>
            </>
          )}
          <button type="button" className="danger" onClick={() => actions.onDelete(asset)}>삭제</button>
        </div>
      </aside>
    </div>
  );
}
