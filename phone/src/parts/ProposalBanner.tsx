// 제안 띠 — '바꾸자는 제안이 있어요' 한 줄. 누르면 제안을 펼치고, 버튼을 주면 띠 안에서 바로 '이걸로 바꾸기' / '그대로 갈게요'.
import { Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { tap } from '../haptics';
import { Icon, IconName } from '../icon';
import { R, S, TYPE, useTheme } from '../theme';
import { W } from '../words';
import { ActionButton } from './ActionRow';

export function ProposalBanner({ text = '바꾸자는 제안이 있어요', sub, icon = 'arrow-left-right', warn, onPress, onAdopt, onKeep, busy, style }: {
  text?: string;
  /** 첫 제안 요약 ('과학관 빼기 · 집 오후 4:49 도착') */
  sub?: string;
  icon?: IconName;
  /** 늦어져서 온 제안 → 빨강 띠 */
  warn?: boolean;
  /** 띠를 누르면 (제안 카드 펼치기) */
  onPress?: () => void;
  onAdopt?: () => void;
  onKeep?: () => void;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [bg, fg] = warn ? [t.redSoft, t.redText] : [t.accentSoft, t.accentInk];
  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m, minHeight: 28 }}>
      <Icon name={icon} size={17} color={fg} strokeWidth={2.3} />
      <View style={{ flex: 1 }}>
        <Text style={[TYPE.h, { fontSize: 15, lineHeight: 21, color: fg }]}>{text}</Text>
        {!!sub && <Text style={[TYPE.cap, { color: t.ink2 }]}>{sub}</Text>}
      </View>
      {onPress && <Icon name="chevron-right" size={18} color={fg} />}
    </View>
  );
  return (
    <View style={[{ backgroundColor: bg, borderRadius: R.md + 2, paddingHorizontal: S.l + 2, paddingVertical: S.l - 2 }, style]}>
      {onPress ? (
        <Pressable onPress={() => { tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={sub ? `${text}, ${sub}` : text}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>{head}</Pressable>
      ) : <View accessible accessibilityLabel={sub ? `${text}, ${sub}` : text} style={{ minHeight: 44, justifyContent: 'center' }}>{head}</View>}
      {(onAdopt || onKeep) && (
        <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.s }}>
          {onAdopt && <ActionButton label={W.adopt} icon="check" tone="surface" busy={busy} onPress={onAdopt} style={{ flex: 1 }} />}
          {onKeep && <ActionButton label={W.keep} tone="ghost" disabled={busy} onPress={onKeep} style={{ flex: 1 }} />}
        </View>
      )}
    </View>
  );
}
