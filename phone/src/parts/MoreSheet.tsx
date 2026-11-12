// ··· 시트 — 자주 안 쓰는 일을 모아 둔 아래 시트 (다음 바꾸기·빼기·지금 집으로·도착 바꾸기·다른 코스 보기·우리 가족 설정).
// 줄마다 한 줄 설명으로 누르면 무엇이 일어나는지 미리 보인다. 아래에서 올라와 한 손으로 닿는다.
import { View } from 'react-native';
import { IconName } from '../icon';
import { R, S, useTheme } from '../theme';
import { Btn, Sheet, T } from '../ui';
import { Row } from './Row';

export type MoreItem = { key?: string; icon: IconName; title: string; sub?: string; onPress: () => void; danger?: boolean; disabled?: boolean };

/** items 대신 groups를 주면 묶음마다 회색 판 하나 */
export function MoreSheet({ open, onClose, title, sub, items, groups }: {
  open: boolean; onClose: () => void; title?: string; sub?: string; items?: MoreItem[]; groups?: MoreItem[][];
}) {
  const t = useTheme();
  const list = (groups ?? [items ?? []]).filter((g) => g.length);
  return (
    <Sheet open={open} onClose={onClose}>
      {!!title && <T v="title" accessibilityRole="header">{title}</T>}
      {!!sub && <T v="sub" c="ink3" style={{ marginTop: S.xxs }}>{sub}</T>}
      {list.map((g, gi) => (
        <View key={gi} style={{ marginTop: gi ? S.m : title || sub ? S.l : 0, backgroundColor: t.fill, borderRadius: R.md + 2, paddingHorizontal: S.l + 2 }}>
          {g.map((it, i) => (
            <View key={it.key ?? it.title} style={i ? { borderTopWidth: 1, borderTopColor: t.line } : undefined}>
              <Row icon={it.icon} tone="surface" title={it.title} sub={it.sub} danger={it.danger} disabled={it.disabled} trailing="chevron"
                onPress={() => { onClose(); it.onPress(); }} />
            </View>
          ))}
        </View>
      ))}
      <Btn title="닫기" kind="soft" onPress={onClose} style={{ marginTop: S.l }} />
    </Sheet>
  );
}
