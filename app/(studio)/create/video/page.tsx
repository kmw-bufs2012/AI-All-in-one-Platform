"use client";

import { MediaCostEstimate } from "@/components/MediaCostEstimate";
import { useEffect, useRef, useState } from "react";
import {
  DynamicParamsPanel,
  type ParamValues,
} from "@/components/DynamicParams";
import { useStudioState } from "@/components/StudioState";
import { useModels } from "@/components/useModels";
import { AttachmentMedia, AttachStrip, FileChip, ModelChip, ModelDetail, NewSessionButton, SelectChip, SendButton } from "@/components/studio-ui";
import { GenerationTile, useNow, type GenerationJob } from "@/components/GenerationProgress";
import { INLINE_BUDGET_CHARS } from "@/lib/inline-media";
import { attachmentDataUrl, MAX_VIDEO_BYTES, needsVideoCompression, recordJob, uploadFiles, type AttachedFile } from "@/lib/client-api";
import { resolveVideoAttachmentPolicy } from "@/lib/attachment-policy";
import { filterSupportedParamValues } from "@/lib/models";
import { buildShotPrompt, type MasterSettings, type ShotFrame } from "@/lib/master-prompt";
import { applyMasterSettings, supportsNegativePrompt, supportsSeed } from "@/lib/master-settings-apply";


const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
/* 한 번에 동시에 만들 수 있는 최대 개수(요청을 나란히 보냅니다). */
const MAX_PARALLEL = 4;

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
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  // 마스터 프롬프트 화면에서 넘어온 값(lib/master-prompt.ts, components/VideoMasterPrompt.tsx).
  const [masterSettings] = useStudioState<MasterSettings | null>("video:masterSettings", null);
  const [masterPrompt] = useStudioState<string>("video:masterPrompt", "");
  const [shotFrames] = useStudioState<ShotFrame[]>("video:shotFrames", []);
  const [seedLock, setSeedLock] = useStudioState<{ locked: boolean; value: number }>("video:seed", { locked: false, value: 1234 });
  const [textParams, setTextParams] = useStudioState<Record<string, string>>("video:textParams", {});
  const [appliedNote, setAppliedNote] = useState("");
  const [droppedNote, setDroppedNote] = useState("");
  const [batchCount, setBatchCount] = useStudioState<string>("video:batchCount", "1");
  const now = useNow(jobs.length > 0);
  const [estimate, setEstimate] = useState<{ amount: number; currency: string | null; actual: boolean } | null>(null);
  const [error, setError] = useState("");
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
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
  // NanoGPT에는 동영상 견적 전용 엔드포인트가 없어, 카탈로그가 공개한 단가로
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

  const seedSupported = supportsSeed(models.selected);
  const negativeSupported = supportsNegativePrompt(models.selected);

  // 마스터 프롬프트 설정을 모델이 공개한 파라미터에 맞춰 자동으로 채웁니다(모델을 바꾸면 다시 맞춤).
  useEffect(() => {
    const model = models.selected;
    if (!model || !masterSettings) return;
    const result = applyMasterSettings(model, masterSettings, seedLock.locked ? seedLock.value : null);
    setParamValues((previous) => ({ ...previous, ...result.params }));
    setTextParams((previous) => ({ ...previous, ...result.text }));
    setAppliedNote(
      `마스터 프롬프트 설정 자동 적용: ${result.applied.length ? result.applied.join(", ") : "적용 가능한 항목 없음"}` +
        (result.skipped.length ? ` · 이 모델 미지원: ${result.skipped.join(", ")}` : ""),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.selected?.id, masterSettings]);

  function applyShot(index: number) {
    const frame = shotFrames[index];
    if (!frame) return;
    const shotPrompt = masterPrompt ? buildShotPrompt(masterPrompt, index) : null;
    if (shotPrompt) setPrompt(shotPrompt);
    if (frame.image) setStartImage(frame.image);
    const model = models.selected;
    if (model && masterSettings) {
      const result = applyMasterSettings(model, { ...masterSettings, duration: frame.end - frame.start }, seedLock.locked ? seedLock.value : null);
      setParamValues((previous) => ({ ...previous, ...result.params }));
    }
  }

  function applyWholeVideo() {
    if (masterPrompt) setPrompt(masterPrompt);
    if (shotFrames[0]?.image) setStartImage(shotFrames[0].image);
    const model = models.selected;
    if (model && masterSettings) {
      const result = applyMasterSettings(model, masterSettings, seedLock.locked ? seedLock.value : null);
      setParamValues((previous) => ({ ...previous, ...result.params }));
    }
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
      setError("이 모델은 원본 동영상을 지원하지 않습니다.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError("원본 동영상은 50MB 이하만 첨부할 수 있습니다.");
      return;
    }
    try {
      setCompressingVideo(needsVideoCompression(file));
      const uploaded = await uploadFiles([file]);
      setSourceVideo(uploaded[0] ?? null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "동영상 업로드에 실패했습니다.");
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
    setJobs([]);
    setEstimate(null);
    setError("");
  }

  function updateJob(id: string, patch: Partial<GenerationJob>) {
    setJobs((prev) => prev.map((job) => (job.id === id ? { ...job, ...patch } : job)));
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
    const count = Math.max(1, Math.min(MAX_PARALLEL, Number(batchCount) || 1));
    // 동영상 길이에 비례해 보통 걸리는 시간을 잡습니다(추정 진행률용).
    const seconds = Number(paramValues.duration ?? paramValues.seconds) || 6;
    const expectedMs = Math.min(8 * 60 * 1000, 60 * 1000 + seconds * 15 * 1000);
    const startedAt = Date.now();
    const batch: GenerationJob[] = Array.from({ length: count }, (_, index) => ({
      id: `${startedAt}-${index}`,
      startedAt,
      expectedMs,
      reported: null,
      status: "요청 중",
      state: "running",
    }));
    setJobs(batch);
    // 카탈로그 단가로 우선 어림값을 보여 주고, 실제 응답에 청구액이 실리면
    // 그 값으로 바꿉니다(NanoGPT 공식 문서: 응답마다 cost 필드가 실제 청구액).
    setEstimate(unitPrice !== null ? { amount: unitPrice * count, currency, actual: false } : null);
    const attachments = [startImage, sourceVideo, endFrameImage].filter((item): item is AttachedFile => Boolean(item));
    const errors: string[] = [];

    // 서버 임시 저장소에서 첨부가 사라져도 되도록 브라우저 7일 보관 사본을 함께 보냅니다
    // (요청 본문 한도 안에서 시작 이미지 → 끝 프레임 → 원본 동영상 순).
    let budget = INLINE_BUDGET_CHARS;
    const inline = async (file: AttachedFile | null, allowed: boolean) => {
      if (!file || !allowed) return undefined;
      const dataUrl = await attachmentDataUrl(file, budget);
      if (dataUrl) budget -= dataUrl.length;
      return dataUrl ?? undefined;
    };
    const startImageDataUrl = await inline(startImage, supportsStartImage);
    const endImageDataUrl = await inline(endFrameImage, supportsEndFrame);
    const sourceVideoDataUrl = await inline(sourceVideo, supportsSourceVideo);

    const runJob = async (job: GenerationJob) => {
      let quote = unitPrice !== null ? { amount: unitPrice, currency, actual: false } : null;
      const record = (state: "completed" | "failed", url: string | null) =>
        recordJob({
          mode: "video",
          model: model.id,
          prompt: text,
          attachments,
          usage: null,
          unitPrice: model.pricing,
          cost: quote?.amount ?? null,
          currency: quote?.currency ?? null,
          costSource: quote?.actual ? "actual" : quote ? "estimated" : null,
          status: state,
          result: url ? { kind: "video", urls: [url] } : null,
        });
      try {
        const queueResponse = await fetch("/api/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model.id,
            prompt: text,
            startImageId: supportsStartImage ? startImage?.id : undefined,
            sourceVideoId: supportsSourceVideo ? sourceVideo?.id : undefined,
            endImageId: supportsEndFrame ? endFrameImage?.id : undefined,
            startImageDataUrl,
            endImageDataUrl,
            sourceVideoDataUrl,
            params: {
              ...filterSupportedParamValues(model.videoParams, paramValues),
              ...(negativeSupported && textParams.negative_prompt ? { negative_prompt: textParams.negative_prompt.slice(0, 500) } : {}),
              ...(seedSupported && seedLock.locked ? { seed: seedLock.value } : {}),
            },
          }),
        });
        const queueBody = await queueResponse.json().catch(() => ({}));
        if (!queueResponse.ok) throw new Error(queueBody.error || "동영상 생성 요청에 실패했습니다.");
        if (queueBody.droppedReference) {
          setDroppedNote("NanoGPT가 이 모델에서 참조 동영상을 받지 않아, 참조 동영상 없이 생성했습니다.");
        }
        if (queueBody.cost) quote = { amount: queueBody.cost.amount, currency: queueBody.cost.currency ?? null, actual: true };
        const runId: string = queueBody.runId;
        updateJob(job.id, { status: "동영상 만드는 중" });

        for (;;) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              timersRef.current.delete(timer);
              resolve();
            }, POLL_INTERVAL_MS);
            timersRef.current.add(timer);
          });
          if (!mountedRef.current) return;
          const retrieveResponse = await fetch(`/api/video/retrieve?run_id=${encodeURIComponent(runId)}`, { cache: "no-store" });
          const retrieveBody = await retrieveResponse.json().catch(() => ({}));
          if (!retrieveResponse.ok) throw new Error(retrieveBody.error || "동영상 결과 확인에 실패했습니다.");
          if (retrieveBody.cost) {
            quote = { amount: retrieveBody.cost.amount, currency: retrieveBody.cost.currency ?? null, actual: true };
          }
          if (retrieveBody.status === "completed") {
            const url: string | null = retrieveBody.url ?? null;
            if (url) setResults((prev) => [{ url, prompt: text }, ...prev]);
            updateJob(job.id, { state: "done", status: "완료", reported: 100 });
            record("completed", url);
            return quote;
          }
          if (retrieveBody.status === "failed") throw new Error("동영상 생성이 거부되거나 실패했습니다.");
          const reported = typeof retrieveBody.progress === "number" ? retrieveBody.progress : null;
          const label = String(retrieveBody.status || "").toLowerCase();
          updateJob(job.id, {
            reported,
            status: /queue|pending|wait/.test(label) ? "대기열에서 기다리는 중" : "동영상 만드는 중",
          });
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            throw new Error("동영상 생성이 시간 내에 끝나지 않았습니다. 잠시 후 작업 기록에서 다시 확인해 주세요.");
          }
        }
      } catch (jobError) {
        const message = jobError instanceof Error ? jobError.message : "동영상 생성에 실패했습니다.";
        errors.push(message);
        updateJob(job.id, { state: "failed", status: message });
        record("failed", null);
        return quote;
      }
    };

    try {
      const quotes = await Promise.all(batch.map((job) => runJob(job)));
      const known = quotes.filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (known.length > 0) {
        setEstimate({
          amount: known.reduce((sum, item) => sum + item.amount, 0),
          currency: known[0].currency,
          actual: known.every((item) => item.actual),
        });
      }
      if (errors.length > 0) {
        setError(count > 1 ? `${count}개 중 ${errors.length}개 실패: ${errors[0]}` : errors[0]);
      }
    } finally {
      // 실패한 타일은 잠시 보여 준 뒤 지웁니다.
      setJobs((prev) => prev.filter((job) => job.state === "failed"));
      setTimeout(() => setJobs([]), 6000);
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
          <MediaCostEstimate
            kind="video"
            modelId={models.selected?.id}
            params={paramValues}
            resolution={null}
            multiplier={Number(batchCount) || 1}
            catalogUnitPrice={models.selected?.pricing?.perRequest ?? null}
            catalogCurrency={models.selected?.pricing?.currency ?? null}
          />
          {appliedNote ? <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>{appliedNote}</p> : null}
          {droppedNote ? <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>{droppedNote}</p> : null}
          <div className="video-extra-settings">
            <label className="seed-control" title={seedSupported ? "같은 시드로 다시 만들면 결과 편차가 줄어듭니다" : "선택한 모델은 시드를 공개하지 않았습니다"}>
              <input
                type="checkbox"
                checked={seedLock.locked}
                disabled={!seedSupported}
                onChange={(event) => setSeedLock({ ...seedLock, locked: event.target.checked })}
              />
              <span>시드 고정</span>
              <input
                type="number"
                min={0}
                max={2147483647}
                value={seedLock.value}
                disabled={!seedSupported || !seedLock.locked}
                onChange={(event) => setSeedLock({ ...seedLock, value: Math.max(0, Math.min(2147483647, Math.floor(Number(event.target.value) || 0))) })}
              />
              <button
                type="button"
                className="secondary"
                disabled={!seedSupported || !seedLock.locked}
                onClick={() => setSeedLock({ ...seedLock, value: Math.floor(Math.random() * 2147483647) })}
                title="새 시드 뽑기"
              >
                새 시드
              </button>
              {!seedSupported && models.selected ? <span className="muted">(이 모델 미지원)</span> : null}
            </label>
            {negativeSupported ? (
              <label className="negative-control">
                <span>네거티브 프롬프트</span>
                <textarea
                  value={textParams.negative_prompt ?? ""}
                  maxLength={500}
                  onChange={(event) => setTextParams({ ...textParams, negative_prompt: event.target.value })}
                  placeholder="나오지 않았으면 하는 것(예: 얼굴 변형, 의상 변경, 깜빡임, 워터마크)"
                />
              </label>
            ) : null}
          </div>
          {shotFrames.length > 0 ? (
            <div className="shot-panel">
              <div className="shot-panel-head">
                <strong>참조 동영상 장면 ({shotFrames.length}개)</strong>
                <button type="button" className="secondary" onClick={applyWholeVideo} disabled={busy}>
                  전체 프롬프트 + 첫 프레임 사용
                </button>
              </div>
              <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 8px" }}>
                장면을 누르면 그 장면의 첫 프레임을 시작 이미지로, 그 장면만 담은 프롬프트와 길이를 채웁니다. 장면별로 만든 뒤 편집
                프로그램에서 이어 붙이면 원본에 더 가깝게 재현됩니다.
              </p>
              <div className="shot-grid">
                {shotFrames.map((frame, index) => (
                  <button key={`${frame.start}-${index}`} type="button" className="shot-card" onClick={() => applyShot(index)} disabled={busy}>
                    {frame.image ? <AttachmentMedia kind="image" url={frame.image.url} alt={`장면 ${index + 1} 첫 프레임`} /> : <span className="shot-noimg">프레임 없음</span>}
                    <span>
                      장면 {index + 1} · {frame.start.toFixed(1)}–{frame.end.toFixed(1)}초
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {policy.note ? <p className="muted" style={{ fontSize: 11.5, marginTop: -8, marginBottom: 12 }}>{policy.note}</p> : null}
          {durationNote ? <p className="muted" style={{ fontSize: 11.5, marginTop: -8, marginBottom: 12 }}>{durationNote}</p> : null}

          {jobs.length > 0 ? (
            <div className="result-grid wide" style={{ marginBottom: 18 }}>
              {jobs.map((job) => (
                <GenerationTile key={job.id} job={job} now={now} wide />
              ))}
            </div>
          ) : null}

          {results.length === 0 && jobs.length === 0 ? (
            <div className="studio-hero">
              <h1>동영상 만들기</h1>
              <p>장면과 움직임을 문장으로 적어 보세요. 시작 이미지를 얹으면 그 장면에서 이어집니다.</p>
            </div>
          ) : results.length === 0 ? null : (
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
                      <span className="asset-badge">동영상</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

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
            placeholder="만들고 싶은 동영상을 설명해 주세요."
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
                title="동영상이 끝나는 장면의 이미지 첨부(선택)"
              />
            ) : null}
            {supportsSourceVideo ? (
              <FileChip
                label={`${/reference/i.test(models.selected?.id ?? "") ? "참조" : "원본"} 동영상 ${sourceVideo ? 1 : 0}/${policy.sourceVideo.max}`}
                accept="video/*"
                disabled={compressingVideo}
                onPick={pickSourceVideo}
                title="확장·편집할 원본 동영상 첨부"
              />
            ) : null}
            <SelectChip
              icon="quality"
              title="같은 설정으로 동시에 만들 개수(요청을 나란히 보냅니다)"
              value={batchCount}
              onChange={setBatchCount}
              disabled={busy}
              options={Array.from({ length: MAX_PARALLEL }, (_, index) => ({
                value: String(index + 1),
                label: `${index + 1}개 동시 생성`,
              }))}
            />
            <span className="dock-spacer" />
            {models.selected && !supportsStartImage && startImage ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                시작 이미지는 전송되지 않습니다
              </span>
            ) : null}
            <SendButton disabled={busy || compressingVideo || !prompt.trim()} onClick={generate} label="동영상 생성" />
          </div>
        </div>
      </div>
    </div>
  );
}
