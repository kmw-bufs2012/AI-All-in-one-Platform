import type { NormalizedModel } from "./models";

/*
 * 모델별 첨부 가능 개수 정책. Venice.ai의 model_spec.capabilities 로 실제 공개되는
 * 값만 근거로 삼습니다(추측으로 채우지 않음). 확인한 사실:
 *
 * - capabilities.supportsVision — 이미지를 아예 이해하는지 여부.
 * - capabilities.supportsMultipleImages — 메시지 하나에 이미지를 여러 장 보내도
 *   전부 인식하는지 여부. false인 모델은 Venice가 "마지막 이미지 하나만" 실제로
 *   모델에 전달하고 나머지는 버립니다(Venice 공식 문서: 여러 image_url 파트를
 *   보내도 호환성을 위해 형식만 받아줄 뿐, 처리되는 건 마지막 한 장뿐).
 * - 문서(txt/md/pdf 등) 첨부는 채팅 완료 엔드포인트가 서버 측에서 텍스트로
 *   추출해 전달하는 방식이라, 모델의 비전 능력과 무관하게 모든 채팅 모델에 동일하게
 *   적용됩니다(Venice가 모델별로 문서 지원 여부를 별도로 공개하지 않음).
 */

export interface AttachmentSlot {
  allowed: boolean;
  max: number;
}

export interface ChatAttachmentPolicy {
  image: AttachmentSlot;
  video: AttachmentSlot;
  doc: AttachmentSlot;
  /** 첨부된 동영상 1개에서 뽑아 함께 보낼 프레임 수. */
  frameCount: number;
  /** 이미지를 인식하지만 한 번에 1장만 처리하는 모델일 때 보여줄 안내 문구. */
  singleImageNote: string | null;
}

const MAX_IMAGES = 10;
const MULTI_IMAGE_FRAME_COUNT = 6;
const SINGLE_IMAGE_FRAME_COUNT = 1;
const MAX_DOCS = 1;

export function resolveChatAttachmentPolicy(model: NormalizedModel | null): ChatAttachmentPolicy {
  const vision = model?.lmm ?? false;
  const multi = model?.supportsMultipleImages ?? false;

  return {
    image: { allowed: vision, max: vision ? (multi ? MAX_IMAGES : 1) : 0 },
    // 동영상은 첨부 즉시 프레임을 뽑아 이미지로 보내는 방식이라 비전 지원이 곧 전제 조건입니다.
    video: { allowed: vision, max: vision ? 1 : 0 },
    doc: { allowed: true, max: MAX_DOCS },
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
 * Venice의 이미지 생성 모델(model_spec.type: "image")은 참조 이미지 지원 여부나
 * 개수를 모델별로 공개하지 않습니다. 공식 SDK가 문서화하는 유일한 다중 이미지
 * 입력 경로인 image/multi_edit(기본 image + image_2 + image_3, 최대 3장)를
 * 근거로 모든 이미지 모델에 동일한 상한을 둡니다 — 모델별로 다르게 줄 근거가 없습니다.
 */
export function resolveImageAttachmentPolicy(): ImageAttachmentPolicy {
  return { reference: { allowed: true, max: 3 } };
}
