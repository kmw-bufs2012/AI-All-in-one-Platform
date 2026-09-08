import path from "node:path";
import os from "node:os";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

/*
 * 첨부 한계값. NanoGPT 공식 API 문서(docs.nano-gpt.com, 2026-09 확인) 기준입니다.
 *
 * - MAX_IMAGES / MAX_VIDEO_FILES / MAX_AUDIO_FILES / MAX_DOCS — 채팅 요청당
 *   앱 안전 상한입니다. NanoGPT 모델 카탈로그는 채팅 첨부의 "가능 여부"만
 *   공개하고(capabilities.vision / video_input / audio_input / pdf_upload)
 *   개수 상한은 공개하지 않기 때문에, 종류별 허용 여부만 모델에서 읽고
 *   개수는 여기 값을 씁니다(lib/attachment-policy.ts).
 * - MAX_REFERENCE_BYTES(30MB) — 이미지 생성 참조 이미지의 상한.
 *   Image API 의 input_reference_constraints.max_bytes 기본값(31457280)이며,
 *   모델이 더 작은 값을 공개하면 그 값이 우선합니다.
 * - MAX_DOC_BYTES / MAX_IMAGE_BYTES / MAX_VIDEO_BYTES — 업로드 단계에서
 *   지나치게 큰 파일을 미리 걸러 내기 위한 앱 상한입니다.
 */
export const MAX_IMAGES = 10;
export const MAX_VIDEO_FILES = 3;
export const MAX_AUDIO_FILES = 3;
export const MAX_REFERENCE_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCS = 5;
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

export const DOC_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/pdf",
]);

export const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  "audio/mp4",
  "audio/webm",
]);

export const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/mpeg", "video/webm", "video/quicktime"]);
export const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
]);

export type AttachmentKind = "image" | "video" | "audio" | "doc";

export function kindFromFile(name: string, mime: string): AttachmentKind | null {
  const lower = mime.toLowerCase();
  if (IMAGE_MIME_TYPES.has(lower) || (lower.startsWith("image/") && !lower.includes("svg"))) return "image";
  if (VIDEO_MIME_TYPES.has(lower) || lower.startsWith("video/")) return "video";
  if (AUDIO_MIME_TYPES.has(lower) || lower.startsWith("audio/")) return "audio";
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
 * Vercel/AWS Lambda 같은 서버리스 환경에서는 배포 디렉터리(process.cwd() =
 * /var/task)가 읽기 전용이라 "./uploads" 아래에 mkdir 하면
 * "ENOENT: no such file or directory, mkdir '/var/task/uploads/attachments'"
 * 같은 오류로 죽습니다(경로는 환경에 따라 다를 수 있음).
 *
 * 후보를 순서대로 실제 쓰기 테스트(디렉터리 생성 + 프로브 파일 쓰기/삭제)로
 * 검증해, 처음 성공한 곳을 프로세스 수명 동안 고정해 씁니다. mkdir은 성공했지만
 * 파일 쓰기가 막히는 케이스(읽기 전용 overlay)까지 잡기 위해 mkdir만이 아니라
 * 실제 파일 쓰기까지 확인합니다.
 *
 * 로컬 개발(README에 문서화된 ./uploads)은 그대로 동작하고, 서버리스에서는
 * 자동으로 OS 임시 디렉터리(/tmp)로 넘어갑니다. 모든 후보가 실패하면 죽은
 * 경로를 반환하는 대신 바로 알기 쉬운 오류를 던져 원인을 감추지 않습니다.
 */
function uploadRootCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.UPLOAD_DIR) candidates.push(process.env.UPLOAD_DIR);
  candidates.push(path.join(process.cwd(), "uploads"));
  candidates.push(path.join(os.tmpdir(), "ai-all-in-one-platform-uploads"));
  return candidates;
}

function tryCreateUploadRoot(candidate: string): boolean {
  try {
    mkdirSync(path.join(candidate, "attachments"), { recursive: true });
    mkdirSync(path.join(candidate, "generated"), { recursive: true });
    const probe = path.join(candidate, ".write-probe");
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function uploadRoot(): string {
  if (cachedUploadRoot) return cachedUploadRoot;
  for (const rawCandidate of uploadRootCandidates()) {
    // UPLOAD_DIR("./uploads" 등)이 상대 경로면 resolveUploadPath()의 경로 탈출
    // 방지 검사(target.startsWith(root + sep))가 절대 경로로 정규화된 target과
    // 어긋나 항상 실패합니다(모든 파일 요청이 "경로가 올바르지 않습니다"로
    // 거부됨). 캐싱 전에 항상 절대 경로로 고정합니다.
    const candidate = path.resolve(rawCandidate);
    if (tryCreateUploadRoot(candidate)) {
      cachedUploadRoot = candidate;
      return candidate;
    }
  }
  throw new Error(
    "파일을 저장할 디렉터리를 만들 수 없습니다. " +
      "(UPLOAD_DIR, ./uploads, OS 임시 디렉터리 순서로 모두 시도했지만 실패했습니다.) " +
      "서버리스 환경이라면 쓰기 가능한 경로를 UPLOAD_DIR 환경 변수로 지정해 주세요.",
  );
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
  ".mpeg": "video/mpeg",
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