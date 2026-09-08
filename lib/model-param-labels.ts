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
  // Ideogram 공식 문서에서 확인된 실제 파라미터 이름입니다.
  style_type: "스타일",
  duration: "길이(초)",
  seconds: "길이(초)",
  resolution: "해상도",
  size: "해상도·비율",
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
  motionmode: "움직임 속도",
  movementamplitude: "움직임 강도",
  movement_amplitude: "움직임 강도",
  effect: "특수 효과",
  effecttype: "효과 종류",
  cameramovement: "카메라 움직임",
  soundeffectswitch: "효과음 생성",
  soundeffectprompt: "효과음 설명",
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
    general: "일반(프롬프트로 스타일 지정)",
    common: "일반 영상",
    // Ideogram 공식 문서(style_type)에서 확인된 정확한 값입니다.
    // 출처: docs/model-capability-research.md, docs.ideogram.ai
    auto: "자동(프롬프트에 맞춰 선택)",
    design: "디자인(로고·인쇄물)",
    render_3d: "3D 렌더링",
    // Recraft 공식 문서(style)에서 확인된 정확한 값입니다.
    // 출처: docs/model-capability-research.md, recraft.ai/docs
    realistic_image: "실사 이미지",
    digital_illustration: "디지털 일러스트",
    vector_illustration: "벡터 일러스트",
    icon: "아이콘",
    logo_raster: "로고(래스터)",
    anime: "일본 애니메이션",
    "anime-style": "일본 애니메이션",
    manga: "만화(망가)",
    photorealistic: "초사실적",
    "photo-realistic": "초사실적",
    realistic: "사실적",
    cinematic: "영화적",
    "3d": "3D 렌더링",
    "3d-render": "3D 렌더링",
    "3d_animation": "3D 애니메이션",
    clay: "클레이 애니메이션",
    comic: "코믹북",
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
    ugc: "사용자 제작 영상(UGC)",
    short_series: "숏폼 드라마",
    aigc: "AI 생성 영상",
    old_film: "기록·고전 필름",
  },
  rendering_speed: {
    flash: "초고속",
    turbo: "고속",
    balanced: "균형",
    default: "기본",
    quality: "고품질",
  },
  effect: {
    none: "사용 안 함",
  },
  effecttype: {
    none: "사용 안 함",
    effect: "특수 효과",
    cameramovement: "카메라 움직임",
  },
  cameramovement: {
    horizontal_left: "수평 왼쪽 이동",
    horizontal_right: "수평 오른쪽 이동",
    vertical_up: "위로 이동",
    vertical_down: "아래로 이동",
    zoom_in: "확대",
    zoom_out: "축소",
    crane_up: "크레인 상승",
    quickly_zoom_in: "빠르게 확대",
    quickly_zoom_out: "빠르게 축소",
    smooth_zoom_in: "부드럽게 확대",
    camera_rotation: "카메라 회전",
    robo_arm: "로봇 암 이동",
    super_dolly_out: "강한 돌리 아웃",
    whip_pan: "빠른 휩 팬",
    hitchcock: "히치콕 줌",
    left_follow: "왼쪽 추적",
    right_follow: "오른쪽 추적",
    pan_left: "왼쪽 팬",
    pan_right: "오른쪽 팬",
    fix_bg: "배경 고정",
  },
  motionmode: {
    normal: "보통",
    fast: "빠름",
  },
  soundeffectswitch: {
    true: "사용",
    false: "사용 안 함",
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

// style_type · style_preset은 실제로는 전부 같은 "스타일" 값 사전을 쓰므로
// value 사전 조회 시 style로 대체합니다(키 이름만 모델마다 다를 뿐 값의
// 의미는 같습니다 — 예: Ideogram의 style_type=ANIME도 "일본 애니메이션"으로 표시).
const VALUE_LOOKUP_KEY_ALIASES: Record<string, string> = {
  style_type: "style",
  style_preset: "style",
};

export function paramValueLabel(key: string, value: string): string {
  const lookupKey = VALUE_LOOKUP_KEY_ALIASES[key.toLowerCase()] ?? key.toLowerCase();
  return PARAM_VALUE_LABELS[lookupKey]?.[value.toLowerCase()] ?? value;
}

/*
 * 프롬프트 기반 스타일 프리셋.
 *
 * 이미지 모델이 API 파라미터로 진짜 style을 받는지(구조화 — 예: Ideogram의
 * style_type, Recraft의 style)는 모델마다 다르고, 카탈로그가 그런 파라미터를
 * 공개하지 않은 모델(예: Flux·Stable Diffusion 계열 다수)에는 존재하지도
 * 않는 필드를 보낼 수 없습니다. 그런 모델은 스타일을 프롬프트 문구로
 * 유도하는 것이 일반적인 사용법입니다.
 *
 * 이 목록은 그 프롬프트 문구 도우미입니다 — "이 모델이 이 스타일을 지원한다"는
 * 검증된 사실이 아니라, 프롬프트에 자연스럽게 덧붙일 수 있는 문구 모음입니다.
 * API 파라미터가 아니라 프롬프트 텍스트에만 반영되므로, 모델이 실제로 그
 * 스타일을 얼마나 잘 표현하는지는 모델 성능에 달려 있습니다. UI에서는 반드시
 * "프롬프트에 반영됩니다"라고 표시해 구조화 파라미터와 혼동하지 않게 합니다.
 */
export interface PromptStylePreset {
  value: string;
  labelKo: string;
  /** 프롬프트 끝에 그대로 덧붙이는 영문 문구. */
  promptPhrase: string;
}

export const PROMPT_STYLE_PRESETS: PromptStylePreset[] = [
  { value: "anime", labelKo: "일본 애니메이션", promptPhrase: "Japanese anime style, cel-shaded illustration" },
  { value: "photorealistic", labelKo: "초사실적", promptPhrase: "photorealistic, highly detailed, realistic lighting" },
  { value: "cinematic", labelKo: "영화적", promptPhrase: "cinematic lighting, dramatic composition, film still" },
  { value: "3d-render", labelKo: "3D 렌더링", promptPhrase: "3D render, octane render, subsurface scattering" },
  { value: "digital-art", labelKo: "디지털 아트", promptPhrase: "digital art, concept art style" },
  { value: "watercolor", labelKo: "수채화", promptPhrase: "watercolor painting, soft brush strokes" },
  { value: "oil-painting", labelKo: "유화", promptPhrase: "oil painting, thick brush strokes, canvas texture" },
  { value: "sketch", labelKo: "스케치", promptPhrase: "pencil sketch, line art, hand-drawn" },
  { value: "pixel-art", labelKo: "픽셀 아트", promptPhrase: "pixel art, 8-bit style" },
  { value: "cyberpunk", labelKo: "사이버펑크", promptPhrase: "cyberpunk aesthetic, neon lights, futuristic" },
  { value: "fantasy", labelKo: "판타지", promptPhrase: "fantasy art style, ethereal atmosphere" },
];
