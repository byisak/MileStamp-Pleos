import { whoFromRequest } from "@/lib/plan";
import { hhmm } from "@/lib/planner";
import { ctxFromJson } from "@/lib/livecourse";
import { adoptOption, loadCourseRow } from "@/lib/course";

/**
 * 제안 카드 채택 — 폰·차 공용.
 *   POST /api/plan/course/adopt { version, optionIdx, now?: "HH:MM", driving?, here? }
 * 마지막 PATCH 답이 Proposal이었을 때 그 카드(optionIdx 번째)대로 코스를 바꾼다(엔진 adopt). 카드가 없거나 번호가 틀리거나
 * 제안이 지났으면(권한 출발 시각이 now보다 앞 등 — 엔진 proposalExpired) 404. now가 없으면 서버 시각(오늘이 아닌 계획은 제안 시각),
 * 버전이 낮으면 409 + { course, version, proposal }. 답은 PATCH와 같은 모양(Retimed 또는 HomeNow).
 */
export async function POST(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { version?: unknown; optionIdx?: unknown; now?: unknown; driving?: unknown; here?: unknown };
  if (!Number.isInteger(body.version)) return Response.json({ error: "version(정수)이 필요해요" }, { status: 400 });
  if (!Number.isInteger(body.optionIdx) || (body.optionIdx as number) < 0) return Response.json({ error: "optionIdx(0부터)가 필요해요" }, { status: 400 });
  let nowMin: number | null = null;
  if (body.now != null) {
    if (typeof body.now !== "string") return Response.json({ error: "now는 HH:MM" }, { status: 400 });
    try { nowMin = hhmm(body.now); } catch { return Response.json({ error: "now는 HH:MM" }, { status: 400 }); }
  }
  let ctx;
  try { ctx = ctxFromJson({ driving: body.driving, here: body.here }); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  const row = await loadCourseRow(who.carId);
  if (!row) return Response.json({ error: "오늘 고른 코스가 없어요" }, { status: 404 });
  const r = await adoptOption(who, row, body.version as number, body.optionIdx as number, nowMin, ctx);
  if (!r.ok) return Response.json({ error: r.error, course: r.course, version: r.version, proposal: r.proposal }, { status: r.status });
  return Response.json({ ...r.outcome, version: r.version, planId: row.id, pushed: r.pushed });
}
