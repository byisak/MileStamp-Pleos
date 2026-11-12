import { sql } from "./db";
import { aiWeek, type AiWeek } from "./ai-usage";
import { aiFillMock, aiFillReady } from "./ai-fill";
import { kstToday } from "./festival-shape";
import { addDays } from "./place-attrs-shape";

/*
 * 관리자 '할 일' 첫 화면 숫자 (GET /api/admin/todo). 명소·식당·축제의 빈 칸·확인 필요는 화면이 이미 가진 목록으로 세고,
 * 여기서는 DB에서만 아는 것: 장소마다 최근 추천 횟수 · 이번 주(지난 7일) 도장·가족·함께 글·AI 사용 · 새 신고.
 * 데모 차는 뺀다. 표가 없는(운영 반영 전) DB여도 화면은 열리게 — 칸마다 따로 실패를 삼킨다.
 */

export const REC_DAYS = 30;

export type TodoStats = {
  /** 장소 id → 최근 REC_DAYS일 추천 카드에 든 횟수 (계획마다 한 번) */
  recs: Record<string, number>;
  recDays: number;
  week: {
    stamps: number; families: number; posts: number; plans: number;
    /** 지난 7일, 오래된 날부터 (한국 날짜) */
    days: { day: string; stamps: number; plans: number }[];
  };
  reports: { open: number; hidden: number; notices: number };
  ai: AiWeek;
  aiReady: boolean;
  aiMock: boolean;
};

/** 실패하면 기본값 (표가 없는 DB 등). 줄 목록은 보통 배열로 쓴다. */
const safe = async <T,>(f: () => PromiseLike<readonly T[]>, d: T[]): Promise<T[]> => {
  try { return [...(await f())]; } catch { return d; }
};

/** 추천 횟수: plans.options[*].stops (모든 카드, 고른 것만이 아님). 없으면 인기 표 picked. */
async function recCounts(): Promise<Record<string, number>> {
  const rows = await safe(() => sql<{ id: string; n: number }[]>`
    select s->>'id' as id, count(distinct p.id)::int as n
    from plans p
    join cars c on c.id = p.car_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.options) = 'array' then p.options else '[]'::jsonb end) o
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o -> 'stops') = 'array' then o -> 'stops' else '[]'::jsonb end) s
    where not c.demo and p.created_at > now() - make_interval(days => ${REC_DAYS}) and coalesce(s->>'id', '') <> ''
    group by 1`, []);
  if (rows.length) return Object.fromEntries(rows.map((r) => [r.id, r.n]));
  const pop = await safe(() => sql<{ id: string; n: number }[]>`select id, picked as n from explore_popularity where picked > 0`, []);
  return Object.fromEntries(pop.map((r) => [r.id, r.n]));
}

export async function todoStats(): Promise<TodoStats> {
  const today = kstToday();
  const from = addDays(today, -6);
  const [recs, perDay, fam, posts, reports, ai] = await Promise.all([
    recCounts(),
    safe(() => sql<{ day: string; stamps: number; plans: number }[]>`
      with d as (select generate_series(${from}::date, ${today}::date, interval '1 day')::date as day),
      st as (
        select (e.created_at at time zone 'Asia/Seoul')::date as day, count(*)::int as n
        from events e join cars c on c.id = e.car_id
        where e.kind = 'stamp' and not c.demo and e.created_at >= (${from}::date::timestamp at time zone 'Asia/Seoul') group by 1),
      pl as (
        select (p.created_at at time zone 'Asia/Seoul')::date as day, count(*)::int as n
        from plans p join cars c on c.id = p.car_id
        where not c.demo and p.created_at >= (${from}::date::timestamp at time zone 'Asia/Seoul') group by 1)
      select d.day::text as day, coalesce(st.n, 0) as stamps, coalesce(pl.n, 0) as plans
      from d left join st on st.day = d.day left join pl on pl.day = d.day order by d.day`, []),
    safe(() => sql<{ n: number }[]>`
      select count(distinct e.car_id)::int as n from events e join cars c on c.id = e.car_id
      where not c.demo and e.created_at >= (${from}::date::timestamp at time zone 'Asia/Seoul')`, [{ n: 0 }]),
    safe(() => sql<{ n: number }[]>`
      select count(*)::int as n from posts where not operator and created_at >= (${from}::date::timestamp at time zone 'Asia/Seoul')`, [{ n: 0 }]),
    safe(() => sql<{ open: number; hidden: number; notices: number }[]>`
      select (select count(*) from reports where resolved_at is null)::int as open,
             (select count(*) from posts where status = 'hidden')::int as hidden,
             (select count(*) from posts where operator and status <> 'removed')::int as notices`, [{ open: 0, hidden: 0, notices: 0 }]),
    aiWeek(),
  ]);
  return {
    recs, recDays: REC_DAYS,
    week: {
      stamps: perDay.reduce((a, d) => a + d.stamps, 0), plans: perDay.reduce((a, d) => a + d.plans, 0),
      families: fam[0]?.n ?? 0, posts: posts[0]?.n ?? 0, days: perDay,
    },
    reports: reports[0] ?? { open: 0, hidden: 0, notices: 0 },
    ai, aiReady: aiFillReady(), aiMock: aiFillMock(),
  };
}
