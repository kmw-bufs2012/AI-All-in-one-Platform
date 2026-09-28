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
  /*
   * ---- 중국 LLM/LMM (2026-09-27 조사, 2025-09 이후 출시 모델 중심) ----
   * images/videos 가 null 이면 개발사가 개수 한도를 따로 두지 않고 컨텍스트
   * 토큰 한도로만 제한한다는 뜻입니다. 이때는 앱 상한(이미지 20·동영상 3)을 씁니다.
   * 텍스트 전용 모델(DeepSeek V4 Pro, MiniMax M2.x, Kimi K2 Thinking, GLM-4.6/4.7/5 등)은
   * 여기 넣지 않습니다. 카탈로그가 비전 미지원으로 표시하므로 첨부가 막힙니다.
   */
  {
    pattern: /qwen[\d.]*-?omni/i,
    limit: { family: "Qwen Omni (3.5/3.8)", images: 64, videos: 64, audios: 64, totalBytes: null, imageBytes: null, source: "Alibaba Model Studio qwen3.8-omni-flash (요청당 파일 64개, 파일당 2GB·2시간)" },
  },
  {
    pattern: /qwen3\.[5-9].*(plus|flash|max)|qwen3-?max/i,
    limit: { family: "Qwen 3.5~3.8 (네이티브 멀티모달)", images: null, videos: null, audios: 0, totalBytes: null, imageBytes: null, source: "alibabacloud.com/help/en/model-studio/vision (이미지 수는 토큰 한도로 제한, 동영상 최대 2시간·2GB)" },
  },
  {
    pattern: /deepseek.*(vision|vl)/i,
    limit: { family: "DeepSeek V4 Flash Vision", images: 600, videos: 0, audios: 0, totalBytes: null, imageBytes: null, source: "api-docs.deepseek.com/guides/vision (요청당 600장, 동영상 미지원)" },
  },
  {
    pattern: /deepseek-?v4\.1-?flash|deepseek-flash/i,
    limit: { family: "DeepSeek V4.1 Flash", images: null, videos: 0, audios: 0, totalBytes: null, imageBytes: null, source: "api-docs.deepseek.com/guides/vision (이미지 입력, 동영상 미지원)" },
  },
  {
    pattern: /kimi-?k3|kimi-?k2[.-]?[5-9]|moonshot.*k(3|2[.-]?[5-9])/i,
    limit: { family: "Moonshot Kimi K2.5/K2.6/K3", images: null, videos: null, audios: 0, totalBytes: 100 * MB, imageBytes: null, source: "platform.kimi.ai/docs/guide/kimi-k2-6-quickstart, use-kimi-vision-model (이미지 개수 제한 없음, 본문 100MB)" },
  },
  {
    pattern: /glm-?4\.[1-6]v/i,
    limit: { family: "Zhipu GLM-4.5V/4.6V", images: 10, videos: null, audios: 0, totalBytes: null, imageBytes: 50 * MB, source: "docs.z.ai (요청당 이미지 10장·장당 50MB)" },
  },
  {
    pattern: /glm-?5v|glm-?5\.\d-?flash/i,
    limit: { family: "Zhipu GLM-5V-Turbo / GLM-5.3-Flash", images: null, videos: null, audios: 0, totalBytes: null, imageBytes: null, source: "docs.z.ai/guides/vlm/glm-5v-turbo, glm-5.3-flash (개수는 컨텍스트 한도로 제한)" },
  },
  {
    pattern: /minimax-?m3/i,
    limit: { family: "MiniMax M3", images: null, videos: null, audios: 0, totalBytes: 64 * MB, imageBytes: 10 * MB, source: "minimax.io/blog/minimax-m3, platform.minimax.io (이미지 10MB·동영상 50MB·본문 64MB)" },
  },
  {
    pattern: /ernie-?5/i,
    limit: { family: "Baidu ERNIE 5", images: null, videos: null, audios: null, totalBytes: null, imageBytes: null, source: "ERNIE for Developers 공식 발표 (텍스트·이미지·오디오·동영상 입력, 개수 미공개)" },
  },
  {
    pattern: /ernie.*vl/i,
    limit: { family: "Baidu ERNIE 4.5 VL", images: 10, videos: 3, audios: 0, totalBytes: null, imageBytes: null, source: "paddlepaddle.github.io/FastDeploy (프롬프트당 이미지 10·동영상 3)" },
  },
  {
    pattern: /doubao|seed-?(1\.6|2\.\d)/i,
    limit: { family: "ByteDance Doubao Seed", images: null, videos: null, audios: 0, totalBytes: null, imageBytes: null, source: "docs.byteplus.com Doubao-Seed-2.0 (이미지·동영상 입력, 개수 미공개)" },
  },
  {
    pattern: /mimo-?v2.*omni/i,
    limit: { family: "Xiaomi MiMo-V2-Omni", images: null, videos: null, audios: null, totalBytes: null, imageBytes: null, source: "mimo.xiaomi.com/mimo-v2-omni (이미지·동영상·오디오 입력, 개수 미공개)" },
  },
  {
    pattern: /step-?3/i,
    limit: { family: "StepFun Step 3 / 3.7 Flash", images: null, videos: 0, audios: 0, totalBytes: null, imageBytes: null, source: "stepfun.ai/research/en/step3 (이미지 입력, 개수 미공개)" },
  },
  {
    pattern: /hunyuan.*vision/i,
    limit: { family: "Tencent Hunyuan Vision", images: null, videos: null, audios: 0, totalBytes: null, imageBytes: null, source: "Tencent Hunyuan 공식 발표 (이미지·동영상 입력, 개수 미공개)" },
  },
  /* ---- 오픈 웨이트 멀티모달 (무검열 파생 모델의 원본으로 자주 쓰임) ---- */
  {
    pattern: /qwen3\.[5-9]-?\d+b/i,
    limit: { family: "Qwen 3.5~3.8 오픈 웨이트 (네이티브 멀티모달)", images: null, videos: null, audios: 0, totalBytes: null, imageBytes: null, source: "alibabacloud.com/help/en/model-studio/vision, huggingface.co/Qwen" },
  },
  {
    pattern: /gemma-?4/i,
    limit: { family: "Google Gemma 4", images: null, videos: null, audios: null, totalBytes: null, imageBytes: null, source: "ai.google.dev/gemma/docs/core (동영상 약 60초·오디오 30초 처리)" },
  },
  {
    pattern: /gemma-?3-?(4|12|27)b/i,
    limit: { family: "Google Gemma 3", images: null, videos: 0, audios: 0, totalBytes: null, imageBytes: null, source: "ai.google.dev/gemma/docs/core (이미지 입력, 1B는 텍스트 전용)" },
  },
  {
    pattern: /llama-?3\.2.*vision/i,
    limit: { family: "Meta Llama 3.2 Vision", images: 1, videos: 0, audios: 0, totalBytes: null, imageBytes: null, source: "llama.com Llama 3.2 모델 카드 (프롬프트당 이미지 1장 권장)" },
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
    pattern: /gpt(?!-?oss)|chatgpt|\bo[134](-|$)|openai/i,
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
  /** 원본(참조) 동영상 최대 수. */
  videos: number;
  source: string;
}

/* 동영상 생성 — 공식 입력 한도(참고 표시용). 앱은 시작 이미지 1장만 전송합니다. */
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

/*
 * 무검열 파생 모델 계열 (2026-09-27 조사).
 *
 * 무검열 모델은 대부분 공개 모델을 추가 학습(파인튜닝)하거나 거절 방향을 제거한
 * (abliteration·derestriction·heretic) 파생 모델입니다. 이미지 입력 지원 여부는
 * 원본 모델을 따릅니다. abliteration은 텍스트 부분만 수정하고 비전 인코더는 그대로
 * 두는 것이 일반적입니다(huihui-ai 모델 카드 참고). 반대로 원본이 텍스트 전용이면
 * 파생 모델도 텍스트 전용입니다.
 *
 * vision: true/false 는 원본 모델 기준으로 확인한 값입니다. null 은 호스팅 제공자에
 * 따라 다르다는 뜻이며, 이때는 카탈로그 값을 따릅니다. 카탈로그의 명시적 플래그는
 * 언제나 이 표보다 우선합니다(lib/models.ts).
 * 첨부 개수 한도는 원본 모델 패턴(findChatLimit)으로 따로 찾습니다.
 */
export interface UncensoredFamily {
  family: string;
  base: string;
  vision: boolean | null;
  source: string;
}

const UNCENSORED_FAMILIES: Array<{ pattern: RegExp; info: UncensoredFamily }> = [
  // 비전 지원 원본에서 파생된 모델
  { pattern: /qwen[\d.]*-?vl|qvq/i, info: { family: "Qwen VL 무검열(abliterated·heretic)", base: "Qwen2.5-VL / Qwen3-VL", vision: true, source: "huggingface.co/huihui-ai (텍스트 부분만 abliteration, 이미지 부분 유지)" } },
  { pattern: /qwen3\.[5-9]/i, info: { family: "Qwen 3.5~3.8 무검열(derestricted·uncensored·obliterated)", base: "Qwen3.5/3.6/3.8 (네이티브 멀티모달)", vision: true, source: "huggingface.co/ArliAI/Qwen3.5-27B-Derestricted, nano-gpt.com 모델 페이지" } },
  { pattern: /gemma-?(4|3-?(4|12|27)b)/i, info: { family: "Gemma 3/4 무검열(abliterated·heretic)", base: "Gemma 3 4B 이상 / Gemma 4", vision: true, source: "huggingface.co/huihui-ai/gemma-3-4b-it-abliterated, ai.google.dev/gemma" } },
  { pattern: /llama-?4|scout|maverick/i, info: { family: "Llama 4 무검열(abliterated)", base: "Llama 4 Scout/Maverick", vision: true, source: "llama.com Llama 4 모델 카드" } },
  { pattern: /llama-?3\.2.*vision/i, info: { family: "Llama 3.2 Vision 무검열", base: "Llama 3.2 11B/90B Vision", vision: true, source: "huggingface.co/mlx-community/Llama-3.2-11B-Vision-Instruct-abliterated" } },
  { pattern: /mistral-?small-?3\.[1-9]|mistral-?small-?(2503|2506)/i, info: { family: "Mistral Small 3.1+ 무검열", base: "Mistral Small 3.1/3.2 (이미지 입력 지원)", vision: true, source: "docs.mistral.ai (vision)" } },
  { pattern: /deepseek.*vision/i, info: { family: "DeepSeek Vision 무검열", base: "DeepSeek V4 Flash Vision", vision: true, source: "api-docs.deepseek.com/guides/vision" } },
  // 제공자에 따라 비전 지원이 다른 모델 → 카탈로그 값을 따름
  { pattern: /glm-?5\.\d-?flash|abliterated.?model.?large/i, info: { family: "GLM-5.3 기반 무검열", base: "GLM-5.3-Flash", vision: null, source: "nano-gpt.com (GLM 5.3 Flash Uncensored: 제공자별 비전 지원), x.com/NanoGPTcom (Abliterated Model Large V2)" } },
  // 텍스트 전용 원본에서 파생된 모델
  { pattern: /venice|dolphin/i, info: { family: "Venice Uncensored / Dolphin", base: "Mistral Small 24B 2501 등 (텍스트 전용)", vision: false, source: "venice.ai 블로그, huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition" } },
  { pattern: /hermes/i, info: { family: "Nous Hermes 3/4", base: "Llama 3.1 70B/405B (텍스트 전용)", vision: false, source: "openrouter.ai/nousresearch/hermes-4-405b" } },
  { pattern: /gpt-?oss/i, info: { family: "gpt-oss 무검열(derestricted·abliterated)", base: "gpt-oss-20b/120b (텍스트 전용)", vision: false, source: "huggingface.co/ArliAI/gpt-oss-120b-Derestricted" } },
  { pattern: /glm-?4\.[5-7](-?air)?(?!v)/i, info: { family: "GLM-4.5/4.6/4.7 무검열(derestricted)", base: "GLM-4.5-Air 등 (텍스트 전용)", vision: false, source: "huggingface.co/ArliAI/GLM-4.5-Air-Derestricted" } },
  { pattern: /qwen(2\.5|3)-?\d+b|qwen3-?(coder|next)/i, info: { family: "Qwen2.5/Qwen3 텍스트 무검열(abliterated·josiefied)", base: "Qwen2.5 / Qwen3 (텍스트 전용)", vision: false, source: "huggingface.co/collections/huihui-ai/qwen3-abliterated" } },
  { pattern: /llama-?3(\.[0-3])?|euryale|midnight|miqu|magnum|anubis|cydonia|rocinante|behemoth/i, info: { family: "Llama 3.x·Mistral 기반 롤플레이/무검열 파인튜닝", base: "Llama 3.x / Mistral 텍스트 모델", vision: false, source: "각 모델 Hugging Face 카드 (텍스트 전용 원본)" } },
];

const UNCENSORED_MARKER = /uncensored|unfiltered|abliterat|obliterat|derestrict|heretic|josiefied|jailbr|venice|dolphin|hermes|euryale|midnight|miqu|magnum|anubis|cydonia|rocinante|behemoth|\bnsfw\b/i;

/** 무검열 파생 모델이면 원본 계열 정보를 돌려줍니다. 무검열 표식이 없으면 null. */
export function findUncensoredFamily(haystack: string): UncensoredFamily | null {
  if (!UNCENSORED_MARKER.test(haystack)) return null;
  return UNCENSORED_FAMILIES.find((entry) => entry.pattern.test(haystack))?.info ?? null;
}
