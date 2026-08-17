"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useStudioState } from "@/components/StudioState";
import { useModels } from "@/components/useModels";
import { AttachStrip, EmptyState, FileChip, Lightbox, ModelChip, ModelDetail, SendButton } from "@/components/studio-ui";
import {
  MAX_VIDEO_BYTES,
  extractVideoFrames,
  recordJob,
  uploadFiles,
  type AttachedFile,
} from "@/lib/client-api";
import { resolveChatAttachmentPolicy } from "@/lib/attachment-policy";
import { computeChatCost, estimateImageTokens, estimateTokens, formatCost, formatUsage } from "@/lib/cost";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: AttachedFile[];
  framesCount?: number;
  costLine?: string;
}

export default function ChatPage() {
  const models = useModels("text");
  const policy = resolveChatAttachmentPolicy(models.selected);
  const [messages, setMessages] = useStudioState<ChatMessage[]>("chat:messages", []);
  const [input, setInput] = useStudioState<string>("chat:input", "");
  const [attachments, setAttachments] = useStudioState<AttachedFile[]>("chat:attachments", []);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  // 프롬프트 관리 화면에서 넘어온 경우 입력창을 채웁니다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const promptId = params.get("loadPrompt");
    if (!promptId) return;
    fetch("/api/prompts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json().catch(() => ({}));
        const prompts: Array<{ id: number; content: string }> = Array.isArray(body.prompts) ? body.prompts : [];
        const found = prompts.find((item) => String(item.id) === promptId);
        if (found) {
          setInput(found.content);
          window.history.replaceState({}, "", "/create/chat");
        }
      })
      .catch(() => {});
    // 최초 1회만 수행합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError("");
    if (!policy.image.allowed) {
      setError("선택한 모델은 이미지를 인식하지 못합니다.");
      return;
    }
    const images = attachments.filter((item) => item.kind === "image");
    if (images.length + files.length > policy.image.max) {
      setError(`이 모델은 이미지를 최대 ${policy.image.max}개까지 첨부할 수 있습니다.`);
      return;
    }
    try {
      const uploaded = await uploadFiles(files);
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "이미지 업로드에 실패했습니다.");
    }
  }

  async function pickVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (!policy.video.allowed) {
      setError("선택한 모델은 동영상(이미지)을 인식하지 못합니다.");
      return;
    }
    if (attachments.some((item) => item.kind === "video")) {
      setError("동영상은 최대 1개까지 첨부할 수 있습니다.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError("동영상은 50MB 이하만 첨부할 수 있습니다.");
      return;
    }
    try {
      const uploaded = await uploadFiles([file]);
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "동영상 업로드에 실패했습니다.");
    }
  }

  async function pickDoc(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (attachments.some((item) => item.kind === "doc")) {
      setError("문서는 최대 1개까지 첨부할 수 있습니다.");
      return;
    }
    try {
      const uploaded = await uploadFiles([file]);
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "문서 업로드에 실패했습니다.");
    }
  }

  async function send() {
    const text = input.trim();
    if (sending || (!text && attachments.length === 0)) return;
    const model = models.selected;
    if (!model) {
      setError("모델을 선택해 주세요.");
      return;
    }
    setError("");
    setSending(true);

    const snapshot = [...attachments];
    const hasVision = model.lmm;
    let frames: string[] = [];
    let framesCount = 0;
    const videoAtt = snapshot.find((item) => item.kind === "video");
    if (videoAtt && hasVision) {
      try {
        const blob = await fetch(videoAtt.url).then((response) => response.blob());
        const videoFile = new File([blob], videoAtt.name, { type: videoAtt.mime });
        frames = await extractVideoFrames(videoFile, policy.frameCount);
        framesCount = frames.length;
      } catch {
        frames = [];
        framesCount = 0;
      }
    }

    const history = messages.map((message) => ({ role: message.role, content: message.content }));
    setMessages([
      ...messages,
      { role: "user", content: text, attachments: snapshot, framesCount },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setAttachments([]);

    let assistantText = "";
    let realUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          messages: [...history, { role: "user", content: text }],
          attachments: {
            images: snapshot.filter((item) => item.kind === "image").map((item) => item.id),
            docs: snapshot.filter((item) => item.kind === "doc").map((item) => item.id),
          },
          frames,
        }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "채팅 요청에 실패했습니다.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string") assistantText += delta;
            if (parsed.usage) realUsage = parsed.usage;
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: assistantText };
              return copy;
            });
          } catch {
            // 잘린 JSON 조각은 버퍼에 남겨 다음 청크에서 이어 붙입니다.
          }
        }
      }

      const promptTokens =
        realUsage?.prompt_tokens ??
        estimateTokens(text) + estimateImageTokens(snapshot.filter((item) => item.kind === "image").length + framesCount);
      const completionTokens = realUsage?.completion_tokens ?? estimateTokens(assistantText);
      const usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimated: !realUsage,
      };
      const computed = computeChatCost(usage, model.pricing);
      const costLine = `${formatUsage(usage)} · ${formatCost(computed.cost, computed.currency)}`;

      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: assistantText, costLine };
        return copy;
      });

      recordJob({
        mode: "chat",
        model: model.id,
        prompt: text || "(첨부 파일만 전송됨)",
        attachments: snapshot.map((item) => (item.kind === "doc" || hasVision ? item : { ...item, notSent: true })),
        usage,
        unitPrice: model.pricing,
        cost: computed.cost,
        currency: computed.currency,
        status: "completed",
        result: { kind: "text", text: assistantText },
      });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "채팅 요청에 실패했습니다.";
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: message };
        return copy;
      });
      setError(message);
    } finally {
      setSending(false);
    }
  }

  const imageCount = attachments.filter((item) => item.kind === "image").length;
  const hasVideo = attachments.some((item) => item.kind === "video");
  const hasDoc = attachments.some((item) => item.kind === "doc");

  return (
    <div className="studio">
      <div className="studio-scroll">
        <div className="studio-inner">
          <ModelDetail hook={models} />

          {messages.length === 0 && !sending ? (
            <div style={{ paddingTop: 26 }}>
              <EmptyState
                icon="chat"
                title="대화를 시작해 보세요"
                body="이미지·동영상·문서를 함께 올리면 시각 모델이 내용을 같이 읽습니다."
              />
            </div>
          ) : (
            <div className="chat-thread">
              {messages.map((message, index) => (
                <div key={index} className={`msg ${message.role}`}>
                  <span className="msg-avatar">{message.role === "user" ? "나" : <Icon name="sparkle" size={15} />}</span>
                  <div className="msg-body">
                    <div className="bubble">
                      {message.attachments && message.attachments.length > 0 ? (
                        <div className="bubble-attaches">
                          {message.attachments.map((item) => {
                            if (item.kind === "image") {
                              return (
                                <img key={item.id} src={item.url} alt={item.name} onClick={() => setLightbox(item.url)} />
                              );
                            }
                            if (item.kind === "video") {
                              return <video key={item.id} src={item.url} controls preload="metadata" />;
                            }
                            return (
                              <span key={item.id} className="bubble-attach-chip">
                                <Icon name="doc" size={12} />
                                {item.name}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                      {message.content ||
                        (message.role === "assistant" && sending && index === messages.length - 1 ? (
                          <span className="typing">
                            <span />
                            <span />
                            <span />
                          </span>
                        ) : null)}
                    </div>
                    {message.framesCount ? (
                      <div className="msg-foot">동영상에서 {message.framesCount}개의 프레임을 함께 보냈습니다.</div>
                    ) : null}
                    {message.costLine ? <div className="msg-foot">{message.costLine}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="dock">
        <div className="dock-inner">
          <textarea
            className="dock-textarea"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="무엇이든 물어보세요. Shift+Enter로 줄을 바꿉니다."
            rows={1}
          />
          <AttachStrip files={attachments} onRemove={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))} />
          {error ? <div className="error-box dock-alert">{error}</div> : null}
          <div className="dock-row">
            <ModelChip hook={models} />
            <FileChip
              label={`이미지 ${imageCount}/${policy.image.max}`}
              accept="image/*"
              multiple
              disabled={!policy.image.allowed}
              onPick={pickImages}
              title={policy.image.allowed ? "이미지 첨부" : "이 모델은 이미지를 인식하지 못합니다"}
            />
            <FileChip
              label={`동영상 ${hasVideo ? 1 : 0}/${policy.video.max}`}
              accept="video/*"
              disabled={!policy.video.allowed}
              onPick={pickVideo}
              title={policy.video.allowed ? "동영상 첨부" : "이 모델은 동영상(이미지)을 인식하지 못합니다"}
            />
            <FileChip
              label={`문서 ${hasDoc ? 1 : 0}/${policy.doc.max}`}
              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
              disabled={!policy.doc.allowed}
              onPick={pickDoc}
              title="문서 첨부"
            />
            <span className="dock-spacer" />
            {policy.singleImageNote ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                {policy.singleImageNote}
              </span>
            ) : null}
            <SendButton disabled={sending || (!input.trim() && attachments.length === 0)} onClick={send} label="전송" />
          </div>
        </div>
      </div>

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
