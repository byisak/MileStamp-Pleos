// 기준 위치 고르기 (docs/검색-거리순-계획.md ①): 우리 집(기본) · 지금 내 위치(이때만 위치 권한을 물음) · 직접 정한 곳(검색 · 최근 3곳)
// 목록의 '차로 ○분'·거리 칩·거리순이 모두 이 기준. 코스 짜기는 언제나 집에서 출발.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Alert } from '../alert';
import { currentSpot } from '../screens/MapPick';
import { F, R, S } from '../theme';
import { Icon, Sheet, T, useTheme } from '../ui';
import { Row } from '../parts';
import { refPoint, type RefLoc, type RefState } from './api';
import { SearchBox } from './SearchBox';

export function RefSheet({ open, onClose, value, token, onChange }: {
  open: boolean; onClose: () => void; value: RefState; token: string | null; onChange: (r: RefLoc) => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const cur = value.cur;
  const here = async () => {
    setBusy(true);
    const p = await currentSpot();
    setBusy(false);
    if (!p) { Alert.alert('위치를 몰라요', '위치 권한을 허락하거나 잠시 뒤 다시 해 주세요'); return; }
    onChange({ kind: 'here', lat: p[0], lng: p[1] });
  };
  const sel = (on: boolean) => (on ? <Icon name="check" size={18} color={t.accent} strokeWidth={2.6} /> : undefined);

  return (
    <Sheet open={open} onClose={onClose}>
      <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <T v="title" accessibilityRole="header">어디서부터 볼까요?</T>
        <T v="cap" c="ink3" style={{ marginTop: S.xxs }}>목록의 '차로 ○분'과 거리 칩·거리순이 이 기준이에요</T>
        <View style={{ marginTop: S.l, backgroundColor: t.fill, borderRadius: R.lg, paddingHorizontal: S.l }}>
          <Row icon="house" tone={cur.kind === 'home' ? 'accent' : 'plain'} title="우리 집" sub="기본" onPress={() => onChange({ kind: 'home' })} trailing={sel(cur.kind === 'home')} />
          <View style={{ borderTopWidth: 1, borderTopColor: t.line }}>
            <Row icon="locate-fixed" tone={cur.kind === 'here' ? 'accent' : 'plain'} title={busy ? '위치를 찾는 중…' : '지금 내 위치'}
              sub="고를 때만 위치를 물어요" onPress={busy ? undefined : here} trailing={sel(cur.kind === 'here')} />
          </View>
          {value.recent.map((r) => {
            const on = cur.kind === 'custom' && Math.abs(cur.lat - r.lat) < 1e-4 && Math.abs(cur.lng - r.lng) < 1e-4;
            return (
              <View key={`${r.lat},${r.lng}`} style={{ borderTopWidth: 1, borderTopColor: t.line }}>
                <Row icon="map-pin" tone={on ? 'accent' : 'plain'} title={r.name} sub="최근 정한 곳" onPress={() => onChange(r)} trailing={sel(on)} />
              </View>
            );
          })}
        </View>
        <T v="label" c="ink2" style={{ marginTop: S.l, marginBottom: S.s, fontFamily: F.b }}>직접 정하기</T>
        <SearchBox token={token} from={refPoint(cur)} placeholder="동네·장소·주소 (예: 수성못, 연암로 40)" max={6}
          onPick={(s) => onChange({ kind: 'custom', name: s.name, lat: s.lat, lng: s.lng })} />
        <T v="cap" c="ink3" style={{ marginTop: S.s }}>'직접 찾기' 지도에서 길게 눌러 고른 곳도 기준으로 정할 수 있어요</T>
        <View style={{ marginTop: S.l, flexDirection: 'row', gap: S.s, alignItems: 'flex-start' }}>
          <Icon name="route" size={15} color={t.ink3} />
          <T v="cap" c="ink3" style={{ flex: 1 }}>코스 짜기는 언제나 우리 집에서 출발해요 · 기준 위치는 목록을 보는 기준이에요</T>
        </View>
      </ScrollView>
    </Sheet>
  );
}
