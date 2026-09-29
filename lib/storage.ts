import { randomUUID } from "node:crypto";
import { extFromMime } from "@/lib/attachments";
import { putObject } from "@/lib/object-store";

/** 생성 결과를 저장합니다(Cloudflare R2 설정 시 R2, 아니면 로컬). 반환값은 /api/files/ 뒤에 붙는 키입니다. */
export async function saveGeneratedFile(buffer: Buffer, mime: string): Promise<string> {
  const name = `${randomUUID()}.${extFromMime(mime)}`;
  const key = `generated/${name}`;
  await putObject(key, buffer, mime);
  return key;
}

export function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], "base64"), mime: match[1] };
}