"use client";

import { useEffect, useState } from "react";
import type { NormalizedModel } from "@/lib/models";
import { useStudioState } from "./StudioState";

export type ModelKind = "text" | "image" | "video" | "tts";

export interface TranslationState {
  text: string | null;
  loading: boolean;
  error: string;
}

export interface ModelsHook {
  models: NormalizedModel[] | null;
  loading: boolean;
  error: string;
  selectedId: string;
  setSelectedId: (value: string | ((prev: string) => string)) => void;
  selected: NormalizedModel | null;
  translation: TranslationState;
}

/**
 * 페이지별 모델 목록을 불러오고, 선택 상태를 라우트 이동과 무관하게 유지합니다.
 * 선택한 모델의 설명은 번역 API를 통해 함께 표시합니다.
 */
export function useModels(kind: ModelKind): ModelsHook {
  const [models, setModels] = useState<NormalizedModel[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useStudioState<string>(`model:${kind}`, "");
  const [translation, setTranslation] = useState<TranslationState>({ text: null, loading: false, error: "" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/models?type=${kind}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "모델 목록을 불러오지 못했습니다.");
        if (cancelled) return;
        const list: NormalizedModel[] = Array.isArray(body.models) ? body.models : [];
        setModels(list);
        setSelectedId((current) => (current && list.some((item) => item.id === current) ? current : list[0]?.id ?? ""));
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "모델 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // setSelectedId 는 안정적인 참조라 의존성에서 제외해도 안전합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const selected = models?.find((item) => item.id === selectedId) ?? null;
  const description = selected?.description ?? "";

  useEffect(() => {
    if (!description) {
      setTranslation({ text: null, loading: false, error: "" });
      return;
    }
    let cancelled = false;
    setTranslation({ text: null, loading: true, error: "" });
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [description] }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (body.available && Array.isArray(body.translations)) {
          setTranslation({ text: body.translations[0] ?? "", loading: false, error: "" });
        } else {
          setTranslation({ text: null, loading: false, error: body.message ?? "번역을 제공할 수 없습니다." });
        }
      })
      .catch(() => {
        if (!cancelled) setTranslation({ text: null, loading: false, error: "번역 요청 중 오류가 발생했습니다." });
      });
    return () => {
      cancelled = true;
    };
  }, [description]);

  return { models, loading, error, selectedId, setSelectedId, selected, translation };
}
