// 머무는 시간 바꾸기 시트 — 코스의 한 곳을 오늘만 N분으로 (엔진 SetDwell: 15~360분, 5분 단위).
// −15 / +15 버튼과 빠른 고르기(30·60·90·120·180분), 출처 한 줄(우리 가족 기록 n번 · 같은 또래 n가족 · 조사값).
// 지금 머무는 곳이면 '30분 더 · 1시간 더 · 지금 나갈게요'(ExtendStay)는 코스 줄에 바로 있다 — 여기선 전체 시간을 고른다.
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { clampDwell, durText, DWELL_MAX, DWELL_MIN, DwellSource } from '../course';
import { F, R } from '../theme';
import { Btn, Icon, Sheet, T, tap, useTheme } from '../ui';
import { ActionButton } from '../parts';

const QUICK = [30, 60, 90, 120, 180];

export function DwellSheet({ open, onClose, name, minutes, source, set, arrived, onApply }: {
  open: boolean; onClose: () => void;
  name: string;
  /** 지금 쓰는 머무름(분) */
  minutes: number;
  source?: DwellSource | null;
  /** 오늘 이미 직접 정했는지 */
  set?: boolean;
  /** 지금 머무는 곳 (도착부터 센 전체 시간) */
  arrived?: boolean;
  onApply: (minutes: number) => void;
}) {
  const t = useTheme();
  const [m, setM] = useState(clampDwell(minutes));
  useEffect(() => { if (open) setM(clampDwell(minutes)); }, [open, minutes]);
  const step = (d: number) => { tap(); setM((x) => clampDwell(x + d)); };
  const changed = m !== minutes;
  return (
    <Sheet open={open} onClose={onClose}>
      <T v="title">{name}</T>
      <T v="sub" c="ink3" style={{ marginTop: 4 }}>{arrived ? '도착부터 모두 몇 분 머물까요?' : '여기서 얼마나 머물까요?'}</T>

      {/* −15 · 지금 값 · +15 */}
      <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <ActionButton label="15분 줄이기" icon="minus" sub="15분" size="lg" disabled={m <= DWELL_MIN} onPress={() => step(-15)} />
        <View style={{ minWidth: 132, alignItems: 'center' }}>
          <T v="h" style={{ fontSize: 30, lineHeight: 38, fontFamily: F.xb, fontVariant: ['tabular-nums'] }}>{durText(m)}</T>
          {changed && <T v="cap" c="ink3">지금 {durText(minutes)}</T>}
        </View>
        <ActionButton label="15분 늘리기" icon="plus" sub="15분" size="lg" disabled={m >= DWELL_MAX} onPress={() => step(15)} />
      </View>

      {/* 빠른 고르기 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16 }}>
        {QUICK.map((q) => {
          const on = q === m;
          return (
            <Pressable key={q} onPress={() => { tap(); setM(q); }}
              style={({ pressed }) => ({ height: 36, paddingHorizontal: 14, borderRadius: R.pill, justifyContent: 'center', backgroundColor: on ? t.ink : t.fill, opacity: pressed ? 0.6 : 1 })}>
              <T v="cap" style={{ fontFamily: F.b, fontSize: 13.5, color: on ? t.onInk : t.ink }}>{durText(q)}</T>
            </Pressable>
          );
        })}
      </View>

      {/* 출처 · 오늘만 */}
      <View style={{ marginTop: 16, backgroundColor: t.fill, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 11, gap: 4 }}>
        {!!source && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name={source.source === 'family' ? 'heart' : source.source === 'crowd' ? 'users' : 'book-open'} size={13} color={t.ink2} />
            <T v="cap" c="ink2" style={{ flexShrink: 1 }}>
              {set ? '오늘 직접 정했어요 · ' : ''}보통 {durText(source.minutes ?? minutes)} · {source.text}
            </T>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="calendar" size={13} color={t.ink3} />
          <T v="cap" c="ink3" style={{ flexShrink: 1 }}>오늘만 바꿔요 · 다음 계획은 실제로 머문 시간을 배워서 맞춰요</T>
        </View>
      </View>

      <Btn title={changed ? `${durText(m)}로 바꾸기` : '그대로 두기'} icon={changed ? 'check' : undefined} kind={changed ? 'ink' : 'soft'}
        onPress={() => (changed ? onApply(m) : onClose())} style={{ marginTop: 14 }} />
    </Sheet>
  );
}
