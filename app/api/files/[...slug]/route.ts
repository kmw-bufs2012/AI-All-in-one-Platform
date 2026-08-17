import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveUploadPath, mimeFromPath } from "@/lib/attachments";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await context.params;
  const relative = slug.map(decodeURIComponent).join("/");
  const filePath = resolveUploadPath(relative);
  if (!filePath) {
    return NextResponse.json({ error: "파일 경로가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const buffer = await readFile(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": mimeFromPath(filePath),
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(buffer.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }
}