/*
 * 이미지·영상 생성 모델의 supported_parameters 키/값을 한국어로 표시하기 위한
 * 사전입니다. NanoGPT 공식 문서와 각 모델 제공사(Kling, Veo, Hunyuan,
 * Seedance, Ideogram, Flux 등)의 공개 문서에서 확인한 값만 담았습니다. 사전에
 * 없는 키·값은 원문 그대로 보여줍니다(근거 없는 번역을 지어내지 않기 위함).
 */

export const PARAM_KEY_LABELS: Record<string, string> = {
  aspect_ratio: "비율",
  aspectratio: "비율",
  ratio: "비율",
  quality: "품질",
  style: "스타일",
  style_preset: "스타일",
  duration: "길이(초)",
  seconds: "길이(초)",
  resolution: "해상도",
  mode: "생성 방식",
  orientation: "화면 방향",
  rendering_speed: "렌더링 속도",
  fps: "프레임레이트",
  num_frames: "프레임 수",
  camera_fixed: "카메라 고정",
  pro_mode: "프로 모드(고품질·2배 비용)",
  negative_prompt: "네거티브 프롬프트",
  cfg_scale: "CFG 스케일(프롬프트 반영 강도)",
  guidance_scale: "가이던스 스케일(프롬프트 반영 강도)",
  num_inference_steps: "추론 스텝 수",
  seed: "시드",
  strength: "변형 강도",
  showexplicitcontent: "노출 콘텐츠 허용",
  show_explicit_content: "노출 콘텐츠 허용",
  safety_filter: "안전 필터",
  motion_strength: "움직임 강도",
  loop: "반복 재생",
  watermark: "워터마크",
};

/** 키별 값 → 한국어 표시. 값 자체가 모델마다 다를 수 있어 확인된 것만 넣습니다. */
export const PARAM_VALUE_LABELS: Record<string, Record<string, string>> = {
  quality: {
    low: "낮음",
    medium: "보통",
    high: "높음",
    standard: "표준",
    hd: "고화질(HD)",
    "1k": "1K",
    "2k": "2K",
    "4k": "4K",
  },
  style: {
    anime: "일본 애니메이션",
    "anime-style": "일본 애니메이션",
    manga: "만화(망가)",
    photorealistic: "초사실적",
    "photo-realistic": "초사실적",
    realistic: "사실적",
    cinematic: "영화적",
    "3d": "3D 렌더링",
    "3d-render": "3D 렌더링",
    "digital-art": "디지털 아트",
    digitalart: "디지털 아트",
    "concept-art": "컨셉 아트",
    watercolor: "수채화",
    oil_painting: "유화",
    "oil-painting": "유화",
    sketch: "스케치",
    "line-art": "선화",
    pixel_art: "픽셀 아트",
    "pixel-art": "픽셀 아트",
    fantasy: "판타지",
    cyberpunk: "사이버펑크",
    vibrant: "선명한 색감",
    natural: "자연스러운 색감",
    vivid: "강렬한 색감",
    none: "스타일 없음(원본)",
  },
  camera_fixed: {
    true: "고정",
    false: "고정 안 함",
  },
  pro_mode: {
    true: "사용",
    false: "사용 안 함",
  },
};

export function paramKeyLabel(key: string): string {
  return PARAM_KEY_LABELS[key.toLowerCase()] ?? key;
}

export function paramValueLabel(key: string, value: string): string {
  return PARAM_VALUE_LABELS[key.toLowerCase()]?.[value.toLowerCase()] ?? value;
}
