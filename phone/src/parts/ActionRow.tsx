// 작은 버튼 — 한 개(ActionButton)와 한 줄(ActionRow). 예전 SmallAct·StayBtn·RowBtn·StepBtn 두 벌을 이것 하나로.
// 누르는 칸은 늘 44 이상: sm은 보이는 크기 36 + 둘레 4씩(hitSlop), md 44, row 48(작은 버튼 줄), lg 56.
// 아이콘만 있는 버튼도 label은 꼭 받는다 → 화면 읽기 이름표.
import { ActivityIndicator, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { tap } from '../haptics';
import { Icon, IconName } from '../icon';
import { H, R, S, TYPE, useTheme } from '../theme';

export type ActionTone = 'plain' | 'accent' | 'ghost' | 'surface' | 'danger';
const HEIGHT = { sm: 36, md: H.touch, row: H.act, lg: H.cta } as const;
export type ActionSize = keyof typeof HEIGHT;

export function ActionButton({ label, icon, onPress, tone = 'plain', size = 'md', iconOnly, sub, busy, disabled, style }: {
  /** 글 (iconOnly면 화면 읽기 이름표로만) */
  label: string;
  icon?: IconName;
  onPress: () => void;
  /** plain 회색 · accent 연초록 · ghost 바탕 없음 · surface 흰 칸(회색 판 위) · danger 빨강 글자 */
  tone?: ActionTone;
  size?: ActionSize;
  iconOnly?: boolean;
  /** 아이콘 아래 작은 글 (lg 정사각 버튼: '−15분') */
  sub?: string;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [bg, fg] = {
    plain: [t.fill, t.ink2], accent: [t.accentSoft, t.accentInk], ghost: ['transparent', t.ink2], surface: [t.surface, t.ink], danger: [t.redSoft, t.redText],
  }[tone];
  const h = HEIGHT[size];
  const slop = Math.max(0, (H.touch - h) / 2);
  const square = iconOnly || !!sub;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} disabled={disabled || busy} hitSlop={slop}
      accessibilityRole="button" accessibilityLabel={sub ? `${label} ${sub}` : label} accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [{
        flexDirection: sub ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: sub ? 0 : S.s,
        height: h, minWidth: square ? (sub ? 64 : h) : undefined, paddingHorizontal: square ? 0 : S.l,
        borderRadius: size === 'lg' ? R.md + 2 : R.sm, backgroundColor: pressed && tone === 'ghost' ? t.fill : bg,
        opacity: disabled ? 0.35 : pressed && tone !== 'ghost' ? 0.7 : 1,
      }, style]}>
      {busy ? <ActivityIndicator color={fg} size="small" /> : (
        <>
          {!!icon && <Icon name={icon} size={size === 'lg' ? 18 : size === 'sm' ? 16 : 17} color={fg} strokeWidth={2.3} />}
          {!iconOnly && !sub && <Text style={[size === 'sm' ? TYPE.chip : TYPE.act, { color: fg }]}>{label}</Text>}
          {!!sub && <Text style={[TYPE.chip, { color: t.ink2 }]}>{sub}</Text>}
        </>
      )}
    </Pressable>
  );
}

export type ActionItem = { key?: string; icon?: IconName; label: string; onPress: () => void; tone?: ActionTone; disabled?: boolean; busy?: boolean };

/** 작은 버튼 줄 — 넘치면 다음 줄로. onMore를 주면 끝에 '···'(더 보기) */
export function ActionRow({ items, onMore, size = 'row', style }: {
  items: ActionItem[]; onMore?: () => void; size?: ActionSize; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: S.s }, style]}>
      {items.map((it, i) => (
        <ActionButton key={it.key ?? `${it.label}-${i}`} label={it.label} icon={it.icon} onPress={it.onPress} tone={it.tone} disabled={it.disabled} busy={it.busy} size={size} />
      ))}
      {onMore && <ActionButton label="더 보기" icon="ellipsis" iconOnly onPress={onMore} size={size} />}
    </View>
  );
}
