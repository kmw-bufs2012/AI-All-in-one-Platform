"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStudioState } from "@/components/StudioState";
import { extractAudioWav, extractFramesAt } from "@/lib/video-reference";
import { useModels } from "@/components/useModels";
import { ModelChip, AttachStrip } from "@/components/studio-ui";
import { resolveChatAttachmentPolicy, isVideoCapableModel, MAX_TOTAL_FRAMES } from "@/lib/attachment-policy";
import { uploadFiles, extractVideoFrames, attachmentBlob, type AttachedFile } from "@/lib/client-api";
import {
  buildDirectPrompt,
  checkMasterPrompt,
  extractMasterPrompt,
  extractMasterSettings,
  type MasterSettings,
  type ShotFrame,
  readVideoMeta,
  streamChat,
} from "@/lib/master-prompt";

/*
 * 동영상 → Seedance 2.0 Mini 복붙용 마스터 프롬프트 생성기.
 *
 * 동영상을 이해할 수 있는 멀티모달(LMM) 모델만 목록에 표시합니다
 * (isVideoCapableModel). 모델이 동영상 직접 입력을 지원하면 동영상을 그대로,
 * 아니면 시간 순 프레임으로 보여 주고 한 번에 마스터 프롬프트를 생성합니다.
 */
export function VideoMasterPrompt({ onSave }: { onSave: (name: string, content: string) => Promise<void> }) {
  const writer = useModels("text", "model:prompt-writer");
  const [video, setVideo] = useState<AttachedFile | null>(null);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sendReference, setSendReference] = useState(true);
  const [sending, setSending] = useState(false);
  const [audioMode, setAudioMode] = useState<"in-video" | "separate-file" | "none" | null>(null);
  const router = useRouter();
  // 동영상 생성 화면과 공유하는 값(app/(studio)/create/video/page.tsx).
  const [, setVideoPrompt] = useStudioState<string>("video:prompt", "");
  const [, setMasterPromptState] = useStudioState<string>("video:masterPrompt", "");
  const [, setMasterSettings] = useStudioState<MasterSettings | null>("video:masterSettings", null);
  const [, setShotFrames] = useStudioState<ShotFrame[]>("video:shotFrames", []);
  const [, setStartImage] = useStudioState<AttachedFile | null>("video:startImage", null);
  const [, setSourceVideo] = useStudioState<AttachedFile | null>("video:sourceVideo", null);

  const writerPolicy = resolveChatAttachmentPolicy(writer.selected);

  // 동영상을 이해하지 못하는 모델이 선택돼 있으면 첫 번째 동영상 지원 모델로 바꿉니다.
  useEffect(() => {
    if (!writer.models) return;
    if (writer.selected && isVideoCapableModel(writer.selected)) return;
    const first = writer.models.find(isVideoCapableModel);
    writer.setSelectedId(first?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writer.models, writer.selectedId]);
  const writerReady = Boolean(writer.selected && isVideoCapableModel(writer.selected));

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

  /** 정책에 맞춰 동영상을 video_url(직접) 또는 프레임으로 준비합니다. */
  async function videoPayload(policy: ReturnType<typeof resolveChatAttachmentPolicy>, attached: AttachedFile) {
    if (policy.videoNative) {
      return { attachments: { videos: [attached.id] }, frames: [], frameGroups: [] };
    }
    const blob = await attachmentBlob(attached);
    const count = Math.max(1, Math.min(MAX_TOTAL_FRAMES, policy.image.max));
    const frames = await extractVideoFrames(new File([blob], attached.name, { type: attached.mime || blob.type }), count);
    return { attachments: {}, frames, frameGroups: [{ name: attached.name, count: frames.length }] };
  }

  async function generate() {
    if (!video || !writer.selected || !writerReady) return;
    setError("");
    setOutput("");
    setCopied(false);
    setRunning(true);
    try {
      const meta = await readVideoMeta(video.url, video.name);
      setStage(`${writer.selected.name}이(가) 동영상을 보고 마스터 프롬프트를 작성하고 있습니다…`);
      const payload = await videoPayload(writerPolicy, video);
      /*
       * 대사·목소리·입모양: 음성을 들을 수 있는 모델(catalog audio_input — 예: Gemini,
       * Gemma 3n, GPT-4o audio 계열)에만 소리를 전달합니다.
       * - 동영상을 직접 보는 모델: 동영상 안의 소리를 그대로 듣게 합니다.
       * - 프레임만 보는 모델: 소리를 WAV로 뽑아 오디오 첨부로 따로 보냅니다.
       * - 음성을 못 듣는 모델: 대사를 지어내지 않도록 알립니다.
       */
      let mode: "in-video" | "separate-file" | "none" = "none";
      const attachments: Record<string, string[]> = { ...(payload.attachments as Record<string, string[]>) };
      if (writerPolicy.audio.allowed) {
        if (writerPolicy.videoNative) {
          mode = "in-video";
        } else {
          setStage("동영상에서 소리를 추출하고 있습니다…");
          const blob = await attachmentBlob(video);
          const wav = await extractAudioWav(blob, 15, `${video.name.replace(/\.[^.]+$/, "")}-audio.wav`);
          if (wav) {
            const [uploadedAudio] = await uploadFiles([wav]);
            attachments.audios = [uploadedAudio.id];
            mode = "separate-file";
          }
          setStage(`${writer.selected.name}이(가) 동영상을 보고 마스터 프롬프트를 작성하고 있습니다…`);
        }
      }
      setAudioMode(mode);
      await streamChat(
        {
          model: writer.selected.id,
          messages: [{ role: "user", content: buildDirectPrompt(meta, note, mode) }],
          ...payload,
          attachments,
          pdfAllowed: false,
        },
        setOutput,
      );
      setStage("");
    } catch (generateError) {
      setStage("");
      setError(generateError instanceof Error ? generateError.message : "마스터 프롬프트 생성에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  const masterPrompt = output ? extractMasterPrompt(output) : "";
  const structure = masterPrompt && !running ? checkMasterPrompt(masterPrompt) : null;

  /** 첫 프레임·장면별 첫 프레임·설정·(선택) 참조 동영상을 동영상 생성 화면으로 넘깁니다. */
  async function sendToVideo() {
    if (!video || !masterPrompt) return;
    setSending(true);
    setError("");
    try {
      const settings = extractMasterSettings(output, masterPrompt);
      const shots = settings.shots.length > 0 ? settings.shots : [{ start: 0, end: settings.duration ?? 5 }];
      setStage("장면별 첫 프레임을 추출하고 있습니다…");
      const blob = await attachmentBlob(video);
      const frames = await extractFramesAt(blob, shots.map((shot) => shot.start), video.name.replace(/\.[^.]+$/, ""));
      const present = frames.filter((frame): frame is File => frame !== null);
      const uploaded = present.length > 0 ? await uploadFiles(present) : [];
      let cursor = 0;
      const shotFrames: ShotFrame[] = shots.map((shot, index) => ({
        start: shot.start,
        end: shot.end,
        image: frames[index] ? uploaded[cursor++] ?? null : null,
      }));
      setMasterPromptState(masterPrompt);
      setMasterSettings(settings);
      setShotFrames(shotFrames);
      setVideoPrompt(masterPrompt);
      setStartImage(shotFrames[0]?.image ?? null);
      setSourceVideo(sendReference ? video : null);
      setStage("");
      router.push("/create/video");
    } catch (sendError) {
      setStage("");
      setError(sendError instanceof Error ? sendError.message : "동영상 생성 화면으로 보내지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

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
        동영상을 첨부하면 같은 동영상을 다시 만들 수 있는 복붙용 프롬프트를 선택한 모델로 생성합니다. 프롬프트는 항상
        동영상 스타일 → 캐릭터 스타일 → 배경 → 초 단위 메인 프롬프트(카메라샷·동작·캐릭터 일관성) → 네거티브 프롬프트 →
        모션 강도 순서로 작성됩니다. Seedance 2.0 Mini는
        한 번에 최대 15초까지 생성하므로, 더 긴 동영상은 앞 15초를 기준으로 작성합니다.
      </p>
      <div className="stack">
        <div>
          <label>프롬프트 작성 모델 (동영상을 이해하는 멀티모달 모델만 표시, 검색 가능)</label>
          <ModelChip hook={writer} include={isVideoCapableModel} emptyLabel="동영상 지원 모델 없음" />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {writerReady
              ? writerPolicy.videoNative
                ? "이 모델은 동영상을 직접 봅니다."
                : `이 모델에는 동영상에서 시간 순으로 뽑은 프레임(최대 ${Math.min(MAX_TOTAL_FRAMES, writerPolicy.image.max)}장)을 보냅니다.`
              : null}
            {writerReady ? (
              <>
                {" "}
                {writerPolicy.audio.allowed
                  ? "음성도 들을 수 있어 대사를 원문 그대로 받아 적고 입모양 맞춤 지시를 넣습니다."
                  : "이 모델은 음성을 듣지 못해 대사는 확인할 수 없습니다(음성 입력 지원 모델을 고르면 대사·입모양까지 반영됩니다)."}
              </>
            ) : null}
          </div>
        </div>
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
        <button type="button" onClick={generate} disabled={!video || !writerReady || running || uploading}>
          {running ? "생성하고 있습니다…" : "마스터 프롬프트 생성"}
        </button>
        {stage ? <div className="muted" style={{ fontSize: 12 }}><span className="spinner" /> {stage}</div> : null}
        {output ? (
          <div>
            <label>복붙용 마스터 프롬프트</label>
            <textarea readOnly value={masterPrompt} style={{ minHeight: 220, fontFamily: "monospace", fontSize: 12.5 }} />
            {structure ? (
              structure.ok ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  ✓ 필수 구성 확인: 동영상 스타일 · 캐릭터 스타일 · 배경 → 초 단위 메인 프롬프트(카메라샷·동작) → 네거티브 프롬프트 → 모션 강도
                </div>
              ) : (
                <div className="error-box" style={{ marginTop: 6 }}>
                  필수 구성이 일부 빠졌습니다.
                  {structure.missing.length > 0 ? ` 누락: ${structure.missing.join(", ")}.` : ""}
                  {structure.outOfOrder ? " 구역 순서가 맞지 않습니다." : ""}
                  {!structure.hasTimestamps ? " 메인 프롬프트가 초 단위 구간으로 나뉘지 않았습니다." : ""}
                  {structure.hasTimestamps && !structure.shotsComplete ? " 일부 구간에 카메라샷(Camera) 또는 동작(Action)이 없습니다." : ""}
                  {" "}다시 생성해 주세요.
                </div>
              )
            ) : null}
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
              <button type="button" onClick={sendToVideo} disabled={running || sending || !masterPrompt || !video}>
                {sending ? "보내는 중…" : "동영상 생성 화면으로 보내기"}
              </button>
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 8 }}>
              <input type="checkbox" checked={sendReference} onChange={(event) => setSendReference(event.target.checked)} />
              참조 동영상도 함께 보내기 (참조 동영상을 받는 모델에서만 전송됩니다 — 예: Seedance reference-to-video)
            </label>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              보내면 첫 프레임이 시작 이미지로, 장면별 첫 프레임과 길이·비율·해상도·네거티브 프롬프트·모션 강도가 동영상 생성 화면에
              자동으로 채워집니다(선택한 모델이 지원하는 설정만).
              {audioMode === "none" ? " 이번 결과는 음성 없이 작성되어 대사가 빠져 있을 수 있습니다." : ""}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
