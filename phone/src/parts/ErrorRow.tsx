// 오류 줄 — 쉬운 말 한 줄 + '다시 불러오기'. 원래 오류 글(서버·네트워크 말)은 보여 주지 않는다 (ui.tsx friendlyError·plainError).
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { R, S, TYPE, useTheme } from '../theme';
import { ActionButton } from './ActionRow';
import { IconBadge } from './IconBadge';

export function ErrorRow({ title, sub, onRetry, busy, style }: { title: string; sub?: string; onRetry?: () => void; busy?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View accessibilityRole="alert"
      style={[{ flexDirection: 'row', alignItems: 'center', gap: S.l, backgroundColor: t.surface, borderRadius: R.md + 2, paddingVertical: S.l, paddingLeft: S.l + 2, paddingRight: S.l - 2 }, style]}>
      <IconBadge icon="circle-alert" tone="warn" size="sm" />
      <View style={{ flex: 1 }}>
        <Text style={[TYPE.h, { fontSize: 15, lineHeight: 21, color: t.ink }]}>{title}</Text>
        {!!sub && <Text style={[TYPE.cap, { color: t.ink2, marginTop: 1 }]}>{sub}</Text>}
      </View>
      {onRetry && <ActionButton label="다시 불러오기" icon="refresh-cw" tone="plain" busy={busy} onPress={onRetry} />}
    </View>
  );
}
