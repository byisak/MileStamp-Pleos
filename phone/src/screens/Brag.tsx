// 자랑 카드: 집에 도착하면 오는 '오늘 하루' 세로 카드 (노을 수채 풍경 + 종이색, km는 여기에만) → 이미지로 공유(카톡 등) · 사진첩에 저장
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { Alert } from '../alert';
import type { TripEvent } from '../api';
import { place } from '../places';
import { BRAND, F, R } from '../theme';
import { Landscape } from '../parts';
import { Btn, Icon, Sheet, T, done, useTheme, weekday } from '../ui';
import { stampArt } from '../catalog';
import { openComposer, type ComposeTarget } from '../community';

export function BragSheet({ event, onClose }: { event: TripEvent | null; onClose: () => void }) {
  const open = event?.kind === 'summary';
  return <Sheet open={!!open} onClose={onClose} full>{open && event && <Brag event={event} onShare={(c) => { onClose(); setTimeout(() => openComposer(c), 300); }} />}</Sheet>;
}

function Brag({ event, onShare }: { event: TripEvent; onShare: (c: ComposeTarget) => void }) {
  const t = useTheme();
  const card = useRef<any>(null); // RN 0.88의 View 참조 타입이 view-shot 타입과 달라서 any
  const [busy, setBusy] = useState<'' | 'share' | 'save'>('');
  const s = event.payload as { stamps?: number; rare?: number; km?: number | null; places?: string[] };
  const d = new Date(event.created_at);
  const visited = (s.places ?? []).map((id) => place(id)).filter(Boolean);

  const shot = () => captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' });

  const share = async () => {
    setBusy('share');
    try { await Sharing.shareAsync(await shot(), { mimeType: 'image/png', dialogTitle: '오늘 우리 가족 나들이' }); }
    catch (e: any) { Alert.alert('공유하지 못했어요', e?.message); }
    finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('save');
    try {
      const p = await requestPermissionsAsync(true);
      if (!p.granted) { Alert.alert('사진첩 권한이 필요해요', '설정 → 앱 → 마일스탬프 → 사진 및 동영상에서 허용해 주세요.'); return; }
      await Asset.create(await shot());
      done();
      Alert.alert('사진첩에 저장했어요');
    } catch (e: any) { Alert.alert('저장하지 못했어요', e?.message); }
    finally { setBusy(''); }
  };

  const shown = visited.slice(0, 3);
  const more = visited.length - shown.length;
  const route = visited.length ? `${visited.map((p) => p!.name).join(' → ')} → 집` : '';
  const km = s.km != null ? Math.round(s.km) : null;
  const n = s.stamps ?? 0;
  // 도장 크기: 1~3개를 겹쳐 '찍힌' 느낌 (살짝 기울임)
  const D = shown.length <= 1 ? 128 : shown.length === 2 ? 112 : 96;
  const TILT = ['-8deg', '5deg', '-3deg'];

  return (
    <View style={{ paddingBottom: 6 }}>
      {/* 캡처되는 카드 — 테마와 상관없이 늘 같은 색 (공유 이미지가 다크 모드에 따라 바뀌지 않게): 노을 풍경 + 종이색 */}
      <View ref={card} collapsable={false} style={{ backgroundColor: BRAND.bg, borderRadius: 28, overflow: 'hidden', borderWidth: t.dark ? 0 : 1, borderColor: BRAND.line }}>
        <View style={{ height: 150 }}>
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
            <Landscape scene="dusk" height={150} bg={BRAND.bg} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingTop: 22 }}>
            <View style={{ width: 20, height: 20, borderRadius: R.sm, borderWidth: 2.5, borderColor: BRAND.ink }} />
            <T v="label" style={{ color: BRAND.fg, fontSize: 14 }}>마일스탬프</T>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.point, marginLeft: -4, marginTop: -10 }} />
          </View>
          <T v="cap" style={{ color: BRAND.sub, marginTop: 10, paddingHorizontal: 24 }}>
            {d.getMonth() + 1}월 {d.getDate()}일 {weekday(d)}요일 · 우리 가족 나들이
          </T>
        </View>

        <View style={{ paddingHorizontal: 24, paddingBottom: 22, marginTop: -6 }}>
          <T v="display" style={{ color: BRAND.fg, fontSize: 34, lineHeight: 42 }}>
            {n > 0 ? <>오늘 도장{'\n'}{n}개 쾅!</> : <>오늘도{'\n'}잘 다녀왔어요</>}
          </T>

          {shown.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18, paddingLeft: 4 }}>
              {shown.map((p, i) => (
                <View key={p!.id} style={{ marginLeft: i ? -D * 0.18 : 0, transform: [{ rotate: TILT[i] }], zIndex: 10 - i }}>
                  <Image source={stampArt(p!.id)} style={{ width: D, height: D }} />
                </View>
              ))}
              {more > 0 && (
                <View style={{ marginLeft: 8, backgroundColor: BRAND.chip, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <T v="label" style={{ color: BRAND.sub }}>+{more}</T>
                </View>
              )}
            </View>
          )}

          {!!route && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 16 }}>
              <Icon name="route" size={16} color={BRAND.ink} style={{ marginTop: 3 }} />
              <T v="body" style={{ flex: 1, color: BRAND.fg, fontFamily: F.b }}>{route}</T>
            </View>
          )}

          <View style={{ flexDirection: 'row', marginTop: 16, borderTopWidth: 1, borderTopColor: BRAND.line, paddingTop: 14 }}>
            <Stat n={n} label="도장" />
            {!!s.rare && <Stat n={s.rare} label="희귀 도장" />}
            {km != null && <Stat n={km} unit="km" label="오늘 달린 길" />}
          </View>
          <T v="cap" style={{ color: BRAND.mute, marginTop: 18, fontFamily: F.m }}>차가 직접 찍어 준 우리 가족 여행 도장</T>
        </View>
      </View>

      <Btn title="이미지로 공유" icon="share-2" kind="accent" busy={busy === 'share'} disabled={!!busy && busy !== 'share'} onPress={share} style={{ marginTop: 16 }} />
      <Btn title="사진첩에 저장" icon="download" kind="soft" busy={busy === 'save'} disabled={!!busy && busy !== 'save'} onPress={save} style={{ marginTop: 10 }} />
      {/* 함께에 올리기: 들른 곳 이름 + 도장 수 + 한마디 (지도·경로·km 없음) */}
      {visited.length > 0 && !event.id.startsWith('local-') && (
        <Btn title="함께에 올리기" icon="users" kind="soft" disabled={!!busy}
          onPress={() => onShare({ kind: 'trip', eventId: event.id, places: visited.map((p) => p!.name), stamps: n })} style={{ marginTop: 10 }} />
      )}
    </View>
  );
}

function Stat({ n, unit, label }: { n: number; unit?: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
        <T v="num" style={{ color: BRAND.fg }}>{n}</T>
        {!!unit && <T v="cap" style={{ color: BRAND.sub }}>{unit}</T>}
      </View>
      <T v="cap" style={{ color: BRAND.sub }}>{label}</T>
    </View>
  );
}
