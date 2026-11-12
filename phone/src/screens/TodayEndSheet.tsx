// 오늘만 도착 바꾸기 — 코스 카드의 '집 18:34 도착 예정' 줄을 누르면 뜬다.
// 도착 시간(해 지기 30분 전 / 직접 HH:MM / 저녁 약속 HH:MM) · 도착지(집 / 즐겨찾기 / 지도에서 고르기) · 오늘만 낮잠 안 자요.
// 고르면 엔진 사건 SetEnd 하나로 보낸다(바뀐 칸만): {"type":"SetEnd","now":…,"end":{name,at}|"home","limit":"HH:MM","napOff":bool}
// 서버가 다시 짜서 넘치면 '덜 놀기'·빼기 제안 카드가 뜬다. 가족 설정(우리 가족)은 그대로 — 오늘 코스에만.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Alert } from '../alert';
import { CourseEnd, CourseEventIn, endName, LiveCourse } from '../course';
import { Favorite, hhmm, putFamily, toMin } from '../plan';
import { clock } from '../timefmt';
import { usePlan } from '../planStore';
import { useSession } from '../session';
import { F, R } from '../theme';
import { Btn, Check, done, Icon, IconName, Input, Label, Segmented, Sheet, T, tick, useTheme } from '../ui';
import { ChipRow } from './FamilySheet';
import { MapPickSheet } from './MapPick';

const TIMES = Array.from({ length: 15 }, (_, i) => 14 * 60 + i * 30); // 14:00 ~ 21:00
const DINNERS = [17 * 60, 17 * 60 + 30, 18 * 60, 18 * 60 + 30, 19 * 60, 19 * 60 + 30, 20 * 60];
/** 해 지기 몇 분 전 (가족 설정 기본과 같음) */
const SUN_BEFORE = 30;

type TimeMode = 'sun' | 'at' | 'dinner';
type Dest = { kind: 'home' } | { kind: 'fav'; fav: Favorite } | { kind: 'map'; at: [number, number]; name: string };

const nearest = (vals: number[], v: number) => vals.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), vals[0]);
const sameAt = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

export function TodayEndSheet({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (e: CourseEventIn) => Promise<void> }) {
  const t = useTheme();
  const p = usePlan();
  const { token } = useSession();
  const c = p.course;
  const sunset = toMin(p.data?.sky?.sunset);
  const favs = p.family?.favorites ?? [];

  const [mode, setMode] = useState<TimeMode>('sun');
  const [atMin, setAtMin] = useState(18 * 60);
  const [dinner, setDinner] = useState(18 * 60 + 30);
  const [dest, setDest] = useState<Dest>({ kind: 'home' });
  const [napOff, setNapOff] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [saveFav, setSaveFav] = useState(true);
  const [busy, setBusy] = useState(false);

  // 열 때 지금 코스 값으로
  useEffect(() => {
    if (!open || !c) return;
    setMode(c.userLimit ? 'at' : 'sun');
    setAtMin(nearest(TIMES, c.limitMin));
    setDinner(nearest(DINNERS, p.family?.dinner ?? 18 * 60 + 30));
    setNapOff(!!c.napOff);
    setSaveFav(true);
    const e = c.end;
    if (!e) setDest({ kind: 'home' });
    else {
      const f = favs.find((x) => x.name === e.name && sameAt([x.lat, x.lng], e.at));
      setDest(f ? { kind: 'fav', fav: f } : { kind: 'map', at: e.at, name: e.name });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 고른 도착 목표(분). 해 지기 30분 전인데 해 시각을 모르면 지금 목표 그대로 */
  const limit = useMemo(() => {
    if (!c) return null;
    if (mode === 'at') return atMin;
    if (mode === 'dinner') return dinner;
    return sunset != null ? sunset - SUN_BEFORE : c.limitMin;
  }, [c, mode, atMin, dinner, sunset]);

  if (!c) return null;

  const newEnd: CourseEnd | null = dest.kind === 'home' ? null
    : dest.kind === 'fav' ? { name: dest.fav.name, at: [dest.fav.lat, dest.fav.lng] }
    : { name: dest.name.trim() || '새 도착지', at: dest.at };
  const endChanged = (newEnd?.name ?? null) !== (c.end?.name ?? null) || (!!newEnd && !!c.end && !sameAt(newEnd.at, c.end.at));
  // 해 지기 전으로 두고 사용자가 정한 적이 없으면 목표는 그대로 (차의 해 시각이 기준)
  const limitChanged = limit != null && limit !== c.limitMin && (mode !== 'sun' || !!c.userLimit);
  const napChanged = napOff !== !!c.napOff;
  const changed = endChanged || limitChanged || napChanged;

  const apply = async () => {
    if (!changed) { onClose(); return; }
    const ev: { type: 'SetEnd'; end?: CourseEnd | 'home'; limit?: string; napOff?: boolean } = { type: 'SetEnd' };
    if (endChanged) ev.end = newEnd ?? 'home';
    if (limitChanged) ev.limit = hhmm(limit!);
    if (napChanged) ev.napOff = napOff;
    setBusy(true);
    try {
      // 지도에서 고른 곳은 즐겨찾기에도 (다음에 바로 고르게)
      if (dest.kind === 'map' && saveFav && token && newEnd && !favs.some((f) => f.name === newEnd.name)) {
        const next = [...favs, { name: newEnd.name, lat: newEnd.at[0], lng: newEnd.at[1] }].slice(-8);
        p.setFamily(await putFamily(token, { favorites: next }));
      }
      await onApply(ev);
      done();
      onClose();
    } catch (e: any) {
      Alert.alert('바꾸지 못했어요', e?.message);
    } finally { setBusy(false); }
  };

  const removeFav = (f: Favorite) => Alert.alert(`${f.name}을(를) 즐겨찾기에서 뺄까요?`, undefined, [
    { text: '취소', style: 'cancel' },
    { text: '빼기', style: 'destructive', onPress: async () => {
      if (!token) return;
      try { p.setFamily(await putFamily(token, { favorites: favs.filter((x) => x !== f) })); if (dest.kind === 'fav' && dest.fav === f) setDest({ kind: 'home' }); }
      catch (e: any) { Alert.alert('빼지 못했어요', e?.message); }
    } },
  ]);

  const sunLabel = sunset != null ? `해 지기 30분 전 · ${clock(sunset - SUN_BEFORE)}` : '해 지기 30분 전';

  return (
    <Sheet open={open} onClose={onClose} full>
      <T v="title">오늘 도착 바꾸기</T>
      <T v="sub" c="ink3" style={{ marginTop: 4, marginBottom: 6 }}>
        지금 {endName(c)} {clock(c.arriveHomeMin)} 도착 예정 · 오늘 코스에만 적용돼요
      </T>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        <Label>도착 시간</Label>
        <Segmented<TimeMode> value={mode} onChange={setMode}
          options={[{ key: 'sun', label: '해 지기 전' }, { key: 'at', label: '직접 정하기' }, { key: 'dinner', label: '저녁 약속' }]} />
        <View style={{ marginTop: 10 }}>
          {mode === 'sun' && <T v="cap" c="ink2" style={{ fontFamily: F.b }}>{sunLabel}까지 도착하게 짜요</T>}
          {mode === 'at' && <ChipRow values={TIMES} value={atMin} label={(v) => `${clock(v)}까지`} onPick={setAtMin} />}
          {mode === 'dinner' && (
            <View style={{ gap: 8 }}>
              <ChipRow values={DINNERS} value={dinner} label={(v) => clock(v)} onPick={setDinner} />
              <T v="cap" c="ink3">저녁 약속 {clock(dinner)} 전에 도착지에 닿게 짜요</T>
            </View>
          )}
        </View>

        <View style={{ height: 18 }} />
        <Label>도착지</Label>
        <View style={{ backgroundColor: t.fill, borderRadius: 16, paddingHorizontal: 14 }}>
          <DestRow icon="house" title="집" sub={p.family?.home ? '우리 가족에서 정한 집' : '차가 아는 집'} on={dest.kind === 'home'} first
            onPress={() => setDest({ kind: 'home' })} />
          {favs.map((f) => (
            <DestRow key={`${f.name}-${f.lat}`} icon="star" title={f.name} sub="즐겨찾기" on={dest.kind === 'fav' && dest.fav === f}
              onPress={() => setDest({ kind: 'fav', fav: f })} onRemove={() => removeFav(f)} />
          ))}
          {dest.kind === 'map' && (
            <DestRow icon="map-pin" title={dest.name.trim() || '새 도착지'} sub={`${dest.at[0].toFixed(3)}, ${dest.at[1].toFixed(3)}`} on onPress={() => {}} />
          )}
          <DestRow icon="map" title="지도에서 고르기" sub="할머니 집·약속 장소 등" on={false} chevron onPress={() => setMapOpen(true)} />
        </View>
        {dest.kind === 'map' && (
          <View style={{ marginTop: 10, gap: 8 }}>
            <Input value={dest.name} onChange={(v) => setDest({ ...dest, name: v.slice(0, 20) })} placeholder="이름 (예: 할머니 집)" icon="pencil" />
            <Pressable onPress={() => { tick(); setSaveFav((v) => !v); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
              <Check on={saveFav} onPress={() => setSaveFav((v) => !v)} />
              <T v="cap" c="ink2" style={{ fontFamily: F.b }}>즐겨찾기에 저장 (다음에 바로 골라요)</T>
            </Pressable>
          </View>
        )}

        <View style={{ height: 18 }} />
        <Label>낮잠</Label>
        <Pressable onPress={() => { tick(); setNapOff((v) => !v); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.fill, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12 }}>
          <Icon name="moon" size={18} color={napOff ? t.accent : t.ink3} />
          <View style={{ flex: 1 }}>
            <T v="h" style={{ fontSize: 15, lineHeight: 21 }}>오늘만 낮잠 안 자요</T>
            <T v="cap" c="ink3">켜면 차에서 낮잠 맞춤 이동을 빼고 짜요</T>
          </View>
          <Check on={napOff} onPress={() => setNapOff((v) => !v)} />
        </Pressable>
      </ScrollView>
      <Btn title={changed ? '이대로 바꾸기' : '닫기'} icon={changed ? 'check' : undefined} kind={changed ? 'ink' : 'soft'} busy={busy || p.courseBusy}
        onPress={apply} style={{ marginTop: 12 }} />
      <MapPickSheet open={mapOpen} onClose={() => setMapOpen(false)} title="도착지 고르기" sub="오늘 코스를 이곳에서 끝내요 · 약 100m 단위로만 저장해요"
        start={dest.kind === 'map' ? dest.at : p.family?.home ?? null}
        onPick={(lat, lng) => { setMapOpen(false); setDest({ kind: 'map', at: [lat, lng], name: dest.kind === 'map' ? dest.name : '할머니 집' }); }} />
    </Sheet>
  );
}

function DestRow({ icon, title, sub, on, first, chevron, onPress, onRemove }: {
  icon: IconName; title: string; sub?: string; on: boolean; first?: boolean; chevron?: boolean; onPress: () => void; onRemove?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tick(); onPress(); }} onLongPress={onRemove}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: t.line, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: on ? t.accentSoft : t.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={on ? t.accent : t.ink2} />
      </View>
      <View style={{ flex: 1 }}>
        <T v="h" style={{ fontSize: 15, lineHeight: 21 }}>{title}</T>
        {!!sub && <T v="cap" c="ink3" numberOfLines={1}>{sub}</T>}
      </View>
      {onRemove && (
        <Pressable hitSlop={14} onPress={() => { tick(); onRemove(); }} accessibilityRole="button" accessibilityLabel={`${title} 지우기`} style={{ padding: 4 }}>
          <Icon name="x" size={15} color={t.ink3} />
        </Pressable>
      )}
      {chevron ? <Icon name="chevron-right" size={17} color={t.ink3} /> : on ? <Icon name="circle-check" size={19} color={t.accent} strokeWidth={2.3} /> : <Icon name="circle" size={19} color={t.fill2} />}
    </Pressable>
  );
}

/** 집 줄 아래 작은 글: 오늘만 바꾼 것들 (목표·낮잠) */
export function endNote(c: LiveCourse): string | null {
  const parts: string[] = [];
  if (c.userLimit) parts.push(`오늘 ${clock(c.limitMin)}까지`);
  if (c.napOff) parts.push('오늘 낮잠 없음');
  return parts.length ? parts.join(' · ') : null;
}
