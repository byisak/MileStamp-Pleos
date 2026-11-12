import { sql } from "./db";
import { DEFAULT_FAMILY } from "./plan";
import { ageBand, learnDwell, prefFactor, weekdayOf, type CrowdDwell, type DwellStats, type FamilyProfile, type Place, type PlaceDwell } from "./planner";
import type { CourseJson } from "./livecourse";
import { crowdText, cutByClose, isDwellPref, learnable, pickCrowd, visitDwell, visitsFromCourse, type CrowdRow, type DwellPref, type Visit } from "./dwell-shape";

/*
 * 머무는 시간 맞춤 — DB 쪽 (families.dwell_* · dwell_visits · place_dwell_stats).
 * 계산은 엔진과 같은 식(planner.ts dwellEstimate·learnDwell). 엔진은 순수하게 두고, 여기서 가족 배율·장소 기록·또래 값을 모아 FamilyProfile에 넣어 준다.
 * 개인정보: 또래 값은 10가족 이상 모인 장소·나이대 칸만, 가족마다 값은 밖으로 안 나간다. 데모 차는 또래 통계에서 뺀다.
 */

export type FamilyDwell = DwellStats & { pref: DwellPref };

export const DEFAULT_DWELL: FamilyDwell = { pref: "normal", factor: 1.0, n: 0, places: {} };

function parsePlaces(v: unknown): Record<string, PlaceDwell> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, PlaceDwell> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const o = x as { avg?: unknown; n?: unknown } | null;
    if (o && Number.isFinite(o.avg) && Number.isInteger(o.n) && (o.n as number) > 0) out[k] = { avg: Math.round(o.avg as number), n: o.n as number };
  }
  return out;
}

/** 우리 가족 머무름 (설정이 없으면 기본: 보통 1.0). */
export async function loadDwell(carId: string): Promise<FamilyDwell> {
  const [row] = await sql<{ dwell_pref: string; dwell_factor: number; dwell_n: number; place_dwell: unknown }[]>`
    select dwell_pref, dwell_factor, dwell_n, place_dwell from families where car_id = ${carId}`;
  if (!row) return DEFAULT_DWELL;
  return {
    pref: isDwellPref(row.dwell_pref) ? row.dwell_pref : "normal",
    // real → 소수 둘째 자리 (엔진 배율과 같은 자리)
    factor: Math.round(Number(row.dwell_factor) * 100) / 100,
    n: row.dwell_n,
    places: parsePlaces(row.place_dwell),
  };
}

/** '머무는 편'을 바꾸면 배율을 그 씨앗으로 다시 시작한다 (배운 횟수·장소 기록은 둔다). */
export async function setDwellPref(carId: string, pref: DwellPref) {
  // 가족 줄은 PUT /api/family가 먼저 만든다 (여기서 만들면 낮잠 등이 비어 버림)
  await sql`update families set dwell_pref = ${pref}, dwell_factor = ${prefFactor(pref)}, updated_at = now() where car_id = ${carId}`;
}

// ------------------------------------------------------------------ 배우기

export type VisitCtx = { day: string; kidAges: number[]; rainy: boolean; source: "course" | "stamp" };

/**
 * 다녀온 곳 하나를 기록하고(같은 날 같은 곳은 한 번) 우리 가족 배율·장소 평균을 갱신한다.
 * 10분 미만·문 닫아 나온 머무름은 기록만 하고 배우지 않는다. 배웠으면 true.
 */
export async function recordVisit(carId: string, v: Visit, place: Pick<Place, "id" | "dwellP80Min" | "openMin" | "closeMin">, ctx: VisitCtx): Promise<boolean> {
  const dwell = visitDwell(v, place.openMin);
  const cut = cutByClose(v.departMin, place.closeMin);
  const wd = weekdayOf(ctx.day);
  return sql.begin(async (tx) => {
    const ins = await tx`
      insert into dwell_visits (car_id, day, place_id, arrive_min, depart_min, dwell_min, cut_by_close, weekend, rainy, age_band, source)
      values (${carId}, ${ctx.day}, ${v.placeId}, ${v.arriveMin}, ${v.departMin}, ${Math.min(dwell, 32767)}, ${cut},
              ${wd === 0 || wd === 6}, ${ctx.rainy}, ${ageBand(ctx.kidAges)}, ${ctx.source})
      on conflict (car_id, day, place_id) do nothing
      returning place_id`;
    if (!ins.length || !learnable(dwell, cut)) return false;
    // 가족 줄이 없으면 기본값으로 만든 뒤 잠그고 갱신
    const d = DEFAULT_FAMILY;
    await tx`
      insert into families (car_id, kid_ages, nap_start, nap_len, back_by, dinner)
      values (${carId}, ${d.kidAges}, ${d.napStart}, ${d.napLen}, ${d.backBy}, ${d.dinner})
      on conflict (car_id) do nothing`;
    const [row] = await tx<{ dwell_factor: number; dwell_n: number; place_dwell: unknown }[]>`
      select dwell_factor, dwell_n, place_dwell from families where car_id = ${carId} for update`;
    const cur: DwellStats = { factor: Math.round(Number(row.dwell_factor) * 100) / 100, n: row.dwell_n, places: parsePlaces(row.place_dwell) };
    const next = learnDwell(cur, v.placeId, place.dwellP80Min, dwell);
    await tx`
      update families set dwell_factor = ${next.factor}, dwell_n = ${next.n}, place_dwell = ${tx.json(next.places as never)}, updated_at = now()
      where car_id = ${carId}`;
    return true;
  });
}

/**
 * 코스 저장 뒤: 이번에 새로 DONE이 된 곳(도착·출발 시각이 있는 곳)을 배운다. 실패해도 코스 저장은 그대로 (덤).
 * find = 장소표(조사값·문 여는 시각).
 */
export async function learnFromCourse(
  carId: string, before: CourseJson | null | undefined, after: CourseJson, find: (id: string) => Place | null, ctx: Omit<VisitCtx, "source">,
): Promise<number> {
  let n = 0;
  for (const v of visitsFromCourse(before, after)) {
    const p = find(v.placeId);
    if (!p || p.festival) continue; // 축제는 해마다 달라서 배우지 않는다
    try { if (await recordVisit(carId, v, p, { ...ctx, source: "course" })) n++; }
    catch (e) { console.error("머무름 배우기 실패", (e as Error).message); }
  }
  return n;
}

// ------------------------------------------------------------------ 또래 통계

/** 다시 계산하는 간격. */
const STATS_TTL_MS = 6 * 3600_000;
let statsAt = 0;

/**
 * 또래 통계 다시 계산: 장소·나이대·칸(전체·주말·평일·비)마다 가족별 평균을 내고, 가족들 사이 P50·P75. 10가족 이상만.
 * 10분 미만·문 닫아 나온 머무름·데모 차는 뺀다. 싼 쿼리라 읽을 때 6시간이 지났으면 한다.
 */
export async function refreshDwellStats(force = false) {
  if (!force && Date.now() - statsAt < STATS_TTL_MS) return;
  statsAt = Date.now();
  await sql.begin(async (tx) => {
    await tx`delete from place_dwell_stats`;
    await tx`
      insert into place_dwell_stats (place_id, age_band, bucket, n_families, p50, p75, updated_at)
      select place_id, age_band, bucket, count(*)::int,
             round(percentile_cont(0.5) within group (order by d))::smallint,
             round(percentile_cont(0.75) within group (order by d))::smallint, now()
      from (
        select v.place_id, v.age_band, b.bucket, v.car_id, avg(v.dwell_min) as d
        from dwell_visits v
        join cars c on c.id = v.car_id and not c.demo
        cross join lateral (values ('all'), (case when v.weekend then 'weekend' else 'weekday' end), (case when v.rainy then 'rain' end)) b(bucket)
        where b.bucket is not null and not v.cut_by_close and v.dwell_min >= 10
        group by v.place_id, v.age_band, b.bucket, v.car_id
      ) fam
      group by place_id, age_band, bucket
      having count(*) >= 10`;
  });
}

async function statsRows(band: string, placeId?: string): Promise<CrowdRow[]> {
  try { await refreshDwellStats(); } catch (e) { console.error("또래 통계 계산 실패", (e as Error).message); }
  return placeId
    ? sql<CrowdRow[]>`select place_id, bucket, n_families, p50, p75 from place_dwell_stats where age_band = ${band} and place_id = ${placeId}`
    : sql<CrowdRow[]>`select place_id, bucket, n_families, p50, p75 from place_dwell_stats where age_band = ${band}`;
}

/** 오늘 계획에 넣을 또래 값 (엔진 FamilyProfile.crowdDwell). */
export async function crowdFor(kidAges: number[], day: string, rainy: boolean, indoor: (id: string) => boolean): Promise<Record<string, CrowdDwell>> {
  const wd = weekdayOf(day);
  return pickCrowd(await statsRows(ageBand(kidAges)), { weekend: wd === 0 || wd === 6, rainy, indoor });
}

/** 장소 자세히의 또래 글 ('같은 또래 가족 보통 2시간 10분 (23가족)') — 10가족 미만이면 null. */
export async function crowdTextFor(placeId: string, kidAges: number[]): Promise<string | null> {
  const rows = await statsRows(ageBand(kidAges), placeId);
  return crowdText(rows.find((r) => r.bucket === "all"));
}

/** 엔진 가족 정보에 머무름 칸을 더한다 (배율·횟수·장소 기록 + 또래 값). */
export function withDwell(p: FamilyProfile, d: DwellStats, crowd: Record<string, CrowdDwell>): FamilyProfile {
  return { ...p, dwellFactor: d.factor, dwellN: d.n, placeDwell: d.places, crowdDwell: crowd };
}

/** 한 번에: 우리 가족 머무름 + 오늘 또래 값을 붙인 FamilyProfile. 실패하면 머무름 없이(조사값) 그대로. */
export async function profileWithDwell(carId: string, p: FamilyProfile, day: string, rainy: boolean, catalog: Place[]): Promise<FamilyProfile> {
  try {
    const indoor = new Map(catalog.map((x) => [x.id, x.indoor]));
    const [d, crowd] = await Promise.all([loadDwell(carId), crowdFor(p.kidAges, day, rainy, (id) => indoor.get(id) ?? false)]);
    return withDwell(p, d, crowd);
  } catch (e) {
    console.error("머무름 읽기 실패", (e as Error).message);
    return p;
  }
}
