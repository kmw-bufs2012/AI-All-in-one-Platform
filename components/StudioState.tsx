"use client";

/*
 * 라우트가 바뀌면 페이지 컴포넌트는 언마운트됩니다. 프롬프트 초안이나 선택한 모델이
 * 그대로 날아가지 않도록, 값을 메모리 스토어에 두고 sessionStorage로 백업합니다.
 * 상태관리 라이브러리를 새로 넣지 않기 위해 Context + Ref 만으로 구현했습니다.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "studio:";

type Store = {
  read: (key: string) => unknown;
  write: (key: string, value: unknown) => void;
};

const StudioStateContext = createContext<Store | null>(null);

export function StudioStateProvider({ children }: { children: React.ReactNode }) {
  const memory = useRef(new Map<string, unknown>());

  const read = useCallback((key: string) => {
    if (memory.current.has(key)) return memory.current.get(key);
    try {
      const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
      if (raw === null) return undefined;
      const parsed = JSON.parse(raw);
      memory.current.set(key, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }, []);

  const write = useCallback((key: string, value: unknown) => {
    memory.current.set(key, value);
    try {
      sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch {
      // 저장이 막힌 환경에서는 메모리 스토어만으로 동작합니다.
    }
  }, []);

  return <StudioStateContext.Provider value={{ read, write }}>{children}</StudioStateContext.Provider>;
}

/**
 * useState와 같은 형태로 쓰되, 라우트를 오갔다 돌아와도 값이 남아 있습니다.
 * 서버 렌더 결과와 어긋나지 않도록 첫 렌더는 항상 initial 로 시작하고
 * 마운트 직후에 저장된 값으로 교체합니다.
 */
export function useStudioState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const store = useContext(StudioStateContext);
  const [value, setValue] = useState<T>(initial);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!store || hydrated.current) return;
    hydrated.current = true;
    const saved = store.read(key);
    if (saved !== undefined) setValue(saved as T);
  }, [store, key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        store?.write(key, resolved);
        return resolved;
      });
    },
    [store, key],
  );

  return [value, update];
}
