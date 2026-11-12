// 오늘 (홈): 풍경 머리(인사) → 숫자 카드 3칸 → 이어 듣기 · 축제 띠 → 오늘 코스(상태 A~D) → 자랑 카드(D) → 오늘의 기록
// 시안 proto/home-redesign.html · 계획 docs/디자인-개편-계획.md 4절
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import type { Tab } from '../../App';
import { getMissions, TripEvent } from '../api';
import { describe } from '../describe';
import { useEvents } from '../events';
import { place } from '../places';
import { toMin } from '../plan';
import { usePlan } from '../planStore';
import { useSession } from '../session';
import { useSkyNow } from '../skyNow';
import { PlanSection } from './PlanSection';
import { ExploreSection, ExploreTabs, type ExploreTab } from './Explore';
import { FestivalBanner, FestivalSheet, useNearFestivals } from './Festival';
import { isDone } from './Missions';
import { refreshCatalog, type CatalogFestival } from '../catalog';
import { hm, Icon, SkeletonList, T, tap, tick, useTheme, weekday, wide } from '../ui';
import { loadAskMemory, setAskMemory, useAskMemory } from '../ask';
import { Ask } from './Ask';
import { EveningToday, isEveningPlan } from './Evening';
import { ScheduledCourseCard } from './ScheduledCourse';
import { ActionButton, Empty, ErrorRow, Header, PrimaryCTA, Row, StatStrip } from '../parts';
import { R, S } from '../theme';
import { W } from '../words';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? '늦은 밤이에요' : h < 11 ? '좋은 아침이에요' : h < 17 ? '좋은 오후예요' : '좋은 저녁이에요';
}

/** 오늘의 기록은 처음 몇 줄만, '전체 보기'로 모두 */
const RECORD_ROWS = 4;

export function TodayTab({ go }: { go: (tab: Tab) => void }) {
  const t = useTheme();
  const { me, token } = useSession();
  const ev = useEvents();
  const plan = usePlan();
  const list = ev.events;
  const stamps = useMemo(() => (list ?? []).filter((e) => e.kind === 'stamp'), [list]);
  const summary = (list ?? []).find((e) => e.kind === 'summary');
  // 30분 안의 이어 듣기·조용한 소개 → 위쪽 큰 카드
  const listen = (list ?? []).find((e) => (e.kind === 'handoff' || e.kind === 'intro') && Date.now() - new Date(e.created_at).getTime() < 30 * 60000);
  const nick = me?.me.nickname;
  const name = nick && nick !== '가족' ? nick : '우리 가족';
  // 가까운(차로 60분 안) 진행 중 축제 → 코스 위 얇은 띠, 누르면 축제 시트
  const nearFest = useNearFestivals();
  const [fest, setFest] = useState<CatalogFestival | null>(null);
  const [allRecords, setAllRecords] = useState(false);
  // 고르는 줄: 추천(지금 카드) · 축제 · 100선 · 직접 찾기 (한 곳을 고르면 그곳 중심 코스)
  const [pickTab, setPickTab] = useState<ExploreTab>('rec');
  const now = new Date();
  // 머리 날짜 줄 끝 '☁ 12°' (지금 위치 → 없으면 집, 10분에 한 번)
  const skyNow = useSkyNow(token);

  // 완료 미션: 오늘 소식에 온 미션 중 미션 탭과 같은 기준(isDone)으로 끝낸 것. 미션 시트를 닫을 때마다 다시 센다
  const missionIds = useMemo(() => (list ?? []).filter((e) => e.kind === 'mission').map((e) => e.id), [list]);
  const [missionsDone, setMissionsDone] = useState<number | null>(null);
  useEffect(() => {
    if (!token || !list) return;
    if (!missionIds.length) { setMissionsDone(0); return; }
    let alive = true;
    getMissions(token).then(({ missions }) => {
      if (alive) setMissionsDone(missions.filter((m) => missionIds.includes(m.id) && isDone(m)).length);
    }).catch(() => {});
    return () => { alive = false; };
  }, [token, !!list, missionIds.join(), ev.opened == null]); // eslint-disable-line react-hooks/exhaustive-deps

  // 다녀온 곳: 오늘 코스에서 다녀옴·머무는 중인 곳 + 오늘 도장을 찍은 곳 (겹치면 한 번)
  const visited = useMemo(() => {
    const ids = new Set<string>();
    for (const s of plan.course?.stops ?? []) if (s.status === 'DONE' || s.status === 'ARRIVED') ids.add(s.placeId);
    for (const e of stamps) if (e.place_id) ids.add(e.place_id);
    return ids.size;
  }, [plan.course, stamps]);

  const records = list ?? [];
  const shownRecords = allRecords ? records : records.slice(0, RECORD_ROWS);

  // 대화형 고르기: 고른 코스가 없으면 기본은 대화(Ask). 오른쪽 위 '자세히' = 지금 화면 (켠 것을 기억)
  const askMem = useAskMemory();
  useEffect(() => { loadAskMemory(); }, []);
  const picked = plan.data?.chosen != null || !!plan.course;
  const askMode = !askMem.detailed && !picked;
  // 다시 오늘 탭으로 오면 처음 질문부터 (대화를 다시 그릴 열쇠)
  const [askKey, setAskKey] = useState(0);
  // 저녁 계획이면 대화 대신 저녁 화면 먼저 (proto/evening-plan.html) — '대화로 고르기'·'내일 코스 미리 정하기'를 누르면 대화
  const [eveningAsk, setEveningAsk] = useState<null | 'ask' | 'when'>(null);
  const evening = isEveningPlan(plan.data) && !eveningAsk;

  if (askMode && evening) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[{ flexGrow: 1, paddingHorizontal: S.page, paddingBottom: S.xl }, wide]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => { ev.reload(); plan.reload(); refreshCatalog(30000); }} colors={[t.accent]} progressBackgroundColor={t.surface} />}>
        <ScheduledCourseCard onAll={() => go('schedule')} />
        <EveningToday data={plan.data!} onAsk={() => setEveningAsk('ask')} onTomorrow={() => setEveningAsk('when')} />
      </ScrollView>
    );
  }

  if (askMode) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[{ flexGrow: 1, paddingHorizontal: S.page, paddingBottom: S.xl }, wide]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => { ev.reload(); plan.reload(); refreshCatalog(30000); setAskKey((k) => k + 1); }} colors={[t.accent]} progressBackgroundColor={t.surface} />}>
        {/* 미리 정한 다른 날 코스 (오늘 코스가 없을 때) — 오늘 고르기 대화는 그 아래 그대로 */}
        <ScheduledCourseCard onAll={() => go('schedule')} />
        <Ask key={`${askKey}-${eveningAsk ?? ''}`} go={go} onDetail={() => setAskMemory({ detailed: true })} initial={eveningAsk === 'when' ? 'when' : undefined} />
      </ScrollView>
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[{ paddingHorizontal: S.page, paddingBottom: S.sec * 2 }, wide]}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => { ev.reload(); plan.reload(); refreshCatalog(30000); }} colors={[t.accent]} progressBackgroundColor={t.surface} />}>
      {/* 고른 코스가 없으면: 대화로 돌아가기 ('자세히'를 끔) */}
      {!picked && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: S.xs, marginBottom: -S.xs }}>
          <ActionButton label="쉽게 고르기" icon="smile" tone="accent" size="sm" onPress={() => { tick(); setAskMemory({ detailed: false }); }} />
        </View>
      )}
      {/* 풍경 머리: 시각(해 짐 기준)에 따라 낮·노을·밤, 다크 모드는 늘 밤 */}
      <Header greeting={greeting()} name={name} date={`${now.getMonth() + 1}월 ${now.getDate()}일 ${weekday(now)}요일 · 오늘의 나들이`}
        sunsetMin={toMin(plan.data?.sky?.sunset)} sunriseMin={toMin(plan.data?.sky?.sunrise)} height={200}
        weather={skyNow} clearSky={plan.data?.sky?.sky === 'CLEAR'} />

      {/* 숫자 카드: 오늘 도장 · 다녀온 곳 · 완료 미션 (km는 집에 온 뒤 자랑 카드에) */}
      <StatStrip style={{ marginTop: -S.xxl }} items={[
        { key: 'stamp', icon: 'stamp', value: list ? stamps.length : null, label: W.stampsToday, onPress: () => go('stamps') },
        { key: 'visited', icon: 'map-pin', value: list ? visited : null, label: W.visited },
        { key: 'mission', icon: 'flag', value: list ? missionsDone : null, label: W.missionsDone, onPress: () => go('missions') },
      ]} />

      {listen && (
        <Pressable onPress={() => { tap(); ev.open(listen); }} accessibilityRole="button" accessibilityLabel={`${place(listen.place_id)?.name ?? ''} ${W.resume}`}
          style={({ pressed }) => ({ marginTop: S.l, backgroundColor: t.ink, borderRadius: R.lg, padding: S.l + 6, flexDirection: 'row', alignItems: 'center', gap: S.l + 2, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="play" size={22} color={t.onAccent} style={{ marginLeft: 2 }} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="cap" c="onInk">{listen.kind === 'handoff' ? '차에서 듣던 이야기' : '조용히 가는 중이라 폰으로'}</T>
            <T v="h" c="onInk">{place(listen.place_id)?.name} {W.resume}</T>
          </View>
        </Pressable>
      )}

      {!plan.course && <ScheduledCourseCard onAll={() => go('schedule')} />}
      <FestivalBanner items={nearFest} onOpen={setFest} />
      <ExploreTabs tab={pickTab} onChange={setPickTab} />
      {pickTab === 'rec'
        ? <PlanSection dayDone={!!summary} />
        : <ExploreSection tab={pickTab} onChosen={() => setPickTab('rec')} />}

      {/* D 집 도착: 큰 버튼 = 오늘 하루 자랑 카드 (km는 여기에) */}
      {summary && (
        <PrimaryCTA title="오늘 하루 자랑 카드" icon="trophy" onPress={() => ev.open(summary)} style={{ marginTop: S.l }}
          sub={[`도장 ${summary.payload.stamps ?? 0}개`, summary.payload.rare ? `희귀 ${summary.payload.rare}` : null, summary.payload.km ? `${Math.round(summary.payload.km)}km` : null, '가족에게 보내 보세요'].filter(Boolean).join(' · ')} />
      )}

      {/* 오늘의 기록 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, marginTop: S.sec + 4, marginBottom: S.m, paddingHorizontal: S.xs, minHeight: 28 }}>
        <Icon name="stamp" size={17} color={t.ink} strokeWidth={2.1} />
        <T v="h" accessibilityRole="header" style={{ flex: 1 }}>{W.record}</T>
        {records.length > RECORD_ROWS && (
          <ActionButton label={allRecords ? '접기' : `전체 보기 ${records.length}`} tone="ghost" size="sm" onPress={() => setAllRecords((v) => !v)} />
        )}
      </View>
      {list === null && ev.failed
        ? <ErrorRow title="오늘 기록을 불러오지 못했어요" sub="인터넷을 확인하고 다시 불러와 주세요" onRetry={ev.reload} busy={ev.loading} />
        : list === null ? <SkeletonList rows={2} /> : list.length === 0
        ? <View style={{ backgroundColor: t.surface, borderRadius: R.lg }}><Empty compact icon="car-front" title="아직 오늘 기록이 없어요" sub="출발하면 도장·이야기·미션이 여기에 쌓여요" /></View>
        : (
          <View style={{ backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.l + 2 }}>
            {shownRecords.map((e, i) => (
              <View key={e.id} style={i ? { borderTopWidth: 1, borderTopColor: t.line } : undefined}>
                <EventRow e={e} onPress={() => ev.open(e)} />
              </View>
            ))}
          </View>
        )}
      <FestivalSheet festival={fest} onClose={() => setFest(null)} />
    </ScrollView>
  );
}

/** 기록 한 줄 = 공용 줄(Row): 동그란 아이콘 · 장소 이름 · '29번째 도장' / '미션 · …' · 시각 · > */
function EventRow({ e, onPress }: { e: TripEvent; onPress: () => void }) {
  const t = useTheme();
  const d = describe(e);
  return (
    <Row icon={d.icon} tone={e.kind === 'stamp' ? 'accent' : 'plain'} title={d.title} sub={d.sub || undefined} onPress={onPress}
      trailing={(
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
          <T v="cap" c="ink3" style={{ fontVariant: ['tabular-nums'] }}>{hm(new Date(e.created_at))}</T>
          <Icon name="chevron-right" size={18} color={t.ink3} />
        </View>
      )} />
  );
}
