import { modelDescription } from "./model-descriptions";

export interface VoiceInfo {
  id: string;
  name: string;
}

export interface ModelPricing {
  inputPer1M: number | null;
  outputPer1M: number | null;
  currency: string | null;
}

export interface NormalizedModel {
  id: string;
  name: string;
  description: string;
  uncensored: boolean;
  lmm: boolean;
  /**
   * Venice API의 model_spec.capabilities.supportsMultipleImages. 채팅 메시지 하나에
   * 이미지를 여러 장 보냈을 때, false면 마지막 이미지가 담긴 메시지의 이미지만
   * 실제로 모델에 전달됩니다(공식 문서: "For single-image vision models, only the
   * last image-containing message retains its images").
   */
  supportsMultipleImages: boolean;
  /**
   * model_spec.capabilities.maxImages. supportsMultipleImages가 true일 때만
   * 존재하는, 요청당 최대 이미지 개수(공식 스키마 예시: 10).
   */
  maxImages: number;
  /**
   * model_spec.capabilities.supportsVideoInput. 채팅 모델이 동영상(video_url)
   * 입력을 직접 지원하는지 여부입니다. 영상 생성 모델의 시작 이미지 지원
   * (supportsVideoInput, constraints.model_type)과는 다른 축이라 이름이
   * 겹치지만 출처가 다릅니다.
   */
  chatVideoInput: boolean;
  /**
   * model_spec.capabilities.maxVideos. supportsVideoInput이 true일 때만 존재하는,
   * 채팅 요청당 최대 동영상 첨부 개수(공식 스키마 예시: 4). 단, API 차원에서
   * "At most 3 videos may be provided in one request" 상한이 있어 min(maxVideos, 3)으로
   * 적용합니다.
   */
  maxVideos: number;
  /** model_spec.capabilities.supportsAudioInput. 채팅 모델의 오디오 입력 지원 여부. */
  supportsAudioInput: boolean;
  /**
   * model_spec.supportsStyleReferences. 이미지 생성 모델이 style_references
   * (POST /image/generate)를 받는지 여부.
   */
  supportsStyleReferences: boolean;
  /**
   * model_spec.maxStyleReferences. style_references 최대 개수. 필드가 없으면
   * 공식 스키마의 multi-edit 기본값(3)을 사용합니다.
   */
  maxStyleReferences: number;
  contextWindow: number | null;
  voices: VoiceInfo[];
  defaultVoice: string | null;
  pricing: ModelPricing | null;
  /**
   * 영상 생성 모델의 시작 이미지(QueueVideoRequest.image_url) 지원 여부.
   * 공식 스키마의 VideoModelConstraints.model_type이 "image-to-video"인지로
   * 판정합니다(legacy 필드와 모델 ID 패턴은 폴백).
   */
  supportsVideoInput: boolean;
  /**
   * 영상 생성 모델의 VideoModelConstraints.model_type:
   * "image-to-video" | "text-to-video" | "video".
   */
  videoModelType: string | null;
  supportedFormats: string[];
  defaultFormat: string | null;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  uncensored?: unknown;
  supportsVision?: unknown;
  vision?: unknown;
  pricing?: unknown;
  availableContextWindow?: unknown;
  context_length?: unknown;
  model_spec?: Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickSpec(raw: RawModel): Record<string, unknown> {
  return raw.model_spec && typeof raw.model_spec === "object" ? raw.model_spec : {};
}

function pickCapabilities(spec: Record<string, unknown>): Record<string, unknown> {
  const caps = spec.capabilities;
  return caps && typeof caps === "object" ? (caps as Record<string, unknown>) : {};
}

function extractPricing(spec: Record<string, unknown>, raw: RawModel): ModelPricing | null {
  const candidate = (spec.pricing ?? raw.pricing) as Record<string, unknown> | undefined;
  if (!candidate || typeof candidate !== "object") return null;
  const currency = asString(candidate.currency || candidate.unit || candidate.denomination) || "USD";
  const inputKeys = ["tokens_in", "input", "input_per_1m", "inputPer1M", "price_in", "prompt"];
  const outputKeys = ["tokens_out", "output", "output_per_1m", "outputPer1M", "price_out", "completion"];
  const input = inputKeys.map((key) => asNumber(candidate[key])).find((v) => v !== null) ?? null;
  const output = outputKeys.map((key) => asNumber(candidate[key])).find((v) => v !== null) ?? null;
  if (input === null && output === null) return null;
  return { inputPer1M: input, outputPer1M: output, currency };
}

function extractVoices(spec: Record<string, unknown>): { voices: VoiceInfo[]; defaultVoice: string | null } {
  const rawVoices = spec.voices;
  const voices: VoiceInfo[] = [];
  if (Array.isArray(rawVoices)) {
    for (const entry of rawVoices) {
      if (typeof entry === "string") {
        voices.push({ id: entry, name: entry });
      } else if (entry && typeof entry === "object") {
        const id = asString((entry as Record<string, unknown>).id || (entry as Record<string, unknown>).voice_id);
        if (id) voices.push({ id, name: asString((entry as Record<string, unknown>).name) || id });
      }
    }
  }
  return { voices, defaultVoice: asString(spec.default_voice) || (voices[0]?.id ?? null) };
}

export function normalizeModel(raw: unknown): NormalizedModel {
  const model = (raw ?? {}) as RawModel;
  const spec = pickSpec(model);
  const capabilities = pickCapabilities(spec);
  const constraints = spec.constraints && typeof spec.constraints === "object"
    ? (spec.constraints as Record<string, unknown>)
    : {};

  const lmm = asBool(capabilities.supportsVision)
    || asBool(capabilities.vision)
    || asBool(spec.vision)
    || asBool(model.supportsVision);

  const supportsMultipleImages = asBool(capabilities.supportsMultipleImages);

  // 공식 스키마: capabilities.maxImages는 supportsMultipleImages일 때만 존재.
  // 이미지 개수 제한이 없는 fallback은 앱 안전 상한(10)을 씁니다.
  const maxImages = asNumber(capabilities.maxImages) ?? 10;

  // 공식 스키마: capabilities.supportsVideoInput / maxVideos (채팅 동영상 첨부).
  const chatVideoInput = asBool(capabilities.supportsVideoInput);
  const maxVideos = asNumber(capabilities.maxVideos) ?? 3;

  const supportsAudioInput = asBool(capabilities.supportsAudioInput);

  // 공식 스키마: model_spec.supportsStyleReferences / maxStyleReferences (이미지 생성).
  const supportsStyleReferences = asBool(spec.supportsStyleReferences)
    || asBool(spec.supports_style_references);
  const maxStyleReferences = asNumber(spec.maxStyleReferences)
    ?? asNumber(spec.max_style_references)
    ?? 3;

  const videoModelType = asString(constraints.model_type) || null;

  const uncensored = asBool(spec.uncensored)
    || asBool(model.uncensored)
    || (Array.isArray(spec.model_sets) && (spec.model_sets as unknown[]).includes("uncensored"));

  const contextWindow = asNumber(spec.availableContextTokens)
    ?? asNumber(model.availableContextWindow)
    ?? asNumber(model.context_length);

  const voicesResult = extractVoices(spec);

  const rawFormats = spec.supported_formats ?? spec.supportedFormats;
  const supportedFormats: string[] = Array.isArray(rawFormats)
    ? (rawFormats as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  // 영상 생성 모델(type: "video")의 VideoModelConstraints.model_type — 이미지를
  // 넣어 영상을 만드는 image-to-video 지원 여부입니다(공식 스키마 기준).
  // 채팅 모델의 chatVideoInput 캐퍼빌리티(동영상 파일을 직접 이해하는지)와는
  // 다른 축이라 출처가 다르며, 이름이 같지만 각자 사용처가 다릅니다.
  const supportsVideoInput = videoModelType === "image-to-video"
    || asBool(constraints.video_input)
    || asBool(spec.supportsVideoInput)
    || /image-to-video|i2v/i.test(asString(model.id));

  return {
    id: asString(model.id),
    name: asString(spec.name) || asString(model.name) || asString(model.id),
    // 공식 문서 기반 정적 한글 설명이 있으면 우선 사용하고, 없으면 API 설명을 사용합니다.
    description: modelDescription(asString(model.id))
      || asString(spec.description)
      || asString(model.description),
    uncensored,
    lmm,
    supportsMultipleImages,
    maxImages,
    chatVideoInput,
    maxVideos,
    supportsAudioInput,
    supportsStyleReferences,
    maxStyleReferences,
    contextWindow,
    voices: voicesResult.voices,
    defaultVoice: voicesResult.defaultVoice,
    pricing: extractPricing(spec, model),
    supportsVideoInput,
    videoModelType,
    supportedFormats,
    defaultFormat: asString(spec.default_format) || null,
  };
}

export function modelDisplayLabel(model: NormalizedModel): string {
  const badges: string[] = [];
  if (model.lmm) badges.push("LMM");
  if (model.uncensored) badges.push("무검열");
  const suffix = badges.length ? ` (${badges.join(" / ")})` : "";
  const context = model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k` : "";
  return `${model.name}${suffix}${context}`;
}