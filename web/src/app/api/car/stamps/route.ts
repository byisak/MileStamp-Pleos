import { sql } from "@/lib/db";
import { carFromRequest } from "@/lib/auth";

// 차 도장북: 이 차가 지금까지 찍은 도장 전부 (오래된 순) — 폰 /api/phone/stamps와 같은 행
export async function GET(req: Request) {
  const car = await carFromRequest(req);
  if (!car) return Response.json({ error: "unauthorized" }, { status: 401 });
  const stamps = await sql<{ id: string; place_id: string; payload: Record<string, unknown>; created_at: Date }[]>`
    select id, place_id, payload, created_at from events
    where car_id = ${car.id} and kind = 'stamp' order by created_at`;
  return Response.json({ stamps });
}
