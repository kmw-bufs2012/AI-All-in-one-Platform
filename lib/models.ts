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
  contextWindow: number | null;
  voices: VoiceInfo[];
  defaultVoice: string | null;
  pricing: ModelPricing | null;
  supportsStyleReferences: boolean;
  maxStyleReferences: number;
  supportsVideoInput: boolean;
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

  const supportsVideoInput = asBool(constraints.video_input)
    || asBool(spec.supportsVideoInput)
    || /image-to-video|i2v/i.test(asString(model.id));

  const maxStyleReferences = asNumber(constraints.maxStyleReferences)
    ?? asNumber(spec.maxStyleReferences)
    ?? 10;

  return {
    id: asString(model.id),
    name: asString(spec.name) || asString(model.name) || asString(model.id),
    description: asString(spec.description) || asString(model.description),
    uncensored,
    lmm,
    contextWindow,
    voices: voicesResult.voices,
    defaultVoice: voicesResult.defaultVoice,
    pricing: extractPricing(spec, model),
    supportsStyleReferences: asBool(spec.supportsStyleReferences),
    maxStyleReferences,
    supportsVideoInput,
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