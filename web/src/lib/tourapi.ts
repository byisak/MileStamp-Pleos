import { sql } from "./db";
import { addDays, kstToday } from "./festival-shape";
import { namesMatch } from "./explore-shape";
import { parseTourPage, SEARCH_TYPES, tourError, tourUrl, type TourItem } from "./tourapi-shape";

/*
 * 관광공사 TourAPI 부르기 + 저장(tour_cache) + 하루 한도.
 * - 키: 환경 변수 DATA_GO_KR_KEY (날씨·미세먼지와 같은 공공데이터포털 키, 'TourAPI 국문 관광정보 서비스' 활용 신청 필요)
 * - 한도: TourAPI 개발 계정은 하루 1,000회 → 우리가 부른 횟수를 tour_cache 'quota:<한국 날짜>'에 세고
 *   TOUR_DAILY_LIMIT(기본 900)을 넘으면 더 부르지 않고 저장된 답(오래된 것이라도)만 쓴다.
 * - Vercel 서버리스는 메모리가 요청마다 사라질 수 있어 Next fetch 캐시 대신 DB 표에 저장한다(여러 인스턴스가 같이 씀).
 */

const DEFAULT_LIMIT = 900;
const TIMEOUT_MS = 8000;

export class TourUnavailable extends Error {
  constructor(public reason: "nokey" | "quota" | "error", message: string) {
    super(message);
  }
}

export const tourKey = () => process.env.DATA_GO_KR_KEY || null;

/** 오늘 부른 횟수 +1 (한도를 넘으면 TourUnavailable('quota')). */
async function takeQuota(): Promise<void> {
  const limit = Number(process.env.TOUR_DAILY_LIMIT) || DEFAULT_LIMIT;
  const key = `quota:${kstToday()}`;
  const [r] = await sql<{ n: number }[]>`
    insert into tour_cache (key, data, fetched_at) values (${key}, ${sql.json({ n: 1 })}, now())
    on conflict (key) do update set data = jsonb_build_object('n', coalesce((tour_cache.data->>'n')::int, 0) + 1), fetched_at = now()
    returning (data->>'n')::int as n`;
  if (r.n > limit) throw new TourUnavailable("quota", "오늘 관광공사 조회 한도를 다 썼어요");
}

/** 한 번 부르기 (한도 세고, JSON·resultCode 확인). */
export async function tourCall(op: string, params: Record<string, string>) {
  return parseTourPage(await tourCallRaw(op, params));
}

/** 한 번 부르기 — 답 JSON 그대로 (상세 정보 detailIntro2처럼 이름 칸이 없는 답용). */
export async function tourCallRaw(op: string, params: Record<string, string>): Promise<unknown> {
  const key = tourKey();
  if (!key) throw new TourUnavailable("nokey", "공공데이터 키(DATA_GO_KR_KEY)가 없어요");
  await takeQuota();
  const res = await fetch(tourUrl(op, key, params), { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new TourUnavailable("error", `TourAPI 답이 JSON이 아니에요 (${res.status})`); }
  const err = tourError(json);
  if (err) throw new TourUnavailable("error", `TourAPI 오류: ${err}`);
  return json;
}

export type Cached<T> = { data: T; fetchedAt: string; stale: boolean };

/**
 * 저장된 답이 [maxAgeMin]분 안이면 그대로, 아니면 새로 받아 저장. 새로 못 받으면 오래된 것이라도(stale: true), 그것도 없으면 throw.
 */
export async function cachedTour<T>(key: string, maxAgeMin: number, load: () => Promise<T>): Promise<Cached<T>> {
  const [hit] = await sql<{ data: T; fetched_at: Date; fresh: boolean }[]>`
    select data, fetched_at, fetched_at > now() - make_interval(mins => ${maxAgeMin}) as fresh from tour_cache where key = ${key}`;
  if (hit?.fresh) return { data: hit.data, fetchedAt: hit.fetched_at.toISOString(), stale: false };
  try {
    const data = await load();
    await sql`
      insert into tour_cache (key, data, fetched_at) values (${key}, ${sql.json(data as never)}, now())
      on conflict (key) do update set data = excluded.data, fetched_at = now()`;
    return { data, fetchedAt: new Date().toISOString(), stale: false };
  } catch (e) {
    if (hit) return { data: hit.data, fetchedAt: hit.fetched_at.toISOString(), stale: true };
    throw e;
  }
}

/** 오래된 검색 저장 지우기 (가끔, 30일 넘은 것). 실패해도 그만. */
export async function sweepTourCache() {
  await sql`delete from tour_cache where fetched_at < now() - interval '30 days'`.catch(() => undefined);
}

// ------------------------------------------------------------------ 축제 (전국, 하루 한 번)

/** 축제 몇 일 전에 시작한 것까지 받나 (진행 중인 긴 축제를 놓치지 않게). */
const FESTIVAL_BACK_DAYS = 45;
const FESTIVAL_PAGE = 500;
const FESTIVAL_MAX_PAGES = 6;

/**
 * 전국 축제 목록 ([from] - 45일 이후 시작). 하루 한 번 받아 tour_cache 'festival:<from>'에 둔다.
 * 축제는 대개 300~800건 → 500건씩 1~2번 부름.
 */
export async function nationwideFestivals(from: string): Promise<Cached<TourItem[]>> {
  return cachedTour(`festival:${from}`, 24 * 60, async () => {
    const start = addDays(from, -FESTIVAL_BACK_DAYS).replaceAll("-", "");
    const all: TourItem[] = [];
    for (let page = 1; page <= FESTIVAL_MAX_PAGES; page++) {
      const p = await tourCall("searchFestival2", {
        arrange: "A", numOfRows: String(FESTIVAL_PAGE), pageNo: String(page), eventStartDate: start,
      });
      all.push(...p.items);
      if (p.items.length < FESTIVAL_PAGE || page * FESTIVAL_PAGE >= p.totalCount) break;
    }
    return all;
  });
}

// ------------------------------------------------------------------ 직접 찾기 (검색어마다 7일)

const SEARCH_ROWS = 30;

/** 관광지(12)·문화시설(14)만 이름으로 찾기. 검색어마다 7일 저장. */
export async function searchTour(q: string): Promise<Cached<TourItem[]>> {
  const norm = q.replace(/\s+/g, " ").trim().toLowerCase();
  return cachedTour(`search:${norm}`, 7 * 24 * 60, async () => {
    const pages = await Promise.all(SEARCH_TYPES.map((t) =>
      tourCall("searchKeyword2", { keyword: q, contentTypeId: t, arrange: "A", numOfRows: String(SEARCH_ROWS), pageNo: "1" })));
    return pages.flatMap((p) => p.items).filter((x) => (SEARCH_TYPES as readonly string[]).includes(x.contentTypeId));
  });
}

/**
 * 이름으로 TourAPI 한 곳 찾기 (100선 좌표·번호 채우기용). '&'·괄호 앞 첫 이름으로 찾고 이름이 맞는 첫 줄.
 * 관광지(12) → 문화시설(14) 순. 못 찾으면 null.
 */
export async function lookupTourByName(name: string): Promise<TourItem | null> {
  const first = name.replace(/\([^)]*\)/g, "").split(/[&,]/)[0].trim();
  const r = await searchTour(first);
  return r.data.find((x) => namesMatch(x.title, name) && x.lat != null) ?? null;
}
