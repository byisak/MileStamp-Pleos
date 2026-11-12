import { retimeForPhone } from "@/lib/route";
import { kst } from "@/lib/kst";
import { sql } from "@/lib/db";
import { whoFromRequest, type OptionJson, type SkyJson } from "@/lib/plan";
import { coursePreview, parseDwell, parseStops, placeCandidates } from "@/lib/choose";
import { editCtx } from "@/lib/choose-ctx";
import { engineFor, loadCourseRow, simulateEdit } from "@/lib/course";

/**
 * 코스 편집 미리 보기 — 폰·차 공용, 아무것도 저장하지 않는다.
 *   POST /api/plan/preview { planId, stops: ["hwabon", …] (1~3곳), dwell?: { "hwabon": 60 }, places?: true }
 *   → { ok, option(카드 JSON: legs·arriveHome·장소별 dwell), limitMin, limit("HH:MM"), over, overMin, fits, places? }
 *     계획을 만든 시각·위치·하늘·모드(오후면 저녁 시각까지)로 planner.course()(= 엔진 Planner.course)를 돌린다.
 *     dwell = 오늘만 머무름(15~360분, 5분 단위로 맞춤). over = 귀가 한계(안전 10분 포함)를 넘음 — 그래도 시간표는 준다.
 *     fits = 이 순서·머무름으로 POST /api/plan/choose {stops, dwell}가 받아 주는지(안전 여유 10분까지).
 *     places: true면 더할 곳 후보(지금 코스에서 가까운 순 40곳: id·name·indoor·stampable·dwell·km)도 같이.
 *   모르는 장소·중복·4곳 이상·문 닫는 시각 등으로 시간표가 안 나오면 400 {error} (places: true면 후보는 같이 준다).
 *   anchor: 장소 id = 앵커 코스('○○ 중심으로') 고치기 — choose {anchor}와 같은 규칙(그곳은 봐줌, 귀가 한계를 넘어도 fits). stops에 없으면 400.
 *   live: true = 이미 다녀온 곳이 있는 살아 있는 코스: stops는 '남은 곳' 순서. 지금 코스에 Remote(남은 순서) + SetDwell을 메모리에서만
 *     적용한 결과 → { ok, live: true, course(코스 JSON), arriveHomeMin, limitMin, limit, over, overMin, fits: true }.
 */
export async function POST(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { planId?: unknown; stops?: unknown; dwell?: unknown; places?: unknown; live?: unknown; anchor?: unknown };
  if (typeof body.planId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.planId)) {
    return Response.json({ error: "planId가 필요해요" }, { status: 400 });
  }
  const [plan] = await sql<{ origin_cell: string; now_at: Date; sky: SkyJson | null; mode: string; options: OptionJson[]; companion: string | null }[]>`
    select origin_cell, now_at, sky, mode, options, companion from plans where id = ${body.planId} and car_id = ${who.carId}`;
  if (!plan) return Response.json({ error: "계획을 찾지 못했어요" }, { status: 404 });
  if (body.live === true) return live(who, body.planId, body.stops, body.dwell);
  const ctx = await editCtx(who.carId, who.demo, plan);
  const places = body.places === true
    ? placeCandidates(ctx.catalog, [ctx.here, ...(Array.isArray(body.stops) ? body.stops : []).map((id) => ctx.find(String(id))?.at).filter((x) => x != null), ctx.home], ctx.profile)
    : undefined;
  if (body.anchor != null && typeof body.anchor !== "string") return Response.json({ error: "anchor는 장소 id", places }, { status: 400 });
  const r = coursePreview(body.stops, body.dwell, ctx.find, ctx.nowMin, ctx.here, ctx.profile, ctx.sky, ctx.mode, (body.anchor as string | undefined) ?? null);
  if (!r.ok) return Response.json({ error: r.error, places }, { status: r.status });
  // 폰 편집 미리 보기도 카드·코스 지도와 같은 실제 길 시간으로 (lib/route.ts — 같은 길은 저장돼 있어 다시 안 부름)
  if (who.phone && r.option) {
    const [option] = await retimeForPhone([r.option], { day: kst(plan.now_at).day, here: ctx.here, home: ctx.home, backByMin: r.limitMin });
    const safe = r.limitMin - 10; // choose.ts coursePreview와 같은 안전 10분
    const home = option.arriveHomeMin;
    return Response.json({ ...r, option, over: home > safe, overMin: Math.max(0, home - safe), fits: r.fits, places });
  }
  return Response.json({ ...r, places });
}

async function live(who: NonNullable<Awaited<ReturnType<typeof whoFromRequest>>>, planId: string, stops: unknown, dwell: unknown) {
  const row = await loadCourseRow(who.carId);
  if (!row || row.id !== planId || !row.course) return Response.json({ error: "이 계획엔 진행 중인 코스가 없어요" }, { status: 404 });
  const eng = await engineFor(who.carId, null, row.origin_cell, row.day, row.companion);
  const ps = parseStops(stops, eng.find);
  if (!ps.ok) return Response.json({ error: ps.error }, { status: ps.status });
  const pd = parseDwell(dwell, ps.places.map((p) => p.id));
  if (!pd.ok) return Response.json({ error: pd.error }, { status: pd.status });
  try {
    const c = simulateEdit(eng, row, ps.places.map((p) => p.id), pd.dwell, who.phone ? `폰:${who.phone.nickname}` : "차");
    const overMin = Math.max(0, c.arriveHomeMin - c.limitMin);
    const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return Response.json({ ok: true, live: true, course: c, arriveHomeMin: c.arriveHomeMin, limitMin: c.limitMin, limit: hh(c.limitMin), over: overMin > 0, overMin, fits: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
