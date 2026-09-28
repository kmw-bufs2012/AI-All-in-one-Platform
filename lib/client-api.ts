import { getCachedAttachment, rememberAttachment } from "@/lib/attachment-cache";
/*
 * 생성 페이지들이 공통으로 쓰는 브라우저 측 유틸입니다.
 * (기존 단일 스튜디오 페이지에 흩어져 있던 로직을 그대로 옮겨 놓았습니다.)
 */

export interface AttachedFile {
  id: string;
  kind: "image" | "video" | "audio" | "doc";
  name: string;
  size: number;
  mime: string;
  url: string;
}

export const MAX_IMAGES = 10;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_COMPRESSION_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);
const VIDEO_COMPRESSION_TARGET_BYTES = 4 * 1024 * 1024;

export function needsVideoCompression(file: File): boolean {
  return file.type.startsWith("video/") && file.size >= VIDEO_COMPRESSION_LIMIT_BYTES;
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("동영상을 읽을 수 없습니다."));
  });
}

function supportedRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((mime) =>
    MediaRecorder.isTypeSupported(mime),
  ) ?? null;
}

async function transcodeVideo(file: File, targetBytes: number): Promise<File> {
  const mimeType = supportedRecorderMime();
  if (!mimeType || typeof AudioContext === "undefined") {
    throw new Error("이 브라우저는 동영상 자동 압축을 지원하지 않습니다. Chrome 또는 Edge에서 다시 시도해 주세요.");
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = objectUrl;
  video.preload = "auto";
  video.playsInline = true;
  await waitForVideoMetadata(video);

  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("동영상 길이를 확인할 수 없어 압축하지 못했습니다.");
  }

  const maxWidth = 1280;
  const maxHeight = 720;
  const scale = Math.min(1, maxWidth / Math.max(video.videoWidth, 1), maxHeight / Math.max(video.videoHeight, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.floor((video.videoWidth * scale) / 2) * 2);
  canvas.height = Math.max(2, Math.floor((video.videoHeight * scale) / 2) * 2);
  const context = canvas.getContext("2d");
  if (!context) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("동영상 압축 화면을 준비하지 못했습니다.");
  }

  const canvasStream = canvas.captureStream(24);
  const audioContext = new AudioContext();
  const audioSource = audioContext.createMediaElementSource(video);
  const audioDestination = audioContext.createMediaStreamDestination();
  audioSource.connect(audioDestination);
  for (const track of audioDestination.stream.getAudioTracks()) canvasStream.addTrack(track);

  // 컨테이너 오버헤드를 위해 목표 용량의 88%만 비트레이트 예산으로 사용합니다.
  const totalBitsPerSecond = Math.max(48_000, Math.floor((targetBytes * 8 * 0.88) / duration));
  const audioBitsPerSecond = Math.min(64_000, Math.max(24_000, Math.floor(totalBitsPerSecond * 0.12)));
  const videoBitsPerSecond = Math.max(24_000, Math.min(2_500_000, totalBitsPerSecond - audioBitsPerSecond));
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond, audioBitsPerSecond });

  let animationFrame = 0;
  const drawFrame = () => {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (!video.ended && !video.paused) animationFrame = requestAnimationFrame(drawFrame);
  };

  try {
    await audioContext.resume();
    video.currentTime = 0;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("동영상 압축 중 오류가 발생했습니다."));
    });
    const ended = new Promise<void>((resolve, reject) => {
      video.onended = () => resolve();
      video.onerror = () => reject(new Error("동영상 압축 중 원본을 읽지 못했습니다."));
    });

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    recorder.start(1000);
    await video.play();
    drawFrame();
    await ended;
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: mimeType });
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}-compressed.webm`, { type: "video/webm", lastModified: Date.now() });
  } finally {
    cancelAnimationFrame(animationFrame);
    video.pause();
    for (const track of canvasStream.getTracks()) track.stop();
    await audioContext.close().catch(() => {});
    URL.revokeObjectURL(objectUrl);
  }
}

/** 4.5MB 이상인 동영상을 브라우저에서 4.5MB 미만 WebM으로 변환합니다. */
export async function compressVideoForUpload(file: File): Promise<File> {
  if (!needsVideoCompression(file)) return file;
  let compressed = await transcodeVideo(file, VIDEO_COMPRESSION_TARGET_BYTES);
  if (compressed.size >= VIDEO_COMPRESSION_LIMIT_BYTES) {
    compressed = await transcodeVideo(file, Math.floor(VIDEO_COMPRESSION_TARGET_BYTES * 0.72));
  }
  if (compressed.size >= VIDEO_COMPRESSION_LIMIT_BYTES) {
    throw new Error("동영상을 4.5MB 미만으로 압축하지 못했습니다. 더 짧거나 작은 동영상을 선택해 주세요.");
  }
  return compressed;
}

/** 업로드 전에 긴 변을 1024px로 맞춰 전송량을 줄입니다. */
export async function downscaleImage(file: File): Promise<File> {
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

/*
 * Vercel Serverless Function은 요청 본문을 4.5MB로 강제 제한합니다(인프라
 * 레벨이라 애플리케이션 설정으로는 우회할 수 없습니다). 동영상·오디오·큰
 * 문서는 이 한도를 쉽게 넘기므로, 그보다 훨씬 작은 조각으로 나눠
 * /api/attachments/chunk 로 순차 전송한 뒤 서버에서 이어 붙입니다. 작은
 * 파일(다운스케일된 이미지 등)은 기존처럼 한 번에 보냅니다.
 * 참고: https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE
 */
const CHUNK_UPLOAD_THRESHOLD = 3 * 1024 * 1024;
const CHUNK_SIZE = 3 * 1024 * 1024;

async function uploadFileChunked(file: File, onProgress?: (fraction: number) => void): Promise<AttachedFile> {
  const uploadId = crypto.randomUUID();
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  for (let index = 0; index < total; index++) {
    const chunk = file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE));
    const formData = new FormData();
    formData.append("chunk", chunk, file.name);
    formData.append("uploadId", uploadId);
    formData.append("index", String(index));
    formData.append("total", String(total));
    formData.append("name", file.name);
    formData.append("mime", file.type || "application/octet-stream");
    const response = await fetch("/api/attachments/chunk", { method: "POST", body: formData });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "파일 업로드에 실패했습니다.");
    }
    onProgress?.((index + 1) / total);
    if (index === total - 1) {
      if (!body.file) throw new Error("파일 업로드에 실패했습니다.");
      return body.file as AttachedFile;
    }
  }
  throw new Error("파일 업로드에 실패했습니다.");
}

async function uploadFileWhole(file: File): Promise<AttachedFile> {
  const formData = new FormData();
  formData.append("files", file);
  const response = await fetch("/api/attachments", { method: "POST", body: formData });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "파일 업로드에 실패했습니다.");
  }
  const uploaded = Array.isArray(body.files) ? body.files : [];
  if (!uploaded[0]) throw new Error("파일 업로드에 실패했습니다.");
  return uploaded[0] as AttachedFile;
}

/*
 * 업로드한 원본(압축·축소 후) 파일을 브라우저 메모리에 보관합니다.
 * Vercel 같은 서버리스 환경에서는 업로드한 파일이 한 인스턴스의 /tmp 에만
 * 저장되어, 다른 인스턴스가 받은 /api/files 요청은 404가 날 수 있습니다.
 * 그래서 프레임 추출·이미지 인라인 전송처럼 브라우저가 파일 내용을 다시
 * 읽어야 할 때는 서버에서 내려받지 않고 이 사본을 씁니다.
 */
const localFiles = new Map<string, File>();

export function getLocalFile(id: string): File | null {
  return localFiles.get(id) ?? null;
}

/** 첨부 파일 내용을 읽습니다. 브라우저 사본이 있으면 서버를 거치지 않습니다. */
export async function attachmentBlob(file: AttachedFile): Promise<Blob> {
  const local = localFiles.get(file.id);
  if (local) return local;
  const cached = await getCachedAttachment(file.url);
  if (cached) return cached;
  const response = await fetch(file.url);
  if (!response.ok) {
    throw new Error(
      "동영상 파일을 불러오지 못했습니다. 서버에 저장된 첨부가 사라졌을 수 있습니다(서버리스 환경의 임시 저장소). 파일을 다시 첨부해 주세요.",
    );
  }
  return response.blob();
}

export async function uploadFiles(
  files: File[],
  onProgress?: (fileIndex: number, fraction: number) => void,
): Promise<AttachedFile[]> {
  const prepared: File[] = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) prepared.push(await downscaleImage(file));
    else if (needsVideoCompression(file)) prepared.push(await compressVideoForUpload(file));
    else prepared.push(file);
  }
  const uploaded: AttachedFile[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const file = prepared[i];
    const result = file.size > CHUNK_UPLOAD_THRESHOLD
      ? await uploadFileChunked(file, (fraction) => onProgress?.(i, fraction))
      : await uploadFileWhole(file);
    localFiles.set(result.id, file);
    rememberAttachment(result.url, file);
    uploaded.push(result);
  }
  return uploaded;
}

/** 시각 모델에 동영상을 넘기기 위해 균등 간격으로 프레임을 뽑습니다. */
/*
 * 비전 전용 모델에 보낼 동영상 프레임을 뽑습니다.
 * - loadeddata 까지 기다려야 첫 seek 후 drawImage 가 빈 캔버스를 그리지 않습니다.
 * - webm 등은 duration 이 Infinity 로 오므로 끝까지 seek 해 실제 길이를 구합니다.
 * - seeked 가 오지 않는 브라우저·코덱이 있어 seek 마다 타임아웃을 둡니다.
 */
function waitEvent(video: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("동영상 프레임을 읽는 데 시간이 너무 오래 걸립니다."));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("이 브라우저에서 재생할 수 없는 동영상 형식입니다."));
    };
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
    }
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
  });
}

function drawFrame(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** seek 로 원하는 시점을 찍습니다. 길이 정보·탐색 색인이 있는 파일(mp4 등)에 적합합니다. */
async function framesBySeeking(video: HTMLVideoElement, count: number): Promise<string[]> {
  let duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    // MediaRecorder 로 만든 WebM 은 길이가 Infinity 로 옵니다. 끝으로 보내 실제 길이를 구합니다.
    const seeked = waitEvent(video, "seeked", 10000);
    video.currentTime = 1e9;
    await seeked.catch(() => {});
    duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime;
  }
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const target = Math.max(0, Math.min(duration - 0.05, (duration * (i + 0.5)) / count));
    const seeked = waitEvent(video, "seeked", 8000);
    video.currentTime = target;
    try {
      await seeked;
    } catch {
      continue;
    }
    const frame = drawFrame(video);
    if (frame) frames.push(frame);
  }
  return frames;
}

/*
 * 재생하면서 찍습니다. 탐색 색인이 없는 WebM 처럼 seek 가 실패하는 파일용
 * 대체 방식입니다. 소리 없이 빠르게 재생하며 일정 간격으로 찍은 뒤, 끝나면
 * 고르게 count 장을 고릅니다.
 */
async function framesByPlayback(video: HTMLVideoElement, count: number): Promise<string[]> {
  const seeked = waitEvent(video, "seeked", 5000);
  video.currentTime = 0;
  await seeked.catch(() => {});
  video.playbackRate = 4;
  const captured: string[] = [];
  let lastCapture = -Infinity;
  const interval = 0.5;
  const capture = () => {
    if (video.currentTime - lastCapture >= interval) {
      const frame = drawFrame(video);
      if (frame) captured.push(frame);
      lastCapture = video.currentTime;
    }
  };
  video.addEventListener("timeupdate", capture);
  try {
    const ended = waitEvent(video, "ended", 120000);
    await video.play();
    await ended;
  } finally {
    video.removeEventListener("timeupdate", capture);
    video.pause();
  }
  if (captured.length <= count) return captured;
  return Array.from({ length: count }, (_, i) => captured[Math.floor(((i + 0.5) * captured.length) / count)]);
}

export async function extractVideoFrames(file: File, count = 6): Promise<string[]> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const loaded = waitEvent(video, "loadeddata", 20000);
    video.src = objectUrl;
    video.load();
    await loaded;

    let frames = await framesBySeeking(video, count).catch(() => [] as string[]);
    if (frames.length < Math.ceil(count / 2)) {
      const played = await framesByPlayback(video, count).catch(() => [] as string[]);
      if (played.length > frames.length) frames = played;
    }
    if (frames.length === 0) throw new Error("동영상에서 프레임을 추출하지 못했습니다.");
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

export function recordJob(payload: Record<string, unknown>): void {
  fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    // 상단 "완료된 작업" 목록이 새 작업을 바로 보여 주도록 알립니다.
    .then(() => window.dispatchEvent(new Event("jobs:updated")))
    .catch(() => {});
  autoSaveToVault(payload);
}

/*
 * 완료된 이미지·영상 결과를 이 기기 보관함(lib/local-vault.ts)에 자동 저장합니다.
 * 실패해도 생성 흐름에는 영향을 주지 않습니다.
 */
function autoSaveToVault(payload: Record<string, unknown>): void {
  const mode = payload.mode;
  if (payload.status !== "completed" || (mode !== "image" && mode !== "video")) return;
  const result = payload.result as { urls?: unknown } | null | undefined;
  const urls = Array.isArray(result?.urls) ? result.urls.filter((url): url is string => typeof url === "string") : [];
  if (urls.length === 0) return;
  import("./local-vault")
    .then(async ({ saveToVault }) => {
      for (const url of urls) {
        await saveToVault({
          url,
          kind: mode,
          model: typeof payload.model === "string" ? payload.model : null,
          prompt: typeof payload.prompt === "string" ? payload.prompt : "",
        }).catch(() => false);
      }
    })
    .catch(() => {});
}
