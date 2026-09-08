import { modelDescription } from "./model-descriptions";

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
 * - 영상(/v1/video-models?detailed=true): 모델마다 받는 입력이 달라
 *   supported_parameters 에 imageUrl/imageDataUrl(이미지→영상) 또는
 *   videoUrl(영상 확장·편집)이 나타납니다.
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
 * 이미지·영상 생성 모델이 supported_parameters로 공개한 그 밖의 설정값입니다.
 * NanoGPT 공식 문서: "Parameter support varies by model, and parameters
 * should be treated as discoverable via supported_parameters, not as
 * globally supported fields." 그래서 비율·품질·스타일(이미지), 해상도·품질
 * (영상) 같은 값을 앱에 고정된 목록으로 두지 않고, 모델이 실제로 공개한
 * 파라미터만 그대로 노출합니다. 참조 이미지·해상도·생성 장수처럼 이미 전용
 * 필드가 있는 파라미터(resolution, n, imageUrl 등)는 제외됩니다.
 */
export interface ExtraParam {
  /** NanoGPT에 보낼 때 쓰는 원래 파라미터 이름(예: aspect_ratio, quality, style, duration). */
  key: string;
  kind: "enum" | "range";
  /** enum일 때 고를 수 있는 값 목록. */
  values?: string[];
  /** range이거나, 값이 전부 숫자인 enum일 때 슬라이더로 보여주기 위한 범위. */
  min?: number;
  max?: number;
  step?: number;
  default?: string | number | null;
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
  /** 이미지·영상·음성처럼 요청(또는 결과물) 단위로 과금되는 모델의 단가. */
  perRequest: number | null;
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
  imageParams: ExtraParam[];

  /* ------------------------------------------------------- 영상 생성 모델 */
  /** imageUrl / imageDataUrl 을 받는 image-to-video 계열인지. null이면 미공개. */
  acceptsStartImage: boolean | null;
  /** videoUrl 을 받는 영상 확장·편집 계열인지. null이면 미공개. */
  acceptsSourceVideo: boolean | null;
  /** 시작 이미지·원본 영상 외에 모델이 공개한 나머지 설정(길이·해상도·품질 등). */
  videoParams: ExtraParam[];

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
 * - 현재 영상 카탈로그: { parameters: { duration: { options: [...] } }, defaults: {...} }
 * - 현재 이미지 카탈로그: { resolutions: [...], aspect_ratio: [...], max_images: 4 }
 * - 문자열 배열(OpenRouter 호환): ["temperature", "tools", ...]
 * 둘 다 다룰 수 있도록 "파라미터 이름 집합"과 "이름→정의 맵"을 함께 만듭니다.
 */
interface SupportedParams {
  names: Set<string>;
  defs: Record<string, Record<string, unknown>>;
}

function readSupportedParams(raw: Record<string, unknown>): SupportedParams {
  const source = raw.supported_parameters ?? raw.supportedParameters ?? raw.parameters;
  const names = new Set<string>();
  const defs: Record<string, Record<string, unknown>> = {};
  if (Array.isArray(source)) {
    for (const name of asStringArray(source)) names.add(name.toLowerCase());
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
  return { names, defs };
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
    const max = asNumber(def.max ?? def.maximum);
    if (max !== null) return max;
  }
  return null;
}

function hasParam(params: SupportedParams, ...keys: string[]): boolean {
  return keys.some((key) => params.names.has(key.toLowerCase()));
}

/*
 * "resolution" / "n" / 참조 이미지 / 시작 이미지·원본 영상처럼 이미 전용
 * 필드로 뽑아 쓰는 파라미터를 뺀 나머지를 그대로 노출합니다. supported_parameters
 * 가 문자열 배열(값 정의 없음)로만 온 경우는 컨트롤을 만들 수 없어 건너뜁니다.
 */
function extractExtraParams(params: SupportedParams, excludeKeys: Set<string>): ExtraParam[] {
  const result: ExtraParam[] = [];
  for (const [key, def] of Object.entries(params.defs)) {
    if (excludeKeys.has(key)) continue;
    const values = optionValues(def.values ?? def.enum ?? def.options);
    const min = asNumber(def.min ?? def.minimum);
    const max = asNumber(def.max ?? def.maximum);
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
    }
  }
  return result;
}

/*
 * 가격. 텍스트 모델은 토큰 단가(pricing.prompt / pricing.completion, 토큰 1개
 * 기준 문자열)로 내려오므로 1M 토큰 기준으로 환산합니다. 이미지·영상·음성
 * 모델은 요청 단위 단가가 내려오는 경우가 있어 perRequest 로 따로 담습니다.
 */
function extractPricing(raw: Record<string, unknown>): ModelPricing | null {
  const candidate = asRecord(raw.pricing ?? raw.cost ?? raw.price);
  const currency = asString(candidate.currency || candidate.unit) || "USD";

  const perTokenIn = asNumber(candidate.prompt ?? candidate.input ?? candidate.input_tokens);
  const perTokenOut = asNumber(candidate.completion ?? candidate.output ?? candidate.output_tokens);
  const inputPer1M = perTokenIn !== null ? perTokenIn * 1_000_000 : null;
  const outputPer1M = perTokenOut !== null ? perTokenOut * 1_000_000 : null;

  const perRequest =
    asNumber(candidate.per_image)
    ?? asNumber(candidate.image)
    ?? asNumber(candidate.per_request)
    ?? asNumber(candidate.request)
    ?? asNumber(candidate.per_second)
    ?? asNumber(candidate.audio)
    ?? asNumber(raw.cost_per_image)
    ?? asNumber(raw.costPerImage)
    // pricing 자체가 숫자 한 개로 오는 카탈로그(이미지·영상)도 있습니다.
    ?? asNumber(raw.pricing)
    ?? asNumber(raw.cost)
    ?? asNumber(raw.price);

  if (inputPer1M === null && outputPer1M === null && perRequest === null) return null;
  return { inputPer1M, outputPer1M, perRequest, currency };
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
 * 이미지·영상·오디오 입력 여부를 알 수 있습니다.
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
  function resolveInput(names: string[], modality: string, hint: RegExp): boolean | null {
    const flag = lookupFlag(raw, names);
    if (flag !== null) return flag;
    if (inputModalities.includes(modality)) return true;
    if (mentions(haystack, hint)) return true;
    return inputModalities.length > 0 ? false : null;
  }

  const vision = resolveInput(
    ["vision", "supportsVision", "supports_vision", "image_input", "imageInput", "visionEnabled", "multimodal"],
    "image",
    /\bvision\b|\bvl\b|multimodal/,
  );
  const videoInput = resolveInput(
    ["video_input", "videoInput", "supportsVideoInput", "supportsVideo", "supports_video"],
    "video",
    /video[- ]?input/,
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
  const maxInputReferences = asNumber(constraints.max_items ?? constraints.maxItems)
    ?? paramMax(params, "input_references", "imageDataUrls", "images")
    ?? null;
  const referenceFormats = asStringArray(constraints.formats ?? constraints.supported_formats);
  const referenceMaxBytes = asNumber(constraints.max_bytes ?? constraints.maxBytes);

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
  ]);
  const imageParams = kind === "image" ? extractExtraParams(params, imageExclude) : [];

  /*
   * 영상 생성 입력(시작 이미지) 판정.
   *
   * 이전 구현은 "supported_parameters에 imageUrl류 키가 없고, 그 밖의
   * 파라미터(duration 등)는 있음(paramsKnown=true)"이면 곧바로 false로
   * 단정했습니다. 그런데 실제 NanoGPT 영상 API 조사 결과, 다음 두 가지가
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
  const videoParam = hasParam(params, "videourl", "video_url", "videodataurl", "source_video");
  const acceptsSourceVideo = videoParam
    ? true
    : mentions(haystack, /extend|video[- ]?to[- ]?video|\bv2v\b|video[- ]?edit/)
      ? true
      : null;
  // 시작 이미지·원본 영상 입력 파라미터는 빼고, 나머지(길이·해상도·품질 등)를
  // 모델별 설정 컨트롤로 그대로 넘깁니다.
  const videoExclude = new Set([
    "imageurl", "image_url", "imagedataurl", "image_data_url", "image", "input_references", "start_image", "init_image",
    "videourl", "video_url", "videodataurl", "source_video",
  ]);
  const videoParams = kind === "video" ? extractExtraParams(params, videoExclude) : [];

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
    resolutions,
    defaultResolution,
    maxOutputImages: Math.max(1, maxOutputImages),
    imageParams,

    acceptsStartImage,
    acceptsSourceVideo,
    videoParams,

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
    if (model.videoInput) badges.push("영상");
    if (model.audioInput) badges.push("오디오");
    if (model.pdfUpload) badges.push("PDF");
  } else if (model.kind === "image") {
    if (model.maxInputReferences !== null && model.maxInputReferences > 0) {
      badges.push(`참조 ${model.maxInputReferences}`);
    }
  } else if (model.kind === "video") {
    if (model.acceptsStartImage) badges.push("이미지→영상");
    if (model.acceptsSourceVideo) badges.push("영상 확장");
  }
  if (model.uncensored) badges.push("무검열");
  const suffix = badges.length ? ` (${badges.join(" / ")})` : "";
  const context = model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k` : "";
  return `${model.name}${suffix}${context}`;
}
