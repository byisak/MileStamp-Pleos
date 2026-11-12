// 지금 기온·강수 (오늘 탭 머리 '☁ 12°' 칩) — 서버 GET /api/sky/now (기상청 초단기실황, 10분 저장).
// 위치: 위치 권한이 이미 있으면 지금 위치(마지막 위치 → 대략 정확도), 없으면 좌표 없이 → 서버가 가족 집으로.
// 권한을 여기서 묻지는 않는다(추천 계획이 처음 한 번 묻는다). 좌표는 소수 둘째 자리(약 1km)로 깎아 보낸다.
// 앱이 다시 앞으로 올 때 새로 받되 10분에 한 번까지. 실패하면 조용히 — 전에 받은 값은 1시간까지 그대로 둔다.
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { call } from './api';

export type NowSky = 'clear' | 'rain' | 'snow' | 'sleet' | 'drizzle';
export type SkyNow = { tempC: number; sky: NowSky; at: string };

const EVERY_MS = 10 * 60_000;
const KEEP_MS = 60 * 60_000;

async function here(): Promise<{ lat: number; lng: number } | null> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    if (!p.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: EVERY_MS }).catch(() => null);
    const pos = last ?? await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((res) => setTimeout(() => res(null), 6000)),
    ]).catch(() => null);
    return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}

const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function getSkyNow(token: string, at: { lat: number; lng: number } | null) {
  return call<SkyNow>(token, 'GET', `/api/sky/now${at ? `?lat=${r2(at.lat)}&lng=${r2(at.lng)}` : ''}`);
}

/** 지금 날씨. 모르면 null (칩을 숨김) */
export function useSkyNow(token: string | null | undefined): SkyNow | null {
  const [v, setV] = useState<{ data: SkyNow; got: number } | null>(null);
  const last = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async (force = false) => {
    if (!token || busy.current) return;
    if (!force && Date.now() - last.current < EVERY_MS) return;
    busy.current = true;
    last.current = Date.now();
    try {
      const r = await getSkyNow(token, await here());
      if (typeof r?.tempC === 'number' && Number.isFinite(r.tempC)) setV({ data: r, got: Date.now() });
    } catch {
      // 조용히 — 오래된 값은 아래에서 걸러짐
    } finally {
      busy.current = false;
    }
  }, [token]);

  useEffect(() => { load(true); }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  if (!v || Date.now() - v.got > KEEP_MS) return null;
  return v.data;
}
