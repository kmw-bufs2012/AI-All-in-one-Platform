"use client";

import { estimateMediaCost } from "@/lib/media-pricing";
import { estimateImageTokens, estimateTokens } from "@/lib/cost";

/*
 * 현재 선택한 모델·설정으로 결과물을 만들 때의 예상 토큰과 예상 비용을
 * 생성 전에 보여 줍니다. 제작사 공식 단가 기준과 NanoGPT 카탈로그 단가를
 * 나란히 보여 주고, 실제 청구액은 생성 후 응답에 담긴 값을 따릅니다.
 */
export function MediaCostEstimate({
  kind,
  modelId,
  params,
  resolution,
  catalogUnitPrice,
  catalogCurrency,
  multiplier = 1,
  modelName,
  prompt = "",
  referenceImages = 0,
  catalogInputPer1M = null,
}: {
  /** 모델 표시 이름. ID 표기가 달라도 공식 단가 규칙을 찾는 데 씁니다. */
  modelName?: string | null;
  /** 입력 토큰 추정용 프롬프트. */
  prompt?: string;
  /** 입력 토큰 추정용 참조 이미지 수. */
  referenceImages?: number;
  /** 카탈로그가 토큰 단가만 공개한 모델의 입력 100만 토큰당 단가. */
  catalogInputPer1M?: number | null;
  /** 동영상을 여러 개 동시에 만들 때의 개수. */
  multiplier?: number;
  kind: "image" | "video";
  modelId: string | null | undefined;
  params: Record<string, unknown>;
  resolution?: string | null;
  catalogUnitPrice: number | null;
  catalogCurrency: string | null;
}) {
  if (!modelId) return null;
  const single = estimateMediaCost(kind, modelId, params, { resolution, name: modelName });
  const estimate = single && multiplier > 1
    ? {
        ...single,
        totalUsd: single.totalUsd * multiplier,
        totalTokens: single.totalTokens !== null ? single.totalTokens * multiplier : null,
        basis: `${single.basis} × ${multiplier}개`,
      }
    : single;
  const count = estimate?.count ?? 1;
  const catalogTotal = catalogUnitPrice !== null ? catalogUnitPrice * (kind === "image" ? count : multiplier) : null;
  // 공식 단가·카탈로그 건당 단가가 모두 없어도 입력 토큰 추정은 항상 보여 줍니다.
  const inputTokens = (prompt.trim() ? estimateTokens(prompt) : 0) + estimateImageTokens(referenceImages);
  const inputTokenCost = catalogInputPer1M !== null ? (inputTokens / 1_000_000) * catalogInputPer1M * multiplier : null;
  if (!estimate && catalogTotal === null) {
    return (
      <div className="media-estimate" aria-live="polite">
        <div className="media-estimate-row">
          <span className="media-estimate-title">예상 사용량</span>
        </div>
        <div className="media-estimate-grid">
          <div>
            <div className="media-estimate-label">입력 예상 토큰 (프롬프트·참조 이미지)</div>
            <div className="media-estimate-value">약 {inputTokens.toLocaleString("ko-KR")} 토큰</div>
          </div>
          <div>
            <div className="media-estimate-label">총 예상 비용</div>
            <div className="media-estimate-value">
              {inputTokenCost !== null ? `${catalogCurrency ?? "USD"} ${inputTokenCost.toFixed(6)} 이상` : "단가 미공개"}
            </div>
          </div>
        </div>
        <div className="media-estimate-foot">
          {inputTokenCost !== null
            ? "NanoGPT 카탈로그의 입력 토큰 단가만으로 계산했습니다. 결과물(출력) 비용은 포함되지 않아 실제 청구액은 더 높습니다."
            : "이 모델은 제작사 공식 단가와 NanoGPT 카탈로그 단가를 모두 확인하지 못해 비용을 미리 계산할 수 없습니다. 실제 청구액은 생성 후 표시됩니다."}
        </div>
      </div>
    );
  }

  return (
    <div className="media-estimate" aria-live="polite">
      <div className="media-estimate-row">
        <span className="media-estimate-title">예상 사용량</span>
        {estimate ? (
          <span className="media-estimate-model">
            {estimate.vendor} · {estimate.label}
          </span>
        ) : null}
      </div>
      {estimate ? (
        <>
          <div className="media-estimate-grid">
            <div>
              <div className="media-estimate-label">총 예상 토큰</div>
              <div className="media-estimate-value">
                {estimate.totalTokens !== null ? `${estimate.totalTokens.toLocaleString("ko-KR")} 토큰` : "토큰 과금 아님"}
              </div>
            </div>
            <div>
              <div className="media-estimate-label">총 예상 비용 (제작사 공식 단가)</div>
              <div className="media-estimate-value">${estimate.totalUsd.toFixed(estimate.totalUsd < 0.1 ? 4 : 3)}</div>
            </div>
            {catalogTotal !== null ? (
              <div>
                <div className="media-estimate-label">NanoGPT 카탈로그 단가</div>
                <div className="media-estimate-value">
                  {catalogCurrency ?? "USD"} {catalogTotal.toFixed(4)}
                </div>
              </div>
            ) : null}
          </div>
          <div className="media-estimate-foot">
            {estimate.basis}
            {kind === "image" && count > 1 ? ` × ${count}장` : ""}
            {kind === "video" && estimate.seconds !== null && !("duration" in params || "seconds" in params)
              ? " (길이를 정하지 않아 기본 길이로 계산)"
              : ""}
          </div>
          {estimate.note ? <div className="media-estimate-foot">※ {estimate.note}</div> : null}
          <div className="media-estimate-foot">출처: {estimate.source}. 실제 청구액은 NanoGPT 단가를 따르며 생성 후 표시됩니다.</div>
        </>
      ) : (
        <>
          <div className="media-estimate-grid">
            <div>
              <div className="media-estimate-label">NanoGPT 카탈로그 단가</div>
              <div className="media-estimate-value">
                {catalogCurrency ?? "USD"} {catalogTotal!.toFixed(4)}
              </div>
            </div>
          </div>
          <div className="media-estimate-foot">이 모델은 제작사 공식 단가를 확인하지 못해 NanoGPT 카탈로그 값만 표시합니다.</div>
        </>
      )}
    </div>
  );
}
