// 고르기 탭 2차 (docs/고르기-2차-계획.html 4~8절) — 목록 받기 · 거르기 값 · 기억 (축제·100선 공용)
// 서버: GET /api/explore/{festivals,kto100}?maxMin=60|120|180&regions=27,47&sort=popular|distance[&places=1][&from=lat,lng] (web lib/explore-filter.ts)
// 기준 위치(우리 집 · 지금 내 위치 · 직접 정한 곳)·자동완성·좌표 → 주소: docs/검색-거리순-계획.md
import * as SecureStore from 'expo-secure-store';
import { ApiError, call } from '../api';
import type { ExploreItem } from '../plan';
import { getAskMemory } from '../ask';

/** 서버 줄 + 2차 칸: 시·도 코드 · 최근 30일 고른 가족 수(3가족 이상만 옴) */
export type Item = ExploreItem & { region?: string; popular?: number };

/** 거리 칩 값: 60·120·180분 · null = 거리 제한 없음 */
export type MaxMin = 60 | 120 | 180 | null;
/** popular(인기)·distance(거리순)는 둘 중 하나만 켜진다 */
export type Filters = { maxMin: MaxMin; regions: string[]; popular: boolean; distance: boolean };
export const DEFAULT_FILTERS: Filters = { maxMin: 120, regions: [], popular: false, distance: false };

/** 관광공사 법정동 시도 코드 (시안 B 순서) */
export const REGIONS: { code: string; name: string }[] = [
  { code: '11', name: '서울' }, { code: '26', name: '부산' }, { code: '27', name: '대구' }, { code: '28', name: '인천' },
  { code: '29', name: '광주' }, { code: '30', name: '대전' }, { code: '31', name: '울산' }, { code: '36', name: '세종' },
  { code: '41', name: '경기' }, { code: '51', name: '강원' }, { code: '43', name: '충북' }, { code: '44', name: '충남' },
  { code: '52', name: '전북' }, { code: '46', name: '전남' }, { code: '47', name: '경북' }, { code: '48', name: '경남' },
  { code: '50', name: '제주' },
];
export const regionName = (c: string) => REGIONS.find((r) => r.code === c)?.name ?? c;

/** 칩 글: 전국 · '대구·경북' · '대구 외 2' */
export function regionsLabel(codes: string[]): string {
  if (!codes.length) return '전국';
  const names = REGIONS.filter((r) => codes.includes(r.code)).map((r) => r.name);
  return names.length <= 2 ? names.join('·') : `${names[0]} 외 ${names.length - 1}`;
}

export const maxMinLabel = (m: MaxMin) => (m == null ? null : `차로 ${m / 60}시간 안`);

export type ListRes = {
  status: 'ok'; items: Item[]; places?: Item[]; tourOk: boolean;
  /** 2차 서버면 true (거리·시·도·인기를 서버가 걸렀음). 옛 서버면 false → 앱이 거리만 거름 */
  v2: boolean;
  regionCounts: Record<string, number>; regionCountsAll: Record<string, number>; popularReady: boolean;
} | { status: 'soon' };

type Raw = {
  items?: Item[]; places?: Item[]; tour?: { ok?: boolean };
  regionCounts?: Record<string, number>; regionCountsAll?: Record<string, number>; popularReady?: boolean;
};

/** '거리순': 차로 가까운 순 (옛 서버가 sort=distance를 몰라도 같은 순서가 되게 앱도 한 번 더) */
export const byDistance = <X extends { driveMin: number | null; name: string }>(xs: X[]): X[] =>
  [...xs].sort((a, b) => (a.driveMin ?? 1e9) - (b.driveMin ?? 1e9) || a.name.localeCompare(b.name, 'ko'));

export async function getList(token: string, kind: 'festivals' | 'kto100', f: Filters, opts: { places?: boolean; from?: RefPoint | null; day?: string } = {}): Promise<ListRes> {
  const q: string[] = [];
  // 옛 서버도 알아듣게 scope를 같이 보낸다 (새 서버는 maxMin이 먼저)
  q.push(`scope=${f.maxMin != null && f.maxMin <= 120 ? 'near' : 'all'}`);
  if (f.maxMin != null) q.push(`maxMin=${f.maxMin}`);
  if (f.regions.length) q.push(`regions=${f.regions.join(',')}`);
  if (f.popular) q.push('sort=popular');
  else if (f.distance) q.push('sort=distance');
  if (opts.places) q.push('places=1');
  if (opts.from) q.push(`from=${fromText(opts.from)}`);
  // 기준 날짜(대화형 '내일·주말 미리') — 그날 열리는 축제까지 받기
  if (opts.day) q.push(`day=${opts.day}`);
  // 누구랑 (대화형 고르기 동행 — 새 서버만 씀, 예전 서버는 무시)
  const withC = getAskMemory().companion;
  if (withC) q.push(`with=${withC}`);
  try {
    const r = await call<Raw>(token, 'GET', `/api/explore/${kind}?${q.join('&')}`);
    const v2 = !!r.regionCounts;
    let items = r.items ?? [];
    // 옛 서버(거리 칩을 모름): 2시간 넘는 값·지역은 앱이 거리만 거른다
    if (!v2 && f.maxMin != null) items = items.filter((x) => x.driveMin == null || x.driveMin <= f.maxMin!);
    if (f.distance && !f.popular) items = byDistance(items);
    return {
      status: 'ok', items, places: r.places && f.distance ? byDistance(r.places) : r.places, tourOk: r.tour?.ok !== false, v2,
      regionCounts: r.regionCounts ?? {}, regionCountsAll: r.regionCountsAll ?? {}, popularReady: !!r.popularReady,
    };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return { status: 'soon' };
    throw e;
  }
}

// ---------- 고른 값 기억 (이 폰에만, 탭마다) ----------

const KEY = 'explore-filters-v1';
type Saved = Partial<Record<'festival' | 'kto100', Filters>>;

function clean(f: Partial<Filters> | undefined): Filters {
  const m = f?.maxMin;
  const popular = f?.popular === true;
  return {
    maxMin: m === 60 || m === 120 || m === 180 || m === null ? m : DEFAULT_FILTERS.maxMin,
    regions: Array.isArray(f?.regions) ? f!.regions.filter((c) => REGIONS.some((r) => r.code === c)) : [],
    popular,
    distance: !popular && f?.distance === true,
  };
}

export async function loadFilters(tab: 'festival' | 'kto100'): Promise<Filters> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const s = raw ? (JSON.parse(raw) as Saved) : {};
    return clean(s[tab]);
  } catch { return DEFAULT_FILTERS; }
}

export async function saveFilters(tab: 'festival' | 'kto100', f: Filters): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const s = raw ? (JSON.parse(raw) as Saved) : {};
    s[tab] = clean(f);
    await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  } catch {}
}

// ---------- 기준 위치 (목록·'차로 ○분'·거리 칩의 기준, docs/검색-거리순-계획.md ①) ----------
// 코스 짜기(앵커)는 언제나 집에서 출발 — 이건 목록을 보는 기준일 뿐. 축제·100선·직접 찾기 공용, 이 폰에만 기억.

export type RefPoint = { lat: number; lng: number };
export type RefLoc =
  | { kind: 'home' }
  | { kind: 'here'; lat: number; lng: number }
  | { kind: 'custom'; name: string; lat: number; lng: number };
export type RefState = { cur: RefLoc; recent: Extract<RefLoc, { kind: 'custom' }>[] };
export const DEFAULT_REF: RefState = { cur: { kind: 'home' }, recent: [] };

/** 서버에 보낼 from 글 ('35.8858,128.5828' — 서버가 약 1km로 반올림) */
export const fromText = (p: RefPoint) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
/** 집이면 null (서버가 집을 앎) */
export const refPoint = (r: RefLoc): RefPoint | null => (r.kind === 'home' ? null : { lat: r.lat, lng: r.lng });
export const refLabel = (r: RefLoc) => (r.kind === 'home' ? '우리 집' : r.kind === 'here' ? '지금 내 위치' : r.name);

const REF_KEY = 'explore-ref-v1';
const okPt = (o: any) => o && Number.isFinite(o.lat) && Number.isFinite(o.lng) && Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180;

export function cleanRef(raw: any): RefState {
  const one = (o: any): RefLoc | null => {
    if (o?.kind === 'home') return { kind: 'home' };
    if (o?.kind === 'here' && okPt(o)) return { kind: 'here', lat: o.lat, lng: o.lng };
    if (o?.kind === 'custom' && okPt(o) && typeof o.name === 'string' && o.name) return { kind: 'custom', name: o.name.slice(0, 40), lat: o.lat, lng: o.lng };
    return null;
  };
  const recent = (Array.isArray(raw?.recent) ? raw.recent : []).map(one).filter((x: RefLoc | null): x is Extract<RefLoc, { kind: 'custom' }> => x?.kind === 'custom').slice(0, 3);
  return { cur: one(raw?.cur) ?? { kind: 'home' }, recent };
}

/** 새 기준 정하기 — 직접 정한 곳이면 최근 목록 맨 앞에 (같은 곳은 하나로, 3개까지) */
export function withRef(s: RefState, cur: RefLoc): RefState {
  if (cur.kind !== 'custom') return { ...s, cur };
  const same = (a: RefPoint, b: RefPoint) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
  return { cur, recent: [cur, ...s.recent.filter((x) => !same(x, cur))].slice(0, 3) };
}

export async function loadRef(): Promise<RefState> {
  try { const raw = await SecureStore.getItemAsync(REF_KEY); return cleanRef(raw ? JSON.parse(raw) : null); } catch { return DEFAULT_REF; }
}
export async function saveRef(s: RefState): Promise<void> {
  try { await SecureStore.setItemAsync(REF_KEY, JSON.stringify(s)); } catch {}
}

// ---------- 직접 찾기: 자동완성 · 좌표 → 주소 (서버 /api/explore/suggest · reverse, 카카오 키는 서버에만) ----------

export type Suggest = {
  kind: 'place' | 'kakao' | 'address' | 'pin';
  /** 우리 명소 id · 'ext:kakao:<id>' · 'ext:pin:<lat>,<lng>' */
  id: string; name: string; label: string; addr: string; lat: number; lng: number; driveMin: number | null;
  ourStamp?: boolean; ourPlaceId?: string;
};
export type SuggestRes = { status: 'ok'; items: Suggest[]; kakaoOk: boolean } | { status: 'soon' };

export async function getSuggest(token: string, q: string, from: RefPoint | null, signal?: AbortSignal): Promise<SuggestRes> {
  const qs = [`q=${encodeURIComponent(q)}`, ...(from ? [`from=${fromText(from)}`] : [])].join('&');
  try {
    const r = await call<{ items?: Suggest[]; kakao?: { ok?: boolean } }>(token, 'GET', `/api/explore/suggest?${qs}`, undefined, signal);
    return { status: 'ok', items: r.items ?? [], kakaoOk: r.kakao?.ok !== false };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return { status: 'soon' };
    throw e;
  }
}

/** 지도 길게 누름 → 그 자리 한 줄. 옛 서버(404)·실패면 이름 없이 '지도에서 고른 곳' */
export async function getReverse(token: string, lat: number, lng: number, from: RefPoint | null): Promise<Suggest> {
  const fallback: Suggest = {
    kind: 'pin', id: `ext:pin:${lat.toFixed(5)},${lng.toFixed(5)}`, name: '지도에서 고른 곳', label: '지도에서 고른 곳', addr: '',
    lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)), driveMin: null,
  };
  try {
    const qs = `lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}${from ? `&from=${fromText(from)}` : ''}`;
    const r = await call<{ item?: Suggest }>(token, 'GET', `/api/explore/reverse?${qs}`);
    return r.item ?? fallback;
  } catch { return fallback; }
}
