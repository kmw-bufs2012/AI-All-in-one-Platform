import type { IconName } from "./Icon";

export interface NavEntry {
  href: string;
  label: string;
  icon: IconName;
  accent?: string;
}

export interface ToolEntry extends NavEntry {
  description: string;
  accent: string;
}

/** 사이드바 CREATE 섹션 = 홈 대시보드의 생성 카드. 하나의 소스에서 함께 씁니다. */
export const TOOLS: ToolEntry[] = [
  {
    href: "/create/chat",
    label: "채팅",
    icon: "chat",
    accent: "var(--tool-chat)",
    description: "이미지·동영상·문서를 함께 올려 대화하고, 답변을 실시간으로 받아 봅니다.",
  },
  {
    href: "/create/image",
    label: "이미지",
    icon: "image",
    accent: "var(--tool-image)",
    description: "문장과 참조 이미지로 새 이미지를 만듭니다.",
  },
  {
    href: "/create/video",
    label: "영상",
    icon: "video",
    accent: "var(--tool-video)",
    description: "장면을 설명하거나 시작 이미지를 얹어 짧은 영상을 만듭니다.",
  },
  {
    href: "/create/audio",
    label: "음성",
    icon: "audio",
    accent: "var(--tool-audio)",
    description: "문장을 골라둔 목소리로 읽어 음성 파일을 만듭니다.",
  },
];

/** 사이드바 ASSETS 섹션. 생성물과 작업 이력을 다루는 화면들입니다. */
export const ASSETS: NavEntry[] = [
  { href: "/library", label: "라이브러리", icon: "library" },
  { href: "/history", label: "작업 기록", icon: "history" },
  { href: "/prompts", label: "프롬프트", icon: "prompt" },
];

/** 브레드크럼 표기. 경로 → [상위, 현재] */
export const BREADCRUMBS: Record<string, [string, string] | [string]> = {
  "/": ["홈"],
  "/create/chat": ["만들기", "채팅"],
  "/create/image": ["만들기", "이미지"],
  "/create/video": ["만들기", "영상"],
  "/create/audio": ["만들기", "음성"],
  "/library": ["라이브러리", "전체 자산"],
  "/history": ["기록", "작업 기록"],
  "/prompts": ["기록", "프롬프트"],
};
