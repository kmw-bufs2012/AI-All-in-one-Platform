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
}: {
  params: ExtraParam[];
  values: ParamValues;
  onChange: (key: string, value: string | number | undefined) => void;
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

function ParamControl({
  param,
  value,
  onChange,
}: {
  param: ExtraParam;
  value: string | number | undefined;
  onChange: (value: string | number | undefined) => void;
}) {
  const label = paramKeyLabel(param.key);

  if (param.kind === "range" && param.min !== undefined && param.max !== undefined) {
    // 값이 전부 숫자인 enum(예: duration "5"/"10")도 여기서 슬라이더로 그립니다.
    const discrete = param.values?.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    const step = param.step ?? (discrete && discrete.length > 1 ? undefined : 1);
    const current = typeof value === "number" ? value : (param.default as number | undefined) ?? param.min;
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
              onChange(snapped);
            }}
          />
          <span className="param-value">{current}</span>
        </div>
      </label>
    );
  }

  if (param.kind === "enum" && param.values && param.values.length > 0) {
    const current = typeof value === "string" ? value : (param.default as string | undefined) ?? "";
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
              {paramValueLabel(param.key, item)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return null;
}
