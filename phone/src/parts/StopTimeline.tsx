// 세로 타임라인 — 다녀옴 → 머무는 중 → 다음 → 예정 → 도착지. 왼쪽 동그라미 + 세로선, 오른쪽 이름·시각·그 아래 덧붙일 것(children).
// 상태 이름은 words.ts(다녀옴·머무는 중·다음·예정·건너뜀/뺌)와 같다.
import { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { tap } from '../haptics';
import { Icon, IconName } from '../icon';
import { H, R, S, TYPE, useTheme } from '../theme';
import { W } from '../words';
import { Chip } from './Chip';

export type StopState = 'done' | 'here' | 'next' | 'todo' | 'skipped' | 'removed' | 'end';
export type TimelineStop = {
  key: string;
  name: string;
  state: StopState;
  /** 시각 한 줄 ('오전 11:26 도착 예정', '오후 2:10에 나서요') */
  time?: string;
  /** 아이콘 (장소 아이콘). 없으면 상태 아이콘 */
  icon?: IconName;
  /** 귀가 한계를 넘는 도착지 → 빨강 */
  over?: boolean;
  /** 시각 아래 덧붙일 것 (머무름 칩, 30분 더 버튼 줄…) */
  children?: ReactNode;
  onPress?: () => void;
};

const STATE_ICON: Record<StopState, IconName> = { done: 'circle-check', here: 'map-pin', next: 'navigation', todo: 'circle', skipped: 'circle-x', removed: 'circle-minus', end: 'house' };
export const STATE_TEXT: Record<Exclude<StopState, 'end'>, string> = { done: W.done, here: W.here, next: W.next, todo: W.todo, skipped: W.skipped, removed: W.removed };

export function StopTimeline({ stops }: { stops: TimelineStop[] }) {
  const t = useTheme();
  return (
    <View>
      {stops.map((s, i) => {
        const live = s.state === 'next' || s.state === 'here';
        const gone = s.state === 'skipped' || s.state === 'removed';
        const last = i === stops.length - 1;
        const fg = s.over ? t.red : live ? t.accent : s.state === 'done' || s.state === 'end' ? t.ink2 : t.ink3;
        const bg = s.over ? t.redSoft : live ? t.accentSoft : t.fill;
        const label = s.state === 'end' ? undefined : STATE_TEXT[s.state];
        const row = (
          <View style={{ flexDirection: 'row', gap: S.l, minHeight: last ? H.touch : 52 }}>
            <View style={{ width: 28, alignItems: 'center' }}>
              <View style={{ width: 28, height: 28, borderRadius: R.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={s.icon ?? STATE_ICON[s.state]} size={15} color={fg} strokeWidth={2.2} />
              </View>
              {!last && <View style={{ flex: 1, width: 2, marginVertical: S.xs - 1, borderRadius: 1, backgroundColor: s.state === 'done' ? t.accent : t.fill2, opacity: s.state === 'done' ? 0.5 : 1 }} />}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : S.l - 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, minHeight: 28 }}>
                <Text numberOfLines={1} style={[TYPE.h, { color: s.state === 'done' ? t.ink2 : gone ? t.ink3 : t.ink, flexShrink: 1 }, gone && { textDecorationLine: 'line-through' }]}>{s.name}</Text>
                {live && label && <Chip text={label} tone="stamp" icon={s.state === 'next' ? 'navigation' : 'map-pin'} />}
                {!live && label && s.state !== 'todo' && <Text style={[TYPE.cap, { color: t.ink3 }]}>{label}</Text>}
              </View>
              {!!s.time && (
                <Text style={[TYPE.cap, { color: s.over ? t.redText : live ? t.ink : t.ink3, fontVariant: ['tabular-nums'] }, live && { fontFamily: TYPE.h.fontFamily }]}>{s.time}</Text>
              )}
              {s.children}
            </View>
          </View>
        );
        const a11y = [s.name, label, s.time].filter(Boolean).join(', ');
        return s.onPress ? (
          <Pressable key={s.key} onPress={() => { tap(); s.onPress!(); }} accessibilityRole="button" accessibilityLabel={a11y}
            style={({ pressed }) => ({ borderRadius: R.sm, backgroundColor: pressed ? t.fill : 'transparent' })}>{row}</Pressable>
        ) : <View key={s.key} accessible={!s.children} accessibilityLabel={a11y}>{row}</View>;
      })}
    </View>
  );
}
