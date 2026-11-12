// 하루 막대: 이동·머무름·차에서 낮잠·귀갓길을 시각 순서로 한 줄에. 지금·해 짐·저녁은 세로 표시.
// 그림 라이브러리 없이 View만 쓴다 (빗금도 작은 막대를 기울여 깐다).
import { useState } from 'react';
import { View } from 'react-native';
import { Leg, LegKind } from '../plan';
import { F, Theme } from '../theme';
import { T, useTheme } from '../ui';

export type Mark = { min: number; label: string; tone: 'now' | 'sun' | 'dinner' };

/** 구간 색 = theme.ts bar 토큰 */
export function legColors(t: Theme): Record<LegKind, string> & { nap2: string } {
  const b = t.bar;
  return { DRIVE: b.drive, STAY: b.stay, NAP_DRIVE: b.nap, nap2: b.napStripe, HOME: b.home };
}

const TRACK_TOP = 9, TRACK_H = 12, MARK_H = 30;
// 눈금 글은 굵게 12.5 (정보 글씨 최소 13, 굵게 600 이상이면 12.5 허용)
const LABEL_FS = 12.5, LABEL_LH = 16, LABEL_GAP = 6;

/** 글 폭 어림 (글꼴 12.5): 한글 ≈ 12.6px · 숫자·기호 ≈ 7.6px · 빈칸 3.6px. onLayout을 기다리지 않으려고 어림하고 4px 여유 */
export function labelWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[\uac00-\ud7a3]/.test(ch) ? 12.6 : ch === ' ' ? 3.6 : 7.6;
  return Math.ceil(w) + 4;
}

export type PlacedLabel<M> = M & { left: number; width: number; row: number; align: 'left' | 'center' | 'right' };

/**
 * 표시 글 자리 잡기: 표시선 가운데에 두되 막대 안으로 당기고(끝 쪽이면 오른쪽 맞춤, 앞쪽이면 왼쪽 맞춤),
 * 앞 글과 겹치면 둘째 줄로 내린다(둘째 줄도 겹치면 그 줄에서 오른쪽으로 밀되 막대를 넘지 않게).
 */
export function placeLabels<M extends { x: number; label: string; min: number }>(marks: M[], w: number): PlacedLabel<M>[] {
  const end = [-Infinity, -Infinity];
  return [...marks].sort((a, b) => a.min - b.min).map((m) => {
    const width = Math.min(labelWidth(m.label), w);
    const want = m.x - width / 2;
    let left = Math.min(Math.max(want, 0), Math.max(0, w - width));
    let row = 0;
    if (left < end[0] + LABEL_GAP) {
      row = 1;
      if (left < end[1] + LABEL_GAP) left = Math.min(end[1] + LABEL_GAP, Math.max(0, w - width));
    }
    end[row] = left + width;
    const align: 'left' | 'center' | 'right' = want <= 0 ? 'left' : want >= w - width ? 'right' : 'center';
    return { ...m, left, width, row, align } as PlacedLabel<M>;
  });
}

export function DayBar({ legs, from, to, marks }: { legs: Leg[]; from: number; to: number; marks: Mark[] }) {
  const t = useTheme();
  const c = legColors(t);
  const [w, setW] = useState(0);
  const x = (min: number) => ((Math.min(Math.max(min, from), to) - from) / (to - from)) * w;
  const markColor = { now: t.ink, sun: t.bar.markSun, dinner: t.ink3 };
  const labelColor = { now: t.ink2, sun: t.bar.markSunText, dinner: t.ink3 };

  const placed = placeLabels(marks.map((m) => ({ ...m, x: x(m.min) })), w);
  const rows = placed.some((m) => m.row > 0) ? 2 : 1;

  return (
    <View style={{ height: MARK_H + 2 + rows * LABEL_LH, marginTop: 12 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <>
          <View style={{ position: 'absolute', left: 0, right: 0, top: TRACK_TOP, height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: t.bar.track, overflow: 'hidden' }}>
            {legs.map((l, i) => {
              const left = x(l.fromMin), width = Math.max(x(l.toMin) - left, 1.5);
              return l.kind === 'NAP_DRIVE' ? (
                <View key={i} style={{ position: 'absolute', top: 0, bottom: 0, left, width, backgroundColor: c.nap2, overflow: 'hidden' }}>
                  {Array.from({ length: Math.ceil((width + TRACK_H) / 8) }).map((_, k) => (
                    <View key={k} style={{ position: 'absolute', top: -4, width: 4, height: TRACK_H + 8, left: k * 8 - TRACK_H, backgroundColor: c.NAP_DRIVE, transform: [{ rotate: '45deg' }] }} />
                  ))}
                </View>
              ) : (
                <View key={i} style={{ position: 'absolute', top: 0, bottom: 0, left, width, backgroundColor: c[l.kind] }} />
              );
            })}
          </View>
          {placed.map((m) => (
            <View key={m.tone + m.min}>
              <View style={{ position: 'absolute', top: 0, left: x(m.min) - 1, width: 2, height: MARK_H, borderRadius: 1, backgroundColor: markColor[m.tone] }} />
              <T v="cap" numberOfLines={1}
                style={{ position: 'absolute', top: MARK_H + 1 + m.row * LABEL_LH, left: m.left, width: m.width, fontSize: LABEL_FS, lineHeight: LABEL_LH, fontFamily: F.b, color: labelColor[m.tone],
                  textAlign: m.align }}>
                {m.label}
              </T>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

export function DayLegend() {
  const t = useTheme();
  const c = legColors(t);
  const items: [string, string][] = [[c.DRIVE, '이동'], [c.STAY, '머무름'], [c.NAP_DRIVE, '차에서 낮잠'], [c.HOME, '귀갓길']];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 }}>
      {items.map(([bg, label]) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 8, borderRadius: 2, backgroundColor: bg }} />
          <T v="cap" c="ink3" textBreakStrategy="simple" numberOfLines={1}>{label}</T>
        </View>
      ))}
    </View>
  );
}
