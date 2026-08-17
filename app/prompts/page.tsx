"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PromptItem {
  id: number;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export default function PromptsPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) router.replace("/login");
      })
      .catch(() => router.replace("/login"));
    loadPrompts();
  }, [router]);

  async function loadPrompts() {
    try {
      const response = await fetch("/api/prompts", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "프롬프트 목록을 불러오지 못했습니다.");
      }
      setPrompts(Array.isArray(body.prompts) ? body.prompts : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "프롬프트 목록을 불러오지 못했습니다.");
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "프롬프트 저장에 실패했습니다.");
      }
      setName("");
      setContent("");
      setNotice("프롬프트가 저장되었습니다.");
      await loadPrompts();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "프롬프트 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    setError("");
    try {
      const response = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "프롬프트 삭제에 실패했습니다.");
      }
      setPrompts((prev) => prev.filter((item) => item.id !== id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "프롬프트 삭제에 실패했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleReuse(prompt: PromptItem) {
    window.location.href = `/?loadPrompt=${prompt.id}`;
  }

  return (
    <main>
      <header className="app-header">
        <span className="brand">AI 올인원 플랫폼</span>
        <nav>
          <a className="nav-link" href="/">스튜디오</a>
          <a className="nav-link" href="/history">작업 기록</a>
          <a className="nav-link active" href="/prompts">프롬프트 관리</a>
        </nav>
        <div className="header-right">
          <a className="nav-link" href="/">스튜디오로 돌아가기</a>
        </div>
      </header>

      <div className="prompt-layout">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>새 프롬프트 저장</h2>
          <form className="prompt-form" onSubmit={handleSave}>
            <div>
              <label htmlFor="prompt-name">이름</label>
              <input
                id="prompt-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="프롬프트 이름을 입력해 주세요. (최대 100자)"
                maxLength={100}
                required
              />
            </div>
            <div>
              <label htmlFor="prompt-content">내용</label>
              <textarea
                id="prompt-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="저장할 프롬프트 내용을 입력해 주세요. (최대 20,000자)"
                maxLength={20000}
                style={{ minHeight: 180 }}
                required
              />
            </div>
            {error ? <div className="error-box">{error}</div> : null}
            {notice ? <div className="success-box">{notice}</div> : null}
            <button type="submit" disabled={saving || !name.trim() || !content.trim()}>
              {saving ? "저장 중입니다…" : "저장"}
            </button>
          </form>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>저장된 프롬프트</h2>
          {prompts.length === 0 ? (
            <div className="empty-note">저장된 프롬프트가 없습니다.</div>
          ) : (
            <div className="prompt-list">
              {prompts.map((prompt) => (
                <div key={prompt.id} className="prompt-item">
                  <div className="name">{prompt.name}</div>
                  <div className="muted">저장 시각: {prompt.updatedAt.replace("T", " ").slice(0, 19)}</div>
                  <div className="content">{prompt.content}</div>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() => handleReuse(prompt)}
                      title="채팅 모드 입력창에 내용을 불러옵니다."
                    >
                      채팅 입력창에 불러오기
                    </button>
                    <button
                      className="danger"
                      onClick={() => handleDelete(prompt.id)}
                      disabled={deletingId === prompt.id}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}