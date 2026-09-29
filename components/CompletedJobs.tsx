"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatKst } from "@/lib/time";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "./Icon";
import { useStudioState } from "./StudioState";
import { listVault, getVaultBlob } from "@/lib/local-vault";

/*
 * 상단 "완료된 작업" 버튼과 목록.
 * 최근 완료한 이미지·동영상·음성 작업을 보여 주고, 항목을 누르면 결과 파일을
 * 새 탭으로 엽니다(이 기기 보관함에 사본이 있으면 그 사본을 엽니다).
 * 목록에서 숨긴 항목은 이 브라우저에만 기록합니다(작업 기록 자체는 남습니다).
 */

interface JobRecord {
  id: number;
  mode: string;
  model: string | null;
  prompt: string | null;
  status: string;
  result: { urls?: string[] } | null;
  createdAt: string;
}

const DISMISSED_KEY = "completed-jobs:dismissed";
const MAX_ITEMS = 30;
const MODE_LABEL: Record<string, string> = { image: "이미지", video: "동영상", audio: "음성" };
const MODE_ICON: Record<string, IconName> = { image: "image", video: "video", audio: "audio" };

function readDismissed(): number[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: number[]) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-500)));
  } catch {
    // 저장할 수 없으면 이번 세션에서만 숨깁니다.
  }
}

function formatWhen(value: string): string {
  return formatKst(value, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function CompletedJobs() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const [, setImagePrompt] = useStudioState<string>("image:prompt", "");
  const [, setVideoPrompt] = useStudioState<string>("video:prompt", "");
  const [, setAudioInput] = useStudioState<string>("audio:input", "");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(body.jobs)) setJobs(body.jobs);
    } catch {
      // 목록을 못 불러와도 화면은 그대로 둡니다.
    }
  }, []);

  useEffect(() => {
    setDismissed(readDismissed());
    load();
    const onUpdate = () => load();
    window.addEventListener("jobs:updated", onUpdate);
    return () => window.removeEventListener("jobs:updated", onUpdate);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    load();
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, load]);

  const items = jobs
    .filter((job) => job.status === "completed" && MODE_LABEL[job.mode] && (job.result?.urls?.length ?? 0) > 0)
    .filter((job) => !dismissed.includes(job.id))
    .slice(0, MAX_ITEMS);

  function dismiss(ids: number[]) {
    const next = Array.from(new Set([...dismissed, ...ids]));
    setDismissed(next);
    writeDismissed(next);
  }

  /** 결과 파일을 새 탭으로 엽니다. 서버 파일이 없어졌을 수 있어 보관함 사본을 우선합니다. */
  async function openResult(job: JobRecord) {
    const url = job.result?.urls?.[0];
    if (!url) return;
    const tab = window.open("", "_blank");
    try {
      const vaultItem = (await listVault()).find((item) => item.sourceUrl === url);
      const blob = vaultItem ? await getVaultBlob(vaultItem.id) : null;
      const target = blob ? URL.createObjectURL(blob) : url;
      if (tab) tab.location.href = target;
      else window.location.href = target;
    } catch {
      if (tab) tab.location.href = url;
    }
  }

  function retry(job: JobRecord) {
    const prompt = job.prompt ?? "";
    if (job.mode === "image") {
      setImagePrompt(prompt);
      router.push("/create/image");
    } else if (job.mode === "video") {
      setVideoPrompt(prompt);
      router.push("/create/video");
    } else {
      setAudioInput(prompt);
      router.push("/create/audio");
    }
    setOpen(false);
  }

  async function copyPrompt(job: JobRecord) {
    try {
      await navigator.clipboard.writeText(job.prompt ?? "");
      setCopiedId(job.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // 클립보드 권한이 없으면 무시합니다.
    }
  }

  return (
    <div className="jobs-menu" ref={ref}>
      <button
        type="button"
        className="topbar-link jobs-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="완료된 작업"
      >
        <Icon name="check" size={15} />
        <span>완료된 작업</span>
        {items.length > 0 ? <span className="jobs-count">{items.length}</span> : null}
      </button>
      {open ? (
        <div className="jobs-panel" role="dialog" aria-label="완료된 작업">
          <div className="jobs-head">
            <span>완료됨</span>
            <button type="button" className="jobs-clear" onClick={() => dismiss(items.map((job) => job.id))} disabled={items.length === 0}>
              × 완료 항목 지우기
            </button>
          </div>
          {items.length === 0 ? (
            <div className="jobs-empty">완료된 작업이 없습니다.</div>
          ) : (
            <ul className="jobs-list">
              {items.map((job) => {
                const url = job.result?.urls?.[0] ?? "";
                const prompt = (job.prompt ?? "").replace(/\s+/g, " ").trim();
                return (
                  <li key={job.id} className="jobs-item">
                    <button type="button" className="jobs-open" onClick={() => openResult(job)} title="결과 파일 열기">
                      <span className="jobs-thumb">
                        {job.mode === "image" ? (
                          <img src={url} alt="" loading="lazy" />
                        ) : job.mode === "video" ? (
                          <video src={url} muted preload="metadata" />
                        ) : (
                          <Icon name={MODE_ICON[job.mode]} size={22} />
                        )}
                      </span>
                      <span className="jobs-text">
                        <b>{MODE_LABEL[job.mode]}</b>
                        <span className="jobs-line">{[job.model, prompt].filter(Boolean).join(" · ")}</span>
                        <span className="jobs-line">{formatWhen(job.createdAt)}</span>
                        {prompt ? <i className="jobs-line">{prompt}</i> : null}
                      </span>
                    </button>
                    <span className="jobs-actions">
                      <button type="button" onClick={() => retry(job)} title="같은 프롬프트로 다시 만들기">
                        <Icon name="refresh" size={15} />
                      </button>
                      <button type="button" onClick={() => copyPrompt(job)} title="프롬프트 복사">
                        {copiedId === job.id ? <Icon name="check" size={15} /> : <Icon name="doc" size={15} />}
                      </button>
                      <button type="button" onClick={() => dismiss([job.id])} title="목록에서 숨기기">
                        <Icon name="close" size={15} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
