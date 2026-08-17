import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI 올인원 플랫폼",
    template: "%s · AI 올인원 플랫폼",
  },
  description: "채팅, 이미지, 영상, 음성 생성을 하나의 스튜디오에서 다루는 AI 작업 공간입니다.",
  applicationName: "AI 올인원 플랫폼",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fd" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f1a" },
  ],
};

/*
 * 첫 페인트 전에 테마를 확정해 깜빡임을 막습니다.
 * 저장된 선택이 없으면 이 스튜디오의 기본값인 다크로 시작하고,
 * 사용자가 "시스템"을 고르면 그때부터 OS 설정을 따릅니다.
 */
const themeScript = `(function () {
  try {
    var theme = localStorage.getItem("theme") || "dark";
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      document.documentElement.style.colorScheme = "";
    } else if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      document.documentElement.style.colorScheme = "light";
    }
  } catch (error) {
    // 서버가 이미 다크로 렌더링해 두었으므로 아무것도 하지 않아도 됩니다.
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * 서버에서부터 다크를 기본값으로 렌더링해 두고, 위 스크립트는 저장된 선택이
   * 다크가 아닐 때만 속성을 고칩니다. 그 순간의 차이는 하이드레이션 경고 대상이
   * 아니므로 <html> 에 한해 경고를 억제합니다.
   */
  return (
    <html lang="ko" data-theme="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
