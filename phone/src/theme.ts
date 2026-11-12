// 디자인 토큰 — MindNest 앱(~/mindnest/app, docs/app-ui.html 2절)과 같은 체계. 그림자 없음 — 면의 톤 차이와 1px 선으로만 묶는다.
// 마일스탬프는 강조색만 다르다: 주황 대신 '도장 잉크 초록'(차 화면 Theme.kt ink와 같은 색). 노랑(point)은 켜진 탭 점·로고 점에만.
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Appearance, useColorScheme } from 'react-native';

const light = {
  bg: '#F6F5F2', surface: '#FFFFFF', fill: '#EFEDE8', fill2: '#E4E1DA',
  // ink3 = 보조 글씨(시각·설명·라벨). bg 4.9 · surface 5.4 · fill 4.6 : 1 (기준 4.5 통과). ink4 = 옛 ink3, 장식·꺼진 것만(글자 금지)
  ink: '#111110', ink2: '#55534E', ink3: '#6E6A62', ink4: '#9A968D', line: '#E7E4DD', onInk: '#FFFFFF',
  /** 강조색(accent) 바탕 위 글자 — 어둡게에선 accent가 연초록이라 짙은 잉크 */
  onAccent: '#FFFFFF',
  accent: '#2C4A3E', accentSoft: '#E5EEE9', accentInk: '#22392F', point: '#F2B230',
  ok: '#1F9D55', okSoft: '#E7F6EC', red: '#E5484D', redSoft: '#FDECEC', blue: '#3E63DD', blueSoft: '#EDF2FE',
  /** 빨강·초록 '글자'용 (red·ok는 점·선·채움용). redText: bg 5.0 · surface 5.4 · fill 4.6 · redSoft 4.7 / okText: okSoft 4.8 */
  redText: '#CA2A2F', okText: '#18794E',
  /** 위험 버튼(연결 끊기·빼기 확인) 채움과 그 위 글자 (5.4:1) · 포인트 노랑 위 글자 */
  danger: '#CA2A2F', onDanger: '#FFFFFF', onPoint: '#1B1400',
  dim: 'rgba(17,17,16,0.38)', dark: false,
  /** 칩 색 [바탕, 글자] — 이름(tone)으로만 고른다. 글자는 모두 바탕 위 4.5:1 이상 */
  tone: {
    plain: ['#EFEDE8', '#55534E'], stamp: ['#E5EEE9', '#22392F'], nap: ['#EDF2FE', '#3E63DD'],
    sun: ['#FFF4DB', '#8F5D00'], rain: ['#E9EFF5', '#466488'], festival: ['#F8E9E5', '#A33B2B'],
    air: ['#FDEBE3', '#B4441F'], warn: ['#FDECEC', '#CA2A2F'], ok: ['#E7F6EC', '#18794E'],
  } as Record<ToneName, [string, string]>,
  /** 하루 막대 (DayBar) — 운전·머무름·낮잠 운전(줄무늬 두 색)·집·바탕, 해 질 녘 선·글자 */
  bar: { drive: '#B9B6AE', stay: '#2C4A3E', nap: '#7E95C9', napStripe: '#9DB0DA', home: '#E3B04B', track: '#EFEDE8', markSun: '#E8902A', markSunText: '#A65A00' },
};
const dark: typeof light = {
  bg: '#0F0F0E', surface: '#1A1A19', fill: '#242422', fill2: '#30302D',
  ink: '#F2F1EE', ink2: '#B5B2AB', ink3: '#908C84', ink4: '#7D7A73', line: '#2A2A28', onInk: '#111110',
  onAccent: '#0F1A15',
  accent: '#7DB59C', accentSoft: '#1A2A23', accentInk: '#A9D6C2', point: '#F2B230',
  ok: '#3DD68C', okSoft: '#16301F', red: '#FF6369', redSoft: '#3A1A1B', blue: '#7B9BFF', blueSoft: '#1B2340',
  redText: '#FF6369', okText: '#3DD68C',
  danger: '#FF6369', onDanger: '#1A0B0B', onPoint: '#1B1400',
  dim: 'rgba(0,0,0,0.6)', dark: true,
  tone: {
    plain: ['#242422', '#B5B2AB'], stamp: ['#1A2A23', '#A9D6C2'], nap: ['#1B2340', '#7B9BFF'],
    sun: ['#3A2E14', '#F2C66B'], rain: ['#1E2833', '#9BB7D6'], festival: ['#3A1E19', '#F0A08F'],
    air: ['#3A2219', '#F2A27E'], warn: ['#3A1A1B', '#FF6369'], ok: ['#16301F', '#3DD68C'],
  },
  bar: { drive: '#5E5B55', stay: '#7DB59C', nap: '#5A6FA8', napStripe: '#7A8DC4', home: '#C99A3E', track: '#242422', markSun: '#E8902A', markSunText: '#F0A54A' },
};
export type Theme = typeof light;
export type ToneName = 'plain' | 'stamp' | 'nap' | 'sun' | 'rain' | 'festival' | 'air' | 'warn' | 'ok';

// ---- 화면 모드: 시스템 설정 따름(기본) · 밝게 · 어둡게 ('우리 차' 탭 → 이 폰 설정, 이 폰에만 저장) ----
// 앱 전체가 useTheme()을 거치므로 바꾸면 바로 다시 그려진다(상태 표시줄·지도·시트 포함).
// 안드로이드 쪽(키보드·시스템 창)도 맞추려고 Appearance.setColorScheme도 같이 부른다.
export type ThemeMode = 'system' | 'light' | 'dark';
const MODE_KEY = 'milestamp_theme_mode';
let mode: ThemeMode = 'system';
const modeSubs = new Set<() => void>();
const modeSub = (f: () => void) => { modeSubs.add(f); return () => { modeSubs.delete(f); }; };
const getMode = () => mode;
function applyMode(next: ThemeMode) {
  if (next !== mode) { mode = next; modeSubs.forEach((f) => f()); }
  try { Appearance.setColorScheme(next === 'system' ? 'unspecified' : next); } catch {}
}

/** 저장된 화면 모드 읽기 (앱 켤 때 한 번). 없으면 시스템 설정 따름 */
export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const v = await SecureStore.getItemAsync(MODE_KEY);
    if (v === 'light' || v === 'dark') applyMode(v);
  } catch {}
  return mode;
}

/** 고르기: 바로 반영하고 저장 */
export function setThemeMode(next: ThemeMode) {
  applyMode(next);
  SecureStore.setItemAsync(MODE_KEY, next).catch(() => {});
}

/** 지금 고른 화면 모드 (설정 줄 표시용) */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(modeSub, getMode, getMode);
}

export function useTheme(): Theme {
  const sys = useColorScheme();
  const m = useThemeMode();
  return (m === 'system' ? sys === 'dark' : m === 'dark') ? dark : light;
}

export const F = {
  r: 'Pretendard-Regular', m: 'Pretendard-Medium', sb: 'Pretendard-SemiBold', b: 'Pretendard-Bold', xb: 'Pretendard-ExtraBold',
};

// 글자 단계: 크기·굵기로 위계를 만든다
export const TYPE = {
  display: { fontFamily: F.xb, fontSize: 28, lineHeight: 36, letterSpacing: -0.8 },
  title: { fontFamily: F.xb, fontSize: 22, lineHeight: 30, letterSpacing: -0.5 },
  num: { fontFamily: F.xb, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  h: { fontFamily: F.b, fontSize: 16, lineHeight: 23, letterSpacing: -0.2 },
  body: { fontFamily: F.m, fontSize: 15, lineHeight: 23 },
  sub: { fontFamily: F.r, fontSize: 14, lineHeight: 21 },
  /** 시각·보조. 정보 글씨는 13px 아래로 내리지 않는다 (11px 이하 금지) */
  cap: { fontFamily: F.sb, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: F.b, fontSize: 13, lineHeight: 17 },
  btn: { fontFamily: F.b, fontSize: 16, lineHeight: 20 },
  /** 다음 목적지 이름 (NextHero) */
  hero: { fontFamily: F.xb, fontSize: 24, lineHeight: 32, letterSpacing: -0.6 },
  /** 작은 버튼 줄 (ActionRow) */
  act: { fontFamily: F.b, fontSize: 14, lineHeight: 18 },
  /** 칩 */
  chip: { fontFamily: F.b, fontSize: 13, lineHeight: 17 },
} as const;
export type TypeName = keyof typeof TYPE;
/** 정보 글씨 최소 크기 */
export const MIN_TEXT = 13;

/** 모서리. 옛 이름(surface·btn·input·chip)도 그대로 둔다 */
export const R = { xs: 6, sm: 10, md: 14, lg: 20, sheet: 26, pill: 999, surface: 20, btn: 14, input: 14, chip: 999 };
/** 간격 — 10·14 같은 사이값 대신 이 단계로 */
export const S = { xxs: 2, xs: 4, s: 6, m: 8, l: 12, xl: 16, xxl: 20, sec: 24, page: 20 };
/** 크기 — 누르는 칸은 touch(44) 아래로 내리지 않는다 */
export const H = { touch: 44, act: 48, cta: 56, input: 50, chip: 28, badge: 40, badgeL: 48 };
/** 움직임(ms) — 누름 · 펼침·토스트 · 시트 열기/닫기 */
export const M = { fast: 150, base: 220, sheetIn: 280, sheetOut: 200 };

/**
 * 풍경 머리 색 (도장 그림의 연한 하늘 → 청회색 먼 산 → 세이지 초록 언덕).
 * 해는 포인트 노랑(#F2B230)과 일부러 다른 연노랑 — 노랑은 로고 점에만 규칙과 섞이지 않게 sun으로 따로.
 * text·text2는 그 하늘 위 인사 글씨 (낮 16:1 / 6.5:1, 노을 15:1 / 6.1:1, 밤 15:1 / 8.3:1).
 * 장면은 시각(해 뜸·해 짐)으로만 고른다. 다크 모드 낮·노을은 LAND_DIM(같은 그림, 어두운 물감 · 해는 그대로).
 * 아래쪽은 화면 배경(bg)으로 녹여 끝낸다.
 */
export type LandScene = 'day' | 'dusk' | 'night';
export const LAND: Record<LandScene, {
  sky: [string, string]; far: [string, string]; mid: [string, string]; near: [string, string]; sun: string; ground: string; text: string; text2: string;
}> = {
  day: { sky: ['#E7EFE6', '#F3F2EC'], far: ['#C8D9CD', '#A8C3B0'], mid: ['#8AAE96', '#78A083'], near: ['#5C876B', '#5F8A6E'], sun: '#F4D58A', ground: '#E8E4D6', text: '#111110', text2: '#55534E' },
  dusk: { sky: ['#F7E2CC', '#F6EEE3'], far: ['#D8CDBD', '#B4C5B2'], mid: ['#8FB19A', '#7CA287'], near: ['#5E8A6C', '#5E8A6C'], sun: '#F2B67C', ground: '#EDE6CC', text: '#111110', text2: '#55534E' },
  night: { sky: ['#151A22', '#22322C'], far: ['#2B3A3A', '#2B3A3A'], mid: ['#264034', '#264034'], near: ['#1B2923', '#1B2923'], sun: '#E8E4D6', ground: '#2E4A3D', text: '#F2F1EE', text2: '#B5B2AB' },
};

/** 다크 모드의 낮·노을 — 해는 그대로, 하늘·산은 저녁 그늘처럼 낮춘 색. 글씨는 밝게 (하늘 위 12:1 이상 / 7:1 이상). 밤은 LAND.night 그대로 */
export const LAND_DIM: Record<LandScene, (typeof LAND)['day']> = {
  day: { sky: ['#2C3B3A', '#1D2423'], far: ['#3A4E47', '#43594E'], mid: ['#3B5747', '#365141'], near: ['#2A4436', '#2C4638'], sun: '#E3C680', ground: '#26302A', text: '#F2F1EE', text2: '#C2BFB8' },
  dusk: { sky: ['#463631', '#262220'], far: ['#4A453F', '#3E5044'], mid: ['#3D5847', '#385343'], near: ['#2B4537', '#2B4537'], sun: '#E8A877', ground: '#2E2C25', text: '#F2F1EE', text2: '#C2BFB8' },
  night: LAND.night,
};

/**
 * 자랑 카드 — 수채 풍경(노을) + 따뜻한 종이색. 공유 이미지라 밝게·어둡게와 상관없이 늘 이 색.
 * fg 종이 위 17:1 · sub 7.0:1 · mute 4.9:1 · line 장식. ink는 도장 잉크 초록(로고 네모).
 */
export const BRAND = { bg: '#F7F1E6', fg: '#111110', sub: '#55534E', mute: '#6E6A62', line: '#E6DCC8', ink: '#2C4A3E', chip: '#EFE6D4' };
