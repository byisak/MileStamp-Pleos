import { sql } from "./db";
import type { FamilyProfile, VisitHistory } from "./planner";
import { DEFAULT_FAMILY } from "./plan";

/*
 * 우리 가족 방문 기록 → 엔진 VisitHistory (추천 점수 보완 + '왜?' 설명, docs/직접-고르기-계획.md 5절).
 *   stamped       = 도장 받은 장소 id (명소는 언제든, 축제 'fest-…'는 그해 것만 — 축제 도장은 해마다 한 번)
 *   lastVisitDays = 장소 id → 마지막으로 다녀온 지 며칠 (도장 소식 + '다녀옴' 기록 visits_ext, 오늘 = 0)
 *   favorites     = 즐겨찾는 장소 id (families.fav_places — POST /api/plan/favorite)
 * 데모 차도 같은 규칙. 표·칸이 아직 없으면(운영에 schema.sql 반영 전) 그 부분만 빈 값.
 */

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' 두 날짜 사이 날 수 (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** 도장·방문 줄 → 기록 (DB 없이 시험하려고 따로). day = 계획 날짜. 그 날짜 뒤의 기록(데모 차의 미래 날짜 계획 등)은 0일로. */
export function historyFrom(
  day: string,
  stamps: { place_id: string; festival_id: string | null; last_day: string }[],
  ext: { ext_id: string; last_day: string }[],
  favorites: string[],
): VisitHistory {
  const stamped = new Set<string>();
  const last: Record<string, number> = {};
  const seen = (id: string, d: string) => {
    const n = Math.max(0, daysBetween(d, day));
    if (last[id] == null || n < last[id]) last[id] = n;
  };
  const year = day.slice(0, 4);
  for (const r of stamps) {
    stamped.add(r.place_id);
    seen(r.place_id, r.last_day);
    if (r.festival_id && r.last_day.slice(0, 4) === year) {
      stamped.add(r.festival_id);
      seen(r.festival_id, r.last_day);
    }
  }
  for (const r of ext) seen(r.ext_id, r.last_day);
  return { stamped: [...stamped].sort(), lastVisitDays: last, favorites: [...new Set(favorites)].sort() };
}

/** 이 차(가족)의 방문 기록. 실패해도 계획은 짜야 하니 모르는 부분은 비운다. */
export async function loadHistory(carId: string, day: string): Promise<VisitHistory> {
  const stamps = await sql<{ place_id: string; festival_id: string | null; last_day: string }[]>`
    select place_id, payload->>'festivalId' as festival_id, max((created_at at time zone 'Asia/Seoul')::date)::text as last_day
    from events
    where car_id = ${carId} and kind = 'stamp' and place_id is not null
    group by place_id, payload->>'festivalId'`.catch(() => []);
  const ext = await sql<{ ext_id: string; last_day: string }[]>`
    select ext_id, max(day)::text as last_day from visits_ext where family_id = ${carId} group by ext_id`.catch(() => []);
  const fav = await loadFavPlaces(carId);
  return historyFrom(day, stamps, ext, fav);
}

/** 즐겨찾는 장소 id 목록 (families.fav_places, 칸이 없으면 빈 목록). */
export async function loadFavPlaces(carId: string): Promise<string[]> {
  const [row] = await sql<{ fav_places: unknown }[]>`select fav_places from families where car_id = ${carId}`.catch(() => []);
  const v = row?.fav_places;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 즐겨찾기 넣기·빼기. 최대 [MAX_FAV_PLACES]곳 (넘치면 오래된 것부터 뺀다). */
export const MAX_FAV_PLACES = 30;
export async function setFavPlace(carId: string, placeId: string, on: boolean): Promise<string[]> {
  const cur = await loadFavPlaces(carId);
  let next = cur.filter((x) => x !== placeId);
  if (on) next = [...next, placeId].slice(-MAX_FAV_PLACES);
  // 가족 설정이 아직 없으면 기본값과 함께 만든다 (즐겨찾기만 넣으면 낮잠이 비어 '낮잠 없음'이 돼 버림)
  const d = DEFAULT_FAMILY;
  await sql`
    insert into families (car_id, kid_ages, nap_start, nap_len, back_by, dinner, fav_places)
    values (${carId}, ${d.kidAges}, ${d.napStart}, ${d.napLen}, ${d.backBy}, ${d.dinner}, ${sql.json(next as never)})
    on conflict (car_id) do update set fav_places = excluded.fav_places, updated_at = now()`;
  return next;
}

/** 프로필에 기록을 붙인다. */
export async function profileWithHistory(carId: string, profile: FamilyProfile, day: string): Promise<FamilyProfile> {
  return { ...profile, history: await loadHistory(carId, day) };
}
