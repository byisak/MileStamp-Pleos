// 거리 칩 · 전국▾ · 인기 · 거리순 + 기준 위치 줄('우리 집 기준 ▾') + 요약 줄('차로 2시간 안 · 23곳' · 지도로 보기) — 축제·100선 공용
// 거리 칩은 한 번 더 누르면 풀린다(거리 제한 없음 = '전국'이 켜짐). 전국▾는 시·도 시트를 연다.
import { Pressable, ScrollView, View } from 'react-native';
import { F, R, S } from '../theme';
import { Icon, IconName, T, tick, useTheme } from '../ui';
import { maxMinLabel, refLabel, regionsLabel, type Filters, type MaxMin, type RefLoc } from './api';

function FilterChip({ label, on, onPress, icon, caret, a11y }: { label: string; on: boolean; onPress: () => void; icon?: IconName; caret?: boolean; a11y?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tick(); onPress(); }} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={a11y ?? label}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: S.l, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1,
        borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accentSoft : pressed ? t.fill : t.surface })}>
      {!!icon && <Icon name={icon} size={14} color={on ? t.accentInk : t.ink2} strokeWidth={2.2} />}
      <T v="cap" numberOfLines={1} style={{ fontFamily: on ? F.xb : F.b, color: on ? t.accentInk : t.ink2 }}>{label}</T>
      {caret && <Icon name="chevron-down" size={14} color={on ? t.accentInk : t.ink3} />}
    </Pressable>
  );
}

export function ExploreFilters({ value, onChange, onRegions }: { value: Filters; onChange: (f: Filters) => void; onRegions: () => void }) {
  const t = useTheme();
  const dist: Exclude<MaxMin, null>[] = [60, 120, 180];
  const wide = !value.regions.length && value.maxMin == null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: S.l, marginHorizontal: -S.page }}
      contentContainerStyle={{ paddingHorizontal: S.page, gap: S.s, alignItems: 'center' }}>
      {dist.map((m) => (
        <FilterChip key={m} label={`${m / 60}시간`} a11y={`차로 ${m / 60}시간 안`} on={value.maxMin === m}
          onPress={() => onChange({ ...value, maxMin: value.maxMin === m ? null : m })} />
      ))}
      <FilterChip label={regionsLabel(value.regions)} on={wide || value.regions.length > 0} caret onPress={onRegions} a11y="지역 고르기" />
      <View style={{ width: 1, height: 20, backgroundColor: t.line, marginHorizontal: 2 }} />
      <FilterChip label="인기" icon="users" on={value.popular} onPress={() => onChange({ ...value, popular: !value.popular, distance: false })} a11y="많이 고른 순" />
      <FilterChip label="거리순" icon="route" on={value.distance} onPress={() => onChange({ ...value, distance: !value.distance, popular: false })} a11y="기준 위치에서 가까운 순" />
    </ScrollView>
  );
}

/** 요약 줄: '대구·경북 · 차로 2시간 안 · 23곳' + 오른쪽 '지도로 보기' */
export function ExploreSummary({ value, count, onMap, note }: { value?: Filters; count: number | null; onMap?: () => void; note?: string | null }) {
  const t = useTheme();
  const text = [
    value?.regions.length ? regionsLabel(value.regions) : null,
    value ? maxMinLabel(value.maxMin) ?? (value.regions.length ? null : '전국') : null,
    count != null ? `${count}곳` : null,
    value?.popular ? '인기 순' : value?.distance ? '가까운 순' : null,
  ].filter(Boolean).join(' · ');
  return (
    <View style={{ marginTop: S.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, minHeight: 36, paddingHorizontal: S.xxs }}>
        <T v="cap" c="ink3" numberOfLines={1} style={{ flex: 1, fontFamily: F.m }}>{text}</T>
        {onMap && (
          <Pressable onPress={() => { tick(); onMap(); }} accessibilityRole="button" accessibilityLabel="지도로 보기" hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: S.m, borderRadius: R.pill,
              backgroundColor: pressed ? t.fill : 'transparent' })}>
            <Icon name="map" size={15} color={t.accent} strokeWidth={2.2} />
            <T v="cap" style={{ color: t.accent, fontFamily: F.b }}>지도로 보기</T>
          </Pressable>
        )}
      </View>
      {!!note && <T v="cap" c="ink3" style={{ paddingHorizontal: S.xxs }}>{note}</T>}
    </View>
  );
}

/** 기준 위치 줄: '📍 우리 집 기준 ▾' — 누르면 기준 위치 시트 */
export function RefRow({ value, onPress, style }: { value: RefLoc; onPress: () => void; style?: object }) {
  const t = useTheme();
  const icon: IconName = value.kind === 'home' ? 'house' : value.kind === 'here' ? 'locate-fixed' : 'map-pin';
  return (
    <Pressable onPress={() => { tick(); onPress(); }} accessibilityRole="button" accessibilityLabel={`${refLabel(value)} 기준 · 바꾸기`} hitSlop={6}
      style={({ pressed }) => [{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, marginTop: S.s,
        paddingHorizontal: S.s, borderRadius: R.pill, backgroundColor: pressed ? t.fill : 'transparent' }, style]}>
      <Icon name={icon} size={15} color={t.accent} strokeWidth={2.2} />
      <T v="cap" numberOfLines={1} style={{ color: t.ink2, fontFamily: F.b, maxWidth: 260 }}>{refLabel(value)} 기준</T>
      <Icon name="chevron-down" size={14} color={t.ink3} />
    </Pressable>
  );
}
