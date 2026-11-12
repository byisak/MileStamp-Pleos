// 코스 편집 시트 — 카드(또는 진행 중 코스)의 장소 순서 바꾸기(위·아래)·빼기·더하기(가까운 곳 목록), 곳마다 오늘만 머무름(−15/+15).
// 바꿀 때마다 서버 미리 보기(POST /api/plan/preview, 저장 안 함)로 곳마다 도착 시각과 집 도착·귀가 한계 넘김을 보여 준다.
// '차로 보내기' → 부르는 쪽(onApply)이 고르기(choose stops + SetDwell) 또는 진행 중 코스 사건(Remote + SetDwell)으로 보낸다.
// live = 이미 다녀온 곳이 있는 코스: 다녀온 곳·머무는 곳은 위에 잠가 두고 남은 곳만 고친다.
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, ScrollView, View } from 'react-native';
import { Alert } from '../alert';
import { ApiError } from '../api';
import { clampDwell, durText, DWELL_MAX, DWELL_MIN, LiveCourse } from '../course';
import { PlaceCand, previewCourse, PreviewRes, type PlanOption, type StopRef } from '../plan';
import { clock } from '../timefmt';
import { place } from '../places';
import { usePlan } from '../planStore';
import { useSession } from '../session';
import { F, R } from '../theme';
import { Btn, done, Icon, IconName, Input, Pill, Sheet, T, tap, useTheme } from '../ui';
import { ActionButton } from '../parts';
import { CourseMiniMap } from './CourseMap';
import { today } from '../catalog';
import { W } from '../words';

export const MAX_STOPS = 3;
const indoorText = (v: boolean | undefined) => (v == null ? null : v ? '실내' : '야외');
export type EditStop = { id: string; name: string; indoor?: boolean; dwell: number };
type Locked = { id: string; name: string; note: string };

/** 진행 중 코스 → 편집 시트 재료. visited = 이미 다녀왔거나 머무는 곳이 있음(→ 남은 곳만 고치는 live 모드) */
export function courseEditInput(c: LiveCourse, name: (id: string) => string, indoor?: (id: string) => boolean | undefined) {
  const rem = c.stops.filter((s) => s.status === 'PLANNED' || s.status === 'NEXT');
  const visited = c.stops.some((s) => s.status === 'ARRIVED' || s.status === 'DONE');
  return {
    visited,
    locked: visited ? c.stops.filter((s) => s.status === 'ARRIVED' || s.status === 'DONE').map((s) => ({ id: s.placeId, name: name(s.placeId), note: s.status === 'ARRIVED' ? '머무는 중' : '다녀왔어요' })) : [],
    initial: rem.map((s) => ({ id: s.placeId, name: name(s.placeId), indoor: indoor?.(s.placeId), dwell: s.dwellGuessMin })),
    initialDwell: Object.fromEntries(rem.filter((s) => s.dwellSet).map((s) => [s.placeId, s.dwellGuessMin])) as Record<string, number>,
  };
}

type Pv =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; res: PreviewRes }
  | { kind: 'error'; text: string };

export function CourseEditSheet({ open, onClose, planId, live, locked, initial, initialDwell, onApply, anchorId, stopRef, day, applyLabel, applyIcon }: {
  /** 아래 큰 버튼 글 (기본 '차로 보내기') — 결과 카드에서 고칠 땐 '편집 저장' */
  applyLabel?: string; applyIcon?: IconName;
  open: boolean; onClose: () => void;
  /** 계획 날짜 — 고치는 대로 바뀌는 작은 코스 지도(실제 길·그날 교통)에 쓴다 */
  day?: string;
  planId: string;
  live?: boolean;
  locked?: Locked[];
  initial: EditStop[];
  /** 이미 오늘만 정한 머무름 {장소 id: 분} */
  initialDwell?: Record<string, number>;
  /** option = 고친 그대로 미리 본 카드(실제 길 시간) — 결과 카드를 바로 바꿔 보여 줄 때 */
  onApply: (stops: string[], dwell: Record<string, number>, option?: PlanOption) => Promise<void>;
  /** 앵커 코스('○○ 중심으로')를 고침: 그곳은 뺄 수 없고(순서는 바꿈) 미리 보기도 앵커 규칙 */
  anchorId?: string;
  /** 미리 보기로 보낼 칸 (바깥 장소는 이름·좌표째). 없으면 id */
  stopRef?: (id: string) => StopRef;
}) {
  const t = useTheme();
  const { token } = useSession();
  const p = usePlan();
  const [list, setList] = useState<EditStop[]>(initial);
  const [ov, setOv] = useState<Record<string, number>>(initialDwell ?? {});
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [cands, setCands] = useState<PlaceCand[] | null>(null);
  const [pv, setPv] = useState<Pv>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // 열 때마다 처음 값으로
  useEffect(() => {
    if (!open) return;
    setList(initial); setOv(initialDwell ?? {}); setAdding(false); setQ(''); setPv({ kind: 'idle' }); setBusy(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 바꿀 때마다 미리 보기 (0.3초 모아서). 처음 한 번은 더할 곳 후보도 같이
  const ids = list.map((s) => s.id);
  const key = `${ids.join()}|${JSON.stringify(ov)}`;
  useEffect(() => {
    if (!open || !token) return;
    if (!ids.length) { setPv({ kind: 'idle' }); return; }
    const my = ++seq.current;
    setPv((x) => (x.kind === 'ok' ? x : { kind: 'loading' }));
    const timer = setTimeout(async () => {
      const dwell = Object.fromEntries(Object.entries(ov).filter(([id]) => ids.includes(id)));
      try {
        const res = await previewCourse(token, {
          planId, stops: stopRef ? ids.map(stopRef) : ids, dwell, places: cands == null, live: !!live,
          ...(anchorId && ids.includes(anchorId) ? { anchor: anchorId } : {}),
        });
        if (my !== seq.current) return;
        if (res.places) setCands(res.places);
        setPv({ kind: 'ok', res });
      } catch (e: any) {
        if (my !== seq.current) return;
        const places = e instanceof ApiError ? (e.data as any)?.places : null;
        if (Array.isArray(places)) setCands(places);
        setPv({ kind: 'error', text: e instanceof ApiError && e.status === 404 ? '서버가 아직 미리 보기를 몰라요' : e?.message || '미리 보지 못했어요' });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [open, key, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // 곳마다 미리 본 도착·머무름
  const res = pv.kind === 'ok' ? pv.res : null;
  const info = (id: string): { arrive: number | null; dwell: number | null } => {
    if (res?.option) {
      const leg = res.option.legs.find((l) => l.kind === 'STAY' && l.placeId === id);
      return { arrive: leg?.fromMin ?? null, dwell: res.option.stops.find((s) => s.id === id)?.dwell?.minutes ?? null };
    }
    if (res?.course) {
      const s = res.course.stops.find((x) => x.placeId === id && (x.status === 'PLANNED' || x.status === 'NEXT'));
      return { arrive: s?.plannedArriveMin ?? null, dwell: s?.dwellGuessMin ?? null };
    }
    return { arrive: null, dwell: null };
  };
  const dwellOf = (s: EditStop) => ov[s.id] ?? info(s.id).dwell ?? s.dwell;
  const arriveHome = res ? (res.option?.arriveHomeMin ?? res.course?.arriveHomeMin ?? null) : null;

  const move = (i: number, d: -1 | 1) => {
    tap();
    setList((xs) => { const ys = [...xs]; const j = i + d; if (j < 0 || j >= ys.length) return xs; [ys[i], ys[j]] = [ys[j], ys[i]]; return ys; });
  };
  // 끌어서 순서 바꾸기: 왼쪽 손잡이를 잡고 위아래로. 끄는 카드는 손가락을 따라가고, 사이 카드들은 한 칸씩 비켜 준다.
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const heights = useRef<number[]>([]);
  const slot = () => { const hs = heights.current.filter(Boolean); return (hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 120) + 8; };
  const target = (d: { from: number; dy: number }) => Math.max(0, Math.min(list.length - 1, d.from + Math.round(d.dy / slot())));
  const lastTarget = useRef(-1);
  const dragMove = (from: number, dy: number) => {
    const d = { from, dy };
    const tg = target(d);
    if (tg !== lastTarget.current) { if (lastTarget.current !== -1) tap(); lastTarget.current = tg; }
    setDrag(d);
  };
  const dragEnd = (from: number, dy: number) => {
    const to = target({ from, dy });
    lastTarget.current = -1;
    setDrag(null);
    if (to === from) return;
    done();
    setList((xs) => { const ys = [...xs]; const [x] = ys.splice(from, 1); ys.splice(to, 0, x); return ys; });
  };
  const shiftOf = (i: number): number => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    const tg = target(drag);
    if (drag.from < tg && i > drag.from && i <= tg) return -slot();
    if (drag.from > tg && i < drag.from && i >= tg) return slot();
    return 0;
  };
  const remove = (i: number) => { tap(); setList((xs) => xs.filter((_, k) => k !== i)); };
  const step = (s: EditStop, d: number) => { tap(); setOv((o) => ({ ...o, [s.id]: clampDwell(dwellOf(s) + d) })); };
  const add = (c: { id: string; name: string; indoor?: boolean; dwell?: number }) => {
    tap();
    setList((xs) => (xs.length >= MAX_STOPS || xs.some((x) => x.id === c.id) ? xs : [...xs, { id: c.id, name: c.name, indoor: c.indoor, dwell: c.dwell ?? 60 }]));
    setAdding(false); setQ('');
  };

  const taken = new Set([...ids, ...(locked ?? []).map((x) => x.id)]);
  const pool = useMemo(() => {
    const base: { id: string; name: string; indoor?: boolean; dwell?: number; km?: number }[] =
      cands ?? p.knownPlaces.map((x) => ({ id: x.id, name: x.name }));
    const qq = q.trim();
    return base.filter((c) => !taken.has(c.id) && (!qq || c.name.includes(qq))).slice(0, 40);
  }, [cands, p.knownPlaces, q, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const anchorName = anchorId ? initial.find((x) => x.id === anchorId)?.name ?? null : null;
  const blocked = !ids.length || pv.kind === 'error' || (res != null && !res.fits);
  const apply = async () => {
    setBusy(true);
    try {
      const dwell = Object.fromEntries(Object.entries(ov).filter(([id]) => ids.includes(id)));
      await onApply(ids, dwell, res?.option ?? undefined);
      done();
      onClose();
    } catch (e: any) {
      Alert.alert('바꾸지 못했어요', e?.message);
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} full>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="pencil-line" size={20} color={t.accent} strokeWidth={2.2} />
        <T v="title" style={{ flex: 1 }}>코스 편집</T>
      </View>
      <T v="sub" c="ink3" style={{ marginTop: 4, marginBottom: 10 }}>
        {live ? '다녀온 곳은 그대로 두고, 남은 곳만 바꿔요'
          : anchorName ? `${anchorName}(중심)은 빼지 않고 순서만 바꿀 수 있어요 · 한 번에 ${MAX_STOPS}곳까지`
          : `⋮⋮를 끌어 순서를 바꾸고, 빼고, 더해 보세요 · 한 번에 ${MAX_STOPS}곳까지`}
      </T>

      <ScrollView scrollEnabled={!drag} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 6 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* 다녀온 곳 (잠금) */}
        {(locked ?? []).map((l) => (
          <View key={`lk-${l.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, opacity: 0.7 }}>
            <View style={{ width: 28, height: 28, borderRadius: R.md, backgroundColor: t.fill, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="circle-check" size={15} color={t.ink2} />
            </View>
            <T v="h" numberOfLines={1} c="ink2" style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>{l.name}</T>
            <T v="cap" c="ink3">{l.note}</T>
          </View>
        ))}

        {/* 고칠 곳 */}
        {list.map((s, i) => {
          const inf = info(s.id);
          const pi = place(s.id);
          const set = ov[s.id] != null;
          return (
            <View key={s.id} onLayout={(e) => { heights.current[i] = e.nativeEvent.layout.height; }}
              style={[{ marginTop: 8, backgroundColor: t.fill, borderRadius: 16, paddingVertical: 11, paddingLeft: 4, paddingRight: 6, transform: [{ translateY: shiftOf(i) }] },
                drag?.from === i && { zIndex: 10, elevation: 8, backgroundColor: t.surface, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, transform: [{ translateY: shiftOf(i) }, { scale: 1.02 }] }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {list.length > 1 && <DragHandle label={`${s.name} 끌어서 순서 바꾸기`} color={t.ink3}
                  onStart={() => { tap(); lastTarget.current = i; setDrag({ from: i, dy: 0 }); }}
                  onMove={(dy) => dragMove(i, dy)} onEnd={(dy) => dragEnd(i, dy)} />}
                <View style={{ width: 28, height: 28, borderRadius: R.md, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={pi?.icon ?? 'map-pin'} size={15} color={t.accent} strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <T v="h" numberOfLines={1} style={{ flexShrink: 1, fontSize: 15.5, lineHeight: 21 }}>{s.name}</T>
                    {s.id === anchorId && <Pill text="중심" tone="accent" />}
                  </View>
                  <T v="cap" c="ink2" style={{ fontVariant: ['tabular-nums'] }}>
                    {[inf.arrive != null ? `${clock(inf.arrive)} 도착` : pv.kind === 'loading' ? '계산 중…' : null, indoorText(s.indoor ?? cands?.find((c) => c.id === s.id)?.indoor)].filter(Boolean).join(' · ') || ' '}
                  </T>
                </View>
                <ActionButton label={`${s.name} 앞으로`} icon="arrow-up" iconOnly tone="ghost" size="sm" disabled={i === 0} onPress={() => move(i, -1)} />
                <ActionButton label={`${s.name} 뒤로`} icon="arrow-down" iconOnly tone="ghost" size="sm" disabled={i === list.length - 1} onPress={() => move(i, 1)} />
                {/* 중심 곳(앵커)은 뺄 수 없음 — 순서만 */}
                <ActionButton label={s.id === anchorId ? `${s.name}은 중심이라 뺄 수 없어요` : `${s.name} 빼기`} icon="x" iconOnly tone="ghost" size="sm"
                  disabled={s.id === anchorId} onPress={() => remove(i)} />
              </View>
              {/* 머무름: − 40분 + */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginLeft: list.length > 1 ? 66 : 34 }}>
                <Icon name="clock" size={14} color={t.ink} strokeWidth={2.2} />
                <T v="cap" style={{ fontFamily: F.b }}>머무름</T>
                <ActionButton label="15분 줄이기" icon="minus" iconOnly tone="surface" size="sm" disabled={dwellOf(s) <= DWELL_MIN} onPress={() => step(s, -15)} />
                <T v="h" style={{ minWidth: 76, textAlign: 'center', fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] }}>{durText(dwellOf(s))}</T>
                <ActionButton label="15분 늘리기" icon="plus" iconOnly tone="surface" size="sm" disabled={dwellOf(s) >= DWELL_MAX} onPress={() => step(s, 15)} />
                {set && <T v="cap" c="accent" style={{ fontFamily: F.b }}>오늘만</T>}
              </View>
            </View>
          );
        })}
        {!list.length && (
          <View style={{ marginTop: 8, backgroundColor: t.fill, borderRadius: 16, padding: 16, alignItems: 'center' }}>
            <T v="sub" c="ink3">{live ? '남은 곳이 없어요 · 집으로 가려면 코스 화면의 집으로 버튼' : '장소를 하나 이상 넣어 주세요'}</T>
          </View>
        )}

        {/* 더하기 */}
        {!adding ? (
          <Pressable disabled={list.length >= MAX_STOPS} onPress={() => { tap(); setAdding(true); }}
            style={({ pressed }) => ({ marginTop: 10, height: 46, borderRadius: R.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: list.length >= MAX_STOPS ? 0.45 : pressed ? 0.6 : 1 })}>
            <Icon name="circle-plus" size={17} color={t.accent} />
            <T v="btn" style={{ color: t.accent, fontSize: 14.5 }}>{list.length >= MAX_STOPS ? `${MAX_STOPS}곳까지 넣을 수 있어요` : '장소 더하기'}</T>
          </Pressable>
        ) : (
          <View style={{ marginTop: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Input value={q} onChange={setQ} placeholder="장소 이름으로 찾기" icon="search" style={{ flex: 1, minHeight: 44 }} />
              <Pressable hitSlop={8} onPress={() => { tap(); setAdding(false); setQ(''); }}>
                <T v="cap" c="ink2" style={{ fontFamily: F.b }}>닫기</T>
              </Pressable>
            </View>
            <T v="cap" c="ink3" style={{ marginTop: 6, marginLeft: 2 }}>{cands ? '코스에서 가까운 순' : '아는 곳'}</T>
            <View style={{ marginTop: 4, backgroundColor: t.fill, borderRadius: 16, paddingHorizontal: 12 }}>
              {pool.map((c, i) => (
                <Pressable key={c.id} onPress={() => add(c)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, opacity: pressed ? 0.6 : 1 })}>
                  <Icon name={place(c.id)?.icon ?? 'map-pin'} size={16} color={t.ink2} />
                  <View style={{ flex: 1 }}>
                    <T v="h" numberOfLines={1} style={{ fontSize: 14.5, lineHeight: 20 }}>{c.name}</T>
                    {(c.indoor != null || c.dwell != null) && (
                      <T v="cap" c="ink3">
                        {[c.indoor == null ? null : c.indoor ? '실내' : '야외', c.dwell != null ? `머무름 ${durText(c.dwell)}` : null, c.km != null ? `${c.km}km` : null].filter(Boolean).join(' · ')}
                      </T>
                    )}
                  </View>
                  <Icon name="plus" size={16} color={t.accent} />
                </Pressable>
              ))}
              {!pool.length && <T v="sub" c="ink3" style={{ paddingVertical: 14, textAlign: 'center' }}>더할 곳이 없어요</T>}
            </View>
          </View>
        )}
      </ScrollView>

      {/* 고친 순서 그대로의 코스 지도 — 미리 보기가 올 때마다 다시 그림 (진행 중 코스는 오늘 화면 지도가 맡음) */}
      {res?.option && res.option.stops.length > 0 && (
        <CourseMiniMap o={res.option} height={150} compare={false} day={day}
          home={p.family?.home ? { lat: p.family.home[0], lng: p.family.home[1] } : null}
          start={!day || day === today() ? p.hereNow() : null} />
      )}
      {/* 미리 보기: 집 도착 · 귀가 한계 */}
      <Summary pv={pv} arriveHome={arriveHome} empty={!ids.length} />

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Btn title="닫기" kind="soft" onPress={onClose} style={{ flex: 1 }} />
        <Btn title={applyLabel ?? W.send} icon={applyIcon ?? "send"} busy={busy} disabled={blocked || pv.kind === 'loading'} onPress={apply} style={{ flex: 2 }} />
      </View>
    </Sheet>
  );
}

function Summary({ pv, arriveHome, empty }: { pv: Pv; arriveHome: number | null; empty: boolean }) {
  const t = useTheme();
  if (empty) return null;
  const box = (bg: string, children: ReactNode) => (
    <View style={{ marginTop: 10, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', gap: 8 }}>{children}</View>
  );
  if (pv.kind === 'error') return box(t.redSoft, <><Icon name="circle-alert" size={16} color={t.red} /><T v="cap" c="red" style={{ flex: 1, fontFamily: F.b }}>{pv.text}</T></>);
  if (pv.kind !== 'ok' || arriveHome == null) {
    return box(t.fill, <><ActivityIndicator size="small" color={t.ink3} /><T v="cap" c="ink3">집 도착 시각 계산 중…</T></>);
  }
  const r = pv.res;
  if (!r.fits) {
    return box(t.redSoft, <><Icon name="triangle-alert" size={16} color={t.red} /><T v="cap" c="red" style={{ flex: 1, fontFamily: F.b }}>
      집 도착 {clock(arriveHome)} · 귀가 한계 {clock(r.limitMin)}(여유 10분)에 못 맞춰요 · 머무름을 줄이거나 장소를 빼 주세요</T></>);
  }
  if (r.over) {
    return box(t.redSoft, <><Icon name="triangle-alert" size={16} color={t.red} /><View style={{ flex: 1 }}>
      <T v="h" c="red" style={{ fontSize: 15, lineHeight: 21 }}>집 도착 {clock(arriveHome)}</T>
      <T v="cap" c="red">{arriveHome > r.limitMin ? `귀가 한계 ${clock(r.limitMin)}보다 ${arriveHome - r.limitMin}분 늦어요` : `귀가 한계 ${clock(r.limitMin)}에 빠듯해요 (여유 10분 안쪽)`} · 머무름을 줄이면 맞춰져요</T>
    </View></>);
  }
  return box(t.accentSoft, <><Icon name="house" size={16} color={t.accentInk} /><View style={{ flex: 1 }}>
    <T v="h" style={{ color: t.accentInk, fontSize: 15, lineHeight: 21 }}>집 도착 {clock(arriveHome)}</T>
    <T v="cap" style={{ color: t.accentInk, opacity: 0.8 }}>귀가 한계 {clock(r.limitMin)} 안이에요</T>
  </View></>);
}


/** 끌기 손잡이 (⋮⋮) — 누르는 순간 잡히고, 시트·목록 스크롤에 손가락을 빼앗기지 않는다 */
function DragHandle({ label, color, onStart, onMove, onEnd }: { label: string; color: string; onStart: () => void; onMove: (dy: number) => void; onEnd: (dy: number) => void }) {
  const cb = useRef({ onStart, onMove, onEnd });
  cb.current = { onStart, onMove, onEnd };
  const pr = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => cb.current.onStart(),
    onPanResponderMove: (_, g) => cb.current.onMove(g.dy),
    onPanResponderRelease: (_, g) => cb.current.onEnd(g.dy),
    onPanResponderTerminate: (_, g) => cb.current.onEnd(g.dy),
  })).current;
  return (
    <View {...pr.panHandlers} accessible accessibilityLabel={label} hitSlop={{ top: 10, bottom: 10, left: 6, right: 4 }}
      style={{ width: 26, height: 40, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="grip-vertical" size={18} color={color} strokeWidth={2.2} />
    </View>
  );
}
