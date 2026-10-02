import type { NormalizedModel } from "./models";
import { findChatLimit, findImageReferenceLimit, findVideoInputLimit } from "./model-attachment-limits";

/*
 * 모델별 첨부 정책. NanoGPT 공식 API 문서(docs.nano-gpt.com, 2026-09 확인)를
 * 근거로 계산합니다.
 *
 * 채팅 모델(/v1/models?detailed=true 의 capabilities · architecture):
 * - capabilities.vision — 이미지 첨부 가능 여부.
 * - capabilities.video_input — 동영상 파일을 그대로 넘길 수 있는지.
 * - capabilities.audio_input — 오디오 파일을 그대로 넘길 수 있는지.
 * - capabilities.pdf_upload — PDF를 파일 파트로 올릴 수 있는지.
 * NanoGPT 카탈로그는 "첨부 가능 여부"만 공개하고 채팅 요청당 최대 개수는
 * 공개하지 않습니다. 그래서 종류별 허용 여부는 위 플래그로 정확히 가르고,
 * 개수는 아래 앱 안전 상한을 적용합니다(문서에 근거가 없는 값을 모델별
 * 제한인 것처럼 표시하지 않기 위함입니다).
 *
 * 이미지 생성 모델(/v1/image-models?detailed=true):
 * - input_reference_constraints.max_items — 참조 이미지 최대 장수(예: 4).
 * - .max_bytes(예: 31457280) / .formats(png·jpeg·webp) / .min_width·min_height(8).
 * - supported_parameters.n.max — 한 번에 만들 이미지 장수.
 * 이 값들은 모델마다 다르므로 전부 카탈로그에서 읽어 그대로 적용합니다.
 *
 * 동영상 생성 모델(/v1/video-models?detailed=true):
 * - imageUrl / imageDataUrl 파라미터가 있는 모델만 시작 이미지를 받습니다.
 * - videoUrl 파라미터가 있는 모델은 기존 동영상을 확장·편집할 수 있습니다.
 *
 * TTS 모델(/v1/audio-models?type=tts&detailed=true): 입력이 텍스트뿐이라
 * 첨부가 없습니다. 대신 max_input_size(최대 글자 수)를 사용합니다.
 */

export interface AttachmentSlot {
  allowed: boolean;
  max: number;
}

/*
 * 채팅 요청당 앱 상한(Vercel Hobby 기준). 공식 한도가 이보다 크면 이 값을 씁니다.
 * 파일은 청크 업로드라 4.5MB 본문 한도에 걸리지 않지만, 서버가 첨부를 base64로
 * 읽어 NanoGPT로 보내므로 함수 메모리(2GB)·실행 시간(300초)을 고려해 둡니다.
 * 공식 한도가 공개되지 않은 모델도 이 값을 씁니다.
 */
const APP_CAP_IMAGES = 20;
const APP_CAP_VIDEOS = 3;
const APP_CAP_AUDIOS = 3;
const CHAT_MAX_DOCS = 5;
/* 공식 총 용량 한도가 없는 모델에 적용하는 요청당 첨부 총량(앱 상한). */
const APP_CAP_TOTAL_BYTES = 100 * 1024 * 1024;

/* 비전 전용 모델에 동영상을 보여 줄 때 동영상 1개에서 뽑는 프레임 수. */
const VIDEO_FRAME_COUNT = 6;
/* /api/chat 본문(4.5MB)에 실리는 프레임 총수 상한. 1024px JPEG(q0.7) ≈ 100~250KB. */
export const MAX_TOTAL_FRAMES = 12;

function capped(official: number | null | undefined, appCap: number): number {
  return official === null || official === undefined ? appCap : Math.min(official, appCap);
}

export interface ChatAttachmentPolicy {
  image: AttachmentSlot;
  video: AttachmentSlot;
  audio: AttachmentSlot;
  doc: AttachmentSlot;
  /** true면 동영상을 video_url 파트로 그대로 전송. false면 프레임을 뽑아 이미지로 전송. */
  videoNative: boolean;
  /** 프레임 추출 방식일 때 동영상 1개에서 뽑는 프레임 수. */
  frameCount: number;
  /** capabilities.pdf_upload. true면 PDF를 파일 그대로, false면 글자만 뽑아 보냅니다. */
  pdfAllowed: boolean;
  /** 문서 첨부 input 의 accept 값. */
  docAccept: string;
  /** 요청당 첨부 총 용량 상한(바이트). */
  totalBytes: number;
  /** 공식 한도를 확인한 모델 계열(없으면 null — 앱 기본값 사용). */
  family: string | null;
  /** 첨부 제약을 사용자에게 한 줄로 알려 주는 문구. */
  note: string | null;
}

/*
 * 능력이 null(카탈로그 미공개)이면 허용 쪽으로 해석합니다. NanoGPT 카탈로그는
 * 모델마다 메타데이터 수록 정도가 달라, 미공개를 "미지원"으로 단정하면 실제로는
 * 첨부되는 모델까지 버튼이 잠깁니다. 지원하지 않는 모델에 첨부를 보내면 API가
 * 오류를 돌려주므로 사용자가 원인을 알 수 있지만, 버튼이 잠기면 알 방법이 없습니다.
 */
/* 문서는 서버에서 본문 텍스트를 뽑아 보내므로 모든 채팅 모델에 같은 형식을 허용합니다. */
const DOC_ACCEPT = ".txt,.md,.pdf,.docx,.pptx,.hwp,.hwpx,text/plain,text/markdown,application/pdf";

export function resolveChatAttachmentPolicy(model: NormalizedModel | null): ChatAttachmentPolicy {
  if (!model) {
    return {
      image: { allowed: false, max: 0 },
      video: { allowed: false, max: 0 },
      audio: { allowed: false, max: 0 },
      doc: { allowed: true, max: CHAT_MAX_DOCS },
      videoNative: false,
      frameCount: VIDEO_FRAME_COUNT,
      pdfAllowed: true,
      docAccept: DOC_ACCEPT,
      totalBytes: APP_CAP_TOTAL_BYTES,
      family: null,
      note: null,
    };
  }
  const vision = model.vision ?? true;
  const nativeVideo = model.videoInput ?? false;
  const audio = model.audioInput ?? false;
  const pdf = model.pdfUpload ?? true;
  const official = findChatLimit(model.id, model.name);

  // 공식 문서가 해당 입력을 지원하지 않는다고(0) 밝힌 경우에도, 카탈로그가
  // 지원한다고 표시하면 NanoGPT 쪽 처리를 믿고 앱 상한을 적용합니다.
  const imageMax = vision ? capped(official?.images || null, APP_CAP_IMAGES) : 0;
  const nativeVideoMax = nativeVideo ? capped(official?.videos || null, APP_CAP_VIDEOS) : 0;
  const audioMax = audio ? capped(official?.audios || null, APP_CAP_AUDIOS) : 0;

  // 프레임 방식: 동영상 1개당 최소 2프레임이 이미지 한도 안에 들어가야 합니다.
  const frameVideoMax = vision ? Math.max(0, Math.min(APP_CAP_VIDEOS, Math.floor(Math.min(imageMax, MAX_TOTAL_FRAMES) / 2))) : 0;
  const videoMax = nativeVideo ? nativeVideoMax : frameVideoMax;
  const videoAllowed = videoMax > 0;
  const totalBytes = Math.min(official?.totalBytes ?? APP_CAP_TOTAL_BYTES, APP_CAP_TOTAL_BYTES);

  const notes: string[] = [];
  if (!vision) notes.push("이미지를 인식하지 못하는 모델입니다");
  if (!nativeVideo && vision) notes.push("동영상은 프레임을 뽑아 이미지로 전달하며, 프레임도 이미지 개수에 포함됩니다");
  if (!pdf) notes.push("PDF는 글자만 뽑아 전달합니다(표·그림 제외)");
  notes.push(
    official
      ? `${official.family} 공식 한도 기준 · 요청당 총 ${Math.round(totalBytes / 1024 / 1024)}MB`
      : `공식 개수 한도가 공개되지 않아 앱 기본값 적용 · 요청당 총 ${Math.round(totalBytes / 1024 / 1024)}MB`,
  );

  return {
    image: { allowed: imageMax > 0, max: imageMax },
    video: { allowed: videoAllowed, max: videoMax },
    audio: { allowed: audioMax > 0, max: audioMax },
    doc: { allowed: true, max: CHAT_MAX_DOCS },
    videoNative: nativeVideo,
    frameCount: VIDEO_FRAME_COUNT,
    pdfAllowed: pdf,
    docAccept: DOC_ACCEPT,
    totalBytes,
    family: official?.family ?? null,
    note: `${notes.join(" · ")}.`,
  };
}

export interface ImageAttachmentPolicy {
  reference: AttachmentSlot;
  /** 참조 이미지 1장의 최대 바이트 수(input_reference_constraints.max_bytes). */
  maxBytes: number | null;
  /** 참조 이미지 허용 형식. 파일 선택기의 accept 값으로도 씁니다. */
  formats: string[];
  accept: string;
}

const DEFAULT_REFERENCE_FORMATS = ["png", "jpeg", "webp"];
/*
 * 카탈로그가 입력 장수를 싣지 않은 모델의 기본 허용 장수.
 * NanoGPT 카탈로그(2026-09 확인)에서 여러 장을 받는 모델은 모두 max_input_images 를
 * 공개하고, 공개하지 않은 모델은 업스케일러·배경 제거·단일 이미지 편집기처럼 한 장만
 * 받는 도구였습니다. 그래서 1장을 기본으로 합니다.
 */
const DEFAULT_MAX_REFERENCES = 1;

export function resolveImageAttachmentPolicy(model: NormalizedModel | null): ImageAttachmentPolicy {
  // null(미공개)이면 막지 않고 기본값을 씁니다. 지원하지 않는 모델은 API가
  // input_references 를 무시하거나 오류로 알려 줍니다.
  // NanoGPT 카탈로그(input_reference_constraints.max_items 또는 input_references 범위)가
  // 공개한 장수를 가장 먼저 씁니다. NanoGPT 가 실제로 받는 한도이기 때문입니다(예: Seedream 5.0 Pro 10장).
  // 카탈로그에 값이 없을 때만 원 개발사 공식 한도, 그것도 없으면 기본값을 씁니다.
  const official = model ? findImageReferenceLimit(model.id, model.name) : null;
  const catalogMax = model?.maxInputReferences ?? null;
  const max = !model ? 0 : catalogMax ?? official?.max ?? DEFAULT_MAX_REFERENCES;
  const formats = model?.referenceFormats?.length ? model.referenceFormats : DEFAULT_REFERENCE_FORMATS;
  return {
    reference: { allowed: max > 0, max },
    maxBytes: model?.referenceMaxBytes ?? null,
    formats,
    accept: formats.map((format) => `image/${format === "jpg" ? "jpeg" : format}`).join(","),
  };
}

export interface VideoAttachmentPolicy {
  startImage: AttachmentSlot;
  sourceVideo: AttachmentSlot;
  /** 참조 이미지 여러 장(카탈로그가 공개한 파라미터·최대 장수). key 는 요청 필드 이름입니다. */
  referenceImages: AttachmentSlot & { key: string | null };
  /** 참조 동영상 여러 개(reference_videos 등). */
  referenceVideos: AttachmentSlot & { key: string | null };
  /** 모델이 공식적으로 받는 입력 한도 안내(앱은 시작 이미지 1장만 전송). */
  note: string | null;
}

/*
 * 동영상 모델은 supported_parameters 로 입력 방식을 판정하되, 카탈로그가 아무
 * 정보도 싣지 않은 모델(null)은 막지 않고 허용합니다. 지원하지 않는 모델에
 * 이미지를 보내면 NanoGPT가 해당 필드를 무시하거나 오류 메시지를 돌려주므로,
 * 첨부 자체를 막아 실제로 되는 모델까지 못 쓰게 하는 쪽이 더 나쁩니다.
 */
export function resolveVideoAttachmentPolicy(model: NormalizedModel | null): VideoAttachmentPolicy {
  if (!model) {
    return {
      startImage: { allowed: false, max: 0 },
      sourceVideo: { allowed: false, max: 0 },
      referenceImages: { allowed: false, max: 0, key: null },
      referenceVideos: { allowed: false, max: 0, key: null },
      note: null,
    };
  }
  const startAllowed = model.acceptsStartImage ?? true;
  const official = findVideoInputLimit(model.id, model.name);
  const sourceAllowed = (model.acceptsSourceVideo ?? false) && (official ? official.videos > 0 : true);
  // NanoGPT 동영상 API는 시작 이미지를 imageUrl/imageDataUrl 한 개로 받습니다.
  // 참조 이미지 여러 장은 NanoGPT 카탈로그가 그 파라미터와 최대 장수를 공개한 모델에서만 받습니다.
  const refs = model.videoReferenceImages;
  const refVideos = model.videoReferenceVideos;
  const officialText = official
    ? `${official.family} 공식 한도: 이미지 ${official.referenceImages}장 · 동영상 ${official.videos}개${official.audios ? ` · 오디오 ${official.audios}개` : ""}${official.note ? ` (${official.note})` : ""}`
    : null;
  const sentText = [
    refs ? `참조 이미지 최대 ${refs.max}장(${refs.key})` : null,
    refVideos ? `참조 동영상 최대 ${refVideos.max}개(${refVideos.key})` : null,
  ].filter(Boolean).join(" · ");
  return {
    startImage: { allowed: startAllowed, max: startAllowed ? 1 : 0 },
    sourceVideo: { allowed: sourceAllowed, max: sourceAllowed ? 1 : 0 },
    referenceImages: refs ? { allowed: true, max: refs.max, key: refs.key } : { allowed: false, max: 0, key: null },
    referenceVideos: refVideos ? { allowed: true, max: refVideos.max, key: refVideos.key } : { allowed: false, max: 0, key: null },
    note: [
      sentText ? `이 앱이 보내는 입력: ${sentText}` : officialText ? "NanoGPT가 여러 장 입력 파라미터를 공개하지 않아 시작 이미지 1장(과 원본 동영상 1개)만 보냅니다" : null,
      officialText,
      official ? "요청 1건 = 동영상 1개 · \"동시 생성\"으로 최대 4건 병렬" : null,
    ].filter(Boolean).join(" · ") || null,
  };
}

export interface AudioAttachmentPolicy {
  image: AttachmentSlot;
  video: AttachmentSlot;
  doc: AttachmentSlot;
  /** TTS는 텍스트만 입력받으므로 이미지·동영상·문서·오디오 모두 0개입니다
   *  (보이스 클로닝용 참조 음성 업로드는 NanoGPT 음성 API에 구현하지 않음). */
  /** max_input_size. 카탈로그에 없으면 널리 쓰이는 4096자를 기본으로 씁니다. */
  maxInputLength: number;
}

const DEFAULT_TTS_INPUT_LENGTH = 4096;

export function resolveAudioAttachmentPolicy(model: NormalizedModel | null): AudioAttachmentPolicy {
  return {
    image: { allowed: false, max: 0 },
    video: { allowed: false, max: 0 },
    doc: { allowed: false, max: 0 },
    maxInputLength: model?.maxInputLength ?? DEFAULT_TTS_INPUT_LENGTH,
  };
}

/*
 * 동영상을 이해할 수 있는 멀티모달 모델인지 판정합니다.
 * - 카탈로그가 capabilities.video_input 을 true 로 표시한 모델
 * - 또는 비전 모델이면서, 원 개발사가 동영상 입력을 공식 지원한다고 밝힌 계열
 *   (lib/model-attachment-limits.ts 에서 videos 가 0이 아닌 계열: Gemini, Qwen VL·
 *   3.5+·Omni, Kimi K2.5+, GLM-V·5V, MiniMax M3, Gemma 4, ERNIE, Doubao Seed 등과
 *   그 무검열 파생 모델)
 * 이미지만 이해하는 비전 모델(Claude, GPT, Llama 4, Mistral, DeepSeek Vision 등)은
 * 제외합니다. 카탈로그의 video_input=false 는 모달리티 문자열에서 추정된 값인 경우가
 * 많아(예: "text+image->text") 제외 근거로 쓰지 않습니다. 이런 모델은 프레임 방식으로
 * 동영상을 전달합니다.
 */
export function isVideoCapableModel(model: NormalizedModel): boolean {
  if (model.kind !== "text") return false;
  if (model.videoInput === true) return true;
  if (model.vision === false) return false;
  const official = findChatLimit(model.id, model.name);
  return official !== null && official.videos !== 0;
}
