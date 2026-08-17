import path from "node:path";
import os from "node:os";
import { mkdirSync } from "node:fs";

export const MAX_IMAGES = 10;
export const MAX_VIDEO_FILES = 1;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCS = 1;
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export const DOC_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/pdf",
]);

export const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"]);
export const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
]);

export type AttachmentKind = "image" | "video" | "doc";

export function kindFromFile(name: string, mime: string): AttachmentKind | null {
  const lower = mime.toLowerCase();
  if (IMAGE_MIME_TYPES.has(lower) || (lower.startsWith("image/") && !lower.includes("svg"))) return "image";
  if (VIDEO_MIME_TYPES.has(lower) || lower.startsWith("video/")) return "video";
  const extension = path.extname(name).toLowerCase();
  if (DOC_MIME_TYPES.has(lower) || extension === ".txt" || extension === ".md" || extension === ".pdf") return "doc";
  return null;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/<>:"|?*\u0000-\u001f]/g, "_").trim();
  return cleaned.slice(0, 120) || "file";
}

let cachedUploadRoot: string | null = null;

/*
 * Vercel 같은 서버리스 환경에서는 배포 디렉터리(process.cwd())가 읽기 전용이라
 * "./uploads" 아래에 mkdir 하면 ENOENT/EROFS 로 죽습니다. 쓰기 가능한 디렉터리를
 * 순서대로 시도해 처음 성공한 곳을 프로세스 수명 동안 고정해 씁니다.
 * 로컬 개발(README에 문서화된 ./uploads)은 그대로 동작하고, 서버리스에서는
 * 자동으로 OS 임시 디렉터리(/tmp)로 넘어갑니다.
 */
function uploadRootCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.UPLOAD_DIR) candidates.push(process.env.UPLOAD_DIR);
  candidates.push(path.join(process.cwd(), "uploads"));
  candidates.push(path.join(os.tmpdir(), "ai-all-in-one-platform-uploads"));
  return candidates;
}

export function uploadRoot(): string {
  if (cachedUploadRoot) return cachedUploadRoot;
  const candidates = uploadRootCandidates();
  for (const candidate of candidates) {
    try {
      mkdirSync(path.join(candidate, "attachments"), { recursive: true });
      mkdirSync(path.join(candidate, "generated"), { recursive: true });
      cachedUploadRoot = candidate;
      return candidate;
    } catch {
      continue;
    }
  }
  // 마지막 후보(OS 임시 디렉터리)까지 실패하면 그대로 반환해 호출부에서 오류가 드러나게 합니다.
  cachedUploadRoot = candidates[candidates.length - 1];
  return cachedUploadRoot;
}

export function ensureUploadDirs(): void {
  uploadRoot();
}

export function resolveUploadPath(relativePath: string): string | null {
  const root = uploadRoot();
  const target = path.normalize(path.join(root, relativePath));
  if (!target.startsWith(root + path.sep)) return null;
  return target;
}

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".opus": "audio/opus",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

export function mimeFromPath(filePath: string): string {
  return EXT_MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function extFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "video/mp4": return "mp4";
    case "video/webm": return "webm";
    case "video/quicktime": return "mov";
    case "video/x-msvideo": return "avi";
    case "audio/mpeg": return "mp3";
    case "audio/wav": return "wav";
    case "audio/ogg": return "ogg";
    case "audio/mp4": return "m4a";
    case "audio/flac": return "flac";
    case "audio/opus": return "opus";
    default: return "bin";
  }
}