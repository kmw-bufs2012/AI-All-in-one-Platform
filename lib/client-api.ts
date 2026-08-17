/*
 * 생성 페이지들이 공통으로 쓰는 브라우저 측 유틸입니다.
 * (기존 단일 스튜디오 페이지에 흩어져 있던 로직을 그대로 옮겨 놓았습니다.)
 */

export interface AttachedFile {
  id: string;
  kind: "image" | "video" | "doc";
  name: string;
  size: number;
  mime: string;
  url: string;
}

export const MAX_IMAGES = 10;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

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

export async function uploadFiles(files: File[]): Promise<AttachedFile[]> {
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

/** 시각 모델에 동영상을 넘기기 위해 균등 간격으로 프레임을 뽑습니다. */
export async function extractVideoFrames(file: File, count = 6): Promise<string[]> {
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

export function recordJob(payload: Record<string, unknown>): void {
  fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
