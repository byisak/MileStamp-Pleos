import { profileWithDwell } from "./dwell";
import { kst, parseAt } from "./kst";
import { sql } from "./db";
import { skyToday } from "./sky";
import { cellOf, DEMO_HOME_CELL, familyHome, hereOf, loadFamily, modeAt, skyJson, toProfile } from "./plan";
import { parseCompanion, type Companion, type FamilyProfile, type LatLng, type Place, type PlanMode, type SkyToday } from "./planner";
import { skyOfRow } from "./course";
import { candidatePlaces } from "./festivals";
import type { OptionJson, SkyJson } from "./plan";
import { extPlacesOf, withExt } from "./ext";
import { profileWithHistory } from "./history";

/**
 * 정한 코스 고르기·코스 편집 미리 보기가 같이 쓰는 계산 재료: 계획을 만든 시각·위치·하늘 + 오늘 가족 설정(머무름 포함) + 그날 장소표.
 * (POST /api/plan/choose {stops} · POST /api/plan/preview). 동행은 그 계획의 동행(plans.companion).
 */
export type EditCtx = {
  nowMin: number; here: LatLng; home: LatLng; profile: FamilyProfile; sky: SkyToday | null; mode: PlanMode;
  catalog: Place[]; find: (id: string) => Place | undefined;
  /** 가족 설정 '밥도 같이 짜기' (앵커 코스가 밥 자리를 넣을지 — 고르기·미리 보기는 정한 곳 그대로라 안 씀). */
  mealPlan: boolean;
};

export async function editCtx(
  carId: string, demo: boolean,
  plan: { now_at: Date; origin_cell: string; sky: SkyJson | null; mode?: string | null; options?: OptionJson[] | null; companion?: string | null },
): Promise<EditCtx> {
  const day = kst(plan.now_at).day;
  const { family, homeCell } = await loadFamily(carId);
  // 집: GET /api/plan과 같은 순서 (폰이 정한 집 → 저장된 집 칸 → 데모 차는 북구청 → 계획 위치)
  const home = familyHome(family, homeCell ?? (demo ? DEMO_HOME_CELL : plan.origin_cell), plan.origin_cell)!;
  const catalog = await candidatePlaces(day);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const sky = skyOfRow(plan.sky);
  const withDwell = await profileWithDwell(carId, toProfile(family, home, parseCompanion(plan.companion)), day, sky?.sky === "RAIN" || sky?.rainFromMin != null, catalog);
  // 방문 기록: 카드 칩('도장 N')·점수가 GET /api/plan 카드와 같게
  const profile = await profileWithHistory(carId, withDwell, day);
  // 계획 카드에 실린 바깥 장소(ext:…)는 id만 와도 찾는다
  const find = withExt((id: string) => byId.get(id), extPlacesOf(...(plan.options ?? []).map((o) => o.stops)));
  return {
    nowMin: kst(plan.now_at).min, here: hereOf(plan.origin_cell, home) ?? home, home, profile, sky,
    mode: plan.mode === "AFTERNOON" ? "AFTERNOON" : "MORNING", catalog, find: (id) => find(id) ?? undefined,
    mealPlan: family.mealPlan,
  };
}

export type ContextPlanRow = { id: string; day: string; mode: string; origin_cell: string; now_at: Date; sky: SkyJson | null; options: OptionJson[]; companion: string | null };

/**
 * 그날 계획이 없을 때 앵커 코스의 문맥 계획 (카드 없음, stale = 오늘 추천 다시 쓰기에는 안 잡힘 — 고르면 이 줄에 카드가 붙고 코스가 생긴다).
 * 오늘이면 지금 시각·마지막 위치 칸, 다른 날이면 그날 08:30 집에서.
 */
export async function contextPlan(
  carId: string, demo: boolean, day: string, today: string, lastCell: string | null, companion: Companion | null,
): Promise<ContextPlanRow | null> {
  const { family, homeCell } = await loadFamily(carId);
  const home = familyHome(family, homeCell ?? (demo ? DEMO_HOME_CELL : null), lastCell);
  if (!home) return null;
  const homeC = cellOf(home.lat, home.lng).cell;
  const isToday = day === today;
  const at = isToday ? new Date() : parseAt(`${day}T08:30`)!;
  const origin = isToday ? (lastCell ?? homeC) : homeC;
  const { min } = kst(at);
  const info = await skyToday(home.lat, home.lng, day, min, isToday);
  const [row] = await sql<ContextPlanRow[]>`
    insert into plans (car_id, day, mode, origin_cell, now_at, options, sky, back_by, budget, stale, companion)
    values (${carId}, ${day}, ${modeAt(min)}, ${origin}, ${at}, ${sql.json([] as never)}, ${sql.json(skyJson(info) as never)}, null, null, true,
            ${companion ?? family.companion})
    returning id, day::text as day, mode, origin_cell, now_at, sky, options, companion`;
  return row;
}
