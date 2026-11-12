// 다음 목적지 — 오늘 탭 주인공. 작은 머리말('다음 목적지') + 큰 이름 + 도착 예정 한 줄 + 보조 한 줄(귀가 한계·여유).
// 2초 안에 읽히게: 이름은 hero 24, 시각은 굵게. 늦어짐이면 보조 줄만 빨강 글자.
import { ReactNode } from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { Icon, IconName } from '../icon';
import { S, TYPE, useTheme } from '../theme';
import { IconBadge } from './IconBadge';

export function NextHero({ kicker = '다음 목적지', name, icon = 'navigation', arrive, sub, warn, right, style }: {
  kicker?: string;
  name: string;
  icon?: IconName;
  /** '오전 11:26 도착 예정 · 약 14분' */
  arrive?: string;
  /** '집 오후 3:52 도착 예정 · 여유 15분' */
  sub?: string;
  warn?: boolean;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View accessible accessibilityLabel={[kicker, name, arrive, sub].filter(Boolean).join(', ')}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: S.l + 2 }, style]}>
      <IconBadge icon={icon} tone="accent" size="lg" />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
          <Text style={[TYPE.label, { color: t.accent }]}>{kicker}</Text>
        </View>
        <Text numberOfLines={2} style={[TYPE.hero, { color: t.ink }]}>{name}</Text>
        {!!arrive && <Text style={[TYPE.sub, { color: t.ink, fontFamily: TYPE.h.fontFamily, fontVariant: ['tabular-nums'] }]}>{arrive}</Text>}
        {!!sub && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.xxs }}>
            {warn && <Icon name="triangle-alert" size={14} color={t.red} />}
            <Text style={[TYPE.cap, { color: warn ? t.redText : t.ink3, fontVariant: ['tabular-nums'] }]}>{sub}</Text>
          </View>
        )}
      </View>
      {right}
    </View>
  );
}
