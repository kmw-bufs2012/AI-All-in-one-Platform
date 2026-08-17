import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { quoteVideo, politeVeniceError, readJson } from "@/lib/venice";
import { extractCost, readableError } from "@/lib/extract";
import { resolveUploadPath, mimeFromPath } from "@/lib/attachments";

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
    const dir = resolveUploadPath(path.join("attachments", body.startImageId));
    if (dir) {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const entry = entries.find((item) => item.isFile());
      if (entry) {
        const buffer = await readFile(path.join(dir, entry.name));
        payload.image_url = `data:${mimeFromPath(entry.name)};base64,${buffer.toString("base64")}`;
      }
    }
  }

  try {
    const upstream = await quoteVideo(payload);
    const bodyText = await readJson(upstream);
    if (!upstream.ok) {
      throw politeVeniceError(upstream, bodyText, "Venice.ai 영상 비용 견적에 실패했습니다.");
    }
    const cost = extractCost(bodyText);
    return NextResponse.json({
      ok: true,
      cost: cost ? { amount: cost.amount, currency: cost.currency ?? null } : null,
      raw: bodyText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Venice.ai 영상 비용 견적에 실패했습니다.";
    const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status ?? 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}