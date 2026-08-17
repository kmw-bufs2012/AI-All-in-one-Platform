import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { queueVideo, politeVeniceError, readJson } from "@/lib/venice";
import { extractId, extractStatus, readableError } from "@/lib/extract";
import { resolveUploadPath, mimeFromPath } from "@/lib/attachments";

async function resolveImageDataUrl(id: string): Promise<string | null> {
  let dir: string | null = null;
  try {
    dir = resolveUploadPath(path.join("attachments", id));
  } catch {
    return null;
  }
  if (!dir) return null;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const entry = entries.find((item) => item.isFile());
  if (!entry) return null;
  const buffer = await readFile(path.join(dir, entry.name));
  return `data:${mimeFromPath(entry.name)};base64,${buffer.toString("base64")}`;
}

export async function POST(request: NextRequest) {
  let body: { model?: unknown; prompt?: unknown; startImageId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!model || !prompt) {
    return NextResponse.json({ error: "모델과 프롬프트가 필요합니다." }, { status: 400 });
  }

  const payload: Record<string, unknown> = { model, prompt };
  if (typeof body.startImageId === "string") {
    const dataUrl = await resolveImageDataUrl(body.startImageId);
    if (dataUrl) payload.image_url = dataUrl;
  }

  try {
    const upstream = await queueVideo(payload);
    const bodyText = await readJson(upstream);
    if (!upstream.ok) {
      throw politeVeniceError(upstream, bodyText, "Venice.ai 영상 생성 요청에 실패했습니다.");
    }
    const queueId = extractId(bodyText);
    if (!queueId) {
      throw new Error("영상 생성 요청 응답에서 작업 번호를 확인할 수 없습니다.");
    }
    return NextResponse.json({
      ok: true,
      queueId,
      status: extractStatus(bodyText) ?? "QUEUED",
      raw: bodyText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Venice.ai 영상 생성 요청에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}