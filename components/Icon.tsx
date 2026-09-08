/*
 * 라인 스타일 아이콘 세트. 외부 아이콘 패키지를 추가하지 않기 위해 필요한 글리프만
 * 직접 그려서 사용합니다. 모두 24 그리드에 1.6 스트로크로 통일했습니다.
 */

export type IconName =
  | "home"
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "library"
  | "history"
  | "prompt"
  | "sun"
  | "moon"
  | "monitor"
  | "menu"
  | "arrowRight"
  | "arrowUp"
  | "plus"
  | "close"
  | "download"
  | "expand"
  | "refresh"
  | "grid"
  | "sparkle"
  | "ratio"
  | "quality"
  | "clock"
  | "voice"
  | "logout"
  | "check"
  | "search"
  | "doc"
  | "chevronDown";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" />,
  chat: <path d="M20 12a7 7 0 0 1-7 7H8l-4 3v-4.6A7 7 0 0 1 11 5h2a7 7 0 0 1 7 7z" />,
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m4 17 4.8-4.6a2 2 0 0 1 2.7 0L20 19" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5.5" width="12.5" height="13" rx="2.5" />
      <path d="m15.5 10.5 5-3v9l-5-3z" />
    </>
  ),
  audio: (
    <>
      <path d="M9 17V5.5l10-2V15" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </>
  ),
  library: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V9H8" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  prompt: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M7.5 9.5h9M7.5 13.5h6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 13.4A8.2 8.2 0 0 1 10.6 4a8.5 8.5 0 1 0 9.4 9.4z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2.2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  arrowRight: <path d="M5 12h13m-5-5 5 5-5 5" />,
  arrowUp: <path d="M12 19V5m-6 6 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  download: <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14" />,
  expand: <path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20.5 4v4.5H16" />
    </>
  ),
  grid: (
    <>
      <path d="M3.5 9.5h17M3.5 15h17M9 3.5v17M15 3.5v17" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    </>
  ),
  sparkle: <path d="M12 4.5 13.7 9l4.5 1.7-4.5 1.7L12 17l-1.7-4.6L5.8 10.7 10.3 9zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />,
  ratio: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
      <path d="M8 5.5v13M3.5 12h4.5" />
    </>
  ),
  quality: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
      <path d="M7.5 15V9M7.5 9h2.2a2 2 0 0 1 0 4H7.5M14 9v6h3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 1.9" />
    </>
  ),
  voice: (
    <>
      <rect x="9" y="3" width="6" height="10.5" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  logout: <path d="M14.5 8V5.5a1.5 1.5 0 0 0-1.5-1.5H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h7a1.5 1.5 0 0 0 1.5-1.5V16M10 12h10m-3.5-3.5L20 12l-3.5 3.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  doc: (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
