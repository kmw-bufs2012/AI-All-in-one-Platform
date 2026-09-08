"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
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
import { recordJob, uploadFiles, type AttachedFile } from "@/lib/client-api";
import { resolveImageAttachmentPolicy } from "@/lib/attachment-policy";
import { formatCost } from "@/lib/cost";
import { filterSupportedParamValues } from "@/lib/models";

/*
 * 해상도 목록은 고정값이 아니라 모델이 공개한 값을 씁니다.
 * NanoGPT 공식 문서: 지원 해상도는 /api/v1/image-models?detailed=true 의
 * supported_parameters.resolution 에서 읽어야 하며, 모델마다 다릅니다.
 * 고르지 않으면 resolution 을 보내지 않아 모델 기본값으로 생성됩니다.
 */
const DEFAULT_RESOLUTION = "default";

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export default function ImagePage() {
  const models = useModels("image");
  const [prompt, setPrompt] = useStudioState<string>("image:prompt", "");
  const [refs, setRefs] = useStudioState<AttachedFile[]>("image:refs", []);
  const [resolution, setResolution] = useStudioState<string>("image:resolution", DEFAULT_RESOLUTION);
  const [paramValues, setParamValues] = useStudioState<ParamValues>("image:params", {});
  const [results, setResults] = useStudioState<string[]>("image:results", []);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [costLine, setCostLine] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const policy = resolveImageAttachmentPolicy(models.selected);
  const maxRefs = policy.reference.max;
  const supportsRefs = policy.reference.allowed;
  const resolutions = models.selected?.resolutions ?? [];
  const activeResolution = resolutions.includes(resolution) ? resolution : DEFAULT_RESOLUTION;
  const maxOutputImages = models.selected?.maxOutputImages ?? 1;
  const unitPrice = models.selected?.pricing?.perRequest ?? null;

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
    setGenerating(true);
    try {
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          prompt: text,
          referenceIds: refs.map((item) => item.id),
          resolution: activeResolution === DEFAULT_RESOLUTION ? undefined : activeResolution,
          params: filterSupportedParamValues(model.imageParams, paramValues),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "이미지 생성에 실패했습니다.");
      const urls: string[] = Array.isArray(body.urls) ? body.urls : [];
      setResults((prev) => [...urls, ...prev]);
      // NanoGPT 응답에 실제 청구액(cost)이 실려 있으면 그 값을 그대로 쓰고,
      // 없을 때만 카탈로그 단가로 추정합니다(공식 문서: 응답마다 cost 필드가
      // 실제 청구액을 담아 옵니다).
      const actualCost = body.cost as { amount: number; currency: string | null } | null;
      const estimatedAmount = unitPrice !== null ? unitPrice * Math.max(urls.length, 1) : null;
      const finalAmount = actualCost?.amount ?? estimatedAmount;
      const finalCurrency = actualCost?.currency ?? models.selected?.pricing?.currency ?? null;
      setCostLine(formatCost(finalAmount, finalCurrency));
      recordJob({
        mode: "image",
        model: model.id,
        prompt: text,
        attachments: refs,
        usage: null,
        unitPrice: model.pricing,
        cost: finalAmount,
        currency: finalCurrency,
        costSource: actualCost ? "actual" : finalAmount !== null ? "estimated" : null,
        status: "completed",
        result: { kind: "images", urls },
      });
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "이미지 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
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
          />

          {results.length === 0 ? (
            <div className="studio-hero">
              <h1>이미지 만들기</h1>
              <p>만들고 싶은 장면을 문장으로 적어 보세요. 참조 이미지를 더하면 분위기를 이어받습니다.</p>
            </div>
          ) : (
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

          {generating ? (
            <div className="progress-note" style={{ marginTop: 18 }}>
              <span className="spinner" /> 이미지를 만들고 있습니다. 완료까지 시간이 걸릴 수 있습니다.
            </div>
          ) : null}
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
            <span className="dock-spacer" />
            {maxOutputImages > 1 ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                한 번에 최대 {maxOutputImages}장 생성 가능
              </span>
            ) : null}
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
