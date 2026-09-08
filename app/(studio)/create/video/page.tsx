"use client";

import { useEffect, useRef, useState } from "react";
import {
  DynamicParamsPanel,
  type ParamValues,
} from "@/components/DynamicParams";
import { useStudioState } from "@/components/StudioState";
import { useModels } from "@/components/useModels";
import { AttachStrip, FileChip, ModelChip, ModelDetail, NewSessionButton, SendButton } from "@/components/studio-ui";
import { MAX_VIDEO_BYTES, needsVideoCompression, recordJob, uploadFiles, type AttachedFile } from "@/lib/client-api";
import { resolveVideoAttachmentPolicy } from "@/lib/attachment-policy";
import { filterSupportedParamValues } from "@/lib/models";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

interface VideoResult {
  url: string;
  prompt: string;
}

export default function VideoPage() {
  const models = useModels("video");
  const [prompt, setPrompt] = useStudioState<string>("video:prompt", "");
  const [startImage, setStartImage] = useStudioState<AttachedFile | null>("video:startImage", null);
  const [sourceVideo, setSourceVideo] = useStudioState<AttachedFile | null>("video:sourceVideo", null);
  const [endFrameImage, setEndFrameImage] = useStudioState<AttachedFile | null>("video:endFrameImage", null);
  const [paramValues, setParamValues] = useStudioState<ParamValues>("video:params", {});
  const [results, setResults] = useStudioState<VideoResult[]>("video:results", []);
  const [busy, setBusy] = useState(false);
  const [compressingVideo, setCompressingVideo] = useState(false);
  const [status, setStatus] = useState("");
  const [estimate, setEstimate] = useState<{ amount: number; currency: string | null; actual: boolean } | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; startedAt: number }>({ timer: null, startedAt: 0 });

  useEffect(() => {
    return () => {
      if (pollRef.current.timer) clearTimeout(pollRef.current.timer);
    };
  }, []);

  const policy = resolveVideoAttachmentPolicy(models.selected);
  const maxStartImages = policy.startImage.max;
  const supportsStartImage = policy.startImage.allowed;
  const supportsSourceVideo = policy.sourceVideo.allowed;
  // 원 개발사 자료로 끝 프레임 입력이 확인된 모델(예: Kling)에서만 노출합니다.
  // 근거: docs/model-capability-research.md, lib/model-capability-overlay.ts
  const supportsEndFrame = (models.selected?.extraImageRoles ?? []).some((role) => role.role === "end_frame");
  const durationNote = models.selected?.durationNote ?? null;
  // NanoGPT에는 영상 견적 전용 엔드포인트가 없어, 카탈로그가 공개한 단가로
  // 예상 비용을 보여 줍니다(공개하지 않는 모델은 표시하지 않습니다).
  const unitPrice = models.selected?.pricing?.perRequest ?? null;
  const currency = models.selected?.pricing?.currency ?? null;

  function changeParam(key: string, value: string | number | undefined) {
    setParamValues((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function pickStartImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (!supportsStartImage) {
      setError("이 모델은 시작 이미지를 지원하지 않습니다.");
      return;
    }
    try {
      const uploaded = await uploadFiles([file]);
      setStartImage(uploaded[0] ?? null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "이미지 업로드에 실패했습니다.");
    }
  }

  async function pickEndFrameImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (!supportsEndFrame) {
      setError("이 모델은 끝 프레임을 지원하지 않습니다.");
      return;
    }
    try {
      const uploaded = await uploadFiles([file]);
      setEndFrameImage(uploaded[0] ?? null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "이미지 업로드에 실패했습니다.");
    }
  }

  async function pickSourceVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (!supportsSourceVideo) {
      setError("이 모델은 원본 영상을 지원하지 않습니다.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError("원본 영상은 50MB 이하만 첨부할 수 있습니다.");
      return;
    }
    try {
      setCompressingVideo(needsVideoCompression(file));
      const uploaded = await uploadFiles([file]);
      setSourceVideo(uploaded[0] ?? null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "영상 업로드에 실패했습니다.");
    } finally {
      setCompressingVideo(false);
    }
  }

  function startNewSession() {
    setPrompt("");
    setStartImage(null);
    setSourceVideo(null);
    setEndFrameImage(null);
    setResults([]);
    setStatus("");
    setEstimate(null);
    setError("");
  }

  async function generate() {
    const text = prompt.trim();
    if (busy || !text) return;
    const model = models.selected;
    if (!model) {
      setError("모델을 선택해 주세요.");
      return;
    }
    setError("");
    setBusy(true);

    // 카탈로그 단가로 우선 어림값을 보여 주고, 실제 요청·완료 응답에 청구액이
    // 실리면 그 값으로 갈아 끼웁니다(NanoGPT 공식 문서: 응답마다 cost 필드가
    // 실제 청구액을 담아 옵니다).
    let quote = unitPrice !== null ? { amount: unitPrice, currency, actual: false } : null;
    setEstimate(quote);

    try {
      setStatus("영상 생성을 요청하고 있습니다…");
      const queueResponse = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          prompt: text,
          startImageId: supportsStartImage ? startImage?.id : undefined,
          sourceVideoId: supportsSourceVideo ? sourceVideo?.id : undefined,
          endImageId: supportsEndFrame ? endFrameImage?.id : undefined,
          params: filterSupportedParamValues(model.videoParams, paramValues),
        }),
      });
      const queueBody = await queueResponse.json().catch(() => ({}));
      if (!queueResponse.ok) throw new Error(queueBody.error || "영상 생성 요청에 실패했습니다.");

      if (queueBody.cost) {
        quote = { amount: queueBody.cost.amount, currency: queueBody.cost.currency ?? null, actual: true };
        setEstimate(quote);
      }

      const runId: string = queueBody.runId;
      pollRef.current = { timer: null, startedAt: Date.now() };
      setStatus("영상이 만들어지고 있습니다. 몇 분 정도 걸릴 수 있습니다…");

      await new Promise<void>((resolve) => {
        const poll = async () => {
          try {
            const retrieveResponse = await fetch(
              `/api/video/retrieve?run_id=${encodeURIComponent(runId)}`,
              { cache: "no-store" },
            );
            const retrieveBody = await retrieveResponse.json().catch(() => ({}));
            if (!retrieveResponse.ok) throw new Error(retrieveBody.error || "영상 결과 확인에 실패했습니다.");

            if (retrieveBody.status === "completed") {
              const url: string | null = retrieveBody.url ?? null;
              if (url) setResults((prev) => [{ url, prompt: text }, ...prev]);
              setStatus("");
              const finalCost = retrieveBody.cost
                ? { amount: retrieveBody.cost.amount, currency: retrieveBody.cost.currency ?? null, actual: true }
                : quote;
              setEstimate(finalCost);
              recordJob({
                mode: "video",
                model: model.id,
                prompt: text,
                attachments: [startImage, sourceVideo, endFrameImage].filter((item): item is AttachedFile => Boolean(item)),
                usage: null,
                unitPrice: model.pricing,
                cost: finalCost?.amount ?? null,
                currency: finalCost?.currency ?? null,
                costSource: finalCost?.actual ? "actual" : finalCost ? "estimated" : null,
                status: "completed",
                result: url ? { kind: "video", urls: [url] } : null,
              });
              resolve();
              return;
            }
            if (retrieveBody.status === "failed") {
              recordJob({
                mode: "video",
                model: model.id,
                prompt: text,
                attachments: [startImage, sourceVideo, endFrameImage].filter((item): item is AttachedFile => Boolean(item)),
                usage: null,
                unitPrice: model.pricing,
                cost: quote?.amount ?? null,
                currency: quote?.currency ?? null,
                costSource: quote?.actual ? "actual" : quote ? "estimated" : null,
                status: "failed",
                result: null,
              });
              throw new Error("영상 생성이 거부되거나 실패했습니다.");
            }
            if (Date.now() - pollRef.current.startedAt > POLL_TIMEOUT_MS) {
              throw new Error("영상 생성이 시간 내에 끝나지 않았습니다. 잠시 후 작업 기록에서 다시 확인해 주세요.");
            }
            pollRef.current.timer = setTimeout(poll, POLL_INTERVAL_MS);
          } catch (pollError) {
            setStatus("");
            setError(pollError instanceof Error ? pollError.message : "영상 생성에 실패했습니다.");
            pollRef.current.timer = null;
            resolve();
          }
        };
        pollRef.current.timer = setTimeout(poll, POLL_INTERVAL_MS);
      });
    } catch (generateError) {
      const message = generateError instanceof Error ? generateError.message : "영상 생성에 실패했습니다.";
      setStatus("");
      setError(message);
      recordJob({
        mode: "video",
        model: model.id,
        prompt: text,
        attachments: [startImage, sourceVideo, endFrameImage].filter((item): item is AttachedFile => Boolean(item)),
        usage: null,
        unitPrice: model.pricing,
        cost: quote?.amount ?? null,
        currency: quote?.currency ?? null,
        costSource: quote?.actual ? "actual" : quote ? "estimated" : null,
        status: "failed",
        result: null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio">
      <div className="studio-scroll">
        <div className="studio-inner">
          <div className="studio-toolbar">
            <NewSessionButton disabled={busy || compressingVideo} onClick={startNewSession} />
          </div>
          <ModelDetail hook={models} />
          <DynamicParamsPanel
            params={models.selected?.videoParams ?? []}
            values={paramValues}
            onChange={changeParam}
          />
          {durationNote ? <p className="muted" style={{ fontSize: 11.5, marginTop: -8, marginBottom: 12 }}>{durationNote}</p> : null}

          {results.length === 0 ? (
            <div className="studio-hero">
              <h1>영상 만들기</h1>
              <p>장면과 움직임을 문장으로 적어 보세요. 시작 이미지를 얹으면 그 장면에서 이어집니다.</p>
            </div>
          ) : (
            <>
              <div className="section-head">
                <h2>생성 결과</h2>
                <span className="section-sub">{results.length}편</span>
              </div>
              <div className="result-grid wide">
                {results.map((item, index) => (
                  <div key={`${item.url}-${index}`} className="asset-tile video-tile">
                    <video src={item.url} controls preload="metadata" />
                    <div className="asset-overlay">
                      <span className="asset-badge">영상</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {busy ? (
            <div className="progress-note" style={{ marginTop: 18 }}>
              <span className="spinner" /> {status}
            </div>
          ) : null}
          {estimate ? (
            <div className="cost-line">
              {estimate.actual ? "청구된 비용" : "예상 비용"}: {estimate.currency ?? "USD"} {estimate.amount.toFixed(4)}
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
            placeholder="만들고 싶은 영상을 설명해 주세요."
            rows={1}
          />
          <AttachStrip
            files={[startImage, endFrameImage, sourceVideo].filter((item): item is AttachedFile => Boolean(item))}
            onRemove={(id) => {
              if (startImage?.id === id) setStartImage(null);
              if (endFrameImage?.id === id) setEndFrameImage(null);
              if (sourceVideo?.id === id) setSourceVideo(null);
            }}
          />
          {compressingVideo ? (
            <div className="progress-note dock-alert">
              <span className="spinner" /> 큰 동영상을 4.5MB 미만으로 압축하고 있습니다…
            </div>
          ) : null}
          {error ? <div className="error-box dock-alert">{error}</div> : null}
          <div className="dock-row">
            <ModelChip hook={models} />
            <FileChip
              label={`시작 이미지 ${startImage ? 1 : 0}/${maxStartImages}`}
              accept="image/*"
              disabled={!supportsStartImage || compressingVideo}
              onPick={pickStartImage}
              title={supportsStartImage ? "시작 이미지 첨부" : "이 모델은 시작 이미지를 지원하지 않습니다"}
            />
            {supportsEndFrame ? (
              <FileChip
                label={`끝 프레임 ${endFrameImage ? 1 : 0}/1`}
                accept="image/*"
                disabled={compressingVideo}
                onPick={pickEndFrameImage}
                title="영상이 끝나는 장면의 이미지 첨부(선택)"
              />
            ) : null}
            {supportsSourceVideo ? (
              <FileChip
                label={`원본 영상 ${sourceVideo ? 1 : 0}/${policy.sourceVideo.max}`}
                accept="video/*"
                disabled={compressingVideo}
                onPick={pickSourceVideo}
                title="확장·편집할 원본 영상 첨부"
              />
            ) : null}
            <span className="dock-spacer" />
            {models.selected && !supportsStartImage && startImage ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                시작 이미지는 전송되지 않습니다
              </span>
            ) : null}
            <SendButton disabled={busy || compressingVideo || !prompt.trim()} onClick={generate} label="영상 생성" />
          </div>
        </div>
      </div>
    </div>
  );
}
