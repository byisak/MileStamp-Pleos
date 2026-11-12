// 하루 막대 — 그리는 일은 screens/DayBar.tsx(눈금 자리 잡기 시험이 그쪽에 붙어 있음)를 그대로 쓰고,
// 여기서는 제목·범례를 붙인 한 덩어리(DayBarBlock)만 더한다. 색은 theme.ts bar 토큰.
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import type { Leg } from '../plan';
import { S, TYPE, useTheme } from '../theme';
import { DayBar, DayLegend, Mark } from '../screens/DayBar';

export { DayBar, DayLegend };
export type { Mark };

export function DayBarBlock({ title, legs, from, to, marks, legend, style }: {
  title?: string; legs: Leg[]; from: number; to: number; marks: Mark[]; legend?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={style} accessible accessibilityLabel={title ? `${title} 막대` : '하루 막대'}>
      {!!title && <Text style={[TYPE.label, { color: t.ink3 }]}>{title}</Text>}
      <DayBar legs={legs} from={from} to={to} marks={marks} />
      {legend && <View style={{ marginTop: S.xs }}><DayLegend /></View>}
    </View>
  );
}
