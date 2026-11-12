import introData from "./intro-data.json";
import { fitView } from "./companion-shape";
import { sql } from "./db";
import { PLACES } from "./places";
import {
  ALBUM_GROUPS,
  normalizeMission,
  normalizePoints,
  radiusOf,
  type AdminPlace,
  type CatalogPlace,
  type PlaceInput,
} from "./catalog-shape";
import { engineRestaurant, foodOfRow, FOOD_TAG_CATEGORY, FOOD_TAGS, type FoodInput, type FoodRestaurant, type FoodRow } from "./restaurant-shape";
import type { Restaurant as EngineRestaurant } from "./planner";
import {
  DEFAULT_TAG_VOCAB, PLACE_KINDS, draftsOf, fitExtraOf, hoursRowsLoose, metaOf, parseAiDrafts, parseClosedRules, parseMoments, parseParking, parsePrice, parseRoute, vocabTags,
  type AiDrafts, type Moments, type VocabWord,
} from "./place-attrs-shape";
import { HOURS_JSON, missingStructure } from "./plan";

/*
 * 명소 목록(catalog) — 관리자 화면이 고치고, 폰·차가 GET /api/catalog?since=N 으로 받는다.
 * 관리자 저장마다 catalog_meta.version +1. 표 설명은 db/schema.sql '관리자' 절.
 */

type Row = {
  id: string; name: string; lat: number; lng: number; region: string | null; grp: string | null; album: string | null;
  indoor: boolean; open_min: number; close_min: number; dwell_p80: number; kid_fit: number; stampable: boolean; active: boolean;
  tags: string[]; hours: string | null; closed: string | null; facilities: string[]; closed_days: number[]; temp_closed: string[];
  points: unknown; intro: string | null; mission: unknown; stamp_url: string | null; stamp_bw_url: string | null;
  stamp_version: number; popular: number; edited_at: Date | null; fit: unknown; dwell_adult: number | null;
  /** 장소 구조 칸 (11/3) — 표·칸이 아직 없는 DB면 없음 */
  open_hours?: unknown; closed_rules?: string[] | null; parking?: unknown; price?: unknown; moments?: unknown;
  region_code?: string | null; kind?: string | null; route?: unknown; meta?: unknown;
};

const clips = (introData as { clips: Record<string, { text: string }> }).clips;

/** 소개 글이 DB에 없으면 앱에 들어 있는 본편 대본. */
function defaultIntro(id: string): string {
  return clips[`${id}_full_60s`]?.text ?? "";
}

function toAdmin(r: Row): AdminPlace {
  const points = normalizePoints(r.points, r.lat, r.lng);
  return {
    id: r.id, name: r.name, lat: r.lat, lng: r.lng, region: r.region, research: r.grp,
    album: r.album && ALBUM_GROUPS.some((g) => g.key === r.album) ? r.album : "weekend",
    indoor: r.indoor, open: r.open_min, close: r.close_min, dwell: r.dwell_p80, kidFit: r.kid_fit,
    fit: fitView(r.kid_fit, r.fit), dwellAdult: r.dwell_adult ?? null,
    stampable: r.stampable, active: r.active, tags: r.tags ?? [], hours: r.hours, closed: r.closed,
    facilities: r.facilities ?? [], closedDays: (r.closed_days ?? []).map(Number), tempClosed: r.temp_closed ?? [],
    points,
    intro: r.intro ?? defaultIntro(r.id),
    mission: normalizeMission(r.mission) ?? PLACES[r.id]?.mission ?? null,
    stamp: { url: r.stamp_url, bwUrl: r.stamp_bw_url, version: r.stamp_version },
    popular: r.popular,
    editedAt: r.edited_at ? r.edited_at.toISOString() : null,
    ...structuredOf(r),
  };
}

const okOrNull = <T,>(r: { ok: T } | { error: string }): T | null => ("ok" in r ? r.ok : null);

/** DB 칸 → 관리자·앱 모양 (이상한 값은 빈 칸으로). */
function structuredOf(r: Row) {
  const openHours = hoursRowsLoose(r.open_hours);
  const kind = PLACE_KINDS.find((k) => k === r.kind) ?? "spot";
  return {
    openHours,
    closedRules: parseClosedRules(r.closed_rules ?? []) ?? [],
    parking: okOrNull(parseParking(r.parking ?? null)),
    price: okOrNull(parsePrice(r.price ?? null)),
    moments: okOrNull(parseMoments(r.moments ?? null, { hours: openHours, open: r.open_min, close: r.close_min }))
      // 쇼 시각 검사에 걸려도 저장된 값은 보여 준다 (관리자가 고치게)
      ?? (r.moments && typeof r.moments === "object" ? (r.moments as Moments) : null),
    regionCode: r.region_code ?? null,
    kind,
    route: kind === "drive" ? okOrNull(parseRoute(r.route ?? null, kind)) : null,
    fitExtra: fitExtraOf(r.fit),
    meta: metaOf(r.meta),
    aiDrafts: draftsOf(r.meta),
  };
}

/** 표·칸이 있는 DB면 새 칸까지, 없으면(운영 반영 전) 예전 칸만. */
const STRUCT_COLS = sql`, ${HOURS_JSON("place", "places.id")} as open_hours, closed_rules, parking, price, moments, region_code, kind, route, meta`;
type Frag = typeof STRUCT_COLS;
async function withStructure<T>(q: (extra: Frag) => Promise<T>): Promise<T> {
  return q(STRUCT_COLS).catch((e) => {
    if (missingStructure(e)) return q(sql`` as Frag);
    throw e;
  });
}

/** 태그 단어장 (표가 없으면 처음 단어장). */
export async function loadTagVocab(): Promise<VocabWord[]> {
  try {
    const rows = await sql<VocabWord[]>`select tag, category, sort from tag_vocab order by sort, tag`;
    return rows.length ? rows : DEFAULT_TAG_VOCAB;
  } catch (e) {
    if (missingStructure(e)) return DEFAULT_TAG_VOCAB;
    throw e;
  }
}

/** 단어장에 말 더하기 (관리자). 이미 있으면 그대로. */
export async function addTagVocab(tag: string, category: string): Promise<VocabWord[]> {
  await sql`insert into tag_vocab (tag, category, sort)
            values (${tag}, ${category}, coalesce((select max(sort) + 1 from tag_vocab), 200))
            on conflict (tag, category) do nothing`;
  await bumpVersion();
  return loadTagVocab();
}

async function rows(onlyActive: boolean): Promise<Row[]> {
  return withStructure((extra) => sql<Row[]>`
    select id, name, lat, lng, region, grp, album, indoor, open_min, close_min, dwell_p80, kid_fit, stampable, active,
           tags, hours, closed, facilities, closed_days, temp_closed::text[] as temp_closed, points, intro, mission,
           stamp_url, stamp_bw_url, stamp_version, popular, edited_at, fit, dwell_adult ${extra}
    from places
    where ${onlyActive ? sql`active` : sql`true`}
    order by id`);
}

export async function catalogVersion(): Promise<number> {
  const [m] = await sql<{ version: number }[]>`select version from catalog_meta where id = 1`;
  return m?.version ?? 1;
}

export async function loadAdminPlaces(): Promise<AdminPlace[]> {
  return (await rows(false)).map(toAdmin);
}

export function toCatalog(p: AdminPlace, vocab: readonly VocabWord[] = DEFAULT_TAG_VOCAB): CatalogPlace {
  return {
    id: p.id, name: p.name, grp: p.album, points: p.points, lat: p.lat, lng: p.lng, radiusM: radiusOf(p.points),
    indoor: p.indoor, open: p.open, close: p.close, dwell: p.dwell, kidFit: p.kidFit, fit: p.fit, dwellAdult: p.dwellAdult,
    stampable: p.stampable, tags: p.tags, facilities: p.facilities, closedDays: p.closedDays, tempClosed: p.tempClosed,
    intro: p.intro || null, mission: p.mission, stamp: p.stamp,
    // 11/3 새 칸 (옛 앱은 무시)
    openHours: p.openHours, closedRules: p.closedRules, parking: p.parking, price: p.price, moments: p.moments,
    regionCode: p.regionCode, kind: p.kind, route: p.route,
    fitKidAge: p.fitExtra.kid_age ?? null, fitEvening: p.fitExtra.evening ?? null,
    vocabTags: vocabTags(p.tags, vocab),
  };
}

/** 앱용 목록. [since]가 지금 버전과 같으면 { version, unchanged: true }만. */
export async function loadCatalog(since?: number) {
  const version = await catalogVersion();
  if (since !== undefined && since === version) return { version, unchanged: true as const };
  const [places, restaurants, vocab] = await Promise.all([rows(true), loadRestaurants(true), loadTagVocab()]);
  return {
    version,
    places: places.map((r) => toCatalog(toAdmin(r), vocab)),
    groups: ALBUM_GROUPS,
    restaurants,
  };
}

/** 목록 버전 +1 (관리자 저장마다). */
export async function bumpVersion(tx: typeof sql = sql): Promise<number> {
  const [m] = await tx<{ version: number }[]>`
    insert into catalog_meta (id, version) values (1, 2)
    on conflict (id) do update set version = catalog_meta.version + 1, updated_at = now()
    returning version`;
  return m.version;
}

/** 명소 저장. 대표 좌표(lat/lng)는 첫 도착 지점 — 추천 거리 계산이 그 점을 쓴다. */
export async function savePlace(id: string, p: PlaceInput): Promise<{ place: AdminPlace; version: number } | null> {
  return sql.begin(async (tx) => {
    const first = p.points[0];
    const [r] = await tx<{ id: string }[]>`
      update places set
        name = ${p.name}, album = ${p.album}, indoor = ${p.indoor}, open_min = ${p.open}, close_min = ${p.close},
        dwell_p80 = ${p.dwell}, kid_fit = ${p.kidFit}, stampable = ${p.stampable}, active = ${p.active},
        facilities = ${p.facilities}, closed_days = ${p.closedDays}::int[], temp_closed = ${p.tempClosed}::date[],
        points = ${tx.json(p.points)}, lat = ${first.lat}, lng = ${first.lng},
        intro = ${p.intro || null}, mission = ${p.mission ? tx.json(p.mission) : null},
        fit = ${p.fit ? tx.json(p.fit as never) : sql`fit`}, tags = ${p.tags ?? sql`tags`}, dwell_adult = ${p.dwellAdult},
        edited_at = now(), updated_at = now()
      where id = ${id}
      returning id`;
    if (!r) return null;
    // 장소 구조 칸 — 보낸 것만 (undefined = 그대로)
    const j = (v: unknown) => (v == null ? null : tx.json(v as never));
    const structured = [p.openHours, p.closedRules, p.parking, p.price, p.moments, p.regionCode, p.kind, p.meta, p.aiDrafts].some((v) => v !== undefined);
    if (structured) {
      await tx`
        update places set
          closed_rules = ${p.closedRules ?? sql`closed_rules`},
          parking = ${p.parking === undefined ? sql`parking` : j(p.parking)},
          price = ${p.price === undefined ? sql`price` : j(p.price)},
          moments = ${p.moments === undefined ? sql`moments` : j(p.moments)},
          region_code = ${p.regionCode === undefined ? sql`region_code` : p.regionCode},
          kind = ${p.kind ?? sql`kind`},
          route = ${p.kind === undefined ? sql`route` : j(p.route ?? null)},
          meta = ${metaWithDrafts(tx as unknown as typeof sql, p.meta, p.aiDrafts)}
        where id = ${id}`;
    }
    if (p.openHours !== undefined) {
      await tx`delete from entity_hours where entity_kind = 'place' and entity_id = ${id}`;
      for (const [i, h] of p.openHours.entries()) {
        await tx`
          insert into entity_hours (entity_kind, entity_id, days, holiday, open_min, close_min, last_entry_min, breaks, valid_from, valid_to, note, sort)
          values ('place', ${id}, ${h.days}::smallint[], ${h.holiday}, ${h.openMin}, ${h.closeMin}, ${h.lastEntryMin},
                  ${tx.json(h.breaks as never)}, ${h.validFrom}, ${h.validTo}, ${h.note}, ${i})`;
      }
    }
    const version = await bumpVersion(tx as unknown as typeof sql);
    const [row] = await tx<Row[]>`
      select id, name, lat, lng, region, grp, album, indoor, open_min, close_min, dwell_p80, kid_fit, stampable, active,
             tags, hours, closed, facilities, closed_days, temp_closed::text[] as temp_closed, points, intro, mission,
             stamp_url, stamp_bw_url, stamp_version, popular, edited_at, fit, dwell_adult
             ${structured || p.openHours !== undefined ? STRUCT_COLS : sql``}
      from places where id = ${id}`;
    return { place: toAdmin(row), version };
  });
}

/**
 * meta jsonb 쓰기: 칸 출처(meta)와 AI 초안(meta.drafts)을 한 칸에. 초안을 안 보냈으면(undefined) DB 초안을 그대로 둔다
 * (예전 화면·다른 도구가 저장해도 초안이 안 지워지게). meta를 안 보냈으면 출처는 그대로, 초안만 바꾼다.
 */
function metaWithDrafts(tx: typeof sql, meta: object | undefined, drafts: AiDrafts | undefined) {
  if (meta === undefined && drafts === undefined) return sql`meta`;
  if (meta === undefined) return sql`jsonb_set(coalesce(meta, '{}'::jsonb), '{drafts}', ${tx.json(drafts as never)})`;
  if (drafts === undefined) return sql`${tx.json(meta as never)}::jsonb || jsonb_build_object('drafts', coalesce(meta -> 'drafts', '{}'::jsonb))`;
  return tx.json({ ...meta, drafts } as never);
}

/** AI 채우기: 초안만 바꾼다 (칸·목록 버전은 그대로 — 앱은 초안을 모른다). 없는 곳이면 false. */
export async function saveAiDrafts(kind: "place" | "restaurant", id: string, drafts: AiDrafts): Promise<boolean> {
  const d = sql.json(drafts as never);
  const r = kind === "place"
    ? await sql`update places set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{drafts}', ${d}) where id = ${id} returning id`
    : await sql`update restaurants set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{drafts}', ${d}) where id = ${id}::uuid returning id`;
  return r.length > 0;
}

/** 새 명소 (id는 영문 소문자). 처음엔 추천에서 빠진 상태(active=false)로 만든다. */
export async function createPlace(id: string, name: string, lat: number, lng: number, album: string) {
  return sql.begin(async (tx) => {
    const [r] = await tx<{ id: string }[]>`
      insert into places (id, name, lat, lng, album, active, stampable, points, edited_at)
      values (${id}, ${name}, ${lat}, ${lng}, ${album}, false, false,
              ${tx.json([{ lat, lng, r: 300, name: "정문·주차장" }])}, now())
      on conflict (id) do nothing
      returning id`;
    if (!r) return null;
    return bumpVersion(tx as unknown as typeof sql);
  });
}

/** 도장 그림 바꾸기 (관리자 '도장 올리기'). */
export async function saveStamp(id: string, url: string, bwUrl: string) {
  return sql.begin(async (tx) => {
    const [r] = await tx<{ stamp_version: number }[]>`
      update places set stamp_url = ${url}, stamp_bw_url = ${bwUrl}, stamp_version = stamp_version + 1,
                        stampable = true, edited_at = now(), updated_at = now()
      where id = ${id}
      returning stamp_version`;
    if (!r) return null;
    const version = await bumpVersion(tx as unknown as typeof sql);
    return { stampVersion: r.stamp_version, version };
  });
}

// ------------------------------------------------------------------ 맛집 (식당 구조 11/3 — restaurant-shape.ts)

/** 식당 운영 시간 줄 (entity_hours 'restaurant', 마지막 주문 포함) → API 모양 jsonb 배열. */
const FOOD_HOURS_JSON = sql.unsafe(`coalesce((
  select jsonb_agg(jsonb_build_object('days', h.days, 'holiday', h.holiday, 'openMin', h.open_min, 'closeMin', h.close_min,
    'lastEntryMin', h.last_entry_min, 'breaks', h.breaks, 'validFrom', h.valid_from, 'validTo', h.valid_to, 'note', h.note,
    'lastOrderMin', h.last_order_min) order by h.sort, h.id)
  from entity_hours h where h.entity_kind = 'restaurant' and h.entity_id = r.id::text), '[]'::jsonb)`);

const FOOD_COLS = sql`r.id, r.name, r.place_id, r.lat, r.lng, r.facilities, r.hours, r.closed, r.note, r.active`;
const FOOD_NEW_COLS = sql`, r.cuisine, r.price, r.kid, r.parking, r.wait, r.reserve, r.meal, r.dwell_min, r.fit, r.tags, r.meta,
  r.kakao_id, r.phone, r.address, r.url, ${FOOD_HOURS_JSON} as open_hours`;

/** 식당 목록 (관리자 = 전부, 앱·엔진 = 켜진 것). 새 칸이 아직 없는 DB(운영 반영 전)면 예전 칸만. */
export async function loadRestaurants(onlyActive = false): Promise<FoodRestaurant[]> {
  const q = (structured: boolean) => sql<FoodRow[]>`
    select ${FOOD_COLS} ${structured ? FOOD_NEW_COLS : sql``} from restaurants r
    where ${onlyActive ? sql`r.active` : sql`true`}
    order by r.place_id nulls last, r.name`;
  const rows = await q(true).catch((e) => {
    if (missingStructure(e)) return q(false);
    throw e;
  });
  return rows.map(foodOfRow);
}

async function oneRestaurant(tx: typeof sql, id: string): Promise<FoodRestaurant | null> {
  const [row] = await tx<FoodRow[]>`select ${FOOD_COLS} ${FOOD_NEW_COLS} from restaurants r where r.id = ${id}`;
  return row ? foodOfRow(row) : null;
}

/** 식당 저장 (없으면 새로). 운영 시간 줄은 통째로 바꾼다. 목록 버전 +1. */
export async function saveRestaurant(id: string | null, r: FoodInput) {
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as typeof sql;
    const j = (v: unknown) => (v == null ? null : tx.json(v as never));
    // 초안을 안 보냈으면 DB 초안 그대로
    let drafts = r.aiDrafts;
    if (drafts === undefined && id) {
      const [old] = await tx<{ d: unknown }[]>`select meta -> 'drafts' as d from restaurants where id = ${id}`;
      drafts = parseAiDrafts(old?.d);
    }
    const vals = {
      name: r.name, place_id: r.placeId, lat: r.lat, lng: r.lng, facilities: r.facilities, hours: r.hours, closed: r.closed, note: r.note,
      active: r.active, cuisine: r.cuisine, price: j(r.price), kid: j(r.kid), parking: j(r.parking), wait: j(r.wait), reserve: r.reserve,
      meal: r.meal, dwell_min: r.dwellMin, fit: j(r.fit), tags: r.tags, meta: tx.json({ ...r.meta, drafts } as never), kakao_id: r.kakaoId,
      phone: r.phone, address: r.address, url: r.url,
    };
    const cols = Object.keys(vals) as (keyof typeof vals)[];
    const [row] = id
      ? await tx<{ id: string }[]>`update restaurants set ${tx(vals, cols)}, updated_at = now() where id = ${id} returning id`
      : await tx<{ id: string }[]>`insert into restaurants ${tx(vals, cols)} returning id`;
    if (!row) return null;
    await tx`delete from entity_hours where entity_kind = 'restaurant' and entity_id = ${row.id}`;
    for (const [i, h] of r.openHours.entries()) {
      await tx`
        insert into entity_hours (entity_kind, entity_id, days, holiday, open_min, close_min, last_entry_min, breaks, valid_from, valid_to, note, sort, last_order_min)
        values ('restaurant', ${row.id}, ${h.days}::smallint[], ${h.holiday}, ${h.openMin}, ${h.closeMin}, ${h.lastEntryMin},
                ${tx.json(h.breaks as never)}, ${h.validFrom}, ${h.validTo}, ${h.note}, ${i}, ${h.lastOrderMin ?? null})`;
    }
    const version = await bumpVersion(tx);
    return { restaurant: await oneRestaurant(tx, row.id), version };
  });
}

/** 켜기·끄기만 (표 보기 · 카카오 초안 확인). */
export async function setRestaurantActive(id: string, active: boolean) {
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as typeof sql;
    const [row] = await tx<{ id: string }[]>`update restaurants set active = ${active}, updated_at = now() where id = ${id} returning id`;
    if (!row) return null;
    const version = await bumpVersion(tx);
    return { restaurant: await oneRestaurant(tx, row.id), version };
  });
}

export async function deleteRestaurant(id: string) {
  return sql.begin(async (tx) => {
    const r = await tx`delete from restaurants where id = ${id} returning id`;
    if (!r.length) return null;
    await tx`delete from entity_hours where entity_kind = 'restaurant' and entity_id = ${id}`;
    return bumpVersion(tx as unknown as typeof sql);
  });
}

/** 카카오 초안 넣기 — 같은 카카오 번호는 건너뛴다 (dedupe). 넣은 수와 목록 버전. */
export async function insertKakaoDrafts(drafts: FoodInput[]): Promise<{ added: number; version: number | null }> {
  if (!drafts.length) return { added: 0, version: null };
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as typeof sql;
    let added = 0;
    for (const r of drafts) {
      const [row] = await tx<{ id: string }[]>`
        insert into restaurants (name, place_id, lat, lng, facilities, note, active, cuisine, meal, tags, meta, kakao_id, phone, address, url)
        values (${r.name}, ${r.placeId}, ${r.lat}, ${r.lng}, ${r.facilities}, ${r.note}, false, ${r.cuisine}, ${r.meal}, ${r.tags},
                ${tx.json(r.meta as never)}, ${r.kakaoId}, ${r.phone}, ${r.address}, ${r.url})
        on conflict (kakao_id) where kakao_id is not null do nothing
        returning id`;
      if (row) added++;
    }
    return { added, version: added ? await bumpVersion(tx) : null };
  });
}

/** 식당 태그 단어장 (tag_vocab 묶음 '식당', 없으면 기본 말). */
export async function foodTags(): Promise<string[]> {
  const words = (await loadTagVocab()).filter((v) => v.category === FOOD_TAG_CATEGORY).map((v) => v.tag);
  return words.length ? words : [...FOOD_TAGS];
}

/** 이미 있는 카카오 번호 (가져오기 중복 막기). */
export async function knownKakaoIds(): Promise<Set<string>> {
  const rows = await sql<{ kakao_id: string }[]>`select kakao_id from restaurants where kakao_id is not null`;
  return new Set(rows.map((r) => r.kakao_id));
}

/** 엔진 식당 (켜진 것, 좌표 있는 것) — 밥 넣기 후보. 표·칸이 없으면 빈 목록 (밥 칸 없음). */
export async function engineRestaurants(): Promise<EngineRestaurant[]> {
  try {
    return (await loadRestaurants(true)).map(engineRestaurant).filter((x): x is EngineRestaurant => x != null);
  } catch (e) {
    if (missingStructure(e)) return [];
    throw e;
  }
}

// ------------------------------------------------------------------ 운영 현황

export type OpsStats = {
  weekStamps: number;
  weekStampsDemo: number;
  weekCars: number;
  weekChosen: number;
  plansWeek: number;
  phones: number;
  cars: number;
  topPlaces: { id: string; name: string; n: number }[];
  heldStored: boolean;
};

/** 이번 주(한국 시각 월요일 0시부터). 데모 차는 따로 센다. */
export async function opsStats(): Promise<OpsStats> {
  const weekStart = sql`(date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`;
  const [[s], [p], [c], top] = await Promise.all([
    sql<{ real: number; demo: number; cars: number }[]>`
      select count(*) filter (where not c.demo)::int as real, count(*) filter (where c.demo)::int as demo,
             count(distinct e.car_id) filter (where not c.demo)::int as cars
      from events e join cars c on c.id = e.car_id
      where e.kind = 'stamp' and e.created_at >= ${weekStart}`,
    sql<{ chosen: number; plans: number }[]>`
      select count(distinct p.car_id) filter (where p.chosen is not null)::int as chosen, count(*)::int as plans
      from plans p join cars c on c.id = p.car_id
      where not c.demo and p.created_at >= ${weekStart}`,
    sql<{ cars: number; phones: number }[]>`
      select (select count(*) from cars where not demo)::int as cars, (select count(*) from phones)::int as phones`,
    sql<{ id: string; name: string; n: number }[]>`
      select e.place_id as id, coalesce(pl.name, e.place_id) as name, count(*)::int as n
      from events e join cars c on c.id = e.car_id left join places pl on pl.id = e.place_id
      where e.kind = 'stamp' and e.created_at > now() - interval '30 days' and e.place_id is not null
      group by e.place_id, pl.name order by n desc limit 8`,
  ]);
  return {
    weekStamps: s.real, weekStampsDemo: s.demo, weekCars: s.cars, weekChosen: p.chosen, plansWeek: p.plans,
    cars: c.cars, phones: c.phones, topPlaces: top,
    // 차는 보류(StampHeld)를 서버에 보내지 않는다 (events.kind에 'held' 없음) → 다음 단계
    heldStored: false,
  };
}
