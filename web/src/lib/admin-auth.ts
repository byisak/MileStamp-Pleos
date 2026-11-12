import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";

/**
 * 관리자 로그인 (/admin). 비밀번호는 환경 변수 ADMIN_PASSWORD 하나뿐.
 * 맞으면 'admin.<만료 ms>.<HMAC>' 쿠키를 12시간 준다. 서명 열쇠는 비밀번호에서 만들어서
 * 비밀번호를 바꾸면 이전 쿠키가 모두 무효가 된다.
 */
export const ADMIN_COOKIE = "ms_admin";
export const ADMIN_HOURS = 12;

export function adminPasswordSet(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

function key(): string {
  return `milestamp-admin:${process.env.ADMIN_PASSWORD ?? ""}`;
}

function sign(body: string): string {
  return createHmac("sha256", key()).update(body).digest("base64url");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(pw: string): boolean {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return false;
  // 길이가 달라도 시간이 같게: 양쪽을 HMAC으로 고정 길이로 바꿔 비교
  return same(sign(`pw:${pw}`), sign(`pw:${real}`));
}

export function newSessionValue(now = Date.now()): string {
  const body = `admin.${now + ADMIN_HOURS * 3600_000}`;
  return `${body}.${sign(body)}`;
}

export function validSession(value: string | undefined, now = Date.now()): boolean {
  if (!value || !adminPasswordSet()) return false;
  const i = value.lastIndexOf(".");
  if (i < 0) return false;
  const body = value.slice(0, i);
  const m = /^admin\.(\d+)$/.exec(body);
  if (!m || Number(m[1]) < now) return false;
  return same(value.slice(i + 1), sign(body));
}

/** 서버 컴포넌트·라우트에서 쓰는 확인. */
export async function isAdmin(): Promise<boolean> {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  await connection(); // 만료 확인에 지금 시각을 쓰므로 요청 때만
  return validSession(value);
}

/** /api/admin/* 첫 줄: 관리자가 아니면 401 응답, 맞으면 null. */
export async function adminGuard(): Promise<Response | null> {
  if (!adminPasswordSet()) return Response.json({ error: "관리자 비밀번호가 설정되지 않았어요" }, { status: 503 });
  if (!(await isAdmin())) return Response.json({ error: "로그인이 필요해요" }, { status: 401 });
  return null;
}
