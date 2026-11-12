import { sql } from "./db";
import { kstToday } from "./festival-shape";
import { cachedTour } from "./tourapi";
import type { LatLng } from "./planner";
import type { OptionJson } from "./plan";
import {
  dedupePts, departFor, directionsQuery, estimateRoute, expandLegs, optionPts, parseDirections, retimeOption, routeKey, withTotal,
  type RouteResult,
} from "./route-shape";

/*
 * 실제 길 · 교통 반영 시간 — 카카오모빌리티 길찾기 부르기 + 저장 + 하루 한도.
 * - 키: KAKAO_REST_KEY (카카오 로컬과 같은 서버 전용 키 — 답·로그에 절대 싣지 않는다). 헤더 'Authorization: KakaoAK <키>'
 * - 지금 교통: GET https://apis-navi.kakaomobility.com/v1/directions · 그날 예상: /v1/future/directions?departure_time=YYYYMMDDHHmm(한국 시간)
 * - 저장: tour_cache 'route:l:<10분 칸>:<점들>'(10분) · 'route:f:<출발 시각>:<점들>'(6시간). 점은 소수 셋째 자리(약 100m)
 * - 한도: tour_cache 'route-quota:<한국 날짜>'에 부른 횟수, ROUTE_DAILY_LIMIT(기본 8000 — 무료 하루 10,000) 넘으면 어림
 * - 키 없음·한도·실패 → 어림(엔진 TravelTime과 같은 값, source 'estimate'). 로컬 시험은 KAKAO_ROUTE_MOCK=1(키 없을 때 가짜 길)
 */

const BASE = "https://apis-navi.kakaomobility.com";
const TIMEOUT_MS = 3500;
const DEFAULT_LIMIT = 8000;

class RouteUnavailable extends Error {}

const routeKeyEnv = () => process.env.KAKAO_REST_KEY || null;

async function takeQuota(): Promise<void> {
  const limit = Number(process.env.ROUTE_DAILY_LIMIT) || DEFAULT_LIMIT;
  const key = `route-quota:${kstToday()}`;
  const [r] = await sql<{ n: number }[]>`
    insert into tour_cache (key, data, fetched_at) values (${key}, ${sql.json({ n: 1 })}, now())
    on conflict (key) do update set data = jsonb_build_object('n', coalesce((tour_cache.data->>'n')::int, 0) + 1), fetched_at = now()
    returning (data->>'n')::int as n`;
  if (r.n > limit) throw new RouteUnavailable("오늘 길찾기 한도를 다 썼어요");
}

/** 가짜 길 (KAKAO_ROUTE_MOCK=1, 키 없을 때): 어림 시간 × 1.15, 선은 꺾인 길 모양 — 화면 시험용 */
function mockDirections(pts: LatLng[]): unknown {
  const sections = pts.slice(1).map((b, i) => {
    const a = pts[i];
    const kmRoad = Math.hypot((b.lat - a.lat) * 111, (b.lng - a.lng) * 90) * 1.3;
    const v: number[] = [];
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      // 먼저 경도 쪽으로 더 가고 뒤에 위도 쪽으로 — 직선과 다르게 보이게 살짝 꺾음
      const tx = Math.min(1, t * 1.6), ty = Math.max(0, (t - 0.25) / 0.75);
      v.push(a.lng + (b.lng - a.lng) * tx + Math.sin(t * 9) * 0.0015, a.lat + (b.lat - a.lat) * ty);
    }
    return { distance: Math.round(kmRoad * 1000), duration: Math.round((kmRoad / 50) * 3600 * 1.15), roads: [{ vertexes: v }] };
  });
  return { routes: [{ result_code: 0, result_msg: "mock", sections }] };
}

async function directionsCall(pts: LatLng[], depart: string | null): Promise<unknown> {
  const key = routeKeyEnv();
  if (!key && process.env.KAKAO_ROUTE_MOCK === "1") return mockDirections(pts);
  if (!key) throw new RouteUnavailable("길찾기 키가 없어요");
  await takeQuota();
  const path = depart ? "/v1/future/directions" : "/v1/directions";
  const res = await fetch(`${BASE}${path}?${directionsQuery(pts, depart)}`, {
    headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
  });
  if (!res.ok) throw new RouteUnavailable(`길찾기 오류 (${res.status})`);
  return res.json();
}

/**
 * 점들(출발 → 경유 ≤5 → 도착)의 실제 길. depart('YYYYMMDDHHmm', 한국 시간)가 있으면 그날 예상 교통.
 * 실패해도 throw하지 않고 어림을 돌려준다.
 */
export async function routeFor(pts: LatLng[], depart: string | null = null): Promise<RouteResult> {
  if (pts.length < 2) return estimateRoute(pts);
  const { call, keep } = dedupePts(pts);
  if (call.length < 2) return estimateRoute(pts);
  try {
    const got = await cachedTour(routeKey(call, depart, Date.now()), depart ? 6 * 60 : 10, async () => {
      const r = parseDirections(await directionsCall(call, depart), call.length - 1);
      if (!r) throw new RouteUnavailable("길찾기 답을 읽지 못했어요");
      return r;
    });
    const { legs, polyline } = expandLegs(pts, keep, got.data);
    return withTotal(depart ? "future" : "live", legs, polyline);
  } catch {
    return estimateRoute(pts);
  }
}

/**
 * 폰에 보낼 카드(≤3장)를 실제 길로 다시 잰다 — 엔진이 고른 카드·저장된 계획은 그대로, 답에만 반영.
 * 곳이 없는 카드(바로 집으로)는 지금 위치가 집과 떨어져 있을 때만. 카드끼리 동시에 부른다.
 */
export async function retimeForPhone(
  options: OptionJson[], ctx: { day: string; here: LatLng; home: LatLng; backByMin: number | null },
): Promise<OptionJson[]> {
  return Promise.all(options.map(async (o) => {
    if (!o.legs?.length) return o;
    const pts = optionPts(o, ctx.here, ctx.home);
    const r = await routeFor(pts, departFor(ctx.day, o.legs[0].fromMin));
    return retimeOption(o, r, ctx.backByMin);
  }));
}
