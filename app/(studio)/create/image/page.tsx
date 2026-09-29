"use client";

import { MediaCostEstimate } from "@/components/MediaCostEstimate";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { quoteNanoGpt } from "@/lib/nanogpt-pricing";
import {
  DynamicParamsPanel,
  type ParamValues,
} from "@/components/DynamicParams";
import { useStudioState } from "@/components/StudioState";
import { useModels } from "@/components/useModels";
import {
  AttachStrip,
  FileChip,
  Lightbox,
  ModelChip,
  ModelDetail,
  NewSessionButton,
  SelectChip,
  SendButton,
} from "@/components/studio-ui";
import { inlineAttachments, recordJob, uploadFiles, type AttachedFile } from "@/lib/client-api";
import { INLINE_BUDGET_CHARS } from "@/lib/inline-media";
import { resolveImageAttachmentPolicy } from "@/lib/attachment-policy";
import { formatCost } from "@/lib/cost";
import { filterSupportedParamValues } from "@/lib/models";
import { PROMPT_STYLE_PRESETS, paramKeyLabel } from "@/lib/model-param-labels";
import { GenerationTile, useNow, type GenerationJob } from "@/components/GenerationProgress";

/*
 * 해상도 목록은 고정값이 아니라 모델이 공개한 값을 씁니다.
 * NanoGPT 공식 문서: 지원 해상도는 /api/v1/image-models?detailed=true 의
 * supported_parameters.resolution 에서 읽어야 하며, 모델마다 다릅니다.
 * 고르지 않으면 resolution 을 보내지 않아 모델 기본값으로 생성됩니다.
 */
const DEFAULT_RESOLUTION = "default";
/* 한 번에 만들 수 있는 최대 장수. 모델이 n을 지원하지 않으면 요청을 나란히 보냅니다. */
const MAX_BATCH = 8;

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export default function ImagePage() {
  const models = useModels("image");
  const [prompt, setPrompt] = useStudioState<string>("image:prompt", "");
  const [refs, setRefs] = useStudioState<AttachedFile[]>("image:refs", []);
  const [resolution, setResolution] = useStudioState<string>("image:resolution", DEFAULT_RESOLUTION);
  const [paramValues, setParamValues] = useStudioState<ParamValues>("image:params", {});
  const [stylePreset, setStylePreset] = useStudioState<string>("image:stylePreset", "");
  const [results, setResults] = useStudioState<string[]>("image:results", []);
  const [generating, setGenerating] = useState(false);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [batchCount, setBatchCount] = useStudioState<string>("image:batchCount", "1");
  const [notice, setNotice] = useState("");
  const now = useNow(jobs.length > 0);
  const [error, setError] = useState("");
  const [costLine, setCostLine] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const policy = resolveImageAttachmentPolicy(models.selected);
  // 카탈로그가 style 계열 파라미터를 선언한 모델은 그 값을 구조화된 API
  // 파라미터로 그대로 보냅니다(DynamicParamsPanel). 선언하지 않은 모델에는
  // 존재하지 않는 필드를 보낼 수 없으므로, 프롬프트에 문구를 덧붙이는
  // 방식의 스타일 프리셋을 대신 보여 줍니다(lib/model-param-labels.ts 참고).
  const hasStructuredStyle = (models.selected?.imageParams ?? []).some((item) => /^style/i.test(item.key));
  const maxRefs = policy.reference.max;
  const supportsRefs = policy.reference.allowed;
  const resolutions = models.selected?.resolutions ?? [];
  const activeResolution = resolutions.includes(resolution) ? resolution : DEFAULT_RESOLUTION;
  const maxOutputImages = models.selected?.maxOutputImages ?? 1;
  // NanoGPT 요금표에서 지금 고른 해상도·비율·속도에 맞는 장당 단가(lib/nanogpt-pricing.ts).
  const unitPrice = quoteNanoGpt(models.selected?.pricingTable, { kind: "image", params: paramValues, count: 1 })?.usd
    ?? models.selected?.pricing?.perRequest ?? null;

  function changeParam(key: string, value: string | number | undefined) {
    setParamValues((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function startNewSession() {
    setPrompt("");
    setRefs([]);
    setResults([]);
    setError("");
    setCostLine("");
    setLightbox(null);
  }

  async function pickRefs(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError("");
    if (!supportsRefs) {
      setError("이 모델은 참조 이미지를 지원하지 않습니다.");
      return;
    }
    if (refs.length + files.length > maxRefs) {
      setError(`참조 이미지는 최대 ${maxRefs}개까지 첨부할 수 있습니다.`);
      return;
    }
    // 참조 이미지 1장의 크기 상한은 모델의 input_reference_constraints.max_bytes 입니다.
    if (policy.maxBytes !== null) {
      for (const file of files) {
        if (file.size > policy.maxBytes) {
          setError(`참조 이미지는 ${formatBytes(policy.maxBytes)} 이하만 첨부할 수 있습니다.`);
          return;
        }
      }
    }
    try {
      const uploaded = await uploadFiles(files);
      setRefs((prev) => [...prev, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "이미지 업로드에 실패했습니다.");
    }
  }

  async function generate() {
    const text = prompt.trim();
    if (generating || !text) return;
    const model = models.selected;
    if (!model) {
      setError("모델을 선택해 주세요.");
      return;
    }
    setError("");
    setNotice("");
    setGenerating(true);
    // 구조화된 style 파라미터가 없는 모델에서 프리셋을 골랐다면, API 파라미터가
    // 아니라 프롬프트 문구로 반영합니다(존재하지 않는 style 필드를 보내지 않기 위함).
    const preset = !hasStructuredStyle ? PROMPT_STYLE_PRESETS.find((item) => item.value === stylePreset) : undefined;
    const finalPrompt = preset ? `${text}, ${preset.promptPhrase}` : text;

    // 카탈로그 설정과 공식 문서로 보강한 설정을 나눠 보냅니다(서버가 공식 설정만
    // 거부되면 빼고 다시 시도합니다).
    const allowed = filterSupportedParamValues(model.imageParams, paramValues);
    const officialKeys = new Set(model.imageParams.filter((item) => item.origin === "official").map((item) => item.key));
    const catalogParams: ParamValues = {};
    const officialParams: ParamValues = {};
    for (const [key, value] of Object.entries(allowed)) {
      if (officialKeys.has(key)) officialParams[key] = value;
      else catalogParams[key] = value;
    }

    // 여러 장: 모델이 한 요청에 여러 장(n)을 지원하면 한 번에, 아니면 요청을 나란히 보냅니다.
    const wanted = Math.max(1, Math.min(MAX_BATCH, Number(batchCount) || 1));
    const perRequest = Math.min(wanted, Math.max(1, maxOutputImages));
    const requestCount = Math.ceil(wanted / perRequest);
    const startedAt = Date.now();
    const expectedMs = 25 * 1000 + (activeResolution.match(/4k|2048|4096/i) ? 20 * 1000 : 0);
    const batch: GenerationJob[] = Array.from({ length: wanted }, (_, index) => ({
      id: `${startedAt}-${index}`,
      startedAt,
      expectedMs,
      reported: null,
      status: "이미지 만드는 중",
      state: "running",
    }));
    setJobs(batch);

    // 서버 임시 저장소에서 참조 이미지가 사라져도 되도록 브라우저 7일 보관 사본을 함께 보냅니다.
    const inlineReferences = await inlineAttachments(refs, INLINE_BUDGET_CHARS);

    const runRequest = async (requestIndex: number) => {
      const n = Math.min(perRequest, wanted - requestIndex * perRequest);
      const jobIds = batch.slice(requestIndex * perRequest, requestIndex * perRequest + n).map((job) => job.id);
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model.id,
            prompt: finalPrompt,
            referenceIds: refs.map((item) => item.id),
            inlineReferences,
            resolution: activeResolution === DEFAULT_RESOLUTION ? undefined : activeResolution,
            officialResolution: model.officialResolutions === true,
            n: n > 1 ? n : undefined,
            params: catalogParams,
            officialParams,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "이미지 생성에 실패했습니다.");
        const urls: string[] = Array.isArray(body.urls) ? body.urls : [];
        setResults((prev) => [...urls, ...prev]);
        setJobs((prev) => prev.filter((job) => !jobIds.includes(job.id)));
        const dropped: string[] = Array.isArray(body.droppedParams) ? body.droppedParams : [];
        if (dropped.length > 0) {
          setNotice(`NanoGPT가 이 모델의 일부 설정(${dropped.map(paramKeyLabel).join(", ")})을 받지 않아 빼고 생성했습니다.`);
        }
        // NanoGPT 응답에 실제 청구액(cost)이 있으면 그 값을, 없으면 카탈로그 단가로 추정합니다.
        const actualCost = body.cost as { amount: number; currency: string | null } | null;
        const estimatedAmount = unitPrice !== null ? unitPrice * Math.max(urls.length, 1) : null;
        const amount = actualCost?.amount ?? estimatedAmount;
        const currency = actualCost?.currency ?? model.pricing?.currency ?? null;
        recordJob({
          mode: "image",
          model: model.id,
          prompt: text,
          attachments: refs,
          usage: null,
          unitPrice: model.pricing,
          cost: amount,
          currency,
          costSource: actualCost ? "actual" : amount !== null ? "estimated" : null,
          status: "completed",
          result: { kind: "images", urls },
        });
        return { amount, currency, actual: Boolean(actualCost), error: null as string | null };
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "이미지 생성에 실패했습니다.";
        setJobs((prev) => prev.map((job) => (jobIds.includes(job.id) ? { ...job, state: "failed", status: message } : job)));
        return { amount: null, currency: null, actual: false, error: message };
      }
    };

    try {
      const outcomes = await Promise.all(Array.from({ length: requestCount }, (_, index) => runRequest(index)));
      const priced = outcomes.filter((item) => item.amount !== null);
      if (priced.length > 0) {
        const total = priced.reduce((sum, item) => sum + (item.amount ?? 0), 0);
        setCostLine(`${priced.every((item) => item.actual) ? "" : "추정 "}${formatCost(total, priced[0].currency)}`);
      }
      const failures = outcomes.filter((item) => item.error);
      if (failures.length > 0) {
        setError(requestCount > 1 ? `${requestCount}개 요청 중 ${failures.length}개 실패: ${failures[0].error}` : failures[0].error!);
      }
    } finally {
      setGenerating(false);
      setTimeout(() => setJobs((prev) => prev.filter((job) => job.state === "running")), 6000);
    }
  }

  return (
    <div className="studio">
      <div className="studio-scroll">
        <div className="studio-inner">
          <div className="studio-toolbar">
            <NewSessionButton disabled={generating} onClick={startNewSession} />
          </div>
          <ModelDetail hook={models} />
          <DynamicParamsPanel
            params={models.selected?.imageParams ?? []}
            values={paramValues}
            onChange={changeParam}
            source={models.selected?.settingsSource}
          />
          <MediaCostEstimate
            kind="image"
            modelId={models.selected?.id}
            modelName={models.selected?.name}
            prompt={prompt}
            referenceImages={refs.length}
            catalogInputPer1M={models.selected?.pricing?.inputPer1M ?? null}
            params={{ ...paramValues, n: batchCount }}
            resolution={activeResolution === DEFAULT_RESOLUTION ? null : activeResolution}
            catalogUnitPrice={models.selected?.pricing?.perRequest ?? null}
            catalogCurrency={models.selected?.pricing?.currency ?? null}
            pricingTable={models.selected?.pricingTable ?? null}
          />

          {jobs.length > 0 ? (
            <div className="result-grid" style={{ marginBottom: 18 }}>
              {jobs.map((job) => (
                <GenerationTile key={job.id} job={job} now={now} />
              ))}
            </div>
          ) : null}
          {notice ? <p className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>{notice}</p> : null}

          {results.length === 0 && jobs.length === 0 ? (
            <div className="studio-hero">
              <h1>이미지 만들기</h1>
              <p>만들고 싶은 장면을 문장으로 적어 보세요. 참조 이미지를 더하면 분위기를 이어받습니다.</p>
            </div>
          ) : results.length === 0 ? null : (
            <>
              <div className="section-head">
                <h2>생성 결과</h2>
                <span className="section-sub">{results.length}장</span>
                {costLine ? <span className="section-sub" style={{ marginLeft: "auto" }}>{costLine}</span> : null}
              </div>
              <div className="result-grid">
                {results.map((url, index) => (
                  <div key={`${url}-${index}`} className="asset-tile" onClick={() => setLightbox(url)}>
                    <img src={url} alt={`생성 결과 ${index + 1}`} />
                    <div className="asset-overlay">
                      <span className="asset-badge">이미지</span>
                      <a
                        className="asset-action"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        title="새 창에서 열기"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Icon name="expand" size={14} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

        </div>
      </div>

      <div className="dock">
        <div className="dock-inner">
          <textarea
            className="dock-textarea"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                generate();
              }
            }}
            placeholder="만들고 싶은 이미지를 설명해 주세요."
            rows={1}
          />
          <AttachStrip files={refs} onRemove={(id) => setRefs((prev) => prev.filter((item) => item.id !== id))} />
          {error ? <div className="error-box dock-alert">{error}</div> : null}
          <div className="dock-row">
            <ModelChip hook={models} />
            {resolutions.length > 0 ? (
              <SelectChip
                icon="ratio"
                title="이미지 해상도"
                value={activeResolution}
                onChange={setResolution}
                options={[
                  { value: DEFAULT_RESOLUTION, label: "모델 기본" },
                  ...resolutions.map((item) => ({ value: item, label: item })),
                ]}
              />
            ) : null}
            {!hasStructuredStyle && models.selected ? (
              <SelectChip
                icon="quality"
                title="스타일 프리셋(프롬프트에 반영됩니다)"
                value={stylePreset}
                onChange={setStylePreset}
                options={[
                  { value: "", label: "스타일 프리셋 없음" },
                  ...PROMPT_STYLE_PRESETS.map((item) => ({ value: item.value, label: item.labelKo })),
                ]}
              />
            ) : null}
            <FileChip
              label={`참조 ${refs.length}/${maxRefs}`}
              accept={policy.accept}
              multiple={maxRefs > 1}
              disabled={!supportsRefs}
              onPick={pickRefs}
              title={
                supportsRefs
                  ? `참조 이미지 첨부 (최대 ${maxRefs}장 · ${policy.formats.join("·")})`
                  : "이 모델은 참조 이미지를 지원하지 않습니다"
              }
            />
            <SelectChip
              icon="quality"
              title={
                maxOutputImages > 1
                  ? `한 요청에 최대 ${maxOutputImages}장, 그 이상은 요청을 나란히 보냅니다`
                  : "요청을 나란히 보내 여러 장을 동시에 만듭니다"
              }
              value={batchCount}
              onChange={setBatchCount}
              disabled={generating}
              options={Array.from({ length: MAX_BATCH }, (_, index) => ({ value: String(index + 1), label: `${index + 1}장` }))}
            />
            <span className="dock-spacer" />
            {models.selected && !supportsRefs && refs.length > 0 ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                참조 이미지는 전송되지 않습니다
              </span>
            ) : null}
            <SendButton disabled={generating || !prompt.trim()} onClick={generate} label="이미지 생성" />
          </div>
        </div>
      </div>

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
