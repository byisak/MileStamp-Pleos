import { whoFromRequest } from "@/lib/plan";
import { hhmm } from "@/lib/planner";
import { dismissProposal, loadCourseRow } from "@/lib/course";

/**
 * 제안 카드 거절('그대로 갈게요') — 폰·차 공용.
 *   POST /api/plan/course/dismiss { version, atMin? }
 * 폰이 본 코스 버전(+ 제안을 낸 시각 atMin, "HH:MM" 글도 받음)이 저장된 것과 같으면 plans.course_proposal을 비운다.
 * 코스·버전은 그대로(엔진 사건이 아님 — 차의 SignalEvent.ProposalDismissed처럼 카드만 치움). 다른 가족 폰엔 조용한 course_update.
 * 답: GET /api/plan/course와 같은 모양 + dismissed(지웠으면 true, 이미 없었으면 false). 그새 바뀌었으면 409 + { course, version, proposal }.
 */
export async function POST(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { version?: unknown; atMin?: unknown };
  if (!Number.isInteger(body.version)) return Response.json({ error: "version(정수)이 필요해요" }, { status: 400 });
  let atMin: number | null = null;
  if (Number.isInteger(body.atMin)) atMin = body.atMin as number;
  else if (typeof body.atMin === "string") {
    try { atMin = hhmm(body.atMin); } catch { return Response.json({ error: "atMin은 분(정수) 또는 HH:MM" }, { status: 400 }); }
  } else if (body.atMin != null) return Response.json({ error: "atMin은 분(정수) 또는 HH:MM" }, { status: 400 });
  const row = await loadCourseRow(who.carId);
  if (!row) return Response.json({ error: "오늘 고른 코스가 없어요" }, { status: 404 });
  const r = await dismissProposal(who, row, body.version as number, atMin);
  if (!r.ok) return Response.json({ error: r.error, course: r.course, version: r.version, proposal: r.proposal }, { status: r.status });
  return Response.json(r.body);
}
