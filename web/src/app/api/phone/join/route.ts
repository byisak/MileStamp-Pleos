import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { PHONE_COOKIE, hashToken, newToken } from "@/lib/auth";
import { demoCarId, isPassCode } from "@/lib/demo";

const NICKNAMES = ["엄마", "아빠", "할머니", "할아버지", "이모", "삼촌", "가족"];

// 폰이 차 화면 QR로 들어와 가족이 된다. 코드는 한 번 쓰면 사라진다.
export async function POST(req: Request) {
  const { code, nickname, app } = (await req.json().catch(() => ({}))) as { code?: string; nickname?: string; app?: boolean };
  if (!code) return Response.json({ error: "no code" }, { status: 400 });
  // 개발자 시험용 통과 코드 → 데모 차에 연결
  const [pair] = isPassCode(code)
    ? [{ car_id: await demoCarId() }]
    : await sql<{ car_id: string }[]>`
        delete from pair_codes where code = ${code.toUpperCase()} and expires_at > now() returning car_id`;
  if (!pair) return Response.json({ error: "코드가 맞지 않거나 10분이 지났어요. 차 화면의 QR을 다시 찍어 주세요." }, { status: 404 });

  const token = newToken();
  const nick = NICKNAMES.includes(nickname ?? "") ? nickname! : "가족";
  await sql`insert into phones (car_id, token_hash, nickname) values (${pair.car_id}, ${hashToken(token)}, ${nick})`;
  // 앱은 토큰을 받아 기기 보안 저장소에 둔다. 웹은 쿠키로.
  if (app) return Response.json({ ok: true, token, nickname: nick });
  (await cookies()).set(PHONE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 180,
    path: "/",
  });
  return Response.json({ ok: true });
}
