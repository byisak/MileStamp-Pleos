import { sql } from "./db";
import { addDays, kstToday } from "./festival-shape";
import { DEMO_HOME_CELL, familyHome, loadFamily, parseCell, type Who } from "./plan";
import type { Companion, LatLng } from "./planner";
import { companionSign, fitView } from "./companion-shape";
import {
  cleanQuery, curatedItem, matchOurPlace, mergeFestivals, namesMatch, normName, ourFestivalItem, ourPlaceItem,
  sortNearest, tourPlaceItem, weekendOf, type ExploreItem,
} from "./explore-shape";
import { KTO100_LIST, type CuratedRow } from "./kto100-shape";
import { isExtId as isExtIdShape, newlyVisitedExt } from "./ext";
import { mergeSuggest, parseFrom, pinItem, looksLikeAddress, type SuggestItem } from "./kakao-local-shape";
import { KakaoUnavailable, kakaoAddress, kakaoKeyword, kakaoReverse } from "./kakao-local";
import { lookupTourByName, nationwideFestivals, searchTour, TourUnavailable } from "./tourapi";
import { applyExploreQuery, type ExploreQuery } from "./explore-filter";
import { loadPopularity } from "./explore-popularity";

/*
 * '내가 고르기' 서버 쪽 (docs/직접-고르기-계획.md §6·§7): 축제·100선·직접 찾기 목록, '다녀옴' 기록, 관리자 '많이 고른 곳'.
 * 모양·정렬은 explore-shape.ts, TourAPI는 tourapi.ts. 표는 db/schema.sql 끝 절(tour_cache·curated_places·visits_ext).
 */

// ------------------------------------------------------------------ 집 (차 시간 기준)

/**
 * 차 시간을 잴 기준: 요청 from=lat,lng(폰에서 고른 '지금 내 위치'·'직접 정한 곳', 약 1km로 반올림) →
 * 폰에서 정한 집 → 차가 아는 집 칸 → (데모 차) 북구청 → 요청 lat·lng → 모름(null).
 * 집 좌표는 응답에 넣지 않는다. 축제 목록의 날짜 from=YYYY-MM-DD는 좌표 모양이 아니라 여기서 무시된다.
 */
export async function exploreHome(who: Who, q: URLSearchParams): Promise<LatLng | null> {
  const ref = parseFrom(q.get("from"));
  if (ref) return ref;
  const { family, homeCell } = await loadFamily(who.carId);
  const h = familyHome(family, homeCell, who.demo ? DEMO_HOME_CELL : null);
  if (h) return h;
  return parseCell(q.get("lat") && q.get("lng") ? `${q.get("lat")},${q.get("lng")}` : null);
}

// ------------------------------------------------------------------ 우리 것

type OurPlace = { id: string; name: string; lat: number; lng: number; indoor: boolean; stampable: boolean; region: string | null; image: string | null };

export async function ourPlaces(): Promise<OurPlace[]> {
  return sql<OurPlace[]>`
    select id, name, lat, lng, indoor, stampable, region, coalesce(stamp_url, bg_url) as image from places where active order by id`;
}

type OurFestival = { id: string; name: string; starts: string; ends: string; lat: number; lng: number; indoor: boolean; poster: string | null; source: string | null; addr: string | undefined };

/** 등록 축제 (addr = 묶인 명소의 지역 글 '대구 동구 …' — 시·도 고르기에 씀, 없으면 좌표로). */
async function ourFestivals(from: string, to: string): Promise<OurFestival[]> {
  const rows = await sql<(Omit<OurFestival, "addr"> & { addr: string | null })[]>`
    select f.id, f.name, f.starts::text as starts, f.ends::text as ends, f.lat, f.lng, f.indoor, f.poster_url as poster, f.source,
           pl.region as addr
    from festivals f left join places pl on pl.id = f.place_id
    where f.active and f.ends >= ${from}::date and f.starts <= ${to}::date order by f.starts, f.id`;
  return rows.map((r) => ({ ...r, addr: r.addr ?? undefined }));
}

/** TourAPI가 안 될 때 응답에 붙이는 이유 ('nokey' 키 없음 · 'quota' 한도 · 'error' 실패). */
export type TourStatus = { ok: true; fetchedAt: string; stale: boolean } | { ok: false; reason: "nokey" | "quota" | "error"; message: string };

function tourFail(e: unknown): TourStatus {
  if (e instanceof TourUnavailable) return { ok: false, reason: e.reason, message: e.message };
  console.error("TourAPI 실패", e);
  return { ok: false, reason: "error", message: "관광공사 정보를 받지 못했어요" };
}

// ------------------------------------------------------------------ 축제

export const FESTIVAL_DAYS_DEFAULT = 30;

/**
 * 축제 목록: 등록 축제(먼저) + 전국 TourAPI 축제(하루 한 번 받은 것) → 거리·시·도·인기는 서버에서 거른다
 * (관광공사 호출 수는 그대로). withPlaces면 우리 명소도 같은 거르기로 places에.
 */
export async function exploreFestivals(opts: { home: LatLng | null; from: string; days: number; query: ExploreQuery; withPlaces?: boolean }) {
  const to = addDays(opts.from, opts.days);
  const [ours, tour] = await Promise.all([
    ourFestivals(opts.from, to),
    nationwideFestivals(kstToday()).then(
      (r) => ({ items: r.data, status: { ok: true, fetchedAt: r.fetchedAt, stale: r.stale } as TourStatus }),
      (e) => ({ items: [], status: tourFail(e) }),
    ),
  ]);
  const wk = weekendOf(opts.from);
  const all = mergeFestivals({
    ours: ours.map((f) => ourFestivalItem(f, opts.home, wk)),
    ourSources: Object.fromEntries(ours.filter((f) => f.source?.startsWith("tourapi:")).map((f) => [f.id, f.source!])),
    tour: tour.items,
    home: opts.home,
    from: opts.from,
    days: opts.days,
  });
  const pop = await loadPopularity();
  const r = applyExploreQuery(all, opts.query, pop);
  const places = opts.withPlaces
    ? applyExploreQuery(sortNearest((await ourPlaces()).map((p) => ourPlaceItem(p, opts.home))), opts.query, pop).items
    : undefined;
  return { ...r, total: all.length, places, tour: tour.status, weekend: wk };
}

// ------------------------------------------------------------------ 직접 찾기

/** 이름으로 찾기: 우리 명소(이름이 맞는 곳) 먼저 + TourAPI 관광지·문화시설(우리 명소와 같은 곳은 뺌), 가까운 순. */
export async function exploreSearch(opts: { home: LatLng | null; q: string }) {
  const q = cleanQuery(opts.q);
  if (!q) return { items: [] as ExploreItem[], tour: { ok: true, fetchedAt: new Date().toISOString(), stale: false } as TourStatus };
  const places = await ourPlaces();
  const nq = normName(q);
  const mine = places.filter((p) => normName(p.name).includes(nq) || namesMatch(p.name, q));
  let tourStatus: TourStatus;
  let tourItems: ExploreItem[] = [];
  try {
    const r = await searchTour(q);
    tourStatus = { ok: true, fetchedAt: r.fetchedAt, stale: r.stale };
    tourItems = r.data
      .filter((t) => !matchOurPlace({ name: t.title, lat: t.lat, lng: t.lng }, places, 2))
      .map((t) => tourPlaceItem(t, opts.home))
      .filter((x): x is ExploreItem => !!x);
  } catch (e) {
    tourStatus = tourFail(e);
  }
  const ours = sortNearest(mine.map((p) => ourPlaceItem(p, opts.home)));
  return { items: [...ours, ...sortNearest(tourItems)], tour: tourStatus };
}

// ------------------------------------------------------------------ 지도 검색 (카카오 로컬, docs/검색-거리순-계획.md ②)

/** 카카오가 안 될 때 이유 ('nokey' 키 없음 · 'error' 실패) — 그땐 우리 명소만 */
export type KakaoStatus = { ok: true; stale: boolean } | { ok: false; reason: "nokey" | "error"; message: string };

function kakaoFail(e: unknown): KakaoStatus {
  if (e instanceof KakaoUnavailable) return { ok: false, reason: e.reason, message: e.message };
  console.error("카카오 로컬 실패", e);
  return { ok: false, reason: "error", message: "카카오 검색을 잠깐 못 했어요" };
}

/**
 * 자동완성: 우리 명소(이름 맞는 곳) → 주소처럼 보이면 '이 주소로' → 카카오 장소(관광명소·문화시설 → 공원·체험·키즈 → 그 밖 → 음식점·카페).
 * 키워드·주소 검색은 같이 부르고, 하나가 실패해도 나머지로 답한다.
 */
export async function exploreSuggest(opts: { ref: LatLng | null; q: string }) {
  const q = cleanQuery(opts.q);
  if (!q) return { items: [] as SuggestItem[], kakao: { ok: true, stale: false } as KakaoStatus };
  const wantAddr = looksLikeAddress(q);
  const [ours, kw, addr] = await Promise.all([
    ourPlaces(),
    kakaoKeyword(q).then((r) => ({ data: r.data, st: { ok: true, stale: r.stale } as KakaoStatus }), (e) => ({ data: [], st: kakaoFail(e) })),
    wantAddr
      ? kakaoAddress(q).then((r) => ({ data: r.data, st: { ok: true, stale: r.stale } as KakaoStatus }), (e) => ({ data: [], st: kakaoFail(e) }))
      : Promise.resolve({ data: [], st: { ok: true, stale: false } as KakaoStatus }),
  ]);
  const items = mergeSuggest({ q, ref: opts.ref, ours, kakao: kw.data, addresses: addr.data });
  return { items, kakao: kw.st.ok ? addr.st : kw.st, address: wantAddr };
}

/** 지도 길게 누름 → 그 자리 한 줄 (주소를 못 찾아도 '지도에서 고른 곳'으로 고를 수 있게). */
export async function exploreReverse(opts: { ref: LatLng | null; lat: number; lng: number }) {
  let found: { name: string; addr: string } | null = null;
  let st: KakaoStatus = { ok: true, stale: false };
  try {
    const r = await kakaoReverse(opts.lat, opts.lng);
    found = r.data;
    st = { ok: true, stale: r.stale };
  } catch (e) {
    st = kakaoFail(e);
  }
  return { item: pinItem(opts.lat, opts.lng, found, opts.ref), kakao: st };
}

// ------------------------------------------------------------------ 한국관광 100선

export async function curatedRows(list = KTO100_LIST): Promise<CuratedRow[]> {
  return sql<CuratedRow[]>`
    select no, name, area, region, lat, lng, addr, content_id, image, our_place_id from curated_places where list = ${list} order by no`;
}

/** 100선 목록: 우리 명소와 같은 곳(관리자가 정한 our_place_id → 이름·5km)은 우리 명소로(도장), 가까운 순 → 거리·시·도·인기. */
export async function exploreKto100(opts: { home: LatLng | null; query: ExploreQuery; list?: string }) {
  const [rows, places] = await Promise.all([curatedRows(opts.list), ourPlaces()]);
  const byId = new Map(places.map((p) => [p.id, p]));
  const items = rows
    .map((r) => curatedItem(r, (r.our_place_id ? byId.get(r.our_place_id) : null) ?? matchOurPlace(r, places), opts.home))
    .filter((x): x is ExploreItem => !!x);
  const r = applyExploreQuery(sortNearest(items), opts.query, await loadPopularity());
  return { ...r, total: rows.length };
}

/** 관리자: 판 올리기 (같은 이름은 고침, 판에 없는 이름은 지움). our_place_id는 새 값이 있을 때만 덮음. */
export async function saveCurated(list: string, rows: CuratedRow[]): Promise<number> {
  if (!rows.length) return 0;
  return sql.begin(async (tx) => {
    for (const r of rows) {
      await tx`
        insert into curated_places (list, no, name, content_id, lat, lng, area, region, addr, image, our_place_id)
        values (${list}, ${r.no}, ${r.name}, ${r.content_id}, ${r.lat}, ${r.lng}, ${r.area}, ${r.region}, ${r.addr}, ${r.image}, ${r.our_place_id})
        on conflict (list, name) do update set no = excluded.no,
          content_id = coalesce(excluded.content_id, curated_places.content_id),
          lat = coalesce(excluded.lat, curated_places.lat), lng = coalesce(excluded.lng, curated_places.lng),
          area = excluded.area, region = excluded.region, addr = coalesce(excluded.addr, curated_places.addr),
          image = coalesce(excluded.image, curated_places.image),
          our_place_id = coalesce(excluded.our_place_id, curated_places.our_place_id), updated_at = now()`;
    }
    await tx`delete from curated_places where list = ${list} and not (name = any(${rows.map((r) => r.name)}))`;
    return rows.length;
  }) as Promise<number>;
}

/**
 * 관리자: TourAPI로 번호(contentid)·좌표·사진 채우기 — content_id가 빈 줄만, 한 번에 [max]곳(한 곳당 1~2회 부름).
 * 좌표는 TourAPI 값이 사람이 적은 근사값보다 정확하므로 덮는다.
 */
export async function fillCuratedFromTour(list = KTO100_LIST, max = 25) {
  const rows = (await curatedRows(list)).filter((r) => !r.content_id).slice(0, max);
  const filled: string[] = [];
  const missing: string[] = [];
  for (const r of rows) {
    const t = await lookupTourByName(r.name).catch((e) => {
      if (e instanceof TourUnavailable && e.reason !== "error") throw e;
      return null;
    });
    if (!t || t.lat == null || t.lng == null) { missing.push(r.name); continue; }
    await sql`
      update curated_places set content_id = ${t.contentId}, lat = ${t.lat}, lng = ${t.lng},
        addr = ${t.addr || r.addr}, image = coalesce(${t.image}, image), updated_at = now()
      where list = ${list} and name = ${r.name}`;
    filled.push(r.name);
  }
  const [left] = await sql<{ n: number }[]>`select count(*)::int as n from curated_places where list = ${list} and content_id is null`;
  return { filled, missing, left: left.n };
}

/** 관리자: 우리 명소와 직접 묶기·풀기 (null = 이름·거리로 자동). */
export async function setCuratedPlace(list: string, name: string, placeId: string | null) {
  const r = await sql`update curated_places set our_place_id = ${placeId}, updated_at = now() where list = ${list} and name = ${name}`;
  return r.count;
}

// ------------------------------------------------------------------ '다녀옴' 기록

export type ExtVisitInput = {
  /** 가족 = 차 id (families.car_id와 같음) */
  familyId: string;
  /** 'ext:tour:<contentId>' | 'ext:kto100:<no>' | 'ext:kakao:<id>' | 'ext:pin:<lat>,<lng>' */
  extId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  /** 도착 시각 (없으면 지금). 한국 날짜로 하루 한 번. */
  at?: Date;
  /** 'car'(차 도착 판정) | 'phone'(폰에서 '다녀왔어요') | 'course'(코스 DONE) */
  source?: "car" | "phone" | "course" | "auto";
};

/** 바깥 장소 id ('ext:tour:…'·'ext:kto100:…'·'ext:kakao:…'·'ext:pin:<lat>,<lng>') — lib/ext.ts와 같은 규칙 */
export const isExtId = (id: string) => isExtIdShape(id);

/**
 * '다녀옴' 넣기 — 도장이 없는 바깥 장소에 실제로 도착했을 때 (차 도착 판정·코스 DONE이 부름).
 * 같은 가족·같은 곳·같은 한국 날짜는 한 번만: 새로 넣었으면 {created:true}, 이미 있으면 {created:false}.
 * ext id 모양이 아니면 throw (우리 명소·축제는 도장 쪽으로).
 */
export async function recordExtVisit(v: ExtVisitInput): Promise<{ created: boolean; id: string | null; day: string }> {
  if (!isExtId(v.extId)) throw new Error(`바깥 장소 id가 아니에요: ${v.extId}`);
  const at = v.at ?? new Date();
  const day = kstToday(at);
  const lat = v.lat != null && Number.isFinite(v.lat) ? Math.round(v.lat * 1e5) / 1e5 : null;
  const lng = v.lng != null && Number.isFinite(v.lng) ? Math.round(v.lng * 1e5) / 1e5 : null;
  const [r] = await sql<{ id: string }[]>`
    insert into visits_ext (family_id, ext_id, name, lat, lng, day, visited_at, source)
    values (${v.familyId}, ${v.extId}, ${v.name.slice(0, 120)}, ${lat}, ${lng}, ${day}::date, ${at}, ${v.source ?? "car"})
    on conflict (family_id, ext_id, day) do nothing
    returning id`;
  return { created: !!r, id: r?.id ?? null, day };
}

/**
 * 코스가 바뀐 뒤(차 도착 사건·폰·안드로이드 오토의 Arrived 등) 새로 도착·다녀옴이 된 바깥 장소를 '다녀옴'으로 적는다.
 * 하루 한 곳 한 번(표의 unique)이라 여러 번 불러도 같다. 적은 수를 돌려준다.
 */
export async function recordCourseExtVisits(
  familyId: string, before: { stops?: unknown[] } | null | undefined, after: { stops?: unknown[] } | null | undefined, source: "car" | "phone" | "course" | "auto",
): Promise<number> {
  let n = 0;
  for (const hit of newlyVisitedExt(before as never, after as never)) {
    if (!isExtId(hit.extId)) continue;
    const r = await recordExtVisit({ familyId, extId: hit.extId, name: hit.name, lat: hit.lat, lng: hit.lng, source });
    if (r.created) n++;
  }
  return n;
}

export type ExtVisited = { extId: string; name: string; lat: number | null; lng: number | null; times: number; first: string; last: string; days: string[] };

/** 가족이 다녀온 바깥 장소 (곳마다 한 줄, 최근 순). */
export async function listExtVisits(familyId: string): Promise<ExtVisited[]> {
  const rows = await sql<{ ext_id: string; name: string; lat: number | null; lng: number | null; times: number; first: Date; last: Date; days: string[] }[]>`
    select ext_id, (array_agg(name order by visited_at desc))[1] as name,
           (array_agg(lat order by visited_at desc))[1] as lat, (array_agg(lng order by visited_at desc))[1] as lng,
           count(*)::int as times, min(visited_at) as first, max(visited_at) as last,
           array_agg(day::text order by day desc) as days
    from visits_ext where family_id = ${familyId}
    group by ext_id order by max(visited_at) desc`;
  return rows.map((r) => ({
    extId: r.ext_id, name: r.name, lat: r.lat, lng: r.lng, times: r.times,
    first: r.first.toISOString(), last: r.last.toISOString(), days: r.days,
  }));
}

// ------------------------------------------------------------------ 관리자 '많이 고른 곳'

export type PopularExt = {
  id: string; name: string; lat: number | null; lng: number | null;
  /** 고른 횟수(계획 카드를 고른 수) · 고른 가족 수(데모 차 빼고) · 데모 차가 고른 수 · '다녀옴' 수 */
  picks: number; families: number; demoPicks: number; visits: number;
  last: string;
};

/**
 * 계획에서 고른 카드(plans.options[chosen].stops)에 들어 있는 바깥 장소(ext:…)를 많이 고른 순으로 (읽기만).
 * 앵커 코스도 같은 plans·choose를 쓰므로 여기에 같이 잡힌다. '다녀옴' 수도 붙임.
 */
export async function popularExt(days = 90, limit = 50): Promise<PopularExt[]> {
  const rows = await sql<{ id: string; name: string; lat: number | null; lng: number | null; picks: number; families: number; demo_picks: number; last: Date }[]>`
    with picked as (
      select s->>'id' as id, s->>'name' as name, (s->>'lat')::float8 as lat, (s->>'lng')::float8 as lng,
             p.car_id, c.demo, coalesce(p.chosen_at, p.created_at) as at
      from plans p
      join cars c on c.id = p.car_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(p.options -> p.chosen::int -> 'stops') = 'array'
                                                   then p.options -> p.chosen::int -> 'stops' else '[]'::jsonb end) s
      where p.chosen is not null and p.created_at > now() - make_interval(days => ${days})
        and s->>'id' like 'ext:%'
    )
    select id, (array_agg(name order by at desc))[1] as name, avg(lat) as lat, avg(lng) as lng,
           count(*)::int as picks, count(distinct car_id) filter (where not demo)::int as families,
           count(*) filter (where demo)::int as demo_picks, max(at) as last
    from picked group by id
    order by count(distinct car_id) filter (where not demo) desc, count(*) desc, max(at) desc
    limit ${limit}`;
  const visits = rows.length
    ? await sql<{ ext_id: string; n: number }[]>`
        select ext_id, count(*)::int as n from visits_ext where ext_id = any(${rows.map((r) => r.id)}) group by ext_id`
    : [];
  const vmap = new Map(visits.map((v) => [v.ext_id, v.n]));
  return rows.map((r) => ({
    id: r.id, name: r.name, lat: r.lat, lng: r.lng, picks: r.picks, families: r.families, demoPicks: r.demo_picks,
    visits: vmap.get(r.id) ?? 0, last: r.last.toISOString(),
  }));
}

// ------------------------------------------------------------------ 누구랑 가요? 표시 (목록 공용)

/**
 * 목록 줄마다 동행 표시를 붙인다: fitSign(+1 이 동행에게 좋아요 · −1 덜 맞아요 · 0 모름) · fitNote(짧은 글, 없으면 null).
 * 우리 명소·축제는 DB 동행 적합도로, 바깥 곳은 이름으로 짐작(술·밤 공연 같은 어른 위주 행사: 아이와 −, 연인·친구 +).
 * [companion]이 없으면 그대로 (옛 앱). 순서는 바꾸지 않는다 — 폰이 표시·거르기에 쓴다.
 */
export async function withCompanionSign<T extends { id: string; name: string; kind?: string; ourPlaceId?: string | null }>(
  items: T[], companion: Companion | null,
): Promise<(T & { fitSign?: -1 | 0 | 1; fitNote?: string | null })[]> {
  if (!companion || !items.length) return items;
  const rows = await sql<{ id: string; kid_fit: number; fit: unknown }[]>`
    select id, kid_fit, fit from places union all select id, kid_fit, fit from festivals`;
  const fits = new Map(rows.map((r) => [r.id, fitView(Number(r.kid_fit), r.fit)]));
  return items.map((it) => {
    const fit = fits.get(it.ourPlaceId ?? it.id) ?? null;
    const { sign, note } = companionSign(it, companion, fit);
    return { ...it, fitSign: sign, fitNote: note };
  });
}
