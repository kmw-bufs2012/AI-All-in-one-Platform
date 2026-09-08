import type { NormalizedModel } from "./models";

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
 * 영상 생성 모델(/v1/video-models?detailed=true):
 * - imageUrl / imageDataUrl 파라미터가 있는 모델만 시작 이미지를 받습니다.
 * - videoUrl 파라미터가 있는 모델은 기존 영상을 확장·편집할 수 있습니다.
 *
 * TTS 모델(/v1/audio-models?type=tts&detailed=true): 입력이 텍스트뿐이라
 * 첨부가 없습니다. 대신 max_input_size(최대 글자 수)를 사용합니다.
 */

export interface AttachmentSlot {
  allowed: boolean;
  max: number;
}

/* 채팅 요청당 앱 안전 상한. NanoGPT가 모델별 개수를 공개하지 않아 사용합니다. */
const CHAT_MAX_IMAGES = 10;
const CHAT_MAX_VIDEOS = 3;
const CHAT_MAX_AUDIOS = 3;
const CHAT_MAX_DOCS = 5;

/* 비전 전용 모델에 동영상을 보여 줄 때 뽑아 보내는 프레임 수. */
const VIDEO_FRAME_COUNT = 6;

export interface ChatAttachmentPolicy {
  image: AttachmentSlot;
  video: AttachmentSlot;
  audio: AttachmentSlot;
  doc: AttachmentSlot;
  /** true면 동영상을 video_url 파트로 그대로 전송. false면 프레임을 뽑아 이미지로 전송. */
  videoNative: boolean;
  /** 프레임 추출 방식일 때 동영상 1개에서 뽑는 프레임 수. */
  frameCount: number;
  /** capabilities.pdf_upload. false면 PDF 대신 텍스트 문서만 첨부할 수 있습니다. */
  pdfAllowed: boolean;
  /** 문서 첨부 input 의 accept 값. */
  docAccept: string;
  /** 첨부 제약을 사용자에게 한 줄로 알려 주는 문구. */
  note: string | null;
}

/*
 * 능력이 null(카탈로그 미공개)이면 허용 쪽으로 해석합니다. NanoGPT 카탈로그는
 * 모델마다 메타데이터 수록 정도가 달라, 미공개를 "미지원"으로 단정하면 실제로는
 * 첨부되는 모델까지 버튼이 잠깁니다. 지원하지 않는 모델에 첨부를 보내면 API가
 * 오류를 돌려주므로 사용자가 원인을 알 수 있지만, 버튼이 잠기면 알 방법이 없습니다.
 */
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
      docAccept: ".pdf,.txt,.md,text/plain,text/markdown,application/pdf",
      note: null,
    };
  }
  const vision = model.vision ?? true;
  const nativeVideo = model.videoInput ?? false;
  const audio = model.audioInput ?? false;
  const pdf = model.pdfUpload ?? true;

  // 동영상은 직접 지원하면 그대로, 비전만 되면 프레임을 뽑아 이미지로 보냅니다.
  const videoAllowed = nativeVideo || vision;

  const notes: string[] = [];
  if (!vision) notes.push("이미지를 인식하지 못하는 모델입니다");
  if (!nativeVideo && vision) notes.push("동영상은 프레임을 뽑아 이미지로 전달합니다");
  if (!pdf) notes.push("PDF를 지원하지 않아 텍스트 문서(txt·md)만 첨부할 수 있습니다");

  return {
    image: { allowed: vision, max: vision ? CHAT_MAX_IMAGES : 0 },
    video: { allowed: videoAllowed, max: videoAllowed ? (nativeVideo ? CHAT_MAX_VIDEOS : 1) : 0 },
    audio: { allowed: audio, max: audio ? CHAT_MAX_AUDIOS : 0 },
    doc: { allowed: true, max: CHAT_MAX_DOCS },
    videoNative: nativeVideo,
    frameCount: VIDEO_FRAME_COUNT,
    pdfAllowed: pdf,
    docAccept: pdf ? ".pdf,.txt,.md,text/plain,text/markdown,application/pdf" : ".txt,.md,text/plain,text/markdown",
    note: notes.length > 0 ? `${notes.join(" · ")}.` : null,
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
 * 카탈로그가 max_items 를 싣지 않은 모델의 기본 허용 장수. 공식 Image API 의
 * input_reference_constraints 예시 값(4)을 그대로 씁니다.
 */
const DEFAULT_MAX_REFERENCES = 4;

export function resolveImageAttachmentPolicy(model: NormalizedModel | null): ImageAttachmentPolicy {
  // null(미공개)이면 막지 않고 기본값을 씁니다. 지원하지 않는 모델은 API가
  // input_references 를 무시하거나 오류로 알려 줍니다.
  const max = model ? (model.maxInputReferences ?? DEFAULT_MAX_REFERENCES) : 0;
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
}

/*
 * 영상 모델은 supported_parameters 로 입력 방식을 판정하되, 카탈로그가 아무
 * 정보도 싣지 않은 모델(null)은 막지 않고 허용합니다. 지원하지 않는 모델에
 * 이미지를 보내면 NanoGPT가 해당 필드를 무시하거나 오류 메시지를 돌려주므로,
 * 첨부 자체를 막아 실제로 되는 모델까지 못 쓰게 하는 쪽이 더 나쁩니다.
 */
export function resolveVideoAttachmentPolicy(model: NormalizedModel | null): VideoAttachmentPolicy {
  if (!model) {
    return { startImage: { allowed: false, max: 0 }, sourceVideo: { allowed: false, max: 0 } };
  }
  const startAllowed = model.acceptsStartImage ?? true;
  const sourceAllowed = model.acceptsSourceVideo ?? false;
  return {
    startImage: {
      allowed: startAllowed,
      max: startAllowed ? Math.max(1, model.maxInputReferences ?? 1) : 0,
    },
    sourceVideo: { allowed: sourceAllowed, max: sourceAllowed ? 1 : 0 },
  };
}

export interface AudioAttachmentPolicy {
  image: AttachmentSlot;
  video: AttachmentSlot;
  doc: AttachmentSlot;
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
