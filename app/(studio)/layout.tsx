import { AppShell } from "@/components/AppShell";

/**
 * 로그인 화면을 제외한 모든 화면이 이 셸을 공유합니다.
 * 사이드바·헤더·테마 전환·페이지 전환 애니메이션이 여기에서 한 번만 렌더링됩니다.
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
