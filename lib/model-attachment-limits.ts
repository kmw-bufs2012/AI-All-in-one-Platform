/*
 * 모델 계열별 공식 첨부 한도.
 *
 * 원 개발사 공식 문서(또는 그 문서를 그대로 옮긴 신뢰할 수 있는 API 제공사 문서)에서
 * 확인한 "요청 1회당 최대 개수"만 담습니다. 근거와 확인일은
 * docs/model-capability-research.md 의 "첨부 개수 한도" 절에 있습니다.
 *
 * 적용 규칙(lib/attachment-policy.ts):
 * - 공식 한도가 있으면 그 값과 앱 상한(아래 APP_CAP_*) 중 작은 값을 씁니다.
 * - 카탈로그(NanoGPT)가 더 작은 값을 공개하면 카탈로그 값이 우선합니다.
 * - 목록에 없는 모델은 공개 자료가 없는 것으로 보고 앱 기본값을 씁니다.
 *
 * 앱 상한은 Vercel Hobby 플랜 제약에서 나옵니다.
 * - 함수 요청·응답 본문 4.5MB → 첨부는 3MB 청크로 나눠 올리고(api/attachments/chunk),
 *   /api/chat 에는 ID만 보냅니다. 프레임 추출 방식은 JPEG 프레임이 본문에 실리므로
 *   프레임 수를 12장으로 제한합니다.
 * - 함수 메모리 2GB · 최대 실행 300초 → NanoGPT로 보내는 base64 본문이 과도하게
 *   커지지 않도록 요청당 총 첨부 용량을 제한합니다(totalBytes).
 */

export interface ChatLimit {
  family: string;
  /** 요청당 이미지 최대 개수(공식). null = 공식 한도 없음(무제한 또는 미공개). */
  images: number | null;
  /** 동영상을 직접 받을 때의 요청당 최대 개수. 0 = 동영상 직접 입력 미지원. */
  videos: number | null;
  /** 오디오 직접 입력 시 요청당 최대 개수. 0 = 미지원. */
  audios: number | null;
  /** 요청 전체 첨부 용량 상한(공식). */
  totalBytes: number | null;
  /** 이미지 1장 최대 용량(공식). */
  imageBytes: number | null;
  source: string;
}

const MB = 1024 * 1024;

const CHAT_LIMITS: Array<{ pattern: RegExp; limit: ChatLimit }> = [
  {
    pattern: /claude|anthropic/i,
    limit: { family: "Anthropic Claude", images: 100, videos: 0, audios: 0, totalBytes: 32 * MB, imageBytes: 10 * MB, source: "platform.claude.com/docs/en/build-with-claude/vision" },
  },
  {
    pattern: /gemini|gemma-?3n/i,
    limit: { family: "Google Gemini", images: 3000, videos: 10, audios: null, totalBytes: 100 * MB, imageBytes: null, source: "ai.google.dev/gemini-api/docs/video-understanding, blog.google (2026-01 inline 100MB)" },
  },
  {
    pattern: /llama-?4|maverick|scout/i,
    limit: { family: "Meta Llama 4", images: 5, videos: 0, audios: 0, totalBytes: null, imageBytes: null, source: "llama.com/docs/model-cards-and-prompt-formats/llama4" },
  },
  {
    pattern: /mistral|pixtral|magistral/i,
    limit: { family: "Mistral", images: 8, videos: 0, audios: null, totalBytes: null, imageBytes: 10 * MB, source: "docs.mistral.ai (vision)" },
  },
  {
    pattern: /qwen.*(vl|omni)|qvq/i,
    limit: { family: "Qwen VL", images: 512, videos: 64, audios: null, totalBytes: null, imageBytes: null, source: "alibabacloud.com/help/en/model-studio/vision" },
  },
  {
    pattern: /grok|x-ai|xai/i,
    limit: { family: "xAI Grok", images: null, videos: 0, audios: 0, totalBytes: null, imageBytes: 10 * MB, source: "docs.x.ai/developers/model-capabilities/images/understanding" },
  },
  {
    pattern: /gpt|chatgpt|\bo[134](-|$)|openai/i,
    limit: { family: "OpenAI GPT", images: 500, videos: 0, audios: null, totalBytes: 50 * MB, imageBytes: null, source: "developers.openai.com/api/docs/guides/images-vision" },
  },
];

export function findChatLimit(id: string, name: string): ChatLimit | null {
  const haystack = `${id} ${name}`;
  return CHAT_LIMITS.find((entry) => entry.pattern.test(haystack))?.limit ?? null;
}

export interface ReferenceLimit {
  family: string;
  max: number;
  source: string;
}

/* 이미지 생성 — 참조(입력) 이미지 최대 장수. 더 구체적인 패턴을 앞에 둡니다. */
const IMAGE_REFERENCE_LIMITS: Array<{ pattern: RegExp; limit: ReferenceLimit }> = [
  { pattern: /gpt-?image/i, limit: { family: "OpenAI GPT Image", max: 16, source: "developers.openai.com/api/reference/resources/images/methods/edit" } },
  { pattern: /nano-?banana|gemini.*image/i, limit: { family: "Google Nano Banana", max: 14, source: "docs.cloud.google.com (Gemini 3.1 Flash Image), deepmind.google/models/gemini-image/pro" } },
  { pattern: /flux-?2/i, limit: { family: "FLUX.2", max: 8, source: "docs.bfl.ai/flux_2/flux2_image_editing" } },
  { pattern: /qwen-?image.*edit/i, limit: { family: "Qwen Image Edit", max: 3, source: "huggingface.co/Qwen/Qwen-Image-Edit-2509" } },
  { pattern: /seedream/i, limit: { family: "ByteDance Seedream", max: 10, source: "seed.bytedance.com/en/seedream4_0" } },
  { pattern: /grok-?imagine-?image/i, limit: { family: "xAI Grok Imagine", max: 3, source: "docs.x.ai/developers/model-capabilities/imagine" } },
  { pattern: /kling.*(omni|image)/i, limit: { family: "Kling Image Omni", max: 10, source: "kling.ai/blog/kling-image-3-vs-omni" } },
];

export function findImageReferenceLimit(id: string, name: string): ReferenceLimit | null {
  const haystack = `${id} ${name}`;
  return IMAGE_REFERENCE_LIMITS.find((entry) => entry.pattern.test(haystack))?.limit ?? null;
}

export interface VideoInputLimit {
  family: string;
  /** 모델이 공식적으로 받는 참조 이미지 최대 수(참고용). */
  referenceImages: number;
  /** 원본(참조) 영상 최대 수. */
  videos: number;
  source: string;
}

/* 영상 생성 — 공식 입력 한도(참고 표시용). 앱은 시작 이미지 1장만 전송합니다. */
const VIDEO_INPUT_LIMITS: Array<{ pattern: RegExp; limit: VideoInputLimit }> = [
  { pattern: /veo-?3/i, limit: { family: "Google Veo 3.1", referenceImages: 3, videos: 0, source: "ai.google.dev/gemini-api/docs/veo" } },
  { pattern: /wan-?2[.-]7.*reference/i, limit: { family: "Wan 2.7 Reference", referenceImages: 5, videos: 3, source: "alibabacloud.com/help/en/model-studio" } },
  { pattern: /seedance-?2/i, limit: { family: "Seedance 2.x", referenceImages: 9, videos: 3, source: "seed.bytedance.com/en/seedance2_0" } },
  { pattern: /kling.*(omni|o3|3)/i, limit: { family: "Kling 3.0 Omni", referenceImages: 7, videos: 1, source: "kling.ai/document-api/api/video/3-0-omni/video-omni" } },
  { pattern: /grok-?imagine-?video/i, limit: { family: "xAI Grok Imagine Video", referenceImages: 7, videos: 1, source: "docs.x.ai/developers/model-capabilities/video/reference-to-video" } },
  { pattern: /sora-?2/i, limit: { family: "OpenAI Sora 2", referenceImages: 1, videos: 0, source: "OpenAI Videos API input_reference" } },
];

export function findVideoInputLimit(id: string, name: string): VideoInputLimit | null {
  const haystack = `${id} ${name}`;
  return VIDEO_INPUT_LIMITS.find((entry) => entry.pattern.test(haystack))?.limit ?? null;
}
