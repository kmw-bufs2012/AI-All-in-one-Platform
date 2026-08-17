"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useStudioState } from "@/components/StudioState";
import { useModels } from "@/components/useModels";
import {
  AttachStrip,
  FileChip,
  Lightbox,
  ModelChip,
  ModelDetail,
  SelectChip,
  SendButton,
} from "@/components/studio-ui";
import { recordJob, uploadFiles, type AttachedFile } from "@/lib/client-api";
import { resolveImageAttachmentPolicy } from "@/lib/attachment-policy";
import { formatCost } from "@/lib/cost";

/** 비율을 고르지 않으면 폭·높이를 보내지 않아 모델 기본값으로 생성됩니다. */
const RATIOS: Array<{ value: string; label: string; width?: number; height?: number }> = [
  { value: "default", label: "모델 기본" },
  { value: "square", label: "정사각형 1:1", width: 1024, height: 1024 },
  { value: "wide", label: "가로 16:9", width: 1280, height: 720 },
  { value: "tall", label: "세로 9:16", width: 720, height: 1280 },
  { value: "photo", label: "사진 4:3", width: 1152, height: 864 },
];

export default function ImagePage() {
  const models = useModels("image");
  const [prompt, setPrompt] = useStudioState<string>("image:prompt", "");
  const [refs, setRefs] = useStudioState<AttachedFile[]>("image:refs", []);
  const [ratio, setRatio] = useStudioState<string>("image:ratio", "default");
  const [results, setResults] = useStudioState<string[]>("image:results", []);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [costLine, setCostLine] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const policy = resolveImageAttachmentPolicy();
  const maxRefs = policy.reference.max;
  const supportsRefs = policy.reference.allowed;

  async function pickRefs(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError("");
    if (refs.length + files.length > maxRefs) {
      setError(`참조 이미지는 최대 ${maxRefs}개까지 첨부할 수 있습니다.`);
      return;
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
    const size = RATIOS.find((item) => item.value === ratio);
    try {
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          prompt: text,
          styleImageIds: refs.map((item) => item.id),
          width: size?.width,
          height: size?.height,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "이미지 생성에 실패했습니다.");
      const urls: string[] = Array.isArray(body.urls) ? body.urls : [];
      setResults((prev) => [...urls, ...prev]);
      setCostLine(formatCost(null, null));
      recordJob({
        mode: "image",
        model: model.id,
        prompt: text,
        attachments: refs,
        usage: null,
        unitPrice: model.pricing,
        cost: null,
        currency: null,
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
          <ModelDetail hook={models} />

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
            <SelectChip
              icon="ratio"
              title="이미지 비율"
              value={ratio}
              onChange={setRatio}
              options={RATIOS.map((item) => ({ value: item.value, label: item.label }))}
            />
            <FileChip
              label={`참조 ${refs.length}/${maxRefs}`}
              accept="image/*"
              multiple
              disabled={!supportsRefs}
              onPick={pickRefs}
              title={supportsRefs ? "참조 이미지 첨부" : "이 모델은 참조 이미지를 지원하지 않습니다"}
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
