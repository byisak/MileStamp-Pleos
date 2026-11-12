import { sql } from "@/lib/db";
import { carFromRequest, newPairCode } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";

// 차 화면 QR: 10분짜리 1회용 코드 + 폰이 열 주소
export async function POST(req: Request) {
  const car = await carFromRequest(req);
  if (!car) return Response.json({ error: "unauthorized" }, { status: 401 });
  await sql`delete from pair_codes where car_id = ${car.id} or expires_at < now()`;
  const code = newPairCode();
  const [row] = await sql<{ expires_at: Date }[]>`
    insert into pair_codes (code, car_id, expires_at) values (${code}, ${car.id}, now() + interval '10 minutes')
    returning expires_at`;
  return Response.json({ code, url: `${publicOrigin(req)}/join?c=${code}`, expiresAt: row.expires_at });
}
