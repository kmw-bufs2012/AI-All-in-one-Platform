import { NextResponse } from "next/server";
import { checkR2 } from "@/lib/object-store";

export const dynamic = "force-dynamic";

/** Cloudflare R2 설정 점검(로그인 필요). 비밀 값은 돌려주지 않습니다. */
export async function GET() {
  return NextResponse.json(await checkR2());
}
