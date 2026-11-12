import { sql } from "@/lib/db";
import { currentPhone } from "@/lib/auth";

// 도장북: 이 차가 지금까지 찍은 도장 전부 (오래된 순)
export async function GET(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const stamps = await sql<{ id: string; place_id: string; payload: Record<string, unknown>; created_at: Date }[]>`
    select id, place_id, payload, created_at from events
    where car_id = ${phone.car_id} and kind = 'stamp' order by created_at`;
  return Response.json({ stamps });
}
