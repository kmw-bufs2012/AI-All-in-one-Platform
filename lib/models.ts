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
  /** capabilities.vision — 이미지를 이해하는 모델인지. */
  vision: boolean;
  /** capabilities.video_input — 동영상 파일을 직접 입력받는지. */
  videoInput: boolean;
  /** capabilities.audio_input — 오디오 파일을 직접 입력받는지. */
  audioInput: boolean;
  /** capabilities.pdf_upload — PDF 문서를 직접 업로드할 수 있는지. */
  pdfUpload: boolean;
  /** architecture.input_modalities — ["text", "image", "video", "audio", "file"] 등. */
  inputModalities: string[];
  contextWindow: number | null;
  maxOutputTokens: number | null;

  /* ------------------------------------------------------ 이미지 생성 모델 */
  /** input_reference_constraints.max_items — 참조 이미지 최대 장수. */
  maxInputReferences: number;
  /** input_reference_constraints.formats — 참조 이미지 허용 형식(png/jpeg/webp). */
  referenceFormats: string[];
  /** input_reference_constraints.max_bytes — 참조 이미지 1장 최대 크기. */
  referenceMaxBytes: number | null;
  /** supported_parameters.resolution.values — 지원 해상도 목록. */
  resolutions: string[];
  defaultResolution: string | null;
  /** supported_parameters.n.max — 한 번에 생성할 수 있는 이미지 장수. */
  maxOutputImages: number;

  /* ------------------------------------------------------- 영상 생성 모델 */
  /** imageUrl / imageDataUrl 을 받는 image-to-video 계열인지. */
  acceptsStartImage: boolean;
  /** videoUrl 을 받는 영상 확장·편집 계열인지. */
  acceptsSourceVideo: boolean;
  maxStartImages: number;

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

/**
 * supported_parameters 는 두 가지 형태로 내려옵니다.
 * - 객체 맵: { resolution: { type: "enum", values: [...], default: "..." } }
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
    for (const [key, value] of Object.entries(asRecord(source))) {
      names.add(key.toLowerCase());
      defs[key.toLowerCase()] = asRecord(value);
    }
  }
  return { names, defs };
}

function paramValues(params: SupportedParams, ...keys: string[]): string[] {
  for (const key of keys) {
    const def = params.defs[key.toLowerCase()];
    if (!def) continue;
    const values = asStringArray(def.values ?? def.enum ?? def.options);
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

export function normalizeModel(rawInput: unknown, kind: ModelKind): NormalizedModel {
  const raw = asRecord(rawInput);
  const params = readSupportedParams(raw);
  const capabilities = asRecord(raw.capabilities);
  const architecture = asRecord(raw.architecture);
  const constraints = asRecord(raw.input_reference_constraints ?? raw.inputReferenceConstraints);

  const id = asString(raw.id || raw.model || raw.slug || raw.name);
  const inputModalities = asStringArray(architecture.input_modalities ?? architecture.inputModalities);

  /* 채팅 첨부 능력. capabilities 플래그가 1차 근거이고, 공식 문서가 "catalog
   * fields are additive — inspect both architecture modalities and capability
   * flags" 라고 안내하므로 input_modalities 도 함께 봅니다. */
  const vision = asBool(capabilities.vision) || inputModalities.includes("image");
  const videoInput = asBool(capabilities.video_input) || inputModalities.includes("video");
  const audioInput = asBool(capabilities.audio_input) || inputModalities.includes("audio");
  const pdfUpload = asBool(capabilities.pdf_upload)
    || inputModalities.includes("file")
    || inputModalities.includes("pdf");

  /* 이미지 생성 참조 이미지 제약. */
  const maxInputReferences = asNumber(constraints.max_items ?? constraints.maxItems) ?? 0;
  const referenceFormats = asStringArray(constraints.formats ?? constraints.supported_formats);
  const referenceMaxBytes = asNumber(constraints.max_bytes ?? constraints.maxBytes);

  const resolutions = paramValues(params, "resolution", "resolutions", "size", "sizes");
  const defaultResolution = paramDefault(params, "resolution", "size");
  const maxOutputImages = paramMax(params, "n", "num_images", "numImages") ?? 1;

  /* 영상 생성 입력. 모델이 실제로 받는 파라미터로 판정합니다. */
  const acceptsStartImage = hasParam(
    params,
    "imageurl", "image_url", "imagedataurl", "image_data_url", "image", "input_references", "start_image",
  ) || maxInputReferences > 0;
  const acceptsSourceVideo = hasParam(params, "videourl", "video_url", "videodataurl", "video");

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
    name: asString(raw.name || raw.display_name) || id,
    // 공식 문서 기반 정적 한글 설명이 있으면 우선 사용하고, 없으면 API 설명을 사용합니다.
    description: modelDescription(id) || asString(raw.description),
    uncensored: asBool(raw.uncensored)
      || asBool(capabilities.uncensored)
      || asStringArray(raw.tags).some((tag) => /uncensored|nsfw/i.test(tag)),
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

    acceptsStartImage,
    acceptsSourceVideo,
    maxStartImages: acceptsStartImage ? Math.max(1, maxInputReferences || 1) : 0,

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
    if (model.maxInputReferences > 0) badges.push(`참조 ${model.maxInputReferences}`);
  } else if (model.kind === "video") {
    if (model.acceptsStartImage) badges.push("이미지→영상");
    if (model.acceptsSourceVideo) badges.push("영상 확장");
  }
  if (model.uncensored) badges.push("무검열");
  const suffix = badges.length ? ` (${badges.join(" / ")})` : "";
  const context = model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k` : "";
  return `${model.name}${suffix}${context}`;
}
