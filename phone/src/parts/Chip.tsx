// 칩 — 보여 주기만 하는 작은 알약 (이유·하늘·상태). 색은 tone 이름으로만 (theme.ts tone).
// 누르는 것이 아니라 크기 제한(44)은 없다. 글자는 TYPE.chip 13 — 11.5·12 칩은 없앰.
import { Fragment } from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { Icon, IconName } from '../icon';
import { R, S, ToneName, TYPE, useTheme } from '../theme';

export type ChipPart = { icon?: IconName | null; text: string };

export function Chip({ text, parts, icon, tone = 'plain', size = 'sm', style }: {
  /** 글 한 덩어리 (parts를 쓰면 생략) */
  text?: string;
  /** 아이콘 + 글 여러 조각 (해 뜸 · 해 짐처럼) */
  parts?: ChipPart[];
  icon?: IconName;
  tone?: ToneName;
  /** sm 24 · md 28 (높이는 최소값 — 시스템 글자 크게에도 늘어남) */
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [bg, fg] = t.tone[tone];
  const list: ChipPart[] = parts ?? [{ icon, text: text ?? '' }];
  const md = size === 'md';
  return (
    <View accessible accessibilityLabel={list.map((p) => p.text).join(' ')}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: S.xs, minHeight: md ? 28 : 24, paddingVertical: S.xxs, paddingHorizontal: md ? S.l - 2 : S.m,
        borderRadius: R.pill, backgroundColor: bg, alignSelf: 'flex-start', flexShrink: 1 }, style]}>
      {list.map((p, i) => (
        <Fragment key={i}>
          {!!p.icon && <Icon name={p.icon} size={md ? 14 : 13} color={fg} strokeWidth={2.2} style={i > 0 ? { marginLeft: S.xs } : undefined} />}
          <Text textBreakStrategy="simple" style={[TYPE.chip, { color: fg, flexShrink: 1 }]}>{p.text}</Text>
        </Fragment>
      ))}
    </View>
  );
}
