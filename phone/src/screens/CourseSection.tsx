// 코스 카드 (오늘 탭) — 고른 코스가 '살아 있는 코스'로 돌아가는 동안 추천 카드 대신 보여 준다.
// '반쯤 나누기'(docs/디자인-개편-계획.md 4절): 오늘 탭에는 주인공(다음 목적지 2줄) + 그 순간 할 일 하나만,
// 하루 막대·곳마다 시각·머무름·건너뛴 곳·제안 비교는 '코스 진행' 화면(CourseScreen, 연한 '코스 진행 보기' 버튼)으로.
//   큰 버튼(하나): 제안 = 이걸로 바꾸기 · 늦어짐 = 지금 집으로 · 시각 (확인) · 머무는 중 = 30분 더 (+ 지금 나갈게요)
//   한 줄: 들르기 · 코스 편집 · ··· (다음 바꾸기 · 빼기 · 지금 집으로 · 도착 바꾸기 · 다른 코스 보기 · 우리 가족 설정)
// 상태 판단은 courseStage.ts. 계산은 전부 서버 — 폰은 보여 주고 사건을 보내기만.
// 상태·시트는 여기 하나에 두고 코스 진행 화면에 그대로 넘긴다(화면을 닫았다 열어도, 접었다 펴도 그대로).
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Alert } from '../alert';
import { CourseEventIn, CourseResult, durText, endName, Explanation, homeLine, LiveStop, localExplain, remaining, ro } from '../course';
import { toMin } from '../plan';
import { clock, clockSpeech, clockText } from '../timefmt';
import { place } from '../places';
import { usePlan } from '../planStore';
import { useDevUi } from '../devclean';
import { H, R, S } from '../theme';
import { done, Icon, Pill, plainError, T, tick, useTheme } from '../ui';
import { ActionButton, ExplainCard, MoreItem, MoreSheet, NextHero, PrimaryCTA, ProposalBanner } from '../parts';
import { W } from '../words';
import { FamilySheet } from './FamilySheet';
import { DwellSheet } from './DwellSheet';
import { CourseEditSheet, courseEditInput } from './CourseEditSheet';
import { TodayEndSheet } from './TodayEndSheet';
import { CourseScreen } from './CourseScreen';
import { aboutMin, bigActionOf, stageOf } from './courseStage';
import { StayAsk } from './Ask';
import { companionNow, setAskMemory, useAskMemory } from '../ask';
import { CONFLICT_TEXT, CourseCtl, CourseSheet, diffText, dropHomeSentence, PickSheet, Toast } from './courseBits';

/** dayDone = 집 도착 요약이 왔음(상태 D) → 카드 대신 '오늘 코스 끝' 한 줄 */
export function CourseSection({ onOtherCourses, dayDone }: { onOtherCourses: () => void; dayDone?: boolean }) {
  const p = usePlan();
  const c = p.course!;
  const o = p.lastOutcome;
  const [sheet, setSheet] = useState<CourseSheet>(null);
  const [toast, setToast] = useState('');
  const [dwellOf, setDwellOf] = useState<LiveStop | null>(null);
  const [screenOpen, setScreenOpen] = useState(false);
  const nowMin = toMin(p.courseNow()) ?? c.nowMin;
  const ex: Explanation = c.explain ?? localExplain(c, o);
  const stage = useMemo(() => stageOf(c), [c]);
  const big = bigActionOf(stage, ex, o);
  const dest = endName(c);
  const rem = remaining(c);
  const proposal = o?.kind === 'Proposal' && o.options?.length ? o.options : null;

  /** 사건 결과 뒤처리: 충돌이면 안내, 조용한 변화면 작은 토스트 (제안은 띠·카드가 뜬다) */
  const after = (r: CourseResult | null) => {
    if (!r) return;
    if (!r.ok) { setToast(CONFLICT_TEXT); return; }
    const k = r.outcome.kind;
    if (k === 'Retimed' || k === 'NoChange') { const txt = r.outcome.change?.text; if (txt) setToast(txt); }
    else done();
  };
  const act = async (e: CourseEventIn) => {
    try { after(await p.courseAct(e)); }
    catch (err: any) { Alert.alert('보내지 못했어요', plainError(err, '잠시 뒤 다시 눌러 주세요')); }
  };
  // 집으로·오늘 코스 마치기는 되돌릴 수 없으니 어디서 누르든 같은 확인 한 번
  const goHome = (end = false) => Alert.alert(
    end ? '오늘 코스를 마칠까요?' : `지금 ${ro(dest)} 갈까요?`,
    end ? '남은 곳은 다음에 가요. 차 화면의 오늘 코스도 같이 끝나요.'
      : `${ex.action === 'GO_HOME' && ex.homeMin != null ? `지금 출발하면 ${dest}에 ${clock(ex.homeMin)}쯤 도착해요. ` : ''}남은 곳은 건너뛰고, 차가 ${ro(dest)} 안내해요.`,
    [
      { text: '취소', style: 'cancel' },
      { text: end ? '마치기' : ro(dest), onPress: () => act({ type: 'GoHome' }) },
    ]);
  const dismiss = async () => {
    tick();
    const r = await p.dismissProposal();
    if (r === 'conflict') setToast(CONFLICT_TEXT);
  };
  const adopt = async (idx: number) => {
    try { after(await p.adopt(idx)); }
    catch (err: any) {
      if (err?.status === 404) { p.dismissProposal(); p.loadCourse(); Alert.alert('이 제안은 지났어요', '그새 코스가 바뀌었어요. 최신 코스로 보여 드려요.'); }
      else Alert.alert('바꾸지 못했어요', plainError(err, '잠시 뒤 다시 눌러 주세요'));
    }
  };

  // 코스 취소: 아직 출발 전(다녀온 곳·출발 기록 없음)이면 고르기 취소(되돌리기와 같은 API) → 오늘 탭은 대화형 고르기로.
  // 출발한 뒤면 남은 곳을 건너뛰고 오늘 코스를 끝낸다('오늘 코스 마치기'와 같은 GoHome). 둘 다 차는 다음 조회 때 따라간다.
  const departed = c.stops.some((s) => s.status === 'ARRIVED' || s.status === 'DONE' || s.actualDepartMin != null || s.actualArriveMin != null)
    || c.lastChange?.cause === '출발';
  const cancelCourse = () => departed
    ? Alert.alert('남은 곳을 건너뛰고 오늘 코스를 끝낼까요?', '차 화면의 오늘 코스도 같이 끝나요.', [
      { text: '아니요', style: 'cancel' },
      { text: '코스 끝내기', style: 'destructive', onPress: () => act({ type: 'GoHome' }) },
    ])
    : Alert.alert('차에 보낸 코스를 취소할까요?', '차 화면의 코스도 지워지고, 오늘 갈 곳을 다시 고를 수 있어요.', [
      { text: '아니요', style: 'cancel' },
      { text: '취소하기', style: 'destructive', onPress: async () => {
        try { await p.cancelCourse(); setAskMemory({ detailed: false }); done(); }
        catch (err: any) { Alert.alert('취소하지 못했어요', plainError(err, '잠시 뒤 다시 눌러 주세요')); }
      } },
    ]);

  // 다음 바꾸기·들르기 후보: 아는 장소 중 코스에 아직 없는 곳 (뺀 곳은 다시 넣을 수 있다)
  const inCourse = new Set(c.stops.filter((s) => s.status !== 'SKIPPED').map((s) => s.placeId));
  const candidates = p.knownPlaces.filter((x) => !inCourse.has(x.id));

  const ctl: CourseCtl = {
    c, o, ex, nowMin, stage, big, dest, rem, candidates, busy: p.courseBusy, proposal,
    toast, clearToast: () => setToast(''), act, goHome, adopt, dismiss,
    openSheet: setSheet, editDwell: setDwellOf, canEdit: !!p.data && !p.courseMock, placeName: p.placeName,
  };

  // ··· 시트: 자주 쓰는 순. 집으로 가는 길(남은 곳 0 · 머무는 곳 없음)에는 다음 바꾸기·빼기·지금 집으로가 뜻이 없어 뺀다
  const homeward = stage.kind === 'homeward';
  const kids = companionNow(useAskMemory().companion ?? p.family?.companion) === 'kids';
  const nextName = rem[0] ? p.placeName(rem[0].placeId) : null;
  const stopName = stage.kind === 'homeward' ? dest : p.placeName(stage.stop.placeId);
  const where = stage.kind === 'stay' ? `${stopName}에 있어요` : stage.kind === 'going' ? `${ro(stopName)} 가는 중이에요`
    : stage.kind === 'first' ? `첫 목적지 · ${stopName}` : `${ro(dest)} 가는 길이에요`;
  const more: MoreItem[][] = [
    [
      ...(homeward ? [] : [
        { icon: 'arrow-left-right' as const, title: '다음 바꾸기', sub: nextName ? `${nextName} 대신 다른 곳부터 가요` : '바꿀 다음 곳이 없어요', disabled: !rem.length || !candidates.length, onPress: () => setSheet('replace') },
        { icon: 'circle-minus' as const, title: '빼기', sub: '남은 곳 중 하나를 빼요 · 시간이 남으면 한 곳 추천', disabled: !rem.length, onPress: () => setSheet('skip') },
        { icon: 'house' as const, title: `지금 ${ro(dest)}`, sub: `남은 곳은 건너뛰고 ${ro(dest)} · 한 번 더 물어요`, onPress: () => goHome(false) },
      ]),
      { icon: 'clock', title: '도착 바꾸기', sub: '오늘만 도착 시간 · 도착지 · 낮잠', onPress: () => setSheet('end') },
    ],
    [
      { icon: 'layout-list', title: '다른 코스 보기', sub: '아침에 추천한 코스를 다시 펼쳐요', onPress: onOtherCourses },
      { icon: 'settings', title: '함께 가는 사람 설정', sub: kids ? '낮잠 · 귀가 한계 · 집 위치' : '귀가 한계 · 집 위치', onPress: () => setSheet('family') },
    ],
    [
      { icon: 'circle-x', title: '이 코스 취소하기', danger: true, disabled: p.courseMock,
        sub: departed ? '남은 곳을 건너뛰고 오늘 코스를 끝내요 · 한 번 더 물어요' : '차에 보낸 코스를 지우고 다시 골라요 · 한 번 더 물어요', onPress: cancelCourse },
    ],
  ];

  return (
    <View style={{ marginTop: S.l }}>
      {/* 머무는 중: 대화형 질문 '조금 더 놀까요?' (큰 버튼 자리 대신) */}
      {!dayDone && big === 'stay' && <StayAsk ctl={ctl} />}
      {dayDone
        ? <CourseDoneRow dest={dest} onPress={() => setScreenOpen(true)} />
        : <TodayCourseCard ctl={ctl} onOpenScreen={() => { tick(); setScreenOpen(true); }} />}

      {/* 코스 진행 화면 (겹 화면 · 안드로이드 뒤로 가기로 닫힘) — 시트들은 이 뒤에 그려져 화면 위로 올라온다 */}
      <CourseScreen open={screenOpen} onClose={() => setScreenOpen(false)} ctl={ctl} />

      <MoreSheet open={sheet === 'more'} onClose={() => setSheet(null)} title="코스 바꾸기"
        sub={`${where} · 고르면 차에 바로 보내요`} groups={more} />
      <PickSheet open={sheet === 'replace'} onClose={() => setSheet(null)} title="다음은 어디로 갈까요?"
        sub={rem[0] ? `지금 다음은 ${p.placeName(rem[0].placeId)} · 고른 곳을 먼저 가고 ${p.placeName(rem[0].placeId)}은 그 뒤로` : '고른 곳으로 바로 가요'}
        items={candidates} onPick={(id) => { setSheet(null); act({ type: 'ReplaceNext', place: id }); }} />
      <PickSheet open={sheet === 'skip'} onClose={() => setSheet(null)} title="어디를 뺄까요?" sub="뺀 만큼 일찍 돌아오거나, 시간이 남으면 한 곳 더 추천해요"
        items={rem.map((s) => ({ id: s.placeId, name: p.placeName(s.placeId), note: `${clock(s.plannedArriveMin)} 도착 예정 · 머무름 ${durText(s.dwellGuessMin)}` }))}
        icon="circle-minus" onPick={(id) => { setSheet(null); act({ type: 'Skip', place: id }); }} />
      <PickSheet open={sheet === 'insert'} onClose={() => setSheet(null)} title="어디에 들를까요?" sub="남은 자리에 넣어 보고 늦지 않게 돌아오는 쪽으로"
        items={candidates} icon="circle-plus" onPick={(id) => { setSheet(null); act({ type: 'Insert', place: id }); }} />
      {/* 오늘만: 도착 시간·도착지·낮잠 (엔진 SetEnd) · 우리 가족 설정 */}
      <TodayEndSheet open={sheet === 'end'} onClose={() => setSheet(null)} onApply={async (e) => { after(await p.courseAct(e)); }} />
      <FamilySheet open={sheet === 'family'} onClose={() => setSheet(null)} />
      {/* 코스 편집: 순서·빼기·더하기·머무름 (아직 안 다녀왔으면 다시 고르기, 다녀온 곳이 있으면 남은 곳만) */}
      {sheet === 'edit' && !!p.data && (() => {
        const ed = courseEditInput(c, p.placeName);
        return (
          <CourseEditSheet open onClose={() => setSheet(null)} planId={p.data.planId} live={ed.visited} locked={ed.locked}
            initial={ed.initial} initialDwell={ed.initialDwell}
            onApply={async (stops, dwell) => { if (ed.visited) await p.liveEdit(stops, dwell); else await p.chooseStops(stops, dwell); }} />
        );
      })()}
      {/* 머무는 시간 (오늘만, 엔진 SetDwell) */}
      <DwellSheet open={!!dwellOf} onClose={() => setDwellOf(null)} name={dwellOf ? p.placeName(dwellOf.placeId) : ''}
        minutes={dwellOf?.dwellGuessMin ?? 60} source={dwellOf?.dwellSource} set={dwellOf?.dwellSet} arrived={dwellOf?.status === 'ARRIVED'}
        onApply={(m) => { const s = dwellOf!; setDwellOf(null); act({ type: 'SetDwell', place: s.placeId, minutes: m }); }} />
    </View>
  );
}

// ---------- 오늘 탭 코스 카드 ----------
function TodayCourseCard({ ctl, onOpenScreen }: { ctl: CourseCtl; onOpenScreen: () => void }) {
  const t = useTheme();
  const p = usePlan();
  const devUi = useDevUi();
  const { c, ex, stage, big, dest, nowMin, proposal } = ctl;
  const home = homeLine(c);
  const shown = c.stops.filter((s) => s.status !== 'SKIPPED');
  const visited = shown.filter((s) => s.status === 'DONE').length;
  const skipped = c.stops.length - shown.length;

  // 주인공 두 줄: 어디 · 몇 시 / 집 몇 시 · 여유
  const hero = (() => {
    if (stage.kind === 'homeward') {
      return {
        kicker: `${ro(dest)} 가는 길`, name: dest, icon: dest === '집' ? 'house' as const : 'map-pin' as const,
        arrive: `${clock(c.arriveHomeMin)} 도착 예정`,
        sub: home.over ? home.text.replace(/^.* · /, '') : skipped ? `${skipped}곳은 건너뛰었어요 · 코스 진행 보기에서 이유를 볼 수 있어요` : undefined,
      };
    }
    const s = stage.stop;
    const name = p.placeName(s.placeId);
    const icon = place(s.placeId)?.icon ?? 'navigation';
    if (stage.kind === 'stay') {
      const left = aboutMin(s.plannedDepartMin, nowMin);
      return { kicker: W.here, name, icon, arrive: left ? `${clock(s.plannedDepartMin)}에 나서요 · ${left} 남음` : `${clock(s.plannedDepartMin)}에 나서기로 했어요`, sub: home.text };
    }
    // 가는 중인지는 폰이 모른다 → 다녀온 곳이 있을 때만 '약 N분'(엔진 도착 예정 − 지금)
    const left = stage.kind === 'going' ? aboutMin(s.plannedArriveMin, nowMin) : null;
    return { kicker: stage.kind === 'first' ? '첫 목적지' : '다음 목적지', name, icon, arrive: `${clock(s.plannedArriveMin)} 도착 예정${left ? ` · ${left}` : ''}`, sub: home.text };
  })();

  const body = proposal ? ex.body : dropHomeSentence(ex.body, dest, c.arriveHomeMin);
  const first = proposal?.[0];

  return (
    <View style={{ backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.xl, paddingTop: S.l + 2, paddingBottom: S.xl }}>
      {/* 머리: 오늘 코스 · 다녀온 수 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, minHeight: 24 }}>
        <Icon name="map" size={16} color={t.accent} strokeWidth={2.2} />
        <T v="label" c="accent" style={{ flex: 1 }}>오늘 코스</T>
        {devUi && p.courseMock && <Pill text="모의" tone="blue" icon="flask-conical" />}
        {devUi && p.test && !p.courseMock && <Pill text="시험 장면" tone="blue" icon="flask-conical" />}
        {shown.length > 0 && <T v="cap" c="ink3" style={{ fontVariant: ['tabular-nums'] }}>{`${shown.length}곳 중 ${visited}곳 ${W.done}`}</T>}
      </View>

      {/* 제안 띠 (주인공 바로 위) — 누르면 코스 진행 화면에서 안끼리 비교 */}
      {first && (
        <ProposalBanner text="바꾸자는 제안이 있어요" warn={ex.warn}
          sub={`바꾸면 ${dest} ${clock(first.arriveHomeMin)} 도착 · ${diffText(first.arriveHomeMin - c.arriveHomeMin)}${proposal!.length > 1 ? ` · 다른 안 ${proposal!.length - 1}개` : ''}`}
          onPress={onOpenScreen} style={{ marginTop: S.l }} />
      )}

      <NextHero kicker={hero.kicker} name={hero.name} icon={hero.icon} arrive={hero.arrive} sub={hero.sub} warn={home.over} style={{ marginTop: S.l + 2 }} />

      {!!ctl.toast && <Toast toast={ctl.toast} onDone={ctl.clearToast} />}

      {/* 쉬운 설명 + 말로 듣기 */}
      <ExplainCard headline={clockText(ex.headline)} body={body ? clockText(body) : undefined} warn={ex.warn}
        tag={proposal ? '1번 제안대로 바꾸면' : undefined} speech={clockSpeech(ex.speech ?? `${ex.headline}. ${ex.body}`)} style={{ marginTop: S.l + 2 }} />

      {/* 그 순간 할 일 하나 (머무는 중이면 위 질문이 대신) */}
      {big !== 'stay' && <BigAction ctl={ctl} />}

      {/* 코스 진행 보기 — 정보 보기라 연한 버튼 (큰 버튼 자리는 실제로 바뀌는 일에) */}
      <ActionButton label={W.courseView} icon="route" tone="accent" size="row" onPress={onOpenScreen} style={{ marginTop: big && big !== 'stay' ? S.m : S.l + 2 }} />

      {/* 한 줄: 들르기 · 코스 편집 · ··· */}
      <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.s }}>
        <ActionButton label="들르기" icon="circle-plus" size="row" disabled={ctl.busy || !ctl.candidates.length} onPress={() => ctl.openSheet('insert')} style={{ flex: 1 }} />
        {ctl.canEdit && <ActionButton label="코스 편집" icon="pencil" size="row" disabled={ctl.busy} onPress={() => ctl.openSheet('edit')} style={{ flex: 1 }} />}
        <ActionButton label="더 보기" icon="ellipsis" iconOnly size="row" onPress={() => ctl.openSheet('more')} style={{ width: H.cta }} />
      </View>
      {ctl.busy && <T v="cap" c="ink3" style={{ marginTop: S.m }}>차·서버에 보내는 중…</T>}
    </View>
  );
}

/** 상태별 큰 버튼 (없으면 아무것도) */
export function BigAction({ ctl }: { ctl: CourseCtl }) {
  const { big, ex, dest, busy } = ctl;
  if (!big) return null;
  if (big === 'adopt') {
    return (
      <View style={{ marginTop: S.l + 2 }}>
        <PrimaryCTA title={W.adopt} icon="check" busy={busy} onPress={() => ctl.adopt(0)} />
        <ActionButton label={W.keep} tone="ghost" disabled={busy} onPress={ctl.dismiss} style={{ marginTop: S.xs }} />
      </View>
    );
  }
  if (big === 'goHome' || big === 'end') {
    const title = big === 'end' ? '오늘 코스 마치기' : `지금 ${ro(dest)}${ex.homeMin != null ? ` · ${clock(ex.homeMin)} 도착` : ''}`;
    return <PrimaryCTA title={title} icon="house" busy={busy} onPress={() => ctl.goHome(big === 'end')} style={{ marginTop: S.l + 2 }} />;
  }
  // 머무는 중: 30분 더 (엔진 ExtendStay) + 지금 나갈게요 (0분 = 지금 나섬)
  return (
    <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.l + 2 }}>
      <PrimaryCTA title={W.stayMore} icon="hourglass" disabled={busy} onPress={() => ctl.act({ type: 'ExtendStay', minutes: 30 })} style={{ flex: 1, alignSelf: 'auto' }} />
      <ActionButton label={W.leaveNow} icon="car-front" size="lg" disabled={busy} onPress={() => ctl.act({ type: 'ExtendStay', minutes: 0 })} style={{ flex: 1 }} />
    </View>
  );
}

/** 오늘 코스가 끝났을 때(집 도착 요약이 옴) 카드 대신 한 줄 — 누르면 코스 진행 화면(오늘 다녀온 곳) */
function CourseDoneRow({ onPress, dest }: { onPress: () => void; dest: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: R.lg, paddingLeft: S.xl, paddingRight: S.l, paddingVertical: S.l, flexDirection: 'row', alignItems: 'center', gap: S.l }}>
      <Icon name="circle-check" size={20} color={t.accent} />
      <View style={{ flex: 1 }}>
        <T v="h">오늘 코스 끝</T>
        <T v="cap" c="ink3">{`${dest}에 왔어요 · 내일 추천은 아침에 와요`}</T>
      </View>
      <ActionButton label="코스 보기" tone="plain" onPress={onPress} />
    </View>
  );
}
