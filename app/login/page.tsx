"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
    <div className="login-wrap">
      <div className="panel login-card">
        <h1>AI 올인원 플랫폼</h1>
        <p className="muted sub">아이디와 비밀번호로 로그인해 주세요.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="username">아이디</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
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
              아직 계정이 생성되지 않았습니다. 서버 환경 변수(APP_USERNAME, APP_PASSWORD)를 설정하면 최초 계정이
              자동으로 생성됩니다.
            </div>
          ) : null}
          <button type="submit" disabled={submitting || !username || !password}>
            {submitting ? "로그인 중입니다…" : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}