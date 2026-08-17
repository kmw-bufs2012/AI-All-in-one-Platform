import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, findUserByUsername } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth";

const DUMMY_HASH = bcrypt.hashSync("timing-equalization-dummy-password", 10);

export async function POST(request: NextRequest) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력해 주세요." }, { status: 400 });
  }

  const db = getDb();
  const user = findUserByUsername(db, username);
  const hash = user?.password_hash ?? DUMMY_HASH;
  const matched = bcrypt.compareSync(password, hash);
  if (!matched || !user) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const token = await createSessionToken(user.username);
  const response = NextResponse.json({ ok: true, username: user.username });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    path: "/",
  });
  return response;
}