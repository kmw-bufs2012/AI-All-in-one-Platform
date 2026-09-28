/*
 * 이미지·동영상 모델의 "제작사 공식 단가" 기준 예상 비용·토큰 계산기.
 *
 * - 앱은 NanoGPT를 거쳐 호출하므로 실제 청구액은 NanoGPT 단가를 따릅니다.
 *   여기 값은 제작사(OpenAI·Google·xAI·Runway·LTX·BFL·ByteDance·MiniMax·
 *   Kling·Alibaba)가 공개한 API 단가로 계산한 참고용 예상치입니다.
 * - 단가는 2026년 9월에 웹 검색으로 확인한 값입니다. 제작사 공식 페이지는
 *   이 개발 환경에서 직접 열람하지 못해, 공식 단가를 인용한 신뢰할 만한
 *   문서들로 교차 확인했습니다. 확인하지 못한 모델은 일부러 넣지 않았습니다
 *   (추측 금지). 단가가 바뀌면 이 표만 고치면 됩니다.
 * - Midjourney 는 공식 API가 없어(2026-08 기준) 계산 대상이 아닙니다.
 */

export type ResolutionTier = "480p" | "720p" | "768p" | "1080p" | "1440p" | "2k" | "4k";
export type QualityTier = "low" | "medium" | "high";

export interface PricingContext {
  /** 결과물 해상도 구간. 알 수 없으면 null(규칙의 기본값 사용). */
  tier: ResolutionTier | null;
  width: number | null;
  height: number | null;
  quality: QualityTier | null;
  seconds: number | null;
  count: number;
  audio: boolean | null;
}

interface PriceResult {
  /** 결과물 1개(이미지 1장 또는 동영상 1개)의 비용(USD). */
  usd: number;
  /** 결과물 1개가 소모하는 과금 토큰. 토큰 과금 모델만 값이 있습니다. */
  tokens?: number;
  /** 계산에 쓴 조건 설명. */
  basis: string;
}

interface PricingRule {
  vendor: string;
  label: string;
  match: RegExp;
  kind: "image" | "video";
  defaultSeconds?: number;
  price: (ctx: PricingContext) => PriceResult | null;
  source: string;
  note?: string;
  /** 제3자 라우팅(호스팅) 제공자의 참고 단가. 앱의 실제 청구액과는 무관합니다. */
  routes?: string[];
}

const MP = 1024 * 1024;

function pickTier<T>(tier: ResolutionTier | null, table: Partial<Record<ResolutionTier, T>>, fallback: ResolutionTier): { tier: ResolutionTier; value: T } | null {
  if (tier && table[tier] !== undefined) return { tier, value: table[tier] as T };
  // 표에 없는 해상도는 가장 가까운 상위 구간으로 올려 잡습니다(과소 추정 방지).
  const order: ResolutionTier[] = ["480p", "720p", "768p", "1080p", "1440p", "2k", "4k"];
  if (tier) {
    for (const candidate of order.slice(order.indexOf(tier))) {
      if (table[candidate] !== undefined) return { tier: candidate, value: table[candidate] as T };
    }
  }
  const value = table[fallback];
  return value === undefined ? null : { tier: fallback, value };
}

function perSecond(
  table: Partial<Record<ResolutionTier, number>>,
  fallback: ResolutionTier,
): (ctx: PricingContext, seconds: number) => PriceResult | null {
  return (ctx, seconds) => {
    const hit = pickTier(ctx.tier, table, fallback);
    if (!hit) return null;
    return { usd: hit.value * seconds, basis: `${hit.tier} · 초당 $${hit.value} × ${seconds}초` };
  };
}

function videoRule(
  base: Omit<PricingRule, "price" | "kind">,
  compute: (ctx: PricingContext, seconds: number) => PriceResult | null,
): PricingRule {
  return {
    ...base,
    kind: "video",
    price: (ctx) => compute(ctx, ctx.seconds ?? base.defaultSeconds ?? 5),
  };
}

/* ByteDance Seedance: 동영상 토큰 = 가로 × 세로 × fps × 초 / 1024, 100만 토큰당 $10.70(동영상 입력 없음). */
const SEEDANCE_SIZE: Partial<Record<ResolutionTier, [number, number]>> = {
  "480p": [864, 496],
  "720p": [1280, 720],
  "1080p": [1920, 1080],
};
function seedanceAt(ratePerMillion: number, table: Partial<Record<ResolutionTier, [number, number]>> = SEEDANCE_SIZE) {
  return (ctx: PricingContext, seconds: number): PriceResult | null => {
    const hit = pickTier(ctx.tier, table, "720p");
    if (!hit) return null;
    const [w, h] = hit.value;
    const tokens = Math.round((w * h * 24 * seconds) / 1024);
    return {
      usd: (tokens / 1_000_000) * ratePerMillion,
      tokens,
      basis: `${hit.tier} · ${w}×${h}×24fps×${seconds}초÷1024 토큰 × $${ratePerMillion.toFixed(2)}/1M`,
    };
  };
}
const seedance = seedanceAt(10.7);
/* Fast·Mini 는 480p·720p 만 지원합니다(1080p 없음). */
const SEEDANCE_LIGHT_SIZE: Partial<Record<ResolutionTier, [number, number]>> = {
  "480p": SEEDANCE_SIZE["480p"],
  "720p": SEEDANCE_SIZE["720p"],
};

export const MEDIA_PRICING_RULES: PricingRule[] = [
  /* ------------------------------------------------------------ 이미지 */
  {
    vendor: "OpenAI",
    label: "GPT Image 2 / 1.5",
    kind: "image",
    match: /gpt-image/,
    price: (ctx) => {
      const quality = ctx.quality ?? "medium";
      const base = { low: 0.006, medium: 0.053, high: 0.211 }[quality];
      const area = ctx.width && ctx.height ? (ctx.width * ctx.height) / MP : 1;
      const usd = base * area;
      // 이미지 출력 토큰 단가 $30/1M 로 환산한 출력 토큰 수.
      return { usd, tokens: Math.round((usd / 30) * 1_000_000), basis: `${quality} 품질 · 1024² 기준 $${base}${area !== 1 ? ` × 면적 ${area.toFixed(2)}배` : ""}` };
    },
    source: "OpenAI API 단가(이미지 출력 $30/1M 토큰, 1024² 저·중·고 $0.006/$0.053/$0.211) — wavespeed.ai·aifreeapi.com 2026-09 인용",
    note: "GPT Image 1.5 는 2 의 단가로 근사합니다. 2026-09-08 출시된 GPT Image 2.5 단가는 확인되지 않았습니다.",
  },
  {
    vendor: "Google",
    label: "Nano Banana Pro (Gemini 3 Pro Image)",
    kind: "image",
    match: /nano-banana-pro/,
    price: (ctx) => {
      const usd = ctx.tier === "4k" ? 0.24 : 0.134;
      return { usd, tokens: Math.round((usd / 120) * 1_000_000), basis: `${ctx.tier === "4k" ? "4K" : "1K·2K"} $${usd} (이미지 출력 $120/1M 토큰)` };
    },
    source: "Google Gemini API 단가 — openrouter.ai·benchlm.ai 2026-09 인용",
  },
  {
    vendor: "Google",
    label: "Nano Banana 2 (Gemini 3.1 Flash Image)",
    kind: "image",
    match: /nano-banana-2(?!-lite)/,
    price: (ctx) => {
      const table: Partial<Record<ResolutionTier, number>> = { "480p": 0.045, "1080p": 0.067, "2k": 0.101, "4k": 0.151 };
      const tier = ctx.tier === "480p" ? "480p" : ctx.tier === "2k" || ctx.tier === "1440p" ? "2k" : ctx.tier === "4k" ? "4k" : "1080p";
      const usd = table[tier]!;
      const label = { "480p": "0.5K", "1080p": "1K", "2k": "2K", "4k": "4K" }[tier as "480p" | "1080p" | "2k" | "4k"];
      return { usd, tokens: Math.round((usd / 60) * 1_000_000), basis: `${label} $${usd} (이미지 출력 $60/1M 토큰)` };
    },
    source: "Google Gemini API 단가 — openrouter.ai·benchlm.ai 2026-09 인용",
  },
  {
    vendor: "xAI",
    label: "Grok Imagine Image 2.0",
    kind: "image",
    match: /grok-imagine-image-(2|quality)/,
    price: (ctx) => {
      const big = ctx.tier === "2k" || ctx.tier === "4k" || ctx.tier === "1440p";
      const medium = ctx.quality === "medium" || ctx.quality === "high";
      const usd = big ? (medium ? 0.08 : 0.06) : medium ? 0.06 : 0.04;
      return { usd, basis: `${big ? "2K" : "1K"} ${medium ? "medium" : "low"} $${usd}` };
    },
    source: "xAI API 단가(2026-08-28 확인) — dreampixelforge.com·tech-insider.org 인용",
  },
  {
    vendor: "xAI",
    label: "Grok Imagine Image",
    kind: "image",
    match: /grok-imagine-image(?!-(2|quality))/,
    price: () => ({ usd: 0.02, basis: "장당 $0.02" }),
    source: "x.ai/api/imagine (2026)",
  },
  {
    vendor: "Black Forest Labs",
    label: "FLUX.2 [max]",
    kind: "image",
    match: /flux-2-max/,
    price: (ctx) => {
      const mp = ctx.width && ctx.height ? Math.max(1, (ctx.width * ctx.height) / 1_000_000) : 1;
      const usd = 0.07 + 0.03 * Math.max(0, Math.ceil(mp) - 1);
      return { usd, basis: `첫 1MP $0.07 + 추가 MP당 $0.03 (${Math.ceil(mp)}MP)` };
    },
    source: "docs.bfl.ml 단가(2026-07-31 확인) 인용",
  },
  {
    vendor: "Black Forest Labs",
    label: "FLUX.2 [pro]",
    kind: "image",
    match: /flux-2-pro/,
    price: () => ({ usd: 0.03, basis: "1MP 기준 $0.03부터" }),
    source: "docs.bfl.ml 단가(2026-07-31 확인) 인용",
    note: "1MP를 넘는 해상도의 추가 단가는 확인하지 못해 최저가만 표시합니다.",
  },
  {
    vendor: "ByteDance",
    label: "Seedream 5.0 Pro",
    kind: "image",
    match: /seedream-v5-pro/,
    price: (ctx) => {
      const pixels = ctx.width && ctx.height ? ctx.width * ctx.height : null;
      const big = pixels !== null ? pixels > 2_360_000 : ctx.tier === "4k";
      return { usd: big ? 0.09 : 0.045, basis: big ? "2.36MP 초과 $0.09" : "2.36MP 이하 $0.045" };
    },
    source: "BytePlus 단가 — atlascloud.ai 2026 인용",
  },
  {
    vendor: "ByteDance",
    label: "Seedream 5.0 Lite",
    kind: "image",
    match: /seedream-v5-lite/,
    price: () => ({ usd: 0.035, basis: "장당 $0.035" }),
    source: "BytePlus 단가 — segmind.com·evolink.ai 2026 인용",
  },
  {
    vendor: "Alibaba (Qwen)",
    label: "Qwen-Image 3.0 Pro",
    kind: "image",
    match: /qwen-image-3(-0)?-pro/,
    price: (ctx) => {
      const big = ctx.width && ctx.height ? ctx.width * ctx.height > 2_250_000 : ctx.tier === "2k" || ctx.tier === "4k";
      return { usd: big ? 0.075 : 0.04, basis: big ? "2K $0.075" : "1K $0.04" };
    },
    source: "Alibaba Qwen Cloud 단가 — aireiter.com·openrouter.ai 2026-09 인용",
  },
  {
    vendor: "Alibaba (Qwen)",
    label: "Qwen-Image 3.0",
    kind: "image",
    match: /qwen-image-3(-0)?(?!-?\d|-?pro)/,
    price: () => ({ usd: 0.03, basis: "장당 $0.03" }),
    source: "Alibaba Qwen Cloud 단가 — orcarouter.ai·tech-insider.org 2026 인용",
  },
  {
    vendor: "Alibaba (Qwen)",
    label: "Qwen-Image 2.0 Pro",
    kind: "image",
    match: /qwen-image-2(-0)?-pro/,
    price: () => ({ usd: 0.075, basis: "장당 $0.075" }),
    source: "Alibaba Model Studio 국제 단가 — therundown.ai 2026 인용",
  },
  {
    vendor: "Alibaba (Qwen)",
    label: "Qwen-Image 2.0",
    kind: "image",
    match: /qwen-image-2(-0)?(?!-?\d|-?pro)/,
    price: () => ({ usd: 0.035, basis: "장당 $0.035" }),
    source: "Alibaba Model Studio 국제 단가 — therundown.ai 2026 인용",
  },

  /*
   * 무검열 오픈 웨이트 이미지 모델. 원 개발사의 유료 API가 없어, 신뢰할 만한
   * 제3자 호스팅(Venice 공식 API 문서·모델 페이지)의 공개 단가를 씁니다.
   */
  {
    vendor: "커뮤니티 (Venice 호스팅 단가)",
    label: "Lustify (SDXL·v7·v8)",
    kind: "image",
    match: /lustify/,
    price: () => ({ usd: 0.01, basis: "장당 $0.01 (Venice API)" }),
    source: "venice.ai/models/lustify-sdxl·lustify-v8, docs.venice.ai 2026 인용",
    routes: ["Runware SDXL 계열 장당 약 $0.0026"],
  },
  {
    vendor: "커뮤니티 (Venice 호스팅 단가)",
    label: "Anime WAI (Illustrious)",
    kind: "image",
    match: /wai-?illustrious|illustrious/,
    price: () => ({ usd: 0.01, basis: "장당 $0.01 (Venice API)" }),
    source: "venice.ai/models/wai-illustrious 2026 인용",
    routes: ["Replicate WAI-NSFW-Illustrious 1회 약 $0.0061"],
  },
  {
    vendor: "커뮤니티 (Venice 호스팅 단가)",
    label: "Chroma",
    kind: "image",
    match: /(^|-)chroma(-|$)/,
    price: () => ({ usd: 0.01, basis: "장당 $0.01 (Venice API)" }),
    source: "venicestats.com/venice-models/chroma, runtheprompts.com 2026 인용",
  },
  {
    vendor: "Venice",
    label: "Venice SD35",
    kind: "image",
    match: /venice-?sd-?35/,
    price: () => ({ usd: 0.05, basis: "장당 $0.05 (Venice API)" }),
    source: "venicestats.com, docs.venice.ai 2026 인용",
  },

  /* ------------------------------------------------------------ 동영상 */
  videoRule(
    {
      vendor: "OpenAI",
      label: "Sora 2 Pro",
      match: /sora-2-pro/,
      defaultSeconds: 8,
      source: "OpenAI API 단가 — eesel.ai·magichour.ai 2026 인용",
      note: "Sora API는 2026-09-24 종료되었습니다.",
    },
    perSecond({ "720p": 0.3, "1080p": 0.7 }, "720p"),
  ),
  videoRule(
    {
      vendor: "OpenAI",
      label: "Sora 2",
      match: /sora-2-(text|image)/,
      defaultSeconds: 8,
      source: "OpenAI API 단가 — eesel.ai·magichour.ai 2026 인용",
      note: "Sora API는 2026-09-24 종료되었습니다.",
    },
    perSecond({ "720p": 0.1 }, "720p"),
  ),
  videoRule(
    {
      vendor: "Google",
      label: "Veo 3.1 Fast",
      match: /veo3(\.1)?-fast/,
      defaultSeconds: 8,
      source: "Google Gemini API 단가 — buildfastwithai.com·veo3gen.app 2026 인용",
      note: "Veo 3.0 은 2026-06-30 종료되어 3.1 단가로 근사합니다.",
    },
    perSecond({ "720p": 0.1, "1080p": 0.12, "4k": 0.3 }, "720p"),
  ),
  videoRule(
    {
      vendor: "Google",
      label: "Veo 3.1",
      match: /veo3(\.1)?-full/,
      defaultSeconds: 8,
      source: "Google Gemini API 단가 — buildfastwithai.com·aifreeapi.com 2026 인용",
      note: "Veo 3.0 은 2026-06-30 종료되어 3.1 단가로 근사합니다.",
    },
    (ctx, seconds) => {
      const audio = ctx.audio !== false;
      const rate = ctx.tier === "4k" ? (audio ? 0.6 : 0.4) : audio ? 0.4 : 0.2;
      return { usd: rate * seconds, basis: `${ctx.tier === "4k" ? "4K" : "720p·1080p"} ${audio ? "오디오 포함" : "오디오 없음"} · 초당 $${rate} × ${seconds}초` };
    },
  ),
  videoRule(
    {
      vendor: "xAI",
      label: "Grok Imagine Video 1.5",
      match: /grok-imagine-1-5/,
      defaultSeconds: 6,
      source: "xAI API 단가(2026-08-28 확인) — dreampixelforge.com 인용",
    },
    perSecond({ "480p": 0.08, "720p": 0.14, "1080p": 0.25 }, "720p"),
  ),
  videoRule(
    {
      vendor: "xAI",
      label: "Grok Imagine Video",
      match: /grok-imagine-(text|image|video|reference)-to-video/,
      defaultSeconds: 6,
      source: "xAI API 단가(2026-08-28 확인) — dreampixelforge.com 인용",
      routes: ["OpenRouter 초당 $0.05부터"],
    },
    perSecond({ "480p": 0.05, "720p": 0.07 }, "720p"),
  ),
  videoRule(
    { vendor: "Runway", label: "Gen-4.5", match: /runway-gen4-5/, defaultSeconds: 5, source: "Runway API 12크레딧/초 × $0.01 — apiframe.ai·therundown.ai 2026 인용" },
    (_ctx, seconds) => ({ usd: 0.12 * seconds, basis: `초당 $0.12 × ${seconds}초` }),
  ),
  videoRule(
    { vendor: "Runway", label: "Gen-4 Turbo", match: /runway-gen4-turbo/, defaultSeconds: 5, source: "Runway API 5크레딧/초 × $0.01 — apiframe.ai 2026 인용" },
    (_ctx, seconds) => ({ usd: 0.05 * seconds, basis: `초당 $0.05 × ${seconds}초` }),
  ),
  videoRule(
    { vendor: "LTX (Lightricks)", label: "LTX-2.5 Fast", match: /ltx-2-5-fast/, defaultSeconds: 6, source: "LTX API 단가 — therundown.ai·ltx.io 2026 인용" },
    perSecond({ "720p": 0.09, "1080p": 0.13, "1440p": 0.19, "4k": 0.3 }, "1080p"),
  ),
  videoRule(
    {
      vendor: "Black Forest Labs",
      label: "FLUX 3 (동영상)",
      match: /flux-3-/,
      defaultSeconds: 5,
      source: "BFL 단가(2026-07-23 발표) — daily.dev·vercel.com 인용",
      note: "HD와 4K 사이 해상도 단가는 확인하지 못해 HD 단가로 계산합니다.",
    },
    perSecond({ "1080p": 0.17, "4k": 0.8 }, "1080p"),
  ),
  videoRule(
    {
      vendor: "ByteDance",
      label: "Seedance 2.0 Mini",
      match: /seedance-?2-0-?mini/,
      defaultSeconds: 5,
      source: "BytePlus ModelArk $3.50/1M 토큰 — segmind.com·opper.ai 2026-09 인용",
      routes: [
        "fal.ai 480p 초당 $0.0721 · 720p 초당 $0.1547",
        "Segmind $1.75/1M 토큰(50% 할인가)",
        "NanoGPT Mini Spicy 이미지→동영상 약 $0.30/편",
      ],
    },
    seedanceAt(3.5, SEEDANCE_LIGHT_SIZE),
  ),
  videoRule(
    {
      vendor: "ByteDance",
      label: "Seedance 2.0 Fast",
      match: /seedance-?2-0-?fast/,
      defaultSeconds: 5,
      source: "BytePlus ModelArk $5.60/1M 토큰(동영상 입력 없음; 있으면 $3.30) — segmind.com·apiframe.ai 2026 인용",
      routes: ["fal.ai 720p 초당 $0.2419", "Segmind $2.80/1M 토큰(50% 할인가)"],
    },
    seedanceAt(5.6, SEEDANCE_LIGHT_SIZE),
  ),
  videoRule(
    {
      vendor: "ByteDance",
      label: "Seedance 2.5 / 2.0",
      match: /seedance-?2-(5|0)(?!\d)/,
      defaultSeconds: 5,
      source: "BytePlus ModelArk 동영상 토큰 $10.70/1M·토큰 공식 — anikuku.com·cellcog.ai 2026 인용",
      routes: [
        "fal.ai 2.0 720p 초당 $0.3034",
        "Atlas Cloud 2.0 720p 초당 $0.1486(동영상 입력 포함)",
        "OpenRouter 2.5 초당 $0.1028부터",
      ],
    },
    seedance,
  ),
  videoRule(
    { vendor: "MiniMax", label: "Hailuo H3", match: /minimax-h3/, defaultSeconds: 6, source: "MiniMax API 단가(2026-07-29 출시) — anikuku.com·openrouter.ai 인용" },
    perSecond({ "768p": 0.08, "2k": 0.13 }, "768p"),
  ),
  videoRule(
    {
      vendor: "Kling",
      label: "Kling 3.0 (V3) Pro",
      match: /kling-v3-(pro|4k)/,
      defaultSeconds: 5,
      source: "Kling 공식 API 단가 — evolink.ai·costbench.com 2026 인용",
      note: "Standard·Turbo·O3 변형의 공식 단가는 확인하지 못했습니다.",
    },
    (ctx, seconds) => {
      if (ctx.tier === "4k") return { usd: 0.42 * seconds, basis: `4K · 초당 $0.42 × ${seconds}초` };
      const audio = ctx.audio === true;
      const rate = audio ? 0.168 : 0.112;
      return { usd: rate * seconds, basis: `1080p ${audio ? "오디오 포함" : "오디오 없음"} · 초당 $${rate} × ${seconds}초` };
    },
  ),
  videoRule(
    {
      vendor: "Alibaba",
      label: "Wan 3.0",
      match: /wan-3/,
      defaultSeconds: 5,
      source: "Alibaba Cloud 공식 ¥0.30/¥0.60/¥1.20 per 초(480P/720P/1080P) — anikuku.com·glbgpt.com 2026 인용",
      note: "공식 단가가 위안화라 1달러=7.1위안으로 환산한 근사치입니다.",
    },
    perSecond({ "480p": 0.042, "720p": 0.085, "1080p": 0.169 }, "1080p"),
  ),
  videoRule(
    { vendor: "Alibaba", label: "Wan 2.7", match: /wan-2-7-(text|image|enhanced|reference)/, defaultSeconds: 5, source: "Alibaba 단가 — nemovideo.com·yottalabs.ai 2026 인용", routes: ["NanoGPT Wan 2.7 이미지→동영상 Spicy 약 $0.50/편"] },
    perSecond({ "720p": 0.086, "1080p": 0.144 }, "1080p"),
  ),
];

/* ------------------------------------------------------------ 설정값 해석 */

function tierFromText(text: string): ResolutionTier | null {
  const t = text.toLowerCase();
  const wh = t.match(/(\d{3,4})\s*[x×*]\s*(\d{3,4})/);
  if (wh) return tierFromPixels(Number(wh[1]), Number(wh[2]));
  if (/4k|2160/.test(t)) return "4k";
  if (/1440/.test(t)) return "1440p";
  if (/2k/.test(t)) return "2k";
  if (/1080|1024p|full ?hd|fhd/.test(t)) return "1080p";
  if (/768/.test(t)) return "768p";
  if (/720|\bhd\b/.test(t)) return "720p";
  if (/480|512|0\.5k/.test(t)) return "480p";
  if (/1k/.test(t)) return "1080p";
  return null;
}

function tierFromPixels(w: number, h: number): ResolutionTier {
  const short = Math.min(w, h);
  if (short >= 2000) return "4k";
  if (short >= 1400) return "2k";
  if (short >= 1000) return "1080p";
  if (short >= 760) return "768p";
  if (short >= 700) return "720p";
  return "480p";
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function buildPricingContext(
  params: Record<string, unknown>,
  extra: { resolution?: string | null } = {},
): PricingContext {
  const texts = [extra.resolution, params.resolution, params.size, params.quality, params.mode]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  let tier: ResolutionTier | null = null;
  let width: number | null = null;
  let height: number | null = null;
  for (const text of texts) {
    const wh = text.match(/(\d{3,4})\s*[x×*]\s*(\d{3,4})/);
    if (wh && width === null) {
      width = Number(wh[1]);
      height = Number(wh[2]);
    }
    tier = tier ?? tierFromText(text);
  }
  const qualityText = String(params.quality ?? params.rendering_speed ?? "").toLowerCase();
  const quality: QualityTier | null = /high|hd|quality/.test(qualityText)
    ? "high"
    : /medium|standard|balanced|default/.test(qualityText)
      ? "medium"
      : /low|fast|turbo|draft/.test(qualityText)
        ? "low"
        : null;
  let seconds = num(params.duration) ?? num(params.seconds);
  if (seconds === null) {
    const frames = num(params.num_frames);
    const fps = num(params.fps);
    if (frames !== null && fps) seconds = Math.round((frames / fps) * 10) / 10;
  }
  const count = Math.max(1, Math.round(num(params.n) ?? num(params.num_images) ?? num(params.max_images) ?? 1));
  const audioRaw = params.generate_audio ?? params.audio ?? params.soundeffectswitch;
  const audio = audioRaw === undefined ? null : audioRaw === true || audioRaw === "true" || audioRaw === "on";
  return { tier, width, height, quality, seconds, count, audio };
}

export interface MediaEstimate {
  vendor: string;
  label: string;
  perItemUsd: number;
  totalUsd: number;
  perItemTokens: number | null;
  totalTokens: number | null;
  count: number;
  seconds: number | null;
  basis: string;
  source: string;
  note?: string;
  routes?: string[];
}

export function estimateMediaCost(
  kind: "image" | "video",
  modelId: string,
  params: Record<string, unknown>,
  extra: { resolution?: string | null; name?: string | null } = {},
): MediaEstimate | null {
  /*
   * NanoGPT 모델 ID·이름은 "qwen/qwen-image-3.0", "Seedance 2.0 Fast Spicy"처럼
   * 표기가 제각각이라, 원래 ID와 함께 점·밑줄·공백·슬래시를 "-"로 바꾼 형태와
   * 이름도 같이 비교합니다.
   */
  const normalize = (value: string) => value.toLowerCase().replace(/[\s._/]+/g, "-");
  const candidates = [modelId.toLowerCase(), normalize(modelId), extra.name ? normalize(extra.name) : ""]
    .filter(Boolean)
    .flatMap((value) => [value, value.replace(/^[^/]*\//, "")]);
  const rule = MEDIA_PRICING_RULES.find((item) => item.kind === kind && candidates.some((value) => item.match.test(value)));
  if (!rule) return null;
  // 기본 모델 규칙에 맞은 Fast·Mini·Lite 등 변형은 공식 단가를 따로 확인하지 못했으므로 알려 줍니다.
  const joined = candidates.join(" ");
  const variant = joined.match(/\b(fast|mini|lite|turbo|flash)\b/);
  const notes: string[] = [];
  if (variant && !rule.label.toLowerCase().includes(variant[1])) {
    notes.push(`이 모델(${variant[1]} 변형)의 공식 단가는 확인하지 못해 ${rule.label} 단가로 계산했습니다. 실제 청구액과 다를 수 있습니다.`);
  }
  if (/\bspicy\b|uncensored|nsfw/.test(joined)) {
    notes.push("무검열(Spicy 등) 버전의 별도 공식 단가는 공개되지 않아 같은 등급 모델 단가로 계산했습니다.");
  }
  const variantNote = notes.length ? notes.join(" ") : undefined;
  const ctx = buildPricingContext(params, extra);
  const result = rule.price(ctx);
  if (!result) return null;
  const count = kind === "image" ? ctx.count : 1;
  return {
    vendor: rule.vendor,
    label: rule.label,
    perItemUsd: result.usd,
    totalUsd: result.usd * count,
    perItemTokens: result.tokens ?? null,
    totalTokens: result.tokens !== undefined ? result.tokens * count : null,
    count,
    seconds: kind === "video" ? (ctx.seconds ?? rule.defaultSeconds ?? 5) : null,
    basis: result.basis,
    source: rule.source,
    note: variantNote ?? rule.note,
    routes: rule.routes,
  };
}
