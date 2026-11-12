import { sql, type EventRow } from "@/lib/db";
import { currentPhone } from "@/lib/auth";

// 푸시가 없는 폰(데모·아이폰 홈 화면 미추가)은 이걸 3초마다 확인한다.
export async function GET(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const after = new URL(req.url).searchParams.get("after");
  const since = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : new Date(Date.now() - 12 * 3600_000);
  const events = await sql<EventRow[]>`
    select id, kind, place_id, payload, created_at from events
    where car_id = ${phone.car_id} and created_at > ${since}
    order by created_at desc limit 30`;
  return Response.json({ events });
}
