export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface ComputedCost {
  cost: number | null;
  currency: string | null;
}

const CJK_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u2E80-\u303F\u3040-\u30FF\u4E00-\u9FFF]/;

export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += CJK_REGEX.test(char) ? 1.1 : 0.25;
  }
  return Math.max(1, Math.ceil(tokens));
}

export function estimateImageTokens(imageCount: number): number {
  return imageCount * 800;
}

export function computeChatCost(
  usage: ChatUsage,
  pricing: { inputPer1M: number | null; outputPer1M: number | null; currency: string | null } | null,
): ComputedCost {
  if (!pricing) return { cost: null, currency: null };
  if (pricing.inputPer1M === null && pricing.outputPer1M === null) {
    return { cost: null, currency: null };
  }
  const inputCost = pricing.inputPer1M !== null ? (usage.promptTokens / 1_000_000) * pricing.inputPer1M : 0;
  const outputCost = pricing.outputPer1M !== null ? (usage.completionTokens / 1_000_000) * pricing.outputPer1M : 0;
  return { cost: inputCost + outputCost, currency: pricing.currency ?? "USD" };
}

export function formatCost(cost: number | null, currency: string | null): string {
  if (cost === null) return "비용 정보 없음";
  const unit = currency ?? "USD";
  return `${unit} ${cost < 0.01 ? cost.toFixed(6) : cost.toFixed(4)}`;
}

export function formatUsage(usage: ChatUsage): string {
  return `입력 ${usage.promptTokens} · 출력 ${usage.completionTokens} · 합계 ${usage.totalTokens} 토큰${usage.estimated ? " (추정)" : ""}`;
}