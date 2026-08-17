"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { ASSETS, BREADCRUMBS, TOOLS, type NavEntry } from "./nav";
import { StudioStateProvider } from "./StudioState";

const BRAND = "AI 올인원 플랫폼";

type Theme = "system" | "light" | "dark";

function applyTheme(value: Theme) {
  const root = document.documentElement;
  if (value === "light" || value === "dark") {
    root.setAttribute("data-theme", value);
    root.style.colorScheme = value;
  } else {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "";
  }
  try {
    localStorage.setItem("theme", value);
  } catch {
    // 저장이 막힌 환경에서는 이번 세션에만 적용됩니다.
  }
}

function ThemeSwitch() {
  // 저장된 선택이 없으면 스튜디오 기본값인 다크입니다. (layout.tsx 의 인라인 스크립트와 같은 규칙)
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    let saved: Theme = "dark";
    try {
      const value = localStorage.getItem("theme");
      if (value === "light" || value === "dark" || value === "system") saved = value;
    } catch {
      // 저장소를 못 읽으면 기본값을 그대로 씁니다.
    }
    setTheme(saved);
  }, []);

  function choose(value: Theme) {
    setTheme(value);
    applyTheme(value);
  }

  const options: Array<{ value: Theme; icon: "monitor" | "sun" | "moon"; label: string }> = [
    { value: "system", icon: "monitor", label: "시스템 설정" },
    { value: "light", icon: "sun", label: "라이트 테마" },
    { value: "dark", icon: "moon", label: "다크 테마" },
  ];

  return (
    <div className="theme-switch" role="group" aria-label="테마 선택">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={theme === option.value ? "on" : ""}
          onClick={() => choose(option.value)}
          title={option.label}
          aria-label={option.label}
          aria-pressed={theme === option.value}
        >
          <Icon name={option.icon} size={15} />
        </button>
      ))}
    </div>
  );
}

function NavLink({ entry, active, onNavigate }: { entry: NavEntry; active: boolean; onNavigate: () => void }) {
  return (
    <Link
      href={entry.href}
      className={`nav-item${active ? " active" : ""}`}
      style={entry.accent ? ({ "--nav-accent": entry.accent } as React.CSSProperties) : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <span className="nav-icon">
        <Icon name={entry.icon} size={17} />
      </span>
      {entry.label}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const body = await response.json().catch(() => ({}));
        setMe(typeof body.username === "string" ? body.username : null);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  const crumbs = BREADCRUMBS[pathname] ?? ["홈"];

  return (
    <StudioStateProvider>
      <div className="shell">
        <aside className={`sidebar${menuOpen ? " open" : ""}`}>
          <Link href="/" className="sidebar-brand">
            <span className="brand-mark">AI</span>
            <span className="brand-name">{BRAND}</span>
          </Link>

          <div className="sidebar-scroll">
            <div className="nav-section">
              <NavLink
                entry={{ href: "/", label: "홈", icon: "home" }}
                active={pathname === "/"}
                onNavigate={() => setMenuOpen(false)}
              />
            </div>

            <div className="nav-section">
              <div className="nav-label">만들기</div>
              {TOOLS.map((tool) => (
                <NavLink
                  key={tool.href}
                  entry={tool}
                  active={pathname === tool.href}
                  onNavigate={() => setMenuOpen(false)}
                />
              ))}
            </div>

            <div className="nav-section">
              <div className="nav-label">자산</div>
              {ASSETS.map((entry) => (
                <NavLink
                  key={entry.href}
                  entry={entry}
                  active={pathname === entry.href}
                  onNavigate={() => setMenuOpen(false)}
                />
              ))}
            </div>
          </div>

          <div className="sidebar-foot">
            <div className="user-chip">
              <span className="user-avatar">{(me ?? "?").slice(0, 1)}</span>
              <span className="user-name">{me ?? "확인 중…"}</span>
            </div>
            <button type="button" className="secondary" onClick={logout}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <Icon name="logout" size={15} />
                로그아웃
              </span>
            </button>
          </div>
        </aside>

        <div
          className={`sidebar-scrim${menuOpen ? " show" : ""}`}
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />

        <div className="shell-main">
          <header className="topbar">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="메뉴 열기"
            >
              <Icon name="menu" size={17} />
            </button>

            <nav className="breadcrumb" aria-label="현재 위치">
              {crumbs.map((crumb, index) => (
                <span key={crumb} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  {index > 0 ? <span className="crumb-sep">›</span> : null}
                  <span className={index === crumbs.length - 1 ? "crumb-current" : undefined}>{crumb}</span>
                </span>
              ))}
            </nav>

            <div className="topbar-right">
              <ThemeSwitch />
              <Link href="/library" className="topbar-link">
                <Icon name="library" size={15} />
                <span>라이브러리</span>
              </Link>
            </div>
          </header>

          <main className="shell-content">
            <div className="page-enter" key={pathname}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </StudioStateProvider>
  );
}
