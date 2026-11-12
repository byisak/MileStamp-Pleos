// 장소 운영 정보 한 줄 + 사진 (UX B2·B3) — 서버 GET /api/explore/detail?id=&day=.
// 앱이 켜져 있는 동안 (id, 날짜)마다 한 번만 부른다(메모리). 옛 서버(404)·인터넷 없음이면 우리 명소·축제는 앱이 아는 값으로 한 줄을 만든다.
import { useEffect, useState } from 'react';
import { call } from './api';
import { catalogPlace, festivalById, today } from './catalog';
import { useSession } from './session';

export type PlaceDetail = {
  id: string; name: string | null; image: string | null;
  open: number | null; close: number | null; closed: boolean;
  parking: string | null; fee: string | null; line: string;
  source: 'ours' | 'festival' | 'tour' | 'none';
};

const NO_INFO = '운영 정보 없음';
const memo = new Map<string, PlaceDetail>();
const flight = new Map<string, Promise<PlaceDetail | null>>();

const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** 서버 없이 앱이 아는 것만으로 (우리 명소·등록 축제의 시각·쉬는 요일). 그 밖은 '운영 정보 없음'. */
export function localDetail(id: string, day = today()): PlaceDetail {
  const label = day === today() ? '오늘' : `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}(${DOW[new Date(`${day}T00:00:00`).getDay()]})`;
  const dow = new Date(`${day}T00:00:00`).getDay();
  const f = festivalById(id);
  const p = f ? null : catalogPlace(id);
  const src = f ?? p;
  if (!src) return { id, name: null, image: null, open: null, close: null, closed: false, parking: null, fee: null, line: NO_INFO, source: 'none' };
  const closed = src.closedDays.includes(dow) || (!!p && p.tempClosed.includes(day)) || (!!f && (day < f.starts || day > f.ends));
  const line = closed ? `${label} 쉬어요` : src.open <= 0 && src.close >= 1440 ? `${label} 언제나 열려 있어요` : `${label} ${hm(src.open)}~${hm(src.close)}`;
  return { id, name: src.name, image: f?.poster ?? null, open: src.open, close: src.close, closed, parking: null, fee: null, line, source: f ? 'festival' : 'ours' };
}

export function fetchDetail(token: string, id: string, day?: string): Promise<PlaceDetail | null> {
  const key = `${id}|${day ?? ''}`;
  const hit = memo.get(key);
  if (hit) return Promise.resolve(hit);
  let f = flight.get(key);
  if (!f) {
    f = call<PlaceDetail>(token, 'GET', `/api/explore/detail?id=${encodeURIComponent(id)}${day ? `&day=${day}` : ''}`)
      .then((d) => { memo.set(key, d); return d; })
      .catch(() => null)
      .finally(() => { flight.delete(key); });
    flight.set(key, f);
  }
  return f;
}

/** 한 곳의 운영 정보. 받기 전엔 null(자리만), 못 받으면 앱이 아는 값. */
export function usePlaceDetail(id: string | null | undefined, day?: string): PlaceDetail | null {
  const { token } = useSession();
  const key = id ? `${id}|${day ?? ''}` : '';
  const [d, setD] = useState<PlaceDetail | null>(() => (key ? memo.get(key) ?? null : null));
  useEffect(() => {
    if (!id) { setD(null); return; }
    const hit = memo.get(key);
    if (hit) { setD(hit); return; }
    setD(null);
    if (!token) { setD(localDetail(id, day)); return; }
    let alive = true;
    fetchDetail(token, id, day).then((r) => { if (alive) setD(r ?? localDetail(id, day)); });
    return () => { alive = false; };
  }, [key, token]); // eslint-disable-line react-hooks/exhaustive-deps
  return d;
}

/**
 * 코스 곳들 중 [day]에 쉬는 곳 이름 (서버 운영 정보 → 못 받으면 앱이 아는 값). 쉬는 곳이 든 카드는 차로 보내지 않는다.
 * ready = 모든 곳을 확인함 (그 전엔 보내기 버튼을 잠깐 막는다 — 앱이 아는 값으로 이미 쉬면 바로 closed).
 */
export function useClosedStops(stops: { id: string; name: string }[], day?: string): { names: string[]; ready: boolean } {
  const { token } = useSession();
  const key = `${stops.map((s) => s.id).join(',')}|${day ?? ''}`;
  const known = () => {
    const ds = stops.map((s) => memo.get(`${s.id}|${day ?? ''}`) ?? null);
    return { ds, ready: ds.every(Boolean) };
  };
  const [st, setSt] = useState<{ key: string; closed: Set<string>; ready: boolean }>(() => {
    const k = known();
    const closed = new Set(stops.filter((s, i) => (k.ds[i] ?? localDetail(s.id, day)).closed).map((s) => s.id));
    return { key, closed, ready: k.ready };
  });
  useEffect(() => {
    const k = known();
    const local = new Set(stops.filter((s, i) => (k.ds[i] ?? localDetail(s.id, day)).closed).map((s) => s.id));
    setSt({ key, closed: local, ready: k.ready || !token });
    if (k.ready || !token || !stops.length) return;
    let alive = true;
    Promise.all(stops.map((s) => fetchDetail(token, s.id, day).then((r) => r ?? localDetail(s.id, day)))).then((ds) => {
      if (alive) setSt({ key, closed: new Set(stops.filter((s, i) => ds[i].closed).map((s) => s.id)), ready: true });
    });
    return () => { alive = false; };
  }, [key, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = st.key === key ? st : { closed: new Set<string>(), ready: false };
  return { names: stops.filter((s) => cur.closed.has(s.id)).map((s) => s.name), ready: cur.ready || !stops.length };
}
