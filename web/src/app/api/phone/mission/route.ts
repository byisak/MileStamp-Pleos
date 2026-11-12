import { sql } from "@/lib/db";
import { currentPhone } from "@/lib/auth";
import { place } from "@/lib/places";

// 미션 답 저장. 같은 폰은 한 미션에 한 줄(퀴즈·찾아보기를 따로 보내도 합쳐짐).
export async function POST(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const { eventId, choice, found } = (await req.json().catch(() => ({}))) as {
    eventId?: string; choice?: number; found?: boolean;
  };
  if (!eventId || !/^[0-9a-f-]{36}$/.test(eventId)) return Response.json({ error: "bad event" }, { status: 400 });
  const [ev] = await sql<{ place_id: string }[]>`
    select place_id from events where id = ${eventId} and car_id = ${phone.car_id} and kind = 'mission'`;
  const p = place(ev?.place_id);
  const mission = p?.mission;
  if (!mission) return Response.json({ error: "not found" }, { status: 404 });
  const correct = typeof choice === "number" ? choice === mission.quiz.answer : null;
  await sql`
    insert into mission_results (event_id, phone_id, answer, correct)
    values (${eventId}, ${phone.id}, ${sql.json({ choice: choice ?? null, found: !!found })}, ${correct})
    on conflict (event_id, phone_id) do update set
      -- 퀴즈 답과 찾아보기를 따로 보내므로, 이번에 안 보낸 쪽(choice가 null)은 전에 낸 값을 지킨다
      answer = jsonb_build_object(
        'choice', coalesce(nullif(excluded.answer->'choice', 'null'::jsonb), mission_results.answer->'choice'),
        'found', excluded.answer->'found'),
      correct = coalesce(excluded.correct, mission_results.correct),
      created_at = now()`;
  return Response.json({ correct, answer: mission.quiz.answer });
}
