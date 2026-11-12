// 일정 탭: 날짜별로 정해 둔 나들이 — 위 2주 띠(코스 있는 날 점, 누르면 그 날 카드로) → 다가오는 나들이(날마다 카드) → 지난 나들이(5개 + 더 보기).
// 카드를 누르면 자세히 시트: 코스 지도 · 곳마다 시각 · 코스 고치기 · 날짜 옮기기 · 이 코스 취소하기 (+ 오늘이면 차로 보내기).
// 서버: GET /api/plan/schedule · POST /api/plan/schedule/move · 취소 = 고르기 취소(POST /api/plan/choose {idx: null})
import { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import type { Tab } from '../../App';
import { Alert } from '../alert';
import { pickableDays, setAskMemory, ymdOf } from '../ask';
import { today as phoneToday } from '../catalog';
import { chooser, iGa } from '../plan';
import { usePlan } from '../planStore';
import { useEvents } from '../events';
import { useClosedStops } from '../placeDetail';
import { optionOfPlan, planStopRef, type PastPlan, type UpcomingPlan } from '../schedule';
import { clock } from '../timefmt';
import { F, R, S } from '../theme';
import { done, Icon, plainError, Sheet, SkeletonList, T, tick, useTheme, wide } from '../ui';
import { ActionButton, Empty, ErrorRow, PrimaryCTA, StopTimeline, type TimelineStop } from '../parts';
import { CourseEditSheet } from './CourseEditSheet';
import { CourseMiniMap } from './CourseMap';
import { dayText } from './ScheduledCourse';

/** 지난 나들이는 처음 몇 개만 */
const PAST_ROWS = 5;
const AHEAD = 14;
const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** 오늘부터 n일 (폰 날짜) */
function daysFrom(start: string, n: number) {
  const d0 = new Date(`${start}T00:00:00`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(d0); d.setDate(d.getDate() + i);
    return { day: ymdOf(d), date: d.getDate(), wd: WD[d.getDay()], dow: d.getDay(), md: `${d.getMonth() + 1}/${d.getDate()}` };
  });
}

/** '엄마가 골랐어요' · '차에서 골랐어요' */
function chosenText(by: string | null): string | null {
  const c = chooser(by);
  if (!c) return null;
  return c.car ? '차에서 골랐어요' : `${c.who}${iGa(c.who)} 골랐어요`;
}

export function ScheduleTab({ go }: { go: (tab: Tab) => void }) {
  const t = useTheme();
  const p = usePlan();
  const { openDiary } = useEvents();
  const sched = p.schedule;
  const data = sched && sched !== 'unsupported' ? sched : null;
  const today = data?.today ?? phoneToday();
  const [openId, setOpenId] = useState<string | null>(null);
  const [allPast, setAllPast] = useState(false);
  const scroll = useRef<any>(null); // RN 0.88 ScrollView 참조 타입이 맞지 않아 any (FamilySheet와 같음)
  const listY = useRef(0);
  const cardY = useRef<Record<string, number>>({});

  const upcoming = useMemo(() => data?.upcoming ?? [], [data]);
  const past = data?.past ?? [];
  const byDay = useMemo(() => new Map(upcoming.map((u) => [u.day, u])), [upcoming]);
  const open = upcoming.find((u) => u.planId === openId) ?? null;

  const jump = (day: string) => {
    const y = cardY.current[day];
    if (y == null) return;
    tick();
    scroll.current?.scrollTo({ y: Math.max(0, listY.current + y - S.l), animated: true });
  };
  const plan = () => { tick(); setAskMemory({ detailed: false }); go('today'); };

  return (
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[{ paddingHorizontal: S.page, paddingBottom: S.sec * 2 }, wide]}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => { p.loadSchedule(); }} colors={[t.accent]} progressBackgroundColor={t.surface} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 4, minHeight: 40 }}>
        <T v="display" accessibilityRole="header" style={{ flex: 1 }}>일정</T>
        {upcoming.length > 0 && <ActionButton label="계획하기" icon="plus" tone="accent" size="sm" onPress={plan} />}
      </View>
      <T v="sub" c="ink3">정해 둔 나들이가 날짜별로 모여요</T>

      {/* 2주 띠: 코스가 있는 날 점, 누르면 그 날 카드로 */}
      <DayStrip today={today} has={(d) => byDay.has(d)} onPick={jump} />

      {sched === null ? (
        p.scheduleError ? <ErrorRow title={p.scheduleError} sub="인터넷을 확인하고 다시 불러와 주세요" onRetry={p.loadSchedule} style={{ marginTop: S.xl }} />
          : <View style={{ marginTop: S.xl }}><SkeletonList rows={2} /></View>
      ) : sched === 'unsupported' ? (
        <View style={{ marginTop: S.xl, backgroundColor: t.surface, borderRadius: R.lg }}>
          <Empty compact icon="calendar" title="일정은 서버를 새로 올리면 보여요" sub="지금은 오늘 탭에서 정한 코스를 볼 수 있어요" />
        </View>
      ) : (
        <>
          <SectionHead icon="calendar" title="다가오는 나들이" count={upcoming.length} />
          {upcoming.length === 0 ? (
            <View style={{ backgroundColor: t.surface, borderRadius: R.lg }}>
              <Empty compact icon="calendar" title="정해 둔 나들이가 없어요" sub={'오늘이나 주말 코스를 정해 두면\n여기에 날짜별로 모여요'}
                action={<PrimaryCTA title="나들이 계획하기" icon="route" onPress={plan} style={{ alignSelf: 'stretch', marginTop: S.l }} />} />
            </View>
          ) : (
            <View style={{ gap: S.m }} onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
              {upcoming.map((u) => (
                <View key={u.planId} onLayout={(e) => { cardY.current[u.day] = e.nativeEvent.layout.y; }}>
                  <UpcomingCard u={u} isToday={u.day === today} onPress={() => { tick(); setOpenId(u.planId); }} />
                </View>
              ))}
            </View>
          )}

          {past.length > 0 && (
            <>
              <SectionHead icon="stamp" title="지난 나들이" count={past.length} />
              <View style={{ backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.l + 2 }}>
                {(allPast ? past : past.slice(0, PAST_ROWS)).map((x, i) => (
                  <View key={x.planId} style={i ? { borderTopWidth: 1, borderTopColor: t.line } : undefined}><PastRow x={x} onPress={() => { tick(); openDiary(x.day); }} /></View>
                ))}
              </View>
              {past.length > PAST_ROWS && (
                <ActionButton label={allPast ? '접기' : `더 보기 · ${past.length - PAST_ROWS}개`} tone="ghost" size="sm" onPress={() => setAllPast((v) => !v)}
                  style={{ alignSelf: 'center', marginTop: S.s }} />
              )}
            </>
          )}
        </>
      )}

      {open && <PlanDetail key={open.planId} u={open} today={today} taken={(d) => byDay.has(d)} onClose={() => setOpenId(null)}
        onMoved={(day) => { setOpenId(null); setTimeout(() => jump(day), 400); }} />}
    </ScrollView>
  );
}

function SectionHead({ icon, title, count }: { icon: 'calendar' | 'stamp'; title: string; count: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, marginTop: S.sec + 4, marginBottom: S.m, paddingHorizontal: S.xs, minHeight: 28 }}>
      <Icon name={icon} size={17} color={t.ink} strokeWidth={2.1} />
      <T v="h" accessibilityRole="header" style={{ flex: 1 }}>{title}</T>
      {count > 0 && <T v="cap" c="ink3">{count}개</T>}
    </View>
  );
}

/** 위 2주 띠 — 오늘부터 15일. 코스 있는 날은 초록 점, 오늘은 연초록 칸 */
function DayStrip({ today, has, onPick }: { today: string; has: (day: string) => boolean; onPick: (day: string) => void }) {
  const t = useTheme();
  const days = useMemo(() => daysFrom(today, AHEAD + 1), [today]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: S.l, marginHorizontal: -S.page }}
      contentContainerStyle={{ paddingHorizontal: S.page, gap: S.s }}>
      {days.map((d) => {
        const on = has(d.day);
        const isToday = d.day === today;
        return (
          <Pressable key={d.day} disabled={!on} onPress={() => onPick(d.day)} accessibilityRole="button"
            accessibilityLabel={`${d.md} ${d.wd}요일${isToday ? ' 오늘' : ''}${on ? ' · 나들이 있음' : ''}`} accessibilityState={{ disabled: !on }}
            style={({ pressed }) => ({ width: 46, minHeight: 64, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', gap: 2,
              backgroundColor: pressed ? t.line : isToday ? t.accentSoft : t.surface })}>
            <T v="cap" c={isToday ? 'accentInk' : d.dow === 0 || d.dow === 6 ? 'red' : 'ink3'} style={{ fontSize: 12.5 }}>{isToday ? '오늘' : d.wd}</T>
            <T v="h" style={{ fontVariant: ['tabular-nums'], color: isToday ? t.accentInk : on ? t.ink : t.ink2 }}>{d.date}</T>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: on ? t.accent : 'transparent' }} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** 다가오는 나들이 카드: '11/7(토) · 오전 8:30 출발 · 오후 4:50 귀가' + 곳 이름 → … + 고른 사람 */
function UpcomingCard({ u, isToday, onPress }: { u: UpcomingPlan; isToday: boolean; onPress: () => void }) {
  const t = useTheme();
  const who = chosenText(u.chosenBy);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${isToday ? '오늘' : dayText(u.day)} 나들이 자세히`}
      style={({ pressed }) => ({ backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.xl, paddingVertical: S.l + 2, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, minHeight: 24 }}>
        {isToday ? (
          <View style={{ paddingHorizontal: S.m, height: 22, borderRadius: 11, backgroundColor: t.accent, justifyContent: 'center' }}>
            <T v="label" c="onAccent">오늘</T>
          </View>
        ) : <Icon name="calendar" size={16} color={t.accent} strokeWidth={2.2} />}
        <T v="label" c="accent" style={{ flex: 1 }} numberOfLines={1}>
          {`${isToday ? '' : `${dayText(u.day)} · `}${clock(u.departMin)} 출발 · ${clock(u.arriveHomeMin)} 귀가`}
        </T>
        <Icon name="chevron-right" size={18} color={t.ink3} />
      </View>
      <T v="h" style={{ marginTop: S.s }} numberOfLines={2}>{u.stops.map((s) => s.name).join(' → ') || u.title}</T>
      {!!who && <T v="cap" c="ink3" style={{ marginTop: S.xxs }}>{who}</T>}
    </Pressable>
  );
}

/** 지난 나들이 한 줄: 날짜 · 도장 N개 + 곳마다 들렀으면 ✓. 누르면 그날의 기록 */
function PastRow({ x, onPress }: { x: PastPlan; onPress: () => void }) {
  const t = useTheme();
  const visited = new Set(x.visited);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ paddingVertical: S.l, opacity: pressed ? 0.6 : 1 })} accessibilityRole="button" accessibilityHint="그날의 기록을 열어요"
      accessibilityLabel={`${dayText(x.day)} ${x.stops.map((s) => `${s.name}${visited.has(s.placeId) ? ' 들름' : ''}`).join(', ')} · 도장 ${x.stampsEarned}개`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s }}>
        <T v="label" style={{ flex: 1 }}>{dayText(x.day)}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
          <Icon name="stamp" size={14} color={x.stampsEarned ? t.accent : t.ink3} />
          <T v="cap" c={x.stampsEarned ? 'accent' : 'ink3'}>{`도장 ${x.stampsEarned}개`}</T>
        </View>
        <Icon name="chevron-right" size={16} color={t.ink3} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.xs, marginTop: S.s }}>
        {x.stops.map((s, i) => {
          const v = visited.has(s.placeId);
          return (
            <View key={`${s.placeId}:${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              {i > 0 && <T v="cap" c="ink3" style={{ marginRight: 2 }}>→</T>}
              {v && <Icon name="check" size={14} color={t.accent} strokeWidth={2.6} />}
              <T v="sub" c={v ? 'ink' : 'ink3'}>{s.name}</T>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

// ---------- 자세히 ----------
type Mode = 'detail' | 'edit' | 'move';

function PlanDetail({ u, today, taken, onClose, onMoved }: {
  u: UpcomingPlan; today: string; taken: (day: string) => boolean; onClose: () => void; onMoved: (day: string) => void;
}) {
  const t = useTheme();
  const p = usePlan();
  const [mode, setMode] = useState<Mode>('detail');
  const [busy, setBusy] = useState(false);
  const isToday = u.day === today;
  const label = isToday ? '오늘' : dayText(u.day);
  const started = u.course.stops.some((s) => s.status === 'ARRIVED' || s.status === 'DONE');
  const closed = useClosedStops(u.stops.map((s) => ({ id: s.placeId, name: s.name })), u.day);
  const home = p.family?.home ? { lat: p.family.home[0], lng: p.family.home[1] } : null;
  const o = useMemo(() => optionOfPlan(u), [u]);
  const who = chosenText(u.chosenBy);

  const stops: TimelineStop[] = [
    ...u.stops.map((s, i): TimelineStop => ({
      key: `${s.placeId}:${i}`, name: s.name,
      state: s.status === 'DONE' ? 'done' : s.status === 'ARRIVED' ? 'here' : s.status === 'NEXT' && isToday ? 'next' : 'todo',
      time: `${clock(s.arriveMin)} 도착 · ${clock(s.departMin)}에 나서요`,
    })),
    { key: 'home', name: '집', state: 'end', time: `${clock(u.arriveHomeMin)} 도착` },
  ];

  const run = async (f: () => Promise<void>, fail: string) => {
    setBusy(true);
    try { await f(); }
    catch (e) { Alert.alert(fail, plainError(e, '잠시 뒤 다시 눌러 주세요')); }
    finally { setBusy(false); }
  };

  const cancel = () => Alert.alert(`${label} 코스를 취소할까요?`, isToday ? '차 화면의 코스도 지워지고, 다시 고를 수 있어요.' : '일정에서 지워지고, 그날 갈 곳을 다시 고를 수 있어요.', [
    { text: '아니요', style: 'cancel' },
    { text: '취소하기', style: 'destructive', onPress: () => run(async () => { await p.cancelCourse(u.planId); done(); onClose(); }, '취소하지 못했어요') },
  ]);

  const send = () => run(async () => {
    await p.choosePlanned(u.planId, { stops: u.stops.map((s) => planStopRef(u, s.placeId)), ...(u.anchorId ? { anchor: u.anchorId } : {}) },
      Object.fromEntries(u.course.stops.filter((s) => s.dwellSet && s.status !== 'SKIPPED').map((s) => [s.placeId, s.dwellGuessMin])));
    done();
    Alert.alert('차로 보냈어요', '시동을 걸면 차 화면에 이 코스가 떠 있어요');
    onClose();
  }, '보내지 못했어요');

  const move = (day: string, replace = false) => run(async () => {
    const r = await p.moveCourse(u.planId, day, replace);
    if (r.ok) {
      done();
      Alert.alert(`${day === today ? '오늘' : dayText(day)}로 옮겼어요`, '그날 날씨·문 여는 시간에 맞춰 시간표도 다시 짰어요');
      onMoved(day);
      return;
    }
    if (r.kind === 'conflict') {
      Alert.alert(r.message, r.existing?.stops.length ? `그날 코스: ${r.existing.stops.join(' → ')}` : '그날 정해 둔 코스가 이 코스로 바뀌어요', [
        { text: '아니요', style: 'cancel' },
        { text: '바꾸기', style: 'destructive', onPress: () => move(day, true) },
      ]);
      return;
    }
    Alert.alert('옮기지 못했어요', r.message);
  }, '옮기지 못했어요');

  return (
    <>
      <Sheet open={mode === 'detail'} onClose={onClose} full>
        <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s }}>
            <Icon name="calendar" size={18} color={t.accent} strokeWidth={2.2} />
            <T v="label" c="accent" style={{ flex: 1 }}>{isToday ? `오늘 · ${dayText(u.day)}` : dayText(u.day)}</T>
          </View>
          <T v="title" accessibilityRole="header" style={{ marginTop: S.xs }}>{`${clock(u.departMin)} 출발 · ${clock(u.arriveHomeMin)} 귀가`}</T>
          <T v="cap" c="ink3" style={{ marginTop: S.xxs }}>
            {[u.title, who, isToday ? '차 화면에 떠 있는 코스예요' : '그날 아침 시동을 걸면 차 화면에 떠요'].filter(Boolean).join(' · ')}
          </T>
          <CourseMiniMap o={o} home={home} day={u.day} compare={false} />
          <View style={{ marginTop: S.l }}><StopTimeline stops={stops} /></View>
          {closed.names.length > 0 && (
            <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.l, backgroundColor: t.redSoft, borderRadius: R.md, padding: S.l }}>
              <Icon name="triangle-alert" size={16} color={t.redText} style={{ marginTop: 1 }} />
              <T v="sub" c="redText" style={{ flex: 1 }}>{closed.names.join(', ')} · 그날 쉬어요. 코스를 고치거나 날짜를 옮겨 주세요</T>
            </View>
          )}
          {isToday && !started && closed.names.length === 0 && (
            <PrimaryCTA title="차로 보내기" icon="send" busy={busy} onPress={send} style={{ marginTop: S.xl }} />
          )}
          <View style={{ flexDirection: 'row', gap: S.s, marginTop: isToday && !started ? S.m : S.xl }}>
            <ActionButton label="코스 고치기" icon="pencil" size="row" disabled={busy || started} onPress={() => { tick(); setMode('edit'); }} style={{ flex: 1 }} />
            <ActionButton label="날짜 옮기기" icon="calendar-clock" size="row" disabled={busy || started} onPress={() => { tick(); setMode('move'); }} style={{ flex: 1 }} />
          </View>
          <ActionButton label="이 코스 취소하기" icon="circle-x" tone="danger" size="row" disabled={busy} onPress={cancel} style={{ marginTop: S.s }} />
          {started && <T v="cap" c="ink3" style={{ marginTop: S.s, textAlign: 'center' }}>이미 다녀온 곳이 있어서 오늘 탭에서 고칠 수 있어요</T>}
        </ScrollView>
      </Sheet>

      {mode === 'edit' && (
        <CourseEditSheet open onClose={() => setMode('detail')} day={u.day} planId={u.planId} anchorId={u.anchorId} stopRef={(id) => planStopRef(u, id)}
          initial={u.course.stops.filter((s) => s.status === 'PLANNED' || s.status === 'NEXT').map((s) => ({ id: s.placeId, name: u.stops.find((x) => x.placeId === s.placeId)?.name ?? p.placeName(s.placeId), dwell: s.dwellGuessMin }))}
          initialDwell={Object.fromEntries(u.course.stops.filter((s) => s.dwellSet).map((s) => [s.placeId, s.dwellGuessMin]))}
          onApply={async (ids, dwell) => {
            await p.choosePlanned(u.planId, { stops: ids.map((id) => planStopRef(u, id)), ...(u.anchorId && ids.includes(u.anchorId) ? { anchor: u.anchorId } : {}) }, dwell);
            done();
            setMode('detail');
          }} />
      )}

      <MoveSheet open={mode === 'move'} from={u.day} today={today} taken={taken} busy={busy}
        onClose={() => setMode('detail')} onPick={(day) => { setMode('detail'); move(day); }} />
    </>
  );
}

/** 날짜 옮기기: 오늘부터 2주 · 7칸씩. 지금 날은 막고, 코스가 있는 날은 점 */
function MoveSheet({ open, from, today, taken, busy, onClose, onPick }: {
  open: boolean; from: string; today: string; taken: (day: string) => boolean; busy: boolean; onClose: () => void; onPick: (day: string) => void;
}) {
  const t = useTheme();
  // 오늘 + 내일부터 2주 (대화형 고르기 달력과 같은 날짜 칸)
  const days = useMemo(() => [daysFrom(today, 1)[0], ...pickableDays(new Date(), AHEAD).map((d) => ({ ...d, date: Number(d.md.split('/')[1]) }))]
    .filter((d, i, a) => a.findIndex((x) => x.day === d.day) === i), [today]);
  return (
    <Sheet open={open} onClose={onClose}>
      <T v="title">날짜 옮기기</T>
      <T v="sub" c="ink3" style={{ marginTop: S.xs, marginBottom: S.l }}>같은 곳·같은 순서로, 그날 날씨와 문 여는 시간에 맞춰 다시 짜요</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.s }}>
        {days.map((d) => {
          const cur = d.day === from;
          const has = taken(d.day) && !cur;
          return (
            <Pressable key={d.day} disabled={cur || busy} accessibilityRole="button" accessibilityState={{ disabled: cur || busy }}
              accessibilityLabel={`${d.md} ${d.wd}요일${d.day === today ? ' 오늘' : ''}${cur ? ' · 지금 날' : has ? ' · 다른 코스 있음' : ''}`}
              onPress={() => { tick(); onPick(d.day); }}
              style={({ pressed }) => ({ width: '13%', minWidth: 44, minHeight: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 1,
                backgroundColor: cur ? t.accentSoft : pressed ? t.line : t.fill, opacity: busy ? 0.5 : 1 })}>
              <T v="cap" c={cur ? 'accentInk' : d.day === today ? 'accent' : d.dow === 0 || d.dow === 6 ? 'red' : 'ink3'} style={{ fontSize: 12.5 }}>{d.day === today ? '오늘' : d.wd}</T>
              <T v="h" style={{ color: cur ? t.accentInk : t.ink, fontFamily: cur ? F.xb : F.b }}>{d.date}</T>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: has ? t.ink3 : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.l, marginTop: S.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: t.accentSoft }} />
          <T v="cap" c="ink3">지금 날</T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink3 }} />
          <T v="cap" c="ink3">다른 코스가 있는 날</T>
        </View>
      </View>
    </Sheet>
  );
}
