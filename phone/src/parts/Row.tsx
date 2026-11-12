// 줄 — 오늘의 기록 줄 · 도착지 고르기 줄 · ··· 시트 줄 · 장소 고르기 줄. 높이 최소 56(누르는 칸 44 넘게).
// 누르는 줄은 배경색이 바뀌는 것으로 눌림을 보인다(버튼류는 작아지기, 줄류는 배경).
import { ReactNode } from 'react';
import { Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { tap } from '../haptics';
import { Icon, IconName } from '../icon';
import { R, S, TYPE, useTheme } from '../theme';
import { BadgeTone, IconBadge } from './IconBadge';

export function Row({ icon, tone = 'plain', leading, title, sub, trailing, onPress, danger, selected, disabled, lines = 1, style }: {
  /** 앞 동그란 아이콘 (leading을 주면 그것) */
  icon?: IconName;
  tone?: BadgeTone;
  leading?: ReactNode;
  title: string;
  sub?: string;
  /** 'chevron' = 오른쪽 화살표, 'check' = 고른 표시, 글 = 시각 같은 짧은 글, 그 밖은 그대로 */
  trailing?: 'chevron' | 'check' | string | ReactNode;
  onPress?: () => void;
  /** 빨간 글자 줄 (연결 끊기 등) */
  danger?: boolean;
  selected?: boolean;
  disabled?: boolean;
  lines?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const tail = trailing === 'chevron' ? <Icon name="chevron-right" size={18} color={t.ink3} />
    : trailing === 'check' ? <Icon name="check" size={18} color={t.accent} strokeWidth={2.6} />
    : typeof trailing === 'string' ? <Text style={[TYPE.cap, { color: t.ink3, fontVariant: ['tabular-nums'] }]}>{trailing}</Text>
    : trailing;
  const body = (
    <>
      {leading ?? (icon ? <IconBadge icon={icon} tone={danger ? 'warn' : tone} size="md" /> : null)}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={lines} style={[TYPE.h, { color: danger ? t.redText : t.ink }]}>{title}</Text>
        {!!sub && <Text numberOfLines={lines + 1} style={[TYPE.cap, { color: t.ink3, marginTop: 1 }]}>{sub}</Text>}
      </View>
      {tail}
    </>
  );
  const box: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: S.l + 2, minHeight: 56, paddingVertical: S.l - 2, borderRadius: R.sm };
  if (!onPress) return <View style={[box, style]}>{body}</View>;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={sub ? `${title}, ${sub}` : title} accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      style={({ pressed }) => [box, { backgroundColor: pressed ? t.fill : 'transparent', opacity: disabled ? 0.4 : 1 }, style]}>
      {body}
    </Pressable>
  );
}
