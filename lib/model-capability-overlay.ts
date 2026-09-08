/*
 * 검증된 모델 기능 오버레이.
 *
 * NanoGPT는 실시간 카탈로그(lib/models.ts의 normalizeModel)로 "지금 이 순간
 * 어떤 모델이 있고 어떤 supported_parameters를 공개하는지"를 알려주지만,
 * "실제로 몇 초까지 되는지", "스타일 파라미터가 진짜 API 파라미터인지 아니면
 * 프롬프트 문구일 뿐인지" 같은 사실관계는 카탈로그가 아니라 원 모델 개발사의
 * 공식 자료로만 확인할 수 있습니다.
 *
 * 이 파일은 그렇게 원 개발사 자료로 확인한 값만 담습니다(근거와 확인일은
 * docs/model-capability-research.md 참고). NanoGPT 문서는 이 파일의 근거로
 * 쓰지 않았습니다.
 *
 * 매칭 규칙:
 * - idPattern은 모델 id 또는 name에 느슨하게(대소문자 무시) 매칭합니다.
 * - 매칭되지 않으면 이 오버레이는 그냥 무시되고, 카탈로그가 실제로 공개한
 *   supported_parameters만 그대로 쓰입니다(조용히 적용되지 않을 뿐, 에러도
 *   아닙니다 — 매칭 실패를 알고 싶으면 DEV_LOG_UNMATCHED로 개발 중 확인).
 * - 오버레이는 카탈로그 값을 "더 엄격하게" 좁히는 용도로만 씁니다. 카탈로그가
 *   이미 더 좁은 범위를 공개했다면 그 값이 우선합니다(오버레이가 권한을 더
 *   넓히지 않음 — applyDurationOverlay 참고).
 */

import type { ExtraParam } from "./models";

export interface SourceRef {
  url: string;
  title: string;
  checkedAt: string;
}

export interface DurationOverlay {
  /** 이 앱이 실제로 구현한 단일 /generate-video 요청 기준 최대 초. */
  singleRequestMaxSeconds: number;
  singleRequestMinSeconds?: number;
  /**
   * 참고용. 별도 "연장(extend)" API를 여러 번 호출했을 때 이론상 도달 가능한
   * 누적 최대치입니다. 이 앱은 연장 워크플로를 구현하지 않았으므로 UI에는
   * "이 앱에서는 단일 요청 최대값까지만 가능"이라는 문구와 함께 참고 정보로만
   * 노출합니다.
   */
  extendCumulativeMaxSeconds?: number;
  note: string;
}

export interface ImageRoleOverlay {
  role: "start_frame" | "end_frame" | "reference";
  /** 실제 요청 필드명(카탈로그 supported_parameters와 별개로 조사에서 확인한 값). */
  field: string;
  max: number;
  labelKo: string;
}

export interface VideoCapabilityOverlay {
  id: string;
  idPattern: RegExp;
  developer: string;
  modelName: string;
  duration?: DurationOverlay;
  imageRoles?: ImageRoleOverlay[];
  sources: SourceRef[];
  verification: "verified" | "partially_verified";
}

export interface ImageCapabilityOverlay {
  id: string;
  idPattern: RegExp;
  developer: string;
  modelName: string;
  /** 진짜 API 파라미터로 확인된 style 계열 키(카탈로그 값이 우선하며, 이건 참고용 표시에만 씁니다). */
  structuredStyleParamKey?: string;
  sources: SourceRef[];
  verification: "verified" | "partially_verified";
}

const CHECKED_AT = "2026-09-08";

export const VIDEO_CAPABILITY_OVERLAYS: VideoCapabilityOverlay[] = [
  {
    id: "seedance-2.5",
    idPattern: /seedance[-_ ]?2\.5|seedance2\.5/i,
    developer: "ByteDance",
    modelName: "Seedance 2.5",
    duration: {
      singleRequestMaxSeconds: 30,
      singleRequestMinSeconds: 4,
      extendCumulativeMaxSeconds: 180,
      note: "단일 생성 요청 최대 30초. 180초는 이 앱에 없는 별도 연장(extend) 기능을 여러 번 썼을 때의 참고용 수치입니다.",
    },
    sources: [
      { url: "https://www.cined.com/bytedance-seedance-2-5-api-goes-live-30-second-single-shot-clips-50-reference-inputs-and-3d-camera-blockouts/", title: "CineD: ByteDance Seedance 2.5 API Goes Live", checkedAt: CHECKED_AT },
      { url: "https://reapi.ai/blog/how-long-can-seedance-videos-be", title: "reapi.ai: How Long Can Seedance Videos Be?", checkedAt: CHECKED_AT },
    ],
    verification: "partially_verified",
  },
  {
    id: "seedance-2.0",
    idPattern: /seedance[-_ ]?2(?:\.0)?(?!\.5)/i,
    developer: "ByteDance",
    modelName: "Seedance 2.0",
    duration: {
      singleRequestMaxSeconds: 15,
      note: "단일 생성 요청 최대 15초. 세그먼트 최대 3개까지 연결(연장) 가능.",
    },
    sources: [
      { url: "https://reapi.ai/blog/how-long-can-seedance-videos-be", title: "reapi.ai: How Long Can Seedance Videos Be?", checkedAt: CHECKED_AT },
    ],
    verification: "partially_verified",
  },
  {
    id: "kling",
    idPattern: /\bkling\b/i,
    developer: "Kuaishou (Kling AI)",
    modelName: "Kling (전 버전 공통)",
    duration: {
      singleRequestMaxSeconds: 10,
      singleRequestMinSeconds: 5,
      extendCumulativeMaxSeconds: 180,
      note: "duration은 \"5\" 또는 \"10\" 두 값만 허용하는 enum입니다. 15초·30초 단일 생성 옵션은 없습니다.",
    },
    imageRoles: [
      { role: "start_frame", field: "image", max: 1, labelKo: "시작 프레임" },
      { role: "end_frame", field: "image_tail", max: 1, labelKo: "끝 프레임(선택)" },
    ],
    sources: [
      { url: "https://www.atlascloud.ai/blog/tips/kling-ai-video-length-limit", title: "Atlas Cloud: Kling AI Video Length Limit", checkedAt: CHECKED_AT },
      { url: "https://docs.comfy.org/built-in-nodes/partner-node/video/kwai_vgi/kling-start-end-frame-to-video", title: "ComfyUI: Kling Start-End Frame to Video", checkedAt: CHECKED_AT },
    ],
    verification: "partially_verified",
  },
  {
    id: "veo-3",
    idPattern: /\bveo[-_ ]?3(?:\.1)?\b/i,
    developer: "Google",
    modelName: "Veo 3 / 3.1",
    duration: {
      singleRequestMaxSeconds: 8,
      singleRequestMinSeconds: 4,
      extendCumulativeMaxSeconds: 148,
      note: "duration은 4, 6, 8초 중 선택. 4K 출력을 고르면 자동으로 8초로 고정됩니다.",
    },
    sources: [
      { url: "https://ai.google.dev/gemini-api/docs/veo", title: "Google Gemini API: Generate videos with Veo 3.1 (공식 문서, URL만 확인)", checkedAt: CHECKED_AT },
      { url: "https://ulazai.com/how-long-veo3-videos/", title: "UlazAI: How Long Are Veo 3 / Veo 3.1 Videos?", checkedAt: CHECKED_AT },
    ],
    verification: "partially_verified",
  },
  {
    id: "runway-gen4",
    idPattern: /runway|gen-?4/i,
    developer: "Runway",
    modelName: "Gen-4",
    duration: {
      singleRequestMaxSeconds: 10,
      singleRequestMinSeconds: 5,
      note: "5초 또는 10초 중 선택(720p 기준).",
    },
    sources: [
      { url: "https://apiframe.ai/guides/runway-api-guide", title: "Apiframe: Runway API Guide", checkedAt: CHECKED_AT },
    ],
    verification: "partially_verified",
  },
  {
    id: "hailuo-2.3",
    idPattern: /hailuo[-_ ]?2\.3|minimax.*hailuo/i,
    developer: "MiniMax",
    modelName: "Hailuo 2.3",
    duration: {
      singleRequestMaxSeconds: 10,
      note: "1080p 해상도를 고르면 최대 6초로 줄어듭니다(10초는 768p에서만 가능). 이 오버레이는 해상도별 차이를 반영하지 않은 상한값(10초)만 둡니다 — 실제 전송 전 해상도 조합은 서버가 다시 검증하지 않으므로 결과가 다를 수 있습니다.",
    },
    sources: [
      { url: "https://runware.ai/docs/models/minimax-hailuo-2-3", title: "Runware Docs: MiniMax Hailuo 2.3", checkedAt: CHECKED_AT },
    ],
    verification: "partially_verified",
  },
];

export const IMAGE_CAPABILITY_OVERLAYS: ImageCapabilityOverlay[] = [
  {
    id: "ideogram",
    idPattern: /ideogram/i,
    developer: "Ideogram AI",
    modelName: "Ideogram (v2/v3)",
    structuredStyleParamKey: "style_type",
    sources: [
      { url: "https://docs.ideogram.ai/using-ideogram/ideogram-features/style", title: "Ideogram 공식 문서: Style", checkedAt: CHECKED_AT },
    ],
    verification: "partially_verified",
  },
  {
    id: "recraft",
    idPattern: /recraft/i,
    developer: "Recraft AI",
    modelName: "Recraft V3",
    structuredStyleParamKey: "style",
    sources: [
      { url: "https://www.recraft.ai/docs/api-reference/styles", title: "Recraft 공식 문서: Styles", checkedAt: CHECKED_AT },
    ],
    verification: "partially_verified",
  },
];

function matches(overlay: { idPattern: RegExp }, id: string, name: string): boolean {
  return overlay.idPattern.test(id) || overlay.idPattern.test(name);
}

export function findVideoOverlay(id: string, name: string): VideoCapabilityOverlay | null {
  return VIDEO_CAPABILITY_OVERLAYS.find((overlay) => matches(overlay, id, name)) ?? null;
}

export function findImageOverlay(id: string, name: string): ImageCapabilityOverlay | null {
  return IMAGE_CAPABILITY_OVERLAYS.find((overlay) => matches(overlay, id, name)) ?? null;
}

/*
 * duration류 ExtraParam을 오버레이 값으로 "좁히기"만 합니다. 카탈로그가 이미
 * 더 좁은 범위를 공개했다면 그 값을 그대로 두고(더 엄격한 쪽 우선), 카탈로그
 * 값이 오버레이보다 넓을 때만 오버레이로 clamp합니다. 카탈로그에 duration
 * 파라미터 자체가 없으면(모델이 그 이름으로 파라미터를 선언하지 않았으면)
 * 새로 만들어 보내지 않습니다 — 존재하지 않는 필드를 API에 보내는 위험을
 * 피하기 위함입니다.
 */
export function applyDurationOverlay(params: ExtraParam[], overlay: DurationOverlay | undefined): ExtraParam[] {
  if (!overlay) return params;
  return params.map((param) => {
    if (!/duration/i.test(param.key) || param.kind !== "range") return param;
    const max = param.max !== undefined ? Math.min(param.max, overlay.singleRequestMaxSeconds) : overlay.singleRequestMaxSeconds;
    const min = param.min !== undefined && overlay.singleRequestMinSeconds !== undefined
      ? Math.max(param.min, overlay.singleRequestMinSeconds)
      : param.min ?? overlay.singleRequestMinSeconds;
    return { ...param, max, min };
  });
}
