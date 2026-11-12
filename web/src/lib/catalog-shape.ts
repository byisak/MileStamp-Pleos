/*
 * 명소 목록(catalog) 모양과 검사 — 서버·관리자 화면이 같이 쓴다 (DB 접근 없음, 순수 함수).
 * 시각은 0시부터 분(상시 개방 0~1440), 반경은 m, 쉬는 요일은 0=일 … 6=토.
 */
import { parseFitInput, parseTagsInput, type FitView } from "./companion-shape";
import {
  parseAiDrafts, parseClosedRules, parseFitExtra, parseHoursRows, parseMeta, parseMoments, parseParking, parsePrice, parseRoute,
  representativeHours, PLACE_KINDS, REGION_CODE_RE,
  type AiDrafts, type DriveRoute, type FitExtra, type HoursRow, type Moments, type Parking, type PlaceKind, type PlaceMeta, type Price,
} from "./place-attrs-shape";

/** 도착 지점(원) 하나. 어느 원 안에서든 P단이면 그 장소에 온 것. */
export type ArrivalPoint = { lat: number; lng: number; r: number; name: string };

export type Mission = { quiz: { q: string; options: string[]; answer: number }; find: string };

export type StampRef = { url: string | null; bwUrl: string | null; version: number };

/** 도장북 묶음 (폰 phone/src/places.ts ALBUM_SECTIONS, 차 StampAlbum.SECTIONS와 같은 key·순서). */
export const ALBUM_GROUPS: { key: string; title: string }[] = [
  { key: "season1", title: "대구·경북 시즌 1" },
  { key: "town", title: "우리 동네 평일 오후" },
  { key: "home", title: "귀갓길 잠깐" },
  { key: "rain", title: "비 오는 날" },
  { key: "weekend", title: "주말 나들이" },
];

/**
 * 관리자 편의 칩 (명소, 계획서 §2.1④ 정해진 목록). '주차장'·'입장료 있음'은 예전 칩 — 이제 주차·가격 칸에서 저장 때 맞춰 준다(syncLegacyFacilities).
 */
export const PLACE_FACILITIES = [
  "유모차 가능", "수유실", "기저귀 교환대", "키즈존·놀이터", "화장실", "그늘·쉼터", "냉난방 실내", "반려동물", "휠체어", "비 와도 OK",
];
/** 예전 칩 (주차·가격 칸이 정해지면 저절로). */
export const LEGACY_FACILITIES = ["주차장", "입장료 있음"];

/** 주차·가격 칸에 맞춰 예전 칩 '주차장'·'입장료 있음'을 켜고 끈다 (칸이 비면 그대로 — 옛 앱 표시용). */
export function syncLegacyFacilities(facilities: string[], parking: Parking | null | undefined, price: Price | null | undefined): string[] {
  let out = [...facilities];
  const set = (name: string, on: boolean) => { out = out.filter((x) => x !== name); if (on) out.push(name); };
  if (parking) set("주차장", parking.has !== "no");
  if (price) set("입장료 있음", !price.free);
  return out;
}
/** 맛집 아이 편의 칩. */
export const FOOD_FACILITIES = ["유아 의자", "놀이방", "수유실", "주차", "좌식"];
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export const RADIUS_MIN = 50;
export const RADIUS_MAX = 1500;
export const RADIUS_DEFAULT = 300;

/** 관리자 화면이 다루는 명소 한 곳 (DB 한 줄을 풀어 쓴 것). */
export type AdminPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  region: string | null;
  /** 조사 묶음 ('주말 하루' 등, 씨앗에서 옴 — 읽기만) */
  research: string | null;
  /** 도장북 묶음 key */
  album: string;
  indoor: boolean;
  open: number;
  close: number;
  dwell: number;
  kidFit: number;
  /** 동행별 적합도 4칸 (kids = kidFit, 누구랑 가요?) · 어른 기준 머무는 분 (null = dwell × 0.8) */
  fit: FitView;
  dwellAdult: number | null;
  stampable: boolean;
  active: boolean;
  /** 설명 표시 + 분위기 표시(야경·카페·데이트·체험·산책·전시·드라이브·액티비티·조용함 — 관리자에서 고름) */
  tags: string[];
  hours: string | null;
  closed: string | null;
  facilities: string[];
  closedDays: number[];
  /** 'YYYY-MM-DD' */
  tempClosed: string[];
  points: ArrivalPoint[];
  intro: string;
  mission: Mission | null;
  stamp: StampRef;
  popular: number;
  editedAt: string | null;
  /** ─ 장소 구조 칸 (11/3, place-attrs-shape.ts) ─ 운영 시간 줄(비면 예전 open·close 하나) · 쉬는 날 규칙 · 주차 · 가격 · 시간 특성 */
  openHours: HoursRow[];
  closedRules: string[];
  parking: Parking | null;
  price: Price | null;
  moments: Moments | null;
  /** 법정동 시군구 5자리 (대구 북구 27230) */
  regionCode: string | null;
  kind: PlaceKind;
  /** kind 'drive'일 때만 */
  route: DriveRoute | null;
  /** 어울림 확장: 아이 나이대 · 저녁 (fit jsonb 안) */
  fitExtra: FitExtra;
  /** 칸마다 출처·확인 */
  meta: PlaceMeta;
  /** AI 초안 (DB meta.drafts — 칸에는 아직 안 들어감, 관리자가 '맞아요'를 눌러야 옮김) */
  aiDrafts: AiDrafts;
};

/** 앱(폰·차)이 받는 명소 한 곳. */
export type CatalogPlace = {
  id: string;
  name: string;
  grp: string;
  points: ArrivalPoint[];
  lat: number;
  lng: number;
  /** 가장 큰 원의 반경 (예전 앱용) */
  radiusM: number;
  indoor: boolean;
  open: number;
  close: number;
  dwell: number;
  kidFit: number;
  /** 동행별 적합도 4칸 (kids = kidFit) · 어른 기준 머무는 분 (null = dwell × 0.8) */
  fit: FitView;
  dwellAdult: number | null;
  stampable: boolean;
  tags: string[];
  facilities: string[];
  closedDays: number[];
  tempClosed: string[];
  intro: string | null;
  mission: Mission | null;
  stamp: StampRef;
  /** ─ 11/3에 더한 칸 (모르는 칸은 무시하는 옛 앱과 호환) ─ 모양은 place-attrs-shape.ts */
  openHours?: HoursRow[];
  closedRules?: string[];
  parking?: Parking | null;
  price?: Price | null;
  moments?: Moments | null;
  regionCode?: string | null;
  kind?: PlaceKind;
  route?: DriveRoute | null;
  /** 아이 나이대별 어울림 {"0-3","4-6","7-9","10+"} · 해 진 뒤 어울림 {kids,couple,friends,solo} (없으면 빈 칸) */
  fitKidAge?: FitExtra["kid_age"] | null;
  fitEvening?: FitExtra["evening"] | null;
  /** 단어장에 있는 태그만 (추천·말로 찾기용). tags는 예전 자유 태그 그대로 */
  vocabTags?: string[];
};

export type Restaurant = {
  id: string;
  name: string;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  facilities: string[];
  hours: string | null;
  closed: string | null;
  note: string | null;
  active: boolean;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function clampRadius(r: unknown): number {
  const n = Number(r);
  if (!Number.isFinite(n)) return RADIUS_DEFAULT;
  return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, Math.round(n)));
}

/** DB·입력의 도착 지점 → 검사한 목록. 하나도 없으면 대표 좌표 + 300m 하나. */
export function normalizePoints(raw: unknown, lat: number, lng: number): ArrivalPoint[] {
  const out: ArrivalPoint[] = [];
  if (Array.isArray(raw)) {
    for (const p of raw.slice(0, 8)) {
      if (!p || typeof p !== "object") continue;
      const o = p as Record<string, unknown>;
      const la = Number(o.lat), ln = Number(o.lng);
      if (!finite(la) || !finite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) continue;
      out.push({
        lat: Math.round(la * 1e6) / 1e6,
        lng: Math.round(ln * 1e6) / 1e6,
        r: clampRadius(o.r),
        name: String(o.name ?? "").trim().slice(0, 40) || `도착 지점 ${out.length + 1}`,
      });
    }
  }
  if (!out.length) out.push({ lat, lng, r: RADIUS_DEFAULT, name: "정문·주차장" });
  return out;
}

export function radiusOf(points: ArrivalPoint[]): number {
  return points.reduce((m, p) => Math.max(m, p.r), 0) || RADIUS_DEFAULT;
}

/** 두 점 사이 거리(m, haversine) — 엔진 Geo.km와 같은 식. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1000;
}

/** 어느 원 안이면 도착 (엔진 Place.contains와 같은 규칙). */
export function insideAny(points: ArrivalPoint[], at: { lat: number; lng: number }): boolean {
  return points.some((p) => distanceM(p, at) <= p.r);
}

export function normalizeMission(raw: unknown): Mission | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const quiz = (o.quiz ?? {}) as Record<string, unknown>;
  const q = String(quiz.q ?? "").trim();
  const options = Array.isArray(quiz.options) ? quiz.options.map((x) => String(x ?? "").trim()).slice(0, 4) : [];
  const find = String(o.find ?? "").trim();
  if (!q && !find) return null;
  const answer = Number(quiz.answer);
  return {
    quiz: {
      q,
      options,
      answer: Number.isInteger(answer) && answer >= 0 && answer < Math.max(1, options.length) ? answer : 0,
    },
    find,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PlaceInput = Pick<
  AdminPlace,
  "name" | "album" | "indoor" | "open" | "close" | "dwell" | "kidFit" | "stampable" | "active" | "facilities" | "closedDays" | "tempClosed" | "points" | "intro" | "mission"
> & {
  /** 없으면(null) 저장 안 바꿈. fitExtra(아이 나이대·저녁)가 오면 fit jsonb에 같이 넣는다 */
  fit: (FitView & FitExtra) | null;
  tags: string[] | null;
  dwellAdult: number | null;
  /** ─ 장소 구조 칸: undefined면 저장 안 바꿈 (예전 화면·다른 도구가 보내지 않아도 그대로) ─ */
  openHours?: HoursRow[];
  closedRules?: string[];
  parking?: Parking | null;
  price?: Price | null;
  moments?: Moments | null;
  regionCode?: string | null;
  kind?: PlaceKind;
  route?: DriveRoute | null;
  meta?: PlaceMeta;
  /** undefined면 DB 초안 그대로 */
  aiDrafts?: AiDrafts;
};

/** 관리자 저장 요청 검사. 잘못된 칸이 있으면 { error } (한국어). */
export function parsePlaceInput(body: unknown): { ok: PlaceInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "내용이 비었어요" };
  const b = body as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  if (!name) return { error: "이름을 적어 주세요" };
  if (name.length > 40) return { error: "이름은 40자까지예요" };
  const album = String(b.album ?? "");
  if (!ALBUM_GROUPS.some((g) => g.key === album)) return { error: "묶음을 골라 주세요" };
  const open = Number(b.open), close = Number(b.close);
  if (!Number.isInteger(open) || !Number.isInteger(close) || open < 0 || close > 1440 || open >= close)
    return { error: "여는 시각이 닫는 시각보다 앞이어야 해요" };
  const dwell = Number(b.dwell);
  if (!Number.isInteger(dwell) || dwell < 5 || dwell > 600) return { error: "머무는 시간은 5~600분이에요" };
  const kidFit = Number(b.kidFit);
  if (!Number.isFinite(kidFit) || kidFit < 0 || kidFit > 1) return { error: "아이 적합도는 0~1이에요" };
  const kf = Math.round(kidFit * 100) / 100;
  const fitR = parseFitInput(b.fit, kf);
  if ("error" in fitR) return { error: fitR.error };
  const tags = b.tags === undefined ? null : parseTagsInput(b.tags);
  if (b.tags !== undefined && !tags) return { error: "분위기 표시 모양이 이상해요" };
  const dwellAdult = b.dwellAdult == null || b.dwellAdult === "" ? null : Number(b.dwellAdult);
  if (dwellAdult != null && (!Number.isInteger(dwellAdult) || dwellAdult < 5 || dwellAdult > 600)) return { error: "어른 머무는 시간은 5~600분이에요" };
  const points = Array.isArray(b.points) ? normalizePoints(b.points, NaN, NaN) : [];
  if (!points.length || points.some((p) => !finite(p.lat))) return { error: "도착 지점이 하나 이상 있어야 해요" };
  const closedDays = [...new Set((Array.isArray(b.closedDays) ? b.closedDays : []).map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort();
  const tempClosed = [...new Set((Array.isArray(b.tempClosed) ? b.tempClosed : []).map(String))].filter((d) => DATE_RE.test(d)).sort();
  let facilities = [...new Set((Array.isArray(b.facilities) ? b.facilities : []).map((x) => String(x).trim()))]
    .filter((x) => x && x.length <= 20)
    .slice(0, 20);

  // ─ 장소 구조 칸 (보낸 것만 검사·저장) ─
  const extra: Partial<PlaceInput> = {};
  let rows: HoursRow[] | undefined;
  if (b.openHours !== undefined) {
    const r = parseHoursRows(b.openHours);
    if ("error" in r) return { error: r.error };
    rows = r.ok;
    extra.openHours = r.ok;
  }
  // 예전 칸은 평일 대표값으로 (옛 앱용) — 줄이 있으면 줄에서 다시 계산
  const rep = rows?.length ? representativeHours(rows) : null;
  if (b.closedRules !== undefined) {
    const r = parseClosedRules(b.closedRules);
    if (!r) return { error: "쉬는 날 규칙은 정해진 말만 골라요" };
    extra.closedRules = r;
  }
  if (b.parking !== undefined) {
    const r = parseParking(b.parking);
    if ("error" in r) return { error: r.error };
    extra.parking = r.ok;
  }
  if (b.price !== undefined) {
    const r = parsePrice(b.price);
    if ("error" in r) return { error: r.error };
    extra.price = r.ok;
  }
  if (b.moments !== undefined) {
    const r = parseMoments(b.moments, { hours: rows ?? [], open: rep?.open ?? open, close: rep?.close ?? close });
    if ("error" in r) return { error: r.error };
    extra.moments = r.ok;
  }
  if (b.regionCode !== undefined) {
    const rc = b.regionCode == null || b.regionCode === "" ? null : String(b.regionCode).trim();
    if (rc != null && !REGION_CODE_RE.test(rc)) return { error: "지역 코드는 숫자 5자리예요 (대구 북구 27230)" };
    extra.regionCode = rc;
  }
  if (b.kind !== undefined) {
    const k = PLACE_KINDS.find((x) => x === b.kind);
    if (!k) return { error: "종류는 일반·전망대·시장·드라이브 길 중 하나예요" };
    extra.kind = k;
    const r = parseRoute(b.route, k);
    if ("error" in r) return { error: r.error };
    extra.route = r.ok;
  }
  if (b.meta !== undefined) {
    const r = parseMeta(b.meta);
    if ("error" in r) return { error: r.error };
    extra.meta = r.ok;
  }
  if (b.aiDrafts !== undefined) extra.aiDrafts = parseAiDrafts(b.aiDrafts);
  let fit: (FitView & FitExtra) | null = fitR.fit;
  if (b.fitExtra !== undefined) {
    const r = parseFitExtra(b.fitExtra);
    if ("error" in r) return { error: r.error };
    if (fit) fit = { ...fit, ...r.ok };
  }
  facilities = syncLegacyFacilities(facilities, extra.parking, extra.price);
  return {
    ok: {
      ...extra,
      name,
      album,
      indoor: !!b.indoor,
      open: rep?.open ?? open,
      close: rep?.close ?? close,
      dwell,
      kidFit: kf,
      fit,
      tags,
      dwellAdult,
      stampable: b.stampable === undefined ? true : !!b.stampable,
      active: b.active === undefined ? true : !!b.active,
      facilities,
      closedDays,
      tempClosed,
      points,
      intro: String(b.intro ?? "").trim().slice(0, 1000),
      mission: normalizeMission(b.mission),
    },
  };
}

export function parseRestaurantInput(body: unknown): { ok: Omit<Restaurant, "id"> } | { error: string } {
  if (!body || typeof body !== "object") return { error: "내용이 비었어요" };
  const b = body as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  if (!name) return { error: "이름을 적어 주세요" };
  const lat = b.lat === null || b.lat === "" || b.lat === undefined ? null : Number(b.lat);
  const lng = b.lng === null || b.lng === "" || b.lng === undefined ? null : Number(b.lng);
  if ((lat !== null && !finite(lat)) || (lng !== null && !finite(lng))) return { error: "좌표가 숫자가 아니에요" };
  const txt = (v: unknown) => (v === null || v === undefined ? null : String(v).trim().slice(0, 200) || null);
  return {
    ok: {
      name: name.slice(0, 60),
      placeId: txt(b.placeId),
      lat,
      lng,
      facilities: [...new Set((Array.isArray(b.facilities) ? b.facilities : []).map(String))].filter((f) => FOOD_FACILITIES.includes(f)),
      hours: txt(b.hours),
      closed: txt(b.closed),
      note: txt(b.note),
      active: b.active === undefined ? true : !!b.active,
    },
  };
}

/** 분 → "09:30" (1440은 "24:00"). */
export function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "09:30" → 570 ("23:59"는 상시 개방 끝 1440으로). */
export function minOf(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return NaN;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v === 1439 ? 1440 : v;
}
