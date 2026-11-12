import { asHhmm, clampUserDwell, course, isMealId, km, limitMin, TimeBudget, type FamilyProfile, type LatLng, type Place, type PlanMode, type PlanOption, type SkyToday } from "./planner";
import { optionJsonOf, type OptionJson, type WhyCtx } from "./plan";
import { dwellView } from "./dwell-shape";
import { extPlace, isExtId } from "./ext";

/*
 * '정한 코스 고르기' — POST /api/plan/choose { planId, stops: [장소 id …] } (모든 차, 폰 '코스 편집').
 * 처음엔 데모 차 전용(시연 날 계획 3장에 이야기 코스가 안 나올 때)이었고, 이제 폰에서 순서·장소를 고친 코스를 그대로 고른다.
 * 카드는 엔진 Planner.course 와 같은 planner.course()로 짠다(제목 '고른 코스').
 * 미리 보기(POST /api/plan/preview)도 같은 계산 — 저장 없이 귀가 시각·한계 넘김만 알려 준다.
 * DB 없이 시험하려고 계산만 여기 둔다 (route.ts가 계획 행·가족 설정·장소표를 읽어 넘긴다).
 */

/** 한 장에 들르는 곳 최대 수 (아침 코스와 같음). */
export const MAX_STOPS = 3;

export type CourseChoice =
  | { ok: true; option: OptionJson }
  | { ok: false; status: number; error: string };

export function optionJson(o: PlanOption, profile?: FamilyProfile, why?: WhyCtx): OptionJson {
  return optionJsonOf(o, profile, why);
}

/**
 * stops 모양 확인 → 장소들. 틀리면 400 이유.
 * 한 칸 = 장소 id 글자, 또는 바깥 장소 {id:'ext:tour:<번호>', name, lat, lng, indoor?, dwell?, open?, close?, kidFit?} (lib/ext.ts 기본값).
 * 바깥 장소 id만 글자로 오면 find가 알 때(앞서 받은 카드·코스에 실린 것)만 받는다.
 */
export function parseStops(stops: unknown, find: (id: string) => Place | null | undefined): { ok: true; places: Place[] } | { ok: false; status: number; error: string } {
  // 장소 1~3곳 + 밥 자리(식당 'ext:food:…') 한 곳까지
  const mealN = Array.isArray(stops) ? stops.filter((s) => isMealId(typeof s === "string" ? s : String((s as { id?: unknown })?.id ?? ""))).length : 0;
  if (!Array.isArray(stops) || mealN > 1 || stops.length - mealN < 1 || stops.length - mealN > MAX_STOPS || !stops.every((s) => typeof s === "string" || (s && typeof s === "object"))) {
    return { ok: false, status: 400, error: `stops는 장소 id 1~${MAX_STOPS}개 (+ 밥 자리 한 곳)` };
  }
  const places: Place[] = [];
  for (const s of stops as unknown[]) {
    if (typeof s === "string") {
      const p = find(s);
      if (!p) return { ok: false, status: 400, error: `모르는 장소예요: ${s}` };
      places.push(p);
    } else {
      const id = (s as { id?: unknown }).id;
      // 우리 장소는 id만 쓴다 (이름·좌표를 보내도 장소표 값)
      const known = typeof id === "string" && !isExtId(id) ? find(id) : null;
      if (known) { places.push(known); continue; }
      const p = extPlace(s);
      if (typeof p === "string") return { ok: false, status: 400, error: p };
      places.push(p);
    }
  }
  if (new Set(places.map((p) => p.id)).size !== places.length) return { ok: false, status: 400, error: "같은 장소가 두 번 있어요" };
  return { ok: true, places };
}

/** dwell {장소 id: 분} 모양 확인 → 15~360분·5분 단위로 맞춘 값. 없으면 {}. stops에 없는 장소는 400. */
export function parseDwell(dwell: unknown, stops: string[]): { ok: true; dwell: Record<string, number> } | { ok: false; status: number; error: string } {
  if (dwell == null) return { ok: true, dwell: {} };
  if (typeof dwell !== "object" || Array.isArray(dwell)) return { ok: false, status: 400, error: "dwell은 {장소 id: 분}" };
  const out: Record<string, number> = {};
  for (const [id, m] of Object.entries(dwell as Record<string, unknown>)) {
    if (!stops.includes(id)) return { ok: false, status: 400, error: `dwell의 장소가 stops에 없어요: ${id}` };
    if (typeof m !== "number" || !Number.isFinite(m)) return { ok: false, status: 400, error: "dwell 값은 분(숫자)" };
    out[id] = clampUserDwell(m);
  }
  return { ok: true, dwell: out };
}

/**
 * 정한 장소 순서(+ 오늘만 머무름 dwell) → 카드. 모양이 틀리거나 규칙(문 닫는 시각·귀가 한계 등)에 안 맞으면 400. mode = 계획의 모드(오후면 저녁 시각까지).
 * anchor(앵커 코스에서 고름 — POST /api/plan/anchor 카드) = 그 장소는 긴 이동·문 열기 기다림·비를 봐주고, 귀가 한계를 넘어도 받는다
 * (카드에 overLimit — 폰이 '오늘만 귀가 한계 늦추기'를 물은 뒤 SetEnd로 한계를 바꾼다). 제목은 '○○ 중심으로'.
 */
export function courseChoice(
  stops: unknown, find: (id: string) => Place | null | undefined,
  nowMin: number, here: LatLng, profile: FamilyProfile, sky: SkyToday | null, mode: PlanMode = "MORNING", dwell?: unknown,
  anchor?: string | null,
): CourseChoice {
  const ps = parseStops(stops, find);
  if (!ps.ok) return ps;
  const pd = parseDwell(dwell, ps.places.map((p) => p.id));
  if (!pd.ok) return pd;
  const prof = withDwellSet(profile, pd.dwell);
  const a = anchor ? ps.places.find((p) => p.id === anchor) : undefined;
  if (anchor && !a) return { ok: false, status: 400, error: "anchor가 stops에 없어요" };
  const o = a
    ? course(nowMin, here, prof, ps.places, sky, `${a.name} 중심으로`, { mode, anchorId: a.id, lenient: true })
    : course(nowMin, here, prof, ps.places, sky, "고른 코스", { mode });
  if (!o) return { ok: false, status: 400, error: a ? "오늘은 문 닫기 전에 갈 수 없어요" : "이 순서로는 오늘 시간이 안 맞아요 (문 닫는 시각·귀가 한계)" };
  const j = optionJson(o, prof, { nowMin, here, sky });
  if (a) j.anchorId = a.id;
  return { ok: true, option: j };
}

const withDwellSet = (profile: FamilyProfile, dwell: Record<string, number>): FamilyProfile =>
  Object.keys(dwell).length ? { ...profile, dwellSet: { ...profile.dwellSet, ...dwell } } : profile;

/**
 * 코스 편집 미리 보기: 장소 순서 + 오늘만 머무름 → 카드(귀가 한계를 넘어도 시간표는 준다).
 *  fits = 이 순서·머무름으로 고를 수 있는지(choose stops가 받아 주는지 — 귀가 한계 안전 여유까지) · over = 미리 본 귀가가 한계(안전 여유 포함)를 넘는지.
 *  문 닫는 시각·비 오는 야외 등으로 아예 시간표가 안 나오면 400.
 */
export type CoursePreview =
  | { ok: true; option: OptionJson; limitMin: number; limit: string; over: boolean; overMin: number; fits: boolean }
  | { ok: false; status: number; error: string };
export function coursePreview(
  stops: unknown, dwell: unknown, find: (id: string) => Place | null | undefined,
  nowMin: number, here: LatLng, profile: FamilyProfile, sky: SkyToday | null, mode: PlanMode = "MORNING",
  anchor?: string | null,
): CoursePreview {
  const ps = parseStops(stops, find);
  if (!ps.ok) return ps;
  const pd = parseDwell(dwell, ps.places.map((p) => p.id));
  if (!pd.ok) return pd;
  const withSet = withDwellSet(profile, pd.dwell);
  // 앵커 코스 고치기('○○ 중심으로'): 고르기(choose anchor)와 같은 규칙 — 그곳은 긴 이동·문 열기 기다림·비를 봐주고 귀가 한계를 넘어도 받는다
  const a = anchor ? ps.places.find((p) => p.id === anchor) : undefined;
  if (anchor && !a) return { ok: false, status: 400, error: "중심 곳은 코스에서 뺄 수 없어요" };
  const o = a
    ? course(nowMin, here, withSet, ps.places, sky, `${a.name} 중심으로`, { mode, anchorId: a.id, lenient: true })
    : course(nowMin, here, withSet, ps.places, sky, "고른 코스", { mode, lenient: true });
  if (!o) return { ok: false, status: 400, error: "이 순서로는 갈 수 없어요 (문 닫는 시각·비 오는 야외·긴 이동)" };
  const limit = limitMin(mode, profile, sky);
  const safe = limit - TimeBudget.SAFETY_MIN;
  const fits = a ? true : course(nowMin, here, withSet, ps.places, sky, "고른 코스", { mode }) != null;
  const j = optionJson(o, withSet, { nowMin, here, sky });
  if (a) j.anchorId = a.id;
  return { ok: true, option: j, limitMin: limit, limit: asHhmm(limit), over: o.arriveHomeMin > safe, overMin: Math.max(0, o.arriveHomeMin - safe), fits };
}

/** 더할 곳 후보: 지금 코스(출발지·장소들·집)에서 가까운 순. 머무름은 우리 가족 값. */
export type PlaceCand = { id: string; name: string; indoor: boolean; stampable: boolean; dwell: number; km: number };
export function placeCandidates(catalog: Place[], route: LatLng[], profile: FamilyProfile, limit = 40): PlaceCand[] {
  return catalog
    .map((p) => ({
      id: p.id, name: p.name, indoor: p.indoor, stampable: p.stampable, dwell: dwellView(profile, p).minutes,
      km: Math.round(Math.min(...route.map((r) => km(r, p.at))) * 10) / 10,
    }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

/** 계획 카드에 붙이기: 같은 장소 순서의 카드가 이미 있으면 그 번호, 없으면 끝에 붙인 번호. */
export function withOption(options: OptionJson[], option: OptionJson): { options: OptionJson[]; idx: number } {
  const key = (o: OptionJson) => o.stops.map((s) => s.id).join(",");
  const at = options.findIndex((o) => key(o) === key(option));
  if (at >= 0) return { options, idx: at };
  return { options: [...options, option], idx: options.length };
}
