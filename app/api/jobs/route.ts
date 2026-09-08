import { NextRequest, NextResponse } from "next/server";
import { getDb, insertJob, listJobs } from "@/lib/db";

const ALLOWED_MODES = new Set(["chat", "image", "video", "audio"]);

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || undefined;
  const date = request.nextUrl.searchParams.get("date") || undefined;
  const model = request.nextUrl.searchParams.get("model") || undefined;
  const db = getDb();
  const rows = listJobs(db, { mode, date, model });
  const jobs = rows.map((row) => ({
    id: row.id,
    mode: row.mode,
    model: row.model,
    prompt: row.prompt,
    attachments: row.attachments ? JSON.parse(row.attachments) : null,
    usage: row.usage ? JSON.parse(row.usage) : null,
    unitPrice: row.unit_price ? JSON.parse(row.unit_price) : null,
    cost: row.cost,
    currency: row.currency,
    costSource: row.cost_source,
    status: row.status,
    result: row.result ? JSON.parse(row.result) : null,
    createdAt: row.created_at,
  }));
  return NextResponse.json({ jobs });
}

export async function POST(request: NextRequest) {
  let body: {
    mode?: unknown;
    model?: unknown;
    prompt?: unknown;
    attachments?: unknown;
    usage?: unknown;
    unitPrice?: unknown;
    cost?: unknown;
    currency?: unknown;
    costSource?: unknown;
    status?: unknown;
    result?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!ALLOWED_MODES.has(mode)) {
    return NextResponse.json({ error: "지원하지 않는 작업 모드입니다." }, { status: 400 });
  }
  const row = insertJob(getDb(), {
    mode,
    model: typeof body.model === "string" ? body.model : null,
    prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 10000) : null,
    attachments: body.attachments ?? null,
    usage: body.usage ?? null,
    unitPrice: body.unitPrice ?? null,
    cost: typeof body.cost === "number" ? body.cost : null,
    currency: typeof body.currency === "string" ? body.currency : null,
    costSource: body.costSource === "actual" || body.costSource === "estimated" ? body.costSource : null,
    status: typeof body.status === "string" ? body.status : "completed",
    result: body.result ?? null,
  });
  return NextResponse.json({ ok: true, id: row.id });
}