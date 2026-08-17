"use client";

import { modelDisplayLabel } from "@/lib/models";
import type { AttachedFile } from "@/lib/client-api";
import { Icon, type IconName } from "./Icon";
import type { ModelsHook } from "./useModels";

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

export function AttachStrip({
  files,
  onRemove,
}: {
  files: AttachedFile[];
  onRemove: (id: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="attach-strip">
      {files.map((file) => (
        <div key={file.id} className="attach-chip">
          {file.kind === "image" ? <img src={file.url} alt={file.name} /> : null}
          {file.kind === "video" ? <video src={file.url} preload="metadata" /> : null}
          {file.kind === "doc" ? (
            <span style={{ color: "var(--text-faint)", display: "grid", placeItems: "center", width: 30, height: 30 }}>
              <Icon name="doc" size={16} />
            </span>
          ) : null}
          <span className="chip-name">{file.name}</span>
          <button type="button" className="chip-remove" aria-label={`${file.name} 첨부 제거`} onClick={() => onRemove(file.id)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- 라이트박스 */

export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  if (!src) return null;
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="확대 보기">
      <img src={src} alt="확대 보기" />
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
