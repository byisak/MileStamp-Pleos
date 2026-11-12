/*
 * 날씨 — 기상청 단기예보 조회서비스(공공데이터포털 VilageFcstInfoService_2.0 getVilageFcst).
 * 키(DATA_GO_KR_KEY)가 없거나 실패하면 '날씨 모름'(UNKNOWN)으로 계속 간다.
 * 이 파일은 DB를 모른다(시험하기 쉽게). 1시간 저장(sky_cache)은 `sky.ts`가 한다.
 * 시각은 모두 '그날 0시부터 분'(한국 시간).
 */
import type { Sky } from "./planner";
import { serviceKeyParam } from "./sun";

// ------------------------------------------------------------------ 위경도 → 예보 격자 (기상청 람베르트 투영, 5km)

/** 기상청 동네예보 격자 변환 (기상청이 배포한 C 코드와 같은 식). */
export function latLngToGrid(lat: number, lng: number): { nx: number; ny: number } {
  const RE = 6371.00877; // 지구 반경(km)
  const GRID = 5.0; // 격자 간격(km)
  const SLAT1 = 30.0; // 표준 위도 1
  const SLAT2 = 60.0; // 표준 위도 2
  const OLON = 126.0; // 기준점 경도
  const OLAT = 38.0; // 기준점 위도
  const XO = 43; // 기준점 X 격자
  const YO = 136; // 기준점 Y 격자
  const DEGRAD = Math.PI / 180.0;

  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

// ------------------------------------------------------------------ 발표 시각

/** 단기예보 발표 시각(하루 8번). 발표 10분 뒤부터 받을 수 있다. */
const BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
const READY_AFTER_MIN = 10;

/** 'YYYY-MM-DD' 하루 전. */
function prevDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86400000).toISOString().slice(0, 10);
}

/** 지금(한국 시간 날짜·분)에 받을 수 있는 가장 최근 발표. 02:10 전이면 어제 23시 발표. */
export function baseTimeFor(day: string, nowMin: number): { baseDate: string; baseTime: string } {
  const ready = BASE_HOURS.filter((h) => h * 60 + READY_AFTER_MIN <= nowMin);
  const h = ready.length > 0 ? ready[ready.length - 1] : 23;
  const date = ready.length > 0 ? day : prevDay(day);
  return { baseDate: date.replaceAll("-", ""), baseTime: `${String(h).padStart(2, "0")}00` };
}

// ------------------------------------------------------------------ 응답 읽기

/** 한 시간 칸. pop = 강수 확률(%), pty = 강수 형태(0 없음 1 비 2 비/눈 3 눈 4 소나기), sky = 하늘(1 맑음 3 구름 많음 4 흐림). */
export type HourFcst = { min: number; pop: number | null; pty: number | null; sky: number | null; /** 기온(℃, TMP) — 받았을 때만 */ tmp?: number };

export type Weather = {
  /** 지금 하늘. 비·눈이 오면 RAIN·SNOW, 맑음·구름 많음은 CLEAR, 흐림은 UNKNOWN(맑다고 하지 않음). */
  sky: Sky;
  /** 오늘 비(또는 눈)가 시작되는 시각. 지금 오고 있으면 지금 칸. 없으면 null. */
  rainFromMin: number | null;
  /** 오늘 지금 칸부터 시간별 예보. */
  hours: HourFcst[];
  /** 지금 칸 기온(℃, TMP). 예보에 없으면 칸 없음 — 저녁 나들이 '쌀쌀함'에 쓴다. */
  tempC?: number;
};

/** 강수 확률이 이만큼이면 비 오는 시간으로 친다. */
export const RAIN_POP = 60;

type FcstItem = { category: string; fcstDate: string; fcstTime: string; fcstValue: string };

const wet = (h: HourFcst) => (h.pty != null && h.pty > 0) || (h.pop != null && h.pop >= RAIN_POP);

/**
 * 단기예보 응답(JSON) → 오늘 날씨. 오류 응답·빈 응답이면 null.
 * 키가 틀리면 XML(<OpenAPI_ServiceResponse>)이 오므로 부르는 쪽에서 JSON 읽기 실패 → null.
 */
export function parseVilageFcst(json: unknown, day: string, nowMin: number): Weather | null {
  const res = (json as { response?: { header?: { resultCode?: string }; body?: { items?: { item?: FcstItem[] } } } })?.response;
  if (res?.header?.resultCode !== "00") return null;
  const items = res.body?.items?.item ?? [];
  const ymd = day.replaceAll("-", "");

  const byTime = new Map<number, HourFcst>();
  for (const it of items) {
    if (it.fcstDate !== ymd || !/^\d{4}$/.test(it.fcstTime)) continue;
    const min = Number(it.fcstTime.slice(0, 2)) * 60 + Number(it.fcstTime.slice(2));
    const h = byTime.get(min) ?? { min, pop: null, pty: null, sky: null };
    const v = Number(it.fcstValue);
    if (Number.isFinite(v)) {
      if (it.category === "POP") h.pop = v;
      else if (it.category === "PTY") h.pty = v;
      else if (it.category === "SKY") h.sky = v;
      else if (it.category === "TMP") h.tmp = v;
    }
    byTime.set(min, h);
  }
  const all = [...byTime.values()].sort((a, b) => a.min - b.min);
  // 지금 칸 = 지금 이전의 마지막 칸, 없으면(예보가 다음 시간부터) 첫 칸
  const nowSlot = [...all].reverse().find((h) => h.min <= nowMin) ?? all[0];
  if (!nowSlot) return null;
  const hours = all.filter((h) => h.min >= nowSlot.min);

  let sky: Sky = "UNKNOWN";
  if (nowSlot.pty === 3) sky = "SNOW";
  else if (nowSlot.pty != null && nowSlot.pty > 0) sky = "RAIN";
  else if (nowSlot.sky === 1 || nowSlot.sky === 3) sky = "CLEAR";
  const firstWet = hours.find(wet);
  return { sky, rainFromMin: firstWet ? firstWet.min : null, hours, ...(nowSlot.tmp != null ? { tempC: nowSlot.tmp } : {}) };
}

const VILAGE_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";

export function vilageUrl(key: string, nx: number, ny: number, base: { baseDate: string; baseTime: string }): string {
  const q = new URLSearchParams({
    pageNo: "1", numOfRows: "1000", dataType: "JSON",
    base_date: base.baseDate, base_time: base.baseTime, nx: String(nx), ny: String(ny),
  });
  return `${VILAGE_URL}?serviceKey=${serviceKeyParam(key)}&${q}`;
}

/** 기상청 단기예보 원문(JSON)을 받아 온다. 1.5초 안에 안 오거나 실패하면 null. */
export async function fetchVilageFcst(
  key: string, nx: number, ny: number, day: string, nowMin: number, timeoutMs = 1500,
): Promise<unknown | null> {
  try {
    const res = await fetch(vilageUrl(key, nx, ny, baseTimeFor(day, nowMin)), { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return null;
    const json = JSON.parse(await res.text());
    return json?.response?.header?.resultCode === "00" ? json : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ 초단기실황 (지금 기온·강수, 폰 머리 온도 칩)

/**
 * 기상청 초단기실황(getUltraSrtNcst) — 매시 정각 관측, 40분쯤부터 받을 수 있다.
 * 지금 분이 40 전이면 한 시간 전 것. 00:40 전이면 어제 23시.
 */
const NCST_READY_MIN = 40;

export function ncstBaseFor(day: string, nowMin: number): { baseDate: string; baseTime: string } {
  let h = Math.floor(nowMin / 60);
  if (nowMin % 60 < NCST_READY_MIN) h -= 1;
  const date = h < 0 ? prevDay(day) : day;
  if (h < 0) h = 23;
  return { baseDate: date.replaceAll("-", ""), baseTime: `${String(h).padStart(2, "0")}00` };
}

/** 지금 하늘(강수 형태 기준). 'clear'는 '비·눈 없음'(구름 양은 실황에 없어서 모름). */
export type NowSky = "clear" | "rain" | "snow" | "sleet" | "drizzle";

export type SkyNow = {
  /** 기온(°C, 소수 첫째 자리) */
  tempC: number;
  sky: NowSky;
  /** 관측 시각 (ISO, 한국 시간 +09:00) */
  at: string;
};

/** 실황 PTY: 0 없음 · 1 비 · 2 비/눈 · 3 눈 · 5 빗방울 · 6 빗방울눈날림 · 7 눈날림 (4 소나기는 예보 값이지만 비로) */
export function ptyToSky(pty: number): NowSky {
  switch (pty) {
    case 1: case 4: return "rain";
    case 2: case 6: return "sleet";
    case 3: case 7: return "snow";
    case 5: return "drizzle";
    default: return "clear";
  }
}

type NcstItem = { baseDate: string; baseTime: string; category: string; obsrValue: string };

/** 초단기실황 응답(JSON) → 지금 기온·강수. 오류·기온 없음·말이 안 되는 값이면 null. */
export function parseUltraSrtNcst(json: unknown): SkyNow | null {
  const res = (json as { response?: { header?: { resultCode?: string }; body?: { items?: { item?: NcstItem[] } } } })?.response;
  if (res?.header?.resultCode !== "00") return null;
  const items = res.body?.items?.item ?? [];
  const get = (c: string) => {
    const it = items.find((i) => i.category === c);
    const v = it ? Number(it.obsrValue) : NaN;
    return Number.isFinite(v) && v > -900 ? v : null; // 결측은 -998.9 같은 값
  };
  const t = get("T1H");
  if (t == null || t < -50 || t > 50) return null;
  const pty = get("PTY") ?? 0;
  const first = items.find((i) => i.category === "T1H")!;
  const d = first.baseDate, hm = first.baseTime;
  const at = /^\d{8}$/.test(d) && /^\d{4}$/.test(hm)
    ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${hm.slice(0, 2)}:${hm.slice(2)}:00+09:00`
    : new Date().toISOString();
  return { tempC: Math.round(t * 10) / 10, sky: ptyToSky(pty), at };
}

const NCST_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";

export function ncstUrl(key: string, nx: number, ny: number, base: { baseDate: string; baseTime: string }): string {
  const q = new URLSearchParams({
    pageNo: "1", numOfRows: "20", dataType: "JSON",
    base_date: base.baseDate, base_time: base.baseTime, nx: String(nx), ny: String(ny),
  });
  return `${NCST_URL}?serviceKey=${serviceKeyParam(key)}&${q}`;
}

/** 초단기실황 받기 → 읽은 값. 1.5초 안에 안 오거나 실패하면 null. */
export async function fetchUltraSrtNcst(
  key: string, nx: number, ny: number, day: string, nowMin: number, timeoutMs = 1500,
): Promise<SkyNow | null> {
  try {
    const res = await fetch(ncstUrl(key, nx, ny, ncstBaseFor(day, nowMin)), { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return null;
    return parseUltraSrtNcst(JSON.parse(await res.text()));
  } catch {
    return null;
  }
}
