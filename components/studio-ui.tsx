"use client";

import { useEffect, useState } from "react";
import { modelDisplayLabel } from "@/lib/models";
import type { AttachedFile } from "@/lib/client-api";
import { Icon, type IconName } from "./Icon";
import type { ModelsHook } from "./useModels";

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/* ------------------------------------------------------------------ 칩 */

export function SelectChip({
  icon,
  value,
  options,
  onChange,
  disabled,
  title,
}: {
  icon: IconName;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <span className="chip chip-select" title={title}>
      <span className="chip-icon">
        <Icon name={icon} size={14} />
      </span>
      <span className="chip-text">{current?.label ?? "선택"}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={title ?? "옵션 선택"}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function ToggleChip({
  icon,
  label,
  on,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="chip"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      style={on ? { borderColor: "var(--accent)", color: "var(--text)" } : undefined}
    >
      <span className="chip-icon">
        <Icon name={icon} size={14} />
      </span>
      <span className="chip-text">{label}</span>
    </button>
  );
}

export function FileChip({
  label,
  accept,
  multiple,
  disabled,
  onPick,
  title,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onPick: (event: React.ChangeEvent<HTMLInputElement>) => void;
  title?: string;
}) {
  return (
    <label className="chip chip-file" title={title} style={disabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}>
      <span className="chip-icon">
        <Icon name="plus" size={14} />
      </span>
      <span className="chip-text">{label}</span>
      <input type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={onPick} />
    </label>
  );
}

export function SendButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="dock-send" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <Icon name="arrowUp" size={17} />
    </button>
  );
}

/* --------------------------------------------------------------- 모델 */

export function ModelChip({ hook }: { hook: ModelsHook }) {
  if (hook.loading) {
    return (
      <span className="chip" aria-live="polite">
        <span className="spinner" style={{ width: 13, height: 13 }} />
        <span className="chip-text">모델 불러오는 중</span>
      </span>
    );
  }
  if (!hook.models || hook.models.length === 0) {
    return (
      <span className="chip" style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>
        <span className="chip-text">사용할 모델 없음</span>
      </span>
    );
  }
  return (
    <SelectChip
      icon="sparkle"
      title="모델 선택"
      value={hook.selectedId}
      onChange={(value) => hook.setSelectedId(value)}
      options={hook.models.map((model) => ({ value: model.id, label: modelDisplayLabel(model) }))}
    />
  );
}

export function ModelDetail({ hook }: { hook: ModelsHook }) {
  if (hook.error) return <div className="error-box">{hook.error}</div>;
  if (!hook.selected) return null;
  const { translation, selected } = hook;
  return (
    <div className="model-detail">
      <div className="desc-panel">
        <span className="desc-label">모델 설명 (원문)</span>
        {selected.description || "제공되는 설명이 없습니다."}
      </div>
      <div className="desc-panel">
        <span className="desc-label">모델 설명 (번역)</span>
        {translation.loading ? "번역을 준비하고 있습니다…" : null}
        {!translation.loading && translation.text !== null ? translation.text : null}
        {!translation.loading && translation.text === null && translation.error ? translation.error : null}
        {!translation.loading && translation.text === null && !translation.error ? "번역할 설명이 없습니다." : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- 첨부 */

const AUDIO_KIND_ICON: Record<string, IconName> = { doc: "doc", audio: "audio" };

export function AttachStrip({
  files,
  onRemove,
  onPreview,
}: {
  files: AttachedFile[];
  onRemove: (id: string) => void;
  /** 생략하면 자기 자신을 라이트박스로 미리보기합니다. */
  onPreview?: (file: AttachedFile) => void;
}) {
  const [internalPreview, setInternalPreview] = useState<AttachedFile | null>(null);
  if (files.length === 0) return null;
  const preview = onPreview ?? setInternalPreview;
  return (
    <>
      <div className="attach-strip">
        {files.map((file) => (
          <div key={file.id} className="attach-chip">
            {file.kind === "image" || file.kind === "video" ? (
              <button
                type="button"
                className="attach-chip-preview"
                onClick={() => preview(file)}
                aria-label={`${file.name} 미리보기`}
                title="클릭해서 크게 보기"
              >
                {file.kind === "image" ? <img src={file.url} alt={file.name} /> : <video src={file.url} preload="metadata" />}
              </button>
            ) : (
              <span className="attach-chip-doc-icon">
                <Icon name={AUDIO_KIND_ICON[file.kind] ?? "doc"} size={16} />
              </span>
            )}
            <button
              type="button"
              className="chip-name-group"
              onClick={() => preview(file)}
              title="클릭해서 자세히 보기"
            >
              <span className="chip-name">{file.name}</span>
              <span className="chip-size">{formatFileSize(file.size)}</span>
            </button>
            <button type="button" className="chip-remove" aria-label={`${file.name} 첨부 제거`} onClick={() => onRemove(file.id)}>
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
      {onPreview ? null : (
        <Lightbox content={internalPreview} onClose={() => setInternalPreview(null)} />
      )}
    </>
  );
}

/* ----------------------------------------------------------- 라이트박스 */

export interface LightboxFile {
  url: string;
  kind: "image" | "video" | "audio" | "doc";
  name?: string;
  mime?: string;
  size?: number;
}

export type LightboxContent = string | LightboxFile | null;

const TEXT_PREVIEW_MIMES = new Set(["text/plain", "text/markdown"]);
const TEXT_PREVIEW_LIMIT = 8000;

function DocPreviewBody({ file }: { file: LightboxFile }) {
  const isPdf = file.mime === "application/pdf" || file.url.toLowerCase().endsWith(".pdf");
  const isText = file.mime ? TEXT_PREVIEW_MIMES.has(file.mime) : /\.(txt|md)$/i.test(file.url);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    fetch(file.url)
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.text();
      })
      .then((body) => {
        if (cancelled) return;
        setText(body.slice(0, TEXT_PREVIEW_LIMIT));
      })
      .catch(() => {
        if (!cancelled) setError("문서 내용을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.url, isText]);

  if (isPdf) {
    return <iframe src={file.url} title={file.name ?? "PDF 미리보기"} />;
  }
  if (isText) {
    if (error) return <p className="doc-hint">{error}</p>;
    if (text === null) return <p className="doc-hint">문서를 불러오는 중…</p>;
    return (
      <pre>
        {text}
        {text.length >= TEXT_PREVIEW_LIMIT ? "\n\n… (내용이 길어 일부만 표시)" : ""}
      </pre>
    );
  }
  return <p className="doc-hint">이 형식은 화면에서 바로 미리 볼 수 없습니다. 새 창에서 열어 확인해 주세요.</p>;
}

export function Lightbox({
  content,
  src,
  onClose,
}: {
  /** 새 코드는 content(문자열 또는 LightboxFile)를 씁니다. */
  content?: LightboxContent;
  /** 기존 호출부 호환용 — 이미지 URL 문자열만 받습니다. */
  src?: string | null;
  onClose: () => void;
}) {
  const raw = content !== undefined ? content : (src ?? null);
  if (!raw) return null;
  const file: LightboxFile = typeof raw === "string" ? { url: raw, kind: "image" } : raw;

  if (file.kind === "doc" || file.kind === "audio") {
    return (
      <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="첨부 미리보기">
        <div className="lightbox-doc" onClick={(event) => event.stopPropagation()}>
          <div className="lightbox-doc-head">
            <Icon name={file.kind === "audio" ? "audio" : "doc"} size={16} />
            <span className="doc-title">{file.name ?? "첨부 파일"}</span>
            {file.size !== undefined ? <span className="doc-meta">{formatFileSize(file.size)}</span> : null}
            <a href={file.url} target="_blank" rel="noreferrer" className="chip" style={{ flex: "none" }}>
              새 창에서 열기
            </a>
          </div>
          <div className="lightbox-doc-body">
            {file.kind === "audio" ? (
              <audio src={file.url} controls preload="metadata" style={{ width: "100%" }} />
            ) : (
              <DocPreviewBody file={file} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="확대 보기">
      {file.kind === "video" ? (
        <video src={file.url} controls autoPlay onClick={(event) => event.stopPropagation()} />
      ) : (
        <img src={file.url} alt={file.name ?? "확대 보기"} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- 빈 상태 */

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-art">
        <Icon name={icon} size={28} />
      </span>
      <div>
        <h3>{title}</h3>
        <p style={{ marginTop: 6 }}>{body}</p>
      </div>
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  );
}
