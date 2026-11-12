import { AIR_SIDOS, fetchRealtime, fetchStations, nearestStations, pickAir, type AirNow, type AirReading, type AirStation } from "./air";
import { sql } from "./db";
import type { SkyToday } from "./planner";
import { fetchKasi, riseSetFormula } from "./sun";
import { fetchVilageFcst, latLngToGrid, parseVilageFcst, type HourFcst } from "./weather";

/*
 * 오늘 하늘 = 해 시각(천문연 → 공식) + 날씨(기상청 → 모름) + 미세먼지(에어코리아 → 모름). 지역·날짜별로 sky_cache에 저장.
 * 공공데이터포털 키는 환경 변수 DATA_GO_KR_KEY 하나 (없으면 공식 + '날씨 모름'으로 계속 간다).
 */

export type SkyInfo = {
  sky: SkyToday;
  /** 해 시각 출처: 천문연(kasi) / 공식(formula). 날씨 출처: 기상청(kma) / 없음(none). */
  sunSource: "kasi" | "formula";
  weatherSource: "kma" | "none";
  /** 지금부터 시간별 강수 확률 (날씨를 알 때만). */
  hours: HourFcst[];
  /** 지금 미세먼지 (가까운 측정소). 모르면 null. 출처: 에어코리아(airkorea) / 없음(none). */
  air: AirNow | null;
  airSource: "airkorea" | "none";
};

const key = () => (process.env.DATA_GO_KR_KEY ?? "").trim();

/** 해 시각. 천문연 값은 0.1도 칸(약 10km)·하루 단위로 저장. */
async function sun(lat: number, lng: number, day: string): Promise<{ sunriseMin: number | null; sunsetMin: number | null; source: "kasi" | "formula" }> {
  const k = key();
  if (k) {
    const cLat = Math.round(lat * 10) / 10;
    const cLng = Math.round(lng * 10) / 10;
    const cell = `${cLat.toFixed(1)},${cLng.toFixed(1)}`;
    try {
      const [hit] = await sql<{ data: { sunriseMin: number; sunsetMin: number } }[]>`
        select data from sky_cache where cell = ${cell} and day = ${day} and kind = 'sun'`;
      if (hit) return { ...hit.data, source: "kasi" };
      const got = await fetchKasi(k, cLat, cLng, day);
      if (got) {
        await sql`
          insert into sky_cache (cell, day, kind, data, fetched_at) values (${cell}, ${day}, 'sun', ${sql.json(got)}, now())
          on conflict (cell, day, kind) do update set data = excluded.data, fetched_at = now()`;
        return { sunriseMin: got.sunriseMin, sunsetMin: got.sunsetMin, source: "kasi" };
      }
    } catch (e) {
      console.error("해 시각 저장소 실패", e);
    }
  }
  const f = riseSetFormula(lat, lng, day);
  return { sunriseMin: f?.sunriseMin ?? null, sunsetMin: f?.sunsetMin ?? null, source: "formula" };
}

/** 날씨. 기상청 격자(5km)·하루 단위로 저장하고 1시간 지나면 다시 받는다. 오늘 것만. */
async function weather(lat: number, lng: number, day: string, nowMin: number, isToday: boolean) {
  const k = key();
  if (!k || !isToday) return null;
  const { nx, ny } = latLngToGrid(lat, lng);
  const cell = `g${nx},${ny}`;
  try {
    const [hit] = await sql<{ data: unknown; fresh: boolean }[]>`
      select data, fetched_at > now() - interval '1 hour' as fresh from sky_cache where cell = ${cell} and day = ${day} and kind = 'weather'`;
    if (hit?.fresh) return parseVilageFcst(hit.data, day, nowMin);
    const json = await fetchVilageFcst(k, nx, ny, day, nowMin);
    if (json) {
      // 오늘 칸의 강수 확률·강수 형태·하늘만 남겨 저장
      const ymd = day.replaceAll("-", "");
      const res = json as { response: { body: { items: { item: { category: string; fcstDate: string }[] } } } };
      const items = res.response.body.items.item.filter((i) => i.fcstDate === ymd && ["POP", "PTY", "SKY", "TMP"].includes(i.category));
      const slim = { response: { header: { resultCode: "00" }, body: { items: { item: items } } } };
      await sql`
        insert into sky_cache (cell, day, kind, data, fetched_at) values (${cell}, ${day}, 'weather', ${sql.json(slim as never)}, now())
        on conflict (cell, day, kind) do update set data = excluded.data, fetched_at = now()`;
      return parseVilageFcst(slim, day, nowMin);
    }
    // 새로 못 받았으면 오래된 것이라도
    return hit ? parseVilageFcst(hit.data, day, nowMin) : null;
  } catch (e) {
    console.error("날씨 실패", e);
    return null;
  }
}

/** 측정소 목록이 바뀌는 일은 드물어 30일 저장. 날짜 칸은 고정값(시도마다 한 줄). */
const STATIONS_DAY = "2000-01-01";

/** 시도 하나의 측정소 목록 (30일 저장). 실패하면 오래된 것이라도, 그것도 없으면 []. */
async function stations(key: string, sido: (typeof AIR_SIDOS)[number]): Promise<AirStation[]> {
  const cell = `air-stations:${sido.sido}`;
  const [hit] = await sql<{ data: AirStation[]; fresh: boolean }[]>`
    select data, fetched_at > now() - interval '30 days' as fresh from sky_cache
    where cell = ${cell} and day = ${STATIONS_DAY} and kind = 'air-stations'`;
  if (hit?.fresh && hit.data.length > 0) return hit.data;
  const got = await fetchStations(key, sido);
  if (got && got.length > 0) {
    await sql`
      insert into sky_cache (cell, day, kind, data, fetched_at) values (${cell}, ${STATIONS_DAY}, 'air-stations', ${sql.json(got as never)}, now())
      on conflict (cell, day, kind) do update set data = excluded.data, fetched_at = now()`;
    return got;
  }
  return hit?.data ?? [];
}

/** 시도 하나의 실시간 값 (측정소마다, 1시간 저장). 실패하면 오래된 것이라도(오늘 것만), 없으면 null. */
async function readings(key: string, sido: string, day: string): Promise<AirReading[] | null> {
  const cell = `air:${sido}`;
  const [hit] = await sql<{ data: AirReading[]; fresh: boolean }[]>`
    select data, fetched_at > now() - interval '1 hour' as fresh from sky_cache where cell = ${cell} and day = ${day} and kind = 'air'`;
  if (hit?.fresh) return hit.data;
  const got = await fetchRealtime(key, sido);
  if (got) {
    await sql`
      insert into sky_cache (cell, day, kind, data, fetched_at) values (${cell}, ${day}, 'air', ${sql.json(got as never)}, now())
      on conflict (cell, day, kind) do update set data = excluded.data, fetched_at = now()`;
    return got;
  }
  return hit?.data ?? null;
}

/** 지금 미세먼지 — 가까운 측정소(30km 안)부터 값이 있는 곳. 키가 없거나·오늘이 아니거나·실패하면 null. */
async function air(lat: number, lng: number, day: string, isToday: boolean): Promise<AirNow | null> {
  const k = key();
  if (!k || !isToday) return null;
  try {
    const all = (await Promise.all(AIR_SIDOS.map((s) => stations(k, s)))).flat();
    const near = nearestStations(all, lat, lng);
    if (near.length === 0) return null;
    // 가까운 측정소가 있는 시도만 실시간 값을 받는다 (보통 하나)
    const sidos = [...new Set(near.slice(0, 3).map((s) => s.sido))];
    const got = await Promise.all(sidos.map(async (sd) => [sd, await readings(k, sd, day)] as const));
    const map = new Map<string, AirReading[]>();
    for (const [sd, r] of got) if (r) map.set(sd, r);
    return pickAir(near, map);
  } catch (e) {
    console.error("미세먼지 실패", e);
    return null;
  }
}

/** 오늘 하늘. 키가 없거나 늦으면 공식 + '날씨 모름' + '미세먼지 모름'. */
export async function skyToday(lat: number, lng: number, day: string, nowMin: number, isToday: boolean): Promise<SkyInfo> {
  const [s, w, a] = await Promise.all([sun(lat, lng, day), weather(lat, lng, day, nowMin, isToday), air(lat, lng, day, isToday)]);
  return {
    sky: {
      sunriseMin: s.sunriseMin, sunsetMin: s.sunsetMin, sky: w?.sky ?? "UNKNOWN", rainFromMin: w?.rainFromMin ?? null,
      air: a?.level ?? null, pm10: a?.pm10 ?? null, pm25: a?.pm25 ?? null,
      // 기온 (기상청 예보 TMP, 저녁 나들이 '쌀쌀함') — 모르면 null
      tempC: w?.tempC != null ? Math.round(w.tempC) : null,
    },
    sunSource: s.source,
    weatherSource: w ? "kma" : "none",
    hours: w?.hours ?? [],
    air: a,
    airSource: a ? "airkorea" : "none",
  };
}

/** 해 지는 시각(분) — 도장 희귀 '밤' 판정용. 천문연 저장분 → 공식. */
export async function sunsetAt(lat: number, lng: number, day: string): Promise<number | null> {
  return (await sun(lat, lng, day)).sunsetMin;
}

/** 지금(오늘 [nowMin]) 하늘만 — 도장 희귀 판정용. 키가 없거나 실패하면 UNKNOWN. */
export async function skyNow(lat: number, lng: number, day: string, nowMin: number): Promise<SkyToday["sky"]> {
  const w = await weather(lat, lng, day, nowMin, true);
  return w?.sky ?? "UNKNOWN";
}
