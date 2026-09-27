"use client";

import { useState } from "react";
import { useModels } from "@/components/useModels";
import { ModelChip, AttachStrip } from "@/components/studio-ui";
import { resolveChatAttachmentPolicy, MAX_TOTAL_FRAMES } from "@/lib/attachment-policy";
import { uploadFiles, extractVideoFrames, type AttachedFile } from "@/lib/client-api";
import {
  buildAnalysisPrompt,
  buildDirectPrompt,
  buildFromDescriptionPrompt,
  extractMasterPrompt,
  readVideoMeta,
  streamChat,
} from "@/lib/master-prompt";

/*
 * 동영상 → Seedance 2.0 Mini 복붙용 마스터 프롬프트 생성기.
 *
 * - 비전(LMM) 모델을 고르면 영상(또는 프레임)을 직접 보여 주고 한 번에 생성합니다.
 * - 텍스트 전용 LLM을 고르면 "영상 분석용 비전 모델"이 먼저 영상을 샷 단위로
 *   기술하고, 선택한 LLM이 그 기술을 바탕으로 마스터 프롬프트를 씁니다.
 */
export function VideoMasterPrompt({ onSave }: { onSave: (name: string, content: string) => Promise<void> }) {
  const writer = useModels("text", "model:prompt-writer");
  const analyzer = useModels("text", "model:prompt-analyzer");
  const [video, setVideo] = useState<AttachedFile | null>(null);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const writerPolicy = resolveChatAttachmentPolicy(writer.selected);
  const writerSeesVideo = writerPolicy.video.allowed;
  const analyzerPolicy = resolveChatAttachmentPolicy(analyzer.selected);

  async function pickVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const [uploaded] = await uploadFiles([file]);
      setVideo(uploaded);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "동영상 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  }

  /** 정책에 맞춰 영상을 video_url(직접) 또는 프레임으로 준비합니다. */
  async function videoPayload(policy: ReturnType<typeof resolveChatAttachmentPolicy>, attached: AttachedFile) {
    if (policy.videoNative) {
      return { attachments: { videos: [attached.id] }, frames: [], frameGroups: [] };
    }
    const blob = await fetch(attached.url).then((response) => {
      if (!response.ok) throw new Error("동영상 파일을 불러오지 못했습니다.");
      return response.blob();
    });
    const count = Math.max(1, Math.min(MAX_TOTAL_FRAMES, policy.image.max));
    const frames = await extractVideoFrames(new File([blob], attached.name, { type: attached.mime || blob.type }), count);
    return { attachments: {}, frames, frameGroups: [{ name: attached.name, count: frames.length }] };
  }

  async function generate() {
    if (!video || !writer.selected) return;
    setError("");
    setOutput("");
    setCopied(false);
    setRunning(true);
    try {
      const meta = await readVideoMeta(video.url, video.name);
      if (writerSeesVideo) {
        setStage(`${writer.selected.name}이(가) 영상을 보고 마스터 프롬프트를 작성하고 있습니다…`);
        const payload = await videoPayload(writerPolicy, video);
        await streamChat(
          {
            model: writer.selected.id,
            messages: [{ role: "user", content: buildDirectPrompt(meta, note) }],
            ...payload,
            pdfAllowed: false,
          },
          setOutput,
        );
      } else {
        if (!analyzer.selected || !analyzerPolicy.video.allowed) {
          throw new Error("텍스트 전용 모델을 쓰려면 영상을 볼 수 있는 분석용 비전 모델을 골라 주세요.");
        }
        setStage(`1/2 ${analyzer.selected.name}이(가) 영상을 샷 단위로 분석하고 있습니다…`);
        const payload = await videoPayload(analyzerPolicy, video);
        const description = await streamChat(
          {
            model: analyzer.selected.id,
            messages: [{ role: "user", content: buildAnalysisPrompt(meta) }],
            ...payload,
            pdfAllowed: false,
          },
          (text) => setOutput(`[영상 분석 중]\n\n${text}`),
        );
        if (!description.trim()) throw new Error("분석용 모델이 영상 설명을 돌려주지 않았습니다.");
        setStage(`2/2 ${writer.selected.name}이(가) 마스터 프롬프트를 작성하고 있습니다…`);
        setOutput("");
        await streamChat(
          {
            model: writer.selected.id,
            messages: [{ role: "user", content: buildFromDescriptionPrompt(meta, description, note) }],
            pdfAllowed: false,
          },
          setOutput,
        );
      }
      setStage("");
    } catch (generateError) {
      setStage("");
      setError(generateError instanceof Error ? generateError.message : "마스터 프롬프트 생성에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  const masterPrompt = output ? extractMasterPrompt(output) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(masterPrompt);
      setCopied(true);
    } catch {
      setError("클립보드에 복사하지 못했습니다. 아래 내용을 직접 선택해 복사해 주세요.");
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, marginBottom: 6 }}>동영상 → Seedance 2.0 Mini 마스터 프롬프트</h2>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
        동영상을 첨부하면 같은 영상을 다시 만들 수 있는 복붙용 프롬프트를 선택한 모델로 생성합니다. Seedance 2.0 Mini는
        한 번에 최대 15초까지 생성하므로, 더 긴 영상은 앞 15초를 기준으로 작성합니다.
      </p>
      <div className="stack">
        <div>
          <label>프롬프트 작성 모델 (LLM·LMM 전체, 검색 가능)</label>
          <ModelChip hook={writer} />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {writer.selected
              ? writerSeesVideo
                ? writerPolicy.videoNative
                  ? "이 모델은 동영상을 직접 봅니다."
                  : `이 모델은 동영상에서 뽑은 프레임(최대 ${Math.min(MAX_TOTAL_FRAMES, writerPolicy.image.max)}장)을 봅니다.`
                : "텍스트 전용 모델입니다. 아래 분석용 비전 모델이 먼저 영상을 설명해 줍니다."
              : null}
          </div>
        </div>
        {writer.selected && !writerSeesVideo ? (
          <div>
            <label>영상 분석용 비전 모델</label>
            <ModelChip hook={analyzer} />
            {analyzer.selected && !analyzerPolicy.video.allowed ? (
              <div className="error-box" style={{ marginTop: 6 }}>이 모델은 영상을 볼 수 없습니다. 비전 모델을 골라 주세요.</div>
            ) : null}
          </div>
        ) : null}
        <div>
          <label>참조 동영상</label>
          <input type="file" accept="video/*" onChange={pickVideo} disabled={uploading || running} />
          {uploading ? <div className="muted" style={{ fontSize: 12 }}><span className="spinner" /> 업로드하고 있습니다…</div> : null}
          {video ? <AttachStrip files={[video]} onRemove={() => setVideo(null)} /> : null}
        </div>
        <div>
          <label htmlFor="master-note">추가 요청 (선택)</label>
          <textarea
            id="master-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="예: 대사는 한국어로, 인물 의상만 빨간색으로 바꿔 주세요."
            style={{ minHeight: 60 }}
          />
        </div>
        {error ? <div className="error-box">{error}</div> : null}
        <button type="button" onClick={generate} disabled={!video || !writer.selected || running || uploading}>
          {running ? "생성하고 있습니다…" : "마스터 프롬프트 생성"}
        </button>
        {stage ? <div className="muted" style={{ fontSize: 12 }}><span className="spinner" /> {stage}</div> : null}
        {output ? (
          <div>
            <label>복붙용 마스터 프롬프트</label>
            <textarea readOnly value={masterPrompt} style={{ minHeight: 220, fontFamily: "monospace", fontSize: 12.5 }} />
            {masterPrompt !== output.trim() && !running ? (
              <details style={{ marginTop: 6 }}>
                <summary className="muted" style={{ fontSize: 12 }}>설정 참고 및 전체 응답 보기</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{output}</pre>
              </details>
            ) : null}
            <div className="actions" style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" className="secondary" onClick={copy} disabled={running || !masterPrompt}>
                {copied ? "복사했습니다" : "복사"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={running || !masterPrompt}
                onClick={() => onSave(`Seedance 2.0 Mini · ${video?.name ?? "동영상"}`.slice(0, 100), masterPrompt.slice(0, 20000))}
              >
                프롬프트로 저장
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
