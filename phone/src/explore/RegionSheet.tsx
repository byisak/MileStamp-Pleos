// '전국 ▾' → 시·도 고르기 시트 (시안 B). 여러 곳 고르기, '전국'은 모두 풀기.
// 수는 서버가 거리 칩까지 거른 뒤 센 시·도별 수(regionCounts) — 거리와 함께 거른다 (전국 + 3시간 = 3시간 안 전국).
// 고른 곳이 거리 안에 하나도 없으면 '거리 제한 없이 N곳 보기'도 준다.
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { F, R, S } from '../theme';
import { Btn, Sheet, T, tick, useTheme } from '../ui';
import { maxMinLabel, REGIONS, regionsLabel, type Filters } from './api';

const sum = (counts: Record<string, number>, codes: string[]) =>
  (codes.length ? codes : Object.keys(counts)).reduce((n, c) => n + (counts[c] ?? 0), 0);

export function RegionSheet({ open, onClose, value, counts, countsAll, onApply }: {
  open: boolean; onClose: () => void; value: Filters;
  /** 거리 칩까지 거른 뒤 시·도별 수 · 거리 없이 시·도별 수 (모르면 null) */
  counts: Record<string, number> | null; countsAll: Record<string, number> | null;
  onApply: (f: Filters) => void;
}) {
  const t = useTheme();
  const [sel, setSel] = useState<string[]>(value.regions);
  useEffect(() => { if (open) setSel(value.regions); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (code: string | null) => {
    tick();
    if (code == null) { setSel([]); return; }
    setSel((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));
  };
  const n = counts ? sum(counts, sel) : null;
  const nAll = countsAll ? sum(countsAll, sel) : null;
  const dist = maxMinLabel(value.maxMin);
  const cells: { code: string | null; name: string }[] = [{ code: null, name: '전국' }, ...REGIONS];

  return (
    <Sheet open={open} onClose={onClose}>
      <T v="title" accessibilityRole="header">지역 고르기</T>
      <T v="sub" c="ink3" style={{ marginTop: S.xxs }}>여러 곳 고를 수 있어요</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.s, marginTop: S.l }}>
        {cells.map((c) => {
          const on = c.code == null ? sel.length === 0 : sel.includes(c.code);
          const k = c.code && counts ? counts[c.code] ?? 0 : null;
          return (
            <Pressable key={c.code ?? 'all'} onPress={() => toggle(c.code)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
              accessibilityLabel={`${c.name}${k != null ? ` ${k}곳` : ''}`}
              style={({ pressed }) => ({ width: '23.5%', minHeight: 48, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
                borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accentSoft : pressed ? t.fill : t.surface })}>
              <T v="label" style={{ fontFamily: on ? F.xb : F.b, color: on ? t.accentInk : k === 0 ? t.ink4 : t.ink }}>{c.name}</T>
              {k != null && k > 0 && <T v="cap" style={{ fontSize: 11, lineHeight: 14, color: on ? t.accentInk : t.ink3 }}>{k}</T>}
            </Pressable>
          );
        })}
      </View>
      <T v="cap" c="ink3" style={{ marginTop: S.l }}>
        {[regionsLabel(sel), n != null ? `${n}곳` : null, dist ? `${dist} · 거리 칩과 함께 걸러요` : '거리 제한 없음'].filter(Boolean).join(' · ')}
      </T>
      <View style={{ gap: S.s, marginTop: S.l }}>
        <Btn title={n != null ? `${n}곳 보기` : '보기'} icon="check" disabled={n === 0}
          onPress={() => onApply({ ...value, regions: sel })} />
        {n === 0 && value.maxMin != null && !!nAll && (
          <Btn title={`거리 제한 없이 ${nAll}곳 보기`} kind="soft" onPress={() => onApply({ ...value, regions: sel, maxMin: null })} />
        )}
      </View>
    </Sheet>
  );
}
