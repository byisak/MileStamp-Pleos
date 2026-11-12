// 축제·행사 (관리자 '축제·행사'): 오늘 탭 띠 · 축제 시트(포스터·기간·'이 축제로 코스 짜기') · 도장북 '축제 도장' 칸
// 색은 붉은 인주(FEST_RED). 기간·상태는 폰 날짜로 다시 계산한다(목록은 앱을 켤 때 한 번 받음).
// '이 축제로 코스 짜기' = 둘러보기와 같은 '○○ 중심으로'(AnchorSheet, POST /api/plan/anchor). 오늘 추천 카드에 축제가 없어도 짠다.
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import type { StampRow } from '../api';
import { CatalogFestival, driveMin, FEST_RED, festivalArt, festivals, festivalStatus, md, today, useCatalogRev } from '../catalog';
import type { AnchorIn } from '../plan';
import { usePlan } from '../planStore';
import { F, R } from '../theme';
import { clock } from '../timefmt';
import { Btn, Icon, Pill, Sheet, T, tap, useTheme } from '../ui';
import { AnchorSheet, anchorOf } from './Explore';

const periodText = (f: CatalogFestival) => `${md(f.starts)}~${md(f.ends)}`;
/** 여는·닫는 시각 (우리 차 탭 '시간 표시'를 따름) */
const hm = (m: number) => clock(m);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** 가까운(차로 60분 안) 진행 중 축제 — 기준은 시험 장면 위치 → 집 → 대구 시내. */
export function useNearFestivals(): CatalogFestival[] {
  useCatalogRev();
  const p = usePlan();
  const home = p.family?.home;
  const from = p.test?.loc ?? (home ? { lat: home[0], lng: home[1] } : { lat: 35.8714, lng: 128.6014 });
  return festivals()
    .filter((f) => festivalStatus(f) === 'running')
    .map((f) => ({ f, min: driveMin(from, { lat: f.lat, lng: f.lng }) }))
    .filter((x) => x.min <= 60)
    .sort((a, b) => a.f.ends.localeCompare(b.f.ends) || a.min - b.min)
    .map((x) => x.f);
}

/** 오늘 탭 추천 카드 위 얇은 띠: "이번 주말 팔공산 단풍축제 · 11/9까지" */
export function FestivalBanner({ items, onOpen }: { items: CatalogFestival[]; onOpen: (f: CatalogFestival) => void }) {
  const t = useTheme();
  if (!items.length) return null;
  const [bg, fg] = t.tone.festival;
  return (
    <View style={{ marginTop: 12, gap: 6 }}>
      {items.slice(0, 2).map((f) => (
        <Pressable key={f.id} onPress={() => { tap(); onOpen(f); }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: bg, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12, opacity: pressed ? 0.7 : 1 })}>
          <Icon name="party-popper" size={16} color={fg} strokeWidth={2.2} />
          <T v="cap" numberOfLines={1} style={{ flex: 1, color: fg, fontFamily: F.b, fontSize: 13.5, lineHeight: 18 }}>
            이번 주말 <T v="cap" style={{ color: fg, fontFamily: F.xb, fontSize: 13.5 }}>{f.name}</T> · {md(f.ends)}까지
          </T>
          <Icon name="chevron-right" size={16} color={fg} />
        </Pressable>
      ))}
    </View>
  );
}

/** 'YYYY-MM-DD' 하루 더하기 (폰 날짜 기준) */
function addDay(d: string, n: number): string {
  const x = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)) + n);
  return today(x);
}
const weekOf = (d: string) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).getDay();

/**
 * 코스를 짤 날: 오늘 열고, 지금 출발해 닫기 30분 전까지 닿으면 오늘. 아니면 기간 안 다음 여는 날(쉬는 요일 건너뜀).
 * 그런 날이 없으면 null (오늘이 마지막 날이고 운영이 끝남). why = 오늘이 아닌 까닭(안내 글).
 */
export function festivalPlanDay(f: CatalogFestival, from: { lat: number; lng: number }, now = new Date()): { day: string; why: string | null } | null {
  const d0 = today(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const reach = nowMin + driveMin(from, f) + 30 <= Math.min(f.close, 1439);
  const openOn = (d: string) => !f.closedDays.includes(weekOf(d));
  if (d0 >= f.starts && d0 <= f.ends && openOn(d0) && reach) return { day: d0, why: null };
  const why = d0 < f.starts ? '아직 시작 전이라' : !openOn(d0) ? '오늘은 쉬는 날이라' : '오늘은 운영 시간 안에 닿기 어려워서';
  for (let d = d0 < f.starts ? f.starts : addDay(d0, 1); d <= f.ends; d = addDay(d, 1)) {
    if (openOn(d)) return { day: d, why: `${why} ${md(d)}(${WEEK[weekOf(d)]}) 기준으로 짜요` };
  }
  return null;
}

/** 축제 시트: 포스터 · 기간 · 운영 시각 · '이 축제로 코스 짜기' → 이 축제 중심 코스(AnchorSheet, 대화형 고르기의 동행 반영). */
export function FestivalSheet({ festival, stamped, onClose }: { festival: CatalogFestival | null; stamped?: StampRow | null; onClose: () => void }) {
  useCatalogRev();
  const t = useTheme();
  const p = usePlan();
  const f = festival;
  const st = f ? festivalStatus(f) : 'ended';
  // 코스는 집에서 출발 (집을 모르면 대구 시내)
  const home = p.family?.home;
  const from = p.test?.loc ?? (home ? { lat: home[0], lng: home[1] } : { lat: 35.8714, lng: 128.6014 });
  const when = f && st !== 'ended' ? festivalPlanDay(f, from) : null;
  const [pick, setPick] = useState<{ anchor: AnchorIn; day?: string; driveMin: number | null } | null>(null);
  /** 결과 시트를 여는 동안 축제 시트는 숨김 */
  const [hidden, hide] = useState(false);
  const plan = () => {
    if (!f || !when) return;
    const anchor = anchorOf({
      kind: 'festival', id: f.id, name: f.name, starts: f.starts, ends: f.ends, lat: f.lat, lng: f.lng, addr: '', image: f.poster,
      driveMin: null, indoor: f.indoor, ourStamp: true,
    });
    // 축제 시트가 닫힌 뒤 결과 시트를 연다 (시트 두 장이 겹치지 않게)
    const target = { anchor, day: when.day, driveMin: home ? driveMin(from, f) : null };
    setPick(null);
    setTimeout(() => setPick(target), 260);
    hide(true);
  };
  const closeAll = () => { setPick(null); hide(false); onClose(); };
  return (
    <>
    <Sheet open={!!f && !hidden} onClose={onClose}>
      {f && (
        <View style={{ paddingBottom: 8 }}>
          {f.poster ? (
            <Image source={{ uri: f.poster }} resizeMode="cover" style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 18, backgroundColor: t.fill }} />
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 6 }}>
              <Image source={festivalArt(f, !stamped)} style={{ width: 180, height: 180, borderRadius: 90, borderWidth: 5, borderColor: FEST_RED, opacity: stamped ? 1 : 0.85 }} />
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <T v="title" style={{ flexShrink: 1 }}>{f.name}</T>
            <Pill text={st === 'running' ? `${md(f.ends)}까지` : st === 'upcoming' ? '예정' : f.season} tone={st === 'running' ? 'accent' : 'neutral'} />
          </View>
          {!!f.summary && <T v="sub" c="ink2" style={{ marginTop: 4 }}>{f.summary}</T>}
          <View style={{ gap: 6, marginTop: 12 }}>
            <Line icon="clock" text={`${periodText(f)} · ${hm(f.open)}~${hm(Math.min(f.close, 1439))}${f.closedDays.length ? ` · ${f.closedDays.map((d) => WEEK[d]).join('·')} 쉼` : ''}`} />
            {!!f.crowdNote && <Line icon="users" text={f.crowdNote} />}
            <Line icon="party-popper" text={stamped ? `한정 도장을 받았어요 · ${f.season}` : `기간 안에 주차하면 한정 도장 · ${f.season}`} />
          </View>
          {st !== 'ended' && (when ? (
            <>
              <Btn title="이 축제로 코스 짜기" icon="route" onPress={plan} style={{ marginTop: 16 }} />
              {!!when.why && <T v="cap" c="ink3" style={{ marginTop: 6, textAlign: 'center' }}>{when.why}</T>}
            </>
          ) : (
            <T v="sub" c="ink3" style={{ marginTop: 16, textAlign: 'center' }}>오늘이 마지막 날이고 운영 시간이 끝나서 코스를 짤 수 없어요</T>
          ))}
        </View>
      )}
    </Sheet>
    <AnchorSheet target={pick} onClose={closeAll} onChosen={closeAll} />
    </>
  );
}

function Line({ icon, text }: { icon: 'clock' | 'users' | 'party-popper'; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={15} color={t.ink3} />
      <T v="sub" c="ink2" style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

/** 도장북 축제 칸: 붉은 인주 테두리 동그라미 + 이름(2줄) + 기간. 빨간 알약은 쓰지 않는다(빨강은 경고에만) — 테두리만 */
export function FestivalCell({ f, size, has, ready, onPress }: { f: CatalogFestival; size: number; has: boolean; ready?: boolean; onPress: () => void }) {
  useCatalogRev();
  const t = useTheme();
  const running = festivalStatus(f) === 'running';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${f.name}, 축제 도장, ${has ? '받았어요' : '아직'}`}
      style={({ pressed }) => ({ width: size, alignItems: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: FEST_RED, opacity: has || running ? 1 : 0.55, padding: 3 }}>
        <Image source={festivalArt(f, !has)} style={{ width: size - 12, height: size - 12, borderRadius: (size - 12) / 2, opacity: has ? 1 : ready ? 0.7 : 0.45 }} />
        {ready && !has && (
          <View pointerEvents="none" style={{ position: 'absolute', top: -6, left: -20, right: -20, alignItems: 'center' }}>
            <View style={{ backgroundColor: t.point, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
              <T v="cap" style={{ color: t.onPoint, fontFamily: F.xb, fontSize: 12.5, lineHeight: 16 }}>찍기 가능</T>
            </View>
          </View>
        )}
      </View>
      <T v="cap" c={has ? 'ink' : 'ink3'} numberOfLines={2} style={{ marginTop: 6, textAlign: 'center' }}>{f.name}</T>
      <T v="cap" c="ink3" numberOfLines={1} style={{ textAlign: 'center' }}>{running ? `${md(f.ends)}까지` : f.season}</T>
    </Pressable>
  );
}
