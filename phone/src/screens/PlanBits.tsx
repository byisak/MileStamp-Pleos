// 오늘 추천·코스 진행이 같이 쓰는 작은 부품: 코스 제목(장소 → 장소) · 칩(아이콘 + 글)
import { View } from 'react-native';
import type { Tone } from '../plan';
import { F, ToneName } from '../theme';
import { clockText } from '../timefmt';
import { Icon, IconName, T, useTheme } from '../ui';
import { Chip as UiChip } from '../parts';

// ---------- 코스 제목: 장소 → 장소 (화살표는 Lucide). 이름 중간에서 줄이 바뀌지 않게 '이름 + 화살표'를 한 덩어리로 ----------
export function CourseTitle({ names, oneLine, dim }: { names: string[]; oneLine?: boolean; dim?: boolean[] }) {
  const t = useTheme();
  const text = oneLine ? { fontSize: 16, lineHeight: 23 } : { fontSize: 16.5, lineHeight: 23, fontFamily: F.xb, letterSpacing: -0.3 };
  return (
    <View style={{ flexDirection: 'row', flexWrap: oneLine ? 'nowrap' : 'wrap', alignItems: 'center', overflow: 'hidden' }}>
      {names.map((name, k) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', flexShrink: oneLine ? 1 : 0 }}>
          <T v="h" numberOfLines={oneLine ? 1 : undefined} c={dim?.[k] ? 'ink3' : 'ink'}
            style={[text, oneLine && { flexShrink: 1 }, dim?.[k] && { textDecorationLine: 'line-through', fontFamily: F.sb }]}>{name}</T>
          {k < names.length - 1 && <Icon name="arrow-right" size={15} color={t.ink3} strokeWidth={2.3} style={{ marginHorizontal: 4 }} />}
        </View>
      ))}
    </View>
  );
}

// ---------- 칩 (이유·하늘·변경): 아이콘 + 글 (해 뜸·해 짐처럼 두 조각도). 글 속 'HH:MM'은 고른 시간 표시로 ----------
export type ChipPart = { icon?: IconName | null; text: string };
export function Chip({ parts, tone, big }: { parts: ChipPart[]; tone: Tone | 'WARN'; big?: boolean }) {
  // 색은 theme.ts tone 토큰 (서버 Tone 이름 → 토큰 이름). 모양은 공용 Chip(ui/)과 같음
  return <UiChip parts={parts.map((p) => ({ icon: p.icon, text: clockText(p.text) }))} tone={toneOf(tone)} size={big ? 'md' : 'sm'} />;
}

/** 서버·엔진 Tone 이름 → 칩 색 토큰 이름 */
export function toneOf(tone: Tone | 'WARN'): ToneName {
  return ({ PLAIN: 'plain', SUN: 'sun', NAP: 'nap', STAMP: 'stamp', RAIN: 'rain', WARN: 'warn', FESTIVAL: 'festival', AIR: 'air' } as Record<string, ToneName>)[tone] ?? 'plain';
}
