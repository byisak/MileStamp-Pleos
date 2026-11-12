import { MEAL_ID_PREFIX, MEAL_KIND, type Place } from "./planner";
import { stopName } from "./livecourse";

/*
 * 바깥 장소 (우리 명소 34곳·등록 축제가 아닌 곳 — TourAPI 관광지·한국관광 100선 중 미등록, docs/직접-고르기-계획.md 6·7절).
 * id = 'ext:tour:<contentId>' | 'ext:kto100:<no>' | 'ext:kakao:<카카오 장소 id>' | 'ext:pin:<lat>,<lng>'(지도 핀·주소, docs/검색-거리순-계획.md). 장소표(places)에 없으므로 이름·좌표·머무름을 카드·코스 JSON에 같이 들고 다닌다.
 * 기본값: 도착 반경 300m(차가 판정할 때) · 머무름 90분 · 운영 10:00~18:00 · 아이 적합 0.6 · 도장 없음('다녀옴' 기록).
 * 'ext:food:<식당 id>' = 코스에 넣은 밥 자리 (엔진 Meals) — kind meal · 실내 · 머무름 그대로 · lastEntry = 마지막 주문. 다녀오면 '다녀옴'으로 남아 일기에 '점심은 ○○에서'.
 */

export const EXT_ID = /^ext:(?:(?:tour|kto100|kakao|food):[A-Za-z0-9_-]{1,40}|pin:-?\d{1,3}\.\d{1,6},-?\d{1,3}\.\d{1,6})$/;
export const EXT_DEFAULT = { radiusM: 300, dwell: 90, open: 600, close: 1080, kidFit: 0.6 } as const;

export const isExtId = (id: unknown): id is string => typeof id === "string" && EXT_ID.test(id);

/** 카드·코스 JSON에 싣는 바깥 장소 정보 (stops[].ext). 분 단위 시각. */
export type ExtJson = {
  name: string; lat: number; lng: number; indoor: boolean; dwell: number; open: number; close: number; kidFit: number;
  /** 마지막 입장(밥 자리는 마지막 주문, 분). 없으면 칸 없음. */
  lastEntry?: number;
};

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

/**
 * {id, name, lat, lng, indoor?, dwell?, open?, close?, kidFit?} → Place. 모양이 틀리면 이유(한글) 글자.
 * open·close는 분(600) 또는 'HH:MM'.
 */
export function extPlace(v: unknown): Place | string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "바깥 장소는 {id, name, lat, lng}예요";
  const o = v as Record<string, unknown>;
  if (!isExtId(o.id)) return "바깥 장소 id는 ext:tour:<번호>·ext:kakao:<번호>·ext:pin:<위도>,<경도> 모양이에요";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name || name.length > 40) return "바깥 장소 이름은 1~40자예요";
  const lat = num(o.lat, -90, 90);
  const lng = num(o.lng, -180, 180);
  if (lat == null || lng == null) return "바깥 장소 좌표(lat·lng)가 이상해요";
  const t = (x: unknown, d: number): number | null => {
    if (x == null) return d;
    if (typeof x === "string") {
      const m = /^(\d{1,2}):(\d{2})$/.exec(x);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    }
    return num(x, 0, 1440);
  };
  const open = t(o.open, EXT_DEFAULT.open);
  const close = t(o.close, EXT_DEFAULT.close);
  if (open == null || close == null || close <= open) return "운영 시각(open·close)이 이상해요";
  const dwell = o.dwell == null ? EXT_DEFAULT.dwell : num(o.dwell, 15, 360);
  if (dwell == null) return "머무름(dwell)은 15~360분이에요";
  const kidFit = o.kidFit == null ? EXT_DEFAULT.kidFit : num(o.kidFit, 0, 1);
  if (kidFit == null) return "kidFit은 0~1이에요";
  const last = o.lastEntry == null ? null : num(o.lastEntry, open + 1, close);
  const meal = o.id.startsWith(MEAL_ID_PREFIX);
  return {
    id: o.id, name, at: { lat, lng }, indoor: meal || o.indoor === true, dwellP80Min: Math.round(dwell), kidFit,
    openMin: Math.round(open), closeMin: Math.round(close), popular: 0, stampable: false,
    ...(last != null ? { lastEntryMin: Math.round(last) } : {}),
    ...(meal ? { kind: MEAL_KIND, adultDwellMin: Math.round(dwell) } : {}),
  };
}

export function extJson(p: Place): ExtJson {
  return {
    name: p.name, lat: p.at.lat, lng: p.at.lng, indoor: p.indoor, dwell: p.dwellP80Min, open: p.openMin, close: p.closeMin, kidFit: p.kidFit,
    ...(p.lastEntryMin != null ? { lastEntry: p.lastEntryMin } : {}),
  };
}

/** stops[].ext → Place (없거나 틀리면 null). */
export function placeFromExt(id: string, e: unknown): Place | null {
  if (!isExtId(id) || !e || typeof e !== "object") return null;
  const p = extPlace({ ...(e as object), id });
  return typeof p === "string" ? null : p;
}

type StopLike = { id?: string; placeId?: string; ext?: unknown };

/** 카드·코스 JSON들에 실린 바깥 장소 모으기. */
export function extPlacesOf(...lists: (StopLike[] | null | undefined)[]): Place[] {
  const out = new Map<string, Place>();
  for (const list of lists) for (const s of list ?? []) {
    const id = s.placeId ?? s.id;
    if (!id || out.has(id)) continue;
    const p = placeFromExt(id, s.ext);
    if (p) out.set(id, p);
  }
  return [...out.values()];
}

/** 장소 찾기에 바깥 장소를 더한다 (장소표 먼저). */
export function withExt<T extends Place | null | undefined>(find: (id: string) => T, extra: Place[]): (id: string) => Place | null {
  if (!extra.length) return (id) => find(id) ?? null;
  const m = new Map(extra.map((p) => [p.id, p]));
  return (id) => find(id) ?? m.get(id) ?? null;
}

/**
 * 저장·응답하는 코스 JSON의 곳마다 이름·좌표(name·lat·lng)를 붙이고, 바깥 장소면 ext도 싣는다 — 다시 읽을 때(courseFromJson)
 * 장소표에 없어도 되살리고, 차가 나중에(C단계) 이름·좌표로 그릴 수 있게. 엔진은 이 칸들을 읽지 않는다.
 */
export function decorateStops<S extends { placeId: string }>(stops: S[], find: (id: string) => Place | null | undefined): (S & { name?: string; lat?: number; lng?: number; ext?: ExtJson })[] {
  for (const s of stops as (S & { name?: string; lat?: number; lng?: number; ext?: ExtJson })[]) {
    const p = find(s.placeId);
    if (!p) continue;
    s.name = p.name;
    s.lat = p.at.lat;
    s.lng = p.at.lng;
    if (isExtId(p.id)) s.ext = extJson(p);
  }
  return stops;
}

/** 코스 JSON의 곳 (다녀옴 판정에 쓰는 칸만). */
type VisitStop = { placeId?: string; id?: string; status?: string; name?: string; lat?: number; lng?: number; ext?: unknown };
export type ExtVisitHit = { extId: string; name: string; lat: number | null; lng: number | null };

const VISITED = new Set(["ARRIVED", "DONE"]);

/**
 * 새로 '다녀옴'이 된 바깥 장소: 이번에 도착(ARRIVED)·다녀옴(DONE)이 된 'ext:…' 곳 중 전 코스에서는 아직 아니던 것.
 * 우리 명소·축제(도장 있는 곳)는 넣지 않는다 — 그 곳은 도장 소식으로 남는다. 이름·좌표는 코스 JSON(decorateStops)에서.
 */
export function newlyVisitedExt(before: { stops?: VisitStop[] } | null | undefined, after: { stops?: VisitStop[] } | null | undefined): ExtVisitHit[] {
  const was = new Set((before?.stops ?? []).filter((s) => VISITED.has(s.status ?? "")).map((s) => s.placeId ?? s.id));
  const out = new Map<string, ExtVisitHit>();
  for (const s of after?.stops ?? []) {
    const id = s.placeId ?? s.id;
    if (!isExtId(id) || !VISITED.has(s.status ?? "") || was.has(id) || out.has(id)) continue;
    out.set(id, extHit(id, s));
  }
  return [...out.values()];
}

/** 코스 JSON의 곳 하나 → 다녀옴 기록 칸 (이름이 없으면 ext.name → '고른 곳'). */
export function extHit(id: string, s: VisitStop): ExtVisitHit {
  const e = (s.ext && typeof s.ext === "object" ? s.ext : {}) as { name?: unknown; lat?: unknown; lng?: unknown };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const name = stopName(id, (typeof s.name === "string" && s.name.trim()) || (typeof e.name === "string" ? e.name : null));
  return { extId: id, name, lat: n(s.lat) ?? n(e.lat), lng: n(s.lng) ?? n(e.lng) };
}

/** 오늘 코스에서 이 바깥 장소 찾기 (안드로이드 오토 도착 — 폰은 좌표를 보내지 않으니 코스에 실린 이름·좌표로). */
export function extStopOf(course: { stops?: VisitStop[] } | null | undefined, extId: string): ExtVisitHit | null {
  if (!isExtId(extId)) return null;
  const s = (course?.stops ?? []).find((x) => (x.placeId ?? x.id) === extId);
  return s ? extHit(extId, s) : null;
}
