import path from "node:path";
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

export function uploadRoot(): string {
  return path.join(process.cwd(), "uploads");
}

export function ensureUploadDirs(): void {
  mkdirSync(path.join(uploadRoot(), "attachments"), { recursive: true });
  mkdirSync(path.join(uploadRoot(), "generated"), { recursive: true });
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