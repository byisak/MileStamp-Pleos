import { sql } from "@/lib/db";
import { kst } from "@/lib/kst";
import { anchored, asHhmm, parseCompanion, type Companion, type Place } from "@/lib/planner";
import { optionJsonOf, whoFromRequest, type OptionJson, type SkyJson } from "@/lib/plan";
import { contextPlan, editCtx } from "@/lib/choose-ctx";
import { extPlace } from "@/lib/ext";
import { retimeForPhone } from "@/lib/route";
import { engineRestaurants } from "@/lib/catalog";

/**
 * '○○ 중심으로 코스 짜기' (docs/직접-고르기-계획.md 3·4·7절) — 폰·차 공용, 저장은 문맥용 계획 줄만.
 *   POST /api/plan/anchor { anchor: {kind:'place'|'festival'|'tour', id, name, lat, lng, dwell?, indoor?, open?, close?}, day?, planId? }
 *   - kind 'place' = 우리 명소 id · 'festival' = 등록 축제 'fest-…' (그날 열리는 것만) · 'tour' = 바깥 장소 'ext:tour:…'·'ext:kakao:…'·'ext:pin:<lat>,<lng>'
 *     (이름·좌표 필수, 기본 머무름 90분·운영 10:00~18:00·아이 0.6·도장 없음 — lib/ext.ts). open·close는 분 또는 'HH:MM'
 *   - dwell = 앵커에서 머무는 분(15~360, 5분 단위). 없으면 축제 120분 · 그 밖은 우리 가족 머무름
 *   - planId(선택) = 이 계획의 시각·위치·하늘로 짠다. 없으면 오늘(데모 차는 앞으로 날짜 포함) 가장 최근 계획
 *   - with(선택) 누구랑 가요? kids·couple·friends·solo — 이 앵커 코스의 동행 (없으면 문맥 계획의 동행 → 가족 설정). 문맥 계획에 그 동행을 적어 둔다(고르기·미리 보기가 같은 동행)
 *   - meal(선택) true·false = 밥 자리 넣기 (없으면 가족 설정 '밥도 같이 짜기'). 켜면 카드마다 meal·mealHint (GET /api/plan과 같음)
 *   - day(선택) 'YYYY-MM-DD' = 그 계획과 다른 날이면(예: 토요일 축제를 미리) 그날 08:30 집에서 출발하는 새 문맥 계획을 만든다(오늘이면 지금 시각)
 * 답 = GET /api/plan과 같은 모양 { planId, day, companion, plan:{mode, now, nowMin, budgetMin, backByMin, options}, sky, backBy } +
 *   anchor {kind, id, name, dwell, oneWayMin, overnight('1박은 아직 몰라요'), closed(오늘은 못 감)}.
 *   카드(최대 3장): '가는 길에 한 곳 더' · '근처 한 곳 더' · '여기만 · 여유 있게'. 여기만도 귀가 한계를 넘으면 그 카드 하나만 overLimit:true
 *   (폰이 '오늘만 귀가 한계 늦추기'를 묻는다). 카드마다 anchorId·why(왜?).
 * 고르기 = POST /api/plan/choose { planId(이 답의), stops(카드 순서 — 바깥 장소는 {id, name, lat, lng, …ext}), dwell:{앵커 id: 분}, anchor: 앵커 id }.
 */

type PlanRow = { id: string; day: string; mode: string; origin_cell: string; now_at: Date; sky: SkyJson | null; options: OptionJson[]; companion: string | null };

function bad(error: string, status = 400) {
  return Response.json({ error }, { status });
}

export async function POST(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return bad("unauthorized", 401);
  const body = (await req.json().catch(() => null)) as { anchor?: Record<string, unknown>; day?: unknown; planId?: unknown; with?: unknown; meal?: unknown } | null;
  const a = body?.anchor;
  if (!a || typeof a !== "object") return bad("anchor가 필요해요");
  const kind = a.kind;
  if (kind !== "place" && kind !== "festival" && kind !== "tour") return bad("anchor.kind는 place·festival·tour예요");
  if (typeof a.id !== "string" || !a.id) return bad("anchor.id가 필요해요");
  if (a.dwell != null && (typeof a.dwell !== "number" || !Number.isFinite(a.dwell) || a.dwell < 15 || a.dwell > 360)) return bad("dwell은 15~360분이에요");
  if (body!.day != null && (typeof body!.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body!.day))) return bad("day는 YYYY-MM-DD예요");
  if (body!.planId != null && (typeof body!.planId !== "string" || !/^[0-9a-f-]{36}$/i.test(body!.planId))) return bad("planId가 이상해요");
  if (body!.meal != null && typeof body!.meal !== "boolean") return bad("meal은 true·false예요");
  const withC = body!.with != null ? parseCompanion(body!.with) : null;
  if (body!.with != null && !withC) return bad("with는 kids·couple·friends·solo 중 하나예요");

  const today = kst(new Date()).day;
  // 문맥 계획: 주어진 planId → 오늘(데모 차는 앞 날짜도) 가장 최근 계획
  const [last] = body!.planId
    ? await sql<PlanRow[]>`
        select id, day::text as day, mode, origin_cell, now_at, sky, options, companion from plans where id = ${body!.planId as string} and car_id = ${who.carId}`
    : await sql<PlanRow[]>`
        select id, day::text as day, mode, origin_cell, now_at, sky, options, companion from plans
        where car_id = ${who.carId} and day >= ${today} order by created_at desc limit 1`;
  if (body!.planId && !last) return bad("계획을 찾지 못했어요", 404);
  const day = (body!.day as string | undefined) ?? last?.day ?? today;
  if (day < today && !who.demo) return bad("지난 날은 짤 수 없어요");
  let row = last && last.day === day ? last : null;
  if (!row) row = await contextPlan(who.carId, who.demo, day, today, last?.origin_cell ?? null, withC);
  if (!row) return bad("위치를 몰라요 — 먼저 오늘 추천을 한 번 받아 주세요");
  // 동행: with → 문맥 계획의 동행 → 가족 설정 (editCtx). with가 다르면 계획 줄에 적어 고르기·미리 보기가 같은 동행으로 짜게
  if (withC && withC !== row.companion) {
    await sql`update plans set companion = ${withC} where id = ${row.id}`;
    row = { ...row, companion: withC };
  }

  const ctx = await editCtx(who.carId, who.demo, row);
  let anchor: Place | null;
  if (kind === "tour") {
    const p = extPlace(a);
    if (typeof p === "string") return bad(p);
    anchor = p;
  } else {
    anchor = ctx.find(a.id) ?? null;
    if (!anchor) return bad(kind === "festival" ? "그날 열리는 축제가 아니에요" : "모르는 장소예요", 404);
    if (kind === "festival" && !anchor.festival) return bad("축제 id가 아니에요");
  }

  const companion: Companion = parseCompanion(row.companion) ?? ctx.profile.companion ?? "kids";
  const mealOn = (body!.meal as boolean | undefined) ?? ctx.mealPlan;
  const planProfile = mealOn ? { ...ctx.profile, meal: { restaurants: await engineRestaurants(), day } } : ctx.profile;
  const r = anchored(ctx.nowMin, ctx.here, planProfile, ctx.catalog, anchor, (a.dwell as number | undefined) ?? null, ctx.sky, day);
  // 새로 만든 문맥 계획엔 귀가 한계·여유를 채워 둔다 (고르면 살아 있는 코스의 한계가 이 값)
  await sql`update plans set back_by = coalesce(back_by, ${r.plan.backByMin}), budget = coalesce(budget, ${Math.min(r.plan.budgetMin, 32000)}) where id = ${row.id}`;
  const why = { nowMin: ctx.nowMin, here: ctx.here, sky: ctx.sky };
  // 카드의 머무름 칩·'왜?'도 앵커 머무름(정한 값)으로
  const prof = { ...ctx.profile, dwellSet: { ...(ctx.profile.dwellSet ?? {}), [anchor.id]: r.anchorDwellMin } };
  const est = r.plan.options.map((o) => ({ ...optionJsonOf(o, prof, why), anchorId: anchor!.id }));
  // 폰에 보내는 카드만 실제 길(카카오모빌리티)로 다시 잰다 — 엔진 찾기·고르기는 어림 그대로 (lib/route.ts)
  const options = who.phone ? await retimeForPhone(est, { day, here: ctx.here, home: ctx.home, backByMin: r.plan.backByMin }) : est;
  return Response.json({
    planId: row.id,
    day,
    companion,
    anchor: { kind, id: anchor.id, name: anchor.name, dwell: r.anchorDwellMin, oneWayMin: r.oneWayMin, overnight: r.overnight, closed: r.closed },
    plan: { mode: r.plan.mode, now: asHhmm(ctx.nowMin), nowMin: ctx.nowMin, budgetMin: r.plan.budgetMin, backByMin: r.plan.backByMin, options },
    sky: row.sky,
    backBy: asHhmm(r.plan.backByMin),
    meal: mealOn,
  });
}
