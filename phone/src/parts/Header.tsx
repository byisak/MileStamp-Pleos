// 머리 — 날짜 · 인사 + 수채 풍경(낮·노을·밤). 도장 그림과 같은 결: 연한 하늘 → 청회색 먼 산 → 세이지 초록 언덕.
// 같은 색을 옅게 두 번 겹쳐 칠해 물감 번진 느낌을 내고, 아래쪽은 화면 배경(bg)으로 녹여 카드와 경계가 생기지 않게 한다.
// 인사 글씨는 풍경 위가 아니라 왼쪽 빈 하늘 위 (산 진한 부분 위면 대비가 떨어짐).
// 장면은 시각으로만(낮·노을·밤). 다크 모드면 낮·노을을 어두운 물감(LAND_DIM)으로 — 해는 그대로, 달은 밤에만.
// 움직임 없음(정지 그림) — '움직임 줄이기'와 상관없이 안전.
// 밤 하늘의 달은 오늘 실제 모양(moon.ts, 폰에서 계산). 날짜 줄 끝에 지금 기온 칩(skyNow.ts, 모르면 숨김).
import { ReactNode, useId } from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Cloud, CloudDrizzle, CloudRain, Moon, Snowflake, Sun } from 'lucide-react-native';
import { moonLitPath, moonPhase, type MoonPhase } from '../moon';
import type { SkyNow } from '../skyNow';
import { H, LAND, LAND_DIM, LandScene, S, TYPE, useTheme } from '../theme';

const VB_W = 400, VB_H = 200;

/** 지금 시각(·해 뜸·해 짐 분)으로 장면 고르기 — 다크 모드와 상관없음. 밤(해 지고 20분 뒤 ~ 해 뜨기 전)엔 달, 그 밖엔 해 */
export function sceneFor(now: Date, sunsetMin?: number | null, sunriseMin?: number | null): LandScene {
  const m = now.getHours() * 60 + now.getMinutes();
  const sunset = sunsetMin ?? 18 * 60;
  const sunrise = sunriseMin ?? 5 * 60;
  if (m < sunrise || m >= sunset + 20) return 'night';
  if (m >= sunset - 90) return 'dusk';
  return 'day';
}

/** 밤 하늘 달 — 어두운 쪽은 아주 옅게(지구 반사광), 밝은 쪽은 오늘 모양대로 */
function MoonDisc({ m, cx, cy, r, color }: { m: MoonPhase; cx: number; cy: number; r: number; color: string }) {
  const lit = moonLitPath(m, cx, cy, r);
  return (
    <>
      <Circle cx={cx} cy={cy} r={r + 9} fill={color} opacity={0.05 + 0.07 * m.lit} />
      <Circle cx={cx} cy={cy} r={r} fill={color} opacity={0.13} />
      {lit && <Path d={lit} fill={color} opacity={0.94} />}
    </>
  );
}

export function Landscape({ scene, height = 210, bg, moon, dim }: {
  scene: LandScene; height?: number; bg: string;
  /** 밤에 그릴 달 (기본: 지금 모양) */
  moon?: MoonPhase;
  /** 어두운 물감 (다크 모드의 낮·노을) */
  dim?: boolean;
}) {
  const c = (dim ? LAND_DIM : LAND)[scene];
  const m = moon ?? moonPhase(new Date());
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const night = scene === 'night';
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax slice">
      <Defs>
        <LinearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.sky[0]} />
          <Stop offset="1" stopColor={c.sky[1]} />
        </LinearGradient>
        <LinearGradient id={`fade${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={bg} stopOpacity="0" />
          <Stop offset="1" stopColor={bg} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={VB_W} height={VB_H} fill={`url(#sky${id})`} />

      {/* 해(연노랑 — 포인트 노랑과 다른 색) / 달 + 별 */}
      {night ? (
        <>
          <MoonDisc m={m} cx={322} cy={50} r={15} color={c.sun} />
          {[[250, 30], [282, 70], [360, 28], [210, 58], [380, 80], [300, 22]].map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={i % 2 ? 1.1 : 1.5} fill={c.sun} opacity={0.7} />
          ))}
        </>
      ) : (
        <>
          <Circle cx="320" cy="62" r="34" fill={c.sun} opacity={0.22} />
          <Circle cx="320" cy="62" r="20" fill={c.sun} opacity={0.9} />
        </>
      )}

      {/* 먼 산 (두 번 칠함) — 왼쪽은 낮게, 오른쪽으로 높아짐 */}
      <Path d="M0 142 C40 136 70 128 110 130 C150 132 170 112 205 104 C240 96 262 112 290 100 C318 88 348 76 400 84 L400 200 L0 200 Z" fill={c.far[0]} opacity={0.95} />
      <Path d="M0 150 C50 144 95 138 140 140 C185 142 210 122 250 116 C290 110 330 104 400 108 L400 200 L0 200 Z" fill={c.far[1]} opacity={0.55} />
      {/* 중간 언덕 */}
      <Path d="M0 160 C60 152 110 150 160 154 C210 158 240 140 290 136 C330 133 370 138 400 134 L400 200 L0 200 Z" fill={c.mid[0]} opacity={0.88} />
      <Path d="M0 168 C70 160 130 162 190 164 C250 166 300 152 400 150 L400 200 L0 200 Z" fill={c.mid[1]} opacity={0.5} />
      {/* 가까운 언덕 + 나무 몇 그루 (오른쪽) */}
      <Path d="M0 182 C80 172 150 176 220 174 C280 172 330 162 400 164 L400 200 L0 200 Z" fill={c.near[0]} opacity={0.92} />
      <Path d="M120 190 C190 180 260 184 330 178 C360 176 385 176 400 177 L400 200 L120 200 Z" fill={c.near[1]} opacity={0.6} />
      {[[300, 160, 9], [318, 156, 12], [338, 159, 8], [356, 154, 11], [372, 158, 7]].map(([x, y, r], i) => (
        <Ellipse key={i} cx={x} cy={y} rx={r * 0.75} ry={r} fill={c.near[0]} opacity={0.85} />
      ))}
      {/* 바닥 띠 + 배경으로 녹이기 */}
      <Rect x="0" y="186" width={VB_W} height="14" fill={c.ground} opacity={0.5} />
      <Rect x="0" y="150" width={VB_W} height="50" fill={`url(#fade${id})`} />
    </Svg>
  );
}

/** 기온 칩 아이콘: 비·눈은 실황(PTY), 비·눈이 없으면 오늘 예보 하늘(맑음이면 해/달, 아니면 구름) */
function skyIcon(now: SkyNow, clear: boolean, night: boolean) {
  switch (now.sky) {
    case 'rain': return { I: CloudRain, word: '비' };
    case 'drizzle': return { I: CloudDrizzle, word: '빗방울' };
    case 'snow': return { I: Snowflake, word: '눈' };
    case 'sleet': return { I: Snowflake, word: '진눈깨비' };
    default: return clear ? { I: night ? Moon : Sun, word: '맑음' } : { I: Cloud, word: '구름' };
  }
}

export function Header({ greeting, name, date, scene, sunsetMin, sunriseMin, weather, clearSky, right, height = 210, style }: {
  /** '좋은 오후예요' */
  greeting: string;
  /** '우리 가족' — 인사 둘째 줄 */
  name?: string;
  /** '10월 28일 화요일' */
  date: string;
  /** 정하지 않으면 지금 시각으로 (다크 모드면 어두운 물감) */
  scene?: LandScene;
  /** 오늘 해 지는 시각(분) — 노을·밤 고를 때 */
  sunsetMin?: number | null;
  /** 오늘 해 뜨는 시각(분) — 이보다 이르면 밤(달) */
  sunriseMin?: number | null;
  /** 지금 기온·강수 — 날짜 줄 끝 칩. 없으면 칩을 안 그림(줄 높이는 그대로) */
  weather?: SkyNow | null;
  /** 오늘 예보가 맑음인지(서버 계획의 하늘) — 비·눈이 없을 때 해/구름 고르기 */
  clearSky?: boolean;
  right?: ReactNode;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const sc = scene ?? sceneFor(new Date(), sunsetMin, sunriseMin);
  const c = (t.dark ? LAND_DIM : LAND)[sc];
  const night = sc === 'night';
  const moon = moonPhase(new Date());
  const wx = weather ? skyIcon(weather, !!clearSky, night) : null;
  const deg = weather ? Math.round(weather.tempC) : null;
  return (
    <View style={[{ height, marginHorizontal: -S.page }, style]}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Landscape scene={sc} height={height} bg={t.bg} moon={moon} dim={t.dark} />
      </View>
      {/* 오른쪽 위 해/달 자리 — 화면 읽기 이름표만 (누르는 칸 아님) */}
      <View accessible accessibilityRole="image" accessibilityLabel={night ? `오늘 달: ${moon.name}` : '해'}
        style={{ position: 'absolute', right: '12%', top: S.m, width: 48, height: 48 }} />
      <View style={{ paddingHorizontal: S.page, paddingTop: S.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: H.touch }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
            <Text style={[TYPE.cap, { color: c.text2, flexShrink: 1 }]} numberOfLines={1}>{date}</Text>
            {wx && deg != null && (
              <View accessible accessibilityLabel={`지금 ${deg}도, ${wx.word}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: S.s }}>
                <wx.I size={14} color={c.text2} strokeWidth={2} />
                <Text style={[TYPE.cap, { color: c.text2, fontVariant: ['tabular-nums'] }]}>{deg}°</Text>
              </View>
            )}
          </View>
          {right}
        </View>
        <Text accessibilityRole="header" style={[TYPE.display, { color: c.text, marginTop: S.xs, maxWidth: '72%' }]}>
          {greeting}{name ? `,\n${name}` : ''}
        </Text>
      </View>
    </View>
  );
}
