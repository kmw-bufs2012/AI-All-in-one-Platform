/*
 * 이미지 모델 상세 설정 보강(제작사 공식 문서 기준).
 *
 * NanoGPT 카탈로그의 supported_parameters 가 비어 있거나 일부만 공개된 이미지
 * 모델이 많아, 제작사가 공식 API 문서에 적어 둔 설정을 더해 동영상처럼 상세
 * 설정을 고를 수 있게 합니다.
 *
 * 규칙
 * - 카탈로그가 이미 공개한 키는 건드리지 않습니다(카탈로그 우선).
 * - 여기서 더한 설정은 origin: "official" 로 표시되고, 서버가 NanoGPT에
 *   보냈다가 거부(4xx)되면 이 설정만 빼고 한 번 다시 요청합니다
 *   (app/api/image/route.ts). 그래서 공급자가 받지 않는 설정 때문에
 *   생성이 막히지 않습니다.
 * - 값은 2026-09 웹 검색으로 확인한 공식 문서(및 공식 문서를 인용한 신뢰할
 *   만한 문서)만 넣었습니다. 확인하지 못한 값(자유 입력 텍스트, 문서마다
 *   다른 값)은 넣지 않았습니다.
 * - Midjourney 는 공식 API가 없고, LTX·Runway 이미지 모델은 이 앱의 이미지
 *   카탈로그에 없어 대상이 아닙니다.
 */

import type { ExtraParam } from "./models";

export interface ImageSettingsOverlay {
  id: string;
  developer: string;
  match: RegExp;
  params: ExtraParam[];
  /** 해상도 목록을 카탈로그가 공개하지 않을 때 대신 쓸 공식 값. */
  resolutions?: string[];
  /** 공식 문서상 한 요청에서 만들 수 있는 최대 장수(참고 표시용). */
  officialMaxImages?: number;
  source: string;
}

const enumParam = (key: string, values: string[], note?: string): ExtraParam => ({
  key,
  kind: "enum",
  values,
  default: null,
  origin: "official",
  note,
});
const rangeParam = (key: string, min: number, max: number, step = 1, note?: string): ExtraParam => ({
  key,
  kind: "range",
  min,
  max,
  step,
  default: null,
  origin: "official",
  note,
});
const BOOL = ["true", "false"];

const GEMINI_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
const GROK_RATIOS = ["auto", "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19", "19.5:9", "9:20", "20:9", "1:2", "2:1"];

export const IMAGE_SETTINGS_OVERLAYS: ImageSettingsOverlay[] = [
  {
    id: "openai-gpt-image-2-5",
    developer: "OpenAI",
    match: /gpt-image-2-5|gpt-image-2\.5/,
    params: [
      enumParam("quality", ["low", "medium", "high", "xhigh", "max"]),
      enumParam("background", ["auto", "opaque", "transparent"], "투명 배경은 PNG·WebP 형식에서만 됩니다."),
      enumParam("output_format", ["png", "jpeg", "webp"]),
    ],
    officialMaxImages: 10,
    source: "OpenAI API Reference – Create image (developers.openai.com, 2026-09 확인)",
  },
  {
    id: "openai-gpt-image",
    developer: "OpenAI",
    match: /gpt-image/,
    params: [
      enumParam("quality", ["low", "medium", "high"]),
      enumParam("background", ["auto", "opaque", "transparent"], "투명 배경은 PNG·WebP 형식에서만 됩니다(GPT Image 2 는 미리보기 기능)."),
      enumParam("output_format", ["png", "jpeg", "webp"]),
    ],
    officialMaxImages: 10,
    source: "OpenAI API Reference – Create image / Image generation guide (developers.openai.com, 2026-09 확인)",
  },
  {
    id: "google-nano-banana-lite",
    developer: "Google",
    match: /nano-banana-2-lite/,
    params: [enumParam("aspect_ratio", GEMINI_RATIOS)],
    source: "Firebase AI Logic – Generate images with Gemini (firebase.google.com, 2026-09 확인)",
  },
  {
    id: "google-nano-banana",
    developer: "Google",
    match: /nano-banana/,
    params: [
      enumParam("aspect_ratio", GEMINI_RATIOS),
      enumParam("image_size", ["1K", "2K", "4K"], "대문자 K로 보냅니다. 지정하지 않으면 1K입니다."),
    ],
    source: "Firebase AI Logic – Generate images with Gemini, @google/genai ImageConfig (2026-09 확인)",
  },
  {
    id: "xai-grok-imagine-image",
    developer: "xAI",
    match: /grok-imagine-image/,
    params: [enumParam("aspect_ratio", GROK_RATIOS)],
    resolutions: ["1k", "2k"],
    officialMaxImages: 10,
    source: "xAI Docs – Image Generation (docs.x.ai, 2026-09 확인)",
  },
  {
    id: "bfl-flux-2",
    developer: "Black Forest Labs",
    match: /flux-2/,
    params: [
      rangeParam("safety_tolerance", 0, 5, 1, "0이 가장 엄격, 5가 가장 느슨합니다."),
      enumParam("output_format", ["jpeg", "png"]),
      enumParam("prompt_upsampling", BOOL, "FLUX.2 [pro]·[max]는 기본으로 프롬프트를 보강합니다."),
      rangeParam("seed", 0, 2147483647, 1, "같은 값이면 비슷한 결과가 나옵니다."),
    ],
    source: "BFL API Reference – FLUX.2 [pro] (docs.bfl.ai, 2026-09 확인)",
  },
  {
    id: "bytedance-seedream-5-lite",
    developer: "ByteDance",
    match: /seedream-v5-lite/,
    params: [
      enumParam("sequential_image_generation", ["auto", "disabled"], "auto 면 연관된 여러 장을 한 번에 만듭니다."),
      rangeParam("max_images", 1, 15),
      enumParam("watermark", BOOL),
    ],
    officialMaxImages: 15,
    source: "BytePlus ModelArk – Image generation API (docs.byteplus.com, 2026-09 확인)",
  },
  {
    id: "bytedance-seedream-5-pro",
    developer: "ByteDance",
    match: /seedream-v5-pro/,
    params: [enumParam("output_format", ["png", "jpeg"]), enumParam("watermark", BOOL)],
    source: "BytePlus ModelArk – Seedream 5.0 pro tutorial (docs.byteplus.com, 2026-09 확인)",
  },
  {
    id: "alibaba-qwen-image",
    developer: "Alibaba (Qwen)",
    match: /qwen-image-(2|3)/,
    params: [enumParam("prompt_extend", BOOL, "켜면 모델이 프롬프트를 자동으로 보강합니다."), enumParam("watermark", BOOL)],
    officialMaxImages: 6,
    source: "Alibaba Cloud Model Studio – Qwen-Image 3.0 API reference (alibabacloud.com, 2026-09 확인)",
  },
  {
    id: "recraft-v4",
    developer: "Recraft",
    match: /recraft-v4/,
    params: [enumParam("style", ["realistic_image", "digital_illustration", "vector_illustration", "icon"])],
    source: "Recraft API – Styles (recraft.ai/docs, 2026-09 확인)",
  },
  {
    id: "ideogram",
    developer: "Ideogram",
    match: /ideogram/,
    params: [
      enumParam("style_type", ["AUTO", "GENERAL", "REALISTIC", "DESIGN", "RENDER_3D", "ANIME"]),
      enumParam("rendering_speed", ["TURBO", "DEFAULT", "QUALITY"]),
      enumParam("magic_prompt", ["AUTO", "ON", "OFF"]),
    ],
    source: "Ideogram API Reference – Generate (developer.ideogram.ai, 2026-09 확인)",
  },
  {
    id: "minimax-image",
    developer: "MiniMax",
    match: /minimax.*image|image-01/,
    params: [enumParam("prompt_optimizer", BOOL)],
    officialMaxImages: 9,
    source: "MiniMax API Docs – Image generation (platform.minimax.io, 2026-09 확인)",
  },
];

export function findImageSettingsOverlay(id: string, name = ""): ImageSettingsOverlay | null {
  const haystack = `${id} ${name}`.toLowerCase();
  return IMAGE_SETTINGS_OVERLAYS.find((overlay) => overlay.match.test(haystack)) ?? null;
}

/** 카탈로그 파라미터에 없는 공식 설정만 뒤에 덧붙입니다. */
export function mergeOfficialImageParams(catalog: ExtraParam[], overlay: ImageSettingsOverlay | null): ExtraParam[] {
  if (!overlay) return catalog;
  const known = new Set(catalog.map((param) => param.key.toLowerCase().replace(/[_-]/g, "")));
  const extra = overlay.params.filter((param) => !known.has(param.key.toLowerCase().replace(/[_-]/g, "")));
  return [...catalog, ...extra];
}
