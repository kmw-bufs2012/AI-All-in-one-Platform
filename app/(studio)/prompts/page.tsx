"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

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
    loadPrompts();
  }, []);

  async function loadPrompts() {
    try {
      const response = await fetch("/api/prompts", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "프롬프트 목록을 불러오지 못했습니다.");
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
      if (!response.ok) throw new Error(body.error || "프롬프트 저장에 실패했습니다.");
      setName("");
      setContent("");
      setNotice("프롬프트를 저장했습니다.");
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

  return (
    <div className="page-pad">
      <div className="page-head">
        <h1>프롬프트</h1>
        <p>자주 쓰는 문장을 저장해 두고 채팅 입력창으로 바로 불러옵니다.</p>
      </div>

      <div className="two-col">
        <div className="panel">
          <h2 style={{ fontSize: 15, marginBottom: 14 }}>새 프롬프트 저장</h2>
          <form className="stack" onSubmit={handleSave}>
            <div>
              <label htmlFor="prompt-name">이름</label>
              <input
                id="prompt-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="프롬프트 이름 (최대 100자)"
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
                placeholder="저장할 프롬프트 내용 (최대 20,000자)"
                maxLength={20000}
                style={{ minHeight: 180 }}
                required
              />
            </div>
            {error ? <div className="error-box">{error}</div> : null}
            {notice ? <div className="success-box">{notice}</div> : null}
            <button type="submit" disabled={saving || !name.trim() || !content.trim()}>
              {saving ? "저장하고 있습니다…" : "저장"}
            </button>
          </form>
        </div>

        <div className="panel">
          <h2 style={{ fontSize: 15, marginBottom: 14 }}>저장된 프롬프트</h2>
          {prompts.length === 0 ? (
            <div className="empty-note">저장된 프롬프트가 없습니다.</div>
          ) : (
            <div className="stack">
              {prompts.map((prompt) => (
                <div key={prompt.id} className="prompt-item">
                  <div className="name">{prompt.name}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    저장 시각: {prompt.updatedAt.replace("T", " ").slice(0, 19)}
                  </div>
                  <div className="content">{prompt.content}</div>
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => router.push(`/create/chat?loadPrompt=${prompt.id}`)}
                      title="채팅 입력창에 내용을 불러옵니다."
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Icon name="chat" size={14} />
                        채팅으로 불러오기
                      </span>
                    </button>
                    <button
                      type="button"
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
    </div>
  );
}
