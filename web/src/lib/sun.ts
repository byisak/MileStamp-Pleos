/*
 * 해 뜨고 지는 시각.
 * 1) 한국천문연구원 출몰시각 정보(공공데이터포털 B090041 RiseSetInfoService getLCRiseSetInfo) — 키(DATA_GO_KR_KEY)가 있을 때
 * 2) 안 되면 천문 공식(NOAA) — 엔진 `engine/.../Sun.kt`를 그대로 옮긴 것. 오차 1~2분.
 * 이 파일은 DB를 모른다(시험하기 쉽게). 저장(sky_cache)은 `sky.ts`가 한다.
 * 시각은 모두 '그날 0시부터 분'(한국 시간).
 */

export type RiseSet = { sunriseMin: number; sunsetMin: number };

/** 한국 표준시 = UTC+9. */
export const KST_HOURS = 9.0;

const rad = (d: number) => d * 0.017453292519943295;
const deg = (r: number) => r * 57.29577951308232;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** 날짜 'YYYY-MM-DD' → 1970-01-01부터 날 수 (자바 LocalDate.toEpochDay와 같음). */
export function epochDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * 천문 공식(NOAA). 해가 뜨고 지는 순간 = 해 중심이 지평선 아래 0.833도(대기 굴절 + 해 반지름).
 * 백야·극야면 null.
 */
export function riseSetFormula(lat: number, lng: number, day: string, tzHours = KST_HOURS): RiseSet | null {
  // 그날 지역 정오의 율리우스일 → 율리우스 세기
  const jd = epochDay(day) + 2440587.5 + 0.5 - tzHours / 24.0;
  const t = (jd - 2451545.0) / 36525.0;

  const l0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032)); // 해의 평균 황경
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t); // 평균 근점 이각
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t); // 지구 궤도 이심률
  const mr = rad(m);
  const c = Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * mr) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega)); // 겉보기 황경
  const eps0 = 23.0 + (26.0 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.0) / 60.0;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega)); // 황도 경사
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))); // 해의 적위

  const y = Math.tan(rad(eps / 2)) ** 2;
  const l0r = rad(l0);
  const eqTimeMin = 4 * deg(
    y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) -
      0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr),
  );

  const latR = rad(lat);
  const cosHa = Math.cos(rad(90.833)) / (Math.cos(latR) * Math.cos(decl)) - Math.tan(latR) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) return null;
  const haMin = 4 * deg(Math.acos(cosHa));
  const noonMin = 720 - 4 * lng - eqTimeMin + tzHours * 60;
  return { sunriseMin: Math.round(noonMin - haMin), sunsetMin: Math.round(noonMin + haMin) };
}

// ------------------------------------------------------------------ 천문연 출몰시각 API

const KASI_URL = "https://apis.data.go.kr/B090041/openapi/service/RiseSetInfoService/getLCRiseSetInfo";

/** 공공데이터포털 키: '디코딩' 키면 주소용으로 바꾸고, 이미 '인코딩' 키(%가 있음)면 그대로. */
export function serviceKeyParam(key: string): string {
  return key.includes("%") ? key : encodeURIComponent(key);
}

/** 출몰시각 조회 주소. dnYn=Y = 위경도를 십진수(128.58)로 넘김. */
export function kasiUrl(key: string, lat: number, lng: number, day: string): string {
  const q = new URLSearchParams({ longitude: lng.toFixed(2), latitude: lat.toFixed(2), locdate: day.replaceAll("-", ""), dnYn: "Y" });
  return `${KASI_URL}?serviceKey=${serviceKeyParam(key)}&${q}`;
}

/** "0646  " → 406. 비었거나 이상하면 null. */
function hhmmCompact(v: string | undefined): number | null {
  const m = /^\s*(\d{2})(\d{2})\s*$/.exec(v ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

export type KasiSun = RiseSet & { civilDawnMin: number | null; civilDuskMin: number | null };

/**
 * 출몰시각 응답(XML) 읽기. 정상(resultCode 00)이고 해 뜸·짐이 있으면 값, 아니면 null.
 * 키 오류는 <OpenAPI_ServiceResponse>…<returnAuthMsg>로 오는데 resultCode가 없어 null.
 */
export function parseKasi(xml: string): KasiSun | null {
  const tag = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
  if (tag("resultCode") !== "00") return null;
  const sunriseMin = hhmmCompact(tag("sunrise"));
  const sunsetMin = hhmmCompact(tag("sunset"));
  if (sunriseMin == null || sunsetMin == null || sunsetMin <= sunriseMin) return null;
  return { sunriseMin, sunsetMin, civilDawnMin: hhmmCompact(tag("civilm")), civilDuskMin: hhmmCompact(tag("civile")) };
}

/** 천문연 API로 해 시각. 1.5초 안에 안 오거나 실패하면 null (부르는 쪽이 공식으로 대신). */
export async function fetchKasi(key: string, lat: number, lng: number, day: string, timeoutMs = 1500): Promise<KasiSun | null> {
  try {
    const res = await fetch(kasiUrl(key, lat, lng, day), { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return null;
    return parseKasi(await res.text());
  } catch {
    return null;
  }
}
