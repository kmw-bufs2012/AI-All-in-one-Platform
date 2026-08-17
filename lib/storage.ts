import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadRoot, ensureUploadDirs, extFromMime } from "@/lib/attachments";

export async function saveGeneratedFile(buffer: Buffer, mime: string): Promise<string> {
  ensureUploadDirs();
  const name = `${randomUUID()}.${extFromMime(mime)}`;
  await writeFile(path.join(uploadRoot(), "generated", name), buffer);
  return `generated/${name}`;
}

export function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], "base64"), mime: match[1] };
}