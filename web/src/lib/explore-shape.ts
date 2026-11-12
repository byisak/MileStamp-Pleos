/*
 * '내가 고르기' 목록 모양·정렬·이름 맞추기 (DB·네트워크 없이, 시험은 explore-shape.test.ts).
 * DB·TourAPI를 부르는 쪽은 explore.ts. 계획: docs/직접-고르기-계획.md §2·§7.
 */
import { addDays } from "./festival-shape";
import { km, TravelTime, weekdayOf, type LatLng } from "./planner";
import { kto100ExtId, tourExtId, TYPE_LABEL, type TourItem } from "./tourapi-shape";
import { normRegionCode, regionFromText } from "./explore-region";

/** 축제 목록 '가까운 곳' 기준: 집에서 차로 2시간 (주인 결정 10/28). */
export const NEAR_MAX_MIN = 120;
/** 이보다 멀면 폰이 '당일치기 빠듯해요'를 붙일 수 있게 (계획 §2). */
export const TIGHT_MIN = 150;

/**
 * 목록 한 줄 (폰 축제·100선·직접 찾기 공용).
 * kind: 'festival' 우리가 등록한 축제(한정 도장) · 'place' 우리 명소(도장) · 'tour' 바깥 장소(TourAPI·100선 미등록, 도장 대신 '다녀옴')
 * id: 축제 'fest-…' · 명소 '<placeId>' · 바깥 'ext:tour:<contentId>' (100선 중 TourAPI 번호를 모르는 곳은 'ext:kto100:<no>')
 */
export type ExploreItem = {
  kind: "festival" | "place" | "tour";
  id: string;
  name: string;
  /** 축제만: 'YYYY-MM-DD' */
  starts?: string;
  ends?: string;
  lat: number;
  lng: number;
  addr: string;
  image: string | null;
  /** 집에서 차로 몇 분 (planner TravelTime 근사: 직선 × 1.3 ÷ 50km/h). 집을 모르면 null. */
  driveMin: number | null;
  /** 실내면 true (우리 것만 앎. TourAPI는 모름 → 없음) */
  indoor?: boolean;
  /** 우리 도장이 있는 곳 (명소·등록 축제) */
  ourStamp: boolean;
  /** 이번 주말(토·일)에 열리는 축제 */
  thisWeekend?: boolean;
  /** 바깥 장소가 우리 명소와 같은 곳이면 그 명소 id (100선) */
  ourPlaceId?: string | null;
  /** '관광지' | '문화시설' | '축제·행사' | '한국관광 100선' */
  type?: string;
  /** 100선: 권역·순번 */
  area?: string;
  no?: number;
  /** TourAPI contentid (아는 경우) */
  contentId?: string;
  /** 시·도 코드 (KorService2 lDongRegnCd: 대구 27 · 경북 47 …, explore-region.ts). 서버가 목록 낼 때 모두 채운다 */
  region?: string;
  /** 최근 30일 이곳을 고르거나 다녀간 가족 수 — 3가족 이상일 때만 (explore-filter.ts) */
  popular?: number;
};

export function driveMinFrom(home: LatLng | null, lat: number, lng: number): number | null {
  return home ? TravelTime.minutes(home, { lat, lng }) : null;
}

/** [from] 기준 '이번 주말' (토·일). 토요일이면 그날·다음 날, 일요일이면 그날 하루, 평일이면 다가오는 토·일. */
export function weekendOf(from: string): { sat: string; sun: string } {
  const dow = weekdayOf(from); // 0 = 일
  if (dow === 0) return { sat: from, sun: from };
  const sat = addDays(from, 6 - dow);
  return { sat, sun: addDays(sat, 1) };
}

export const overlaps = (s: string, e: string, a: string, b: string) => s <= b && e >= a;

const byDrive = (a: ExploreItem, b: ExploreItem) =>
  (a.driveMin ?? Number.MAX_SAFE_INTEGER) - (b.driveMin ?? Number.MAX_SAFE_INTEGER);

/** 축제 정렬: 우리 축제(도장) 먼저 → 이번 주말 → 가까운 순 → 먼저 시작 → 이름. */
export function sortFestivals(items: ExploreItem[]): ExploreItem[] {
  return [...items].sort((a, b) =>
    Number(b.ourStamp) - Number(a.ourStamp) ||
    Number(!!b.thisWeekend) - Number(!!a.thisWeekend) ||
    byDrive(a, b) ||
    (a.starts ?? "").localeCompare(b.starts ?? "") ||
    a.name.localeCompare(b.name, "ko"));
}

/** 100선·찾기 정렬: 우리 도장 먼저 → 가까운 순 → 이름. */
export function sortNearest(items: ExploreItem[]): ExploreItem[] {
  return [...items].sort((a, b) => Number(b.ourStamp) - Number(a.ourStamp) || byDrive(a, b) || a.name.localeCompare(b.name, "ko"));
}

/** 차로 [max]분 안만. 집을 몰라 driveMin이 null이면 거르지 않는다(목록이 비지 않게, 응답 home:null로 알림). */
export function nearOnly(items: ExploreItem[], max = NEAR_MAX_MIN): ExploreItem[] {
  return items.filter((x) => x.driveMin == null || x.driveMin <= max);
}

// ------------------------------------------------------------------ 이름 맞추기 (100선·찾기 ↔ 우리 명소)

/** 괄호 속·띄어쓰기·기호를 빼고 소문자로. */
export function normName(s: string): string {
  return s.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/[^0-9a-zA-Z가-힣]/g, "").toLowerCase();
}

const GENERIC = /^(국립|도립|군립|시립|대구광역시|대구|경북|경상북도|부산|서울|울산|경주|안동|군위|달성)+/;

function tokens(s: string): string[] {
  const whole = normName(s);
  // 낱말은 3글자 이상만 ('대구'·'공원'처럼 짧은 말로 엉뚱한 곳이 묶이지 않게). 첫 줄은 이름 전체.
  const parts = s.replace(/\(([^)]*)\)/g, "&$1&").replace(/\[[^\]]*\]/g, " ").split(/[&,·/\-\s]+/).map(normName).filter((t) => t.length >= 3);
  return [...new Set([whole, ...parts].filter(Boolean))];
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** 두 이름이 같은 곳을 가리키는 것 같나 (예: '안동하회마을'↔'안동 하회마을', '팔공산국립공원'↔'팔공산 케이블카'). */
export function namesMatch(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  for (const x of ta) {
    for (const y of tb) {
      if (x === y && (x.length >= 3 || (x === ta[0] && y === tb[0]))) return true;
      if (x.length >= 3 && y.includes(x)) return true;
      if (y.length >= 3 && x.includes(y)) return true;
      const sx = x.replace(GENERIC, ""), sy = y.replace(GENERIC, "");
      if (sx.length >= 3 && sy.length >= 3 && commonPrefix(sx, sy) >= 3) return true;
    }
  }
  return false;
}

/** 우리 명소와 같은 곳 찾기 (이름이 비슷하고 5km 안, 그중 가장 가까운 곳). 좌표만 가깝다고 묶지는 않는다. */
export function matchOurPlace<P extends { id: string; name: string; lat: number; lng: number }>(
  x: { name: string; lat: number | null; lng: number | null },
  places: P[],
  maxKm = 5,
): P | null {
  if (x.lat == null || x.lng == null) return null;
  let best: P | null = null;
  let bestKm = Infinity;
  for (const p of places) {
    const d = km({ lat: x.lat, lng: x.lng }, { lat: p.lat, lng: p.lng });
    if (d <= maxKm && d < bestKm && namesMatch(x.name, p.name)) { best = p; bestKm = d; }
  }
  return best;
}

// ------------------------------------------------------------------ 줄 만들기

/** TourAPI 축제 줄 → 목록 줄 (좌표 없으면 null). */
export function tourFestivalItem(t: TourItem, home: LatLng | null, weekend: { sat: string; sun: string }): ExploreItem | null {
  if (t.lat == null || t.lng == null || !t.starts || !t.ends) return null;
  return {
    kind: "tour", id: tourExtId(t.contentId), name: t.title, starts: t.starts, ends: t.ends, lat: t.lat, lng: t.lng, addr: t.addr,
    image: t.image, driveMin: driveMinFrom(home, t.lat, t.lng), ourStamp: false,
    thisWeekend: overlaps(t.starts, t.ends, weekend.sat, weekend.sun), type: TYPE_LABEL["15"], contentId: t.contentId,
    ...regionField(t.region, t.addr),
  };
}

/** TourAPI 관광지·문화시설 줄 → 목록 줄. */
export function tourPlaceItem(t: TourItem, home: LatLng | null): ExploreItem | null {
  if (t.lat == null || t.lng == null) return null;
  return {
    kind: "tour", id: tourExtId(t.contentId), name: t.title, lat: t.lat, lng: t.lng, addr: t.addr, image: t.image,
    driveMin: driveMinFrom(home, t.lat, t.lng), ourStamp: false, type: TYPE_LABEL[t.contentTypeId] ?? undefined, contentId: t.contentId,
    ...regionField(t.region, t.addr),
  };
}

/** 시·도 칸 (코드 → 글 앞머리 순, 모르면 칸 없음 — 목록 낼 때 좌표로 채움). */
function regionField(code: unknown, text: string | null | undefined): { region?: string } {
  const r = normRegionCode(code) ?? regionFromText(text);
  return r ? { region: r } : {};
}

/** 등록 축제 줄. */
export function ourFestivalItem(
  f: { id: string; name: string; starts: string; ends: string; lat: number; lng: number; indoor: boolean; poster: string | null; addr?: string },
  home: LatLng | null,
  weekend: { sat: string; sun: string },
): ExploreItem {
  return {
    kind: "festival", id: f.id, name: f.name, starts: f.starts, ends: f.ends, lat: f.lat, lng: f.lng, addr: f.addr ?? "",
    image: f.poster, driveMin: driveMinFrom(home, f.lat, f.lng), indoor: f.indoor, ourStamp: true,
    thisWeekend: overlaps(f.starts, f.ends, weekend.sat, weekend.sun), type: TYPE_LABEL["15"],
  };
}

/** 우리 명소 줄. */
export function ourPlaceItem(
  p: { id: string; name: string; lat: number; lng: number; indoor: boolean; stampable: boolean; image?: string | null; region?: string | null },
  home: LatLng | null,
): ExploreItem {
  return {
    kind: "place", id: p.id, name: p.name, lat: p.lat, lng: p.lng, addr: p.region ?? "", image: p.image ?? null,
    driveMin: driveMinFrom(home, p.lat, p.lng), indoor: p.indoor, ourStamp: p.stampable,
    ...regionField(null, p.region),
  };
}

/**
 * 축제 합치기: 등록 축제(먼저, 한정 도장) + TourAPI. [from]에 열리고 있거나 [days]일 안에 시작하는 것만.
 * TourAPI 줄이 등록 축제와 같은 축제(source 'tourapi:<id>' 또는 이름이 맞고 5km 안)면 뺀다.
 */
export function mergeFestivals(opts: {
  ours: ExploreItem[];
  ourSources?: Record<string, string>;
  tour: TourItem[];
  home: LatLng | null;
  from: string;
  days: number;
}): ExploreItem[] {
  const to = addDays(opts.from, opts.days);
  const weekend = weekendOf(opts.from);
  const ours = opts.ours.filter((f) => f.starts && f.ends && overlaps(f.starts, f.ends, opts.from, to));
  const taken = new Set(Object.values(opts.ourSources ?? {}).map((s) => s.replace(/^tourapi:/, "")));
  const seen = new Set<string>();
  const tour: ExploreItem[] = [];
  for (const t of opts.tour) {
    if (seen.has(t.contentId) || taken.has(t.contentId)) continue;
    seen.add(t.contentId);
    if (!t.starts || !t.ends || !overlaps(t.starts, t.ends, opts.from, to)) continue;
    const item = tourFestivalItem(t, opts.home, weekend);
    if (!item) continue;
    if (ours.some((o) => namesMatch(o.name, item.name) && km(o, item) <= 5)) continue;
    tour.push(item);
  }
  return sortFestivals([...ours, ...tour]);
}

/** 100선 표 한 줄 → 목록 줄. 우리 명소와 같은 곳이면 kind 'place'·우리 id·도장. */
export function curatedItem(
  r: { no: number; name: string; content_id: string | null; lat: number | null; lng: number | null; area: string | null; region: string | null; addr: string | null; image: string | null },
  our: { id: string; name: string; stampable: boolean; indoor: boolean } | null,
  home: LatLng | null,
): ExploreItem | null {
  if (r.lat == null || r.lng == null) return null;
  const base = {
    name: r.name, lat: r.lat, lng: r.lng, addr: r.addr ?? r.region ?? "", image: r.image,
    driveMin: driveMinFrom(home, r.lat, r.lng), type: "한국관광 100선", area: r.area ?? undefined, no: r.no,
    ...(r.content_id ? { contentId: r.content_id } : {}),
    ...regionField(null, r.region ?? r.addr),
  };
  if (our) return { ...base, kind: "place", id: our.id, ourStamp: our.stampable, ourPlaceId: our.id, indoor: our.indoor };
  return { ...base, kind: "tour", id: r.content_id ? tourExtId(r.content_id) : kto100ExtId(r.no), ourStamp: false, ourPlaceId: null };
}

/** 검색어 다듬기 (앞뒤 공백·연속 공백, 40자). 2글자 미만이면 ''. */
export function cleanQuery(q: string | null): string {
  const s = (q ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return s.replace(/\s/g, "").length >= 2 ? s : "";
}
