// 장소 자세히의 '보통 머무는 시간' — 우리 가족 기준 예상 + 출처(우리 가족 기록 n번 · 같은 또래 n가족 · 조사값(4살 기준)),
// 같은 또래 가족이 10곳 이상 모였으면 '같은 또래 가족 보통 2시간 10분 (23가족)' 한 줄 더. GET /api/family/dwell?place=
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { durText } from '../course';
import { getPlaceDwell, PlaceDwellView } from '../plan';
import { useSession } from '../session';
import { F, R } from '../theme';
import { Icon, T, useTheme } from '../ui';

export function PlaceDwell({ placeId }: { placeId: string | null | undefined }) {
  const t = useTheme();
  const { token } = useSession();
  const [v, setV] = useState<PlaceDwellView | null>(null);
  useEffect(() => {
    setV(null);
    if (!token || !placeId) return;
    let alive = true;
    getPlaceDwell(token, placeId).then((r) => { if (alive) setV(r.place); }).catch(() => {}); // 덤 — 못 받으면 안 보인다
    return () => { alive = false; };
  }, [token, placeId]);
  if (!v) return null;
  return (
    <View style={{ marginTop: 12, alignSelf: 'stretch', backgroundColor: t.fill, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 11 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="hourglass" size={14} color={t.ink2} />
        <T v="cap" c="ink2" style={{ fontFamily: F.b }}>보통 머무는 시간</T>
        <T v="h" style={{ marginLeft: 'auto', fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] }}>{durText(v.minutes)}</T>
      </View>
      <T v="cap" c="ink3" style={{ marginTop: 2 }}>{v.text}</T>
      {!!v.crowd && <T v="cap" c="ink3">{v.crowd}</T>}
    </View>
  );
}
