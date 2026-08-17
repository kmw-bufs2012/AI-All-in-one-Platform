"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { NormalizedModel } from "@/lib/models";
import { modelDisplayLabel } from "@/lib/models";
import { estimateTokens, estimateImageTokens, computeChatCost, formatCost, formatUsage } from "@/lib/cost";

type Mode = "chat" | "image" | "video" | "audio";
type Theme = "system" | "light" | "dark";

const MODEL_TYPE: Record<Mode, string> = { chat: "text", image: "image", video: "video", audio: "tts" };
const MAX_IMAGES = 10;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000;

interface AttachedFile {
  id: string;
  kind: "image" | "video" | "doc";
  name: string;
  size: number;
  mime: string;
  url: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: AttachedFile[];
  framesCount?: number;
  costLine?: string;
}

interface ModelState {
  models: NormalizedModel[] | null;
  loading: boolean;
  error: string;
}

interface TranslationState {
  text: string | null;
  loading: boolean;
  error: string;
}

function emptyModelState(): ModelState {
  return { models: null, loading: false, error: "" };
}

export default function StudioPage() {
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("chat");
  const [theme, setTheme] = useState<Theme>("system");

  const [models, setModels] = useState<Record<Mode, ModelState>>({
    chat: emptyModelState(),
    image: emptyModelState(),
    video: emptyModelState(),
    audio: emptyModelState(),
  });
  const [selected, setSelected] = useState<Record<Mode, string>>({ chat: "", image: "", video: "", audio: "" });
  const [translation, setTranslation] = useState<Record<Mode, TranslationState>>({
    chat: { text: null, loading: false, error: "" },
    image: { text: null, loading: false, error: "" },
    video: { text: null, loading: false, error: "" },
    audio: { text: null, loading: false, error: "" },
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatAttachments, setChatAttachments] = useState<AttachedFile[]>([]);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState("");

  const [imagePrompt, setImagePrompt] = useState("");
  const [imageRefs, setImageRefs] = useState<AttachedFile[]>([]);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageResults, setImageResults] = useState<string[]>([]);
  const [imageError, setImageError] = useState("");
  const [imageCostLine, setImageCostLine] = useState("");

  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoStartImage, setVideoStartImage] = useState<AttachedFile | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoStatus, setVideoStatus] = useState("");
  const [videoResultUrl, setVideoResultUrl] = useState<string | null>(null);
  const [videoCostEstimate, setVideoCostEstimate] = useState<{ amount: number; currency: string | null } | null>(null);
  const [videoError, setVideoError] = useState("");

  const [audioInput, setAudioInput] = useState("");
  const [audioVoice, setAudioVoice] = useState("");
  const [audioGenerating, setAudioGenerating] = useState(false);
  const [audioResultUrl, setAudioResultUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState("");

  const [lightbox, setLightbox] = useState<string | null>(null);

  const videoPollRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; startedAt: number }>({ timer: null, startedAt: 0 });

  const selectedModel = models[mode].models?.find((model) => model.id === selected[mode]) ?? null;

  function applyTheme(value: Theme) {
    const root = document.documentElement;
    if (value === "light" || value === "dark") {
      root.setAttribute("data-theme", value);
      root.style.colorScheme = value;
    } else {
      root.removeAttribute("data-theme");
      root.style.colorScheme = "";
    }
    try {
      localStorage.setItem("theme", value);
    } catch {
      // 저장이 불가능한 환경에서는 무시합니다.
    }
  }

  useEffect(() => {
    let saved: Theme = "system";
    try {
      const value = localStorage.getItem("theme");
      if (value === "light" || value === "dark") saved = value;
    } catch {
      // 저장된 테마가 없으면 시스템 기본값을 사용합니다.
    }
    setTheme(saved);
    applyTheme(saved);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const body = await response.json().catch(() => ({}));
        setMe(body.username ?? null);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  const loadModels = useCallback(async (targetMode: Mode) => {
    if (models[targetMode].models !== null || models[targetMode].loading) return;
    setModels((prev) => ({ ...prev, [targetMode]: { ...prev[targetMode], loading: true, error: "" } }));
    try {
      const response = await fetch(`/api/models?type=${MODEL_TYPE[targetMode]}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "모델 목록을 불러오지 못했습니다.");
      }
      const list: NormalizedModel[] = Array.isArray(body.models) ? body.models : [];
      setModels((prev) => ({ ...prev, [targetMode]: { models: list, loading: false, error: "" } }));
      if (list.length > 0) {
        setSelected((prev) => (list.some((model) => model.id === prev[targetMode]) ? prev : {
          ...prev,
          [targetMode]: list[0].id,
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "모델 목록을 불러오지 못했습니다.";
      setModels((prev) => ({ ...prev, [targetMode]: { ...prev[targetMode], loading: false, error: message } }));
    }
  }, [models]);

  useEffect(() => {
    loadModels(mode);
  }, [mode, loadModels]);

  useEffect(() => {
    const model = models[mode].models?.find((item) => item.id === selected[mode]);
    if (!model || !model.description) {
      setTranslation((prev) => ({ ...prev, [mode]: { text: null, loading: false, error: "" } }));
      return;
    }
    let cancelled = false;
    setTranslation((prev) => ({ ...prev, [mode]: { text: null, loading: true, error: "" } }));
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [model.description] }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (body.available && Array.isArray(body.translations)) {
          setTranslation((prev) => ({ ...prev, [mode]: { text: body.translations[0] ?? "", loading: false, error: "" } }));
        } else {
          setTranslation((prev) => ({ ...prev, [mode]: { text: null, loading: false, error: body.message ?? "번역을 제공할 수 없습니다." } }));
        }
      })
      .catch(() => {
        if (!cancelled) setTranslation((prev) => ({ ...prev, [mode]: { text: null, loading: false, error: "번역 요청 중 오류가 발생했습니다." } }));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, mode, models]);

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
          setMode("chat");
          setChatInput(found.content);
          window.history.replaceState({}, "", "/");
        }
      })
      .catch(() => {});
  }, []);

  async function downscaleImage(file: File): Promise<File> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    bitmap.close();
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  }

  async function uploadFiles(files: File[]): Promise<AttachedFile[]> {
    const prepared: File[] = [];
    for (const file of files) {
      prepared.push(file.type.startsWith("image/") ? await downscaleImage(file) : file);
    }
    const formData = new FormData();
    prepared.forEach((file) => formData.append("files", file));
    const response = await fetch("/api/attachments", { method: "POST", body: formData });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "파일 업로드에 실패했습니다.");
    }
    return Array.isArray(body.files) ? body.files : [];
  }

  async function handleChatImagePick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setChatError("");
    const images = chatAttachments.filter((item) => item.kind === "image");
    if (images.length + files.length > MAX_IMAGES) {
      setChatError(`이미지는 최대 ${MAX_IMAGES}개까지 첨부할 수 있습니다.`);
      return;
    }
    try {
      const uploaded = await uploadFiles(files);
      setChatAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "이미지 업로드에 실패했습니다.");
    }
  }

  async function handleChatVideoPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setChatError("");
    if (chatAttachments.some((item) => item.kind === "video")) {
      setChatError("동영상은 최대 1개까지 첨부할 수 있습니다.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setChatError("동영상은 50MB 이하만 첨부할 수 있습니다.");
      return;
    }
    try {
      const uploaded = await uploadFiles([file]);
      setChatAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "동영상 업로드에 실패했습니다.");
    }
  }

  async function handleChatDocPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setChatError("");
    if (chatAttachments.some((item) => item.kind === "doc")) {
      setChatError("문서는 최대 1개까지 첨부할 수 있습니다.");
      return;
    }
    try {
      const uploaded = await uploadFiles([file]);
      setChatAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "문서 업로드에 실패했습니다.");
    }
  }

  async function extractVideoFrames(file: File, count = 6): Promise<string[]> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const video = document.createElement("video");
      video.src = objectUrl;
      video.muted = true;
      video.playsInline = true;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("동영상을 읽을 수 없습니다."));
      });
      const duration = video.duration || 1;
      const frames: string[] = [];
      for (let i = 0; i < count; i++) {
        video.currentTime = (duration * (i + 0.5)) / count;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });
        const scale = Math.min(1, 1024 / Math.max(video.videoWidth || 1, video.videoHeight || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((video.videoWidth || 1) * scale));
        canvas.height = Math.max(1, Math.round((video.videoHeight || 1) * scale));
        const context = canvas.getContext("2d");
        if (context) context.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", 0.7));
      }
      return frames;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function recordJob(payload: Record<string, unknown>) {
    fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (chatSending || (!text && chatAttachments.length === 0)) return;
    const model = selectedModel;
    if (!model) {
      setChatError("모델을 선택해 주세요.");
      return;
    }
    setChatError("");
    setChatSending(true);

    const attachmentSnapshot = [...chatAttachments];
    const hasVision = model.lmm;
    let frames: string[] = [];
    let framesCount = 0;
    const videoAtt = attachmentSnapshot.find((item) => item.kind === "video");
    if (videoAtt && hasVision) {
      try {
        const blob = await fetch(videoAtt.url).then((response) => response.blob());
        const videoFile = new File([blob], videoAtt.name, { type: videoAtt.mime });
        frames = await extractVideoFrames(videoFile);
        framesCount = frames.length;
      } catch {
        frames = [];
        framesCount = 0;
      }
    }

    const userMessage: ChatMessage = { role: "user", content: text, attachments: attachmentSnapshot, framesCount };
    const history = chatMessages.map((message) => ({ role: message.role, content: message.content }));
    setChatMessages([...chatMessages, userMessage, { role: "assistant", content: "" } as ChatMessage]);
    setChatInput("");
    setChatAttachments([]);

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
            images: attachmentSnapshot.filter((item) => item.kind === "image").map((item) => item.id),
            docs: attachmentSnapshot.filter((item) => item.kind === "doc").map((item) => item.id),
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
            setChatMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: assistantText };
              return copy;
            });
          } catch {
            // 부분적으로 도착한 JSON은 버퍼에 남기고 다음 청크에서 이어서 처리합니다.
          }
        }
      }

      const promptTokens = realUsage?.prompt_tokens ?? estimateTokens(text) + estimateImageTokens(
        attachmentSnapshot.filter((item) => item.kind === "image").length + framesCount,
      );
      const completionTokens = realUsage?.completion_tokens ?? estimateTokens(assistantText);
      const usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimated: !realUsage,
      };
      const computed = computeChatCost(usage, model.pricing);
      const costLine = `${formatUsage(usage)} · ${formatCost(computed.cost, computed.currency)}`;

      const attachmentsNote = attachmentSnapshot.map((item) =>
        item.kind === "doc" || hasVision ? item : { ...item, notSent: true },
      );

      setChatMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: assistantText, costLine };
        return copy;
      });

      recordJob({
        mode: "chat",
        model: model.id,
        prompt: text || "(첨부 파일만 전송됨)",
        attachments: attachmentsNote,
        usage,
        unitPrice: model.pricing,
        cost: computed.cost,
        currency: computed.currency,
        status: "completed",
        result: { kind: "text", text: assistantText },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "채팅 요청에 실패했습니다.";
      setChatMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: message };
        return copy;
      });
      setChatError(message);
    } finally {
      setChatSending(false);
    }
  }

  async function generateImage() {
    const prompt = imagePrompt.trim();
    if (imageGenerating || !prompt) return;
    const model = selectedModel;
    if (!model) {
      setImageError("모델을 선택해 주세요.");
      return;
    }
    setImageError("");
    setImageGenerating(true);
    try {
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          prompt,
          styleImageIds: imageRefs.map((item) => item.id),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "이미지 생성에 실패했습니다.");
      }
      const urls: string[] = Array.isArray(body.urls) ? body.urls : [];
      setImageResults((prev) => [...urls, ...prev]);
      setImageCostLine(formatCost(null, null));
      recordJob({
        mode: "image",
        model: model.id,
        prompt,
        attachments: imageRefs,
        usage: null,
        unitPrice: model.pricing,
        cost: null,
        currency: null,
        status: "completed",
        result: { kind: "images", urls },
      });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "이미지 생성에 실패했습니다.");
    } finally {
      setImageGenerating(false);
    }
  }

  async function generateVideo() {
    const prompt = videoPrompt.trim();
    if (videoBusy || !prompt) return;
    const model = selectedModel;
    if (!model) {
      setVideoError("모델을 선택해 주세요.");
      return;
    }
    setVideoError("");
    setVideoBusy(true);
    setVideoResultUrl(null);
    setVideoStatus("비용 견적을 확인하고 있습니다…");
    let estimate: { amount: number; currency: string | null } | null = null;
    try {
      const quoteResponse = await fetch("/api/video/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          prompt,
          startImageId: videoStartImage?.id,
        }),
      });
      const quoteBody = await quoteResponse.json().catch(() => ({}));
      if (quoteResponse.ok && quoteBody.cost) {
        estimate = quoteBody.cost;
        setVideoCostEstimate(estimate);
      }
    } catch {
      // 견적 실패 시 생성을 계속 진행합니다.
    }

    try {
      setVideoStatus("영상 생성을 요청하고 있습니다…");
      const queueResponse = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.id, prompt, startImageId: videoStartImage?.id }),
      });
      const queueBody = await queueResponse.json().catch(() => ({}));
      if (!queueResponse.ok) {
        throw new Error(queueBody.error || "영상 생성 요청에 실패했습니다.");
      }
      const queueId: string = queueBody.queueId;
      videoPollRef.current = { timer: null, startedAt: Date.now() };
      setVideoStatus("영상이 생성되고 있습니다. 완료까지 수 분이 소요될 수 있습니다…");

      await new Promise<void>((resolve) => {
        const poll = async () => {
          try {
            const retrieveResponse = await fetch(
              `/api/video/retrieve?queue_id=${encodeURIComponent(queueId)}&model=${encodeURIComponent(model.id)}`,
              { cache: "no-store" },
            );
            const retrieveBody = await retrieveResponse.json().catch(() => ({}));
            if (!retrieveResponse.ok) {
              throw new Error(retrieveBody.error || "영상 결과 확인에 실패했습니다.");
            }
            if (retrieveBody.status === "completed") {
              const completedUrl = retrieveBody.url ?? null;
              setVideoResultUrl(completedUrl);
              setVideoStatus("");
              recordJob({
                mode: "video",
                model: model.id,
                prompt,
                attachments: videoStartImage ? [videoStartImage] : [],
                usage: null,
                unitPrice: estimate ? { videoQuote: estimate } : null,
                cost: estimate?.amount ?? null,
                currency: estimate?.currency ?? null,
                status: "completed",
                result: completedUrl ? { kind: "video", urls: [completedUrl] } : null,
              });
              resolve();
              return;
            }
            if (retrieveBody.status === "failed") {
              recordJob({
                mode: "video",
                model: model.id,
                prompt,
                attachments: videoStartImage ? [videoStartImage] : [],
                usage: null,
                unitPrice: estimate ? { videoQuote: estimate } : null,
                cost: estimate?.amount ?? null,
                currency: estimate?.currency ?? null,
                status: "failed",
                result: null,
              });
              throw new Error("영상 생성이 거부되거나 실패했습니다.");
            }
            if (Date.now() - videoPollRef.current.startedAt > VIDEO_POLL_TIMEOUT_MS) {
              throw new Error("영상 생성이 시간 내에 완료되지 않았습니다. 잠시 후 작업 기록에서 다시 확인해 주세요.");
            }
            videoPollRef.current.timer = setTimeout(poll, VIDEO_POLL_INTERVAL_MS);
          } catch (error) {
            setVideoStatus("");
            setVideoError(error instanceof Error ? error.message : "영상 생성에 실패했습니다.");
            videoPollRef.current.timer = null;
            resolve();
          }
        };
        videoPollRef.current.timer = setTimeout(poll, VIDEO_POLL_INTERVAL_MS);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "영상 생성에 실패했습니다.";
      setVideoStatus("");
      setVideoError(message);
      recordJob({
        mode: "video",
        model: model.id,
        prompt,
        attachments: videoStartImage ? [videoStartImage] : [],
        usage: null,
        unitPrice: estimate ? { videoQuote: estimate } : null,
        cost: estimate?.amount ?? null,
        currency: estimate?.currency ?? null,
        status: "failed",
        result: null,
      });
    } finally {
      setVideoBusy(false);
    }
  }

  async function generateAudio() {
    const input = audioInput.trim();
    if (audioGenerating || !input) return;
    const model = selectedModel;
    if (!model) {
      setAudioError("모델을 선택해 주세요.");
      return;
    }
    setAudioError("");
    setAudioGenerating(true);
    try {
      const response = await fetch("/api/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          voice: audioVoice || model.defaultVoice || undefined,
          input,
          response_format: model.defaultFormat || "mp3",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "음성 생성에 실패했습니다.");
      }
      const url = typeof body.url === "string" ? body.url : null;
      setAudioResultUrl(url);
      recordJob({
        mode: "audio",
        model: model.id,
        prompt: input,
        attachments: [],
        usage: null,
        unitPrice: model.pricing,
        cost: null,
        currency: null,
        status: "completed",
        result: { kind: "audio", urls: url ? [url] : [] },
      });
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "음성 생성에 실패했습니다.");
    } finally {
      setAudioGenerating(false);
    }
  }

  async function handleImageRefPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setImageError("");
    const model = selectedModel;
    const maxRefs = model?.maxStyleReferences ?? MAX_IMAGES;
    if (imageRefs.length + files.length > maxRefs) {
      setImageError(`이미지 생성에는 참조 이미지를 최대 ${maxRefs}개까지 첨부할 수 있습니다.`);
      return;
    }
    try {
      const uploaded = await uploadFiles(files);
      setImageRefs((prev) => [...prev, ...uploaded]);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "이미지 업로드에 실패했습니다.");
    }
  }

  async function handleVideoStartImagePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setVideoError("");
    try {
      const uploaded = await uploadFiles([file]);
      setVideoStartImage(uploaded[0] ?? null);
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : "이미지 업로드에 실패했습니다.");
    }
  }

  return (
    <main>
      <header className="app-header">
        <span className="brand">AI 올인원 플랫폼</span>
        <nav>
          <a className="nav-link active" href="/">스튜디오</a>
          <a className="nav-link" href="/history">작업 기록</a>
          <a className="nav-link" href="/prompts">프롬프트 관리</a>
        </nav>
        <div className="header-right">
          <select className="theme-select" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            <option value="system">테마: 시스템</option>
            <option value="light">테마: 라이트</option>
            <option value="dark">테마: 다크</option>
          </select>
          <span className="muted">{me ?? ""}</span>
          <button className="secondary" onClick={logout}>로그아웃</button>
        </div>
      </header>

      <div className="studio-window">
        <div className="window-titlebar">
          <span className="window-dots"><span className="dot-red" /><span className="dot-yellow" /><span className="dot-green" /></span>
          <span className="window-title">AI 올인원 플랫폼</span>
        </div>
        <div className="mode-tabs" role="tablist">
          {(["chat", "image", "video", "audio"] as Mode[]).map((item) => (
            <button
              key={item}
              role="tab"
              className={`mode-tab${mode === item ? " active" : ""}`}
              onClick={() => setMode(item)}
            >
              {item === "chat" ? "채팅" : item === "image" ? "이미지" : item === "video" ? "영상" : "음성"}
            </button>
          ))}
        </div>
        <div className="workspace">
          {mode === "chat" ? (
            <section>
              <ModelSection
                models={models.chat}
                selected={selected.chat}
                onSelect={(id) => setSelected((prev) => ({ ...prev, chat: id }))}
                translation={translation.chat}
              />
              <div className="chat-area">
                <div className="chat-messages">
                  {chatMessages.length === 0 ? (
                    <div className="empty-note">메시지를 입력해 주세요.</div>
                  ) : null}
                  {chatMessages.map((message, index) => (
                    <div key={index} className={`bubble ${message.role}`}>
                      {message.attachments && message.attachments.length > 0 ? (
                        <div className="bubble-attaches">
                          {message.attachments.map((item) => {
                            if (item.kind === "image") {
                              return <img key={item.id} src={item.url} alt={item.name} onClick={() => setLightbox(item.url)} />;
                            }
                            if (item.kind === "video") {
                              return <video key={item.id} src={item.url} controls preload="metadata" />;
                            }
                            return (
                              <span key={item.id} className="bubble-attach-chip">문서: {item.name}</span>
                            );
                          })}
                        </div>
                      ) : null}
                      {message.content}
                      {message.framesCount ? (
                        <div className="muted" style={{ marginTop: 6 }}>동영상에서 추출한 {message.framesCount}개의 프레임을 함께 전송했습니다.</div>
                      ) : null}
                      {message.costLine ? <div className="muted" style={{ marginTop: 6 }}>{message.costLine}</div> : null}
                    </div>
                  ))}
                  {chatSending ? <div className="bubble assistant loading">답변을 작성하고 있습니다</div> : null}
                </div>
                <div className="chat-input-area">
                  <div className="attach-bar">
                    <label className="attach-btn" style={{ cursor: "pointer" }}>
                      이미지 첨부 ({chatAttachments.filter((item) => item.kind === "image").length}/{MAX_IMAGES})
                      <input type="file" accept="image/*" multiple hidden onChange={handleChatImagePick} />
                    </label>
                    <label className="attach-btn" style={{ cursor: "pointer" }}>
                      동영상 첨부 ({chatAttachments.some((item) => item.kind === "video") ? 1 : 0}/1)
                      <input type="file" accept="video/*" hidden onChange={handleChatVideoPick} />
                    </label>
                    <label className="attach-btn" style={{ cursor: "pointer" }}>
                      문서 첨부 ({chatAttachments.some((item) => item.kind === "doc") ? 1 : 0}/1)
                      <input type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" hidden onChange={handleChatDocPick} />
                    </label>
                  </div>
                  {chatAttachments.length > 0 ? (
                    <div className="attach-chips">
                      {chatAttachments.map((item) => (
                        <div key={item.id} className="attach-chip">
                          {item.kind === "image" ? <img src={item.url} alt={item.name} /> : null}
                          {item.kind === "video" ? <video src={item.url} preload="metadata" /> : null}
                          {item.kind === "doc" ? <span>문서</span> : null}
                          <span className="chip-name">{item.name}</span>
                          <button
                            className="chip-remove"
                            aria-label="첨부 제거"
                            onClick={() => setChatAttachments((prev) => prev.filter((entry) => entry.id !== item.id))}
                          >제거</button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {chatError ? <div className="error-box">{chatError}</div> : null}
                  <div className="chat-send-row">
                    <textarea
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          sendChat();
                        }
                      }}
                      placeholder="메시지를 입력해 주세요. (Shift+Enter로 줄바꿈)"
                    />
                    <button onClick={sendChat} disabled={chatSending}>전송</button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {mode === "image" ? (
            <section>
              <ModelSection
                models={models.image}
                selected={selected.image}
                onSelect={(id) => setSelected((prev) => ({ ...prev, image: id }))}
                translation={translation.image}
              />
              <div className="gen-form">
                <div>
                  <label htmlFor="image-prompt">이미지 프롬프트</label>
                  <textarea
                    id="image-prompt"
                    value={imagePrompt}
                    onChange={(event) => setImagePrompt(event.target.value)}
                    placeholder="생성할 이미지를 설명해 주세요."
                  />
                </div>
                <div>
                  <label>참조 이미지 (선택)</label>
                  <div className="attach-bar">
                    <label className="attach-btn" style={{ cursor: selectedModel?.supportsStyleReferences ? "pointer" : "not-allowed", opacity: selectedModel?.supportsStyleReferences ? 1 : 0.5 }}>
                      참조 이미지 첨부 ({imageRefs.length}/{selectedModel?.maxStyleReferences ?? MAX_IMAGES})
                      <input type="file" accept="image/*" multiple hidden disabled={!selectedModel?.supportsStyleReferences} onChange={handleImageRefPick} />
                    </label>
                  </div>
                  {selectedModel && !selectedModel.supportsStyleReferences ? (
                    <div className="notice" style={{ marginTop: 8 }}>선택한 모델은 참조 이미지를 지원하지 않습니다. 첨부한 이미지는 전송되지 않습니다.</div>
                  ) : null}
                  {imageRefs.length > 0 ? (
                    <div className="attach-chips" style={{ marginTop: 8 }}>
                      {imageRefs.map((item) => (
                        <div key={item.id} className="attach-chip">
                          <img src={item.url} alt={item.name} />
                          <span className="chip-name">{item.name}</span>
                          <button className="chip-remove" aria-label="첨부 제거" onClick={() => setImageRefs((prev) => prev.filter((entry) => entry.id !== item.id))}>제거</button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {imageError ? <div className="error-box">{imageError}</div> : null}
                <div>
                  <button onClick={generateImage} disabled={imageGenerating || !imagePrompt.trim()}>
                    {imageGenerating ? "이미지를 생성하고 있습니다…" : "이미지 생성"}
                  </button>
                  {imageGenerating ? (
                    <div className="progress-note"><span className="spinner" /> 생성 중입니다. 완료까지 시간이 소요될 수 있습니다.</div>
                  ) : null}
                </div>
              </div>
              {imageResults.length > 0 ? (
                <div className="result-area">
                  <h3>생성 결과</h3>
                  <div className="gallery">
                    {imageResults.map((url, index) => (
                      <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" title="새 창에서 열기">
                        <img src={url} alt={`생성 결과 ${index + 1}`} onClick={(event) => { event.preventDefault(); setLightbox(url); }} />
                      </a>
                    ))}
                  </div>
                  <div className="cost-line">{imageCostLine}</div>
                </div>
              ) : null}
            </section>
          ) : null}

          {mode === "video" ? (
            <section>
              <ModelSection
                models={models.video}
                selected={selected.video}
                onSelect={(id) => setSelected((prev) => ({ ...prev, video: id }))}
                translation={translation.video}
              />
              <div className="gen-form">
                <div>
                  <label htmlFor="video-prompt">영상 프롬프트</label>
                  <textarea
                    id="video-prompt"
                    value={videoPrompt}
                    onChange={(event) => setVideoPrompt(event.target.value)}
                    placeholder="생성할 영상을 설명해 주세요."
                  />
                </div>
                <div>
                  <label>시작 이미지 (선택)</label>
                  <div className="attach-bar">
                    <label className="attach-btn" style={{ cursor: selectedModel?.supportsVideoInput ? "pointer" : "not-allowed", opacity: selectedModel?.supportsVideoInput ? 1 : 0.5 }}>
                      시작 이미지 첨부 ({videoStartImage ? 1 : 0}/1)
                      <input type="file" accept="image/*" hidden disabled={!selectedModel?.supportsVideoInput} onChange={handleVideoStartImagePick} />
                    </label>
                  </div>
                  {selectedModel && !selectedModel.supportsVideoInput ? (
                    <div className="notice" style={{ marginTop: 8 }}>선택한 모델은 시작 이미지를 지원하지 않습니다. 첨부한 이미지는 전송되지 않습니다.</div>
                  ) : null}
                  {videoStartImage ? (
                    <div className="attach-chips" style={{ marginTop: 8 }}>
                      <div className="attach-chip">
                        <img src={videoStartImage.url} alt={videoStartImage.name} />
                        <span className="chip-name">{videoStartImage.name}</span>
                        <button className="chip-remove" aria-label="첨부 제거" onClick={() => setVideoStartImage(null)}>제거</button>
                      </div>
                    </div>
                  ) : null}
                </div>
                {videoCostEstimate ? (
                  <div className="notice">예상 비용: {videoCostEstimate.currency ?? "USD"} {videoCostEstimate.amount.toFixed(4)}</div>
                ) : null}
                {videoError ? <div className="error-box">{videoError}</div> : null}
                <div>
                  <button onClick={generateVideo} disabled={videoBusy || !videoPrompt.trim()}>
                    {videoBusy ? "생성 중입니다…" : "영상 생성"}
                  </button>
                  {videoBusy ? (
                    <div className="progress-note"><span className="spinner" /> {videoStatus}</div>
                  ) : null}
                </div>
              </div>
              {videoResultUrl ? (
                <div className="result-area">
                  <h3>생성 결과</h3>
                  <video className="media-player" src={videoResultUrl} controls preload="metadata" />
                  <div className="cost-line">{videoCostEstimate ? `예상 비용: ${videoCostEstimate.currency ?? "USD"} ${videoCostEstimate.amount.toFixed(4)}` : "비용 정보 없음"}</div>
                </div>
              ) : null}
            </section>
          ) : null}

          {mode === "audio" ? (
            <section>
              <ModelSection
                models={models.audio}
                selected={selected.audio}
                onSelect={(id) => setSelected((prev) => ({ ...prev, audio: id }))}
                translation={translation.audio}
              />
              <div className="gen-form">
                <div>
                  <label htmlFor="audio-input">음성으로 생성할 텍스트</label>
                  <textarea
                    id="audio-input"
                    value={audioInput}
                    onChange={(event) => setAudioInput(event.target.value)}
                    placeholder="음성으로 들려줄 문장을 입력해 주세요. (최대 4,096자)"
                    maxLength={4096}
                  />
                  <div className="muted" style={{ marginTop: 4 }}>{audioInput.length}/4,096자</div>
                </div>
                {selectedModel && selectedModel.voices.length > 0 ? (
                  <div>
                    <label htmlFor="audio-voice">음성 선택</label>
                    <select
                      id="audio-voice"
                      value={audioVoice || selectedModel.defaultVoice || ""}
                      onChange={(event) => setAudioVoice(event.target.value)}
                    >
                      {selectedModel.voices.map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.name}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {audioError ? <div className="error-box">{audioError}</div> : null}
                <div>
                  <button onClick={generateAudio} disabled={audioGenerating || !audioInput.trim()}>
                    {audioGenerating ? "음성을 생성하고 있습니다…" : "음성 생성"}
                  </button>
                  {audioGenerating ? (
                    <div className="progress-note"><span className="spinner" /> 생성 중입니다.</div>
                  ) : null}
                </div>
              </div>
              {audioResultUrl ? (
                <div className="result-area">
                  <h3>생성 결과</h3>
                  <audio className="media-player" src={audioResultUrl} controls preload="metadata" />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      {lightbox ? (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="확대 보기" />
        </div>
      ) : null}
    </main>
  );
}

function ModelSection({
  models,
  selected,
  onSelect,
  translation,
}: {
  models: ModelState;
  selected: string;
  onSelect: (id: string) => void;
  translation: TranslationState;
}) {
  const model = models.models?.find((item) => item.id === selected) ?? null;
  return (
    <div className="model-section">
      <div>
        <label htmlFor={`model-select-${model?.id ?? "none"}`}>모델 선택</label>
        {models.loading ? (
          <div className="progress-note"><span className="spinner" /> 모델 목록을 불러오고 있습니다…</div>
        ) : null}
        {models.error ? <div className="error-box">{models.error}</div> : null}
        {models.models && models.models.length > 0 ? (
          <select id={`model-select-${model?.id ?? "none"}`} value={selected} onChange={(event) => onSelect(event.target.value)}>
            {models.models.map((item) => (
              <option key={item.id} value={item.id}>{modelDisplayLabel(item)}</option>
            ))}
          </select>
        ) : null}
        {models.models && models.models.length === 0 && !models.loading && !models.error ? (
          <div className="notice">표시할 모델이 없습니다.</div>
        ) : null}
      </div>
      {model ? (
        <div className="model-desc-panels">
          <div className="desc-panel">
            <span className="desc-label">모델 설명 (원문)</span>
            {model.description || "제공되는 설명이 없습니다."}
          </div>
          <div className="desc-panel">
            <span className="desc-label">모델 설명 (번역)</span>
            {translation.loading ? "번역을 준비하고 있습니다…" : null}
            {!translation.loading && translation.text !== null ? translation.text : null}
            {!translation.loading && translation.text === null && translation.error ? translation.error : null}
            {!translation.loading && translation.text === null && !translation.error ? "번역할 설명이 없습니다." : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}