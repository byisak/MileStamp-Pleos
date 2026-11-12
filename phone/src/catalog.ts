// 서버 명소 목록 (관리자 화면에서 고친 것) — GET /api/catalog?since=버전.
// 앱을 켤 때 한 번 받고, 관리자에서 새로 올린 도장 그림이 있으면 미리 받아(Image.prefetch → 기기 그림 저장소)
// 앱에 든 그림 대신 쓴다. 못 받으면 앱에 든 그림 그대로.
// expo-file-system이 앱 의존성에 없어 목록 JSON은 메모리에만 둔다(앱을 다시 켜면 다시 받음).
import { useSyncExternalStore } from 'react';
import { Image, type ImageSourcePropType } from 'react-native';
import { BASE } from './api';
import { ALBUM, STAMP_ART, STAMP_ART_BW, RARE_NIGHT } from './places';

export type ArrivalPoint = { lat: number; lng: number; r: number; name: string };
export type CatalogPlace = {
  id: string; name: string; grp: string; points: ArrivalPoint[]; lat: number; lng: number; radiusM: number;
  indoor: boolean; open: number; close: number; dwell: number; kidFit: number; stampable: boolean;
  tags: string[]; facilities: string[]; closedDays: number[]; tempClosed: string[];
  intro: string | null; mission: { quiz: { q: string; options: string[]; answer: number }; find: string } | null;
  stamp: { url: string | null; bwUrl: string | null; version: number };
  /**
   * 11/3 장소 구조 칸 (예전 서버엔 없음, 아직 화면에서 안 씀 — 모양은 web/src/lib/place-attrs-shape.ts).
   * openHours = 요일·공휴일·계절별 운영 시간 줄, closedRules = 쉬는 날 규칙 말, parking·price·moments = 정해진 모양 jsonb.
   */
  openHours?: {
    days: number[]; holiday: boolean; openMin: number; closeMin: number; lastEntryMin: number | null;
    breaks: { fromMin: number; toMin: number }[]; validFrom: string | null; validTo: string | null; note: string | null;
  }[];
  closedRules?: string[];
  parking?: { has: 'yes' | 'no' | 'limited'; kind?: string | null; fee?: string | null; fee_note?: string | null; size?: string | null; weekend_full?: boolean; walk_min?: number | null; ev?: boolean } | null;
  price?: { free: boolean; adult?: number | null; child?: number | null; child_free_under?: number | null; level: number } | null;
  moments?: { best: string[]; light?: { on: string; off?: string | null } | null; shows?: { name: string; times: string[]; days?: number[]; months?: number[] }[]; season?: { what: string; months: number[] }[] } | null;
  regionCode?: string | null;
  kind?: 'spot' | 'view' | 'market' | 'drive';
  route?: { points: { lat: number; lng: number; name?: string }[]; pass_min: number; rest_place_id?: string | null } | null;
  fitKidAge?: Record<string, number> | null;
  fitEvening?: Record<string, number> | null;
  vocabTags?: string[];
};
/** 기간 한정 축제·행사 (관리자 '축제·행사'). 날짜는 한국 날짜 'YYYY-MM-DD'. */
export type CatalogFestival = {
  id: string; name: string; summary: string | null; placeId: string | null; points: ArrivalPoint[]; lat: number; lng: number;
  starts: string; ends: string; open: number; close: number; closedDays: number[]; dwell: number; indoor: boolean; kidFit: number;
  weight: 'normal' | 'strong'; crowdNote: string | null; season: string; poster: string | null;
  stamp: { url: string | null; bwUrl: string | null; version: number }; ring: string; status: 'upcoming' | 'running' | 'ended';
};
export type Catalog = {
  version: number;
  /** 켜진 축제 중 끝난 지 1년 안 (예전 서버면 없음) */
  festivals?: CatalogFestival[];
  places: CatalogPlace[];
  groups: { key: string; title: string }[];
  restaurants: { id: string; name: string; placeId: string | null; facilities: string[]; hours: string | null; closed: string | null }[];
};

let catalog: Catalog | null = null;
/** 미리 받아 둔 서버 그림 주소 (장소 id → {color, bw}). 받기 전에는 앱 그림을 쓴다. */
let ready: Record<string, { color: string; bw: string }> = {};
let rev = 0;
const subs = new Set<() => void>();
const emit = () => { rev++; subs.forEach((f) => f()); };

/** 앱을 켤 때 한 번. 실패해도 조용히(앱 그림·이름 그대로). */
let lastLoad = 0;
let inFlight: Promise<void> | null = null;
/**
 * 다시 받아 보기 (버전이 같으면 서버가 unchanged만 줌 → 거의 공짜). 켤 때만 받으면 관리자에서 새로 넣은 축제·도장이
 * 앱을 껐다 켜야 보여서, 앱이 다시 앞에 올 때(10분에 한 번까지)·오늘 탭 당겨서 새로 고침(30초에 한 번까지)에도 부른다.
 */
export function refreshCatalog(minGapMs = 10 * 60000): Promise<void> {
  if (inFlight) return inFlight;
  if (Date.now() - lastLoad < minGapMs) return Promise.resolve();
  return loadCatalog();
}

export function loadCatalog(): Promise<void> {
  lastLoad = Date.now();
  inFlight = fetchCatalog().finally(() => { inFlight = null; });
  return inFlight;
}

async function fetchCatalog(): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${BASE}/api/catalog${catalog ? `?since=${catalog.version}` : ''}`, { signal: ctrl.signal });
    if (!res.ok) return;
    const data = await res.json();
    if (data.unchanged) return;
    catalog = data as Catalog;
    emit();
    // 바뀐 도장 그림만 미리 받기 (같은 주소면 기기 저장소에 이미 있음)
    const next: Record<string, { color: string; bw: string }> = {};
    await Promise.all(catalog.places.map(async (p) => {
      const { url, bwUrl } = p.stamp;
      if (!url || !bwUrl) return;
      if (ready[p.id]?.color === url && ready[p.id]?.bw === bwUrl) { next[p.id] = ready[p.id]; return; }
      const ok = await Promise.all([Image.prefetch(url), Image.prefetch(bwUrl)]).then((r) => r.every(Boolean)).catch(() => false);
      if (ok) next[p.id] = { color: url, bw: bwUrl };
    }));
    // 축제 한정 도장도 같은 방식으로
    await Promise.all((catalog.festivals ?? []).map(async (f) => {
      const { url, bwUrl } = f.stamp;
      if (!url || !bwUrl) return;
      const k = `fest:${f.id}`;
      if (ready[k]?.color === url && ready[k]?.bw === bwUrl) { next[k] = ready[k]; return; }
      const ok = await Promise.all([Image.prefetch(url), Image.prefetch(bwUrl)]).then((r) => r.every(Boolean)).catch(() => false);
      if (ok) next[k] = { color: url, bw: bwUrl };
    }));
    ready = next;
    emit();
  } catch {
    // 인터넷 없음 → 앱에 든 것
  } finally {
    clearTimeout(timer);
  }
}

/** 화면이 목록·그림 변경에 맞춰 다시 그리게. */
export function useCatalogRev(): number {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => rev);
}

/** 받은 명소 전부 (목록을 못 받았으면 빈 목록) — '내가 고르기' 우리 명소 칸. */
export function catalogPlaces(): CatalogPlace[] {
  return catalog?.places ?? [];
}

export function catalogPlace(id: string): CatalogPlace | undefined {
  return catalog?.places.find((p) => p.id === id);
}

/** 도장북 칸 key → 그림. 관리자에서 올린 그림을 받아 두었으면 그것, 아니면 앱 그림. 비 오는 날 디아크 칸은 늘 앱 그림. 밤의 ○○ 칸은 그 장소 그림. */
export function stampArt(key: string, bw = false): ImageSourcePropType {
  const a = ALBUM.find((x) => x.key === key);
  const own = a && (!a.rare || a.rare === RARE_NIGHT);
  const remote = own ? ready[a!.placeId] : undefined;
  if (remote) return { uri: bw ? remote.bw : remote.color };
  const art = bw ? STAMP_ART_BW : STAMP_ART;
  return art[key] ?? (a ? art[a.placeId] : undefined);
}

// ---------- 축제·행사 ----------

/** 폰 시계 기준 오늘 'YYYY-MM-DD' (한국에서 쓰는 앱이라 기기 날짜 = 한국 날짜). */
export function today(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const FEST_RED = '#A33B2B';

/** 받은 축제 전부 (목록을 못 받았으면 빈 목록). */
export function festivals(): CatalogFestival[] {
  return catalog?.festivals ?? [];
}

export function festivalById(id: string | null | undefined): CatalogFestival | undefined {
  return id ? festivals().find((f) => f.id === id) : undefined;
}

/** 날짜로 다시 정하는 상태 (서버 status는 받은 날 기준이라). */
export function festivalStatus(f: { starts: string; ends: string }, day = today()): 'upcoming' | 'running' | 'ended' {
  return day < f.starts ? 'upcoming' : day > f.ends ? 'ended' : 'running';
}

/** '11/9' */
export const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 한정 도장 그림: 관리자가 올린 것(받아 두었으면) → 붙은 명소 도장 → 첫 칸 그림. */
export function festivalArt(f: Pick<CatalogFestival, 'id' | 'placeId'>, bw = false): ImageSourcePropType {
  const remote = ready[`fest:${f.id}`];
  if (remote) return { uri: bw ? remote.bw : remote.color };
  const a = ALBUM.find((x) => x.placeId === f.placeId && !x.rare) ?? ALBUM[0];
  return stampArt(a.key, bw);
}

/** 대충 걸리는 분 (직선 × 1.3 ÷ 시속 50 — 엔진 TravelTime과 같은 어림). */
export function driveMin(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  const km = 2 * 6371.0088 * Math.asin(Math.sqrt(h));
  return Math.round(((km * 1.3) / 50) * 60);
}
