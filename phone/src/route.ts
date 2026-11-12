// 실제 길 · 교통 반영 시간 — 서버 GET /api/route (카카오모빌리티 길찾기, 키는 서버에만).
// 계획 카드는 서버가 이미 실제 길로 다시 재서 보낸다(option.route). 여기는 '바로 오면'처럼 따로 잴 길만 부른다.
// 앱이 켜져 있는 동안 같은 길(점·출발 시각)은 한 번만 부른다(메모리 10분).
import { useEffect, useState } from 'react';
import { call } from './api';
import { today } from './catalog';
import { useSession } from './session';

/** live = 지금 교통 · future = 그날 출발 시각의 예상 교통 · estimate = 직선 어림 */
export type RouteSource = 'live' | 'future' | 'estimate';
export type RouteLeg = { durMin: number; distKm: number };
export type RouteRes = { source: RouteSource; legs: RouteLeg[]; total: RouteLeg; polyline: [number, number][][] };
/** 계획 카드에 서버가 붙이는 값 (option.route). 예전 서버엔 없음 */
export type OptionRoute = {
  source: RouteSource; homeMin: number; driveMin: number; distKm: number; legs: RouteLeg[];
  /** 구간마다 [위도, 경도] 목록 (어림이면 없음) */
  polyline?: [number, number][][];
};

type Pt = { lat: number; lng: number };

/** 출처 글: 지도·비교 칸 아래 */
export function sourceLabel(s: RouteSource | null | undefined): string {
  return s === 'live' ? '실시간 교통 반영' : s === 'future' ? '그날 예상 교통' : '어림';
}

/** 그날 출발 시각 → 'YYYYMMDDHHmm'. 오늘이고 출발이 20분 안이면 null = 지금 교통 (서버 route-shape departFor와 같은 규칙) */
export function departParam(day: string | undefined, departMin: number): string | null {
  if (!day || day < today()) return null;
  if (day === today()) {
    const d = new Date();
    if (departMin - (d.getHours() * 60 + d.getMinutes()) <= 20) return null;
  }
  const m = Math.max(0, Math.min(23 * 60 + 50, Math.floor(departMin / 10) * 10));
  return `${day.replace(/-/g, '')}${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
}

const memo = new Map<string, { at: number; r: RouteRes }>();
const flight = new Map<string, Promise<RouteRes | null>>();
const MEMO_MS = 10 * 60_000;

export function fetchRoute(token: string, pts: Pt[], depart: string | null): Promise<RouteRes | null> {
  const p = pts.map((x) => `${x.lng.toFixed(5)},${x.lat.toFixed(5)}`).join(';');
  const key = `${p}|${depart ?? ''}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return Promise.resolve(hit.r);
  let f = flight.get(key);
  if (!f) {
    f = call<RouteRes>(token, 'GET', `/api/route?pts=${encodeURIComponent(p)}${depart ? `&depart=${depart}` : ''}`)
      .then((r) => { memo.set(key, { at: Date.now(), r }); return r; })
      .catch(() => null) // 옛 서버(404)·인터넷 없음 → 어림 그대로
      .finally(() => { flight.delete(key); });
    flight.set(key, f);
  }
  return f;
}

/** 길 하나 (pts가 null이면 안 부름). 받기 전·못 받으면 null */
export function useRoute(pts: Pt[] | null, depart: string | null): RouteRes | null {
  const { token } = useSession();
  const key = pts ? pts.map((x) => `${x.lat.toFixed(5)},${x.lng.toFixed(5)}`).join(';') + `|${depart ?? ''}` : '';
  const [r, setR] = useState<RouteRes | null>(null);
  useEffect(() => {
    if (!pts || !token) { setR(null); return; }
    let alive = true;
    fetchRoute(token, pts, depart).then((x) => { if (alive) setR(x); });
    return () => { alive = false; };
  }, [key, token]); // eslint-disable-line react-hooks/exhaustive-deps
  return r;
}
