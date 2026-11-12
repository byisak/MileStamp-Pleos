import { whoFromRequest } from "@/lib/plan";
import { moveCourse } from "@/lib/schedule";

/**
 * 정한 코스를 다른 날로 옮기기 — 폰·차 공용.
 *   POST /api/plan/schedule/move { planId, toDay: 'YYYY-MM-DD', replace?: true }
 *   같은 곳·같은 순서·정한 머무름으로 그날 시간표를 새로 짠다(그날 08:30 집에서, 오늘이면 지금 — 하늘·축제·운영 시각도 그날 것).
 *   원래 날 코스는 지운다(고르기 취소와 같음). 가족 폰에 알림(종류 plan, 옮긴 폰은 빼고).
 *   → 200 { ok, planId(새 계획), day, item(GET /api/plan/schedule upcoming 한 줄), replaced(바꾼 그날 계획 id | null), pushed }
 *   400 = 날짜가 틀림(지난 날·2주 넘음·같은 날·지난 나들이) · 404 = 계획·코스 없음
 *   409 { error: 'conflict', message, existing:{planId, day, title, stops} } = 그날 이미 정한 코스가 있음 → replace:true로 다시
 *   409 { error: 'closed', message, closed:[이름] } = 그날 쉬는 곳 · 409 { error: 'no_fit', message } = 그날은 시간이 안 맞음
 *   409 { error: 'started', message } = 이미 다녀온 곳이 있는 코스
 */
export async function POST(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { planId?: unknown; toDay?: unknown; replace?: unknown };
  if (typeof body.planId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.planId)) {
    return Response.json({ error: "bad", message: "planId가 필요해요" }, { status: 400 });
  }
  const r = await moveCourse(who, body.planId, body.toDay, body.replace === true);
  if (!r.ok) {
    const { status, ok: _ok, ...rest } = r;
    void _ok;
    return Response.json(rest, { status });
  }
  const { ok: _ok, ...rest } = r;
  void _ok;
  return Response.json({ ok: true, ...rest });
}
