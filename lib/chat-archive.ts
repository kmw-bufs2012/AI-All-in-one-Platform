/*
 * 채팅 대화를 브라우저 localStorage 에 7일간 임시 보관합니다.
 * 서버에는 보내지 않으며, 같은 기기·같은 브라우저에서만 다시 볼 수 있습니다.
 * 7일이 지난 대화는 읽을 때마다 자동으로 지웁니다.
 */

export const ARCHIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ARCHIVE_KEY = "chat-archive:v1";
const MAX_CONVERSATIONS = 50;

export interface ArchivedConversation<M = unknown> {
  id: string;
  title: string;
  updatedAt: number;
  messages: M[];
}

function readRaw(): ArchivedConversation[] {
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(items: ArchivedConversation[]): void {
  let list = items;
  // 용량 초과 시 오래된 대화부터 덜어 내며 다시 시도합니다.
  while (true) {
    try {
      window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list));
      return;
    } catch {
      if (list.length <= 1) return;
      list = list.slice(0, -1);
    }
  }
}

/** 만료된 항목을 걸러 낸 최신순 목록을 돌려주고, 걸러진 결과를 다시 저장합니다. */
export function listConversations<M>(): ArchivedConversation<M>[] {
  if (typeof window === "undefined") return [];
  const now = Date.now();
  const all = readRaw();
  const alive = all.filter((item) => now - item.updatedAt < ARCHIVE_TTL_MS).sort((a, b) => b.updatedAt - a.updatedAt);
  if (alive.length !== all.length) writeRaw(alive);
  return alive as ArchivedConversation<M>[];
}

export function saveConversation<M>(conversation: ArchivedConversation<M>): void {
  if (typeof window === "undefined") return;
  const rest = listConversations().filter((item) => item.id !== conversation.id);
  writeRaw([conversation as ArchivedConversation, ...rest].slice(0, MAX_CONVERSATIONS));
}

export function deleteConversation(id: string): void {
  if (typeof window === "undefined") return;
  writeRaw(listConversations().filter((item) => item.id !== id));
}

export function clearConversations(): void {
  try {
    window.localStorage.removeItem(ARCHIVE_KEY);
  } catch {
    // 저장소를 쓸 수 없는 환경에서는 지울 것도 없습니다.
  }
}

export function newConversationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
