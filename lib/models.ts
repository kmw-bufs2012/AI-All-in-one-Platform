import { modelDescription } from "./model-descriptions";
import { findImageSettingsOverlay, mergeOfficialImageParams } from "./image-settings-overlay";
import { findUncensoredFamily, findVideoInputLimit } from "./model-attachment-limits";
import {
  findVideoOverlay,
  applyDurationOverlay,
  type ImageRoleOverlay,
} from "./model-capability-overlay";

/*
 * NanoGPT 모델 카탈로그 정규화.
 *
 * 근거: NanoGPT 공식 API 문서(docs.nano-gpt.com, 2026-09 확인)의 Models /
 * Image API / Video Generation / Text-to-Speech · Audio Models 페이지.
 *
 * 카탈로그마다 필드 구성이 다릅니다.
 * - 텍스트(/v1/models?detailed=true): architecture.{modality, input_modalities,
 *   output_modalities}, capabilities.{vision, video_input, audio_input,
 *   pdf_upload, reasoning, tool_calling, ...}, context_length,
 *   max_output_tokens, pricing.
 * - 이미지(/v1/image-models?detailed=true): supported_parameters(예:
 *   resolution=enum, n=range) 와 input_reference_constraints(max_items,
 *   min_width, min_height, max_bytes, formats).
 * - 동영상(/v1/video-models?detailed=true): 모델마다 받는 입력이 달라
 *   supported_parameters 에 imageUrl/imageDataUrl(이미지→동영상) 또는
 *   videoUrl(동영상 확장·편집)이 나타납니다.
 * - 오디오(/v1/audio-models?type=tts&detailed=true): voices, formats,
 *   max_input_size 등.
 *
 * 공식 문서가 "parameters should be treated as discoverable via
 * supported_parameters, not as globally supported fields" 라고 안내하므로,
 * 첨부 개수·해상도 같은 제약은 전부 카탈로그 응답에서 읽어 옵니다. 필드가 없는
 * 구형 응답을 위해서만 보수적인 기본값을 둡니다.
 */

export type ModelKind = "text" | "image" | "video" | "tts";

export interface VoiceInfo {
  id: string;
  name: string;
}

/*
 * 이미지·동영상 생성 모델이 supported_parameters로 공개한 그 밖의 설정값입니다.
 * NanoGPT 공식 문서: "Parameter support varies by model, and parameters
 * should be treated as discoverable via supported_parameters, not as
 * globally supported fields." 그래서 비율·품질·스타일(이미지), 해상도·품질
 * (동영상) 같은 값을 앱에 고정된 목록으로 두지 않고, 모델이 실제로 공개한
 * 파라미터만 그대로 노출합니다. 참조 이미지·해상도·생성 장수처럼 이미 전용
 * 필드가 있는 파라미터(resolution, n, imageUrl 등)는 제외됩니다.
 */
export interface ExtraParam {
  /** NanoGPT에 보낼 때 쓰는 원래 파라미터 이름(예: aspect_ratio, quality, style, duration). */
  key: string;
  /**
   * enum: 선택 목록 · range: 슬라이더 · text: 자유 입력(URL 목록·JSON 등) · number: 숫자 입력(범위 미공개).
   */
  kind: "enum" | "range" | "text" | "number";
  /** 카탈로그가 붙인 표시 이름(예: "Reference Videos (T2V)"). 한국어 라벨이 없을 때 씁니다. */
  label?: string;
  /** 카탈로그의 설정 설명. */
  description?: string;
  /** 선택지별 카탈로그 표시 이름(예: "16:9" → "Landscape (16:9)"). */
  valueLabels?: Record<string, string>;
  /** enum일 때 고를 수 있는 값 목록. */
  values?: string[];
  /** range이거나, 값이 전부 숫자인 enum일 때 슬라이더로 보여주기 위한 범위. */
  min?: number;
  max?: number;
  step?: number;
  default?: string | number | null;
  /** "official": 카탈로그에는 없지만 제작사 공식 문서로 확인해 더한 설정. */
  origin?: "catalog" | "official";
  /** 설정 옆에 보여 줄 짧은 도움말. */
  note?: string;
}

/**
 * 다른 모델에서 저장된 값이 현재 모델의 요청에 섞이지 않도록 허용값까지
 * 검증합니다. params가 배열이 아니면(예: 모델 카탈로그를 아직 못 불러왔거나
 * 예상과 다른 모양으로 온 경우) "params is not iterable"로 화면 전체가
 * 죽는 대신 빈 값으로 안전하게 넘어갑니다.
 */
export function filterSupportedParamValues(
  params: ExtraParam[] | null | undefined,
  values: Record<string, string | number>,
): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  if (!Array.isArray(params)) return result;
  for (const param of params) {
    const value = values[param.key];
    if (value === undefined) continue;
    if (param.values && param.values.length > 0) {
      const matched = param.values.find((candidate) => candidate === String(value));
      if (matched !== undefined) result[param.key] = matched;
      continue;
    }
    if (param.kind === "text") {
      if (typeof value === "string" && value.trim()) result[param.key] = value.slice(0, 4000);
      continue;
    }
    if (param.kind === "number") {
      const numeric = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(numeric)
        && (param.min === undefined || numeric >= param.min)
        && (param.max === undefined || numeric <= param.max)) {
        result[param.key] = numeric;
      }
      continue;
    }
    if (param.kind === "range" && typeof value === "number") {
      if (
        (param.min === undefined || value >= param.min)
        && (param.max === undefined || value <= param.max)
      ) {
        result[param.key] = value;
      }
    } else if (param.kind === "enum" && typeof value === "string") {
      result[param.key] = value;
    }
  }
  return result;
}

export interface ModelPricing {
  inputPer1M: number | null;
  outputPer1M: number | null;
  /** 이미지·동영상·음성처럼 요청(또는 결과물) 단위로 과금되는 모델의 단가. */
  perRequest: number | null;
  /** 동영상·음성처럼 길이(초) 단위로 과금되는 모델의 초당 단가. 건당 단가와 섞지 않습니다. */
  perSecond: number | null;
  currency: string | null;
}

export interface NormalizedModel {
  id: string;
  kind: ModelKind;
  name: string;
  description: string;
  uncensored: boolean;
  pricing: ModelPricing | null;

  /* ---------------------------------------------------------- 채팅 모델 */
  /*
   * 첨부 관련 능력은 3-상태입니다: true(지원) / false(명시적 미지원) /
   * null(카탈로그가 알려 주지 않음). NanoGPT 카탈로그는 모델마다 메타데이터
   * 수록 정도가 달라서, 필드가 없는 것을 "미지원"으로 단정하면 실제로는
   * 첨부되는 모델까지 막히게 됩니다. 그래서 null은 정책 단계에서 허용 쪽으로
   * 해석합니다(lib/attachment-policy.ts).
   */
  /** capabilities.vision — 이미지를 이해하는 모델인지. */
  vision: boolean | null;
  /** capabilities.video_input — 동영상 파일을 직접 입력받는지. */
  videoInput: boolean | null;
  /** capabilities.audio_input — 오디오 파일을 직접 입력받는지. */
  audioInput: boolean | null;
  /** capabilities.pdf_upload — PDF 문서를 직접 업로드할 수 있는지. */
  pdfUpload: boolean | null;
  /** architecture.input_modalities — ["text", "image", "video", "audio", "file"] 등. */
  inputModalities: string[];
  contextWindow: number | null;
  maxOutputTokens: number | null;

  /* ------------------------------------------------------ 이미지 생성 모델 */
  /** input_reference_constraints.max_items — 참조 이미지 최대 장수. null이면 미공개. */
  maxInputReferences: number | null;
  /** input_reference_constraints.formats — 참조 이미지 허용 형식(png/jpeg/webp). */
  referenceFormats: string[];
  /** input_reference_constraints.max_bytes — 참조 이미지 1장 최대 크기. */
  referenceMaxBytes: number | null;
  /** supported_parameters.resolution.values — 지원 해상도 목록. */
  resolutions: string[];
  defaultResolution: string | null;
  /** supported_parameters.n.max — 한 번에 생성할 수 있는 이미지 장수. */
  maxOutputImages: number;
  /** resolution·n·참조 이미지 외에 모델이 공개한 나머지 설정(비율·품질·스타일 등). */
  /** 해상도 목록이 카탈로그가 아니라 공식 문서에서 온 경우 true. */
  officialResolutions?: boolean;
  /** 공식 문서상 한 요청 최대 장수(참고). */
  officialMaxImages?: number | null;
  /** 보강한 공식 설정의 출처. */
  settingsSource?: string | null;
  /** 값 목록·범위 없이 이름만 공개된 자유 입력 파라미터 키(소문자). */
  freeTextParams?: string[];
  imageParams: ExtraParam[];

  /* ------------------------------------------------------- 동영상 생성 모델 */
  /** imageUrl / imageDataUrl 을 받는 image-to-video 계열인지. null이면 미공개. */
  acceptsStartImage: boolean | null;
  /**
   * 동영상 모델의 참조 이미지 여러 장 입력 파라미터(카탈로그 supported_parameters 기준).
   * 예: reference_images(최대 9장). 없으면 null — 시작 이미지 1장만 보냅니다.
   */
  videoReferenceImages: { key: string; max: number } | null;
  /** videoUrl 을 받는 동영상 확장·편집 계열인지. null이면 미공개. */
  acceptsSourceVideo: boolean | null;
  /** 시작 이미지·원본 동영상 외에 모델이 공개한 나머지 설정(길이·해상도·품질 등). */
  videoParams: ExtraParam[];
  /**
   * 원 개발사 자료로 확인된 끝 프레임 등 추가 이미지 역할(lib/model-capability-overlay.ts).
   * 모델 ID가 조사된 계열과 매칭될 때만 채워지며, 나머지 모델은 빈 배열입니다
   * (조사 범위는 docs/model-capability-research.md 참고 — 카탈로그 전체가
   * 아니라 우선순위 모델 계열만 다룹니다).
   */
  extraImageRoles: ImageRoleOverlay[];
  /** 원 개발사 자료로 확인된 길이 제한 관련 설명(있을 때만). */
  durationNote: string | null;

  /* ------------------------------------------------------------ TTS 모델 */
  voices: VoiceInfo[];
  defaultVoice: string | null;
  supportedFormats: string[];
  defaultFormat: string | null;
  /** 한 요청에 넣을 수 있는 최대 글자 수. */
  maxInputLength: number | null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown): boolean {
  return value === true || value === "true";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") out.push(entry);
    else if (typeof entry === "number") out.push(String(entry));
  }
  return out;
}

function optionLabels(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!Array.isArray(value)) return labels;
  for (const entry of value) {
    const record = asRecord(entry);
    const option = record.value;
    const label = asString(record.label);
    if ((typeof option === "string" || typeof option === "number") && label) labels[String(option)] = label;
  }
  return labels;
}

function optionValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" || typeof entry === "number") {
      out.push(String(entry));
      continue;
    }
    const record = asRecord(entry);
    const option = record.value;
    if (typeof option === "string" || typeof option === "number") out.push(String(option));
  }
  return out;
}

/**
 * supported_parameters 는 두 가지 형태로 내려옵니다.
 * - 객체 맵: { resolution: { type: "enum", values: [...], default: "..." } }
 * - 현재 동영상 카탈로그: { parameters: { duration: { options: [...] } }, defaults: {...} }
 * - 현재 이미지 카탈로그: { resolutions: [...], aspect_ratio: [...], max_images: 4 }
 * - 문자열 배열(OpenRouter 호환): ["temperature", "tools", ...]
 * 둘 다 다룰 수 있도록 "파라미터 이름 집합"과 "이름→정의 맵"을 함께 만듭니다.
 */
interface SupportedParams {
  names: Set<string>;
  defs: Record<string, Record<string, unknown>>;
  /** 소문자 키 → 카탈로그에 적힌 원래 키(요청에 그대로 써야 하는 이름). */
  original: Record<string, string>;
}

function readSupportedParams(raw: Record<string, unknown>): SupportedParams {
  const source = raw.supported_parameters ?? raw.supportedParameters ?? raw.parameters;
  const names = new Set<string>();
  const defs: Record<string, Record<string, unknown>> = {};
  const original: Record<string, string> = {};
  if (Array.isArray(source)) {
    for (const name of asStringArray(source)) {
      names.add(name.toLowerCase());
      original[name.toLowerCase()] = name;
    }
  } else {
    const sourceRecord = asRecord(source);
    const nestedParameters = asRecord(sourceRecord.parameters);
    const defaults = asRecord(sourceRecord.defaults);
    const entries = Object.keys(nestedParameters).length > 0
      ? Object.entries(nestedParameters)
      : Object.entries(sourceRecord).filter(([key]) => key !== "parameters" && key !== "defaults");

    for (const [key, value] of entries) {
      const normalizedKey = key.toLowerCase();
      names.add(normalizedKey);
      original[normalizedKey] = key;
      if (Array.isArray(value)) {
        defs[normalizedKey] = { values: value };
        continue;
      }
      if (value && typeof value === "object") {
        const def = { ...asRecord(value) };
        if (def.default === undefined && defaults[key] !== undefined) def.default = defaults[key];
        defs[normalizedKey] = def;
        continue;
      }
      // max_images처럼 숫자 하나로 상한을 공개하는 평면 카탈로그 필드.
      if (typeof value === "number") defs[normalizedKey] = { max: value };
    }
  }
  return { names, defs, original };
}

function paramValues(params: SupportedParams, ...keys: string[]): string[] {
  for (const key of keys) {
    const def = params.defs[key.toLowerCase()];
    if (!def) continue;
    const values = optionValues(def.values ?? def.enum ?? def.options);
    if (values.length > 0) return values;
  }
  return [];
}

function paramDefault(params: SupportedParams, ...keys: string[]): string | null {
  for (const key of keys) {
    const def = params.defs[key.toLowerCase()];
    const value = def?.default;
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function paramMax(params: SupportedParams, ...keys: string[]): number | null {
  for (const key of keys) {
    const def = params.defs[key.toLowerCase()];
    if (!def) continue;
    const max = asNumber(def.max ?? def.maximum ?? def.max_items ?? def.maxItems);
    if (max !== null) return max;
  }
  return null;
}

function hasParam(params: SupportedParams, ...keys: string[]): boolean {
  return keys.some((key) => params.names.has(key.toLowerCase()));
}

/*
 * "resolution" / "n" / 참조 이미지 / 시작 이미지·원본 동영상처럼 이미 전용
 * 필드로 뽑아 쓰는 파라미터를 뺀 나머지를 그대로 노출합니다. supported_parameters
 * 가 문자열 배열(값 정의 없음)로만 온 경우는 컨트롤을 만들 수 없어 건너뜁니다.
 */
/* 화면에 전용 컨트롤이 따로 있는 설정(프롬프트·시드·네거티브 프롬프트)은 일반 설정 목록에서 뺍니다. */
const DEDICATED_KEYS = new Set(["prompt", "seed", "negative_prompt"]);

function extractExtraParams(params: SupportedParams, excludeKeys: Set<string>): ExtraParam[] {
  const result: ExtraParam[] = [];
  for (const [lowerKey, def] of Object.entries(params.defs)) {
    if (excludeKeys.has(lowerKey)) continue;
    // 요청에는 카탈로그에 적힌 원래 이름(예: generateAudio)을 그대로 써야 합니다.
    const key = params.original[lowerKey] ?? lowerKey;
    const declaredTypeEarly = asString(def.type).toLowerCase();
    // 켜기/끄기(switch·boolean) 설정은 "true"/"false" 선택지로 보여 주고, 서버에서 불리언으로 바꿔 보냅니다.
    if (declaredTypeEarly === "switch" || declaredTypeEarly === "boolean" || typeof def.default === "boolean") {
      result.push({
        key,
        kind: "enum",
        values: ["true", "false"],
        default: typeof def.default === "boolean" ? String(def.default) : null,
      });
      continue;
    }
    const values = optionValues(def.values ?? def.enum ?? def.options);
    const min = asNumber(def.min ?? def.minimum);
    const max = asNumber(def.max ?? def.maximum ?? def.max_items ?? def.maxItems);
    const step = asNumber(def.step);
    const defaultValue = typeof def.default === "string" || typeof def.default === "number" ? def.default : null;
    const declaredType = asString(def.type).toLowerCase();

    if (min !== null && max !== null && (declaredType === "range" || declaredType === "number" || declaredType === "integer" || !declaredType)) {
      result.push({ key, kind: "range", min, max, step: step ?? undefined, default: defaultValue });
      continue;
    }
    if (values.length > 0) {
      // 값이 전부 숫자면(예: duration "5"/"10") 마우스로 끄는 슬라이더로도 쓸 수 있게 범위를 함께 채워 둡니다.
      const numericValues = values
        .map((value) => {
          const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:s|sec|secs|second|seconds|초)?$/i);
          return match ? Number(match[1]) : Number.NaN;
        })
        .filter((value) => Number.isFinite(value));
      if (numericValues.length === values.length && numericValues.length > 0) {
        result.push({
          key,
          kind: "range",
          min: Math.min(...numericValues),
          max: Math.max(...numericValues),
          values,
          default: defaultValue,
        });
      } else {
        result.push({ key, kind: "enum", values, default: defaultValue });
      }
      continue;
    }
    if (DEDICATED_KEYS.has(lowerKey)) continue;
    // 범위 없이 숫자만 받는 설정(예: cfg_scale, guidance_scale)은 숫자 입력칸으로.
    if (declaredType === "number" || declaredType === "integer") {
      result.push({
        key,
        kind: "number",
        min: min ?? undefined,
        max: max ?? undefined,
        step: step ?? (declaredType === "integer" ? 1 : undefined),
        default: defaultValue,
      });
      continue;
    }
    // URL 목록·JSON·문구처럼 자유롭게 적는 설정.
    if (declaredType === "text" || declaredType === "string" || declaredType === "textarea") {
      result.push({ key, kind: "text", default: typeof def.default === "string" && def.default ? def.default : null });
    }
  }
  // 카탈로그의 표시 이름·설명·선택지 이름을 붙입니다.
  for (const param of result) {
    const def = params.defs[param.key.toLowerCase()];
    if (!def) continue;
    param.label ??= asString(def.label) || undefined;
    param.description ??= asString(def.description) || undefined;
    const labels = optionLabels(def.values ?? def.enum ?? def.options);
    if (Object.keys(labels).length > 0) param.valueLabels ??= labels;
  }
  return result;
}

/*
 * 가격. 텍스트 모델은 토큰 단가(pricing.prompt / pricing.completion, 토큰 1개
 * 기준 문자열)로 내려오므로 1M 토큰 기준으로 환산합니다. 이미지·동영상·음성
 * 모델은 요청 단위 단가가 내려오는 경우가 있어 perRequest 로 따로 담습니다.
 */
/*
 * NanoGPT 카탈로그의 단가는 숫자 하나이거나 해상도별 객체입니다
 * (예: per_image: { "1k": 0.02, "2k": 0.06, "auto": 0.02 },
 *      per_second_by_resolution: { "720p": 0.08, "1080p": 0.12 }).
 * 객체면 기본 해상도 → auto/default → 가장 싼 값 순으로 하나를 고릅니다.
 */
function tieredPrice(value: unknown, defaultKey?: string): number | null {
  const direct = asNumber(value);
  if (direct !== null) return direct;
  const record = asRecord(value);
  const entries = Object.entries(record)
    .map(([key, price]) => [key, asNumber(price)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null);
  if (entries.length === 0) return null;
  const pick = (key: string | undefined) => (key ? entries.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] : undefined);
  return pick(defaultKey) ?? pick("auto") ?? pick("default") ?? Math.min(...entries.map(([, price]) => price));
}

function extractPricing(raw: Record<string, unknown>): ModelPricing | null {
  const candidate = asRecord(raw.pricing ?? raw.cost ?? raw.price);
  const currency = asString(candidate.currency || candidate.unit) || "USD";

  const perTokenIn = asNumber(candidate.prompt ?? candidate.input ?? candidate.input_tokens);
  const perTokenOut = asNumber(candidate.completion ?? candidate.output ?? candidate.output_tokens);
  const inputPer1M = perTokenIn !== null ? perTokenIn * 1_000_000 : null;
  const outputPer1M = perTokenOut !== null ? perTokenOut * 1_000_000 : null;

  const perRequest =
    tieredPrice(candidate.per_image, asString(candidate.default_resolution))
    ?? tieredPrice(candidate.per_video, asString(candidate.default_resolution))
    ?? asNumber(candidate.image)
    ?? asNumber(candidate.per_request)
    ?? asNumber(candidate.request)
    ?? asNumber(candidate.audio)
    ?? asNumber(raw.cost_per_image)
    ?? asNumber(raw.costPerImage)
    // pricing 자체가 숫자 한 개로 오는 카탈로그(이미지·동영상)도 있습니다.
    ?? asNumber(raw.pricing)
    ?? asNumber(raw.cost)
    ?? asNumber(raw.price);

  // 초당 단가를 건당 단가로 읽으면 동영상 비용이 길이만큼 틀어지므로 따로 담습니다.
  const rawPricing = asRecord(candidate.raw);
  const defaultRes = asString(candidate.default_resolution) || asString(rawPricing.defaultResolution) || undefined;
  // raw 에는 "imageToVideoPricesPerSecond"·"withAudioPricesPerSecond" 같은 해상도별 초당 단가가 들어 있습니다.
  const rawPerSecondKey = Object.keys(rawPricing).find((key) => /PricesPerSecond$/i.test(key));
  const perSecond = tieredPrice(candidate.per_second ?? candidate.perSecond, defaultRes)
    ?? tieredPrice(candidate.per_second_by_resolution, defaultRes)
    ?? (rawPerSecondKey ? tieredPrice(rawPricing[rawPerSecondKey], defaultRes) : null);
  if (inputPer1M === null && outputPer1M === null && perRequest === null && perSecond === null) return null;
  return { inputPer1M, outputPer1M, perRequest, perSecond, currency };
}

function extractVoices(raw: Record<string, unknown>, params: SupportedParams): {
  voices: VoiceInfo[];
  defaultVoice: string | null;
} {
  const source = raw.voices ?? raw.supported_voices ?? params.defs.voice?.values ?? params.defs.voices?.values;
  const voices: VoiceInfo[] = [];
  const push = (id: string, name?: string) => {
    if (id && !voices.some((item) => item.id === id)) voices.push({ id, name: name || id });
  };
  if (Array.isArray(source)) {
    for (const entry of source) {
      if (typeof entry === "string") push(entry);
      else if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        push(
          asString(record.id || record.voice_id || record.voiceId || record.value || record.name),
          asString(record.name || record.label || record.display_name),
        );
      }
    }
  } else if (source && typeof source === "object") {
    // { "en-US": ["luna", "verse"] } 처럼 언어별로 묶여 오는 형태.
    for (const [group, list] of Object.entries(source as Record<string, unknown>)) {
      for (const id of asStringArray(list)) push(id, `${id} (${group})`);
    }
  }
  const fallback = paramDefault(params, "voice") ?? asString(raw.default_voice || raw.defaultVoice);
  return { voices, defaultVoice: fallback || voices[0]?.id || null };
}

/*
 * 능력 플래그 탐색.
 *
 * NanoGPT 카탈로그는 모델·제공자마다 능력 표기 위치와 이름이 제각각입니다.
 * SillyTavern 등 실제 연동 코드가 읽는 `capabilities.vision` 형태가 기본이지만,
 * 같은 정보가 최상위 필드나 `features`, `model_spec.capabilities` 아래에 오기도
 * 하고, 이름도 snake_case·camelCase·supportsXxx 형태가 섞입니다.
 *
 * 그래서 후보 이름들을 여러 위치에서 찾아보고, 어디에서도 언급이 없으면
 * false 가 아니라 null(모름)을 돌려줍니다. false 로 단정하면 카탈로그가
 * 메타데이터를 싣지 않은 모델의 첨부까지 막히기 때문입니다.
 */
function capabilityContainers(raw: Record<string, unknown>): Record<string, unknown>[] {
  const spec = asRecord(raw.model_spec ?? raw.modelSpec);
  return [
    asRecord(raw.capabilities),
    asRecord(raw.features),
    asRecord(spec.capabilities),
    spec,
    raw,
  ];
}

function lookupFlag(raw: Record<string, unknown>, names: string[]): boolean | null {
  for (const container of capabilityContainers(raw)) {
    for (const name of names) {
      const value = container[name];
      if (value === true || value === "true") return true;
      if (value === false || value === "false") return false;
    }
  }
  return null;
}

/*
 * architecture.modality 는 "text+image->text" 처럼 입력·출력 모달리티를 한
 * 문자열로 표현합니다. input_modalities 배열이 없는 응답에서도 이 문자열로
 * 이미지·동영상·오디오 입력 여부를 알 수 있습니다.
 */
function modalityInputs(architecture: Record<string, unknown>): string[] {
  const explicit = asStringArray(architecture.input_modalities ?? architecture.inputModalities);
  if (explicit.length > 0) return explicit;
  const modality = asString(architecture.modality);
  if (!modality) return [];
  const [inputs] = modality.split("->");
  return inputs.split("+").map((part) => part.trim()).filter(Boolean);
}

/**
 * 플래그가 없을 때 쓰는 보조 신호. NanoGPT는 모델 이름·설명에 능력을 적어 두는
 * 경우가 많습니다(예: "DeepSeek V4 Flash Vision Exp Uncensored").
 */
function mentions(haystack: string, pattern: RegExp): boolean {
  return pattern.test(haystack);
}

export function normalizeModel(rawInput: unknown, kind: ModelKind): NormalizedModel {
  const raw = asRecord(rawInput);
  const params = readSupportedParams(raw);
  const capabilities = asRecord(raw.capabilities);
  const architecture = asRecord(raw.architecture);
  const constraints = asRecord(raw.input_reference_constraints ?? raw.inputReferenceConstraints);

  const id = asString(raw.id || raw.model || raw.slug || raw.name);
  const name = asString(raw.name || raw.display_name) || id;
  const apiDescription = asString(raw.description);
  const tags = asStringArray(raw.tags ?? raw.model_sets ?? raw.categories);
  // 이름·설명·태그를 합친 텍스트. 플래그가 없을 때의 보조 판정에 씁니다.
  const haystack = `${id} ${name} ${apiDescription} ${tags.join(" ")}`.toLowerCase();

  const inputModalities = modalityInputs(architecture);

  /*
   * 채팅 첨부 능력. 명시적 플래그 → 모달리티 목록 → 이름·설명 순으로 보고,
   * 어느 근거도 없으면 null(모름)로 둡니다.
   */
  // 무검열 파생 모델은 이름 힌트보다 원본 모델의 비전 지원 여부를 우선합니다.
  const uncensoredFamily = findUncensoredFamily(haystack);

  function resolveInput(names: string[], modality: string, hint: RegExp, familyValue: boolean | null = null): boolean | null {
    const flag = lookupFlag(raw, names);
    if (flag !== null) return flag;
    if (inputModalities.includes(modality)) return true;
    if (familyValue !== null) return familyValue;
    // 무검열 계열이 "제공자별로 다름"(vision: null)이면 이름만 보고 비전으로 단정하지 않습니다.
    const providerDependent = modality === "image" && uncensoredFamily !== null && uncensoredFamily.vision === null;
    if (!providerDependent && mentions(haystack, hint)) return true;
    return inputModalities.length > 0 ? false : null;
  }

  const vision = resolveInput(
    ["vision", "supportsVision", "supports_vision", "image_input", "imageInput", "visionEnabled", "multimodal"],
    "image",
    // 원 개발사가 이미지 입력을 공식 지원한다고 밝힌 중국 모델 계열도 포함합니다
    // (lib/model-attachment-limits.ts 참고). 텍스트 전용 계열은 넣지 않습니다.
    /\bvision\b|\bvl\b|multimodal|qvq|qwen[\d.]*-?omni|qwen3\.[5-9].*(plus|flash|max)|glm-?\d(\.\d)?v\b|glm-?5\.\d-?flash|kimi-?k2[.-]?[5-9]|kimi-?k3|minimax-?m3|ernie-?5|mimo-?v2.*omni|step-?3|seed-?(1\.6-vision|2\.\d)/,
    uncensoredFamily?.vision ?? null,
  );
  const videoInput = resolveInput(
    ["video_input", "videoInput", "supportsVideoInput", "supportsVideo", "supports_video"],
    "video",
    /video[- ]?(input|understanding)|\bvideo\b.{0,20}\b(input|understand)/,
  );
  const audioInput = resolveInput(
    ["audio_input", "audioInput", "supportsAudioInput", "supportsAudio", "supports_audio"],
    "audio",
    /audio[- ]?input/,
  );
  // PDF는 모달리티 목록에서 "file"로 표현되기도 합니다.
  const pdfFlag = lookupFlag(raw, ["pdf_upload", "pdfUpload", "supportsPdf", "supports_pdf", "pdf", "file_upload", "fileUpload"]);
  const pdfUpload = pdfFlag !== null
    ? pdfFlag
    : inputModalities.includes("file") || inputModalities.includes("pdf")
      ? true
      : inputModalities.length > 0 ? false : null;

  /*
   * 이미지 생성 참조 이미지 제약. 카탈로그가 값을 싣지 않으면 null(미공개)로
   * 두고, 정책 단계에서 기본 허용치를 적용합니다.
   */
  /*
   * NanoGPT 이미지 카탈로그(/api/v1/image-models?detailed=true, 2026-09 확인)는 입력
   * 이미지 한도를 supported_parameters.max_input_images 와
   * supported_parameters.input_image_constraints.{max_items, route.max_bytes, route.formats}
   * 로 공개합니다. 예전 필드(input_reference_constraints·input_references 범위)도 함께 읽습니다.
   * capabilities.image_to_image 가 false 이고 입력 모달리티에 image 가 없으면
   * (text-to-image 전용 경로) 참조 이미지를 받지 않습니다.
   */
  const spRecord = asRecord(raw.supported_parameters ?? raw.supportedParameters);
  const imageConstraints = asRecord(spRecord.input_image_constraints ?? spRecord.inputImageConstraints);
  const imageRoute = asRecord(imageConstraints.route);
  const noImageInput = capabilities.image_to_image === false && inputModalities.length > 0 && !inputModalities.includes("image");
  const catalogInputMax = asNumber(spRecord.max_input_images ?? spRecord.maxInputImages)
    ?? asNumber(imageConstraints.max_items ?? imageConstraints.maxItems)
    ?? asNumber(constraints.max_items ?? constraints.maxItems)
    ?? paramMax(params, "input_references", "imageDataUrls", "images")
    ?? null;
  const maxInputReferences = kind === "image" && noImageInput ? 0 : catalogInputMax;
  const referenceFormats = asStringArray(imageRoute.formats ?? constraints.formats ?? constraints.supported_formats);
  const referenceMaxBytes = asNumber(imageRoute.max_bytes ?? constraints.max_bytes ?? constraints.maxBytes);

  const resolutions = paramValues(params, "resolution", "resolutions", "size", "sizes");
  const defaultResolution = paramDefault(params, "resolution", "size");
  const maxOutputImages = paramMax(
    params,
    "n", "num_images", "numImages", "max_images", "max_output_images",
  ) ?? 1;
  // 이미 전용 필드로 뽑은 파라미터(해상도·장수·참조 이미지 계열)는 빼고, 나머지
  // (비율·품질·스타일 등)를 모델별 설정 컨트롤로 그대로 넘깁니다.
  const imageExclude = new Set([
    "resolution", "resolutions", "size", "sizes", "n", "num_images", "numimages",
    "input_references", "imagedataurl", "imagedataurls", "image_url", "images", "imageurl",
    // 한도 정보(설정 컨트롤이 아님)
    "max_images", "max_output_images", "max_input_images", "input_image_constraints", "fixed_image_count",
  ]);
  // 카탈로그가 공개하지 않은 설정은 제작사 공식 문서로 확인한 값으로 보강합니다
  // (lib/image-settings-overlay.ts).
  const imageOverlay = kind === "image" ? findImageSettingsOverlay(id, name) : null;
  // LoRA: 카탈로그가 supported_parameters.loras.url_fields(예: lora_url_1~3)로 공개하면
  // 주소 입력칸과 가중치(scale) 입력칸을 짝지어 보여 줍니다.
  const loraSpec = asRecord(spRecord.loras);
  const loraFields = asStringArray(loraSpec.url_fields ?? loraSpec.urlFields);
  const loraParams: ExtraParam[] = kind === "image"
    ? loraFields.flatMap((field, index) => [
        { key: field, kind: "text" as const, label: `LoRA ${index + 1} 주소`, description: "LoRA 가중치 파일의 HTTPS 주소", default: null },
        { key: field.replace(/url/i, "scale"), kind: "number" as const, label: `LoRA ${index + 1} 강도`, min: 0, max: 2, step: 0.05, default: null },
      ])
    : [];
  const imageParams = kind === "image"
    ? [...mergeOfficialImageParams(extractExtraParams(params, new Set([...imageExclude, "loras"])), imageOverlay), ...loraParams]
    : [];

  /*
   * 동영상 생성 입력(시작 이미지) 판정.
   *
   * 이전 구현은 "supported_parameters에 imageUrl류 키가 없고, 그 밖의
   * 파라미터(duration 등)는 있음(paramsKnown=true)"이면 곧바로 false로
   * 단정했습니다. 그런데 실제 NanoGPT 동영상 API 조사 결과, 다음 두 가지가
   * 확인됩니다.
   *   1) 실제 요청 필드로 imageUrl / imageDataUrl 이 여러 모델에서 통용됩니다
   *      (예: kling-v21-pro 요청 예시에 "imageUrl": "https://..." 가 그대로
   *      쓰임 — NanoGPT 블로그 "How to Calculate AI Image API Costs" 예시).
   *   2) "Unified" 모델(예: Wan 2.7, HappyHorse)은 "routes to text-to-video,
   *      image-to-video, reference-to-video, or video edit based on the
   *      inputs you provide"처럼 어떤 필드를 채워 보내느냐로 모드가 정해지는
   *      구조라서, 이미지 입력을 supported_parameters의 "튜닝 가능한 옵션"
   *      목록에 아예 넣지 않는 경우가 흔합니다(duration·resolution처럼
   *      "설정값"이 아니라 "선택적 입력 필드"이기 때문).
   * 즉 supported_parameters에 이미지 키가 없다는 사실 자체가 "이미지를 못
   * 받는다"는 증거가 되지 못합니다. 그래서 긍정 신호(선언된 파라미터,
   * "image-to-video"/"i2v" 언급)가 있으면 true, 명시적으로 "text-to-video만
   * 지원"이라고 알 수 있는 부정 신호가 있을 때만 false, 그 외에는 전부
   * null(미확인)로 두어 정책 단계(lib/attachment-policy.ts)의 허용 기본값을
   * 따르게 합니다.
   */
  const imageParam = hasParam(
    params,
    "imageurl", "image_url", "imagedataurl", "image_data_url", "image", "input_references", "start_image", "init_image",
    "firstframeimage", "first_frame_image", "firstframe", "startframe", "referenceimage", "reference_image",
  );
  const acceptsStartImage = imageParam || (maxInputReferences ?? 0) > 0
    ? true
    : mentions(haystack, /image[- ]?to[- ]?video|\bi2v\b|first[- ]?frame|unified|multi-?modal/)
      ? true
      // "text-to-video"만 언급되고 이미지·통합 관련 신호가 전혀 없을 때만
      // 명시적 미지원으로 봅니다. 그 밖에는 판단 근거가 부족하므로 null.
      : mentions(haystack, /\btext[- ]?to[- ]?video\b|\bt2v\b/)
          && !mentions(haystack, /image|i2v|unified|multi-?modal|first[- ]?frame/)
        ? false
        : null;
  // 참조 이미지를 여러 장 받는 동영상 파라미터. 카탈로그가 공개한 최대 장수를 그대로 씁니다.
  const videoReferenceKey = [
    "reference_images", "referenceimages", "reference_image_urls", "referenceimageurls",
    "reference_image_data_urls", "referenceimagedataurls", "image_urls", "imageurls", "imagedataurls", "input_references",
  ].find((key) => params.names.has(key));
  // NanoGPT 동영상 카탈로그는 reference_images 를 "JSON array of image URLs" 텍스트로 공개하고
  // 장수는 설명에만 적습니다(예: minimax-h3 "Up to 9 reference images"). 설명에 장수가 없으면
  // 원 개발사 공식 한도(lib/model-attachment-limits.ts), 그것도 없으면 4장을 씁니다.
  const referenceDescription = videoReferenceKey ? asString(params.defs[videoReferenceKey]?.description) : "";
  const describedMax = /up to\s+(\d+)/i.exec(referenceDescription)?.[1];
  const videoReferenceMax = videoReferenceKey
    ? paramMax(params, videoReferenceKey)
      ?? (describedMax ? Number(describedMax) : null)
      ?? asNumber(constraints.max_items ?? constraints.maxItems)
      ?? findVideoInputLimit(id, name)?.referenceImages
      ?? 4
    : null;
  const videoReferenceImages = kind === "video" && videoReferenceKey && videoReferenceMax && videoReferenceMax > 0
    ? { key: params.original[videoReferenceKey] ?? videoReferenceKey, max: videoReferenceMax }
    : null;
  // 끝 프레임 입력(예: last_image). 카탈로그가 공개한 모델은 오버레이 없이도 끝 프레임을 받습니다.
  const endFrameKey = ["last_image", "end_image", "image_tail", "tail_image", "last_frame_image", "lastframeimage"]
    .find((key) => params.names.has(key));
  const videoParam = hasParam(params, "videourl", "video_url", "videodataurl", "source_video");
  const acceptsSourceVideo = videoParam
    ? true
    // reference-to-video(예: Seedance 2.0 reference)는 참조 동영상을 받습니다(BytePlus 공식 문서).
    : mentions(haystack, /extend|video[- ]?to[- ]?video|\bv2v\b|video[- ]?edit|reference[- ]?to[- ]?video/)
      ? true
      : null;
  // 시작 이미지·원본 동영상 입력 파라미터는 빼고, 나머지(길이·해상도·품질 등)를
  // 모델별 설정 컨트롤로 그대로 넘깁니다.
  const videoExclude = new Set([
    "imageurl", "image_url", "imagedataurl", "image_data_url", "image", "input_references", "start_image", "init_image",
    "videourl", "video_url", "videodataurl", "source_video",
    "reference_images", "referenceimages", "reference_image_urls", "referenceimageurls",
    "reference_image_data_urls", "referenceimagedataurls", "image_urls", "imageurls", "imagedataurls",
    "last_image", "end_image", "image_tail", "tail_image", "last_frame_image", "lastframeimage",
  ]);
  const rawVideoParams = kind === "video" ? extractExtraParams(params, videoExclude) : [];
  // 값 목록·범위 없이 이름만 공개된 자유 입력 파라미터(예: negative_prompt, seed).
  const freeTextParams = Array.from(params.names).filter((key) => {
    if (videoExclude.has(key) || imageExclude.has(key)) return false;
    const def = params.defs[key];
    if (!def) return true;
    // 켜기/끄기 설정은 extractExtraParams 가 선택 컨트롤로 따로 만듭니다.
    const type = asString(def.type).toLowerCase();
    if (type === "switch" || type === "boolean" || typeof def.default === "boolean") return false;
    return optionValues(def.values ?? def.enum ?? def.options).length === 0
      && asNumber(def.min ?? def.minimum) === null
      && asNumber(def.max ?? def.maximum) === null;
  });
  // 원 개발사 자료로 확인된 길이 상한이 있으면 카탈로그 값을 그 이상으로
  // 넓히지 않고 좁히기만 합니다(lib/model-capability-overlay.ts 상단 설명 참고).
  const videoOverlay = kind === "video" ? findVideoOverlay(id, name) : null;
  const videoParams = videoOverlay?.duration
    ? applyDurationOverlay(rawVideoParams, videoOverlay.duration)
    : rawVideoParams;
  const extraImageRoles: ImageRoleOverlay[] = [...(videoOverlay?.imageRoles ?? [])];
  if (kind === "video" && endFrameKey && !extraImageRoles.some((role) => role.role === "end_frame")) {
    extraImageRoles.push({ role: "end_frame", field: params.original[endFrameKey] ?? endFrameKey, max: 1, labelKo: "끝 프레임" });
  }
  const durationNote = videoOverlay?.duration?.note ?? null;

  const voiceResult = extractVoices(raw, params);
  const supportedFormats = paramValues(params, "format", "response_format", "formats")
    .concat(asStringArray(raw.formats ?? raw.supported_formats));
  const uniqueFormats = Array.from(new Set(supportedFormats));

  const maxInputLength = asNumber(
    raw.max_input_size ?? raw.maxInputSize ?? raw.max_input_length ?? raw.maxInputLength ?? raw.max_characters,
  );

  return {
    id,
    kind,
    name,
    // 공식 문서 기반 정적 한글 설명이 있으면 우선 사용하고, 없으면 API 설명을 사용합니다.
    description: modelDescription(id) || apiDescription,
    /*
     * NanoGPT는 무검열 모델을 별도 불리언으로 표시하지 않고 모델 이름에 적어
     * 두는 경우가 많습니다(예: "DeepSeek V4 Flash Vision Exp Uncensored").
     * 그래서 플래그가 있으면 그것을 쓰고, 없으면 이름·설명·태그에서 찾습니다.
     */
    uncensored: lookupFlag(raw, ["uncensored", "isUncensored", "nsfw", "is_nsfw"])
      ?? mentions(haystack, /uncensored|unfiltered|abliterated|derestricted|jailbroken|\bnsfw\b/),
    pricing: extractPricing(raw),

    vision,
    videoInput,
    audioInput,
    pdfUpload,
    inputModalities,
    contextWindow: asNumber(raw.context_length ?? raw.contextLength ?? raw.context_window),
    maxOutputTokens: asNumber(raw.max_output_tokens ?? raw.maxOutputTokens),

    maxInputReferences,
    referenceFormats,
    referenceMaxBytes,
    freeTextParams,
    resolutions: resolutions.length > 0 ? resolutions : (imageOverlay?.resolutions ?? []),
    officialResolutions: resolutions.length === 0 && Boolean(imageOverlay?.resolutions?.length),
    officialMaxImages: imageOverlay?.officialMaxImages ?? null,
    settingsSource: imageOverlay?.source ?? null,
    defaultResolution,
    maxOutputImages: Math.max(1, maxOutputImages),
    imageParams,

    acceptsStartImage,
    videoReferenceImages,
    acceptsSourceVideo,
    videoParams,
    extraImageRoles,
    durationNote,

    voices: voiceResult.voices,
    defaultVoice: voiceResult.defaultVoice,
    supportedFormats: uniqueFormats,
    defaultFormat: paramDefault(params, "format", "response_format")
      || asString(raw.default_format)
      || uniqueFormats[0]
      || null,
    maxInputLength,
  };
}

export function modelDisplayLabel(model: NormalizedModel): string {
  const badges: string[] = [];
  if (model.kind === "text") {
    if (model.vision) badges.push("비전");
    // 무검열 비전 모델 중 동영상을 인식하는 모델은 "동영상"을 따로 표시합니다.
    if (model.videoInput) badges.push("동영상");
    if (model.audioInput) badges.push("오디오");
    if (model.pdfUpload) badges.push("PDF");
  } else if (model.kind === "image") {
    if (model.maxInputReferences !== null && model.maxInputReferences > 0) {
      badges.push(`참조 ${model.maxInputReferences}`);
    }
  } else if (model.kind === "video") {
    if (model.acceptsStartImage) badges.push("이미지→동영상");
    if (model.acceptsSourceVideo) badges.push("동영상 확장");
  }
  if (model.uncensored) badges.push("무검열");
  const suffix = badges.length ? ` (${badges.join(" / ")})` : "";
  const context = model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k` : "";
  return `${model.name}${suffix}${context}`;
}
