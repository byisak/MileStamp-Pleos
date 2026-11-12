import { sql } from "./db";
import { fitView } from "./companion-shape";
import { bumpVersion } from "./catalog";
import { normalizePoints, radiusOf } from "./catalog-shape";
import {
  addDays,
  festivalStatus,
  kstToday,
  seasonLabel,
  weightName,
  type AdminFestival,
  type CatalogFestival,
  type FestivalInput,
} from "./festival-shape";
import type { Place } from "./planner";
import { loadPlaces, toPlace } from "./plan";

/*
 * 축제·행사 (관리자 '축제·행사' 탭이 고치고, 폰·차는 /api/catalog festivals[]·/api/car/places로 받는다).
 * 추천 후보로는 Place + festival 정보 — 엔진(planner.ts forDay)이 그날 열리는지를 따진다. 표 설명은 db/schema.sql.
 */

type Row = {
  id: string; name: string; summary: string | null; place_id: string | null; points: unknown; lat: number; lng: number;
  starts: string; ends: string; open_min: number; close_min: number; closed_days: number[]; dwell_p80: number; indoor: boolean;
  kid_fit: number; weight: number; crowd_note: string | null; season: string | null; poster_url: string | null; poster_version: number;
  stamp_url: string | null; stamp_bw_url: string | null; stamp_version: number; ring: string; source: string | null; active: boolean;
  created_at: Date | null; edited_at: Date | null; fit: unknown; tags: string[] | null;
};

const COLS = sql`id, name, summary, place_id, points, lat, lng, starts::text as starts, ends::text as ends, open_min, close_min,
  closed_days, dwell_p80, indoor, kid_fit, weight, crowd_note, season, poster_url, poster_version, stamp_url, stamp_bw_url,
  stamp_version, ring, source, active, created_at, edited_at, fit, tags`;

function toAdmin(r: Row): AdminFestival {
  return {
    id: r.id, name: r.name, summary: r.summary ?? "", placeId: r.place_id, points: normalizePoints(r.points, r.lat, r.lng),
    lat: r.lat, lng: r.lng, starts: r.starts, ends: r.ends, open: r.open_min, close: r.close_min,
    closedDays: (r.closed_days ?? []).map(Number), dwell: r.dwell_p80, indoor: r.indoor, kidFit: Number(r.kid_fit),
    fit: fitView(Number(r.kid_fit), r.fit), tags: r.tags ?? [],
    weight: Number(r.weight), crowdNote: r.crowd_note ?? "", season: r.season ?? seasonLabel(r.starts),
    poster: { url: r.poster_url, version: r.poster_version },
    stamp: { url: r.stamp_url, bwUrl: r.stamp_bw_url, version: r.stamp_version },
    ring: r.ring, source: r.source, active: r.active,
    createdAt: r.created_at ? r.created_at.toISOString() : null, editedAt: r.edited_at ? r.edited_at.toISOString() : null,
  };
}

export function toCatalogFestival(f: AdminFestival, today = kstToday()): CatalogFestival {
  return {
    id: f.id, name: f.name, summary: f.summary || null, placeId: f.placeId, points: f.points, lat: f.lat, lng: f.lng,
    starts: f.starts, ends: f.ends, open: f.open, close: f.close, closedDays: f.closedDays, dwell: f.dwell, indoor: f.indoor,
    kidFit: f.kidFit, fit: f.fit, tags: f.tags, weight: weightName(f.weight), crowdNote: f.crowdNote || null, season: f.season, poster: f.poster.url,
    stamp: f.stamp, ring: f.ring, status: festivalStatus(f, today),
  };
}

/** 관리자: 전부 (끝난 것·쉬는 것 포함), 시작일 순. */
export async function loadAdminFestivals(): Promise<AdminFestival[]> {
  const rows = await sql<Row[]>`select ${COLS} from festivals order by starts, id`;
  return rows.map(toAdmin);
}

/** 앱 목록: 켜진 것 중 끝난 지 1년 안 (도장북 '지난 축제'를 그리려고). */
export async function loadCatalogFestivals(today = kstToday()): Promise<CatalogFestival[]> {
  const rows = await sql<Row[]>`
    select ${COLS} from festivals where active and ends >= ${addDays(today, -365)}::date order by starts, id`;
  return rows.map((r) => toCatalogFestival(toAdmin(r), today));
}

/** 한 건 (도장 이벤트 확인용). */
export async function findFestival(id: string): Promise<AdminFestival | null> {
  const [r] = await sql<Row[]>`select ${COLS} from festivals where id = ${id}`;
  return r ? toAdmin(r) : null;
}

/** 엔진 후보 Place로 (축제 정보 포함). 오늘 열리는지는 엔진(forDay)이 본다. */
export function festivalPlace(f: AdminFestival): Place {
  return {
    id: f.id, name: f.name, at: { lat: f.points[0].lat, lng: f.points[0].lng }, indoor: f.indoor, dwellP80Min: f.dwell,
    kidFit: f.kidFit, openMin: f.open, closeMin: f.close, popular: 0, stampable: true,
    fit: { couple: f.fit.couple, friends: f.fit.friends, solo: f.fit.solo }, tags: f.tags,
    festival: { id: f.id, starts: f.starts, ends: f.ends, weight: f.weight, placeId: f.placeId, closedDays: f.closedDays },
  };
}

/**
 * 추천 후보에 더할 축제 (켜진 것 중 [from]~[to] 기간과 겹치는 것). 서버 계획·코스는 이 목록을 장소 목록 뒤에 붙인다.
 * 기본은 오늘 하루 — 데모 차의 미래 날짜 계획은 그날로.
 */
export async function festivalPlaces(day = kstToday()): Promise<Place[]> {
  const rows = await sql<Row[]>`
    select ${COLS} from festivals where active and starts <= ${day}::date and ends >= ${day}::date order by id`;
  return rows.map((r) => festivalPlace(toAdmin(r)));
}

/** 차 엔진용 (/api/car/places): 지금 열리는 축제 — 하루 한 번 받으므로 오늘~내일 기간과 겹치는 것. */
export async function carFestivals(today = kstToday()) {
  const rows = await sql<Row[]>`
    select ${COLS} from festivals where active and starts <= ${addDays(today, 1)}::date and ends >= ${today}::date order by id`;
  return rows.map((r) => {
    const f = toAdmin(r);
    return {
      id: f.id, name: f.name, lat: f.points[0].lat, lng: f.points[0].lng, indoor: f.indoor,
      dwellP80Min: f.dwell, kidFit: f.kidFit, openMin: f.open, closeMin: f.close, popular: 0, stampable: true,
      fit: f.fit, tags: f.tags, hours: null, group: "festival", points: f.points, radiusM: radiusOf(f.points), album: "festival",
      stamp: f.stamp,
      // 축제 칸 (엔진 FestivalInfo)
      festivalId: f.id, startDate: f.starts, endDate: f.ends, weight: f.weight, attachedPlaceId: f.placeId,
      closedDays: f.closedDays, season: f.season, ring: f.ring,
    };
  });
}

/** 새로 만들기([id]가 없을 때)·고치기. 저장마다 목록 버전 +1. */
export async function saveFestival(id: string, input: FestivalInput, create: boolean): Promise<{ festival: AdminFestival; version: number } | null> {
  return sql.begin(async (tx) => {
    const first = input.points[0];
    const vals = {
      name: input.name, summary: input.summary || null, place_id: input.placeId, points: tx.json(input.points),
      lat: first.lat, lng: first.lng, starts: input.starts, ends: input.ends, open_min: input.open, close_min: input.close,
      closed_days: input.closedDays, dwell_p80: input.dwell, indoor: input.indoor, kid_fit: input.kidFit, weight: input.weight,
      crowd_note: input.crowdNote || null, season: input.season, poster_url: input.posterUrl, active: input.active,
      fit: tx.json(input.fit as never), tags: input.tags,
    };
    const [r] = create
      ? await tx<{ id: string }[]>`
          insert into festivals (id, name, summary, place_id, points, lat, lng, starts, ends, open_min, close_min, closed_days,
                                 dwell_p80, indoor, kid_fit, weight, crowd_note, season, poster_url, source, active, fit, tags)
          values (${id}, ${vals.name}, ${vals.summary}, ${vals.place_id}, ${vals.points}, ${vals.lat}, ${vals.lng},
                  ${vals.starts}::date, ${vals.ends}::date, ${vals.open_min}, ${vals.close_min}, ${vals.closed_days}::int[],
                  ${vals.dwell_p80}, ${vals.indoor}, ${vals.kid_fit}, ${vals.weight}, ${vals.crowd_note}, ${vals.season},
                  ${vals.poster_url}, ${input.source}, ${vals.active}, ${vals.fit}, ${vals.tags})
          on conflict (id) do nothing
          returning id`
      : await tx<{ id: string }[]>`
          update festivals set
            name = ${vals.name}, summary = ${vals.summary}, place_id = ${vals.place_id}, points = ${vals.points},
            lat = ${vals.lat}, lng = ${vals.lng}, starts = ${vals.starts}::date, ends = ${vals.ends}::date,
            open_min = ${vals.open_min}, close_min = ${vals.close_min}, closed_days = ${vals.closed_days}::int[],
            dwell_p80 = ${vals.dwell_p80}, indoor = ${vals.indoor}, kid_fit = ${vals.kid_fit}, weight = ${vals.weight},
            crowd_note = ${vals.crowd_note}, season = ${vals.season},
            poster_url = ${vals.poster_url}, poster_version = case when poster_url is distinct from ${vals.poster_url} then poster_version + 1 else poster_version end,
            active = ${vals.active}, fit = ${vals.fit}, tags = ${vals.tags}, edited_at = now()
          where id = ${id}
          returning id`;
    if (!r) return null;
    const version = await bumpVersion(tx as unknown as typeof sql);
    const [row] = await tx<Row[]>`select ${COLS} from festivals where id = ${id}`;
    return { festival: toAdmin(row), version };
  });
}

export async function deleteFestival(id: string): Promise<number | null> {
  return sql.begin(async (tx) => {
    const r = await tx`delete from festivals where id = ${id} returning id`;
    if (!r.length) return null;
    return bumpVersion(tx as unknown as typeof sql);
  });
}

/** 한정 도장 그림 저장 (도장 올리기 탭, R2 festivals/<id>/stamp-<판>.webp). */
export async function saveFestivalStamp(id: string, url: string, bwUrl: string) {
  return sql.begin(async (tx) => {
    const [r] = await tx<{ stamp_version: number }[]>`
      update festivals set stamp_url = ${url}, stamp_bw_url = ${bwUrl}, stamp_version = stamp_version + 1, edited_at = now()
      where id = ${id}
      returning stamp_version`;
    if (!r) return null;
    const version = await bumpVersion(tx as unknown as typeof sql);
    return { stampVersion: r.stamp_version, version };
  });
}

/** 포스터 저장 (R2 festivals/<id>/poster-<판>.webp). */
export async function saveFestivalPoster(id: string, url: string) {
  return sql.begin(async (tx) => {
    const [r] = await tx<{ poster_version: number }[]>`
      update festivals set poster_url = ${url}, poster_version = poster_version + 1, edited_at = now()
      where id = ${id}
      returning poster_version`;
    if (!r) return null;
    const version = await bumpVersion(tx as unknown as typeof sql);
    return { posterVersion: r.poster_version, version };
  });
}

/** 판 번호 (올릴 주소를 만들 때). */
export async function festivalVersions(id: string) {
  const [r] = await sql<{ poster_version: number; stamp_version: number }[]>`
    select poster_version, stamp_version from festivals where id = ${id}`;
  return r ?? null;
}

/**
 * 이 차가 올해(한국 날짜) 이 축제 도장을 이미 받았으면 그 소식. 같은 축제는 한 차에 해마다 한 번.
 */
export async function festivalStampThisYear(carId: string, festivalId: string, today = kstToday()) {
  const year = Number(today.slice(0, 4));
  const [r] = await sql<{ id: string; payload: Record<string, unknown> }[]>`
    select id, payload from events
    where car_id = ${carId} and kind = 'stamp' and payload->>'festivalId' = ${festivalId}
      and extract(year from created_at at time zone 'Asia/Seoul') = ${year}
    limit 1`;
  return r ?? null;
}

/**
 * 추천·코스 후보 전부: 명소(켜진 것) + 그날과 기간이 겹치는 축제. 엔진이 [day]로 다시 걸러 낸다(forDay).
 * 코스 JSON은 장소 id만 저장하므로, 축제를 고른 코스를 되살릴 때도 이 목록을 쓴다.
 */
export async function candidatePlaces(day = kstToday()): Promise<Place[]> {
  const [rows, fests] = await Promise.all([loadPlaces(), festivalPlaces(day)]);
  return [...rows.map((r) => toPlace(r, day)), ...fests];
}

/** 끝났는데 켜져 있는 축제 모두 끄기 (관리자 할 일 '한꺼번에 끄기'). 끈 id들과 목록 버전 (없으면 null). */
export async function deactivateEndedFestivals(today: string): Promise<{ ids: string[]; version: number | null }> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update festivals set active = false, edited_at = now() where active and ends < ${today}::date returning id`;
    return { ids: rows.map((r) => r.id), version: rows.length ? await bumpVersion(tx as unknown as typeof sql) : null };
  }) as Promise<{ ids: string[]; version: number | null }>;
}
