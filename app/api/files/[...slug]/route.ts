import { NextRequest, NextResponse } from "next/server";
import { getObject } from "@/lib/object-store";

/*
 * 저장된 파일(첨부·생성물)을 내려줍니다. Cloudflare R2 를 쓰면 R2 에서, 아니면
 * 서버 로컬 저장소에서 읽습니다. 동영상 탐색을 위해 Range 요청을 그대로 넘깁니다.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await context.params;
  const key = slug.map(decodeURIComponent).join("/");
  if (!/^(attachments|generated)\//.test(key)) {
    return NextResponse.json({ error: "파일 경로가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const found = await getObject(key, request.headers.get("range"));
    if (!found) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    const headers: Record<string, string> = {
      "Content-Type": found.mime,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
    };
    if (found.size !== null) headers["Content-Length"] = String(found.size);
    if (found.contentRange) headers["Content-Range"] = found.contentRange;
    const body = Buffer.isBuffer(found.body) ? new Uint8Array(found.body) : found.body;
    return new Response(body, { status: found.status, headers });
  } catch (error) {
    console.error("[files] read failed:", error);
    return NextResponse.json({ error: "파일 저장소를 읽지 못했습니다." }, { status: 502 });
  }
}
