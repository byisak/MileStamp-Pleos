import { sql } from "@/lib/db";
import { currentPhone } from "@/lib/auth";

// 미션 목록 + 이 폰이 낸 답 (최근 것부터 50개)
export async function GET(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const missions = await sql<{ id: string; place_id: string; created_at: Date; answer: { choice: number | null; found: boolean } | null; correct: boolean | null }[]>`
    select e.id, e.place_id, e.created_at, r.answer, r.correct
    from events e left join mission_results r on r.event_id = e.id and r.phone_id = ${phone.id}
    where e.car_id = ${phone.car_id} and e.kind = 'mission'
    order by e.created_at desc limit 50`;
  return Response.json({ missions });
}
