// 미리 정한 다른 날 코스 (QA 0.9.7 #3) — '11/7(토) 코스 · 오전 8:30 출발 예정' + 곳 목록 + '코스 고치기' · '이 코스 취소하기'만.
// 오늘 쓰는 것(지금 집으로·도착 바꾸기·들르기)은 없다. 그날이 되면 서버가 오늘 코스로 주고 보통 코스 카드(CourseSection)로 바뀐다.
import { useState } from 'react';
import { View } from 'react-native';
import { Alert } from '../alert';
import { md } from '../catalog';
import { usePlan } from '../planStore';
import { useClosedStops } from '../placeDetail';
import { clock } from '../timefmt';
import { F, R, S } from '../theme';
import { done, Icon, plainError, T, useTheme } from '../ui';
import { ActionButton } from '../parts';
import { CourseEditSheet, courseEditInput } from './CourseEditSheet';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
/** '11/7(토)' */
export const dayText = (day: string) => `${md(day)}(${WD[new Date(`${day}T00:00:00`).getDay()]})`;

/** onAll = 일정 탭 열기 — 정해 둔 나들이가 2개 이상이면 '일정에서 모두 보기' */
export function ScheduledCourseCard({ onAll }: { onAll?: () => void } = {}) {
  const t = useTheme();
  const p = usePlan();
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = p.scheduled;
  const stops = (s?.course.stops ?? []).filter((x) => x.status !== 'SKIPPED');
  const nameOf = (x: { placeId: string; name?: string | null }) => x.name || p.placeName(x.placeId);
  const closed = useClosedStops(stops.map((x) => ({ id: x.placeId, name: nameOf(x) })), s?.day);
  const upcoming = p.schedule && p.schedule !== 'unsupported' ? p.schedule.upcoming.length : 0;
  if (!s) return null;
  const c = s.course;
  const depart = c.legs[0]?.fromMin ?? c.nowMin;
  const label = dayText(s.day);

  const cancel = () => Alert.alert(`${label} 코스를 취소할까요?`, '차에 보낸 코스가 지워지고, 그날 갈 곳을 다시 고를 수 있어요.', [
    { text: '아니요', style: 'cancel' },
    { text: '취소하기', style: 'destructive', onPress: async () => {
      setBusy(true);
      try { await p.cancelCourse(s.planId); done(); }
      catch (e) { Alert.alert('취소하지 못했어요', plainError(e, '잠시 뒤 다시 눌러 주세요')); }
      finally { setBusy(false); }
    } },
  ]);

  return (
    <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.xl, paddingTop: S.l + 2, paddingBottom: S.l + 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, minHeight: 24 }}>
        <Icon name="calendar" size={16} color={t.accent} strokeWidth={2.2} />
        <T v="label" c="accent" style={{ flex: 1 }}>{label} 코스</T>
      </View>
      <T v="h" style={{ marginTop: S.s }}>{`${clock(depart)} 출발 예정`}</T>
      <T v="cap" c="ink3" style={{ marginTop: S.xxs }}>그날 아침 시동을 걸면 차 화면에 이 코스가 떠 있어요</T>
      <View style={{ marginTop: S.m, gap: S.s }}>
        {stops.map((x, i) => (
          <View key={`${x.placeId}:${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: S.m }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <T v="cap" style={{ color: t.accentInk, fontFamily: F.b }}>{i + 1}</T>
            </View>
            <T v="sub" style={{ flex: 1 }} numberOfLines={1}>{nameOf(x)}</T>
            <T v="cap" c="ink3" style={{ fontVariant: ['tabular-nums'] }}>{`${clock(x.plannedArriveMin)} 도착`}</T>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m }}>
          <View style={{ width: 22, alignItems: 'center' }}><Icon name="house" size={15} color={t.ink3} /></View>
          <T v="sub" c="ink2" style={{ flex: 1 }}>집</T>
          <T v="cap" c="ink3" style={{ fontVariant: ['tabular-nums'] }}>{`${clock(c.arriveHomeMin)} 도착`}</T>
        </View>
      </View>
      {!!onAll && upcoming >= 2 && (
        <ActionButton label={`일정에서 모두 보기 · ${upcoming}개`} icon="calendar" tone="ghost" size="sm" onPress={onAll} style={{ alignSelf: 'flex-start', marginTop: S.m, marginLeft: -S.s }} />
      )}
      {closed.names.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.m }}>
          <Icon name="triangle-alert" size={14} color={t.red} />
          <T v="cap" c="redText" style={{ fontFamily: F.b, flex: 1 }}>{closed.names.join(', ')} · 그날 쉬어요. 코스를 고쳐 주세요</T>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.l }}>
        <ActionButton label="코스 고치기" icon="pencil" size="row" disabled={busy} onPress={() => setEdit(true)} style={{ flex: 1 }} />
        <ActionButton label="이 코스 취소하기" icon="circle-x" size="row" disabled={busy} onPress={cancel} style={{ flex: 1 }} />
      </View>
      {edit && (() => {
        const ed = courseEditInput(c, p.placeName);
        return (
          <CourseEditSheet open onClose={() => setEdit(false)} day={s.day} planId={s.planId} initial={ed.initial} initialDwell={ed.initialDwell}
            onApply={async (ids, dwell) => { await p.choosePlanned(s.planId, { stops: ids }, dwell); setEdit(false); }} />
        );
      })()}
    </View>
  );
}
