import type { NormalizedModel } from "./models";

/*
 * 모델별 첨부 가능 개수 정책. Venice.ai 공식 OpenAPI 스키마(swagger.yaml,
 * 2026-08-14)와 공식 가이드(Vision / File Inputs)를 근거로 계산합니다.
 *
 * 채팅 모델(model_spec.capabilities):
 * - supportsVision — 이미지를 이해하는지 여부.
 * - supportsMultipleImages + maxImages — 한 요청에 여러 장을 보낼 수 있는지와
 *   최대 개수. 단일 이미지 모델은 "only the last image-containing message
 *   retains its images"이므로 상한 1장.
 * - supportsVideoInput + maxVideos — 동영상(video_url) 입력 지원 여부와 최대
 *   개수. 단, API 차원 상한 "At most 3 videos may be provided in one request"
 *   가 있으므로 min(maxVideos, 3)으로 적용.
 * - file 콘텐츠 파트는 서버 측에서 텍스트로 추출해 전달하는 방식이라 모델의
 *   비전 능력과 무관하게 모든 채팅 모델에 동일하게 적용됩니다. 공식 가이드에
 *   "You can include more than one file block"로 개수 제한이 없고 파일당 25MB
 *   제한만 있으므로, 5개는 이 앱의 안전 상한입니다.
 *
 * 이미지 생성 모델(model_spec):
 * - supportsStyleReferences + maxStyleReferences — POST /image/generate 의
 *   style_references 수용 여부와 최대 개수. 필드가 없으면 공식 multi-edit
 *   기본값(3)을 legacy 폴백으로 사용합니다. 참조 이미지는 1장당 8MB 미만.
 *
 * 영상 생성 모델(constraints.model_type):
 * - "image-to-video" 모델만 QueueVideoRequest.image_url(시작 이미지)를 받습니다.
 *
 * TTS 모델: CreateSpeechRequestSchema에 첨부 필드가 아예 없어서(입력은 텍스트
 * 4096자) 모든 첨부가 불가합니다.
 */

export interface AttachmentSlot {
  allowed: boolean;
  max: number;
}

export interface ChatAttachmentPolicy {
  image: AttachmentSlot;
  video: AttachmentSlot;
  doc: AttachmentSlot;
  /** true면 video_url 콘텐츠 파트를 그대로 전송. false면 비전 모델용 프레임 추출 방식. */
  videoNative: boolean;
  /** 프레임 추출 방식일 때 첨부된 동영상 1개에서 뽑아 함께 보낼 프레임 수. */
  frameCount: number;
  /** 이미지를 인식하지만 한 번에 1장만 처리하는 모델일 때 보여줄 안내 문구. */
  singleImageNote: string | null;
}

const MAX_IMAGES = 10;
const API_VIDEO_LIMIT = 3;
const MULTI_IMAGE_FRAME_COUNT = 6;
const SINGLE_IMAGE_FRAME_COUNT = 1;
const MAX_DOCS = 5;

export function resolveChatAttachmentPolicy(model: NormalizedModel | null): ChatAttachmentPolicy {
  const vision = model?.lmm ?? false;
  const multi = model?.supportsMultipleImages ?? false;
  const nativeVideo = model?.chatVideoInput ?? false;

  const imageMax = vision ? Math.min(Math.max(model?.maxImages ?? MAX_IMAGES, 1), MAX_IMAGES) : 0;
  const videoMax = nativeVideo
    ? Math.min(Math.max(model?.maxVideos ?? API_VIDEO_LIMIT, 1), API_VIDEO_LIMIT)
    : vision ? 1 : 0;

  return {
    image: { allowed: vision, max: imageMax },
    video: { allowed: vision || nativeVideo, max: videoMax },
    doc: { allowed: true, max: MAX_DOCS },
    videoNative: nativeVideo,
    frameCount: multi ? MULTI_IMAGE_FRAME_COUNT : SINGLE_IMAGE_FRAME_COUNT,
    singleImageNote: vision && !multi
      ? "이 모델은 이미지를 한 번에 1장만 인식합니다. 새로 첨부하면 이전 이미지는 전달되지 않습니다."
      : null,
  };
}

export interface ImageAttachmentPolicy {
  reference: AttachmentSlot;
}

/*
 * style_references는 공식 스키마에서 "Only supported by models with
 * `supportsStyleReferences: true`"이며, 개별 모델 상한은 maxStyleReferences로
 * 공개됩니다. 필드가 없는 모델은 공식 문서상 미지원이지만, 구형 API 응답에서는
 * 필드 자체가 빠질 수 있어 legacy 폴백(기존 동작: 허용, 3장)을 둡니다.
 */
export function resolveImageAttachmentPolicy(model: NormalizedModel | null): ImageAttachmentPolicy {
  const supported = model ? (model.supportsStyleReferences ?? true) : false;
  const max = model ? Math.min(Math.max(model.maxStyleReferences ?? 3, 1), 10) : 0;
  return { reference: { allowed: supported, max } };
}

export interface VideoAttachmentPolicy {
  startImage: AttachmentSlot;
}

export function resolveVideoAttachmentPolicy(model: NormalizedModel | null): VideoAttachmentPolicy {
  return { startImage: { allowed: model?.supportsVideoInput ?? false, max: 1 } };
}

export interface AudioAttachmentPolicy {
  image: AttachmentSlot;
  video: AttachmentSlot;
  doc: AttachmentSlot;
}

export function resolveAudioAttachmentPolicy(): AudioAttachmentPolicy {
  return {
    image: { allowed: false, max: 0 },
    video: { allowed: false, max: 0 },
    doc: { allowed: false, max: 0 },
  };
}