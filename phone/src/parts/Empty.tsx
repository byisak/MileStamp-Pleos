// 빈 화면 — 동그란 아이콘 + 한 줄 제목 + 쉬운 설명 (+ 할 일 버튼 하나). 개발자 말 대신 다음에 무엇이 오는지.
import { ReactNode } from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { IconName } from '../icon';
import { S, TYPE, useTheme } from '../theme';
import { IconBadge } from './IconBadge';

export function Empty({ icon, title, sub, action, compact, style }: {
  icon: IconName; title: string; sub?: string; action?: ReactNode;
  /** 카드 안에 넣을 때: 위아래 여백을 줄임 */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[{ alignItems: 'center', paddingVertical: compact ? S.sec : 56, paddingHorizontal: 28 }, style]}>
      <IconBadge icon={icon} tone="mute" size="xl" />
      <Text accessibilityRole="header" style={[TYPE.h, { color: t.ink, marginTop: S.l + 2, textAlign: 'center' }]}>{title}</Text>
      {!!sub && <Text style={[TYPE.sub, { color: t.ink3, textAlign: 'center', marginTop: S.xs }]}>{sub}</Text>}
      {action && <View style={{ marginTop: S.xl }}>{action}</View>}
    </View>
  );
}
