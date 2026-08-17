"use client";

import { useEffect, useRef, useState } from "react";
import { useStudioState } from "@/components/StudioState";
import { useModels } from "@/components/useModels";
import { AttachStrip, FileChip, ModelChip, ModelDetail, SendButton } from "@/components/studio-ui";
import { recordJob, uploadFiles, type AttachedFile } from "@/lib/client-api";

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
  const [results, setResults] = useStudioState<VideoResult[]>("video:results", []);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [estimate, setEstimate] = useState<{ amount: number; currency: string | null } | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; startedAt: number }>({ timer: null, startedAt: 0 });

  useEffect(() => {
    return () => {
      if (pollRef.current.timer) clearTimeout(pollRef.current.timer);
    };
  }, []);

  async function pickStartImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      const uploaded = await uploadFiles([file]);
      setStartImage(uploaded[0] ?? null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "이미지 업로드에 실패했습니다.");
    }
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
    setStatus("비용 견적을 확인하고 있습니다…");

    let quote: { amount: number; currency: string | null } | null = null;
    try {
      const quoteResponse = await fetch("/api/video/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.id, prompt: text, startImageId: startImage?.id }),
      });
      const quoteBody = await quoteResponse.json().catch(() => ({}));
      if (quoteResponse.ok && quoteBody.cost) {
        quote = quoteBody.cost;
        setEstimate(quote);
      }
    } catch {
      // 견적을 못 받아도 생성은 계속 진행합니다.
    }

    try {
      setStatus("영상 생성을 요청하고 있습니다…");
      const queueResponse = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.id, prompt: text, startImageId: startImage?.id }),
      });
      const queueBody = await queueResponse.json().catch(() => ({}));
      if (!queueResponse.ok) throw new Error(queueBody.error || "영상 생성 요청에 실패했습니다.");

      const queueId: string = queueBody.queueId;
      pollRef.current = { timer: null, startedAt: Date.now() };
      setStatus("영상이 만들어지고 있습니다. 몇 분 정도 걸릴 수 있습니다…");

      await new Promise<void>((resolve) => {
        const poll = async () => {
          try {
            const retrieveResponse = await fetch(
              `/api/video/retrieve?queue_id=${encodeURIComponent(queueId)}&model=${encodeURIComponent(model.id)}`,
              { cache: "no-store" },
            );
            const retrieveBody = await retrieveResponse.json().catch(() => ({}));
            if (!retrieveResponse.ok) throw new Error(retrieveBody.error || "영상 결과 확인에 실패했습니다.");

            if (retrieveBody.status === "completed") {
              const url: string | null = retrieveBody.url ?? null;
              if (url) setResults((prev) => [{ url, prompt: text }, ...prev]);
              setStatus("");
              recordJob({
                mode: "video",
                model: model.id,
                prompt: text,
                attachments: startImage ? [startImage] : [],
                usage: null,
                unitPrice: quote ? { videoQuote: quote } : null,
                cost: quote?.amount ?? null,
                currency: quote?.currency ?? null,
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
                attachments: startImage ? [startImage] : [],
                usage: null,
                unitPrice: quote ? { videoQuote: quote } : null,
                cost: quote?.amount ?? null,
                currency: quote?.currency ?? null,
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
        attachments: startImage ? [startImage] : [],
        usage: null,
        unitPrice: quote ? { videoQuote: quote } : null,
        cost: quote?.amount ?? null,
        currency: quote?.currency ?? null,
        status: "failed",
        result: null,
      });
    } finally {
      setBusy(false);
    }
  }

  const supportsStartImage = models.selected?.supportsVideoInput ?? false;

  return (
    <div className="studio">
      <div className="studio-scroll">
        <div className="studio-inner">
          <ModelDetail hook={models} />

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
              예상 비용: {estimate.currency ?? "USD"} {estimate.amount.toFixed(4)}
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
          <AttachStrip files={startImage ? [startImage] : []} onRemove={() => setStartImage(null)} />
          {error ? <div className="error-box dock-alert">{error}</div> : null}
          <div className="dock-row">
            <ModelChip hook={models} />
            <FileChip
              label={`시작 이미지 ${startImage ? 1 : 0}/1`}
              accept="image/*"
              disabled={!supportsStartImage}
              onPick={pickStartImage}
              title={supportsStartImage ? "시작 이미지 첨부" : "이 모델은 시작 이미지를 지원하지 않습니다"}
            />
            <span className="dock-spacer" />
            {models.selected && !supportsStartImage && startImage ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                시작 이미지는 전송되지 않습니다
              </span>
            ) : null}
            <SendButton disabled={busy || !prompt.trim()} onClick={generate} label="영상 생성" />
          </div>
        </div>
      </div>
    </div>
  );
}
