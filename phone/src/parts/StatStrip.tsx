// 숫자 카드 — 한 장 카드 안에 2~3칸, 칸 사이 얇은 선. (오늘 도장 · 다녀온 곳 · 완료 미션 / 자랑 카드 숫자)
// 시안(proto/home-redesign-ref.png)처럼 칸마다 왼쪽에 동그란 아이콘(IconBadge) + 오른쪽에 큰 숫자 · 이름.
// 칸이 좁으면(접힌 폰·360dp) 아이콘을 작게, 더 좁으면 숫자 위로 올린다 — 이름이 잘리지 않게.
import { useState } from 'react';
import { Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { tap } from '../haptics';
import { Icon, IconName } from '../icon';
import { R, S, TYPE, useTheme } from '../theme';
import { BadgeTone, IconBadge } from './IconBadge';

export type StatItem = { key?: string; icon?: IconName; tone?: BadgeTone; value: number | string | null; unit?: string; label: string; onPress?: () => void };

export function StatStrip({ items, style }: { items: StatItem[]; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const cellW = w ? w / Math.max(1, items.length) : 0;
  // 칸 폭: 넉넉(≥136) = 아이콘 40 옆 / 보통(≥112) = 아이콘 28 옆 / 좁음 = 아이콘 28 위
  const layout: 'wide' | 'mid' | 'stack' = !cellW || cellW >= 136 ? 'wide' : cellW >= 112 ? 'mid' : 'stack';
  const pad = layout === 'wide' ? S.l + 2 : S.m + 2;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ flexDirection: 'row', backgroundColor: t.surface, borderRadius: R.lg, overflow: 'hidden' }, style]}>
      {items.map((it, i) => {
        const value = it.value ?? '–';
        const badge = it.icon ? <IconBadge icon={it.icon} tone={it.tone ?? 'accent'} size={layout === 'wide' ? 'md' : 'sm'} /> : null;
        const text = (
          <View style={{ flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: S.xxs }}>
              <Text style={[TYPE.num, { color: t.ink, fontVariant: ['tabular-nums'] }]}>{value}</Text>
              {!!it.unit && <Text style={[TYPE.cap, { color: t.ink2 }]}>{it.unit}</Text>}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xxs }}>
              <Text numberOfLines={1} style={[TYPE.cap, { color: t.ink3, flexShrink: 1 }]}>{it.label}</Text>
              {!!it.onPress && <Icon name="chevron-right" size={13} color={t.ink3} />}
            </View>
          </View>
        );
        const inner = layout === 'stack'
          ? <View style={{ gap: S.s }}>{badge}{text}</View>
          : <View style={{ flexDirection: 'row', alignItems: 'center', gap: layout === 'wide' ? S.l - 2 : S.m }}>{badge}{text}</View>;
        const cell: ViewStyle = { flex: 1, minHeight: 72, justifyContent: 'center', paddingVertical: S.l + 2, paddingHorizontal: pad, borderLeftWidth: i ? 1 : 0, borderLeftColor: t.line };
        const a11y = `${it.label} ${value}${it.unit ?? ''}`;
        return it.onPress ? (
          <Pressable key={it.key ?? it.label} onPress={() => { tap(); it.onPress!(); }} accessibilityRole="button" accessibilityLabel={a11y}
            style={({ pressed }) => [cell, { backgroundColor: pressed ? t.fill : 'transparent' }]}>{inner}</Pressable>
        ) : (
          <View key={it.key ?? it.label} accessible accessibilityLabel={a11y} style={cell}>{inner}</View>
        );
      })}
    </View>
  );
}
