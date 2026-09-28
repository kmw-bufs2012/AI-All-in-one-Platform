/*
 * 마스터 프롬프트의 기계용 설정(MasterSettings)을 선택한 동영상 모델이 실제로
 * 공개한 파라미터에 맞춰 옮깁니다. 모델이 지원하지 않는 설정은 억지로 보내지
 * 않고 "적용 안 됨"으로 알려 줍니다(프롬프트 본문에는 그대로 남아 있습니다).
 */

import type { ExtraParam, NormalizedModel } from "./models";
import type { MasterSettings } from "./master-prompt";

export interface AppliedSettings {
  params: Record<string, string | number>;
  text: Record<string, string>;
  applied: string[];
  skipped: string[];
}

function findParam(params: ExtraParam[], pattern: RegExp): ExtraParam | undefined {
  return params.find((param) => pattern.test(param.key));
}

function numeric(value: string): number | null {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** 숫자 목표값을 파라미터가 허용하는 값으로 맞춥니다. */
function fitNumber(param: ExtraParam, target: number): string | number | null {
  if (param.values && param.values.length > 0) {
    const options = param.values
      .map((raw) => ({ raw, value: numeric(raw) }))
      .filter((item): item is { raw: string; value: number } => item.value !== null);
    if (options.length === 0) return null;
    return options.reduce((best, item) => (Math.abs(item.value - target) < Math.abs(best.value - target) ? item : best)).raw;
  }
  if (param.min !== undefined && param.max !== undefined) {
    const step = param.step ?? 1;
    const clamped = Math.max(param.min, Math.min(param.max, target));
    return Math.round(clamped / step) * step;
  }
  return null;
}

function fitMotion(param: ExtraParam, level: number): string | number | null {
  if (param.kind === "range" && param.min !== undefined && param.max !== undefined && !(param.values && param.values.some((v) => numeric(v) === null))) {
    return fitNumber(param, param.min + ((level - 1) / 9) * (param.max - param.min));
  }
  const values = param.values ?? [];
  if (values.length === 0) return null;
  const tier = level <= 3 ? 0 : level <= 7 ? 1 : 2;
  const keywords = [/low|small|slow|weak|subtle|gentle/i, /medium|normal|moderate|default|balanced/i, /high|large|fast|strong|dynamic|intense/i];
  const hit = values.find((value) => keywords[tier].test(value));
  if (hit) return hit;
  return values[Math.min(values.length - 1, Math.round((tier / 2) * (values.length - 1)))];
}

export function applyMasterSettings(
  model: NormalizedModel,
  settings: MasterSettings,
  seed: number | null,
): AppliedSettings {
  const params = model.videoParams ?? [];
  const freeText = new Set(model.freeTextParams ?? []);
  const result: AppliedSettings = { params: {}, text: {}, applied: [], skipped: [] };

  if (settings.duration !== null) {
    const param = findParam(params, /^(duration|seconds)$/i);
    const value = param ? fitNumber(param, settings.duration) : null;
    if (param && value !== null) {
      result.params[param.key] = value;
      result.applied.push(`길이 ${value}초`);
    } else result.skipped.push("길이");
  }
  if (settings.aspect_ratio) {
    const param = findParam(params, /^(aspect_?ratio|ratio)$/i);
    const value = param?.values?.find((item) => item.replace(/\s/g, "") === settings.aspect_ratio!.replace(/\s/g, ""));
    if (param && value) {
      result.params[param.key] = value;
      result.applied.push(`비율 ${value}`);
    } else result.skipped.push("비율");
  }
  if (settings.resolution) {
    const param = findParam(params, /^resolution$/i);
    const target = numeric(settings.resolution);
    const value = param?.values?.find((item) => item.toLowerCase() === settings.resolution!.toLowerCase())
      ?? (target !== null ? param?.values?.find((item) => numeric(item) === target) : undefined);
    if (param && value) {
      result.params[param.key] = value;
      result.applied.push(`해상도 ${value}`);
    } else result.skipped.push("해상도");
  }
  if (settings.fps !== null) {
    const param = findParam(params, /^fps$/i);
    const value = param ? fitNumber(param, settings.fps) : null;
    if (param && value !== null) {
      result.params[param.key] = value;
      result.applied.push(`fps ${value}`);
    }
  }
  if (settings.motion_intensity !== null) {
    const param = findParam(params, /motion|movement/i);
    const value = param ? fitMotion(param, settings.motion_intensity) : null;
    if (param && value !== null) {
      result.params[param.key] = value;
      result.applied.push(`모션 강도 ${settings.motion_intensity}/10 → ${value}`);
    } else result.skipped.push("모션 강도(프롬프트 본문으로만 전달)");
  }
  if (settings.negative_prompt) {
    if (freeText.has("negative_prompt")) {
      result.text.negative_prompt = settings.negative_prompt.slice(0, 500);
      result.applied.push("네거티브 프롬프트");
    } else result.skipped.push("네거티브 프롬프트(프롬프트 본문으로만 전달)");
  }
  if (seed !== null) {
    const param = findParam(params, /^seed$/i);
    if (param) {
      result.params[param.key] = seed;
      result.applied.push(`시드 ${seed}`);
    } else if (freeText.has("seed")) {
      result.text.seed = String(seed);
      result.applied.push(`시드 ${seed}`);
    }
  }
  return result;
}

/** 모델이 시드를 받는지. */
export function supportsSeed(model: NormalizedModel | null): boolean {
  if (!model) return false;
  return (model.videoParams ?? []).some((param) => /^seed$/i.test(param.key)) || (model.freeTextParams ?? []).includes("seed");
}

export function supportsNegativePrompt(model: NormalizedModel | null): boolean {
  return Boolean(model && (model.freeTextParams ?? []).includes("negative_prompt"));
}
