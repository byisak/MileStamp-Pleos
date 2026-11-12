// 결과 카드 작은 코스 지도 + '들렀다 오면 / 바로 오면' 비교 (대화형 고르기 UX A2).
// 지도는 MapWeb(/embed/map, route 모드): 집(집 그림) · 출발(지금 있는 곳, 집과 다르면 회색 '출발') · 곳마다 들르는 순서 번호(중심 곳 = 크게 + '중심')
// · 구간마다 색(mapEmbed LEG_COLORS, 집으로 오는 마지막 구간은 늘 파랑) + 선 안에서 흐르는 › · 바로 가는 길(비교, 회색 짧은 점선 — 맨 위 옅게).
// 선마다 leg(구간 번호)·min(운전 분)을 실어 보내 지도의 '시간 보기' 말풍선이 그 값을 쓴다.
// 지도 아래는 범례 대신 시간표: 작은 지도는 한 줄(⌂ ─22분─ ① ─38분─ ② …), 큰 지도 시트는 곳마다 줄 + 사이에 '차로 N분' 색 막대.
// 선·시각은 실제 길(카카오모빌리티): 경유 길은 서버가 카드에 실어 보낸 option.route.polyline, 바로 가는 길은 /api/route 따로.
// 서버가 못 재면(키 없음·한도·실패·옛 서버) 곳들을 곧은 선으로 잇고 '어림'.
// 작은 지도는 만지지 않게 덮고, 누르면 큰 지도 시트. 지도가 안 뜨면 MapWeb가 '다시 불러오기'를 보인다.
import { useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { driveMin } from '../catalog';
import { MapWeb, type MapWebHandle } from '../MapWeb';
import { legColor, LINE_COLOR, type LatLng, type MapInit, type MapLine } from '../mapEmbed';
import { isMealStop, span, type PlanOption } from '../plan';
import { clock } from '../timefmt';
import { departParam, sourceLabel, useRoute, type RouteRes, type RouteSource } from '../route';
import { F, R, S } from '../theme';
import { Icon, Sheet, T, useTheme } from '../ui';

type Pt = { lat: number; lng: number };
export type RouteCompare = { via: number; direct: number; extra: number; approx: boolean; anchorName: string; source: RouteSource };

const ok = (p: Pt) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** 중심 곳: 앵커 카드면 그 곳, 아니면 첫 곳 */
const anchorOf = (o: PlanOption) => o.stops.find((s) => s.id === o.anchorId) ?? o.stops[0];

/**
 * 들렀다 오면(집 출발 → 집 도착, 계획 그대로) vs 바로 오면(중심 곳만 다녀오기).
 * 집↔중심 곳 이동은 계획의 구간 시각을 먼저 쓰고(중심 곳이 처음·끝이면), 없으면 서버 편도(oneWayMin),
 * 그것도 없으면 직선 어림(driveMin — 엔진 TravelTime과 같은 어림) → approx.
 */
export function routeCompare(o: PlanOption, home: Pt | null, oneWayMin?: number | null, real?: RouteRes | null): RouteCompare | null {
  // 중심 곳(앵커)이 있는 코스만 — 그냥 추천 코스의 첫 곳과 견주면 뜻이 없다
  if (!o.anchorId || o.stops.length < 2 || !o.legs.length) return null;
  const a = anchorOf(o);
  const ai = o.stops.indexOf(a);
  const depart = o.legs[0].fromMin;
  const via = o.arriveHomeMin - depart;
  const stay = o.legs.find((l) => l.kind === 'STAY' && l.placeId === a.id);
  const stayMin = stay ? stay.toMin - stay.fromMin : a.dwell?.minutes ?? 60;
  let approx = false;
  const guess = (): number | null => {
    // 서버 편도도 엔진의 직선 어림(TravelTime)이라 '약'
    if (oneWayMin != null) { approx = true; return oneWayMin; }
    if (!home || !ok(home) || !ok(a)) return null;
    approx = true;
    return driveMin(home, a);
  };
  // 바로 가는 길을 실제 길로 쟀으면(출발 → 중심 곳 → 집) 그 값
  const live = real && real.source !== 'estimate' && real.legs.length === 2 ? real : null;
  const to = live ? live.legs[0].durMin : ai === 0 && stay ? stay.fromMin - depart : guess();
  const back = live ? live.legs[1].durMin : ai === o.stops.length - 1 && stay ? o.arriveHomeMin - stay.toMin : guess();
  if (to == null || back == null) return null;
  const direct = to + stayMin + back;
  const viaSrc = o.route?.source ?? 'estimate';
  // 두 칸 중 하나라도 어림이면 '어림', 둘 다 실제면 경유 길 쪽 출처
  const source: RouteSource = approx || viaSrc === 'estimate' ? 'estimate' : viaSrc;
  return { via, direct, extra: via - direct, approx, anchorName: a.name, source };
}

/** 두 점을 살짝 휜 선으로 (경유 길과 겹쳐도 바로 가는 길이 보이게 — 실제 길 모양은 아님) */
function bow(p: LatLng, q: LatLng, k = 0.18, n = 16): LatLng[] {
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  const cx = mx - (q[1] - p[1]) * k, cy = my + (q[0] - p[0]) * k;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * p[0] + 2 * u * t * cx + t * t * q[0], u * u * p[1] + 2 * u * t * cy + t * t * q[1]] as LatLng;
  });
}

/** 출발 = 지금 있는 곳(오늘 계획, 집에서 1km 넘게 떨어져 있을 때) 아니면 집 */
function startOf(home: Pt | null, start: Pt | null): Pt | null {
  return start && ok(start) && (!home || driveMin(start, home) > 1) ? start : home && ok(home) ? home : null;
}

/** 서버가 실제 길로 잰 경유 길의 끝 점 = 집 (어림이거나 없으면 null) */
function routeEnd(o: PlanOption): Pt | null {
  const legs = o.route && o.route.source !== 'estimate' ? o.route.polyline : undefined;
  const last = legs?.[legs.length - 1];
  const p = last?.[last.length - 1];
  return p ? { lat: p[0], lng: p[1] } : null;
}

/** 실제 길 선 (구간들을 한 줄로 — 이음 점은 한 번만). 없거나 어림이면 null */
function realLine(legs: [number, number][][] | undefined): LatLng[] | null {
  if (!legs?.length) return null;
  const out: LatLng[] = [];
  for (const leg of legs) for (const p of leg) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push([p[0], p[1]]);
  }
  return out.length >= 2 ? out : null;
}

/**
 * 구간마다 운전 시간(분): 출발→곳1, 곳1→곳2, …, 마지막 곳→집 (계획의 이동 칸 순서).
 * 서버가 실제 길로 잰 값(option.route.legs, 실시간·그날 예상 교통)이 칸 수와 맞으면 그 값, 아니면 계획의 이동 칸 길이.
 */
export function driveMins(o: PlanOption): number[] {
  const drives = (o.legs ?? []).filter((l) => l.kind !== 'STAY');
  const plan = drives.map((l) => Math.max(0, Math.round(l.toMin - l.fromMin)));
  const real = o.route && o.route.source !== 'estimate' ? o.route.legs : undefined;
  if (real && real.length === plan.length && real.every((l) => Number.isFinite(l.durMin))) return real.map((l) => Math.round(l.durMin));
  return plan;
}

/**
 * 구간 나누기. 구간 = 출발→곳1, 곳1→곳2, …, 마지막 곳→집.
 * 집으로 끝나는 마지막 구간 = 오는 길(back, 지도에선 늘 파랑), 그 앞 = 가는 길(go, 구간마다 색). 집을 모르면 모두 가는 길.
 * leg = 구간 번호(출발→곳1 = 0, 출발점을 모르면 곳1→곳2가 1), min = 그 구간 운전 분(driveMins).
 * 실제 길(서버 option.route.polyline, 구간마다)이 있으면 그 모양, 없으면 곳들을 곧은 선으로.
 */
export function legLines(o: PlanOption, s0: LatLng | null, h: LatLng | null): MapLine[] {
  const stops = o.stops.filter(ok);
  const road = o.route && o.route.source !== 'estimate' ? o.route.polyline : undefined;
  let legs: LatLng[][];
  // 실제 길 구간 수가 (곳 수 + 1)과 맞을 때만 구간대로 (아니면 곧은 선)
  if (road && road.length === stops.length + 1 && road.every((l) => l.length >= 2)) {
    legs = road.map((l) => l.map((p): LatLng => [p[0], p[1]]));
  } else {
    const path: LatLng[] = [...(s0 ? [s0] : []), ...stops.map((s): LatLng => [s.lat, s.lng]), ...(h ? [h] : [])];
    legs = [];
    for (let i = 1; i < path.length; i++) legs.push([path[i - 1], path[i]]);
  }
  const first = s0 ? 0 : 1;
  // 좌표 모르는 곳을 뺐으면 구간과 이동 칸이 어긋나니 시간은 싣지 않는다
  const mins = stops.length === o.stops.length ? driveMins(o) : [];
  return legs.map((points, i): MapLine => {
    const min = mins[i + first];
    return {
      points, style: h && i === legs.length - 1 && legs.length > 1 ? 'back' : 'go', leg: i + first,
      ...(min != null && min >= 1 ? { min } : {}),
    };
  });
}

function mapInit(o: PlanOption, home: Pt | null, start: Pt | null, dark: boolean, cmp: boolean, direct: RouteRes | null, compact: boolean): MapInit {
  const stops = o.stops.filter(ok);
  const a = anchorOf(o);
  const h: LatLng | null = home && ok(home) ? [home.lat, home.lng] : null;
  const st = startOf(home, start);
  const s0: LatLng | null = st ? [st.lat, st.lng] : null;
  const lines: MapLine[] = legLines(o, s0, h);
  // 바로 가는 길(비교): 경유 길과 다른 쪽만 (중심 곳 앞에 들르면 출발→중심, 뒤에 들르면 중심→집) — 지도에선 맨 위 옅은 점선
  if (cmp && h && a && ok(a)) {
    const ai = stops.indexOf(a);
    const dr = direct && direct.source !== 'estimate' && direct.polyline.length === 2 ? direct.polyline : null;
    if (ai > 0) lines.push({ points: (dr && realLine([dr[0]])) || bow(s0 ?? h, [a.lat, a.lng]), style: 'direct' });
    if (ai < stops.length - 1) lines.push({ points: (dr && realLine([dr[1]])) || bow([a.lat, a.lng], h), style: 'direct' });
  }
  const anchored = !!o.anchorId && stops.length > 1;
  return {
    mode: 'route', theme: dark ? 'dark' : 'light', cluster: false, home: h, polylines: lines, compact,
    dots: [
      // 들르는 순서 번호 (중심 곳은 크게 + '중심')
      // 밥 자리(식당 'ext:food:…')는 번호 없이 회색 '밥' 점 (도장 없음) — 번호는 장소만 센다
      ...stops.map((s, i) => isMealStop(s.id)
        ? { id: s.id, lat: s.lat, lng: s.lng, c: 'n' as const, label: '밥', tag: '🍽' }
        : {
          id: s.id, lat: s.lat, lng: s.lng, c: 'g' as const, label: String(stops.slice(0, i + 1).filter((x) => !isMealStop(x.id)).length),
          ...(anchored && s.id === a?.id ? { big: true, tag: '중심' } : {}),
        }),
      // 집이 아닌 출발점(지금 있는 곳)은 회색 '출발'
      ...(s0 && st !== home ? [{ id: '_start', lat: s0[0], lng: s0[1], c: 'n' as const, label: '출발' }] : []),
    ],
  };
}

/** 바로 가는 길(비교 점선)을 그리나 — 범례에 넣을지 */
function hasDirect(o: PlanOption, home: Pt | null, cmp: boolean): boolean {
  if (!cmp || !home || !ok(home)) return false;
  const stops = o.stops.filter(ok);
  const a = anchorOf(o);
  return !!a && ok(a) && stops.length > 1;
}

/** 지도 한 장 (작은 것·큰 것 공용) */
function CourseMapView({ o, home, start, cmp, direct, nested, compact }: {
  o: PlanOption; home: Pt | null; start: Pt | null; cmp: boolean; direct: RouteRes | null; nested?: boolean; compact?: boolean;
}) {
  const t = useTheme();
  const ref = useRef<MapWebHandle>(null);
  const init = useMemo(() => mapInit(o, home, start, t.dark, cmp, direct, !!compact), [o, home?.lat, home?.lng, start?.lat, start?.lng, t.dark, cmp, direct, compact]); // eslint-disable-line react-hooks/exhaustive-deps
  return <MapWeb ref={ref} init={init} nested={nested} />;
}

/** 바로 오는 길(비교 점선) 범례 한 줄 — 지도 점선과 같은 색(LINE_COLOR.direct) */
function DirectLegend() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: S.s }}>
      <View style={{ width: 22, height: 0, borderTopWidth: 2.5, borderStyle: 'dashed', borderColor: LINE_COLOR.direct }} />
      <T v="cap" c="ink2">바로 오는 길(비교)</T>
    </View>
  );
}

type TlStop = { key: string; name: string; time: string; home?: boolean; start?: boolean; color?: string; n?: number; meal?: boolean };
type TlLeg = { color: string; min: number | null; now?: number | null };

/** 시간표 줄: 출발(집·지금 있는 곳) → 곳들 → 집, 사이마다 구간 색·운전 분 */
function timelineOf(o: PlanOption, home: Pt | null, start: Pt | null, anchorName: string | null): { stops: TlStop[]; legs: TlLeg[] } | null {
  const stops = o.stops.filter(ok);
  if (!stops.length) return null;
  const hasHome = !!home && ok(home);
  const st = startOf(home, start);
  const fromHere = !!st && st !== home;
  const mins = stops.length === o.stops.length ? driveMins(o) : [];
  const depart = o.legs[0]?.fromMin;
  const stayOf = (id: string) => o.legs.find((l) => l.kind === 'STAY' && l.placeId === id);
  let n = 0;
  const range = (a: number, b: number) => {
    const A = clock(a), B = clock(b);
    // '오전 8:52 – 10:20' (같은 오전·오후면 뒤는 줄여서)
    return `${A} – ${/^오[전후] /.test(B) && A.slice(0, 2) === B.slice(0, 2) ? B.slice(3) : B}`;
  };
  const out: TlStop[] = [];
  const legs: TlLeg[] = [];
  if (st) out.push({ key: '_from', name: fromHere ? '지금 있는 곳' : '집', home: !fromHere, start: fromHere, time: depart != null ? `${clock(depart)} 출발` : '' });
  stops.forEach((p, i) => {
    if (st || i > 0) legs.push({ color: legColor(i, false), min: mins[i] ?? null });
    const stay = stayOf(p.id);
    const meal = isMealStop(p.id);
    if (!meal) n++;
    out.push({
      key: p.id, n, color: legColor(i, false), name: p.name + (anchorName && p.name === anchorName ? ' · 중심' : ''),
      time: stay ? range(stay.fromMin, stay.toMin) : '', meal,
    });
  });
  if (hasHome) {
    legs.push({ color: legColor(stops.length, true), min: mins[stops.length] ?? null });
    out.push({ key: '_home', name: '집', home: true, time: `${clock(o.arriveHomeMin)} 도착` });
  }
  return { stops: out, legs };
}

/** 시간표의 동그라미: 집 ⌂ · 출발(지금 있는 곳) · 번호(흰 바탕 + 구간 색 테두리 — 지도 번호 점과 같은 모양) */
function TlDot({ s, size }: { s: TlStop; size: number }) {
  const t = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const, justifyContent: 'center' as const };
  if (s.home) return <View style={{ ...box, backgroundColor: t.fill }}><Icon name="house" size={size * 0.52} color={t.ink2} strokeWidth={2.4} /></View>;
  if (s.start) return <View style={{ ...box, backgroundColor: t.fill }}><Icon name="navigation" size={size * 0.46} color={t.ink3} strokeWidth={2.4} /></View>;
  // 밥 자리: 회색 동그라미 + 🍽 (번호 없음 — 도장 없는 곳)
  if (s.meal) return <View style={{ ...box, backgroundColor: t.fill }}><T v="cap" style={{ fontSize: size * 0.5, lineHeight: size * 0.62 }}>🍽</T></View>;
  return (
    <View style={{ ...box, backgroundColor: t.surface, borderWidth: size > 22 ? 2.5 : 2, borderColor: s.color }}>
      <T v="cap" style={{ fontFamily: F.xb, color: s.color, fontSize: size > 22 ? 13 : 11, lineHeight: size > 22 ? 16 : 13 }}>{s.n}</T>
    </View>
  );
}

/** 작은 지도 아래 한 줄 시간표: ⌂ ─22분─ ① ─38분─ ② … ⌂ (구간 막대 = 지도 선 색) */
function TimelineStrip({ tl }: { tl: { stops: TlStop[]; legs: TlLeg[] } }) {
  const off = tl.stops.length - tl.legs.length; // 출발점을 모르면 첫 곳 앞에 구간이 없다
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: S.m }} accessibilityRole="text"
      accessibilityLabel={tl.stops.map((s, i) => `${s.name}${i >= off && tl.legs[i - off]?.min ? `, 차로 ${tl.legs[i - off].min}분 뒤` : ''}`).join(' → ')}>
      {tl.stops.map((s, i) => {
        const leg = i >= off ? tl.legs[i - off] : null;
        return (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', flex: leg ? 1 : 0 }}>
            {leg && (
              <View style={{ flex: 1, alignItems: 'center', marginHorizontal: 3 }}>
                <T v="cap" c="ink3" numberOfLines={1} style={{ fontSize: 11, lineHeight: 13, fontVariant: ['tabular-nums'] }}>{leg.min ? `${leg.min}분` : ' '}</T>
                <View style={{ alignSelf: 'stretch', height: 3, borderRadius: 2, backgroundColor: leg.color, marginTop: 2 }} />
              </View>
            )}
            <TlDot s={s} size={20} />
          </View>
        );
      })}
    </View>
  );
}

/** 큰 지도 시트 시간표: 곳마다 줄(동그라미·이름·시각) + 사이에 구간 색 막대 '차로 N분' */
function Timeline({ tl, now }: { tl: { stops: TlStop[]; legs: TlLeg[] }; now?: RouteRes | null }) {
  const off = tl.stops.length - tl.legs.length;
  // 지금 출발하면(실시간 교통) 구간마다 몇 분인지 — 구간 수가 맞을 때만
  if (now && now.source === 'live' && now.legs.length === tl.legs.length) tl = { ...tl, legs: tl.legs.map((l, i) => ({ ...l, now: Math.round(now.legs[i].durMin) })) };
  return (
    <View style={{ marginTop: S.l }}>
      {tl.stops.map((s, i) => {
        const leg = i >= off ? tl.legs[i - off] : null;
        return (
          <View key={s.key}>
            {leg && (
              <View style={{ flexDirection: 'row', alignItems: 'center', height: 22 }}>
                <View style={{ width: 26, alignItems: 'center' }}><View style={{ width: 3, height: 22, borderRadius: 2, backgroundColor: leg.color }} /></View>
                {leg.min ? <T v="cap" c="ink3" style={{ marginLeft: S.l, fontVariant: ['tabular-nums'] }}>차로 {span(leg.min)}
                  {leg.now != null && Math.abs(leg.now - leg.min) >= 3 ? <T v="cap" c="ink3" style={{ opacity: 0.75 }}>{`  ·  지금 가면 ${span(leg.now)}`}</T> : null}</T> : null}
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.l, paddingVertical: S.xs }}>
              <TlDot s={s} size={26} />
              <T v="sub" numberOfLines={1} style={{ flex: 1 }}>{s.name}</T>
              {s.time ? <T v="cap" c="ink3" style={{ fontVariant: ['tabular-nums'] }}>{s.time}</T> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
/** 그날 예상 교통의 기준: '11/4(수) 오전 8:30 출발 기준' + 평일 출퇴근 시간이면 '출근길 막힘 반영' */
function basisText(day: string | undefined, departMin: number | undefined): { when: string; rush: string | null } | null {
  if (!day || departMin == null) return null;
  const d = new Date(`${day}T00:00:00`);
  const wd = d.getDay();
  const when = `${d.getMonth() + 1}/${d.getDate()}(${WD[wd]}) ${clock(departMin)} 출발 기준`;
  const weekday = wd >= 1 && wd <= 5;
  const rush = !weekday ? null : departMin >= 7 * 60 && departMin <= 9 * 60 + 30 ? '출근길 막힘 반영' : departMin >= 17 * 60 && departMin <= 19 * 60 + 30 ? '퇴근길 막힘 반영' : null;
  return { when, rush };
}

/** 작은 지도(약 160) + 비교 두 칸. 누르면 큰 지도 시트 */
export function CourseMiniMap({ o, home, start = null, oneWayMin, height = 160, compare = true, day }: {
  o: PlanOption; home: Pt | null; start?: Pt | null; oneWayMin?: number | null; height?: number; compare?: boolean;
  /** 계획 날짜 'YYYY-MM-DD' — 다른 날이면 바로 가는 길도 그날 예상 교통으로 */
  day?: string;
}) {
  const t = useTheme();
  const [big, setBig] = useState(false);
  // 폰이 집을 모르면(가족 집 위치를 폰에서 안 정함) 서버가 잰 실제 길의 끝 점(= 서버가 아는 집)을 쓴다
  home = home && ok(home) ? home : routeEnd(o);
  // 바로 가는 길(출발 → 중심 곳 → 집)은 따로 실제 길로 잰다 — 비교할 코스(앵커 + 다른 곳)이고 경유 길도 실제로 쟀을 때만
  const a = anchorOf(o);
  const st = startOf(home, start);
  const wantDirect = compare && !!o.anchorId && o.stops.length >= 2 && !!o.legs.length && !!home && ok(home) && !!a && ok(a) && !!st
    && !!o.route && o.route.source !== 'estimate';
  const direct = useRoute(wantDirect ? [st!, { lat: a.lat, lng: a.lng }, home!] : null, departParam(day, o.legs[0]?.fromMin ?? 0));
  const cmp = compare ? routeCompare(o, home, oneWayMin, direct) : null;
  const src: RouteSource = cmp?.source ?? o.route?.source ?? 'estimate';
  const basis = o.route?.source === 'future' ? basisText(day, o.legs[0]?.fromMin) : null;
  // 큰 지도에서만: 같은 길을 지금 출발하면 (비교용, 그날 예상 교통일 때만)
  const st2 = startOf(home, start);
  const okStops = o.stops.filter(ok);
  const nowPts = big && basis && st2 && home && ok(home) && okStops.length === o.stops.length
    ? [st2, ...okStops.map((x) => ({ lat: x.lat, lng: x.lng })), home] : null;
  const nowRoute = useRoute(nowPts, null);
  const tl = useMemo(() => timelineOf(o, home, start, cmp?.anchorName ?? null), [o, home?.lat, home?.lng, start?.lat, start?.lng, cmp?.anchorName]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o.stops.length) return null;
  return (
    <>
      <Pressable onPress={() => setBig(true)} accessibilityRole="button" accessibilityLabel="코스 지도 크게 보기"
        style={{ height, marginTop: S.l, borderRadius: R.md, overflow: 'hidden', backgroundColor: t.fill }}>
        {/* 작은 지도는 손가락을 받지 않음 (스크롤·누르기는 바깥이) */}
        <View pointerEvents="none" style={{ flex: 1 }}>
          <CourseMapView o={o} home={home} start={start} cmp={!!cmp} direct={direct} compact />
        </View>
        {/* 길·시각 출처: 실시간 교통 반영 · 그날 예상 교통 · 어림 */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: t.surface, opacity: 0.94 }}>
          <Icon name="route" size={12} color={src === 'estimate' ? t.ink3 : t.accent} />
          <T v="cap" c={src === 'estimate' ? 'ink3' : 'ink2'}>{basis && src === 'future' ? basis.when.replace(' 출발 기준', ' 기준') : sourceLabel(src)}</T>
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', right: 8, bottom: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', opacity: 0.94 }}>
          <Icon name="maximize-2" size={16} color={t.ink2} />
        </View>
      </Pressable>
      {tl && <TimelineStrip tl={tl} />}
      {hasDirect(o, home, !!cmp) && <DirectLegend />}
      {cmp && <CompareCells c={cmp} />}
      <Sheet open={big} onClose={() => setBig(false)} full>
        <T v="title" accessibilityRole="header">코스 지도</T>
        <T v="cap" c="ink3" style={{ marginTop: S.xxs }}>
          {o.route && o.route.source !== 'estimate'
            ? `실제 길이에요 · ${basis ? [basis.when, basis.rush ?? '그날 예상 교통'].join(' · ') : sourceLabel(o.route.source)}${o.route.distKm ? ` · 이동 ${o.route.distKm}km` : ''}`
            : '실제 길이 아니라 곳들을 이은 선이에요 · 시각은 어림 · 길은 출발할 때 내비가 알려 줘요'}
        </T>
        {big && (
          <View style={{ height: 380, marginTop: S.l, borderRadius: R.md, overflow: 'hidden', backgroundColor: t.fill }}>
            <CourseMapView o={o} home={home} start={start} cmp={!!cmp} direct={direct} nested />
          </View>
        )}
        {big && hasDirect(o, home, !!cmp) && <DirectLegend />}
        {tl && <Timeline tl={tl} now={nowRoute} />}
        {cmp && <CompareCells c={cmp} />}
      </Sheet>
    </>
  );
}

/** '들렀다 오면 ○시간 ○분' · '바로 오면 ○시간 ○분 · 들르는 데 +○분' (집 출발 → 집 도착) */
function CompareCells({ c }: { c: RouteCompare }) {
  const t = useTheme();
  const extra = c.extra > 5 ? `들르는 데 +${span(c.extra)}` : '시간 차이가 거의 없어요';
  const pre = c.approx ? '약 ' : '';
  return (
    <View style={{ marginTop: S.s }}>
      <View style={{ flexDirection: 'row', gap: S.s }}>
        <View style={{ flex: 1, backgroundColor: t.accentSoft, borderRadius: R.md, paddingVertical: S.s + 2, paddingHorizontal: S.m }}>
          <T v="cap" style={{ color: t.accentInk }}>들렀다 오면</T>
          <T v="h" style={{ color: t.accentInk, fontVariant: ['tabular-nums'] }}>{span(c.via)}</T>
        </View>
        <View style={{ flex: 1, backgroundColor: t.fill, borderRadius: R.md, paddingVertical: S.s + 2, paddingHorizontal: S.m }}>
          <T v="cap" c="ink3">바로 오면</T>
          <T v="h" style={{ fontVariant: ['tabular-nums'] }}>{pre}{span(c.direct)}</T>
          <T v="cap" c="ink3">{extra}</T>
        </View>
      </View>
      <T v="cap" c="ink3" style={{ marginTop: S.xs }}>
        출발부터 집 도착까지 · {c.source === 'estimate' ? (c.approx ? '약 = 직선 거리로 어림한 값' : '어림') : sourceLabel(c.source)}
      </T>
    </View>
  );
}
