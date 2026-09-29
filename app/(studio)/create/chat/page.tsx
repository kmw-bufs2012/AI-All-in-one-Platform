"use client";

import { INLINE_BUDGET_CHARS } from "@/lib/inline-media";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useStudioState } from "@/components/StudioState";
import {
  clearConversations,
  deleteConversation,
  listConversations,
  newConversationId,
  saveConversation,
  fetchCloudList,
  fetchCloudConversation,
  saveCloudConversation,
  deleteCloudConversation,
  type ArchivedConversation,
  type CloudSummary,
} from "@/lib/chat-archive";
import { useModels } from "@/components/useModels";
import {
  AttachStrip,
  EmptyState,
  FileChip,
  Lightbox,
  ModelChip,
  ModelDetail,
  AttachmentMedia,
  NewSessionButton,
  SendButton,
  type LightboxContent,
} from "@/components/studio-ui";
import {
  MAX_VIDEO_BYTES,
  extractVideoFrames,
  attachmentBlob,
  attachmentDataUrl,
  inlineAttachments,
  needsVideoCompression,
  recordJob,
  uploadFiles,
  type AttachedFile,
} from "@/lib/client-api";
import { resolveChatAttachmentPolicy, MAX_TOTAL_FRAMES } from "@/lib/attachment-policy";
import { computeChatCost, estimateImageTokens, estimateTokens, formatCost, formatUsage } from "@/lib/cost";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: AttachedFile[];
  framesCount?: number;
  costLine?: string;
  /** 추론 모델이 보낸 생각 과정(reasoning) 텍스트. */
  reasoning?: string;
  /** 답변 첫 글자가 나오기까지 생각한 시간(초). */
  thinkingSeconds?: number;
}

/* 스트리밍 중 진행 단계. Claude Code 처럼 지금 무엇을 하는지 보여 줍니다. */
type StreamPhase = "waiting" | "thinking" | "deep" | "writing" | "finishing";

/* 생각이 이 시간(또는 분량)을 넘으면 '깊게 생각 중'으로 표시합니다. */
const DEEP_THINK_MS = 20 * 1000;
const DEEP_THINK_CHARS = 3000;
/* 바닥에서 이 거리 안에 있으면 사용자가 '맨 아래를 보고 있다'고 봅니다. */
const STICK_THRESHOLD_PX = 80;

/* 스트리밍 응답이 끊기지 않고 늘어질 때 무한 로딩을 막는 상한입니다. */
const STREAM_IDLE_TIMEOUT_MS = 90 * 1000;
const STREAM_TOTAL_TIMEOUT_MS = 5 * 60 * 1000;

export default function ChatPage() {
  const models = useModels("text");
  const policy = resolveChatAttachmentPolicy(models.selected);
  const [messages, setMessages] = useStudioState<ChatMessage[]>("chat:messages", []);
  const [input, setInput] = useStudioState<string>("chat:input", "");
  const [attachments, setAttachments] = useStudioState<AttachedFile[]>("chat:attachments", []);
  const [conversationId, setConversationId] = useStudioState<string>("chat:conversationId", "");
  const [localArchive, setArchive] = useState<ArchivedConversation<ChatMessage>[]>([]);
  // Cloudflare R2 에 저장된 대화 목록(서버에 R2 가 설정된 경우에만 사용).
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudItems, setCloudItems] = useState<CloudSummary[]>([]);
  const archive: Array<{ id: string; title: string; updatedAt: number; inCloud: boolean }> = (() => {
    const map = new Map<string, { id: string; title: string; updatedAt: number; inCloud: boolean }>();
    for (const item of cloudItems) map.set(item.id, { id: item.id, title: item.title, updatedAt: item.updatedAt, inCloud: true });
    for (const item of localArchive) {
      const existing = map.get(item.id);
      if (!existing || existing.updatedAt < item.updatedAt) {
        map.set(item.id, { id: item.id, title: item.title, updatedAt: item.updatedAt, inCloud: Boolean(existing) });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  })();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [compressingVideo, setCompressingVideo] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<LightboxContent>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 사용자가 위로 스크롤하면 false 가 되어 자동 스크롤을 멈춥니다.
  const stickToBottom = useRef(true);
  const [phase, setPhase] = useState<StreamPhase>("waiting");
  const [phaseStartedAt, setPhaseStartedAt] = useState(0);
  const [, setTick] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, phase]);

  // 진행 표시의 경과 초를 1초마다 갱신합니다.
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [sending]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }

  async function copyText(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 권한이 막힌 환경(비보안 컨텍스트 등)에서는 임시 textarea 로 복사합니다.
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1500);
  }

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

  // 요청당 첨부 총 용량(공식 한도 또는 앱 상한). 동영상은 압축 후 크기로 판정합니다.
  function fitsTotal(uploaded: AttachedFile[]): boolean {
    const current = attachments.reduce((sum, item) => sum + (item.size || 0), 0);
    const added = uploaded.reduce((sum, item) => sum + (item.size || 0), 0);
    if (current + added > policy.totalBytes) {
      setError(`이 모델은 요청당 첨부 총 용량이 ${Math.round(policy.totalBytes / 1024 / 1024)}MB로 제한됩니다.`);
      return false;
    }
    return true;
  }

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
    // 프레임 방식 동영상은 이미지 한도를 함께 씁니다(동영상 1개당 최소 2프레임).
    const frameReserve = policy.videoNative ? 0 : attachments.filter((item) => item.kind === "video").length * 2;
    if (images.length + files.length + frameReserve > policy.image.max) {
      setError(`이 모델은 이미지를 최대 ${policy.image.max}개까지 첨부할 수 있습니다.`);
      return;
    }
    try {
      const uploaded = await uploadFiles(files);
      if (!fitsTotal(uploaded)) return;
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "이미지 업로드에 실패했습니다.");
    }
  }

  async function pickVideos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError("");
    if (!policy.video.allowed) {
      setError("선택한 모델은 동영상을 인식하지 못합니다.");
      return;
    }
    const videos = attachments.filter((item) => item.kind === "video");
    if (videos.length + files.length > policy.video.max) {
      setError(`이 모델은 동영상을 최대 ${policy.video.max}개까지 첨부할 수 있습니다.`);
      return;
    }
    for (const file of files) {
      if (file.size > MAX_VIDEO_BYTES) {
        setError("동영상은 50MB 이하만 첨부할 수 있습니다.");
        return;
      }
    }
    try {
      setCompressingVideo(files.some(needsVideoCompression));
      const uploaded = await uploadFiles(files);
      if (!fitsTotal(uploaded)) return;
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "동영상 업로드에 실패했습니다.");
    } finally {
      setCompressingVideo(false);
    }
  }

  useEffect(() => {
    setArchive(listConversations<ChatMessage>());
    fetchCloudList().then(({ enabled, items }) => {
      setCloudEnabled(enabled);
      setCloudItems(items);
    });
  }, []);

  // 대화가 바뀔 때마다 7일 보관함에 반영합니다. 스트리밍 중에는 끝난 뒤 한 번만 저장합니다.
  useEffect(() => {
    if (sending || messages.length === 0) return;
    let id = conversationId;
    if (!id) {
      id = newConversationId();
      setConversationId(id);
    }
    const existing = listConversations<ChatMessage>().find((item) => item.id === id);
    if (existing && JSON.stringify(existing.messages) === JSON.stringify(messages)) return;
    const firstUser = messages.find((message) => message.role === "user");
    const title = (firstUser?.content || "첨부만 보낸 대화").replace(/\s+/g, " ").trim().slice(0, 60);
    const conversation = { id, title, updatedAt: Date.now(), messages };
    saveConversation<ChatMessage>(conversation);
    setArchive(listConversations<ChatMessage>());
    if (cloudEnabled) {
      const savedId = id;
      saveCloudConversation(conversation).then((ok) => {
        if (!ok) return;
        setCloudItems((prev) => [
          { id: savedId, title, updatedAt: conversation.updatedAt, messageCount: messages.length },
          ...prev.filter((item) => item.id !== savedId),
        ]);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sending]);

  async function openConversation(item: { id: string }) {
    let conversation: ArchivedConversation<ChatMessage> | null =
      listConversations<ChatMessage>().find((entry) => entry.id === item.id) ?? null;
    const cloud = cloudItems.find((entry) => entry.id === item.id);
    // 이 브라우저에 없거나 Cloudflare 쪽이 더 최신이면 R2 에서 불러옵니다.
    if (cloud && (!conversation || conversation.updatedAt < cloud.updatedAt)) {
      conversation = (await fetchCloudConversation<ChatMessage>(item.id)) ?? conversation;
    }
    if (!conversation) {
      setError("대화를 불러오지 못했습니다.");
      return;
    }
    setMessages(conversation.messages);
    setConversationId(conversation.id);
    setAttachments([]);
    setError("");
    setArchiveOpen(false);
  }

  function removeConversation(id: string) {
    deleteConversation(id);
    setArchive(listConversations<ChatMessage>());
    if (cloudEnabled) {
      deleteCloudConversation(id);
      setCloudItems((prev) => prev.filter((item) => item.id !== id));
    }
    if (id === conversationId) startNewSession();
  }

  function removeAllConversations() {
    const where = cloudEnabled ? "이 브라우저와 Cloudflare에 보관된" : "이 브라우저에 보관된";
    if (!window.confirm(`${where} 대화를 모두 지울까요? 되돌릴 수 없습니다.`)) return;
    clearConversations();
    setArchive([]);
    if (cloudEnabled) {
      deleteCloudConversation("all");
      setCloudItems([]);
    }
    startNewSession();
  }

  function startNewSession() {
    setConversationId("");
    setMessages([]);
    setInput("");
    setAttachments([]);
    setError("");
    setLightbox(null);
  }

  async function pickAudios(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError("");
    if (!policy.audio.allowed) {
      setError("선택한 모델은 오디오를 인식하지 못합니다.");
      return;
    }
    const audios = attachments.filter((item) => item.kind === "audio");
    if (audios.length + files.length > policy.audio.max) {
      setError(`이 모델은 오디오를 최대 ${policy.audio.max}개까지 첨부할 수 있습니다.`);
      return;
    }
    for (const file of files) {
      if (file.size > MAX_VIDEO_BYTES) {
        setError("오디오는 50MB 이하만 첨부할 수 있습니다.");
        return;
      }
    }
    try {
      const uploaded = await uploadFiles(files);
      if (!fitsTotal(uploaded)) return;
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "오디오 업로드에 실패했습니다.");
    }
  }

  async function pickDoc(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError("");
    if (!policy.doc.allowed) {
      setError("선택한 모델은 문서 첨부를 지원하지 않습니다.");
      return;
    }
    const docs = attachments.filter((item) => item.kind === "doc");
    if (docs.length + files.length > policy.doc.max) {
      setError(`문서는 최대 ${policy.doc.max}개까지 첨부할 수 있습니다.`);
      return;
    }
    // PDF는 capabilities.pdf_upload 를 공개한 모델에서만 그대로 전달됩니다.
    if (!policy.pdfAllowed && files.some((file) => /\.pdf$/i.test(file.name) || file.type === "application/pdf")) {
      setError("이 모델은 PDF를 지원하지 않습니다. 텍스트 문서(txt·md)를 첨부해 주세요.");
      return;
    }
    try {
      const uploaded = await uploadFiles(files);
      if (!fitsTotal(uploaded)) return;
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
    const hasVision = policy.image.allowed;
    const videoNative = policy.videoNative;
    let frames: string[] = [];
    let framesCount = 0;
    let frameGroups: { name: string; count: number }[] = [];
    // 첨부한 모든 동영상에서 프레임을 뽑습니다. 프레임은 이미지 한도에서 이미
    // 첨부한 이미지를 뺀 만큼, 최대 MAX_TOTAL_FRAMES 장까지.
    const buildFrames = async () => {
      const videoAtts = snapshot.filter((item) => item.kind === "video");
      const imageCount = snapshot.filter((item) => item.kind === "image").length;
      const frameBudget = Math.min(MAX_TOTAL_FRAMES, policy.image.max - imageCount);
      const perVideo = Math.max(1, Math.floor(frameBudget / Math.max(1, videoAtts.length)));
      const collected: string[] = [];
      const groups: { name: string; count: number }[] = [];
      for (const videoAtt of videoAtts) {
        try {
          const blob = await attachmentBlob(videoAtt);
          const videoFile = new File([blob], videoAtt.name, { type: videoAtt.mime || blob.type });
          const extracted = await extractVideoFrames(videoFile, Math.min(policy.frameCount, perVideo));
          collected.push(...extracted);
          groups.push({ name: videoAtt.name, count: extracted.length });
        } catch (frameError) {
          throw new Error(
            `동영상 «${videoAtt.name}»에서 프레임을 뽑지 못했습니다: ${
              frameError instanceof Error ? frameError.message : "알 수 없는 오류"
            }`,
          );
        }
      }
      return { collected, groups };
    };
    // 동영상을 직접 지원하는 모델(capabilities.video_input)은 video_url 파트로
    // 그대로 전송합니다. 비전 전용 모델은 프레임을 이미지로 보냅니다.
    if (!videoNative && hasVision) {
      try {
        const built = await buildFrames();
        frames = built.collected;
        frameGroups = built.groups;
        framesCount = frames.length;
      } catch (frameError) {
        setError(frameError instanceof Error ? frameError.message : "동영상 프레임을 뽑지 못했습니다.");
        setSending(false);
        return;
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
    let reasoningText = "";
    let thinkingSeconds: number | undefined;
    let currentPhase: StreamPhase = "waiting";
    const changePhase = (next: StreamPhase) => {
      if (currentPhase === next) return;
      const stillThinking = next === "thinking" || next === "deep";
      currentPhase = next;
      setPhase(next);
      // 생각 단계끼리는 경과 시간을 이어서 셉니다('12초 생각 중' → '25초 깊게 생각 중').
      if (!stillThinking) setPhaseStartedAt(Date.now());
    };
    stickToBottom.current = true;
    setPhase("waiting");
    setPhaseStartedAt(Date.now());
    let realUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
    // NanoGPT는 stream_options.include_usage 요청 시 마지막 청크의 usage 안에
    // 실제 청구액을 함께 실어 보내는 경우가 있습니다(공식 문서: "Every API
    // response includes a cost field"). 있으면 카탈로그 추정 대신 그 값을 씁니다.
    let realCost: number | null = null;
    let realCostCurrency: string | null = null;
    const streamStartedAt = Date.now();

    try {
      /*
       * 브라우저에 사본이 있는 이미지는 data URL 로 직접 보냅니다(서버 임시
       * 저장소에서 파일을 못 찾는 문제 방지). /api/chat 본문 4.5MB 한도 안에서
       * 프레임과 합쳐 약 3.5MB까지만 인라인하고, 나머지는 ID로 보냅니다.
       */
      const inlineImages: string[] = [];
      const idImages: string[] = [];
      let inlineBytes = frames.reduce((sum, frame) => sum + frame.length, 0);
      for (const item of snapshot.filter((entry) => entry.kind === "image")) {
        // 메모리 사본이 없으면(새로고침 후) 브라우저 7일 보관 사본(IndexedDB)을 씁니다.
        const dataUrl = await attachmentDataUrl(item, INLINE_BUDGET_CHARS - inlineBytes);
        if (dataUrl) {
          inlineImages.push(dataUrl);
          inlineBytes += dataUrl.length;
        } else {
          idImages.push(item.id);
        }
      }
      // 동영상·음성은 ID로 보내되, 서버 임시 저장소에서 사라진 경우를 대비해 남은 예산 안에서 사본도 싣습니다.
      const inlineMedia = await inlineAttachments(
        snapshot.filter((entry) => entry.kind === "video" || entry.kind === "audio"),
        Math.max(0, INLINE_BUDGET_CHARS - inlineBytes),
      );
      const postChat = (sendNativeVideo: boolean) =>
        fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model.id,
            messages: [...history, { role: "user", content: text }],
            attachments: {
              images: idImages,
              docs: snapshot.filter((item) => item.kind === "doc").map((item) => item.id),
              videos: sendNativeVideo
                ? snapshot.filter((item) => item.kind === "video").map((item) => item.id)
                : undefined,
              audios: policy.audio.allowed
                ? snapshot.filter((item) => item.kind === "audio").map((item) => item.id)
                : undefined,
            },
            frames,
            frameGroups,
            inlineImages,
            inlineMedia: sendNativeVideo ? inlineMedia : Object.fromEntries(
              Object.entries(inlineMedia).filter(([id]) => snapshot.find((item) => item.id === id)?.kind === "audio"),
            ),
            pdfAllowed: policy.pdfAllowed,
          }),
        });
      let response = await postChat(videoNative);
      // 동영상 직접 입력 모델이라도 제공자가 형식(WebM 등)을 거부하면, 비전이
      // 가능한 모델은 프레임 방식으로 한 번 더 보냅니다.
      const hasVideo = snapshot.some((item) => item.kind === "video");
      if (!response.ok && videoNative && hasVision && hasVideo) {
        const built = await buildFrames();
        frames = built.collected;
        frameGroups = built.groups;
        framesCount = frames.length;
        response = await postChat(false);
        setMessages((prev) =>
          prev.map((message, index) => (index === prev.length - 2 ? { ...message, framesCount } : message)),
        );
      }
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "채팅 요청에 실패했습니다.");
      }
      const controller = new AbortController();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      // SSE가 [DONE]을 보내고도 연결을 닫지 않거나, 프록시가 응답을 계속 붙잡고
      // 있으면 스트림이 끝나지 않아 '답변 생성 중…' 표시가 무한히 이어질 수 있습니다.
      // [DONE]을 받으면 즉시 종료하고, 일정 시간 데이터가 없거나 총 시간이
      // 초과하면 요청을 끊어 무한 로딩을 방지합니다.
      const lastChunkAt = { time: Date.now() };
      const watchdog = setInterval(() => {
        const now = Date.now();
        if (now - lastChunkAt.time > STREAM_IDLE_TIMEOUT_MS) {
          controller.abort();
        } else if (now - streamStartedAt > STREAM_TOTAL_TIMEOUT_MS) {
          controller.abort();
        }
      }, 5000);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          lastChunkAt.time = Date.now();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              finished = true;
              break;
            }
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{
                  delta?: { content?: string; reasoning?: string; reasoning_content?: string };
                  finish_reason?: string | null;
                }>;
                usage?: {
                  prompt_tokens?: number;
                  completion_tokens?: number;
                  total_tokens?: number;
                  cost?: number;
                  total_cost?: number;
                  cost_usd?: number;
                };
                cost?: number;
              };
              const choice = parsed.choices?.[0];
              const reasoningDelta = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
              if (typeof reasoningDelta === "string" && reasoningDelta) {
                reasoningText += reasoningDelta;
                const deep =
                  Date.now() - streamStartedAt > DEEP_THINK_MS || reasoningText.length > DEEP_THINK_CHARS;
                changePhase(deep ? "deep" : "thinking");
              }
              const delta = choice?.delta?.content;
              if (typeof delta === "string" && delta) {
                if (!assistantText) thinkingSeconds = Math.round((Date.now() - streamStartedAt) / 1000);
                assistantText += delta;
                changePhase("writing");
              }
              if (choice?.finish_reason) changePhase("finishing");
              if (parsed.usage) realUsage = parsed.usage;
              const costCandidate = parsed.usage?.cost ?? parsed.usage?.total_cost ?? parsed.usage?.cost_usd ?? parsed.cost;
              if (typeof costCandidate === "number" && Number.isFinite(costCandidate)) {
                realCost = costCandidate;
                realCostCurrency = "USD";
              }
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant")
                  copy[copy.length - 1] = { ...last, content: assistantText, reasoning: reasoningText || undefined };
                return copy;
              });
            } catch {
              // 잘린 JSON 조각은 버퍼에 남겨 다음 청크에서 이어 붙입니다.
            }
          }
          if (finished) break;
        }
      } finally {
        clearInterval(watchdog);
        if (finished) {
          try {
            await reader.cancel();
          } catch {
            // 이미 닫힌 스트림은 무시합니다.
          }
        }
      }

      changePhase("finishing");
      if (!assistantText) {
        throw new Error("모델이 응답을 보내지 않았습니다. 잠시 후 다시 시도해 주세요.");
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
      const estimated = computeChatCost(usage, model.pricing);
      const computed = realCost !== null ? { cost: realCost, currency: realCostCurrency } : estimated;
      const costLabel = computed.cost === null ? "" : realCost !== null ? "청구된 비용 " : "추정 비용 ";
      const costLine = `${formatUsage(usage)} · ${costLabel}${formatCost(computed.cost, computed.currency)}`;

      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") copy[copy.length - 1] = {
            ...last,
            content: assistantText,
            reasoning: reasoningText || undefined,
            thinkingSeconds: reasoningText ? thinkingSeconds : undefined,
            costLine,
          };
        return copy;
      });

      recordJob({
        mode: "chat",
        model: model.id,
        prompt: text || "(첨부 파일만 전송됨)",
        attachments: snapshot.map((item) => {
          const sent =
            item.kind === "doc" ||
            (item.kind === "image" && hasVision) ||
            (item.kind === "audio" && policy.audio.allowed) ||
            (item.kind === "video" && (videoNative || hasVision));
          return sent ? item : { ...item, notSent: true };
        }),
        usage,
        unitPrice: model.pricing,
        cost: computed.cost,
        currency: computed.currency,
        costSource: realCost !== null ? "actual" : computed.cost !== null ? "estimated" : null,
        status: "completed",
        result: { kind: "text", text: assistantText },
      });
    } catch (sendError) {
      const aborted =
        sendError instanceof Error &&
        (sendError.name === "AbortError" || sendError.name === "TimeoutError");
      const message = aborted
        ? "답변 생성이 지연되거나 중단되었습니다. 잠시 후 다시 시도해 주세요."
        : sendError instanceof Error
          ? sendError.message
          : "채팅 요청에 실패했습니다.";
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
  const videoCount = attachments.filter((item) => item.kind === "video").length;
  const audioCount = attachments.filter((item) => item.kind === "audio").length;
  const docCount = attachments.filter((item) => item.kind === "doc").length;

  return (
    <div className="studio">
      <div className="studio-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="studio-inner">
          <div className="studio-toolbar">
            <NewSessionButton disabled={sending || compressingVideo} onClick={startNewSession} />
            <button
              type="button"
              className="secondary new-session-button"
              disabled={sending}
              onClick={() => setArchiveOpen((open) => !open)}
              aria-expanded={archiveOpen}
            >
              <Icon name="history" size={15} /> 보관된 대화 ({archive.length})
            </button>
          </div>
          {archiveOpen ? (
            <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <strong>{cloudEnabled ? "보관된 대화 (Cloudflare)" : "최근 7일 대화"}</strong>
                {archive.length > 0 ? (
                  <button type="button" className="secondary new-session-button" onClick={removeAllConversations}>
                    모두 지우기
                  </button>
                ) : null}
              </div>
              <p style={{ fontSize: 12, opacity: 0.7, margin: "6px 0 10px" }}>
                {cloudEnabled
                  ? "Cloudflare R2에 저장되어 다른 기기에서도 열 수 있으며, 직접 지우기 전까지 보관됩니다. 첨부·생성 파일도 R2에 함께 저장됩니다."
                  : "이 브라우저에만 저장되며 마지막 대화 후 7일이 지나면 자동 삭제됩니다. 첨부 파일 미리보기는 서버 보관 기간이 지나면 열리지 않을 수 있습니다."}
              </p>
              {archive.length === 0 ? (
                <div style={{ fontSize: 13, opacity: 0.7 }}>보관된 대화가 없습니다.</div>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                  {archive.map((item) => (
                    <li key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        className="secondary new-session-button"
                        style={{ flex: 1, minWidth: 0, justifyContent: "flex-start", textAlign: "left" }}
                        onClick={() => openConversation(item)}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {item.id === conversationId ? "● " : ""}
                          {item.title}
                        </span>
                        <span style={{ fontSize: 12, opacity: 0.6 }}>
                          {new Date(item.updatedAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </button>
                      <button type="button" className="secondary new-session-button" aria-label="이 대화 삭제" onClick={() => removeConversation(item.id)}>
                        삭제
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
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
                                <AttachmentMedia
                                  key={item.id}
                                  kind="image"
                                  url={item.url}
                                  alt={item.name}
                                  onClick={() => setLightbox({ url: item.url, kind: "image", name: item.name, size: item.size, mime: item.mime })}
                                />
                              );
                            }
                            if (item.kind === "video") {
                              return (
                                <span key={item.id} className="bubble-video-wrap">
                                  <AttachmentMedia kind="video" url={item.url} controls />
                                  <button
                                    type="button"
                                    className="bubble-video-expand"
                                    aria-label={`${item.name} 크게 보기`}
                                    title="크게 보기"
                                    onClick={() =>
                                      setLightbox({ url: item.url, kind: "video", name: item.name, size: item.size, mime: item.mime })
                                    }
                                  >
                                    <Icon name="expand" size={12} />
                                  </button>
                                </span>
                              );
                            }
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className="bubble-attach-chip"
                                onClick={() => setLightbox({ url: item.url, kind: item.kind, name: item.name, size: item.size, mime: item.mime })}
                              >
                                <Icon name={item.kind === "audio" ? "audio" : "doc"} size={12} />
                                {item.name}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {message.role === "assistant" && message.reasoning ? (
                        <details className="thinking-details">
                          <summary>
                            {message.thinkingSeconds !== undefined
                              ? `${message.thinkingSeconds}초 동안 생각함`
                              : "생각 과정"}
                          </summary>
                          <div className="thinking-body">{message.reasoning}</div>
                        </details>
                      ) : null}
                      {message.content}
                      {message.role === "assistant" && sending && index === messages.length - 1 ? (
                        <StreamStatus phase={phase} since={phaseStartedAt} />
                      ) : null}
                    </div>
                    {message.content && !(sending && index === messages.length - 1) ? (
                      <div className="msg-actions">
                        <button
                          type="button"
                          className="msg-copy"
                          onClick={() => copyText(message.content, index)}
                          title={message.role === "assistant" ? "답변 전체 복사" : "프롬프트 전체 복사"}
                        >
                          {copiedIndex === index ? "복사됨" : message.role === "assistant" ? "답변 복사" : "프롬프트 복사"}
                        </button>
                      </div>
                    ) : null}
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
          {compressingVideo ? (
            <div className="progress-note dock-alert">
              <span className="spinner" /> 큰 동영상을 4.5MB 미만으로 압축하고 있습니다…
            </div>
          ) : null}
          {error ? <div className="error-box dock-alert">{error}</div> : null}
          <div className="dock-row">
            <ModelChip hook={models} />
            <FileChip
              label={`이미지 ${imageCount}/${policy.image.max}`}
              accept="image/*"
              multiple
              disabled={!policy.image.allowed || compressingVideo}
              onPick={pickImages}
              title={policy.image.allowed ? "이미지 첨부" : "이 모델은 이미지를 인식하지 못합니다"}
            />
            <FileChip
              label={`동영상 ${videoCount}/${policy.video.max}`}
              accept="video/*"
              multiple={policy.video.max > 1}
              disabled={!policy.video.allowed || compressingVideo}
              onPick={pickVideos}
              title={policy.video.allowed ? "동영상 첨부" : "이 모델은 동영상을 인식하지 못합니다"}
            />
            <FileChip
              label={`오디오 ${audioCount}/${policy.audio.max}`}
              accept="audio/*"
              multiple={policy.audio.max > 1}
              disabled={!policy.audio.allowed || compressingVideo}
              onPick={pickAudios}
              title={policy.audio.allowed ? "오디오 첨부" : "이 모델은 오디오를 인식하지 못합니다"}
            />
            <FileChip
              label={`문서 ${docCount}/${policy.doc.max}`}
              accept={policy.docAccept}
              multiple
              disabled={!policy.doc.allowed || compressingVideo}
              onPick={pickDoc}
              title={policy.pdfAllowed ? "문서 첨부 (txt·md·pdf)" : "문서 첨부 (txt·md)"}
            />
            <span className="dock-spacer" />
            {policy.note ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                {policy.note}
              </span>
            ) : null}
            <SendButton disabled={sending || compressingVideo || (!input.trim() && attachments.length === 0)} onClick={send} label="전송" />
          </div>
        </div>
      </div>

      <Lightbox content={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

const PHASE_LABEL: Record<StreamPhase, string> = {
  waiting: "생각 중",
  thinking: "생각 중",
  deep: "깊게 생각 중",
  writing: "답변 작성 중",
  finishing: "마무리 중",
};

/** 스트리밍 진행 단계와 경과 시간을 보여 줍니다(부모가 1초마다 다시 그립니다). */
function StreamStatus({ phase, since }: { phase: StreamPhase; since: number }) {
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const showSeconds = phase !== "finishing";
  return (
    <span className="stream-status" role="status" aria-live="polite">
      <span className="stream-status-dot" />
      {showSeconds ? `${seconds}초 ${PHASE_LABEL[phase]}…` : `${PHASE_LABEL[phase]}…`}
    </span>
  );
}
