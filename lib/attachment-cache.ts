"use client";

/*
 * 업로드한 첨부 파일의 브라우저 사본을 IndexedDB 에 7일간 보관합니다.
 * 서버리스 환경에서는 첨부가 한 인스턴스의 /tmp 에만 저장되어 /api/files
 * 요청이 다른 인스턴스로 가면 404가 나고 미리보기가 깨집니다. 그래서 화면에
 * 보여 줄 때는 서버 주소 대신 이 사본(object URL)을 먼저 씁니다.
 */

import { useEffect, useState } from "react";

const DB_NAME = "ai-studio-attachments";
const STORE = "files";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedAttachment {
  url: string;
  blob: Blob;
  savedAt: number;
}

const objectUrls = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "url" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      pruneExpired(db);
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function pruneExpired(db: IDBDatabase): void {
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const value = cursor.value as CachedAttachment;
      if (Date.now() - value.savedAt >= TTL_MS) cursor.delete();
      cursor.continue();
    };
  } catch {
    // 정리에 실패해도 미리보기에는 영향이 없습니다.
  }
}

/** 업로드 직후 원본을 기억해 둡니다. 저장 실패(용량·사생활 모드)는 조용히 무시합니다. */
export function rememberAttachment(url: string, blob: Blob): void {
  if (typeof window === "undefined" || !url) return;
  if (!objectUrls.has(url)) objectUrls.set(url, URL.createObjectURL(blob));
  openDb()
    .then((db) => {
      const record: CachedAttachment = { url, blob, savedAt: Date.now() };
      db.transaction(STORE, "readwrite").objectStore(STORE).put(record);
    })
    .catch(() => {});
}

export async function getCachedAttachment(url: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(url);
      request.onsuccess = () => {
        const value = request.result as CachedAttachment | undefined;
        resolve(value && Date.now() - value.savedAt < TTL_MS ? value.blob : null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** 화면에 쓸 주소: 브라우저 사본이 있으면 그 object URL, 없으면 원래 서버 주소. */
export function useAttachmentSrc(url: string | undefined): string | undefined {
  const [src, setSrc] = useState<string | undefined>(() => (url ? (objectUrls.get(url) ?? undefined) : undefined));

  useEffect(() => {
    if (!url) {
      setSrc(undefined);
      return;
    }
    const known = objectUrls.get(url);
    if (known) {
      setSrc(known);
      return;
    }
    // 서버 주소가 아닌 경우(data:, blob:, 외부 URL)는 그대로 씁니다.
    if (!url.startsWith("/api/files/")) {
      setSrc(url);
      return;
    }
    let cancelled = false;
    setSrc(undefined);
    getCachedAttachment(url).then((blob) => {
      if (cancelled) return;
      if (blob) {
        const objectUrl = objectUrls.get(url) ?? URL.createObjectURL(blob);
        objectUrls.set(url, objectUrl);
        setSrc(objectUrl);
      } else {
        setSrc(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return src;
}
