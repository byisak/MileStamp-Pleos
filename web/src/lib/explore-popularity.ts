import { sql } from "./db";
import { kstToday } from "./festival-shape";
import type { Popularity } from "./explore-filter";

/*
 * '인기' 숫자 모으기 (docs/고르기-2차-계획.html 5절) — 표 explore_popularity(id, picked, visited, updated_at).
 *
 * Vercel 서버리스라 따로 도는 일정 작업 대신 '요청 때 하루 한 번'(한국 날짜) 통째로 다시 채운다:
 *   - 오늘 채웠다는 표시는 tour_cache 'popularity:<한국 날짜>' 한 줄 (표가 비어도 다시 안 돌게)
 *   - 여러 인스턴스가 같이 와도 pg_try_advisory_xact_lock으로 하나만 채우고, 나머지는 어제 숫자를 그대로 읽는다
 *   - 표가 아직 없거나(운영에 SQL 전) 실패하면 빈 숫자 → '인기'는 이번 주말 → 가까운 순 (목록은 안 막힘)
 *
 * 센 것 (최근 30일, 데모 차 빼고, 같은 가족은 장소마다 1):
 *   picked  = 고른 코스(plans.options[chosen].stops)에 그곳이 든 가족
 *   visited = 도장(events stamp, 축제 도장은 place_id = 축제 id) 또는 '다녀옴'(visits_ext)이 있는 가족
 */

const DAYS = 30;
const LOCK = 7_310_528; // 아무 숫자 — 인기 다시 채우기 자물쇠

/** 오늘 아직 안 채웠으면 다시 채운다. 채웠으면 true. */
export async function refreshPopularity(today = kstToday()): Promise<boolean> {
  const mark = `popularity:${today}`;
  const [done] = await sql`select 1 from tour_cache where key = ${mark}`;
  if (done) return false;
  return sql.begin(async (tx) => {
    const [lock] = await tx<{ ok: boolean }[]>`select pg_try_advisory_xact_lock(${LOCK}) as ok`;
    if (!lock.ok) return false;
    const [again] = await tx`select 1 from tour_cache where key = ${mark}`;
    if (again) return false;
    await tx`delete from explore_popularity`;
    await tx`
      with picked as (
        select distinct s->>'id' as id, p.car_id
        from plans p
        join cars c on c.id = p.car_id
        cross join lateral jsonb_array_elements(case when jsonb_typeof(p.options -> p.chosen::int -> 'stops') = 'array'
                                                     then p.options -> p.chosen::int -> 'stops' else '[]'::jsonb end) s
        where p.chosen is not null and not c.demo
          and coalesce(p.chosen_at, p.created_at) > now() - make_interval(days => ${DAYS})
          and coalesce(s->>'id', '') <> ''
      ),
      went as (
        select e.place_id as id, e.car_id
        from events e join cars c on c.id = e.car_id
        where e.kind = 'stamp' and not c.demo and e.place_id is not null and e.created_at > now() - make_interval(days => ${DAYS})
        union
        select v.ext_id as id, v.family_id as car_id
        from visits_ext v join cars c on c.id = v.family_id
        where not c.demo and v.visited_at > now() - make_interval(days => ${DAYS})
      ),
      pc as (select id, count(*)::int as n from picked group by id),
      vc as (select id, count(distinct car_id)::int as n from went group by id)
      insert into explore_popularity (id, picked, visited, updated_at)
      select coalesce(pc.id, vc.id), coalesce(pc.n, 0), coalesce(vc.n, 0), now()
      from pc full join vc on vc.id = pc.id`;
    await tx`
      insert into tour_cache (key, data, fetched_at) values (${mark}, ${sql.json({ at: new Date().toISOString() })}, now())
      on conflict (key) do update set data = excluded.data, fetched_at = now()`;
    return true;
  }) as Promise<boolean>;
}

/** 인기 숫자 (필요하면 오늘 한 번 다시 채운 뒤). 실패하면 빈 Map — 목록은 그대로 나간다. */
export async function loadPopularity(): Promise<Popularity> {
  try {
    await refreshPopularity().catch((e) => console.error("인기 다시 채우기 실패", e));
    const rows = await sql<{ id: string; picked: number; visited: number }[]>`
      select id, picked, visited from explore_popularity where picked > 0 or visited > 0`;
    return new Map(rows.map((r) => [r.id, { picked: r.picked, visited: r.visited }]));
  } catch (e) {
    console.error("인기 숫자 읽기 실패", e);
    return new Map();
  }
}
