import { sql } from "./db";
import { hashToken, currentPhone } from "./auth";
import { dwellView, type DwellView } from "./dwell-shape";
import { restsOn } from "./place-detail-shape";
import {
  CLOSED_RULE_KEYS, closedDatesFromRules, fitExtraOf, hoursRowsLoose, parseMoments, parseRoute, PLACE_KINDS,
  type DriveRoute, type HoursRow, type Moments,
} from "./place-attrs-shape";
import { kstToday } from "./festival-shape";
import {
  asHhmm, defaultProfile, explainChoice, legJson, MEAL_ID_PREFIX, type MealStop, hhmm, parseCompanion, pickOf, placeOnDay, AFTERNOON_FROM_MIN, COMPANIONS,
  DEFAULT_BEDTIME_MIN, DEFAULT_LATE_RETURN_MIN,
  type AirLevel, type Companion, type OptionPick, type BackBy, type FamilyProfile, type LatLng, type Place, type Plan, type PlanMode, type PlanOption, type SkyToday,
} from "./planner";
import { extJson, isExtId, type ExtJson } from "./ext";
import type { SkyInfo } from "./sky";
import type { OptionRoute } from "./route-shape";

/*
 * 오늘 어디 갈까요? — 서버 쪽 도우미: 누가 물었는지, 장소·가족 설정 읽기, 계획을 응답 모양으로.
 * 계산은 planner.ts(엔진 이식), 하늘은 sky.ts.
 */

// ------------------------------------------------------------------ 누가 물었나 (폰·차 공용 API)

export type Who = { carId: string; demo: boolean; phone: { id: string; nickname: string } | null };

/** 차 토큰이면 차, 아니면 폰 토큰(앱 Bearer·웹 쿠키). 둘 다 아니면 null. */
export async function whoFromRequest(req: Request): Promise<Who | null> {
  const bearer = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (bearer) {
    const [car] = await sql<{ id: string; demo: boolean }[]>`select id, demo from cars where token_hash = ${hashToken(bearer)}`;
    if (car) return { carId: car.id, demo: car.demo, phone: null };
  }
  const phone = await currentPhone(req);
  if (!phone) return null;
  const [car] = await sql<{ demo: boolean }[]>`select demo from cars where id = ${phone.car_id}`;
  return { carId: phone.car_id, demo: !!car?.demo, phone: { id: phone.id, nickname: phone.nickname } };
}

// ------------------------------------------------------------------ 위치 칸

/** 소수 둘째 자리(약 1km)로 깎은 위치. 계산은 이 값으로, 저장은 칸 글자로만. */
export function cellOf(lat: number, lng: number): { at: LatLng; cell: string } {
  const la = Math.round(lat * 100) / 100;
  const ln = Math.round(lng * 100) / 100;
  return { at: { lat: la, lng: ln }, cell: `${la.toFixed(2)},${ln.toFixed(2)}` };
}

/**
 * 계획을 짜는 출발점: 출발 칸이 집 칸이면 집 좌표 그대로 (칸 가운데는 집에서 수백 m 떨어질 수 있어
 * '왜?'가 '집에서' 대신 '지금 있는 곳에서'라고 하던 것 — 다른 날 계획은 늘 집 칸).
 */
export function hereOf(originCell: string, home: LatLng): LatLng | null {
  return originCell === cellOf(home.lat, home.lng).cell ? home : parseCell(originCell);
}

export function parseCell(cell: string | null | undefined): LatLng | null {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(cell ?? "");
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** 집·즐겨찾기 좌표는 소수 셋째 자리(약 100m)로 깎아서만 저장한다. 로그에 남기지 않는다. */
export function round3(lat: number, lng: number): [number, number] {
  return [Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000];
}

/** [위도, 경도] 모양이면 셋째 자리로 깎아 돌려준다. 아니면 null. */
export function latLngPair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lat, lng] = v;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return round3(lat, lng);
}

/** 데모 차의 '집' = 대구 북구청 칸 (엔진 SeedPlaces.DEMO_HOME 35.8858,128.5828). */
export const DEMO_HOME_CELL = cellOf(35.8858, 128.5828).cell;

// ------------------------------------------------------------------ 장소

export type PlaceRow = {
  id: string; name: string; lat: number; lng: number; indoor: boolean; open_min: number; close_min: number;
  dwell_p80: number; kid_fit: number; stampable: boolean; popular: number; tags: string[]; hours: string | null; grp: string | null;
  /** 도착 지점 [{lat,lng,r,name}] (관리자에서 그림. 없으면 null → lat/lng + 300m) · 도장북 묶음 · 관리자가 올린 도장 그림 */
  points: unknown; album: string | null; stamp_url: string | null; stamp_bw_url: string | null; stamp_version: number;
  /** 동행별 적합도 {kids, couple, friends, solo} (null이면 kid_fit + 어른 기본 0.6) · 어른 머무는 분 (null이면 dwell_p80 × 0.8) */
  fit: unknown; dwell_adult: number | null;
  /** 쉬는 요일(0=일) · 임시 휴무 날짜 · 쉬는 날 글('매주 월요일') — 그날 추천에서 뺀다 */
  closed_days: number[] | null; temp_closed: string[] | null; closed: string | null;
  /**
   * 장소 구조 칸 (11/3, place-attrs-shape.ts). open_hours = entity_hours 줄들(API 모양 camelCase, 순서대로) — 표가 아직 없는 DB면 빈 값.
   * 엔진은 open_hours(그날 맞는 줄)와 closed_rules(날짜로 펴서 closedDates)만 쓰고 나머지는 앱에 싣기만 한다.
   */
  open_hours?: unknown; closed_rules?: string[] | null; parking?: unknown; price?: unknown; moments?: unknown;
  region_code?: string | null; kind?: string | null; route?: unknown; meta?: unknown;
};

/** 쉬는 요일: closed_days + 쉬는 날 글에서 읽은 '매주 ○요일' (place-detail과 같은 판단). */
export function closedDaysOf(r: Pick<PlaceRow, "closed_days" | "closed">): number[] {
  const days = new Set((r.closed_days ?? []).map(Number));
  if (r.closed) for (let d = 0; d < 7; d++) if (restsOn(r.closed, d)) days.add(d);
  return [...days].sort();
}

/** DB fit jsonb → 엔진 칸 (0~1 숫자만, kids는 kid_fit을 쓰므로 뺀다). */
export function fitOf(v: unknown): Partial<Record<Companion, number>> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Partial<Record<Companion, number>> = {};
  for (const c of COMPANIONS) {
    const x = (v as Record<string, unknown>)[c];
    if (c !== "kids" && typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1) out[c] = x;
  }
  return Object.keys(out).length ? out : null;
}

/** '요즘 많이 감'에 쓰는 기간. */
const POPULAR_DAYS = 30;

/** entity_hours 줄들 → API 모양 jsonb 배열 (place-attrs-shape HoursRow). 장소·축제 읽기가 같이 쓴다. */
export const HOURS_JSON = (kind: "place" | "festival", idCol: string) => sql.unsafe(`coalesce((
  select jsonb_agg(jsonb_build_object('days', h.days, 'holiday', h.holiday, 'openMin', h.open_min, 'closeMin', h.close_min,
    'lastEntryMin', h.last_entry_min, 'breaks', h.breaks, 'validFrom', h.valid_from, 'validTo', h.valid_to, 'note', h.note) order by h.sort, h.id)
  from entity_hours h where h.entity_kind = '${kind}' and h.entity_id = ${idCol}), '[]'::jsonb)`);

/** 표·칸이 아직 없는 DB(운영 반영 전)에서 난 오류인가 — 그땐 예전 칸만 읽는다. */
export const missingStructure = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");

/** 추천 후보 전부. popular = 사람이 넣은 값과 최근 30일 도장 찍은 차 수(데모 차 빼고) 중 큰 쪽. */
export async function loadPlaces(): Promise<PlaceRow[]> {
  return loadPlacesWith(true).catch((e) => {
    if (missingStructure(e)) return loadPlacesWith(false);
    throw e;
  });
}

async function loadPlacesWith(structured: boolean): Promise<PlaceRow[]> {
  const extra = structured
    ? sql`, ${HOURS_JSON("place", "p.id")} as open_hours, p.closed_rules, p.parking, p.price, p.moments, p.region_code, p.kind, p.route, p.meta`
    : sql``;
  const rows = await sql<PlaceRow[]>`
    select p.id, p.name, p.lat, p.lng, p.indoor, p.open_min, p.close_min, p.dwell_p80, p.kid_fit, p.stampable,
           greatest(p.popular, coalesce(v.teams, 0))::int as popular, p.tags, p.hours, p.grp,
           p.points, p.album, p.stamp_url, p.stamp_bw_url, p.stamp_version, p.fit, p.dwell_adult,
           p.closed_days, p.temp_closed::text[] as temp_closed, p.closed ${extra}
    from places p
    left join (
      select e.place_id, count(distinct e.car_id)::int as teams
      from events e join cars c on c.id = e.car_id
      where e.kind = 'stamp' and not c.demo and e.created_at > now() - make_interval(days => ${POPULAR_DAYS})
      group by e.place_id
    ) v on v.place_id = p.id
    where p.active
    order by p.id`;
  return rows;
}

/** 쉬는 날 규칙을 날짜로 펼 기간 (오늘부터) — 차는 하루 한 번 받으므로 넉넉히. */
export const CLOSED_RULE_DAYS = 120;

/** 임시 휴무 날짜 + 쉬는 날 규칙(설·추석·공휴일 다음 날 …)을 [from]부터 펼친 날짜. 엔진·차는 closedDates 하나만 본다. */
export function closedDatesOf(r: Pick<PlaceRow, "temp_closed" | "closed_rules" | "closed_days" | "closed">, from = kstToday()): string[] {
  const rules = (r.closed_rules ?? []).filter((x) => CLOSED_RULE_KEYS.includes(x));
  const set = new Set([...(r.temp_closed ?? []), ...closedDatesFromRules(rules, from, CLOSED_RULE_DAYS, closedDaysOf(r))]);
  return [...set].sort();
}

/**
 * DB 줄 → 엔진 장소. [day]를 주면 그날 운영 시간 줄의 시각을 입힌다(placeOnDay — 줄이 없으면 예전 open_min·close_min).
 * 운영 시간 줄은 그대로 실어서 엔진 forDay가 다른 날에도 다시 고를 수 있다.
 */
export function toPlace(r: PlaceRow, day?: string | null): Place {
  const hours = hoursRowsLoose(r.open_hours);
  const p: Place = {
    id: r.id, name: r.name, at: { lat: r.lat, lng: r.lng }, indoor: r.indoor, dwellP80Min: r.dwell_p80,
    kidFit: r.kid_fit,
    openMin: r.open_min, closeMin: r.close_min, popular: r.popular, stampable: r.stampable,
    fit: fitOf(r.fit), tags: r.tags ?? [], adultDwellMin: r.dwell_adult ?? null,
    closedDays: closedDaysOf(r), closedDates: closedDatesOf(r),
    ...(hours.length ? { hours } : {}),
    ...eveningAttrs(r, hours),
  };
  return day ? placeOnDay(p, day) : p;
}

/** 시간 특성(API 모양) → 엔진 모양 (쇼 시각은 분). 차 ServerApi.parseMoments와 같은 변환. */
export function engineMoments(m: Moments | null | undefined): Place["moments"] {
  if (!m || !m.best?.length && !m.light && !m.shows?.length) return null;
  const toMin = (t: string) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
  return {
    best: [...(m.best ?? [])], lightOn: m.light?.on ?? null,
    shows: (m.shows ?? []).map((x) => ({ name: x.name, times: x.times.map(toMin).sort((a, b) => a - b), days: x.days ?? [], months: x.months ?? [] })),
  };
}

/** 드라이브 길(API 모양) → 엔진 모양. */
export function engineRoute(r: DriveRoute | null | undefined): Place["route"] {
  return r && r.points.length >= 2 ? { points: r.points.map((p) => ({ lat: p.lat, lng: p.lng })), passMin: r.pass_min } : null;
}

/** 저녁 나들이 칸 (종류·드라이브 길·시간 특성·저녁 어울림) — 이상한 값은 빈 칸. 표가 없는 DB면 모두 빈 칸. */
function eveningAttrs(r: PlaceRow, hours: HoursRow[]): Partial<Place> {
  const kind = PLACE_KINDS.find((k) => k === r.kind) ?? "spot";
  const mo = parseMoments(r.moments ?? null, { hours, open: r.open_min, close: r.close_min });
  const moments = engineMoments("ok" in mo ? mo.ok : null);
  const ro = kind === "drive" ? parseRoute(r.route ?? null, kind) : null;
  const route = ro && "ok" in ro ? engineRoute(ro.ok) : null;
  const evening = fitExtraOf(r.fit).evening;
  return {
    ...(kind !== "spot" ? { kind } : {}),
    ...(route ? { route } : {}),
    ...(moments ? { moments } : {}),
    ...(evening && Object.keys(evening).length ? { fitEvening: evening } : {}),
  };
}

// ------------------------------------------------------------------ 우리 가족

export type Family = {
  kidAges: number[];
  /** 낮잠 시작(분)·길이(분). 낮잠 없으면 둘 다 null. */
  napStart: number | null;
  napLen: number | null;
  /** 'sunset-30' | 'at:17:30' */
  backBy: string;
  /** 저녁 시각(분). null이면 따지지 않음. */
  dinner: number | null;
  /** 집 [위도, 경도] (소수 셋째 자리). 폰에서 정하지 않았으면 null — 그땐 차가 아는 집·집 칸. */
  home: [number, number] | null;
  /** 즐겨찾는 도착지 (할머니 집 등) — 오늘 도착지 고르기에 씀. 좌표는 소수 셋째 자리. */
  favorites: Favorite[];
  /** 누구랑 가요? 마지막으로 고른 동행 (kids·couple·friends·solo). 아이 나이·낮잠은 kids일 때만 쓴다. */
  companion: Companion;
  /** 아이 잠자는 시간(분, 기본 21:00) — 아이와 저녁 나들이 귀가 한계. */
  bedtime: number;
  /** 어른끼리 '늦어도 몇 시 귀가'(분, 기본 23:00) — 어른끼리 낮·저녁 귀가 한계. */
  lateReturn: number;
  /** '밥도 같이 짜기' (기본 끔) — 켜면 코스가 점심·저녁 때를 지날 때 식당 한 곳을 넣는다 (엔진 Meals). 계획마다 ?meal=1로도. */
  mealPlan: boolean;
};
export type Favorite = { name: string; lat: number; lng: number };
export const MAX_FAVORITES = 8;

export const DEFAULT_FAMILY: Family = {
  kidAges: [4, 4], napStart: 13 * 60, napLen: 90, backBy: "sunset-30", dinner: 18 * 60 + 30, home: null, favorites: [], companion: "kids",
  bedtime: DEFAULT_BEDTIME_MIN, lateReturn: DEFAULT_LATE_RETURN_MIN, mealPlan: false,
};

/** 잠자는 시간·늦어도 몇 시 귀가 고를 수 있는 범위 (분). */
export const BEDTIME_RANGE = [18 * 60, 23 * 60] as const;
export const LATE_RETURN_RANGE = [19 * 60, 23 * 60 + 59] as const;

/** 즐겨찾기 목록 확인·깎기. 틀리면 null. */
export function parseFavorites(v: unknown): Favorite[] | null {
  if (!Array.isArray(v) || v.length > MAX_FAVORITES) return null;
  const out: Favorite[] = [];
  for (const f of v) {
    if (!f || typeof f !== "object") return null;
    const o = f as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const at = latLngPair([o.lat, o.lng]);
    if (!name || name.length > 20 || !at) return null;
    out.push({ name, lat: at[0], lng: at[1] });
  }
  return out;
}

export function parseBackBy(s: string): BackBy | null {
  let m = /^sunset-(\d{1,3})$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n <= 180 ? { sunsetMinus: n } : null;
  }
  m = /^at:(\d{2}:\d{2})$/.exec(s);
  if (m) {
    try { return { at: hhmm(m[1]) }; } catch { return null; }
  }
  return null;
}

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** 가족 설정 확인. 틀리면 이유(한글)를 돌려준다. */
export function validateFamily(f: Family): string | null {
  if (!Array.isArray(f.kidAges) || f.kidAges.length < 1 || f.kidAges.length > 6) return "아이는 1~6명으로 넣어 주세요";
  if (!f.kidAges.every((a) => isInt(a, 0, 12))) return "아이 나이는 0~12살이에요";
  if ((f.napStart == null) !== (f.napLen == null)) return "낮잠은 시작과 길이를 같이 넣거나 둘 다 비워 주세요";
  if (f.napStart != null && !isInt(f.napStart, 9 * 60, 18 * 60)) return "낮잠 시작은 09:00~18:00 사이예요";
  if (f.napLen != null && !isInt(f.napLen, 10, 240)) return "낮잠 길이는 10~240분이에요";
  if (typeof f.backBy !== "string" || !parseBackBy(f.backBy)) return "귀가 기준은 'sunset-30'(해 지기 30분 전) 또는 'at:HH:MM'이에요";
  if (f.dinner != null && !isInt(f.dinner, 15 * 60, 22 * 60)) return "저녁 시각은 15:00~22:00 사이예요";
  if (f.home != null && !latLngPair(f.home)) return "집 위치는 [위도, 경도]예요";
  if (!parseFavorites(f.favorites)) return `즐겨찾기는 이름(20자 이내)·위치로 ${MAX_FAVORITES}곳까지예요`;
  if (!parseCompanion(f.companion)) return "누구랑 가요?는 kids·couple·friends·solo 중 하나예요";
  if (!isInt(f.bedtime, BEDTIME_RANGE[0], BEDTIME_RANGE[1])) return "아이 잠자는 시간은 18:00~23:00 사이예요";
  if (!isInt(f.lateReturn, LATE_RETURN_RANGE[0], LATE_RETURN_RANGE[1])) return "늦어도 귀가 시각은 19:00~23:59 사이예요";
  if (typeof f.mealPlan !== "boolean") return "밥도 같이 짜기는 true·false예요";
  return null;
}

export type FamilyRow = {
  kid_ages: number[]; nap_start: number | null; nap_len: number | null; back_by: string; dinner: number | null; home_cell: string | null;
  home_lat: number | null; home_lng: number | null; favorites: unknown; companion: string | null;
  /** 저녁 나들이 (11/3) — 칸이 아직 없는 DB면 null (기본값). */
  bedtime_min?: number | null; late_return_min?: number | null;
  /** 밥도 같이 짜기 (11/3 식당) — 칸이 아직 없는 DB면 없음 (끔). */
  meal_plan?: boolean | null;
};

export async function loadFamily(carId: string): Promise<{ family: Family; homeCell: string | null; saved: boolean }> {
  const [row] = await sql<FamilyRow[]>`
    select kid_ages, nap_start, nap_len, back_by, dinner, home_cell, home_lat, home_lng, favorites, companion, bedtime_min, late_return_min,
           (to_jsonb(families) ->> 'meal_plan')::boolean as meal_plan
    from families where car_id = ${carId}`.catch((e) => {
    // 저녁 나들이 칸이 아직 없는 DB (운영 반영 전) — 예전 칸만
    if (!missingStructure(e)) throw e;
    return sql<FamilyRow[]>`
      select kid_ages, nap_start, nap_len, back_by, dinner, home_cell, home_lat, home_lng, favorites, companion from families where car_id = ${carId}`;
  });
  if (!row) return { family: DEFAULT_FAMILY, homeCell: null, saved: false };
  return {
    family: {
      kidAges: row.kid_ages, napStart: row.nap_start, napLen: row.nap_len, backBy: row.back_by, dinner: row.dinner,
      home: row.home_lat != null && row.home_lng != null ? [row.home_lat, row.home_lng] : null,
      favorites: parseFavorites(row.favorites) ?? [],
      companion: parseCompanion(row.companion) ?? "kids",
      bedtime: row.bedtime_min ?? DEFAULT_BEDTIME_MIN,
      lateReturn: row.late_return_min ?? DEFAULT_LATE_RETURN_MIN,
      mealPlan: row.meal_plan === true,
    },
    homeCell: row.home_cell,
    saved: true,
  };
}

/** 계산에 쓸 집: 폰에서 정한 집(셋째 자리) → 저장된 집 칸 → 대신 쓸 칸. */
export function familyHome(f: Family, homeCell: string | null, fallbackCell: string | null): LatLng | null {
  if (f.home) return { lat: f.home[0], lng: f.home[1] };
  return parseCell(homeCell) ?? parseCell(fallbackCell);
}

/** 가족 설정 → 엔진 가족 정보. companion을 주면 그 동행으로(계획마다 `with`·계획 줄 값), 없으면 마지막으로 고른 동행. */
export function toProfile(f: Family, home: LatLng, companion?: Companion | null): FamilyProfile {
  const p = defaultProfile(home);
  const nap = f.napStart != null && f.napLen != null;
  return {
    ...p,
    napStartMin: nap ? f.napStart! : 0,
    napEndMin: nap ? f.napStart! + f.napLen! : 0,
    backBy: parseBackBy(f.backBy) ?? p.backBy,
    dinnerMin: f.dinner,
    kidAges: f.kidAges,
    companion: companion ?? f.companion ?? "kids",
    bedtimeMin: f.bedtime ?? DEFAULT_BEDTIME_MIN,
    lateReturnMin: f.lateReturn ?? DEFAULT_LATE_RETURN_MIN,
  };
}

// ------------------------------------------------------------------ 계획 → 응답 모양 (plans.options·sky에 그대로 저장)

export function modeAt(nowMin: number): PlanMode {
  return nowMin < AFTERNOON_FROM_MIN ? "MORNING" : "AFTERNOON";
}

export type OptionJson = {
  /**
   * kind = 엔진 카드 종류 COURSE·NEARBY·HOMEWARD·GO_HOME (차 앱이 그대로 읽음 — 바꾸지 않는다).
   * pick = 카드 성격 short(가볍게) · full(두세 곳 알차게) · nap(낮잠 맞춰서) · indoor · popular · near · home (폰 대화 답과 맞추기, 엔진 pickOf). 예전 계획엔 없을 수 있다.
   */
  kind: string; label: string; pick?: OptionPick;
  /**
   * dwell = 이 카드에서 머무는 시간 예상과 출처 (우리 가족 기록·또래·조사값). 예전 계획엔 없을 수 있다.
   * ext = 바깥 장소(ext:…)만 — 장소표에 없어서 이름·좌표·머무름·운영 시각을 같이 싣는다 (lib/ext.ts).
   */
  stops: { id: string; name: string; lat: number; lng: number; indoor: boolean; stampable: boolean; dwell?: DwellView; ext?: ExtJson }[];
  firstLegMin: number; detourMin: number | null; arriveHomeMin: number; arriveHome: string;
  /** 밥 칸은 kind "STAY" + meal: true (엔진 MEAL — 옛 앱이 모르는 이름을 안 보내려고). */
  legs: { kind: string; fromMin: number; toMin: number; placeId: string | null; meal?: true }[];
  reasons: { text: string; tone: string }[];
  /** 넣은 밥 자리 (밥 켬일 때만, 엔진 MealStop). 식당은 stops에도 'ext:food:<id>'로 있다. */
  meal?: MealJson;
  /** 밥 자리를 못 넣은 까닭 ('근처에 등록된 식당이 없어요' …). */
  mealHint?: string;
  /** '왜?' 설명 — 장소마다 쉬운 말 줄 (엔진 explainChoice). 예전 계획엔 없을 수 있다. */
  why?: { placeId: string; lines: { text: string; tone: string }[] }[];
  /** 귀가 한계를 넘는 카드 (앵커 코스의 '여기만'). 없으면 false. */
  overLimit?: boolean;
  /** 앵커 코스 카드면 그 앵커 id (POST /api/plan/anchor). */
  anchorId?: string;
  /** 실제 길(카카오모빌리티)로 다시 잰 값 — 폰에 보내는 답에만 붙인다 (저장 안 함, lib/route.ts retimeForPhone). */
  route?: OptionRoute;
};

/** '왜?'를 붙이는 데 필요한 계산 재료 (계획의 지금 시각·위치·하늘). */
export type WhyCtx = { nowMin: number; here: LatLng; sky: SkyToday | null };

/** 카드 하나 → JSON. profile을 주면 머무름 예상(dwell), why까지 주면 '왜?' 설명. */
export function optionJsonOf(o: PlanOption, profile?: FamilyProfile, why?: WhyCtx): OptionJson {
  const j: OptionJson = {
    kind: o.kind,
    label: o.label,
    pick: pickOf(o),
    stops: o.stops.map((p) => ({
      id: p.id, name: p.name, lat: p.at.lat, lng: p.at.lng, indoor: p.indoor, stampable: p.stampable,
      ...(profile ? { dwell: dwellView(profile, p) } : {}),
      ...(isExtId(p.id) ? { ext: extJson(p) } : {}),
    })),
    firstLegMin: o.firstLegMin,
    detourMin: o.detourMin,
    arriveHomeMin: o.arriveHomeMin,
    arriveHome: asHhmm(o.arriveHomeMin),
    legs: o.legs.map(legJson),
    reasons: o.reasons.map((r) => ({ text: r.text, tone: r.tone })),
  };
  if (profile && why && o.stops.length) {
    try {
      j.why = explainChoice(o, why.nowMin, why.here, profile, why.sky).map((w) => ({ placeId: w.placeId, lines: w.lines.map((l) => ({ text: l.text, tone: l.tone })) }));
    } catch { /* 설명은 덤 */ }
  }
  if (o.overLimit) j.overLimit = true;
  if (o.meal) j.meal = mealJson(o.meal);
  if (o.mealHint) j.mealHint = o.mealHint;
  return j;
}

/**
 * 밥 자리 JSON (폰 결과 카드 🍽 줄 · '다른 식당'). alternatives[i].ext = 그 식당을 코스에 넣을 때 보낼 바깥 장소 칸
 * (POST /api/plan/choose·preview stops에 {id: 'ext:food:<id>', name, lat, lng, ...ext}를 index 자리에 끼워 보낸다).
 */
export type MealJson = {
  restaurantId: string; placeId: string; name: string; kind: string; startMin: number; endMin: number; start: string; end: string;
  index: number; detourMin: number; features: string[]; cuisine: string[]; text: string;
  alternatives: {
    restaurantId: string; placeId: string; name: string; lat: number; lng: number; index: number; startMin: number; start: string; detourMin: number;
    features: string[]; cuisine: string[]; ext: ExtJson;
  }[];
};

export function mealJson(m: MealStop): MealJson {
  return {
    restaurantId: m.restaurantId, placeId: m.placeId, name: m.name, kind: m.kind, startMin: m.startMin, endMin: m.endMin,
    start: asHhmm(m.startMin), end: asHhmm(m.endMin), index: m.index, detourMin: m.detourMin, features: m.features, cuisine: m.cuisine, text: m.text,
    alternatives: m.alternatives.map((a) => ({
      restaurantId: a.restaurantId, placeId: MEAL_ID_PREFIX + a.restaurantId, name: a.name, lat: a.at.lat, lng: a.at.lng, index: a.index,
      startMin: a.startMin, start: asHhmm(a.startMin), detourMin: a.detourMin, features: a.features, cuisine: a.cuisine,
      ext: {
        name: a.name, lat: a.at.lat, lng: a.at.lng, indoor: true, dwell: a.dwellMin, open: a.openMin, close: a.closeMin, kidFit: 0.6,
        ...(a.lastOrderMin != null ? { lastEntry: a.lastOrderMin } : {}),
      },
    })),
  };
}

/** 계획 → 카드 JSON. profile을 주면 장소마다 머무름 예상·출처(dwell)를, here까지 주면 '왜?' 설명(why)을 붙인다. */
export function optionsJson(plan: Plan, profile?: FamilyProfile, here?: LatLng): OptionJson[] {
  const why = here ? { nowMin: plan.nowMin, here, sky: plan.sky } : undefined;
  return plan.options.map((o) => optionJsonOf(o, profile, why));
}

export type SkyJson = {
  sunrise: string | null; sunset: string | null; sky: string; rainFrom: string | null;
  sunSource: string; weatherSource: string;
  /** 지금부터 시간별 강수 확률 (기상청 값이 있을 때만). */
  hours: { at: string; pop: number | null; pty: number | null }[];
  /**
   * 지금 미세먼지 (에어코리아 가까운 측정소). level = GOOD·NORMAL·BAD·VERY_BAD·UNKNOWN, pm10·pm25 = ㎍/㎥.
   * 모르면 level UNKNOWN·source none. 예전 계획엔 없을 수 있다.
   */
  air?: AirJson;
  /** 지금 기온(℃, 기상청 예보) — 저녁 나들이 '쌀쌀함'. 모르면 null. 예전 계획엔 없을 수 있다. */
  temp?: number | null;
  /**
   * 해가 이미 졌을 때 '내일 노을 보러' 안내 (엔진 Plan.sunsetTip) — 저녁 계획에만. 하늘과 같이 계획 줄에 저장된다.
   * { placeId, name, sunset 'HH:MM', arriveBy 'HH:MM' }
   */
  sunsetTip?: { placeId: string; name: string; sunset: string; arriveBy: string } | null;
};

export type AirJson = { level: AirLevel; pm10: number | null; pm25: number | null; station: string | null; source: "airkorea" | "none" };

export function skyJson(s: SkyInfo, plan?: Plan): SkyJson {
  const t = (m: number | null) => (m == null ? null : asHhmm(m));
  const tip = plan?.sunsetTip;
  return {
    temp: s.sky.tempC ?? null,
    ...(tip ? { sunsetTip: { placeId: tip.placeId, name: tip.placeName, sunset: asHhmm(tip.sunsetMin), arriveBy: asHhmm(tip.arriveByMin) } } : {}),
    sunrise: t(s.sky.sunriseMin), sunset: t(s.sky.sunsetMin), sky: s.sky.sky, rainFrom: t(s.sky.rainFromMin),
    sunSource: s.sunSource, weatherSource: s.weatherSource,
    hours: s.hours.map((h) => ({ at: asHhmm(h.min), pop: h.pop, pty: h.pty })),
    air: {
      level: s.sky.air ?? "UNKNOWN",
      pm10: s.sky.pm10 ?? null,
      pm25: s.sky.pm25 ?? null,
      station: s.air?.station ?? null,
      source: s.airSource,
    },
  };
}

export type SkyOverride = Partial<SkyToday>;

// ------------------------------------------------------------------ 고르기 알림 글

/** 받침이 있으면 '이', 없으면 '가' (엄마가 · 가족이). */
export function iGa(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 === 0 ? "가" : "이";
  return "가";
}
