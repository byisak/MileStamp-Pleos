import { profileWithDwell } from "@/lib/dwell";
import { sql } from "@/lib/db";
import { kst, parseAt } from "@/lib/kst";
import {
  asHhmm, firstBoarding, hhmm, isEvening, isNight, EVENING_PREFIX, MAX_STOPS, parseCompanion, type AirLevel, type Companion, type LatLng, type Sky, type SkyToday,
} from "@/lib/planner";
import { retimeForPhone } from "@/lib/route";
import {
  DEFAULT_FAMILY, familyHome, DEMO_HOME_CELL, cellOf, hereOf, loadFamily, modeAt, optionsJson, parseCell, skyJson, toProfile, whoFromRequest,
  type OptionJson, type SkyJson,
} from "@/lib/plan";
import { skyToday, type SkyInfo } from "@/lib/sky";
import type { CourseJson } from "@/lib/livecourse";
import { courseView, skyOfRow, type ProposalJson } from "@/lib/course";
import { addDays } from "@/lib/festival-shape";
import { candidatePlaces } from "@/lib/festivals";
import { profileWithHistory } from "@/lib/history";
import { engineRestaurants } from "@/lib/catalog";
import { missingStructure } from "@/lib/plan";

/**
 * 오늘 어디 갈까요? — 폰(Bearer 폰 토큰)·차(Bearer 차 토큰) 공용. 차마다 '오늘 계획' 하나를 같이 본다.
 *   GET /api/plan?lat=35.8858&lng=128.5828[&home=35.8858,128.5828]
 *   - lat·lng: 지금 위치. 소수 둘째 자리(약 1km)로 깎아 계산하고 칸 글자만 저장. 없으면 이 차의 마지막 계획 칸 → 집 칸
 *   - home: 차가 아는 집 (칸으로 깎아 가족 설정에 저장). 없으면 저장된 집 칸 → 데모 차는 북구청 → 지금 위치를 집으로
 *     단, 폰에서 집을 정했으면(우리 가족 → 집 위치, 소수 셋째 자리) 그 집으로 계산하고 home=은 무시한다
 *   - 데모 차만: at=2026-10-31T08:30 (시각 지정, 시간대 없으면 한국 시간) · sky=RAIN|CLEAR|SNOW|UNKNOWN · rainFrom=15:00 ·
 *     sunset=17:41 · air=GOOD|NORMAL|BAD|VERY_BAD (하늘·미세먼지 지정, 시연 영상·개발 모드 장면용) · fresh=1 (새로 계산)
 *   - with(선택): 누구랑 가요? kids·couple·friends·solo — 이 계획만 이 동행으로(없으면 가족 설정의 마지막 동행). 폰이 보내면 마지막 동행으로 기억
 *   - day(선택) 'YYYY-MM-DD': 다른 날(내일·주말) 계획 — 그날 08:30 집에서 출발로 짠다(앵커의 다른 날과 같음). 오늘이면 지금 시각
 *   - maxStops(선택) 1~3: 코스 한 장에 넣을 곳 수 한도 (폰 '가볍게 한 곳만' = 1, 대화의 다른 답은 3, 없으면 3). 오후 계획은 늘 한 곳.
 *     폰이 보내면 그 한도에 맞는 계획만 다시 쓴다(한 곳짜리 아침 계획은 maxStops 2·3 물음에 안 씀)
 * 응답 companion = 이 계획의 동행 · tomorrowHint = 밤이라 오늘은 더 갈 곳이 없음(아이와: 귀가 한계·해 진 뒤, 어른: 22:00 뒤) → 폰이
 *   '내일 계획 짜기'를 보여 준다(카드는 '바로 집으로'·'오늘은 쉬어요' 하나 — 1순위로 보이지 말 것), tomorrow = 다음 날 'YYYY-MM-DD'.
 *   카드마다 pick = short·full·nap·indoor·popular·near·home·evening·drive (폰 대화 답과 맞추기). kind는 예전 그대로 COURSE·NEARBY·HOMEWARD·GO_HOME.
 * 저녁 나들이(11/3): 해 진 뒤 ~ 귀가 한계 90분 전(아이와 = 가족 '잠자는 시간', 어른끼리 = '늦어도 몇 시 귀가')이면 저녁 카드
 *   (label '저녁 · …', pick evening·drive) 2~3장 + 바로 집으로. 답에 evening = true · eveningLimit 'HH:MM'(그 귀가 한계) ·
 *   sky.sunsetTip(해가 이미 졌으면 '내일 노을 보러' 명소 하나). mode는 예전 차 앱 때문에 AFTERNOON 그대로.
 *   늦은 오후에 낮 카드가 하나도 없으면 저녁 카드가 붙는다(이때도 evening = true). 저녁 시간도 지나면 tomorrowHint.
 * 밥(11/3, docs/장소-데이터-구조-계획.md §4): meal(선택) 1·0 = 이 계획만 밥 자리 넣기 켬·끔 (없으면 가족 설정 '밥도 같이 짜기', 기본 끔).
 *   켜면 코스가 점심(11:30~13:30)·저녁(17:30~19:30) 때를 지날 때 켜진 식당 한 곳을 코스에 넣는다 — 카드마다 meal {restaurantId, placeId
 *   ('ext:food:<id>' — stops에도 있음), name, kind lunch·dinner, startMin, endMin, start 'HH:MM', index, detourMin, features, cuisine, text,
 *   alternatives[3]} 또는 mealHint('근처에 등록된 식당이 없어요' …). 밥 칸은 legs에 kind "STAY" + meal: true (옛 앱 호환). 답에 meal: 켬/끔.
 *   같은 밥 설정으로 짠 계획만 다시 쓴다(고른 계획은 그대로).
 * 응답 sky.air = {level, pm10, pm25, station, source:'airkorea'|'none'} (에어코리아 가까운 측정소, 키 없거나 실패하면 UNKNOWN·none)
 * 오늘 최신 계획이 같은 모드이고 (고른 계획이거나) 30분 안·같은 칸·그 뒤 새 도장 없음이면 그대로, 아니면 새로 계산해 저장.
 * 카드마다 why = 장소별 '왜?' 설명 줄(엔진 explainChoice — 실제 점수 항목을 쉬운 말로). 방문 기록(도장·다녀옴·즐겨찾기)으로 점수를 보완한다.
 * 고른 계획에 살아 있는 코스가 있으면 course(10절 JSON)·courseVersion·courseProposal·courseExplain(쉬운 설명)도 같이 (폰·차가 켤 때 바로 받게).
 */

const REUSE_MIN = 30;
const SKIES: Sky[] = ["CLEAR", "RAIN", "SNOW", "UNKNOWN"];
const AIRS: AirLevel[] = ["GOOD", "NORMAL", "BAD", "VERY_BAD", "UNKNOWN"];

type PlanRow = {
  id: string; day: string; mode: string; origin_cell: string; now_at: Date; options: OptionJson[]; sky: SkyJson | null;
  back_by: number; budget: number; chosen: number | null; chosen_by: string | null; created_at: Date;
  course: CourseJson | null; course_version: number; course_proposal: ProposalJson | null; companion: string | null;
  /** 밥 켬으로 짠 계획 (칸이 없는 DB면 null = 끔). */
  meal?: boolean | null;
};

function bad(error: string, status = 400) {
  return Response.json({ error }, { status });
}

/** 저녁 카드가 든 계획인가 (제목 '저녁 · …'). */
const eveningRow = (options: OptionJson[]) => options.some((o) => o.label.startsWith(EVENING_PREFIX));

async function respond(who: NonNullable<Awaited<ReturnType<typeof whoFromRequest>>>, row: PlanRow, reused: boolean, night: boolean, home: LatLng) {
  const now = kst(row.now_at);
  // 폰에 보내는 카드만 실제 길(카카오모빌리티)로 다시 잰다 — 저장된 계획·차가 받는 답은 엔진 어림 그대로 (lib/route.ts)
  const options = who.phone
    ? await retimeForPhone(row.options, { day: row.day, here: hereOf(row.origin_cell, home) ?? home, home, backByMin: row.back_by })
    : row.options;
  // 살아 있는 코스: 시간표가 뒤처졌으면 지금으로 다시 짜고(오늘 계획만) 쉬운 설명을 붙인다
  const cv = row.course ? await courseView(who, row) : null;
  return Response.json({
    planId: row.id,
    day: row.day,
    reused,
    companion: parseCompanion(row.companion) ?? "kids",
    tomorrowHint: night,
    ...(night ? { tomorrow: addDays(row.day, 1) } : {}),
    evening: eveningRow(row.options),
    meal: row.meal === true,
    ...(eveningRow(row.options) ? { eveningLimit: asHhmm(row.back_by) } : {}),
    plan: { mode: row.mode, now: asHhmm(now.min), nowMin: now.min, budgetMin: row.budget, backByMin: row.back_by, options },
    sky: row.sky,
    backBy: asHhmm(row.back_by),
    chosen: row.chosen,
    chosenBy: row.chosen_by,
    createdAt: row.created_at,
    ...(cv ? { course: cv.course, courseVersion: cv.version, courseProposal: cv.proposal, courseExplain: cv.explain } : {}),
  });
}

export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return bad("unauthorized", 401);
  const q = new URL(req.url).searchParams;

  // 데모 차만 쓰는 시험 값
  const demoKeys = ["at", "sky", "rainFrom", "sunset", "air", "fresh"].filter((k) => q.has(k));
  if (demoKeys.length && !who.demo) return bad(`${demoKeys.join("·")}는 데모 차에서만 쓸 수 있어요`, 403);
  let at = q.get("at") ? parseAt(q.get("at")!) : new Date();
  if (!at) return bad("at은 2026-10-31T08:30 모양이에요");
  // 누구랑 가요? (이 계획만) · 다른 날 계획
  const withQ = q.get("with");
  const withC = withQ ? parseCompanion(withQ) : null;
  if (withQ && !withC) return bad("with는 kids·couple·friends·solo 중 하나예요");
  const dayQ = q.get("day");
  if (dayQ && !/^\d{4}-\d{2}-\d{2}$/.test(dayQ)) return bad("day는 YYYY-MM-DD예요");
  if (dayQ && q.has("at")) return bad("at과 day는 같이 못 써요");
  const mealQ = q.get("meal");
  if (mealQ != null && mealQ !== "1" && mealQ !== "0") return bad("meal은 1·0이에요");
  const maxQ = q.get("maxStops");
  const maxStops = maxQ == null ? MAX_STOPS : Number(maxQ);
  if (!Number.isInteger(maxStops) || maxStops < 1 || maxStops > MAX_STOPS) return bad("maxStops는 1~3이에요");
  const today = kst(at).day;
  const otherDay = !!dayQ && dayQ !== today;
  if (otherDay && dayQ! < today && !who.demo) return bad("지난 날은 짤 수 없어요");
  if (otherDay && dayQ! > addDays(today, 14)) return bad("2주 안의 날만 짤 수 있어요");
  if (otherDay) at = parseAt(`${dayQ}T08:30`)!;
  let skyOverride: Partial<SkyToday> | null = null;
  if (q.has("sky") || q.has("rainFrom") || q.has("sunset")) {
    try {
      const s = (q.get("sky") ?? "UNKNOWN").toUpperCase() as Sky;
      if (!SKIES.includes(s)) return bad("sky는 CLEAR·RAIN·SNOW·UNKNOWN");
      skyOverride = { sky: s, rainFromMin: q.get("rainFrom") ? hhmm(q.get("rainFrom")!) : null };
      if (q.get("sunset")) skyOverride.sunsetMin = hhmm(q.get("sunset")!);
    } catch {
      return bad("rainFrom·sunset은 HH:MM");
    }
  }
  let airOverride: AirLevel | null = null;
  if (q.has("air")) {
    airOverride = (q.get("air") ?? "").toUpperCase() as AirLevel;
    if (!AIRS.includes(airOverride)) return bad("air는 GOOD·NORMAL·BAD·VERY_BAD·UNKNOWN");
  }

  // 위치 → 칸
  const { family, homeCell: savedHome } = await loadFamily(who.carId);
  let originCell: string | null = null;
  if (q.has("lat") || q.has("lng")) {
    const lat = Number(q.get("lat"));
    const lng = Number(q.get("lng"));
    if (!q.get("lat") || !q.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return bad("lat·lng가 이상해요");
    }
    originCell = cellOf(lat, lng).cell;
  } else {
    const [last] = await sql<{ origin_cell: string }[]>`
      select origin_cell from plans where car_id = ${who.carId} order by created_at desc limit 1`;
    originCell = otherDay ? (savedHome ?? (who.demo ? DEMO_HOME_CELL : null) ?? last?.origin_cell ?? null) : (last?.origin_cell ?? savedHome);
    if (!originCell) return bad("위치(lat·lng)가 필요해요");
  }
  let homeCell = savedHome ?? (who.demo ? DEMO_HOME_CELL : originCell);
  // 폰에서 집을 정했으면(families.home_lat·lng) 그게 이긴다 — 차가 보내는 home=은 무시(덮어쓰지 않음)
  if (q.get("home") && !family.home) {
    const h = parseCell(q.get("home"));
    if (!h) return bad("home은 35.8858,128.5828 모양이에요");
    homeCell = cellOf(h.lat, h.lng).cell;
    if (homeCell !== savedHome) {
      // 가족 설정이 아직 없으면 기본값과 함께 만든다 (집 칸만 넣으면 낮잠이 비어 '낮잠 없음'이 돼 버림)
      const d = DEFAULT_FAMILY;
      await sql`
        insert into families (car_id, kid_ages, nap_start, nap_len, back_by, dinner, home_cell)
        values (${who.carId}, ${d.kidAges}, ${d.napStart}, ${d.napLen}, ${d.backBy}, ${d.dinner}, ${homeCell})
        on conflict (car_id) do update set home_cell = excluded.home_cell, updated_at = now()`;
    }
  }
  const home = familyHome(family, homeCell, originCell)!;
  // 다른 날은 집에서 출발
  if (otherDay) originCell = cellOf(home.lat, home.lng).cell;
  const here = hereOf(originCell, home)!;

  const { day, min } = kst(at);
  const mode = modeAt(min);
  const companion: Companion = withC ?? family.companion;
  const mealOn = mealQ != null ? mealQ === "1" : family.mealPlan;
  // 폰이 고른 동행은 '마지막 동행'으로 기억 (차는 이 값으로 자기 계산)
  if (withC && who.phone && withC !== family.companion) {
    const d = DEFAULT_FAMILY;
    await sql`
      insert into families (car_id, kid_ages, nap_start, nap_len, back_by, dinner, companion)
      values (${who.carId}, ${d.kidAges}, ${d.napStart}, ${d.napLen}, ${d.backBy}, ${d.dinner}, ${withC})
      on conflict (car_id) do update set companion = excluded.companion, updated_at = now()`;
  }
  // 밤(오늘 계획만): 지금 시각 기준 — 폰이 '내일 계획 짜기'를 띄운다
  const nowAt = q.has("at") ? min : kst(new Date()).min;
  const nightAt = (sky: SkyToday | null) => !otherDay && isNight(nowAt, toProfile(family, home, companion), sky);
  // 낮 계획 뒤 해가 지면 30분 안이어도 새로 짠다 (저녁 카드)
  const eveningAt = (sky: SkyToday | null) => !otherDay && isEvening(min, toProfile(family, home, companion), sky);

  // 다시 쓸 수 있는 오늘 계획
  if (!q.has("fresh") && !skyOverride && !airOverride) {
    const [last] = await sql<(PlanRow & { stamped_after: boolean })[]>`
      select p.id, p.day::text as day, p.mode, p.origin_cell, p.now_at, p.options, p.sky, p.back_by, p.budget,
             p.chosen, p.chosen_by, p.created_at, p.course, p.course_version, p.course_proposal, p.companion,
             coalesce((to_jsonb(p) ->> 'meal')::boolean, false) as meal,
             exists (select 1 from events e where e.car_id = p.car_id and e.kind = 'stamp' and e.created_at > p.created_at) as stamped_after
      from plans p
      where p.car_id = ${who.carId} and p.day = ${day} and p.mode = ${mode} and not p.stale
      order by p.created_at desc limit 1`;
    if (last) {
      // 다른 날 계획은 시각이 늘 08:30이라 만든 지 얼마나 됐는지로 본다
      const ageMin = otherDay ? (Date.now() - last.created_at.getTime()) / 60000 : Math.abs(at.getTime() - last.now_at.getTime()) / 60000;
      const same = (parseCompanion(last.companion) ?? "kids") === companion;
      // 곳 수 한도: 표를 따로 두지 않고 카드로 본다 — 한도보다 많은 곳이 든 카드가 있으면 못 쓰고,
      // 폰이 2곳 이상을 허락해 물었는데(maxStops 2·3) 아침 카드가 모두 한 곳뿐이면 '가볍게'로 짠 계획이라 새로 짠다.
      // 차(maxStops 없음)는 그대로 쓴다 — 새로 짜면 폰이 막 고를 계획보다 새 줄이 생겨 차가 엉뚱한 계획을 본다
      const most = Math.max(0, ...last.options.map((o) => o.stops.length));
      const fits = most <= maxStops && !(maxQ != null && maxStops >= 2 && last.mode === "MORNING" && most < 2);
      // 낮 계획을 짠 뒤 해가 졌으면(저녁 모드인데 저녁 카드가 없음) 새로 짠다
      const sameEvening = !(eveningAt(skyOfRow(last.sky)) && !eveningRow(last.options));
      const fresh = ageMin < REUSE_MIN && last.origin_cell === originCell && !last.stamped_after && same && fits && sameEvening && last.meal === mealOn;
      // 고른 계획은 그날 그대로 — 단 폰이 다른 동행(with)이나 곳 수 한도(maxStops)로 물어 맞지 않으면 새로 짠다
      const keepChosen = (same || !withC) && (maxQ == null || fits);
      if ((last.chosen != null && keepChosen) || fresh) return respond(who, last, true, nightAt(skyOfRow(last.sky)), home);
    }
  }

  // 새로 계산: 오늘 이미 도장 찍은 곳은 빼고
  const visited = new Set(
    (await sql<{ place_id: string }[]>`
      select distinct place_id from events
      where car_id = ${who.carId} and kind = 'stamp' and place_id is not null
        and (created_at at time zone 'Asia/Seoul')::date = ${day}`).map((r) => r.place_id),
  );
  // 축제는 그날과 기간이 겹치는 것만 더한다 (엔진이 쉬는 요일·운영 시각까지 다시 본다)
  const candidates = (await candidatePlaces(day)).filter((p) => !visited.has(p.id));
  const isToday = kst(new Date()).day === day;
  const info: SkyInfo = await skyToday(here.lat, here.lng, day, min, isToday);
  if (skyOverride) {
    info.sky = { ...info.sky, ...skyOverride };
    info.weatherSource = "none";
    info.hours = [];
  }
  if (airOverride) {
    info.sky = { ...info.sky, air: airOverride, pm10: null, pm25: null };
    info.air = null;
    info.airSource = "none";
  }
  // 머무는 시간: 우리 가족 배율·장소 기록 + 같은 또래 값 (엔진 FamilyProfile.dwellEstimate)
  const rainy = info.sky.sky === "RAIN" || info.sky.rainFromMin != null;
  // + 방문 기록: 이미 도장 받은 곳 −1 · 안 가 본 곳 +0.5 · 최근 14일 안에 다녀옴 −2 · 즐겨찾기 +1 (엔진 Planner.historyScore)
  const base = await profileWithHistory(who.carId, await profileWithDwell(who.carId, toProfile(family, home, companion), day, rainy, candidates), day);
  // 밥 켬: 켜진 식당을 엔진에 (밥 자리 넣기 — 고르는 코스는 같고 시간표·칩만 바뀐다)
  const profile = mealOn ? { ...base, meal: { restaurants: await engineRestaurants(), day } } : base;
  const plan = firstBoarding(min, here, profile, candidates, info.sky, day, maxStops);

  const optionsJ = sql.json(optionsJson(plan, profile, here) as never);
  const skyJ = sql.json(skyJson(info, plan) as never);
  const insert = (withMeal: boolean) => sql<PlanRow[]>`
    insert into plans (car_id, day, mode, origin_cell, now_at, options, sky, back_by, budget, companion ${withMeal ? sql`, meal` : sql``})
    values (${who.carId}, ${day}, ${plan.mode}, ${originCell}, ${at}, ${optionsJ},
            ${skyJ}, ${plan.backByMin}, ${plan.budgetMin}, ${companion} ${withMeal ? sql`, ${mealOn}` : sql``})
    returning id, day::text as day, mode, origin_cell, now_at, options, sky, back_by, budget, chosen, chosen_by, created_at,
              course, course_version, course_proposal, companion, ${withMeal ? sql`meal` : sql`false as meal`}`;
  // plans.meal 칸이 아직 없는 DB(운영 반영 전)면 칸 없이 (그땐 밥 설정이 바뀌어도 30분 안 계획을 다시 쓸 수 있음)
  const [row] = await insert(true).catch((e) => {
    if (missingStructure(e)) return insert(false);
    throw e;
  });
  return respond(who, row, false, nightAt(info.sky), home);
}
