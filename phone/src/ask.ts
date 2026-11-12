// 대화형 고르기(오늘 탭 Ask) 기억과 작은 도우미 — docs/대화형-고르기-계획.html
// 이 폰에 기억: 지난번 동행(누구랑) · 하루 모양(가볍게/알차게/낮잠) · 오늘 탭 '자세히'를 켜 뒀는지.
// 동행은 서버 가족 설정(companion)에도 보내 둔다(새 서버만 받음 — 못 받아도 이 폰 기억으로 충분).
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import type { IconName } from './icon';
import { Companion, isCompanion, OptionShape, PlanOption } from './plan';
import { clock, clockText } from './timefmt';

/** evening·drive = 저녁에 잠깐 · 야경 드라이브 (저녁 계획일 때만 묻고, 지난번처럼 기억은 안 함) */
export type DayShape = 'light' | 'full' | 'nap' | 'evening' | 'drive';
export type AskMemory = { companion: Companion | null; shape: DayShape | null; detailed: boolean };

const KEY = 'ask-v1';
let mem: AskMemory = { companion: null, shape: null, detailed: false };
const subs = new Set<() => void>();

export async function loadAskMemory(): Promise<AskMemory> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const o = raw ? JSON.parse(raw) : {};
    mem = {
      companion: isCompanion(o.companion) ? o.companion : null,
      shape: o.shape === 'light' || o.shape === 'full' || o.shape === 'nap' ? o.shape : null,
      detailed: o.detailed === true,
    };
    subs.forEach((f) => f());
  } catch {}
  return mem;
}

export function setAskMemory(p: Partial<AskMemory>) {
  mem = { ...mem, ...p };
  subs.forEach((f) => f());
  SecureStore.setItemAsync(KEY, JSON.stringify(mem)).catch(() => {});
}

export const getAskMemory = () => mem;
export function useAskMemory(): AskMemory {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => mem);
}

/** 동행 이름·아이콘·무엇이 달라지는지 (질문 버튼 밑 작은 글) */
export const COMPANION_INFO: Record<Companion, { label: string; icon: IconName; sub: string; bubble: string }> = {
  kids: { label: '아이와', icon: 'baby', sub: '낮잠·아이 나이에 맞춰요', bubble: '아이와 갈게요' },
  couple: { label: '연인·부부', icon: 'heart', sub: '둘이 천천히 둘러보기 좋은 곳으로', bubble: '둘이 갈게요' },
  friends: { label: '친구끼리', icon: 'users', sub: '여럿이 즐기기 좋은 곳으로', bubble: '친구들이랑 가요' },
  solo: { label: '혼자', icon: 'user', sub: '내 속도대로, 붐비지 않는 곳으로', bubble: '혼자 가요' },
};

/** 지금 쓰는 동행 (모르면 아이와 — 이 앱의 처음 기본) */
export const companionNow = (c: Companion | null | undefined): Companion => c ?? 'kids';

/** 카드 종류: 새 서버 kind → 그대로, 예전 서버는 이름·칸으로 어림 */
export function optionShape(o: PlanOption): OptionShape {
  const k = (o.pick ?? o.kind) as string;
  if (k === 'short' || k === 'full' || k === 'nap' || k === 'indoor' || k === 'popular' || k === 'near' || k === 'home' || k === 'evening' || k === 'drive') return k;
  if (o.label.startsWith('저녁 · 야경 드라이브')) return 'drive';
  if (o.label.startsWith('저녁 · ')) return 'evening';
  if (o.legs.some((l) => l.kind === 'NAP_DRIVE') || o.reasons.some((r) => r.tone === 'NAP' && /맞춤|재울/.test(r.text))) return 'nap';
  if (/짧게/.test(o.label) || o.stops.length <= 1) return 'short';
  if (/실내/.test(o.label)) return 'indoor';
  if (/많이/.test(o.label)) return 'popular';
  return 'full';
}

/** 하루 모양에 맞는 카드 번호 (맞는 게 없으면 가장 가까운 것, 갈 곳이 든 카드가 없으면 -1 — '바로 집으로'·빈 카드는 결과로 안 보임) */
export function pickByShape(options: PlanOption[], shape: DayShape | null): number {
  const real = options.map((o, i) => ({ o, i })).filter(({ o }) => o.stops.length > 0);
  if (!real.length) return -1;
  if (!shape) return real[0].i;
  if (shape === 'evening' || shape === 'drive') {
    // 저녁: 고른 종류 → 저녁 카드 아무거나 → 첫 카드
    const ev = real.find(({ o }) => optionShape(o) === shape) ?? real.find(({ o }) => optionShape(o) === 'evening' || optionShape(o) === 'drive');
    return (ev ?? real[0]).i;
  }
  const want: OptionShape = shape === 'light' ? 'short' : shape === 'nap' ? 'nap' : 'full';
  // 가볍게 = 한 곳짜리만, 알차게 = 두 곳 이상만 (예전 서버는 '짧게' 카드에도 세 곳이 들 수 있었다)
  const fits = (o: PlanOption) => (shape === 'light' ? o.stops.length === 1 : shape === 'full' ? o.stops.length >= 2 : true);
  const hit = real.find(({ o }) => optionShape(o) === want && fits(o)) ?? real.find(({ o }) => fits(o));
  if (hit) return hit.i;
  // 어림: 가볍게 = 곳이 가장 적고 일찍 귀가, 알차게 = 곳이 가장 많은 것
  if (shape === 'light') return [...real].sort((a, b) => a.o.stops.length - b.o.stops.length || a.o.arriveHomeMin - b.o.arriveHomeMin)[0].i;
  if (shape === 'full') return [...real].sort((a, b) => b.o.stops.length - a.o.stops.length)[0].i;
  return real[0].i;
}

/** 어른끼리 '늦어도 몇 시 귀가' 기본값 (엔진 FamilyProfile.DEFAULT_LATE_RETURN_MIN · 23:00 — 예전 22:00 고정을 대신함) */
export const ADULT_BACK_BY_MIN = 23 * 60;

/**
 * '… 귀가' 글: 아이와 = 가족 설정(해 지기 30분 전 등), 어른끼리 = 계획의 귀가 한계(모르면 가족 '늦어도 몇 시' → 23:00).
 * 가족 설정의 귀가 기준은 아이와 갈 때만 쓰인다 (엔진 backByMin). 저녁 계획이면 [evening] = 그 귀가 한계(잠자는 시간 등)를
 * '잠자기 전(오후 9시)'·'늦어도 오후 11시'로.
 */
export function backByText(kids: boolean, familyBackBy: string | null | undefined, planBackByMin?: number | null,
  evening?: { limitMin: number } | null, lateReturn?: number | null): string | null {
  if (evening) return kids ? `잠자기 전(${clock(evening.limitMin)})` : `늦어도 ${clock(evening.limitMin)}`;
  if (kids) return familyBackBy ? clockText(familyBackBy) : null;
  return clock(planBackByMin ?? lateReturn ?? ADULT_BACK_BY_MIN);
}

/** 저녁 나들이 머리 글 (오늘 탭 저녁 화면 · 대화 첫 질문 — 차 GoWords.eveningTitle과 같은 뜻) */
export const EVENING_Q: Record<Companion, string> = {
  kids: '저녁에 잠깐\n나가 볼까요?', couple: '둘이 야경\n보러 갈까요?', friends: '저녁에 잠깐\n놀다 올까요?', solo: '바람 쐬러\n나가 볼까요?',
};
/** 저녁 답 버튼 (말풍선) */
export const EVENING_BUBBLE: Record<Companion, string> = {
  kids: '아이와 저녁 산책', couple: '둘이 야경 보러', friends: '친구들이랑 저녁에', solo: '혼자 바람 쐬러',
};

/** '해는 졌지만, 아직 1시간 반 있어요' — 지금부터 [lastStartMin](귀가 한계 − 90분)까지 남은 시간 */
export function eveningLeftText(nowMin: number, limitMin: number): string {
  const left = Math.max(0, limitMin - nowMin);
  const h = Math.floor(left / 60), m = left % 60;
  const dur = h === 0 ? `${m}분` : m === 0 ? `${h}시간` : m === 30 ? `${h}시간 반` : `${h}시간 ${m}분`;
  return `해는 졌지만, 아직 ${dur} 있어요`;
}

/** 곳 수 글: 한 곳이면 '한 곳' */
export const stopsText = (n: number) => (n === 1 ? '한 곳' : `${n}곳`);

/** 'YYYY-MM-DD' (폰 날짜) */
export const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 미리 정할 날: 내일 + 다가오는 토·일 (내일과 겹치면 하나로) */
export function aheadDays(now = new Date()): { day: string; label: string; sub: string }[] {
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const out: { day: string; label: string; sub: string }[] = [];
  const add = (d: Date, label: string) => {
    const day = ymdOf(d);
    if (out.some((x) => x.day === day)) return;
    out.push({ day, label, sub: `${d.getMonth() + 1}/${d.getDate()} ${WD[d.getDay()]}요일` });
  };
  const at = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
  add(at(1), '내일');
  for (let n = 1; n <= 7; n++) { const d = at(n); if (d.getDay() === 6) { add(d, '이번 토요일'); break; } }
  for (let n = 1; n <= 7; n++) { const d = at(n); if (d.getDay() === 0) { add(d, '이번 일요일'); break; } }
  return out;
}

/** '다른 날 고르기' 달력: 내일부터 n일 (서버 계획은 2주 안의 날만 받음) */
export function pickableDays(now = new Date(), n = 13): { day: string; md: string; wd: string; dow: number; label: string }[] {
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() + i + 1);
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    return { day: ymdOf(d), md, wd: WD[d.getDay()], dow: d.getDay(), label: `${md} ${WD[d.getDay()]}요일` };
  });
}
