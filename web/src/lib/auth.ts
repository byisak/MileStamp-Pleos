import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "./db";

export const PHONE_COOKIE = "ms_phone";

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** 차 요청: Authorization: Bearer <차 토큰> */
export async function carFromRequest(req: Request): Promise<{ id: string } | null> {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const [car] = await sql<{ id: string }[]>`select id from cars where token_hash = ${hashToken(m[1])}`;
  return car ?? null;
}

export type Phone = { id: string; car_id: string; nickname: string; has_push: boolean };

/** 폰: 앱은 Authorization: Bearer <폰 토큰>, 웹은 연결할 때 받은 쿠키 */
export async function currentPhone(req?: Request): Promise<Phone | null> {
  const bearer = /^Bearer (.+)$/.exec(req?.headers.get("authorization") ?? "")?.[1];
  const token = bearer ?? (await cookies()).get(PHONE_COOKIE)?.value;
  if (!token) return null;
  const [phone] = await sql<Phone[]>`
    update phones set last_seen = now() where token_hash = ${hashToken(token)}
    returning id, car_id, nickname, (push is not null) as has_push`;
  return phone ?? null;
}

/** 차 화면 QR용 짧은 코드 (헷갈리는 0·O·1·I 제외) */
export function newPairCode() {
  const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}
