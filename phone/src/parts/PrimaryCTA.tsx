// 큰 버튼 — 화면에 하나만. 차로 보내기 · 코스 진행 보기 · 지금 집으로 · 오늘 하루 자랑 카드.
// 잉크 초록(accent) 바탕 + onAccent 글자 (밝게 9.7:1 / 어둡게 7.6:1). 높이 56(H.cta), 누르면 살짝 작아짐.
import { ActivityIndicator, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { tap } from '../haptics';
import { Icon, IconName } from '../icon';
import { H, R, S, TYPE, useTheme } from '../theme';

export function PrimaryCTA({ title, sub, icon, onPress, busy, disabled, kind = 'accent', style }: {
  title: string;
  /** 버튼 안 둘째 줄 (예: '오후 4:30 도착') */
  sub?: string;
  icon?: IconName;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** accent(기본) · ink(검정) · soft(연한 — 같은 화면에 큰 버튼이 이미 있을 때) */
  kind?: 'accent' | 'ink' | 'soft';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [bg, fg] = kind === 'ink' ? [t.ink, t.onInk] : kind === 'soft' ? [t.fill, t.ink] : [t.accent, t.onAccent];
  return (
    <Pressable onPress={() => { tap(); onPress(); }} disabled={disabled || busy}
      accessibilityRole="button" accessibilityLabel={sub ? `${title}, ${sub}` : title} accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [{
        minHeight: H.cta, borderRadius: R.md, backgroundColor: bg, paddingHorizontal: S.xl, paddingVertical: S.m,
        alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch',
        opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }],
      }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m }}>
            {icon && <Icon name={icon} size={19} color={fg} strokeWidth={2.2} />}
            <Text style={[TYPE.btn, { color: fg }]}>{title}</Text>
          </View>
          {!!sub && <Text style={[TYPE.cap, { color: fg, marginTop: S.xxs }]}>{sub}</Text>}
        </>
      )}
    </Pressable>
  );
}
