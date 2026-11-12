// 도장 획득 화면 — 심플 안 (시안 proto/medal-fx/simple.html, 11/2). 이 화면만은 늘 어두운 색.
// 메달 = 금속 테두리(등급마다: 보통 은 · 희귀 금 · 축제 검정-금) + 앱이 새기는 테두리 글씨(Pretendard) + 도장 그림 안쪽만.
// 도장 그림 테두리에 구워 둔 글씨는 그림을 131%로 키워 안쪽 그림만 보이게 가린다(시안: 지름 240에 그림 안쪽 30 들여 · background-size 131%).
// 띠는 가는 원 하나 + 그 위를 9초에 한 바퀴 도는 빛 점 하나. 등급은 테두리 재질 + 메달 아래 작은 별(1·2·3) + 작은 글씨.
// 순서 (시안 proto/medal-fx/punch.html C '빛 모였다 펑'): 메달 가운데로 등급 색 빛이 0.4초 모였다가 펑
//   → 메달이 작게서 돌며 커졌다(0.2→1.1→1, −20°→3°→0) 자리 잡음. 터지는 순간 흰 번쩍임 · 빛줄기 한 번 퍼짐 ·
//   충격파 2겹 · 가루 크게 튐 · 진동 '톡톡 쿵' → 빛이 한 번 쓸고 지나감 → 별이 하나씩 '틱'(진동) → 카드·버튼.
//   움직임 줄이기면 바로 다 보이고 가벼운 진동 한 번.
// 아래로 내리면 '그날의 기록'(screens/Diary.tsx DiaryCard). 모두 찍기(short)에는 없음.
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Linking, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, RadialGradient, Rect as SvgRect, Stop, Text as SvgText, TextPath } from 'react-native-svg';
import type { TripEvent } from './api';
import { ALBUM, ALBUM_SECTIONS, clipFor, place } from './places';
import { Icon } from './icon';
import { F } from './theme';
import { MAX_W, tap, thud, tick } from './ui';
import { festivalArt, stampArt, useCatalogRev } from './catalog';
import { stampNo, W as WORDS } from './words';
import { STAMP_LINE } from './stampLines';
import { DiaryCard } from './screens/Diary';
import type { ComposeTarget, TipTarget } from './community';

const IMG = {
  glow: require('../assets/medal/glow.png'),
  shine: require('../assets/medal/shine.png'),
  shade: require('../assets/medal/shade.png'),
  bar: require('../assets/medal/bar.png'),
};

export type MedalInfo = {
  key: string; // 도장북 칸 (thearc_rain 포함)
  number?: number | null; // No.
  before?: number | null; // 모은 도장 수: 찍기 전
  after?: number | null; //                 찍은 뒤 (모르면 나중에 채워도 된다)
  /** 이 칸 몇 번째 방문인지 (1 = 처음). 이미 모은 칸(장소로 판단, 비 오는 날 디아크는 따로)이면 2 이상 → '다시 찍었어요' */
  visit?: number | null;
  /** 축제 한정 도장이면 그 축제 (검정-금 테두리·'축제 도장'). key는 축제 id */
  festival?: { id: string; name: string; season: string; placeId: string | null } | null;
  /** 이 도장을 받은 날 'YYYY-MM-DD' — 아래 '그날의 기록'. 없으면 일기 없음 */
  day?: string | null;
  /** 도장북에서 다시 보기 (이미 넣은 도장): 버튼 글이 '도장북으로', 모은 수가 오르지 않음 */
  view?: boolean;
};
export type Rect = { x: number; y: number; w: number; h: number };
/** 어떻게 닫혔나: 도장북에 넣기 · ✕ · 이야기 듣기 · 자세히(도장북에서 다시 볼 때: 찍은 날·머무는 시간 시트) · 함께에 자랑하기 */
export type MedalEnd = 'keep' | 'close' | 'listen' | 'info' | 'share';

/** '함께에 자랑하기' 올리기 창에 넘길 것 (서버가 이 가족의 도장 기록으로 다시 확인한다) */
export function medalShareTarget(m: MedalInfo): ComposeTarget {
  const fest = m.festival ?? null;
  const a = (fest ? ALBUM.find((x) => x.placeId === fest.placeId && !x.rare) : ALBUM.find((x) => x.key === m.key)) ?? ALBUM[0];
  if (fest) return { kind: 'stamp', placeId: fest.id, festivalId: fest.id, name: fest.name, artKey: fest.id, tier: 'legend' };
  return { kind: 'stamp', placeId: a.placeId, rare: !!a.rare, name: a.label, artKey: a.key, tier: a.rare ? 'rare' : 'common' };
}
/** 도장 받은 뒤 '이 곳 아이랑 어땠어요?' — 축제 도장은 안 물음 */
export function medalTipTarget(m: MedalInfo): TipTarget | null {
  if (m.festival) return null;
  const a = ALBUM.find((x) => x.key === m.key);
  return a ? { placeId: a.placeId, name: place(a.placeId)?.name ?? a.label } : null;
}

/** '이야기 듣기': 그 장소 소개를 처음부터 (이어 듣기 시트를 소식 하나처럼 연다) */
export function storyEvent(key: string): TripEvent {
  const placeId = ALBUM.find((x) => x.key === key)?.placeId ?? key;
  return { id: `story-${placeId}-${Date.now()}`, kind: 'intro', place_id: placeId, payload: { variant: 'FULL_60S', story: true }, created_at: new Date().toISOString() };
}

/**
 * medal이 있으면 연출을 띄운다.
 * - short: '모두 찍기'용 — 조금 빠르게, 버튼·일기 없이 저절로 넣기
 * - target: 도장북 칸 위치(창 기준). 주면 '도장북에 넣기'에서 메달이 그 칸으로 날아가 꽂힌다
 * - onDone: 다 끝나고 부른다 → 부르는 쪽이 medal을 null로 ('listen'이면 그 장소 이야기를 열어 준다)
 */
export function MedalOverlay({ medal, short, target, onDone }: {
  medal: MedalInfo | null; short?: boolean; target?: (key: string) => Promise<Rect | null>; onDone: (how: MedalEnd) => void;
}) {
  const keep = useRef<(() => void) | null>(null);
  return (
    // 뒤로 가기 = 도장북에 넣기
    <Modal visible={!!medal} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => keep.current?.()}>
      {medal && <Stage key={`${medal.key}:${medal.day ?? ''}`} m={medal} short={short} target={target} onDone={onDone} keepRef={keep} />}
    </Modal>
  );
}

// ---------- 등급 (시안 T 그대로) ----------
export type Tier = 'common' | 'rare' | 'legend';
export const TIER = {
  common: { stars: 1, label: '새 도장', ring: '도장', ink: '#E3E8EA', line: 'rgba(230,236,240,0.22)', text: '#2E3539', band: 'rgba(255,255,255,0.18)',
    metal: ['#F2F5F6', '#A7B0B5', '#E4E8EA', '#8D969C'], at: [0, 0.45, 0.6, 1] },
  rare: { stars: 2, label: '희귀 도장', ring: '희귀 도장', ink: '#ECD49A', line: 'rgba(240,214,150,0.25)', text: '#3D2A0C', band: 'rgba(255,255,255,0.18)',
    metal: ['#FBE9B0', '#B88B3E', '#F1D48A', '#93692A'], at: [0, 0.45, 0.6, 1] },
  legend: { stars: 3, label: '축제 도장', ring: '축제 도장', ink: '#E2CDFA', line: 'rgba(220,200,255,0.26)', text: '#ECD9A6', band: 'rgba(0,0,0,0.35)',
    metal: ['#6C6276', '#211D27', '#D4B46C', '#1B1820'], at: [0, 0.45, 0.62, 1] },
} as const;
/** 앱의 등급 → 메달 등급: 축제 한정 = 전설(검정-금·별 3) · 희귀(비 오는 날 등) = 금·별 2 · 그 밖 = 은·별 1 */
export const tierOf = (rare: unknown, festival: unknown): Tier => (festival ? 'legend' : rare ? 'rare' : 'common');

/** 테두리 글씨가 반원(약 255 단위, 지름 240 기준)에 들어가게 크기·자간을 줄이고, 그래도 길면 말줄임 */
export function fitRing(text: string, room = 255): { text: string; size: number; spacing: number } {
  const width = (s: string, size: number, sp: number) =>
    [...s].reduce((w, ch) => w + (ch === ' ' ? size * 0.3 : /[\x21-\x7e]/.test(ch) ? size * 0.58 : size * 0.95) + sp, 0);
  for (const [size, sp] of [[10.5, 3], [10.5, 2], [10, 1.5], [9.5, 1], [9, 0.8], [8.5, 0.5]] as const) {
    if (width(text, size, sp) <= room) return { text, size, spacing: sp };
  }
  let t = text;
  while (t.length > 4 && width(`${t}…`, 8.5, 0.5) > room) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, size: 8.5, spacing: 0.5 };
}

/** 메달 얼굴 하나 (테두리·글씨·그림). 크기 D. 빛 쓸기는 sweep(0→1)로 */
export function MedalFace({ D, tier, top, bottom, art, sweep }: {
  D: number; tier: Tier; top: string; bottom: string; art: any; sweep?: Animated.Value;
}) {
  const T = TIER[tier];
  const a = fitRing(top), b = fitRing(bottom);
  const inset = (D * 30) / 240;
  const inner = D - inset * 2;
  const big = inner * 1.31;
  const bar = D * 0.34;
  return (
    <View style={{ width: D, height: D }}>
      {/* 그림자 */}
      <Image fadeDuration={0} source={IMG.glow} pointerEvents="none"
        style={{ position: 'absolute', width: D * 1.3, height: D * 1.3, left: -D * 0.15, top: -D * 0.05, tintColor: '#000', opacity: 0.55 }} />
      <Svg width={D} height={D} viewBox="0 0 240 240" style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="metal" x1="0.15" y1="0" x2="0.85" y2="1">
            {T.metal.map((c, i) => <Stop key={i} offset={T.at[i]} stopColor={c} />)}
          </LinearGradient>
          <Path id="a1" d="M 21,120 A 99,99 0 0 1 219,120" />
          <Path id="a2" d="M 21,120 A 99,99 0 0 0 219,120" />
        </Defs>
        <Circle cx={120} cy={120} r={120} fill="url(#metal)" />
        {/* 위 밝은 테·아래 어두운 테 (시안 inset 그림자) */}
        <Circle cx={120} cy={120} r={119.3} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeDasharray="370 380" transform="rotate(200 120 120)" />
        <Circle cx={120} cy={120} r={119.3} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.4} strokeDasharray="300 450" transform="rotate(30 120 120)" />
        <Circle cx={120} cy={120} r={99} fill="none" stroke={T.band} strokeWidth={17} />
        <SvgText fill={T.text} fillOpacity={0.9} fontFamily={F.sb} fontSize={a.size} letterSpacing={a.spacing} textAnchor="middle" alignmentBaseline="central">
          <TextPath href="#a1" startOffset="50%">{a.text}</TextPath>
        </SvgText>
        <SvgText fill={T.text} fillOpacity={0.9} fontFamily={F.sb} fontSize={b.size} letterSpacing={b.spacing} textAnchor="middle" alignmentBaseline="central">
          <TextPath href="#a2" startOffset="50%">{b.text}</TextPath>
        </SvgText>
      </Svg>
      {/* 그림: 안쪽만 (구운 테두리 글씨는 바깥으로 밀려 가려짐) */}
      <View style={{ position: 'absolute', left: inset, top: inset, width: inner, height: inner, borderRadius: inner / 2, overflow: 'hidden', backgroundColor: '#1a1d1c' }}>
        <Image fadeDuration={0} source={art} style={{ position: 'absolute', width: big, height: big, left: (inner - big) / 2, top: (inner - big) / 2 }} />
        {/* 안쪽 그림자 */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: inner / 2, borderWidth: 2, borderColor: 'rgba(0,0,0,0.22)' }} />
      </View>
      {/* 빛 쓸기: 동그랗게 잘린 틀 안을 흰 띠가 한 번 지나간다 */}
      {sweep && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: D, height: D, borderRadius: D / 2, overflow: 'hidden' }}>
          <Animated.Image fadeDuration={0} source={IMG.shine} resizeMode="stretch" style={{
            position: 'absolute', width: bar, height: D * 1.4, top: -D * 0.2, left: 0, opacity: 0.75,
            transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-bar * 1.6, D + bar * 0.6] }) }, { rotate: '18deg' }],
          }} />
        </View>
      )}
    </View>
  );
}

/** 작은 별 (시안 clip-path 별 모양) */
function StarMark({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Polygon points="50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35" fill={color} />
    </Svg>
  );
}

// ---------- 펑! 연출 (시안 C) ----------
type Anim = Animated.Value | Animated.AnimatedInterpolation<number>;
/** 시계(ms) 하나에서 [t0, t0+dur] 구간의 진행(0→1)을 뽑는다. 곡선은 점 몇 개로 미리 찍어 둔다
 *  (네이티브 드라이버는 interpolate에 곡선 함수를 못 넘김). 효과마다 따로 delay를 걸면 JS 타이머라
 *  메달 화면을 그리느라 바쁠 때 서로 어긋나서 → 시계 하나로 모두 같은 박자. */
function seg(clock: Animated.Value, t0: number, dur: number, easing?: (x: number) => number, n = 10) {
  const xs = easing ? Array.from({ length: n + 1 }, (_, i) => i / n) : [0, 1];
  return clock.interpolate({
    inputRange: xs.map((x) => t0 + x * dur),
    outputRange: xs.map((x) => (easing ? easing(x) : x)),
    extrapolate: 'clamp',
  });
}
const FX_END = 1600; // 펑 연출 시계 끝(ms) = 터짐 400 + 가루 1200
/** 가루 하나의 길: 시안 캔버스 물리(프레임마다 중력 0.15·마찰 0.97)를 미리 계산해 몇 점만 뽑아 둔다 → 값 하나(0→1)로 모두 움직임 */
const DUST_F = [0, 3, 6, 10, 15, 20, 26, 33, 40, 48, 56, 64, 72]; // 뽑는 프레임 (60fps 기준 72프레임 = 1.2초)
const DUST_MS = 1200;
const DUST_IN = DUST_F.map((f) => f / 72);
const DUST_OP_IN = [0, 0.001, ...DUST_IN.slice(1)]; // 시작 전(0)에는 안 보이게
type Dust = { xs: number[]; ys: number[]; op: number[]; rot: string[]; size: number; color: string; sq: boolean };
export const DUST_N: Record<Tier, number> = { common: 45, rare: 75, legend: 110 };
/** 펑은 가루가 더 많고(1.3배) 더 빠르게(9) 튄다 (시안 dust(n*1.3, 9)) */
function makeDust(n: number, s: number, ink: string, speed = 9): Dust[] {
  const out: Dust[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * s * (0.5 + Math.random());
    let x = Math.cos(a) * 112 * s, y = Math.sin(a) * 112 * s, vx = Math.cos(a) * v, vy = Math.sin(a) * v - s;
    const life = 40 + Math.random() * 30, g = 0.15 * s;
    const xs: number[] = [], ys: number[] = [], op: number[] = [], rot: string[] = [];
    for (let f = 0, k = 0; f <= 72; f++) {
      if (f === DUST_F[k]) {
        xs.push(x); ys.push(y);
        op.push(Math.max(0, Math.min(1, (life - f) / 25)));
        rot.push(`${Math.round(f * 11.5)}deg`); // 시안: 프레임마다 0.2rad
        k++;
      }
      vy += g; vx *= 0.97; vy *= 0.97; x += vx; y += vy;
    }
    out.push({ xs, ys, op, rot, size: 1.5 + Math.random() * 2.6, color: Math.random() < 0.65 ? ink : '#fff', sq: Math.random() < 0.3 });
  }
  return out;
}
/** 가루 층: 메달 가운데(0,0) 기준. p 하나(0→1)로 전부 (네이티브 드라이버) */
function DustLayer({ dust, p }: { dust: Dust[]; p: Animated.AnimatedInterpolation<number> }) {
  return (
    <>
      {dust.map((d, i) => {
        const w = d.size * 2, h = d.sq ? d.size : d.size * 2;
        return (
          <Animated.View key={i} style={{
            position: 'absolute', left: -w / 2, top: -h / 2, width: w, height: h, borderRadius: d.sq ? 0.5 : d.size, backgroundColor: d.color,
            opacity: p.interpolate({ inputRange: DUST_OP_IN, outputRange: [0, ...d.op] }),
            transform: [
              { translateX: p.interpolate({ inputRange: DUST_IN, outputRange: d.xs }) },
              { translateY: p.interpolate({ inputRange: DUST_IN, outputRange: d.ys }) },
              ...(d.sq ? [{ rotate: p.interpolate({ inputRange: DUST_IN, outputRange: d.rot }) }] : []),
            ],
          }} />
        );
      })}
    </>
  );
}

/** 모이는 빛: 지름 d 점 + 둘레로 번지는 빛 (시안 box-shadow 0 0 40px 18px). 가운데(0,0) 기준 */
function ChargeDot({ d, ink }: { d: number; ink: string }) {
  const R = d / 2 + (d * 58) / 30; // 점 + 퍼짐 18 + 흐림 40 (점 30 기준)
  const S = R * 2;
  return (
    <Svg width={S} height={S} style={{ position: 'absolute', left: -R, top: -R }}>
      <Defs>
        <RadialGradient id="charge" cx={R} cy={R} r={R} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={ink} stopOpacity={1} />
          <Stop offset={d / 2 / R} stopColor={ink} stopOpacity={1} />
          <Stop offset={(d / 2 + (d * 18) / 30) / R} stopColor={ink} stopOpacity={0.55} />
          <Stop offset={1} stopColor={ink} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={R} cy={R} r={R} fill="url(#charge)" />
    </Svg>
  );
}
/** 빛줄기: 15°마다 2° 굵기 줄 24개 (시안 repeating-conic-gradient). 안쪽 22%까지 비우고 23%에서 진했다가 60%에서 사라지는 고리 (시안 mask) */
function Rays({ D, ink }: { D: number; ink: string }) {
  const c = D / 2;
  const far = c * Math.SQRT2; // CSS radial-gradient 기본 크기 = 가장 먼 모서리
  const r = far * 0.6;
  const d = Array.from({ length: 24 }, (_, i) => {
    const a0 = ((i * 15 - 90) * Math.PI) / 180, a1 = ((i * 15 + 2 - 90) * Math.PI) / 180;
    return `M${c},${c}L${c + r * Math.cos(a0)},${c + r * Math.sin(a0)}L${c + r * Math.cos(a1)},${c + r * Math.sin(a1)}Z`;
  }).join('');
  return (
    <Svg width={D} height={D}>
      <Defs>
        <RadialGradient id="rays" cx={c} cy={c} r={far} gradientUnits="userSpaceOnUse">
          <Stop offset={0.22} stopColor={ink} stopOpacity={0} />
          <Stop offset={0.23} stopColor={ink} stopOpacity={1} />
          <Stop offset={0.6} stopColor={ink} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Path d={d} fill="url(#rays)" />
    </Svg>
  );
}

/** 장소 지도: 카카오맵 앱 → 없으면 카카오맵 웹 */
async function openMap(name: string) {
  const q = encodeURIComponent(name);
  try { await Linking.openURL(`kakaomap://search?q=${q}`); }
  catch { Linking.openURL(`https://map.kakao.com/link/search/${q}`).catch(() => {}); }
}

function Stage({ m, short, target, onDone, keepRef }: {
  m: MedalInfo; short?: boolean; target?: (key: string) => Promise<Rect | null>; onDone: (how: MedalEnd) => void;
  keepRef: { current: (() => void) | null };
}) {
  useCatalogRev(); // 서버 도장 그림을 받으면 다시 그림
  const { width: W, height: H } = useWindowDimensions();
  const ins = useSafeAreaInsets();
  const fest = m.festival ?? null;
  // 축제면 붙은 명소 칸(없으면 첫 칸)을 바탕으로 이름·그림만 축제 것
  const a = (fest ? ALBUM.find((x) => x.placeId === fest.placeId && !x.rare) : ALBUM.find((x) => x.key === m.key)) ?? ALBUM[0];
  const rare = fest ? undefined : a.rare;
  const tier = tierOf(rare, fest);
  const TT = TIER[tier];
  const art = fest ? festivalArt(fest) : stampArt(a.key);
  const visit = m.visit ?? 1;
  const again = !m.view && visit > 1; // 이미 모은 칸: 숫자는 안 오르고 'N번째 방문'
  const k = short ? 0.7 : 1; // 모두 찍기는 조금 빠르게
  const at = (ms: number) => Math.round(ms * k);
  const title = fest ? fest.name : a.label;
  const ringTop = `${TT.ring} · ${title}`;
  const sub = fest ? (fest.season ? `${fest.season} 한정` : '기간 한정') : STAMP_LINE[a.key] ?? ALBUM_SECTIONS.find((x) => x.key === a.section)?.title ?? '';
  const ringBottom = [m.number ? `제${m.number}호` : '', sub].filter(Boolean).join(' · ') || '마일스탬프';
  const diary = !short && !!m.day;

  // 자리 (시안 390×844 기준): 메달 가운데 30% 높이, 지름 240 → 화면에 맞춤
  const MED = Math.round(Math.min(240, W * 0.6, H * 0.29));
  const ringD = Math.round((MED * 292) / 240);
  const cx = W / 2, cy = Math.round(H * 0.3);
  const ctaBottom = 24 + ins.bottom;
  const hintH = diary ? 30 : 0;
  const cardBottom = ctaBottom + 58 + 18 + hintH;
  const side = Math.max(16, (W - MAX_W) / 2); // 넓은 화면: 카드·버튼은 본문 폭까지, 가운데

  const V = useRef({
    clock: new Animated.Value(0), ring: new Animated.Value(0), sweep: new Animated.Value(0), spin: new Animated.Value(0),
    ready: new Animated.Value(0), card: new Animated.Value(0), cta: new Animated.Value(0),
    stars: [0, 1, 2].map(() => new Animated.Value(0)),
    bump: new Animated.Value(1), out: new Animated.Value(1), fly: new Animated.Value(0),
  }).current;
  // 펑!: 시계(ms) 하나에서 — 빛 모임(0~400) · 메달 돌며 커짐(350부터 0.8초, 시안 keyframes 0·70·100% 구간마다 같은 곡선)
  //   · 터지는 순간(400) 번쩍임 · 빛줄기 · 충격파 2겹 · 가루
  const HIT = 400, POP = 350, POP_MS = 800;
  const popEase = Easing.bezier(0.16, 0.9, 0.3, 1.2);
  const X = useRef({
    charge: seg(V.clock, 0, HIT, Easing.in(Easing.ease)), // 가운데로 빛이 모임
    pop1: seg(V.clock, POP, POP_MS * 0.7, popEase, 16), // 0.2→1.1, −20°→3°
    pop2: seg(V.clock, POP + POP_MS * 0.7, POP_MS * 0.3, popEase), // 1.1→1, 3°→0
    flash: seg(V.clock, HIT, 500, Easing.out(Easing.quad)), // 흰 번쩍임
    rays: seg(V.clock, HIT, 1100, Easing.out(Easing.ease)), // 빛줄기 한 번
    wave1: seg(V.clock, HIT, 900, Easing.bezier(0.1, 0.7, 0.3, 1)), // 충격파 2겹
    wave2: seg(V.clock, HIT + 120, 900, Easing.bezier(0.1, 0.7, 0.3, 1)),
    dust: seg(V.clock, HIT, DUST_MS), // 가루
  }).current;
  // 가루는 처음 한 번만 만든다 (일기 내리기로 다시 그려져도 같은 가루)
  const dust = useRef<Dust[] | null>(null);
  if (!dust.current) dust.current = makeDust(Math.round(DUST_N[tier] * 1.3), MED / 240, TT.ink);
  const [fx, setFx] = useState(true); // 펑 연출이 끝나면 빛·가루·충격파 층을 없앤다
  const pg = useRef(new Animated.Value((m.before ?? 0) / ALBUM.length)).current; // 모은 도장 막대 (폭이라 JS)
  const [bumped, setBumped] = useState(false);
  const [hot, setHot] = useState(false);
  const [exit, setExit] = useState<{ how: MedalEnd; to?: { dx: number; dy: number; s: number } } | null>(null);
  const scrollY = useRef(0);
  const scrollV = useRef(new Animated.Value(0)).current; // 일기로 내리면 아래 고정 버튼은 사라지고 일기 끝의 버튼으로
  const [deep, setDeep] = useState(false);

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const loops: Animated.CompositeAnimation[] = [];
    AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduce) => {
      if (!alive) return;
      if (reduce) {
        // 움직임 줄이기: 빛 모임·빛줄기·가루 없이 바로 다 보이고 빛 점은 위에 멈춤, 가벼운 진동 한 번
        [V.ring, V.ready, V.card, V.cta, ...V.stars].forEach((v) => v.setValue(1));
        V.clock.setValue(FX_END);
        setFx(false);
        tap();
        setBumped(true);
        if (short) timers.push(setTimeout(() => keep(), 900));
        return;
      }
      const T = (v: Animated.Value, delay: number, duration: number, easing: (x: number) => number = Easing.out(Easing.cubic)) =>
        Animated.timing(v, { toValue: 1, delay: at(delay), duration: at(duration), easing, useNativeDriver: true });
      Animated.parallel([
        // 펑 시계: 지연 없이 바로 네이티브에서 (모두 찍기는 조금 빠르게)
        Animated.timing(V.clock, { toValue: FX_END, duration: at(FX_END), easing: Easing.linear, useNativeDriver: true }),
        T(V.ring, 600, 1000, Easing.inOut(Easing.ease)),
        T(V.sweep, 900, 1300, Easing.bezier(0.4, 0, 0.2, 1)), // 빛 한 번
        T(V.ready, 1400, 800, Easing.inOut(Easing.ease)),
        T(V.card, 1900, 700, Easing.bezier(0.2, 0.8, 0.2, 1)),
        T(V.cta, 2200, 500, Easing.out(Easing.ease)),
      ]).start();
      // 펑: 톡 톡 쿵 (시안 vibrate [20,20,80])
      timers.push(setTimeout(tap, at(HIT)), setTimeout(tap, at(HIT + 60)), setTimeout(thud, at(HIT + 130)));
      timers.push(setTimeout(() => { if (alive) setFx(false); }, at(FX_END) + 100));
      timers.push(setTimeout(tap, at(900)));
      // 별이 하나씩 '틱'
      V.stars.slice(0, TT.stars).forEach((v, i) => {
        timers.push(setTimeout(() => {
          tick();
          Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 }).start();
        }, at(1300 + i * 200)));
      });
      // 빛 점: 9초에 한 바퀴
      const spin = Animated.loop(Animated.timing(V.spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }));
      spin.start(); loops.push(spin);
      // 그 뒤로 7초마다 빛이 한 번 더 (시안과 같음)
      const again7 = Animated.loop(Animated.sequence([
        Animated.delay(7000),
        Animated.timing(V.sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.timing(V.sweep, { toValue: 1, duration: 1300, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
      ]));
      timers.push(setTimeout(() => { if (alive) { again7.start(); loops.push(again7); } }, at(2300)));
      timers.push(setTimeout(() => setBumped(true), at(1700)));
      if (short) timers.push(setTimeout(() => keep(), at(2400)));
    });
    return () => { alive = false; timers.forEach(clearTimeout); loops.forEach((l) => l.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 모은 도장: 막대가 전 → 후로 자라고, 숫자는 그때 올라감 (찍은 뒤 수를 아직 모르면 알게 된 때)
  useEffect(() => {
    if (!bumped) { pg.setValue((m.before ?? 0) / ALBUM.length); return; }
    if (m.after == null) return;
    Animated.timing(pg, { toValue: m.after / ALBUM.length, duration: 900, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: false }).start();
  }, [bumped, m.after, m.before, pg]);
  const shownCount = bumped && m.after != null ? m.after : m.before;
  const didBump = useRef(false);
  useEffect(() => {
    if (!bumped || m.after == null || didBump.current) return;
    didBump.current = true;
    if (again || m.view || m.after === m.before) return;
    setHot(true);
    V.bump.setValue(1.6);
    Animated.spring(V.bump, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 12 }).start();
    const t = setTimeout(() => setHot(false), 450);
    return () => clearTimeout(t);
  }, [bumped, m.after, m.before, m.view, V.bump, again]);

  const left = useRef(false);
  const end = async (how: MedalEnd) => {
    if (left.current) return;
    left.current = true;
    Animated.timing(V.out, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const r = how === 'keep' && target ? await target(m.key).catch(() => null) : null;
    const y = cy - scrollY.current; // 일기를 보느라 내렸으면 메달은 그만큼 위에 있다
    setExit({ how, to: r && r.w > 0 ? { dx: r.x + r.w / 2 - cx, dy: r.y + r.h / 2 - y, s: r.w / MED } : undefined });
  };
  const keep = () => end('keep');
  keepRef.current = keep;
  useEffect(() => {
    if (!exit) return;
    const anim = exit.to
      ? Animated.timing(V.fly, { toValue: 1, duration: 650, easing: Easing.bezier(0.5, 0, 0.2, 1), useNativeDriver: true })
      : Animated.timing(V.fly, { toValue: 1, duration: 260, useNativeDriver: true });
    anim.start(() => onDone(exit.how));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exit]);

  const fade = { opacity: V.out };
  const fadeIn = (v: Anim, extra?: object) => ({ opacity: Animated.multiply(v, V.out), ...extra });
  const fly = !exit ? {}
    : !exit.to
      ? { opacity: V.fly.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ scale: V.fly.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) }] }
      : { transform: [
          { translateX: V.fly.interpolate({ inputRange: [0, 1], outputRange: [0, exit.to.dx] }) },
          { translateY: V.fly.interpolate({ inputRange: [0, 1], outputRange: [0, exit.to.dy] }) },
          { scale: V.fly.interpolate({ inputRange: [0, 1], outputRange: [1, exit.to.s] }) },
        ] };
  const placeName = fest ? fest.name : place(a.placeId)?.name ?? a.label;
  const tierText = again ? '또 왔어요' : TT.label;

  // 버튼: 어두운 바탕 위 = 밝게, 일기 종이 위(dark) = 어둡게
  const ctaButton = (dark = false) => (
    <Pressable onPress={keep} disabled={!!exit} accessibilityRole="button"
      style={({ pressed }) => ({ height: 58, borderRadius: 18, backgroundColor: dark ? '#1C1C1A' : '#F2F2EF', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Icon name="stamp" size={20} color={dark ? '#fff' : '#111110'} strokeWidth={2.2} />
      <Text style={{ fontFamily: F.xb, fontSize: 17, lineHeight: 22, color: dark ? '#fff' : '#111110' }}>{m.view ? '도장북으로' : '도장북에 넣기'}</Text>
      <Icon name="chevron-right" size={20} color={dark ? '#fff' : '#111110'} strokeWidth={2.2} />
    </Pressable>
  );

  const popIn = X.pop1.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }); // 곡선이 1을 넘쳐도 불투명도는 1까지
  const raysD = Math.round((MED * 560) / 240);
  const dotD = (MED * 30) / 240;
  const hero = (
    <View style={{ height: H }}>
      {/* 메달 자리 */}
      <View style={{ position: 'absolute', width: MED, height: MED, left: cx - MED / 2, top: cy - MED / 2 }}>
        {/* 빛줄기: 0.6→1.25배로 퍼지며 25° 돌고 1.1초에 사라짐 */}
        {fx && (
          <Animated.View pointerEvents="none" style={{
            position: 'absolute', left: (MED - raysD) / 2, top: (MED - raysD) / 2, width: raysD, height: raysD,
            opacity: X.rays.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, 0.55, 0] }),
            transform: [
              { scale: X.rays.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.25] }) },
              { rotate: X.rays.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '25deg'] }) },
            ],
          }}>
            <Rays D={raysD} ink={TT.ink} />
          </Animated.View>
        )}
        {/* 모이는 빛: 작은 점이 커지며 밝아졌다(.2→1.4) 펑 하고 번지며 사라짐(→3) */}
        {fx && (
          <Animated.View pointerEvents="none" style={{
            position: 'absolute', left: MED / 2, top: MED / 2, width: 0, height: 0,
            opacity: X.charge.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0, 1, 0] }),
            transform: [{ scale: X.charge.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.2, 1.4, 3] }) }],
          }}>
            <ChargeDot d={dotD} ink={TT.ink} />
          </Animated.View>
        )}
        {/* 충격파 2겹: 메달 가장자리에서 1.9배까지 퍼지며 사라짐 */}
        {fx && [X.wave1, X.wave2].map((v, i) => (
          <Animated.View key={i} pointerEvents="none" style={{
            position: 'absolute', left: 0, top: 0, width: MED, height: MED, borderRadius: MED / 2, borderWidth: 3, borderColor: TT.ink,
            opacity: v.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, 0.9, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.9] }) }],
          }} />
        ))}
        {/* 가는 원 하나 + 도는 빛 점 하나 */}
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: ringD, height: ringD, left: (MED - ringD) / 2, top: (MED - ringD) / 2 }, fadeIn(V.ring)]}>
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: ringD / 2, borderWidth: 1, borderColor: TT.line }} />
          <Animated.View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, transform: [{ rotate: V.spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
            <View style={{ position: 'absolute', left: ringD / 2 - 7, top: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: TT.ink, opacity: 0.18 }} />
            <View style={{ position: 'absolute', left: ringD / 2 - 2.6, top: -2.6, width: 5.2, height: 5.2, borderRadius: 2.6, backgroundColor: TT.ink }} />
          </Animated.View>
        </Animated.View>
        <Animated.View style={[{ width: MED, height: MED }, fly]}>
          <Animated.View accessible accessibilityLabel={`${TT.label}, ${title}${m.number ? `, ${stampNo(m.number)}` : ''}`}
            style={{ opacity: popIn, transform: [
              { scale: X.pop1.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.1], extrapolate: 'extend' }) },
              { rotate: X.pop1.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '3deg'], extrapolate: 'extend' }) },
            ] }}>
            {/* 넘친 1.1·3° → 1·0° (시안 keyframes 70→100%) */}
            <Animated.View style={{ transform: [
              { scale: X.pop2.interpolate({ inputRange: [0, 1], outputRange: [1, 1 / 1.1], extrapolate: 'extend' }) },
              { rotate: X.pop2.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-3deg'], extrapolate: 'extend' }) },
            ] }}>
              <MedalFace D={MED} tier={tier} top={ringTop} bottom={ringBottom} art={art} sweep={V.sweep} />
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </View>

      {/* 가루: 메달 테두리에서 사방으로 튀고 아래로 떨어짐 */}
      {fx && (
        <View pointerEvents="none" style={{ position: 'absolute', left: cx, top: cy, width: 0, height: 0 }}>
          <DustLayer dust={dust.current} p={X.dust} />
        </View>
      )}
      {/* 메달 아래: 작은 별 + 작은 등급 글씨 */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: cy + ringD / 2 + 4, alignItems: 'center' }, fade]}>
        <View style={{ flexDirection: 'row', gap: 5, height: 14 }}>
          {V.stars.slice(0, TT.stars).map((v, i) => (
            <Animated.View key={i} style={{ opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
              <StarMark color={TT.ink} />
            </Animated.View>
          ))}
        </View>
        <Animated.Text style={{ marginTop: 8, fontFamily: F.sb, fontSize: 13, lineHeight: 17, letterSpacing: 0.3, color: TT.ink, opacity: V.ready }}>{tierText}</Animated.Text>
      </Animated.View>

      {/* 유리 카드 */}
      <Animated.View style={[{
        position: 'absolute', left: side, right: side, bottom: cardBottom, borderRadius: 22, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14,
        backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
      }, fadeIn(V.card, { transform: [{ translateY: V.card.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] })]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: F.m, fontSize: 12.5, lineHeight: 17, color: '#8F9792' }} numberOfLines={1}>
              {[fest ? `${fest.season || '축제'} · 기간 한정` : ALBUM_SECTIONS.find((x) => x.key === a.section)?.title ?? '대구·경북 시즌 1', m.number ? stampNo(m.number) : ''].filter(Boolean).join(' · ')}
            </Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: F.b, fontSize: 24, lineHeight: 31, letterSpacing: -0.6, color: '#fff', marginTop: 3 }}>{title}</Text>
            {(again || (!fest && rare)) && (
              <Text style={{ fontFamily: F.m, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.66)', marginTop: 1 }}>
                {again ? `다시 찍었어요 · ${visit}번째 방문` : `희귀 · ${rare}`}
              </Text>
            )}
          </View>
          {!short && !fest && !!clipFor(a.placeId) && (
            <Pressable onPress={() => end('listen')} disabled={!!exit} accessibilityRole="button" accessibilityLabel={`${a.label} 이야기 ${WORDS.listen}`}
              style={({ pressed }) => ({ height: 44, borderRadius: 22, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: pressed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' })}>
              <Icon name="headphones" size={16} color="#fff" strokeWidth={2.2} />
              <Text style={{ fontFamily: F.b, fontSize: 13, color: '#fff' }}>{WORDS.listen}</Text>
            </Pressable>
          )}
        </View>
        <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 12, marginBottom: 10 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: F.m, fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>도장북</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Animated.Text style={{ fontFamily: F.b, fontSize: 14.5, color: hot ? TT.ink : '#fff', fontVariant: ['tabular-nums'], transform: [{ scale: V.bump }] }}>{shownCount ?? '–'}</Animated.Text>
            <Text style={{ fontFamily: F.m, fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>/{ALBUM.length}칸</Text>
          </View>
        </View>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', marginTop: 8, overflow: 'hidden' }}>
          <Animated.View style={{ height: 5, borderRadius: 3, overflow: 'hidden', width: pg.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }}>
            <Image fadeDuration={0} source={IMG.bar} resizeMode="stretch" style={{ width: '100%', height: 5 }} />
          </Animated.View>
        </View>
        {/* 함께에 자랑하기 (모두 찍기 중에는 없음) */}
        {!short && (
          <Pressable onPress={() => end('share')} disabled={!!exit} accessibilityRole="button" accessibilityLabel="함께에 자랑하기"
            style={({ pressed }) => ({ height: 44, borderRadius: 14, marginTop: 12, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
              backgroundColor: pressed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' })}>
            <Icon name="users" size={16} color="#fff" strokeWidth={2.2} />
            <Text style={{ fontFamily: F.b, fontSize: 14, color: '#fff' }}>함께에 자랑하기</Text>
          </Pressable>
        )}
      </Animated.View>

      {/* ⌄ 그날의 기록 */}
      {diary && (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, bottom: ctaBottom + 58 + 8, height: hintH, alignItems: 'center', justifyContent: 'center' }, fadeIn(V.cta)]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="chevron-down" size={15} color="#8F9792" />
            <Text style={{ fontFamily: F.m, fontSize: 12.5, color: '#8F9792' }}>그날의 기록</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      {/* 바탕: 같은 도장 그림을 크게·아주 흐리고 어둡게 + 가장자리 어둡게 (넣기·닫기 때 같이 사라져 메달이 도장북 위로 날아간다) */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#0D1110' }, fade]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -60, top: -60, right: -60, bottom: -60, transform: [{ scale: 1.15 }] }, fade]}>
        <Image fadeDuration={0} source={art} blurRadius={22} resizeMode="cover" style={{ position: 'absolute', width: '100%', height: '100%' }} />
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: 0.62 }} />
      </Animated.View>
      <Animated.Image fadeDuration={0} source={IMG.shade} resizeMode="stretch" pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H }, fade]} />

      {diary ? (
        <Animated.ScrollView showsVerticalScrollIndicator={false} scrollEventThrottle={16} scrollEnabled={!exit}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollV } } }], {
            useNativeDriver: true,
            listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
              const y = e.nativeEvent.contentOffset.y;
              scrollY.current = y;
              const d = y > H * 0.35;
              setDeep((v) => (v === d ? v : d));
            },
          })}>
          {hero}
          <Animated.View style={fade}>
            <DiaryCard day={m.day!} bottomPad={ins.bottom + 24}
              footer={<View style={{ marginTop: 22 }}>{ctaButton(true)}</View>} />
          </Animated.View>
        </Animated.ScrollView>
      ) : hero}

      {/* 흰 번쩍임: 메달 자리에서 퍼지는 둥근 빛 (닿는 순간 1 → 0.5초에 0) */}
      {fx && (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, opacity: X.flash.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, 1, 0] }) }}>
          <Svg width={W} height={H}>
            <Defs>
              <RadialGradient id="flash" cx={cx} cy={cy} r={0.6 * Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))} gradientUnits="userSpaceOnUse">
                <Stop offset={0} stopColor="#fff" stopOpacity={0.9} />
                <Stop offset={1} stopColor="#fff" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <SvgRect x={0} y={0} width={W} height={H} fill="url(#flash)" />
          </Svg>
        </Animated.View>
      )}

      {/* 위: 닫기 · 지도 (모두 찍기 중에는 없음) */}
      {!short && (
        <Animated.View style={[{ position: 'absolute', top: ins.top + 6, left: side, right: side, flexDirection: 'row', justifyContent: 'space-between' }, fadeIn(popIn)]}>
          <Pressable onPress={() => end('close')} disabled={!!exit} hitSlop={8} accessibilityLabel="닫기"
            style={({ pressed }) => [glass, { width: 44, paddingHorizontal: 0, opacity: pressed ? 0.7 : 1 }]}>
            <Icon name="x" size={20} color="#fff" strokeWidth={2.2} />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {m.view && (
              <Pressable onPress={() => end('info')} disabled={!!exit} accessibilityRole="button" accessibilityLabel="도장 자세히" style={({ pressed }) => [glass, { opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ fontFamily: F.b, fontSize: 13.5, color: '#fff' }}>자세히</Text>
              </Pressable>
            )}
            <Pressable onPress={() => openMap(placeName)} accessibilityRole="link" accessibilityLabel="지도 앱에서 보기" style={({ pressed }) => [glass, { flexDirection: 'row', gap: 6, opacity: pressed ? 0.7 : 1 }]}>
              <Icon name="map" size={18} color="#fff" strokeWidth={2.2} />
              <Text style={{ fontFamily: F.b, fontSize: 13.5, color: '#fff' }}>지도 보기</Text>
              <Icon name="external-link" size={14} color="rgba(255,255,255,0.8)" strokeWidth={2.2} />
            </Pressable>
          </View>
        </Animated.View>
      )}

      {/* 아래: 도장북에 넣기 (일기로 내리면 사라지고 일기 끝에 같은 버튼) */}
      {!short && (
        <Animated.View pointerEvents={deep ? 'none' : 'auto'} style={[{ position: 'absolute', left: side, right: side, bottom: ctaBottom },
          fadeIn(V.cta, { transform: [{ translateY: V.cta.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }),
          diary ? { opacity: Animated.multiply(Animated.multiply(V.cta, V.out), scrollV.interpolate({ inputRange: [H * 0.15, H * 0.35], outputRange: [1, 0], extrapolate: 'clamp' })) } : null]}>
          {ctaButton()}
        </Animated.View>
      )}
    </View>
  );
}

const glass = {
  height: 44, minWidth: 44, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: 'rgba(10,20,16,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
};
