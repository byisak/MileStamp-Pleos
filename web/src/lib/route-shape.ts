/*
 * 실제 길 · 교통 반영 시간 (카카오모빌리티 길찾기) — 부르지 않는 순수 함수만 (시험: route.test.ts).
 * - 카카오 답 읽기 (parseDirections), 선 줄이기 (simplify, 더글라스-포이커), 저장 키 (routeKey),
 *   계획 카드 다시 재기 (retimeOption: 구간 이동 시간만 바꾸고 머무름은 그대로, 귀가 시각 다시 계산).
 * - 엔진(Kotlin·TS planner)은 건드리지 않는다. 엔진이 직선 어림으로 고른 카드 ≤3장을 폰에 보내기 직전에만 다시 잰다.
 */
import { parseAt } from "./kst";
import { asHhmm, km, TravelTime, type LatLng } from "./planner";
import type { OptionJson } from "./plan";

/** live = 지금 교통 · future = 그날 출발 시각의 예상 교통 · estimate = 직선 어림(엔진과 같은 값) */
export type RouteSource = "live" | "future" | "estimate";
export type RouteLeg = { durMin: number; distKm: number };
/** 선 = 구간마다 [위도, 경도] 목록 (지도 embed 모양 그대로) */
export type RouteResult = { source: RouteSource; legs: RouteLeg[]; total: RouteLeg; polyline: [number, number][][] };

/** 구간 하나에 남길 점 수 상한 */
export const MAX_LEG_POINTS = 200;
/** 이보다 가까운 두 점은 같은 곳으로 본다 (카카오는 5m 안이면 오류) */
const SAME_KM = 0.05;

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const sumLegs = (legs: RouteLeg[]): RouteLeg => ({
  durMin: legs.reduce((s, l) => s + l.durMin, 0),
  distKm: round(legs.reduce((s, l) => s + l.distKm, 0), 1),
});

/** 한국 안 좌표인지 (대충의 상자) */
export const inKorea = (p: LatLng) => p.lat > 32.5 && p.lat < 39 && p.lng > 124 && p.lng < 132;

/** 'lng,lat;lng,lat;…' (카카오와 같은 경도 먼저) → 점들. 2~7점(출발·경유 ≤5·도착), 한국 밖이면 null */
export function parsePts(text: string | null): LatLng[] | null {
  if (!text) return null;
  const parts = text.split(";").filter(Boolean);
  if (parts.length < 2 || parts.length > 7) return null;
  const out: LatLng[] = [];
  for (const s of parts) {
    const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(s.trim());
    if (!m) return null;
    const p = { lat: Number(m[2]), lng: Number(m[1]) };
    if (!inKorea(p)) return null;
    out.push(p);
  }
  return out;
}

/** 'YYYYMMDDHHmm' (한국 시간) 맞는지 */
export const isDepart = (s: string | null): s is string => !!s && /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])[0-5]\d$/.test(s);

/** 날짜 'YYYY-MM-DD' + 그날 분 → 'YYYYMMDDHHmm' (10분 단위로 내림, 24시를 넘으면 23:50) */
export function departOf(day: string, min: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 50, Math.floor(min / 10) * 10));
  return `${day.replace(/-/g, "")}${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
}

/** 출발이 지금보다 이만큼 넘게 뒤면 그날 예상 교통으로 */
const FUTURE_AFTER_MIN = 20;

/** 그날 출발 시각(분)이 지금보다 충분히 뒤면 'YYYYMMDDHHmm', 아니면 null(지금 교통) */
export function departFor(day: string, departMin: number, now = new Date()): string | null {
  const at = parseAt(`${day}T00:00`);
  if (!at) return null;
  const ms = at.getTime() + departMin * 60_000;
  return ms - now.getTime() > FUTURE_AFTER_MIN * 60_000 ? departOf(day, departMin) : null;
}

/**
 * 저장 키: 'route:' + 점들(소수 셋째 자리 ≈ 100m) + 시간 칸.
 * live는 10분 칸(지금 시각), future는 출발 시각(10분 단위로 이미 내림) — 같은 칸이면 같은 답을 쓴다.
 */
export function routeKey(pts: LatLng[], depart: string | null, nowMs: number): string {
  const p = pts.map((x) => `${x.lng.toFixed(3)},${x.lat.toFixed(3)}`).join(";");
  return depart ? `route:f:${depart.slice(0, 11)}:${p}` : `route:l:${Math.floor(nowMs / 600_000)}:${p}`;
}

/** 카카오에 보낼 점: 붙어 있는 같은 곳(50m 안)은 하나로. keep[i] = 원래 i번째 구간이 실제로 부를 구간인지 */
export function dedupePts(pts: LatLng[]): { call: LatLng[]; keep: boolean[] } {
  const call: LatLng[] = [pts[0]];
  const keep: boolean[] = [];
  for (let i = 1; i < pts.length; i++) {
    const same = km(call[call.length - 1], pts[i]) < SAME_KM;
    keep.push(!same);
    if (!same) call.push(pts[i]);
  }
  return { call, keep };
}

/** 카카오 쿼리 (origin·destination·waypoints는 '경도,위도') */
export function directionsQuery(pts: LatLng[], depart: string | null): URLSearchParams {
  const f = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
  const q = new URLSearchParams({ origin: f(pts[0]), destination: f(pts[pts.length - 1]), priority: "RECOMMEND", summary: "false" });
  if (pts.length > 2) q.set("waypoints", pts.slice(1, -1).map(f).join("|"));
  if (depart) q.set("departure_time", depart);
  return q;
}

// ------------------------------------------------------------------ 선 줄이기

/** 점들을 미터 평면으로 (짧은 거리라 등장방형으로 충분) */
function toXY(pts: [number, number][]): [number, number][] {
  const lat0 = (pts[0]?.[0] ?? 36) * Math.PI / 180;
  const kx = 111_320 * Math.cos(lat0), ky = 110_540;
  return pts.map(([la, ln]) => [ln * kx, la * ky]);
}

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}

/** 더글라스-포이커 (재귀 대신 쌓기) — eps 미터 */
function dp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length <= 2) return pts.slice();
  const xy = toXY(pts);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1, bi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(xy[i], xy[s], xy[e]);
      if (d > best) { best = d; bi = i; }
    }
    if (bi > 0 && best > eps) {
      keep[bi] = 1;
      stack.push([s, bi], [bi, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 선 하나를 [max]점 안으로 (처음 15m로 줄이고, 넘치면 기준을 두 배씩). 좌표는 소수 다섯째 자리 */
export function simplify(pts: [number, number][], max = MAX_LEG_POINTS): [number, number][] {
  let eps = 15;
  let out = dp(pts, eps);
  while (out.length > max && eps < 50_000) { eps *= 2; out = dp(pts, eps); }
  return out.map(([la, ln]) => [round(la, 5), round(ln, 5)]);
}

// ------------------------------------------------------------------ 카카오 답 읽기

/**
 * 카카오 길찾기 답 → 구간들(분·km) + 선. routes[0].result_code가 0이 아니거나 구간 수가 [legs]와 다르면 null.
 * sections[i].roads[].vertexes = [경도, 위도, 경도, 위도 …]
 */
export function parseDirections(json: unknown, legs: number): { legs: RouteLeg[]; polyline: [number, number][][] } | null {
  const r = (json as { routes?: unknown[] } | null)?.routes?.[0] as
    | { result_code?: number; sections?: { duration?: number; distance?: number; roads?: { vertexes?: number[] }[] }[] }
    | undefined;
  if (!r || r.result_code !== 0 || !Array.isArray(r.sections) || r.sections.length !== legs) return null;
  const out: RouteLeg[] = [];
  const lines: [number, number][][] = [];
  for (const s of r.sections) {
    if (typeof s.duration !== "number" || typeof s.distance !== "number") return null;
    out.push({ durMin: Math.max(1, Math.round(s.duration / 60)), distKm: round(s.distance / 1000, 1) });
    const line: [number, number][] = [];
    for (const road of s.roads ?? []) {
      const v = road.vertexes ?? [];
      for (let i = 0; i + 1 < v.length; i += 2) {
        const p: [number, number] = [v[i + 1], v[i]];
        const last = line[line.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) line.push(p);
      }
    }
    lines.push(simplify(line));
  }
  return { legs: out, polyline: lines };
}

/** 카카오가 부른 구간(같은 곳 뺀 것)을 원래 구간 순서로 펴기 — 같은 곳 구간은 0분·0km·두 점 선 */
export function expandLegs(pts: LatLng[], keep: boolean[], got: { legs: RouteLeg[]; polyline: [number, number][][] }) {
  const legs: RouteLeg[] = [];
  const polyline: [number, number][][] = [];
  let j = 0;
  keep.forEach((k, i) => {
    if (k) { legs.push(got.legs[j]); polyline.push(got.polyline[j]); j++; }
    else { legs.push({ durMin: 0, distKm: 0 }); polyline.push([[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]]); }
  });
  return { legs, polyline };
}

/** 직선 어림 (엔진 TravelTime과 같은 값) — 키 없음·한도·실패 때 */
export function estimateRoute(pts: LatLng[]): RouteResult {
  const legs: RouteLeg[] = [];
  const polyline: [number, number][][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    legs.push({ durMin: TravelTime.minutes(pts[i], pts[i + 1]), distKm: round(TravelTime.roadKm(pts[i], pts[i + 1]), 1) });
    polyline.push([[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]]);
  }
  return { source: "estimate", legs, total: sumLegs(legs), polyline };
}

export const withTotal = (source: RouteSource, legs: RouteLeg[], polyline: [number, number][][]): RouteResult =>
  ({ source, legs, total: sumLegs(legs), polyline });

// ------------------------------------------------------------------ 계획 카드 다시 재기

/** 카드에 붙는 실제 길 정보 (폰: 지도 선·'실시간 교통 반영' 글) */
export type OptionRoute = {
  source: RouteSource;
  /** 실제 길로 잰 집 도착 시각 (그날 분) */
  homeMin: number;
  /** 이동만 더한 분 · km */
  driveMin: number;
  distKm: number;
  legs: RouteLeg[];
  polyline?: [number, number][][];
};

/** 카드의 길 점: 출발 → 곳들 → 집 */
export function optionPts(o: OptionJson, here: LatLng, home: LatLng): LatLng[] {
  return [here, ...o.stops.map((s) => ({ lat: s.lat, lng: s.lng })), home];
}

const isDrive = (k: string) => k === "DRIVE" || k === "NAP_DRIVE" || k === "HOME";

/**
 * 카드 하나를 실제 길 시간으로 다시 잰다 — 이동 칸 길이만 바꾸고 머무름 칸 길이(머무름·문 열기 기다림)는 계획 그대로,
 * 시각은 출발부터 차례로 다시 민다. 집 도착이 귀가 한계를 넘으면 맨 앞 이유 '실제 길로는 귀가 한계를 ○분 넘어요' + overLimit.
 * 이동 칸 수가 길 구간 수와 다르면(예전 모양) 그대로 두고 route만 붙이지 않는다.
 * 이유 칩 중 시각·분이 든 것(낮잠 전 귀가 · 10:40 / 가까워요 · 첫 이동 12분 / 해 지기 1시간 전 귀가 …)도 새 값으로.
 */
export function retimeOption(o: OptionJson, r: RouteResult, backByMin: number | null): OptionJson {
  const drives = o.legs.filter((l) => isDrive(l.kind)).length;
  if (!o.legs.length || drives !== r.legs.length) return o;
  if (r.source === "estimate") {
    return { ...o, route: { source: "estimate", homeMin: o.arriveHomeMin, driveMin: r.total.durMin, distKm: r.total.distKm, legs: r.legs } };
  }
  let t = o.legs[0].fromMin;
  let d = 0;
  const legs = o.legs.map((l) => {
    const len = isDrive(l.kind) ? r.legs[d++].durMin : l.toMin - l.fromMin;
    const n = { ...l, fromMin: t, toMin: t + len };
    t += len;
    return n;
  });
  const oldHome = o.arriveHomeMin;
  const home = legs[legs.length - 1].toMin;
  const firstLeg = r.legs[0].durMin;
  const napLeg = legs.find((l) => l.kind === "NAP_DRIVE");
  const reasons = o.reasons.flatMap((x) => {
    let text = x.text;
    text = text.replace(asHhmm(oldHome), asHhmm(home));
    text = text.replace(/첫 이동 \d+분/, `첫 이동 ${firstLeg}분`);
    if (napLeg) text = text.replace(/차에서 \d+분/, `차에서 ${napLeg.toMin - napLeg.fromMin}분`);
    const sun = /^해 지기 (?:(\d+)시간)?\s?(?:(\d+)분)?\s?전 귀가$/.exec(text);
    if (sun) {
      const left = Number(sun[1] ?? 0) * 60 + Number(sun[2] ?? 0) - (home - oldHome);
      if (left <= 0) return [];
      text = `해 지기 ${left < 60 ? `${left}분` : left % 60 === 0 ? `${left / 60}시간` : `${Math.floor(left / 60)}시간 ${left % 60}분`} 전 귀가`;
    }
    return [{ ...x, text }];
  });
  const out: OptionJson = {
    ...o,
    legs,
    firstLegMin: firstLeg,
    arriveHomeMin: home,
    arriveHome: asHhmm(home),
    reasons,
    route: { source: r.source, homeMin: home, driveMin: r.total.durMin, distKm: r.total.distKm, legs: r.legs, polyline: r.polyline },
  };
  if (backByMin != null && o.stops.length && home > backByMin && !o.overLimit) {
    out.overLimit = true;
    out.reasons = [{ text: `실제 길로는 귀가 한계를 ${home - backByMin}분 넘어요`, tone: "PLAIN" }, ...reasons];
  }
  return out;
}
