import { kst } from "@/lib/kst";
import { whoFromRequest } from "@/lib/plan";
import { editDiary, getDiary } from "@/lib/diary";
import { diaryDayError, editText, isTone } from "@/lib/diary-shape";

/** 글 AI가 늦을 때를 위해 (AI는 25초 제한, 넘으면 기본 문장) */
export const maxDuration = 60;

/**
 * '그날의 기록'(자동 일기) — 폰(Bearer 폰 토큰)·차 공용.
 *   GET   /api/diary?day=YYYY-MM-DD   (없으면 오늘)
 *     → { day, facts, story: { parent, child, generatedAt, by: {parent, child} }, done }
 *     facts = { day, dateText, weather:{sky,label}|null, companion, depart:{min, approx}|null,
 *               stops:[{placeId, name, lat, lng, arriveMin, departMin, stayMin, stamps:[도장 id]}],
 *               stamps:[{id, placeId, key, number, rare, festivalId, name, atMin}],
 *               drive:{km, min, approx}|null, nap:{min, fromMin}|null, homeMin, done }
 *     done = 차가 집 도착(오늘 요약)을 보냈거나 지난 날. done이면 글을 하루 한 번 만들어 저장(AI, 안 되면 사실로 만든 기본 문장).
 *     아직이면 story 칸은 모두 null (폰: '오늘 기록 중… 집에 도착하면 완성돼요').
 *   PATCH /api/diary { day, tone: 'parent'|'child', text }  → 같은 모양 (사람이 고친 글, by 'edit')
 *   POST  /api/diary/regen { day, tone }                   → 같은 모양 (그 말투만 다시 쓰기)
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const today = kst(new Date()).day;
  const day = new URL(req.url).searchParams.get("day") || today;
  const err = diaryDayError(day, today);
  if (err) return Response.json({ error: err }, { status: 400 });
  const v = await getDiary(who.carId, day);
  return Response.json({ day: v.day, facts: v.facts, story: v.story, done: v.done });
}

export async function PATCH(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { day?: unknown; tone?: unknown; text?: unknown };
  const err = diaryDayError(body.day, kst(new Date()).day);
  if (err) return Response.json({ error: err }, { status: 400 });
  if (!isTone(body.tone)) return Response.json({ error: "tone은 parent 또는 child예요" }, { status: 400 });
  const t = editText(body.text);
  if (!t.ok) return Response.json({ error: t.error }, { status: 400 });
  const r = await editDiary(who.carId, body.day as string, body.tone, t.text);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r.view);
}
