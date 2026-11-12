import { kst } from "@/lib/kst";
import { whoFromRequest } from "@/lib/plan";
import { regenDiary } from "@/lib/diary";
import { diaryDayError, isTone } from "@/lib/diary-shape";

/** 글 AI가 늦을 때를 위해 (AI는 25초 제한, 넘으면 기본 문장) */
export const maxDuration = 60;

/** '다시 쓰기' — POST /api/diary/regen { day, tone } → GET /api/diary와 같은 모양 (그 말투 글만 새로). 설명은 ../route.ts */
export async function POST(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { day?: unknown; tone?: unknown };
  const err = diaryDayError(body.day, kst(new Date()).day);
  if (err) return Response.json({ error: err }, { status: 400 });
  if (!isTone(body.tone)) return Response.json({ error: "tone은 parent 또는 child예요" }, { status: 400 });
  const r = await regenDiary(who.carId, body.day as string, body.tone);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r.view);
}
