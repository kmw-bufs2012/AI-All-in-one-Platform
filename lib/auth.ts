const SESSION_COOKIE = "allinone_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || "all-in-one-platform-session-secret";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sign(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function createSessionToken(username: string): Promise<string> {
  const expires = Date.now() + SESSION_TTL_MS;
  const encoded = encodeURIComponent(username);
  const handle = bytesToBase64Url(new TextEncoder().encode(encoded));
  const hmac = await sign(`${expires}.${handle}`);
  return `${expires}.${handle}.${hmac}`;
}

export async function verifySessionToken(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expiresRaw, handleRaw, hmacRaw] = parts;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;

  let handleBytes: Uint8Array;
  try {
    handleBytes = base64UrlToBytes(handleRaw);
  } catch {
    return null;
  }
  const username = decodeURIComponent(new TextDecoder().decode(handleBytes));

  const expected = await sign(`${expiresRaw}.${handleRaw}`);
  const expectedBytes = base64UrlToBytes(expected);
  const actualBytes = base64UrlToBytes(hmacRaw);
  if (!constantTimeEqual(expectedBytes, actualBytes)) return null;

  return username;
}

export { SESSION_COOKIE, SESSION_TTL_MS };