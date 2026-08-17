"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const BRAND = "AI 올인원 플랫폼";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [noAccount, setNoAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) {
          router.replace("/");
        } else {
          const body = await response.json().catch(() => ({}));
          if (body.noAccount) setNoAccount(true);
        }
      })
      .catch(() => {});
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "로그인에 실패했습니다.");
        return;
      }
      window.location.replace("/");
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth">
      {/* 왼쪽은 홈과 같은 다크 베이스 위에 흐르는 그라디언트를 얹은 비주얼 면입니다. */}
      <aside className="auth-visual">
        <div className="auth-brand">
          <span className="brand-mark">AI</span>
          <span className="brand-name">{BRAND}</span>
        </div>

        <div className="auth-copy">
          <h2>
            만들고 싶은 것을
            <br />
            문장으로 적기만 하면 됩니다.
          </h2>
          <p>채팅·이미지·영상·음성을 한 곳에서 만들고, 결과는 라이브러리에 차곡차곡 모입니다.</p>
        </div>

        <div className="auth-tags">
          <span className="auth-tag">채팅</span>
          <span className="auth-tag">이미지</span>
          <span className="auth-tag">영상</span>
          <span className="auth-tag">음성</span>
          <span className="auth-tag">라이브러리</span>
        </div>
      </aside>

      <main className="auth-form-side">
        <div className="auth-card">
          <h1>다시 오셨네요</h1>
          <p className="auth-sub">아이디와 비밀번호를 입력해 작업 공간으로 들어가세요.</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="username">아이디</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div>
              <label htmlFor="password">비밀번호</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error ? <div className="error-box">{error}</div> : null}
            {noAccount ? (
              <div className="notice">
                아직 계정이 만들어지지 않았습니다. 서버 환경 변수(APP_USERNAME, APP_PASSWORD)를 설정하면 첫 계정이
                자동으로 생성됩니다.
              </div>
            ) : null}

            <button type="submit" disabled={submitting || !username || !password}>
              {submitting ? "확인하고 있습니다…" : "로그인"}
            </button>
          </form>

          <p className="auth-foot">모든 생성 요청은 서버를 거쳐 처리되며 API 키는 브라우저에 노출되지 않습니다.</p>
        </div>
      </main>
    </div>
  );
}
