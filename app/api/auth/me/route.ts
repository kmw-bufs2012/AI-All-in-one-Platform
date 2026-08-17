import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const username = token ? await verifySessionToken(token) : null;
  if (!username) {
    const db = getDb();
    const noAccount = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === 0;
    return NextResponse.json({ error: "인증이 필요합니다.", noAccount }, { status: 401 });
  }
  return NextResponse.json({ username });
}