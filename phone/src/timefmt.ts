// 시간 표시 방식: 12시간('오후 9:54', 기본) / 24시간('21:54'). '우리 차' 탭에서 고르고 이 폰에만 저장(SecureStore).
// 화면에 보이는 시각은 모두 여기 clock()·clockText()를 거친다. 서버로 보내거나 다시 읽는 값은 늘 'HH:MM'(plan.ts hhmm·toMin) 그대로.
// 바꾸면 useTimeFmt()를 쓰는 화면이 다시 그려진다(App의 Shell이 구독 → 탭 화면 전체).
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

export type TimeFmt = '12' | '24';
const KEY = 'milestamp_time_fmt';

let fmt: TimeFmt = '12';
const subs = new Set<() => void>();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const notify = () => subs.forEach((f) => f());

export const getTimeFmt = () => fmt;

/** 저장된 값 읽기 (앱 켤 때 한 번). 없으면 12시간 */
export async function loadTimeFmt(): Promise<TimeFmt> {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    const next: TimeFmt = v === '24' ? '24' : '12';
    if (next !== fmt) { fmt = next; notify(); }
  } catch {}
  return fmt;
}

/** 고르기: 바로 화면에 반영하고 저장 */
export function setTimeFmt(next: TimeFmt) {
  if (next !== fmt) { fmt = next; notify(); }
  SecureStore.setItemAsync(KEY, next).catch(() => {});
}

/** 지금 표시 방식 (바뀌면 이 컴포넌트를 다시 그림) */
export function useTimeFmt(): TimeFmt {
  return useSyncExternalStore(subscribe, getTimeFmt, getTimeFmt);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 시·분 → 표시 글. compact = '오후9:54'(하루 막대처럼 좁은 곳, 빈칸 없이) */
export function clockHM(h: number, m: number, compact = false): string {
  if (fmt === '24') return `${pad(h)}:${pad(m)}`;
  return `${h < 12 ? '오전' : '오후'}${compact ? '' : ' '}${h % 12 || 12}:${pad(m)}`;
}

/** 그날 0시부터 분 → 표시 글 ('오후 9:54' / '21:54'). 자정 넘김 처리 */
export function clock(min: number, compact = false): string {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return clockHM(Math.floor(v / 60), v % 60, compact);
}

/** 정시 시각만 ('오후 3시' / '15시') — '3시부터 비' 같은 글 */
export function clockHour(h: number): string {
  if (fmt === '24') return `${h}시`;
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시`;
}

// 글 속 시각: 'H:MM'·'HH:MM' (앞뒤가 숫자·콜론이면 시각이 아님). 앞에 이미 오전/오후가 붙어 있으면 그대로 둔다.
// '1시간 33분' 같은 길이는 콜론이 없어서 안 건드린다.
const CLOCK_RE = /(오[전후]\s?)?(?<![\d:.])(\d{1,2}):([0-5]\d)(?![\d:])/g;

/** 서버·엔진이 만든 글 속 'HH:MM'을 고른 방식으로 ('집에는 21:54쯤' → '집에는 오후 9:54쯤'). 24시간이면 그대로 */
export function clockText<S extends string | null | undefined>(s: S): S {
  if (!s || fmt === '24') return s;
  return s.replace(CLOCK_RE, (all, ampm: string | undefined, h: string, m: string) => {
    if (ampm) return all;
    const hh = Number(h);
    return hh > 23 ? all : clockHM(hh, Number(m));
  }) as S;
}

/** 말로 듣기용: 시각을 '오후 9시 54분'(24시간이면 '21시 54분')으로. 이미 '오후 9:54'인 글도 같은 모양으로 */
export function clockSpeech(s: string): string {
  return s.replace(CLOCK_RE, (all, ampm: string | undefined, h: string, m: string) => {
    const hh = Number(h);
    const mm = Number(m);
    if (hh > 23) return all;
    let head: string;
    if (ampm) head = `${ampm.trim()} ${hh}시`;
    else if (fmt === '24') head = `${hh}시`;
    else head = `${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}시`;
    return mm ? `${head} ${mm}분` : head;
  });
}

/** 두 시각 범위: 12시간이고 오전/오후가 같으면 한 번만 ('오후 2:10–3:30') */
export function clockRange(a: number, b: number): string {
  if (fmt === '24') return `${clock(a)}–${clock(b)}`;
  const half = (x: number) => (((Math.round(x) % 1440) + 1440) % 1440) < 720;
  if (half(a) !== half(b)) return `${clock(a)}–${clock(b)}`;
  return `${clock(a)}–${clock(b).replace(/^오[전후] /, '')}`;
}
