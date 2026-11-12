import { sql } from "@/lib/db";
import { iGa, whoFromRequest, type OptionJson, type SkyJson } from "@/lib/plan";
import { pushToCar } from "@/lib/push";
import { clearCourse, startCourse } from "@/lib/course";
import { courseChoice, withOption } from "@/lib/choose";
import { editCtx } from "@/lib/choose-ctx";

/**
 * 오늘 계획에서 카드 고르기 — 폰·차 공용.
 *   POST /api/plan/choose { planId, idx }   (idx: null이면 고른 것 취소)
 *   POST /api/plan/choose { planId, stops: ["hwabon","samguk","dgsm"] }   — 모든 차(폰 '코스 편집'·데모 시연): 정한 순서(1~3곳)로
 *     '고른 코스' 카드를 짜서(planner.course = 엔진 Planner.course, 계획의 시각·위치·하늘·모드 그대로) 계획 카드 끝에 붙이고
 *     (같은 순서 카드가 있으면 그것) 그 번호를 고른 것과 같다. 모르는 장소·중복·4곳 이상·시간이 안 맞으면 400.
 *     dwell {장소 id: 분}(선택)을 주면 그 머무름으로 짜고 맞는지 본다 — 코스의 '오늘만 정함' 표시는 고른 뒤 사건 SetDwell로 (미리 보기 POST /api/plan/preview).
 *     stops 한 칸은 바깥 장소 {id:'ext:tour:<번호>', name, lat, lng, indoor?, dwell?, open?, close?, kidFit?}도 된다 (lib/ext.ts 기본값: 머무름 90분·10~18시·아이 0.6·도장 없음).
 *     anchor: 장소 id (앵커 코스 카드 — POST /api/plan/anchor) = 그곳은 긴 이동·문 열기 기다림·비를 봐주고, 귀가 한계를 넘어도 받는다(카드 overLimit).
 *       제목은 '○○ 중심으로'. 한계를 넘는 카드를 고른 폰은 그다음 PATCH /api/plan/course SetEnd {limit}로 오늘만 한계를 늦춘다.
 * 고르면 같은 차의 가족 폰에 알림(종류 plan, 고른 폰은 빼고). 차는 다음 조회(GET /api/plan) 때 받는다.
 * 고른 카드는 '살아 있는 코스'(plans.course, 버전 1)로도 저장 → 그 뒤 사건은 PATCH /api/plan/course. 취소하면 코스도 없앤다.
 */
export async function POST(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { planId?: unknown; idx?: unknown; stops?: unknown; dwell?: unknown; anchor?: unknown };
  if (typeof body.planId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.planId)) {
    return Response.json({ error: "planId가 필요해요" }, { status: 400 });
  }
  const [plan] = await sql<{
    id: string; options: OptionJson[]; chosen: number | null; chosen_by: string | null;
    origin_cell: string; now_at: Date; sky: SkyJson | null; back_by: number | null; mode: string; companion: string | null;
  }[]>`
    select id, options, chosen, chosen_by, origin_cell, now_at, sky, back_by, mode, companion from plans where id = ${body.planId} and car_id = ${who.carId}`;
  if (!plan) return Response.json({ error: "계획을 찾지 못했어요" }, { status: 404 });

  const by = who.phone ? `폰:${who.phone.nickname}` : "차";
  if (body.idx === null) {
    await sql`update plans set chosen = null, chosen_by = null, chosen_at = null where id = ${plan.id}`;
    await clearCourse(plan.id);
    return Response.json({ ok: true, planId: plan.id, chosen: null, chosenBy: null, pushed: 0 });
  }
  if (body.stops !== undefined) {
    // 정한 장소 순서로 카드를 짜서 붙인다 (계획을 만든 시각·위치·하늘·모드 + 오늘 가족 설정)
    const ctx = await editCtx(who.carId, who.demo, plan);
    if (body.anchor != null && typeof body.anchor !== "string") return Response.json({ error: "anchor는 장소 id" }, { status: 400 });
    const c = courseChoice(body.stops, ctx.find, ctx.nowMin, ctx.here, ctx.profile, ctx.sky, ctx.mode, body.dwell, (body.anchor as string | undefined) ?? null);
    if (!c.ok) return Response.json({ error: c.error }, { status: c.status });
    const added = withOption(plan.options, c.option);
    if (added.options !== plan.options) {
      await sql`update plans set options = ${sql.json(added.options as never)} where id = ${plan.id}`;
      plan.options = added.options;
    }
    body.idx = added.idx;
  }
  const idx = body.idx;
  if (!Number.isInteger(idx) || (idx as number) < 0 || (idx as number) >= plan.options.length) {
    return Response.json({ error: `idx는 0~${plan.options.length - 1}` }, { status: 400 });
  }
  const option = plan.options[idx as number];
  const same = plan.chosen === idx && plan.chosen_by === by;
  await sql`update plans set chosen = ${idx as number}, chosen_by = ${by}, chosen_at = now() where id = ${plan.id}`;
  // 고른 카드 → 살아 있는 코스 (버전 1). 같은 카드를 다시 눌러도 새로 시작한다(그날의 진행은 차·폰이 사건으로 다시 채움)
  const course = await startCourse(plan.id, option, plan, by, who.carId);

  // 같은 사람이 같은 카드를 다시 누르면 알리지 않는다
  let pushed = 0;
  if (!same) {
    const nick = who.phone?.nickname;
    const title = nick ? `${nick}${iGa(nick)} 오늘 코스를 골랐어요` : "차에서 오늘 코스를 골랐어요";
    const body = option.stops.length ? option.stops.map((s) => s.name).join(" → ") + ` · ${option.arriveHome} 귀가` : option.label;
    pushed = await pushToCar(
      who.carId,
      { title, body, url: "/", tag: "plan" },
      { kind: "plan", planId: plan.id, idx: String(idx), chosenBy: by, courseVersion: String(course?.version ?? 0), course: course ? JSON.stringify(course) : "" },
      { except: who.phone?.id },
    );
  }
  return Response.json({ ok: true, planId: plan.id, chosen: idx, chosenBy: by, pushed, course, courseVersion: course?.version ?? 0 });
}
