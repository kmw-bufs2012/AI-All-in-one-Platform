"use client";

import { estimateMediaCost } from "@/lib/media-pricing";

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
}: {
  kind: "image" | "video";
  modelId: string | null | undefined;
  params: Record<string, unknown>;
  resolution?: string | null;
  catalogUnitPrice: number | null;
  catalogCurrency: string | null;
}) {
  if (!modelId) return null;
  const estimate = estimateMediaCost(kind, modelId, params, { resolution });
  const count = estimate?.count ?? 1;
  const catalogTotal = catalogUnitPrice !== null ? catalogUnitPrice * (kind === "image" ? count : 1) : null;
  if (!estimate && catalogTotal === null) return null;

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
