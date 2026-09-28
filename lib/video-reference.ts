"use client";

/*
 * 참조 동영상에서 원본을 재현하는 데 필요한 재료를 브라우저에서 뽑습니다.
 * - extractFramesAt: 지정한 시각의 프레임을 원본 해상도 JPEG 파일로 추출
 *   (첫 프레임·장면별 첫 프레임을 동영상 생성의 시작 이미지로 쓰기 위함).
 * - extractAudioWav: 동영상의 소리를 16kHz 모노 WAV 로 추출
 *   (음성을 들을 수 있는 언어 모델에 대사·목소리를 받아 적게 하기 위함).
 * 서버를 거치지 않으므로 서버리스 임시 저장소 문제와 무관합니다.
 */

function waitFor(target: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("동영상을 읽는 데 시간이 너무 오래 걸립니다."));
    }, timeoutMs);
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("이 브라우저에서 재생할 수 없는 동영상 형식입니다."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener("error", fail);
    };
    target.addEventListener(event, ok, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

/** seconds 배열의 각 시각에서 프레임을 뽑아 JPEG File 로 돌려줍니다(실패한 시각은 null). */
export async function extractFramesAt(source: Blob, seconds: number[], baseName = "frame"): Promise<Array<File | null>> {
  const url = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = waitFor(video, "loadeddata", 20000);
    video.src = url;
    video.load();
    await loaded;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) return seconds.map(() => null);
    const out: Array<File | null> = [];
    for (const [index, second] of seconds.entries()) {
      // 장면 전환 직후의 잔상을 피하려고 시작 시각에서 아주 조금 뒤를 찍습니다.
      const target = Math.max(0, Math.min(duration ? duration - 0.05 : second, second + 0.05));
      try {
        const seeked = waitFor(video, "seeked", 8000);
        video.currentTime = target;
        await seeked;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
        out.push(blob ? new File([blob], `${baseName}-${index + 1}-${second.toFixed(1)}s.jpg`, { type: "image/jpeg" }) : null);
      } catch {
        out.push(null);
      }
    }
    return out;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * 동영상의 소리를 16kHz 모노 WAV 로 뽑습니다. 소리가 없거나 브라우저가 해당
 * 코덱을 해독하지 못하면 null 을 돌려줍니다. maxSeconds 로 길이를 자릅니다
 * (Seedance 한 번 생성 한도 15초에 맞춤).
 */
export async function extractAudioWav(source: Blob, maxSeconds: number, name = "audio.wav"): Promise<File | null> {
  const AudioCtx: typeof AudioContext | undefined =
    typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
  if (!AudioCtx) return null;
  const context = new AudioCtx();
  try {
    const decoded = await context.decodeAudioData(await source.arrayBuffer());
    const rate = 16000;
    const length = Math.max(1, Math.floor(Math.min(decoded.duration, maxSeconds) * rate));
    const offline = new OfflineAudioContext(1, length, rate);
    const node = offline.createBufferSource();
    node.buffer = decoded;
    node.connect(offline.destination);
    node.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    // 거의 무음이면 보내지 않습니다.
    let peak = 0;
    for (let i = 0; i < samples.length; i += 64) peak = Math.max(peak, Math.abs(samples[i]));
    if (peak < 0.005) return null;
    return new File([encodeWav(samples, rate)], name, { type: "audio/wav" });
  } catch {
    return null;
  } finally {
    context.close().catch(() => {});
  }
}
