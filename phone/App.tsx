// 마일스탬프 가족 폰 앱. 틀은 MindNest 앱(~/mindnest/app/App.tsx)과 같다: 아래 탭 + 탭 화면 유지 + 뒤로 가기는 오늘로.
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertHost } from './src/alert';
import { EventsProvider, useEvents } from './src/events';
import { BragSheet } from './src/screens/Brag';
import { getStamps } from './src/api';
import { festivalById, loadCatalog, refreshCatalog } from './src/catalog';
import { MedalInfo, MedalOverlay, medalShareTarget, medalTipTarget, storyEvent } from './src/medal';
import { dayOf } from './src/diary';
import { DiaryScreen } from './src/screens/Diary';
import { CarTab } from './src/screens/Car';
import { DevTab } from './src/screens/Dev';
import { ListenSheet } from './src/screens/Listen';
import { Onboarding } from './src/screens/Onboarding';
import { MissionSheet } from './src/screens/Missions';
import { gotCount, StampsTab, type StampsSection } from './src/screens/Stamps';
import { TogetherTab } from './src/screens/Together';
import { TogetherHosts } from './src/screens/TogetherSheets';
import { askTipOnce, openComposer, useTogetherStore } from './src/community';
import { TodayTab } from './src/screens/Today';
import { ScheduleTab } from './src/screens/Schedule';
import { PlanProvider } from './src/planStore';
import { SessionProvider, useSession } from './src/session';
import { F, loadThemeMode } from './src/theme';
import { loadTimeFmt, useTimeFmt } from './src/timefmt';
import { loadDemoClean, setDemoClean, useDemoClean } from './src/devclean';
import { Icon, IconName, MAX_W, T, tick, useTheme } from './src/ui';

export default function App() {
  const t = useTheme();
  // 서버 명소 목록·관리자에서 바꾼 도장 그림 (켤 때 한 번, 실패하면 앱에 든 것)
  useEffect(() => {
    loadCatalog();
    // 다시 앞에 오면 새 축제·도장이 있는지 (10분에 한 번까지, ?since= 버전이 같으면 서버가 unchanged)
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refreshCatalog(); });
    return () => sub.remove();
  }, []);
  // 시간 표시(12/24시간, 우리 차 탭) — 저장된 값
  useEffect(() => { loadTimeFmt(); }, []);
  // 화면 모드(시스템 따름·밝게·어둡게, 우리 차 탭) — 저장된 값. useTheme()이 구독해서 바로 다시 그림
  useEffect(() => { loadThemeMode(); }, []);
  // 시연용 깔끔 보기(개발 탭) — 저장된 값
  useEffect(() => { loadDemoClean(); }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <SessionProvider>
        <Root />
      </SessionProvider>
      <AlertHost />
    </SafeAreaProvider>
  );
}

function Root() {
  const t = useTheme();
  const { token } = useSession();
  if (token === undefined) return <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ink3} /></View>;
  return token ? <EventsProvider><PlanProvider><Shell /></PlanProvider></EventsProvider> : <Onboarding />;
}

/** 알림이나 목록에서 연 소식 → 해당 시트. 도장은 메달 연출 → '도장북에 넣기'로 도장북 탭 */
function OpenedSheets({ go }: { go: (tab: Tab) => void }) {
  const { token } = useSession();
  const { opened, open, diaryDay, openDiary } = useEvents();
  const close = () => open(null);
  const [medal, setMedal] = useState<MedalInfo | null>(null);
  useEffect(() => {
    if (opened?.kind !== 'stamp' || !opened.place_id) { setMedal(null); return; }
    const key = opened.place_id === 'thearc' && opened.payload.rare ? 'thearc_rain' : opened.place_id;
    // 축제 한정 도장: payload.festivalId (목록에 없으면 소식의 이름·계절로)
    const fid = typeof opened.payload.festivalId === 'string' ? opened.payload.festivalId : null;
    const f = festivalById(fid);
    const festival = fid ? { id: fid, name: f?.name ?? '축제', season: f?.season ?? String(opened.payload.season ?? ''), placeId: f?.placeId ?? null } : null;
    setMedal({ key, number: opened.payload.number ?? null, festival, day: dayOf(opened.created_at) });
    // 모은 도장 수(이 도장 전·후)는 서버에서 — 연출이 도는 동안 채워진다
    let alive = true;
    if (token) getStamps(token).then(({ stamps }) => {
      if (!alive) return;
      const after = stamps.some((s) => s.id === opened.id) ? stamps : [...stamps, { id: opened.id, place_id: opened.place_id!, payload: opened.payload, created_at: opened.created_at }];
      setMedal((m) => m && m.key === key ? { ...m, before: gotCount(after.filter((s) => s.id !== opened.id)), after: gotCount(after) } : m);
    }).catch(() => {});
    return () => { alive = false; };
  }, [opened, token]);
  return (
    <>
      <ListenSheet event={opened} onClose={close} />
      <BragSheet event={opened} onClose={close} />
      {/* 일기 완성 알림·일정 탭 지난 나들이 → 그날의 기록 */}
      <DiaryScreen day={diaryDay} onClose={() => openDiary(null)} />
      <MissionSheet mission={opened?.kind === 'mission' ? { id: opened.id, place_id: opened.place_id } : null} onClose={close} />
      <MedalOverlay medal={medal} onDone={(how) => {
        const key = medal?.key;
        const m = medal;
        setMedal(null);
        if (how === 'listen' && key) open(storyEvent(key)); // 그 장소 이야기를 처음부터
        else if (how === 'share' && m) { close(); openComposer(medalShareTarget(m)); } // 함께에 자랑하기
        else { close(); if (how === 'keep') go('stamps'); }
        // 새 도장을 넣은 뒤 한 번만 '이 곳 아이랑 어땠어요?' (장소마다 한 번)
        if (m && !m.view && how !== 'share' && how !== 'listen') { const tip = medalTipTarget(m); if (tip) setTimeout(() => askTipOnce(tip), 450); }
      }} />
    </>
  );
}

// ---------------- 탭 ----------------
// 'missions'는 탭이 아니라 도장북의 '미션' 칸으로 가는 길 (11/2 미션 탭 → 도장북 안, 그 자리에 '함께')
export type Tab = 'today' | 'schedule' | 'together' | 'stamps' | 'missions' | 'car' | 'dev';
type PaneTab = Exclude<Tab, 'missions'>;
// 아이콘은 Lucide 선 아이콘 하나 — 켜진 탭은 선을 조금 굵게(2.3), 꺼진 탭은 가늘게(1.8)
const TABS: { key: PaneTab; label: string; icon: IconName }[] = [
  { key: 'today', label: '오늘', icon: 'house' },
  { key: 'schedule', label: '일정', icon: 'calendar' },
  { key: 'together', label: '함께', icon: 'message-circle' },
  { key: 'stamps', label: '도장북', icon: 'stamp' },
  { key: 'car', label: '우리 차', icon: 'car-front' },
];
// 데모 차(개발자 시험)에서만 보이는 탭
const DEV_TAB = { key: 'dev' as PaneTab, label: '개발', icon: 'flask-conical' as IconName };

function Shell() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { me } = useSession();
  const { todayPing } = useEvents();
  // 시간 표시를 바꾸면 탭 화면 전체를 다시 그린다 (시각 글은 그릴 때마다 timefmt에서)
  useTimeFmt();
  // 시연용 깔끔 보기가 켜져 있으면 '개발' 탭도 숨긴다 (끄기: '우리 차' 탭 길게 누르기)
  const clean = useDemoClean();
  const tabs = me?.demo && !clean ? [...TABS, DEV_TAB] : TABS;
  const [tab, setTab] = useState<PaneTab>('today');
  const [seen, setSeen] = useState<Set<PaneTab>>(new Set(['today']));
  const [stampsSec, setStampsSec] = useState<StampsSection>('stamps');
  const go = (k: Tab) => {
    const to: PaneTab = k === 'missions' ? 'stamps' : k;
    if (k === 'missions') setStampsSec('missions');
    else if (k === 'stamps') setStampsSec('stamps');
    setTab(to); setSeen((s) => new Set(s).add(to));
  };
  // 오늘 코스 알림(다른 폰·차가 골랐어요)을 누르면 오늘 탭으로
  useEffect(() => { if (todayPing) setTab('today'); }, [todayPing]);
  // 함께: 올린 뒤 '함께에서 보기' · 반응 알림을 누르면 함께 탭으로
  const { goTab } = useTogetherStore();
  const { togetherPing } = useEvents();
  useEffect(() => { if (goTab || togetherPing) go('together'); }, [goTab, togetherPing]);
  useEffect(() => {
    // 뒤로 가기: 다른 탭이면 오늘로, 오늘이면 앱 닫기
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (tab !== 'today') { setTab('today'); return true; } return false; });
    return () => sub.remove();
  }, [tab]);
  const pane = (k: PaneTab, el: React.ReactNode) => seen.has(k) && (
    // 탭을 옮겨도 화면을 지우지 않는다
    <View key={k} style={[StyleSheet.absoluteFill, { display: tab === k ? 'flex' : 'none' }]}>{el}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ flex: 1 }}>
        {pane('today', <TodayTab go={go} />)}
        {pane('schedule', <ScheduleTab go={go} />)}
        {pane('together', <TogetherTab />)}
        {pane('stamps', <StampsTab section={stampsSec} onSection={setStampsSec} />)}
        {pane('car', <CarTab />)}
        {me?.demo && !clean && pane('dev', <DevTab go={go} />)}
      </View>
      {/* 탭 바는 화면 끝까지, 칸은 넓은 화면에서도 본문 폭(MAX_W) 안에 가운데로 */}
      <View style={{ backgroundColor: t.bg, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 8, paddingBottom: Math.max(ins.bottom, 10) }}>
       <View style={{ flexDirection: 'row', width: '100%', maxWidth: MAX_W, alignSelf: 'center' }}>
        {tabs.map((x) => {
          const on = tab === x.key;
          return (
            <Pressable key={x.key} style={{ flex: 1, alignItems: 'center', gap: 2, minHeight: 48 }} onPress={() => { tick(); go(x.key); }}
              accessibilityRole="tab" accessibilityLabel={x.label} accessibilityState={{ selected: on }}
              onLongPress={me?.demo && clean && x.key === 'car' ? () => { tick(); setDemoClean(false); go('dev'); } : undefined}>
              <Icon name={x.icon} size={23} color={on ? t.ink : t.ink3} strokeWidth={on ? 2.3 : 1.8} />
              {/* 굵기가 바뀔 때 안드로이드가 옛 글자 폭으로 재서 '우리 차'가 '우리'로 잘리던 것 → 켜짐/꺼짐마다 새로 그림 */}
              <T key={on ? 'on' : 'off'} v="cap" c={on ? 'ink' : 'ink3'} numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 16, fontFamily: on ? F.xb : F.b }}>{x.label}</T>
              {/* 켜진 탭 점: 마일스탬프 노랑 (로고 점과 같은 색) */}
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: on ? t.point : 'transparent' }} />
            </Pressable>
          );
        })}
       </View>
      </View>
      <OpenedSheets go={go} />
      <TogetherHosts />
    </View>
  );
}
