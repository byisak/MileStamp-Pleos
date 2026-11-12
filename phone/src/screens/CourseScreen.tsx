// 코스 진행 화면 — 오늘 탭 '코스 진행 보기'로 여는 겹 화면(전체 화면). 앱에 화면 이동 틀이 없어서 Modal로 띄우고
// 안드로이드 뒤로 가기(onRequestClose = BackHandler)·위 '뒤로' 버튼으로 닫는다.
// transparent로 띄운다: 안드로이드에서 불투명 Modal은 떠 있는 동안 밝게/어둡게 바뀜을 못 받아 화면이 옛 색으로 남았다(10/28 확인). 상태는 CourseSection이 들고 있어 닫았다 열어도 그대로.
// 담는 것: 코스 이름 · 도착 예정 · (제안이 있으면) 안끼리 비교 · 하루 막대 · 곳마다 시각과 머무름 · 건너뛴 곳과 까닭 · 도착지 줄 · 작은 버튼 전부.
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { endName, homeLine, LiveStop, ro } from '../course';
import { clock, clockRange, clockSpeech, clockText, useTimeFmt } from '../timefmt';
import { place } from '../places';
import { usePlan } from '../planStore';
import { useDevUi } from '../devclean';
import { H, R, S } from '../theme';
import { Icon, IconBtn, Pill, T, useTheme, wide } from '../ui';
import { ActionButton, ActionRow, DayBarBlock, ExplainCard, StopTimeline, TimelineStop } from '../parts';
import { W } from '../words';
import { CourseTitle } from './PlanBits';
import { endNote } from './TodayEndSheet';
import { barRange, CourseCtl, DwellChip, ProposalCards, Toast } from './courseBits';

export function CourseScreen({ open, onClose, ctl }: { open: boolean; onClose: () => void; ctl: CourseCtl }) {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  // 상태 막대 글자색: 안드로이드 Modal 창은 '열릴 때' 앱 창의 상태 막대 색(밝은/어두운 아이콘)을 한 번만 베낀다.
  // 떠 있는 동안 밝게↔어둡게가 바뀌면 옛 색으로 남아(어두운 바탕에 검은 아이콘) → 앱 창 쪽 StatusBar가 바뀐 뒤(한 박자 뒤)
  // Modal 창을 다시 만들어 새 색을 베끼게 한다. 다시 만들 때는 미끄러짐 없이.
  const [mode, setMode] = useState(t.dark);
  const remade = useRef(false);
  useEffect(() => {
    if (mode === t.dark) return;
    const id = setTimeout(() => { remade.current = true; setMode(t.dark); }, 120);
    return () => clearTimeout(id);
  }, [t.dark, mode]);
  useEffect(() => { if (!open) remade.current = false; }, [open]);
  return (
    <Modal key={mode ? 'dark' : 'light'} visible={open} transparent animationType={remade.current ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
        {/* 머리줄: 뒤로 · 코스 진행 · 코스 편집 */}
        <View style={[{ flexDirection: 'row', alignItems: 'center', gap: S.xs, minHeight: 56, paddingHorizontal: S.s }, wide]}>
          <IconBtn icon="chevron-left" label="뒤로" onPress={onClose} size={26} />
          <T v="title" accessibilityRole="header" style={{ flex: 1, fontSize: 20, lineHeight: 27 }}>{W.courseScreen}</T>
          {ctl.canEdit && <ActionButton label="코스 편집" icon="pencil" tone="plain" size="sm" disabled={ctl.busy} onPress={() => ctl.openSheet('edit')} style={{ marginRight: S.m }} />}
        </View>
        {open && <Body ctl={ctl} bottom={ins.bottom} />}
      </View>
    </Modal>
  );
}

function Body({ ctl, bottom }: { ctl: CourseCtl; bottom: number }) {
  const t = useTheme();
  const p = usePlan();
  const devUi = useDevUi();
  const tf = useTimeFmt();
  const { c, ex, nowMin, proposal, dest, busy } = ctl;
  const { from, to, marks } = useMemo(() => barRange(c, nowMin), [c, nowMin, tf]); // eslint-disable-line react-hooks/exhaustive-deps
  const home = homeLine(c);
  const shown = c.stops.filter((s) => s.status !== 'SKIPPED');
  const note = endNote(c);

  const stops: TimelineStop[] = c.stops.map((s, i) => stopItem(s, i, ctl));
  stops.push({
    key: 'end', name: endName(c), state: 'end', icon: endName(c) === '집' ? 'house' : 'map-pin', over: home.over,
    time: `${clock(c.arriveHomeMin)} 도착 예정${home.over ? ` · ${home.text.replace(/^.* · /, '')}` : c.slackMin >= 0 ? ` · 여유 ${c.slackMin}분` : ''}`,
    onPress: () => ctl.openSheet('end'),
    children: (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.xxs }}>
        <Icon name="pencil" size={12} color={t.ink3} />
        <T v="cap" c="ink3">{note ? `${note} · 눌러서 도착 바꾸기` : '눌러서 도착 바꾸기'}</T>
      </View>
    ),
  });

  return (
    <ScrollView contentContainerStyle={[{ paddingHorizontal: S.page, paddingBottom: bottom + S.sec * 2 }, wide]}>
      {/* 코스 이름 + 도착 예정 한 줄 (집 시각은 여기와 아래 도착지 줄에만) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, marginTop: S.xs }}>
        {devUi && p.courseMock && <Pill text="모의" tone="blue" icon="flask-conical" />}
        {devUi && p.test && !p.courseMock && <Pill text="시험 장면" tone="blue" icon="flask-conical" />}
      </View>
      <CourseTitle names={shown.length ? shown.map((s) => p.placeName(s.placeId)) : [`바로 ${ro(dest)}`]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.xxs }}>
        {home.over && <Icon name="triangle-alert" size={14} color={t.red} />}
        <T v="cap" c={home.over ? 'redText' : 'ink2'} style={{ fontVariant: ['tabular-nums'] }}>{home.text}</T>
      </View>
      {!!ctl.toast && <Toast toast={ctl.toast} onDone={ctl.clearToast} />}

      {/* 제안: 안끼리 비교 (막대 같은 눈금) — 오늘 탭 제안 띠를 누르면 여기로 */}
      {proposal && (
        <>
          <ExplainCard headline={clockText(ex.headline)} body={ex.body ? clockText(ex.body) : undefined} warn={ex.warn} tag="1번 제안대로 바꾸면"
            speech={clockSpeech(ex.speech ?? `${ex.headline}. ${ex.body}`)} style={{ marginTop: S.xl }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m, marginTop: S.xl, paddingHorizontal: S.xs }}>
            <Icon name="arrow-left-right" size={16} color={t.accent} strokeWidth={2.3} />
            <T v="h" style={{ flex: 1 }}>{proposal.length > 1 ? `이렇게 바꿀 수 있어요 · ${proposal.length}가지` : '이렇게 바꿀 수 있어요'}</T>
          </View>
          <ProposalCards options={proposal} dest={dest} nowHome={c.arriveHomeMin} from={from} to={to} marks={marks} busy={busy} onAdopt={ctl.adopt} onDismiss={ctl.dismiss} />
        </>
      )}

      {/* 하루 막대 */}
      <View style={{ marginTop: proposal ? S.l : S.xl, backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.xl, paddingTop: S.l + 2, paddingBottom: S.l }}>
        <DayBarBlock title={proposal ? '지금 코스' : '오늘 하루'} legs={c.legs} from={from} to={to} marks={marks} legend />
      </View>

      {/* 곳마다 시각 · 머무름 · 건너뛴 곳과 까닭 · 도착지 */}
      <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.xl, paddingTop: S.l + 2, paddingBottom: S.l }}>
        <StopTimeline stops={stops} />
      </View>

      {/* 작은 버튼 전부 (오늘 탭에서는 ··· 안에 있는 것들) */}
      <ActionRow style={{ marginTop: S.l }} items={[
        { label: '다음 바꾸기', icon: 'arrow-left-right', disabled: busy || !ctl.rem.length || !ctl.candidates.length, onPress: () => ctl.openSheet('replace') },
        { label: '빼기', icon: 'circle-minus', disabled: busy || !ctl.rem.length, onPress: () => ctl.openSheet('skip') },
        { label: '들르기', icon: 'circle-plus', disabled: busy || !ctl.candidates.length, onPress: () => ctl.openSheet('insert') },
        ...(ctl.stage.kind === 'homeward' ? [] : [{ label: `지금 ${ro(dest)}`, icon: 'house' as const, disabled: busy, onPress: () => ctl.goHome(ctl.big === 'end') }]),
        { label: '도착 바꾸기', icon: 'clock', disabled: busy, onPress: () => ctl.openSheet('end') },
      ]} />
      {busy && <T v="cap" c="ink3" style={{ marginTop: S.m }}>차·서버에 보내는 중…</T>}
      <View style={{ height: H.touch }} />
    </ScrollView>
  );
}

/** 장소 하나 → 타임라인 줄. 시각은 한 줄만: 다녀옴 = 실제, 머무는 중 = 나설 시각, 갈 곳 = 도착 예정, 건너뛴 곳 = 까닭 */
function stopItem(s: LiveStop, i: number, ctl: CourseCtl): TimelineStop {
  const base = { key: `${s.placeId}-${i}`, name: ctl.placeName(s.placeId), icon: place(s.placeId)?.icon };
  switch (s.status) {
    case 'DONE':
      return { ...base, state: 'done', time: clockRange(s.actualArriveMin ?? s.plannedArriveMin, s.actualDepartMin ?? s.plannedDepartMin) };
    case 'SKIPPED':
      // 문 닫음 = 엔진이 저절로(건너뜀), 그 밖 = 사람이 뺐거나 '지금 집으로'로 남은 곳을 건너뜀(뺌)
      return s.skipReason === '문 닫음' ? { ...base, state: 'skipped', time: '문 닫을 시간이라 건너뛰었어요' } : { ...base, state: 'removed' };
    case 'ARRIVED':
      return {
        ...base, state: 'here', time: `${clock(s.actualArriveMin ?? s.plannedArriveMin)} 도착 · ${clock(s.plannedDepartMin)}에 나서요`,
        children: (
          <>
            <DwellChip s={s} busy={ctl.busy} onPress={() => ctl.editDwell(s)} />
            {/* 지금 머무는 곳: 30분 더 · 1시간 더 · 지금 나갈게요 (엔진 ExtendStay) */}
            <ActionRow size="sm" style={{ marginTop: S.s }} items={[
              { label: W.stayMore, tone: 'accent', disabled: ctl.busy, onPress: () => ctl.act({ type: 'ExtendStay', minutes: 30 }) },
              { label: '1시간 더', tone: 'accent', disabled: ctl.busy, onPress: () => ctl.act({ type: 'ExtendStay', minutes: 60 }) },
              { label: W.leaveNow, icon: 'car-front', tone: 'accent', disabled: ctl.busy, onPress: () => ctl.act({ type: 'ExtendStay', minutes: 0 }) },
            ]} />
          </>
        ),
      };
    default:
      return {
        ...base, state: s.status === 'NEXT' ? 'next' : 'todo', time: `${clock(s.plannedArriveMin)} 도착 예정`,
        children: <DwellChip s={s} busy={ctl.busy} onPress={() => ctl.editDwell(s)} />,
      };
  }
}
