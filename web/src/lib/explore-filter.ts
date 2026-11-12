/*
 * 고르기 탭 2차 (docs/고르기-2차-계획.html 4·5·6절): 거리 칩(maxMin) · 시·도(regions) · '인기' 정렬.
 * DB·네트워크 없이. 시험은 explore-filter.test.ts. 인기 숫자를 모으는 쪽은 explore-popularity.ts.
 */
import type { ExploreItem } from "./explore-shape";
import { normRegionCode, regionOf, type RegionCode } from "./explore-region";

/** 거리 칩: 1·2·3시간 (없으면 거리 제한 없음 = 전국). */
export const MAX_MIN_CHOICES = [60, 120, 180] as const;
/** '12가족이 골랐어요'는 이 수 이상일 때만 보이고, 이보다 적으면 인기 순위에도 넣지 않는다(주인 결정 10/28). */
export const POPULAR_MIN_FAMILIES = 3;

/**
 * 요청 → 거리 제한(분). maxMin=60|120|180이 먼저. 없으면 옛 앱(0.4.0)의 scope: near = 120 · all = 제한 없음.
 * 둘 다 없으면 제한 없음. 이상한 값은 null(제한 없음).
 */
export function parseMaxMin(q: URLSearchParams): number | null {
  const raw = q.get("maxMin");
  if (raw != null && raw !== "") {
    const n = Number(raw);
    return (MAX_MIN_CHOICES as readonly number[]).includes(n) ? n : null;
  }
  return q.get("scope") === "near" ? 120 : null;
}

/** 'regions=27,47' → ['27','47'] (모르는 코드는 버림, 같은 것 한 번). 비면 [] = 전국. */
export function parseRegions(v: string | null): RegionCode[] {
  if (!v) return [];
  const out: RegionCode[] = [];
  for (const s of v.split(/[,\s]+/)) {
    const c = normRegionCode(s);
    if (c && s.trim().length === 2 && !out.includes(c)) out.push(c);
  }
  return out;
}

export type ExploreSort = "default" | "popular" | "distance";
/** sort=popular(인기) · distance(기준 위치에서 차로 가까운 순, docs/검색-거리순-계획.md ①) · 그 밖 = 기본 순서 */
export const parseSort = (v: string | null): ExploreSort => (v === "popular" || v === "distance" ? v : "default");

/** '거리순': 기준에서 차로 가까운 순 → 이름 (기준을 몰라 driveMin이 없으면 맨 뒤). 우리 도장도 거리대로. */
export function sortDistance(items: ExploreItem[]): ExploreItem[] {
  return [...items].sort((a, b) =>
    (a.driveMin ?? Number.MAX_SAFE_INTEGER) - (b.driveMin ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, "ko"));
}

/** 줄마다 시·도 코드 채우기 (이미 있으면 그대로). */
export function withRegions(items: ExploreItem[]): ExploreItem[] {
  return items.map((x) => (normRegionCode(x.region) ? x : { ...x, region: regionOf({ region: x.region, addr: x.addr, lat: x.lat, lng: x.lng }) }));
}

/** 차로 [maxMin]분 안만 (null이면 다). 집을 몰라 driveMin이 null이면 거르지 않는다(목록이 비지 않게). */
export function withinMin(items: ExploreItem[], maxMin: number | null): ExploreItem[] {
  return maxMin == null ? items : items.filter((x) => x.driveMin == null || x.driveMin <= maxMin);
}

/** 고른 시·도만 ([]이면 다). */
export function inRegions(items: ExploreItem[], regions: string[]): ExploreItem[] {
  if (!regions.length) return items;
  const set = new Set(regions);
  return items.filter((x) => x.region != null && set.has(x.region));
}

/** 시·도별 줄 수 (시트의 'N곳 보기'). */
export function countRegions(items: ExploreItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of items) if (x.region) out[x.region] = (out[x.region] ?? 0) + 1;
  return out;
}

// ------------------------------------------------------------------ 인기

/** 장소 id → 최근 30일 가족 수 (picked = 코스로 고른 가족 · visited = 실제로 간 가족, 데모 차 뺌). */
export type PopRow = { picked: number; visited: number };
export type Popularity = Map<string, PopRow>;

/** 화면에 보이는 '○가족': 고른 가족과 간 가족 중 큰 쪽 (간 가족도 대개 골랐던 가족이라 더하지 않는다). */
export const popularFamilies = (p: PopRow | undefined) => (p ? Math.max(p.picked, p.visited) : 0);

/** 인기 점수 = 고른 가족 + 간 가족 × 2. 가족이 3 미만이면 0 (한두 가족이 순위를 흔들지 않게). */
export function popularScore(p: PopRow | undefined): number {
  if (!p || popularFamilies(p) < POPULAR_MIN_FAMILIES) return 0;
  return p.picked + 2 * p.visited;
}

/** 줄에 '○가족이 골랐어요' 숫자 붙이기 — 3가족 이상만 (아니면 칸을 뺀다). 100선 우리 명소는 우리 id로도 찾는다. */
export function withPopular(items: ExploreItem[], pop: Popularity): ExploreItem[] {
  return items.map((x) => {
    const n = popularFamilies(popOf(x, pop));
    if (n >= POPULAR_MIN_FAMILIES) return { ...x, popular: n };
    if (x.popular == null) return x;
    const { popular: _drop, ...rest } = x;
    return rest;
  });
}

function popOf(x: ExploreItem, pop: Popularity): PopRow | undefined {
  const a = pop.get(x.id);
  const b = x.ourPlaceId && x.ourPlaceId !== x.id ? pop.get(x.ourPlaceId) : undefined;
  if (!a) return b;
  if (!b) return a;
  return { picked: Math.max(a.picked, b.picked), visited: Math.max(a.visited, b.visited) };
}

/**
 * '인기' 정렬: 인기 점수(3가족 이상만) → 이번 주말 → 가까운 순 → 이름.
 * 아직 사용자가 적으면 점수가 모두 0 → 저절로 '이번 주말 → 가까운 순'.
 */
export function sortPopular(items: ExploreItem[], pop: Popularity): ExploreItem[] {
  const score = new Map(items.map((x) => [x, popularScore(popOf(x, pop))]));
  return [...items].sort((a, b) =>
    score.get(b)! - score.get(a)! ||
    Number(!!b.thisWeekend) - Number(!!a.thisWeekend) ||
    (a.driveMin ?? Number.MAX_SAFE_INTEGER) - (b.driveMin ?? Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name, "ko"));
}

// ------------------------------------------------------------------ 한꺼번에

export type ExploreQuery = { maxMin: number | null; regions: string[]; sort: ExploreSort };

/**
 * 목록(이미 기본 순서) → 시·도 채우기 → 거리 → (시·도별 수 세기) → 시·도 → 인기 숫자·정렬.
 * regionCounts = 거리 칩까지 거른 뒤 시·도별 수, regionCountsAll = 거리 제한 없이 (시트에서 '거리 풀고 보기').
 */
export function applyExploreQuery(items: ExploreItem[], q: ExploreQuery, pop: Popularity) {
  const all = withRegions(items);
  const near = withinMin(all, q.maxMin);
  const picked = inRegions(near, q.regions);
  const shown = withPopular(picked, pop);
  return {
    items: q.sort === "popular" ? sortPopular(shown, pop) : q.sort === "distance" ? sortDistance(shown) : shown,
    regionCounts: countRegions(near),
    regionCountsAll: countRegions(all),
    /** 3가족 이상인 줄이 하나라도 있나 (없으면 폰이 '아직 고른 가족이 적어요 · 이번 주말·가까운 순'을 보일 수 있게) */
    popularReady: shown.some((x) => (x.popular ?? 0) >= POPULAR_MIN_FAMILIES),
  };
}
