// '그날의 기록'(자동 일기) — 서버 GET/PATCH /api/diary · POST /api/diary/regen.
// 사실(들른 곳·시각·도장·날씨·주행·낮잠·귀가)은 서버가 모으고, 글은 집에 도착한 뒤 하루 한 번 서버가 써서 저장한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, call } from './api';

export type Tone = 'parent' | 'child';
export type DiaryStamp = {
  id: string; placeId: string; key: string; number: number | null; rare: string | null; festivalId: string | null; name: string; atMin: number;
};
export type DiaryStop = {
  placeId: string; name: string; lat: number | null; lng: number | null;
  arriveMin: number | null; departMin: number | null; stayMin: number | null; stamps: string[];
};
export type DiaryFacts = {
  day: string; dateText: string;
  weather: { sky: 'RAIN' | 'SNOW' | 'CLEAR'; label: string } | null;
  companion: string;
  depart: { min: number; approx: boolean } | null;
  stops: DiaryStop[]; stamps: DiaryStamp[];
  drive: { km: number | null; min: number | null; approx: boolean } | null;
  nap: { min: number; fromMin?: number } | null;
  homeMin: number | null;
  done: boolean;
};
export type DiaryStory = {
  parent: string | null; child: string | null; generatedAt: string | null;
  by: { parent: 'ai' | 'facts' | 'edit' | null; child: 'ai' | 'facts' | 'edit' | null };
};
export type Diary = { day: string; facts: DiaryFacts; story: DiaryStory; done: boolean };

/** 앱이 켜진 동안 기억 (같은 날을 다시 열 때 바로 보이게, 뒤에서 다시 받음) */
const memo = new Map<string, Diary>();

export const getDiary = (token: string, day: string) => call<Diary>(token, 'GET', `/api/diary?day=${encodeURIComponent(day)}`);
export const editDiary = (token: string, day: string, tone: Tone, text: string) => call<Diary>(token, 'PATCH', '/api/diary', { day, tone, text });
export const regenDiary = (token: string, day: string, tone: Tone) => call<Diary>(token, 'POST', '/api/diary/regen', { day, tone });

/** 한국 날짜 'YYYY-MM-DD' (ISO 시각 → 기기 날짜. 한국에서 쓰는 앱이라 기기 날짜 = 한국 날짜) */
export function dayOf(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 분 → '1시간 20분' · '45분' */
export function durText(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  return !h ? `${r}분` : r ? `${h}시간 ${r}분` : `${h}시간`;
}

/**
 * 그날 일기 불러오기. unsupported = 옛 서버(404). 나들이 중(done=false)이면 1분마다 다시 받아 집에 오면 글이 채워진다.
 */
export function useDiary(token: string | null | undefined, day: string | null) {
  const [data, setData] = useState<Diary | null>(day ? memo.get(day) ?? null : null);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!token || !day) return;
    try {
      const d = await getDiary(token, day);
      memo.set(day, d);
      if (alive.current) { setData(d); setError(''); }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 404) setUnsupported(true);
      else setError(e instanceof Error ? e.message : '불러오지 못했어요');
    }
  }, [token, day]);

  useEffect(() => {
    setData(day ? memo.get(day) ?? null : null);
    setUnsupported(false);
    load();
  }, [load, day]);
  // 아직 나들이 중이면 1분마다
  const done = data?.done ?? true;
  useEffect(() => {
    if (done) return;
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [done, load]);

  const put = (d: Diary) => { if (day) memo.set(day, d); setData(d); };
  const save = async (tone: Tone, text: string) => {
    if (!token || !day) return false;
    setBusy(true);
    try { put(await editDiary(token, day, tone, text)); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요'); return false; }
    finally { if (alive.current) setBusy(false); }
  };
  const regen = async (tone: Tone) => {
    if (!token || !day) return false;
    setBusy(true);
    try { put(await regenDiary(token, day, tone)); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '다시 쓰지 못했어요'); return false; }
    finally { if (alive.current) setBusy(false); }
  };
  return { data, error, unsupported, busy, reload: load, save, regen };
}
