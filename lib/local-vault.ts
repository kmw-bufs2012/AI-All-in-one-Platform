/*
 * 이 기기(브라우저) 임시 보관함.
 *
 * 생성한 이미지·영상 파일을 브라우저 IndexedDB에 저장해, 서버 쪽 파일
 * (Vercel /tmp 등)이 재배포·재시작으로 사라져도 라이브러리에서 계속 볼 수
 * 있게 합니다. 서버·토큰 비용은 들지 않고, 이 브라우저에서만 보입니다.
 *
 * - 보존 기간: RETENTION_DAYS 일이 지나면 자동 삭제(고정한 항목 제외).
 * - 용량 상한: MAX_TOTAL_BYTES 를 넘으면 오래된 항목부터 삭제(고정 제외).
 * - 저장 형식 버전: 앱 기능이 바뀌어도 기존 보관 파일을 읽을 수 있도록
 *   항목마다 schema 값을 두고, IndexedDB 버전 업그레이드는 onupgradeneeded
 *   에서 기존 저장소를 지우지 않고 필요한 것만 추가합니다.
 */

export const RETENTION_DAYS = 7;
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 1GB
const DAY_MS = 24 * 60 * 60 * 1000;

const DB_NAME = "ai-studio-vault";
const DB_VERSION = 1;
const META_STORE = "items";
const BLOB_STORE = "blobs";
const SCHEMA = 1;

export type VaultKind = "image" | "video";

export interface VaultItem {
  schema: number;
  id: string;
  kind: VaultKind;
  /** 원래 파일 주소. 서버 라이브러리 항목과 짝을 맞추는 데 씁니다. */
  sourceUrl: string;
  mime: string;
  size: number;
  model: string | null;
  prompt: string;
  savedAt: number;
  pinned: boolean;
}

function hasIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // 이후 버전에서도 기존 저장소는 지우지 않고, 없는 것만 만듭니다.
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("보관함을 열지 못했습니다."));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("보관함 작업에 실패했습니다."));
    transaction.onabort = () => reject(transaction.error ?? new Error("보관함 작업이 취소되었습니다."));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 예전 형식 항목도 현재 형식으로 읽습니다. */
function normalize(raw: Partial<VaultItem> & { id: string }): VaultItem {
  return {
    schema: SCHEMA,
    id: raw.id,
    kind: raw.kind === "video" ? "video" : "image",
    sourceUrl: raw.sourceUrl ?? "",
    mime: raw.mime ?? "application/octet-stream",
    size: raw.size ?? 0,
    model: raw.model ?? null,
    prompt: raw.prompt ?? "",
    savedAt: raw.savedAt ?? Date.now(),
    pinned: raw.pinned ?? false,
  };
}

export async function listVault(): Promise<VaultItem[]> {
  if (!hasIndexedDb()) return [];
  const db = await openDb();
  try {
    const items = await requestValue(db.transaction(META_STORE, "readonly").objectStore(META_STORE).getAll());
    return (items as VaultItem[]).map(normalize).sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    db.close();
  }
}

export async function getVaultBlob(id: string): Promise<Blob | null> {
  if (!hasIndexedDb()) return null;
  const db = await openDb();
  try {
    const blob = await requestValue(db.transaction(BLOB_STORE, "readonly").objectStore(BLOB_STORE).get(id));
    return blob instanceof Blob ? blob : null;
  } finally {
    db.close();
  }
}

export async function removeVaultItems(ids: string[]): Promise<void> {
  if (!hasIndexedDb() || ids.length === 0) return;
  const db = await openDb();
  try {
    const transaction = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    for (const id of ids) {
      transaction.objectStore(META_STORE).delete(id);
      transaction.objectStore(BLOB_STORE).delete(id);
    }
    await done(transaction);
  } finally {
    db.close();
  }
}

export async function setVaultPinned(id: string, pinned: boolean): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  try {
    const transaction = db.transaction(META_STORE, "readwrite");
    const store = transaction.objectStore(META_STORE);
    const current = await requestValue(store.get(id));
    if (current) store.put({ ...normalize(current as VaultItem), pinned });
    await done(transaction);
  } finally {
    db.close();
  }
}

/** 기간이 지났거나 용량을 넘은 항목을 지웁니다. 고정한 항목은 남깁니다. */
export async function cleanupVault(now = Date.now()): Promise<void> {
  const items = await listVault();
  const expired = items.filter((item) => !item.pinned && now - item.savedAt > RETENTION_DAYS * DAY_MS);
  const expiredIds = new Set(expired.map((item) => item.id));
  let total = items.filter((item) => !expiredIds.has(item.id)).reduce((sum, item) => sum + item.size, 0);
  const overflow: string[] = [];
  // 오래된 것부터(listVault 는 최신순) 상한 아래로 내려갈 때까지 지웁니다.
  for (const item of [...items].reverse()) {
    if (total <= MAX_TOTAL_BYTES) break;
    if (item.pinned || expiredIds.has(item.id)) continue;
    overflow.push(item.id);
    total -= item.size;
  }
  await removeVaultItems([...expiredIds, ...overflow]);
}

/** 원본 주소에서 파일을 받아 보관합니다. 이미 보관한 주소면 건너뜁니다. */
export async function saveToVault(input: {
  url: string;
  kind: VaultKind;
  model: string | null;
  prompt: string;
}): Promise<boolean> {
  if (!hasIndexedDb() || !input.url) return false;
  const existing = await listVault();
  if (existing.some((item) => item.sourceUrl === input.url)) return true;

  const response = await fetch(input.url);
  if (!response.ok) return false;
  const blob = await response.blob();
  if (blob.size > MAX_TOTAL_BYTES) return false;

  // 브라우저가 허용하는 남은 저장 공간이 부족하면 저장하지 않습니다.
  if (navigator.storage?.estimate) {
    const { quota, usage } = await navigator.storage.estimate();
    if (quota !== undefined && usage !== undefined && quota - usage < blob.size) return false;
  }

  const item: VaultItem = {
    schema: SCHEMA,
    id: crypto.randomUUID(),
    kind: input.kind,
    sourceUrl: input.url,
    mime: blob.type || (input.kind === "video" ? "video/mp4" : "image/png"),
    size: blob.size,
    model: input.model,
    prompt: input.prompt,
    savedAt: Date.now(),
    pinned: false,
  };
  const db = await openDb();
  try {
    const transaction = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    transaction.objectStore(META_STORE).put(item);
    transaction.objectStore(BLOB_STORE).put(blob, item.id);
    await done(transaction);
  } finally {
    db.close();
  }
  await cleanupVault();
  return true;
}

export function daysLeft(item: VaultItem, now = Date.now()): number {
  return Math.max(0, Math.ceil((item.savedAt + RETENTION_DAYS * DAY_MS - now) / DAY_MS));
}
