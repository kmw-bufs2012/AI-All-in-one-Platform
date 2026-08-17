import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ASSETS, TOOLS } from "@/components/nav";

export default function HomePage() {
  return (
    <div className="page-pad">
      <section className="hero">
        <span className="hero-eyebrow">
          <span className="hero-dot" />
          모델 목록을 실시간으로 불러옵니다
        </span>
        <h1>
          오늘은 무엇을
          <br />
          <span className="grad">만들어 볼까요</span>?
        </h1>
        <p>채팅부터 이미지, 영상, 음성까지. 하나의 작업 공간에서 만들고 라이브러리에 모아 둡니다.</p>
      </section>

      <div className="section-head">
        <h2>만들기</h2>
        <span className="section-sub">원하는 작업을 골라 바로 시작하세요</span>
      </div>

      <div className="tool-grid">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="tool-card"
            style={{ "--tool": tool.accent } as React.CSSProperties}
          >
            <div className="tool-card-top">
              <span className="tool-icon">
                <Icon name={tool.icon} size={19} />
              </span>
              <h3>{tool.label}</h3>
              <span className="tool-arrow">
                <Icon name="arrowRight" size={17} />
              </span>
            </div>
            <p>{tool.description}</p>
          </Link>
        ))}
      </div>

      <div className="section-head" style={{ marginTop: 34 }}>
        <h2>자산</h2>
        <span className="section-sub">만들어 둔 결과와 작업 이력</span>
      </div>

      <div className="quick-grid" style={{ marginTop: 0 }}>
        {ASSETS.map((entry) => (
          <Link key={entry.href} href={entry.href} className="quick-card">
            <span className="tool-icon" style={{ width: 32, height: 32, borderRadius: 9 }}>
              <Icon name={entry.icon} size={16} />
            </span>
            <span>
              <span className="quick-title" style={{ display: "block" }}>
                {entry.label}
              </span>
              <span className="quick-sub">
                {entry.href === "/library"
                  ? "생성한 이미지·영상·음성 모아 보기"
                  : entry.href === "/history"
                    ? "사용량과 비용까지 남은 기록"
                    : "자주 쓰는 프롬프트 저장"}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
