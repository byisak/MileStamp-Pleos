/*
 * 미세먼지 — 한국환경공단 에어코리아 (공공데이터포털, 키는 날씨와 같은 DATA_GO_KR_KEY).
 *  1) 측정소 목록: 측정소정보 조회서비스 B552584/MsrstnInfoInqireSvc/getMsrstnList (addr=대구·경북)
 *     → 측정소 이름·주소·좌표(dmX·dmY, WGS84). 30일 저장(sky_cache 'air-stations')은 `sky.ts`가 한다.
 *  2) 지금 농도: 대기오염정보 조회서비스 B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty (sidoName=대구|경북, ver=1.3)
 *     → 측정소마다 pm10Value·pm25Value·pm10Grade1h·pm25Grade1h (1 좋음 2 보통 3 나쁨 4 매우나쁨). 1시간 저장(sky_cache 'air').
 * 가까운 측정소부터 값이 있는 곳을 고른다(30km 넘으면 모름). 실패하면 '모름'(null)으로 계속 간다.
 * 이 파일은 DB를 모른다(시험하기 쉽게).
 */
import type { AirLevel } from "./planner";
import { serviceKeyParam } from "./sun";

/** 측정소 하나. sido = 실시간 조회에 쓰는 시도 이름(대구·경북). */
export type AirStation = { name: string; sido: string; lat: number; lng: number; addr: string };

/** 측정소 한 곳의 지금 값. 값이 없으면 null. */
export type AirReading = {
  station: string;
  pm10: number | null;
  pm25: number | null;
  /** 1시간 등급 1~4 (없으면 농도로 계산한 등급, 그것도 없으면 null). */
  pm10Grade: number | null;
  pm25Grade: number | null;
  /** 측정 시각 'YYYY-MM-DD HH:MM' (에어코리아 dataTime). */
  dataTime: string | null;
};

/** 화면·엔진에 넘길 값. */
export type AirNow = { level: AirLevel; pm10: number | null; pm25: number | null; station: string; dataTime: string | null };

/** 측정소 목록을 받는 시도와 주소 검색어 (주소가 '경북 …' 또는 '경상북도 …'일 수 있어 둘 다 본다). */
export const AIR_SIDOS: { sido: string; addrs: string[] }[] = [
  { sido: "대구", addrs: ["대구"] },
  { sido: "경북", addrs: ["경북", "경상북도"] },
];

/** 이보다 먼 측정소 값은 쓰지 않는다 (km). */
export const AIR_MAX_KM = 30;

const BASE = "https://apis.data.go.kr/B552584";

// ------------------------------------------------------------------ 등급

/** 등급 숫자(1~4) → 엔진 등급. */
export function gradeLevel(g: number | null): AirLevel {
  return g === 1 ? "GOOD" : g === 2 ? "NORMAL" : g === 3 ? "BAD" : g === 4 ? "VERY_BAD" : "UNKNOWN";
}

/** 환경부 기준으로 농도 → 등급 (1시간 등급이 비었을 때만). PM10 30/80/150, PM2.5 15/35/75. */
export function pm10ToGrade(v: number | null): number | null {
  if (v == null) return null;
  return v <= 30 ? 1 : v <= 80 ? 2 : v <= 150 ? 3 : 4;
}
export function pm25ToGrade(v: number | null): number | null {
  if (v == null) return null;
  return v <= 15 ? 1 : v <= 35 ? 2 : v <= 75 ? 3 : 4;
}

/** 미세먼지·초미세먼지 중 나쁜 쪽. 둘 다 없으면 UNKNOWN. */
export function airLevelOf(r: Pick<AirReading, "pm10Grade" | "pm25Grade">): AirLevel {
  const gs = [r.pm10Grade, r.pm25Grade].filter((g): g is number => g != null && g >= 1 && g <= 4);
  return gs.length ? gradeLevel(Math.max(...gs)) : "UNKNOWN";
}

// ------------------------------------------------------------------ 응답 읽기

/** '35' → 35, '-'·''·null·'통신장애' → null. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** 에어코리아 JSON의 items. 오류 응답(resultCode ≠ '00')·모양이 다르면 null. items는 배열(가끔 {item: […]}). */
function itemsOf(json: unknown): Record<string, unknown>[] | null {
  const res = (json as { response?: { header?: { resultCode?: string }; body?: { items?: unknown } } })?.response;
  if (res?.header?.resultCode !== "00") return null;
  const items = res.body?.items;
  if (Array.isArray(items)) return items as Record<string, unknown>[];
  const inner = (items as { item?: unknown } | undefined)?.item;
  if (Array.isArray(inner)) return inner as Record<string, unknown>[];
  return items == null || items === "" ? [] : null;
}

/** 위도·경도 둘 중 어느 것인지 값 범위로 가린다 (한국: 위도 33~39, 경도 124~132). dmX·dmY 순서가 문서마다 달라서. */
function latLngOf(a: number | null, b: number | null): { lat: number; lng: number } | null {
  if (a == null || b == null) return null;
  const isLat = (v: number) => v >= 32 && v <= 40;
  const isLng = (v: number) => v >= 123 && v <= 133;
  if (isLat(a) && isLng(b)) return { lat: a, lng: b };
  if (isLng(a) && isLat(b)) return { lat: b, lng: a };
  return null;
}

/** 측정소 목록 응답 → 측정소들 ([sido]를 붙여서). 좌표 없는 곳은 뺀다. 오류면 null. */
export function parseStations(json: unknown, sido: string): AirStation[] | null {
  const items = itemsOf(json);
  if (!items) return null;
  const out: AirStation[] = [];
  for (const it of items) {
    const name = typeof it.stationName === "string" ? it.stationName.trim() : "";
    const at = latLngOf(num(it.dmX), num(it.dmY));
    if (!name || !at) continue;
    out.push({ name, sido, lat: at.lat, lng: at.lng, addr: typeof it.addr === "string" ? it.addr : "" });
  }
  return out;
}

/** 시도별 실시간 측정 응답 → 측정소 이름별 값. 오류면 null. */
export function parseRealtime(json: unknown): AirReading[] | null {
  const items = itemsOf(json);
  if (!items) return null;
  const out: AirReading[] = [];
  for (const it of items) {
    const station = typeof it.stationName === "string" ? it.stationName.trim() : "";
    if (!station) continue;
    const pm10 = num(it.pm10Value);
    const pm25 = num(it.pm25Value);
    const g10 = num(it.pm10Grade1h);
    const g25 = num(it.pm25Grade1h);
    out.push({
      station,
      pm10,
      pm25,
      pm10Grade: g10 != null && g10 >= 1 && g10 <= 4 ? g10 : pm10ToGrade(pm10),
      pm25Grade: g25 != null && g25 >= 1 && g25 <= 4 ? g25 : pm25ToGrade(pm25),
      dataTime: typeof it.dataTime === "string" ? it.dataTime : null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ 가까운 측정소

/** 두 점 사이 거리(km, 하버사인). */
export function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** [maxKm] 안의 측정소를 가까운 순서로. */
export function nearestStations(stations: AirStation[], lat: number, lng: number, maxKm = AIR_MAX_KM): AirStation[] {
  return stations
    .map((s) => ({ s, d: distKm(lat, lng, s.lat, s.lng) }))
    .filter((x) => x.d <= maxKm)
    .sort((a, b) => a.d - b.d || (a.s.name < b.s.name ? -1 : a.s.name > b.s.name ? 1 : 0))
    .map((x) => x.s);
}

/**
 * 가까운 측정소 중 등급을 알 수 있는 첫 곳 → 지금 미세먼지. [readings]는 그 측정소 시도의 실시간 값(시도 이름 → 값들).
 * 다 모르면 null.
 */
export function pickAir(near: AirStation[], readings: Map<string, AirReading[]>): AirNow | null {
  for (const s of near) {
    const r = readings.get(s.sido)?.find((x) => x.station === s.name);
    if (!r) continue;
    const level = airLevelOf(r);
    if (level === "UNKNOWN") continue;
    return { level, pm10: r.pm10, pm25: r.pm25, station: s.name, dataTime: r.dataTime };
  }
  return null;
}

// ------------------------------------------------------------------ 받아 오기

export function stationsUrl(key: string, addr: string): string {
  const q = new URLSearchParams({ returnType: "json", numOfRows: "1000", pageNo: "1", addr });
  return `${BASE}/MsrstnInfoInqireSvc/getMsrstnList?serviceKey=${serviceKeyParam(key)}&${q}`;
}

export function realtimeUrl(key: string, sido: string): string {
  const q = new URLSearchParams({ returnType: "json", numOfRows: "200", pageNo: "1", sidoName: sido, ver: "1.3" });
  return `${BASE}/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?serviceKey=${serviceKeyParam(key)}&${q}`;
}

/** JSON 받기. 1.5초 안에 안 오거나, 키가 틀려 XML이 오거나, resultCode ≠ '00'이면 null. */
async function getJson(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return null;
    const json = JSON.parse(await res.text());
    return itemsOf(json) ? json : null;
  } catch {
    return null;
  }
}

/** 한 시도의 측정소 목록 (주소 검색어를 차례로, 처음 나오는 비지 않은 목록). 실패면 null. */
export async function fetchStations(key: string, sido: { sido: string; addrs: string[] }, timeoutMs = 1500): Promise<AirStation[] | null> {
  for (const addr of sido.addrs) {
    const json = await getJson(stationsUrl(key, addr), timeoutMs);
    if (!json) return null;
    const list = parseStations(json, sido.sido);
    if (list && list.length > 0) return list;
  }
  return [];
}

/** 한 시도의 실시간 값. 실패면 null. */
export async function fetchRealtime(key: string, sido: string, timeoutMs = 1500): Promise<AirReading[] | null> {
  const json = await getJson(realtimeUrl(key, sido), timeoutMs);
  return json ? parseRealtime(json) : null;
}
