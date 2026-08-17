export interface ModelDocSection {
  title: string;
  items: string[];
}

export interface ModelDocInfo {
  intro: string;
  sections: ModelDocSection[];
  sourceLabel: string;
  sourceUrl: string;
}

// Venice.ai 공식 문서(docs.venice.ai)의 모델 카테고리 설명을 근거로 작성되었습니다.
export const MODEL_DOCS: Record<"chat" | "image" | "video" | "audio", ModelDocInfo> = {
  chat: {
    intro:
      "텍스트 모델은 채팅, 추론, 코드 생성에 사용되며 OpenAI 호환 /chat/completions 엔드포인트로 호출합니다.",
    sections: [
      {
        title: "주요 기능",
        items: [
          "Function Calling — 모델이 도구와 외부 API를 호출할 수 있습니다.",
          "Reasoning — 복잡한 문제 해결을 위해 확장된 사고 과정을 거칩니다.",
          "Vision(LMM) — 텍스트 프롬프트와 함께 이미지를 분석할 수 있습니다.",
          "Code — 코드 생성 및 이해에 최적화되어 있습니다.",
        ],
      },
    ],
    sourceLabel: "Venice API Docs · Text Models",
    sourceUrl: "https://docs.venice.ai/models/text",
  },
  image: {
    intro:
      "이미지 모델은 텍스트-투-이미지 생성, 이미지 편집(인페인팅), 업스케일링 세 가지 유형으로 나뉘며, /image/generate 요청은 동기(synchronous) 방식으로 처리되어 같은 응답에서 바로 결과 이미지를 받습니다.",
    sections: [
      {
        title: "모델 유형",
        items: [
          "Generation — 텍스트 프롬프트로 새 이미지를 생성합니다. (Image Generate API)",
          "Upscale — 기존 이미지의 해상도와 품질을 향상시킵니다. (Upscale API)",
          "Edit — 인페인팅으로 기존 이미지의 일부를 수정합니다. (Edit API)",
        ],
      },
      {
        title: "크기 지정 방식 (모델마다 다름)",
        items: [
          "픽셀 기반 — venice-sd35, qwen-image 등은 width/height 값을 사용합니다.",
          "종횡비 기반 — qwen-image-2 등은 aspect_ratio 값을 사용합니다.",
          "해상도 등급 — gpt-image-2, nano-banana-pro 등은 aspect_ratio와 함께 1K/2K/4K 같은 resolution 값을 사용합니다.",
        ],
      },
      {
        title: "참고",
        items: [
          "gpt-image-2, gpt-image-2-edit는 quality(low/medium/high) 옵션을 지원하며, 낮은 등급일수록 비용이 저렴합니다.",
          "style_preset을 사용하려면 먼저 GET /image/styles로 사용 가능한 스타일 목록(예: 3D Model, Anime, Cinematic 등)을 확인해야 합니다.",
        ],
      },
    ],
    sourceLabel: "Venice API Docs · Image Models & Image Generation Guide",
    sourceUrl: "https://docs.venice.ai/models/image",
  },
  video: {
    intro:
      "영상 모델은 텍스트-투-비디오, 이미지-투-비디오, 비디오 업스케일링(Topaz 기반)을 지원하며, 생성/업스케일링 모두 비동기 큐(queue) 시스템으로 처리됩니다.",
    sections: [
      {
        title: "모델 유형",
        items: [
          "Text to Video — 텍스트 프롬프트로 영상을 생성합니다.",
          "Image to Video — 정적 이미지를 영상 클립으로 애니메이션화합니다.",
          "Video Upscaling — AI 기반 업스케일링으로 기존 영상의 해상도를 향상시킵니다.",
        ],
      },
      {
        title: "동작 방식",
        items: [
          "생성 요청은 Video Queue API로 큐에 등록한 뒤, Video Retrieve API로 완료 여부와 결과를 폴링(polling)해서 가져옵니다. (이 앱의 '영상 생성' 버튼도 동일한 방식으로 동작합니다.)",
          "가격은 길이·해상도·오디오 포함 여부에 따라 달라지며, 일부 모델은 FIXED(정액) 요금이 적용됩니다.",
          "생성 전 정확한 예상 비용은 Video Quote API로 확인할 수 있습니다.",
        ],
      },
    ],
    sourceLabel: "Venice API Docs · Video Models",
    sourceUrl: "https://docs.venice.ai/models/video",
  },
  audio: {
    intro:
      "Text-to-Speech(TTS) 모델은 다국어 음성을 지원하며 OpenAI 호환 /audio/speech 엔드포인트로 스트리밍 오디오를 생성합니다.",
    sections: [
      {
        title: "음성(voice) 선택 시 주의사항",
        items: [
          "음성은 모델별로 다른 카탈로그를 가집니다. 예: tts-kokoro 모델은 af_sky, af_bella, am_adam 같은 보이스를 제공합니다.",
          "voice ID는 대소문자를 구분하며, 반드시 함께 선택한 model과 짝이 맞는 값이어야 합니다.",
          "모델을 변경하면 voice도 해당 모델의 카탈로그에서 다시 선택해야 합니다.",
        ],
      },
    ],
    sourceLabel: "Venice API Docs · Text-to-Speech Models",
    sourceUrl: "https://docs.venice.ai/models/text-to-speech",
  },
};
