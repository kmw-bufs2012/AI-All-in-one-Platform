"use client";

import { useState } from "react";
import type { ExtraParam } from "@/lib/models";
import { paramKeyLabel, paramValueLabel } from "@/lib/model-param-labels";
import { Icon } from "./Icon";

export type ParamValues = Record<string, string | number>;

/**
 * 선택한 모델이 supported_parameters로 공개한 값만 컨트롤로 보여줍니다.
 * 값이 전부 숫자인 파라미터(길이 등)는 마우스로 끄는 슬라이더로, 그 밖의
 * enum은 드롭다운으로 렌더링합니다. 앱에 고정된 비율·품질·스타일 목록은 두지
 * 않고, 모델마다 실제로 지원하는 값만 보여줍니다.
 */
export function DynamicParamsPanel({
  params,
  values,
  onChange,
  source,
}: {
  params: ExtraParam[];
  values: ParamValues;
  onChange: (key: string, value: string | number | undefined) => void;
  /** 공식 문서로 보강한 설정의 출처. */
  source?: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (params.length === 0) return null;
  return (
    <div className="params-panel">
      <button type="button" className="params-toggle" onClick={() => setOpen((prev) => !prev)} aria-expanded={open}>
        <Icon name="quality" size={14} />
        <span>상세 설정 ({params.length}개)</span>
        <Icon name="chevronDown" size={13} />
      </button>
      {open ? (
        <div className="params-grid">
          {params.map((param) => (
            <ParamControl
              key={param.key}
              param={param}
              value={values[param.key]}
              onChange={(value) => onChange(param.key, value)}
            />
          ))}
          {source && params.some((param) => param.origin === "official") ? (
            <p className="param-source">공식 문서 설정 출처: {source}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function nearestAllowed(value: number, allowed: number[]): number {
  return allowed.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest,
  allowed[0]);
}

function numericParamValue(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:s|sec|secs|second|seconds|초)?$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function ParamControl({
  param,
  value,
  onChange,
}: {
  param: ExtraParam;
  value: string | number | undefined;
  onChange: (value: string | number | undefined) => void;
}) {
  // 한국어 라벨이 없으면 카탈로그의 표시 이름을 씁니다.
  const koLabel = paramKeyLabel(param.key);
  const shownLabel = koLabel !== param.key ? koLabel : param.label ?? param.key;
  const label = (
    <>
      {shownLabel}
      {param.origin === "official" ? (
        <span className="param-official" title="NanoGPT 카탈로그에는 없지만 제작사 공식 문서로 확인한 설정입니다">
          공식 문서
        </span>
      ) : null}
      {param.note ? <span className="param-note">{param.note}</span> : null}
      {!param.note && param.description ? <span className="param-note">{param.description}</span> : null}
    </>
  );

  if (param.kind === "text") {
    const multiline = /json|array|one url per line|list|prompt/i.test(`${param.description ?? ""} ${param.key}`);
    const current = typeof value === "string" ? value : "";
    return (
      <label className="param-row param-row-wide">
        <span className="param-label">{label}</span>
        {multiline ? (
          <textarea
            className="param-text"
            rows={3}
            value={current}
            placeholder={param.default ? String(param.default) : "비워 두면 모델 기본값"}
            onChange={(event) => onChange(event.target.value || undefined)}
          />
        ) : (
          <input
            className="param-text"
            type="text"
            value={current}
            placeholder={param.default ? String(param.default) : "비워 두면 모델 기본값"}
            onChange={(event) => onChange(event.target.value || undefined)}
          />
        )}
      </label>
    );
  }

  if (param.kind === "number") {
    const current = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
    return (
      <label className="param-row">
        <span className="param-label">{label}</span>
        <input
          className="param-text"
          type="number"
          min={param.min}
          max={param.max}
          step={param.step ?? "any"}
          value={current}
          placeholder={param.default !== null && param.default !== undefined ? String(param.default) : "모델 기본값"}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") return onChange(undefined);
            const numeric = Number(raw);
            onChange(Number.isFinite(numeric) ? numeric : undefined);
          }}
        />
      </label>
    );
  }

  if (param.kind === "range" && param.min !== undefined && param.max !== undefined) {
    // 값이 전부 숫자인 enum(예: duration "5"/"10")도 여기서 슬라이더로 그립니다.
    const discreteOptions = param.values
      ?.map((raw) => ({ raw, numeric: numericParamValue(raw) }))
      .filter((item): item is { raw: string; numeric: number } => item.numeric !== null);
    const discrete = discreteOptions?.map((item) => item.numeric);
    const step = param.step ?? (discrete && discrete.length > 1 ? undefined : 1);
    const requested = value ?? param.default;
    const requestedNumber = numericParamValue(requested);
    const current = requestedNumber !== null
      && requestedNumber >= param.min
      && requestedNumber <= param.max
      && (!discrete || discrete.includes(requestedNumber))
      ? requestedNumber
      : numericParamValue(param.default) ?? param.min;
    const displayValue = discreteOptions?.find((item) => item.numeric === current)?.raw ?? current;
    return (
      <label className="param-row">
        <span className="param-label">{label}</span>
        <div className="param-slider-row">
          <input
            type="range"
            min={param.min}
            max={param.max}
            step={step ?? 1}
            value={current}
            onChange={(event) => {
              const raw = Number(event.target.value);
              const snapped = discrete && discrete.length > 0 ? nearestAllowed(raw, discrete) : raw;
              const original = discreteOptions?.find((item) => item.numeric === snapped)?.raw;
              onChange(original ?? snapped);
            }}
          />
          <span className="param-value">{displayValue}</span>
        </div>
      </label>
    );
  }

  if (param.kind === "enum" && param.values && param.values.length > 0) {
    const requested = typeof value === "string" ? value : undefined;
    const fallback = typeof param.default === "string" && param.values.includes(param.default) ? param.default : "";
    const current = requested && param.values.includes(requested) ? requested : fallback;
    return (
      <label className="param-row">
        <span className="param-label">{label}</span>
        <select
          className="param-select"
          value={current}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">모델 기본값</option>
          {param.values.map((item) => (
            <option key={item} value={item}>
              {paramValueLabel(param.key, item) !== item ? paramValueLabel(param.key, item) : param.valueLabels?.[item] ?? item}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return null;
}
