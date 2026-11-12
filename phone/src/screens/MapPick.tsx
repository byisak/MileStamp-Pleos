// 지도에서 한 곳 고르기 — 집 위치·오늘 도착지(할머니 집 등). 카카오 지도(키가 없거나 안 되면 OpenStreetMap), 핀을 끌거나 지도를 눌러 옮긴다.
// 지도는 우리 서버의 /embed/map 을 WebView로 연다(MapWeb). '지금 위치'는 expo-location(앱 쓰는 동안만).
// 좌표는 서버가 소수 셋째 자리(약 100m)로 깎아 저장하니 화면에도 그렇게 알린다. 지도 그림은 인터넷이 있어야 보인다.
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Alert } from '../alert';
import { MapWeb, type MapWebHandle } from '../MapWeb';
import type { MapInit } from '../mapEmbed';
import { F } from '../theme';
import { Btn, Icon, Sheet, T, tick, useTheme } from '../ui';

/** 대구 북구청 — 처음 지도의 가운데(집을 아직 모를 때) */
const DAEGU: [number, number] = [35.8858, 128.5828];

/** 소수 셋째 자리로 (서버 저장과 같게) */
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** 지금 위치 한 번 (권한은 이때 묻는다). 실패하면 null */
export async function currentSpot(): Promise<[number, number] | null> {
  try {
    let p = await Location.getForegroundPermissionsAsync();
    if (!p.granted && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
    if (!p.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
    const pos = last ?? await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((res) => setTimeout(() => res(null), 8000)),
    ]).catch(() => null);
    return pos ? [pos.coords.latitude, pos.coords.longitude] : null;
  } catch { return null; }
}

/**
 * 지도 고르기 시트. [start]가 없으면 지금 위치(되면) → 대구 북구청에서 시작.
 * onPick(lat, lng)은 '여기로 정하기'를 눌렀을 때 한 번 (좌표는 셋째 자리로 깎아서).
 */
export function MapPickSheet({ open, onClose, title, sub, start, onPick }: {
  open: boolean; onClose: () => void; title: string; sub?: string; start?: [number, number] | null; onPick: (lat: number, lng: number) => void;
}) {
  const t = useTheme();
  const web = useRef<MapWebHandle>(null);
  const ready = useRef(false);
  const [engine, setEngine] = useState<'kakao' | 'leaflet' | null>(null);
  const [at, setAt] = useState<[number, number] | null>(null);
  const [first, setFirst] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);

  // 열 때마다 시작 위치를 정한다 (지도는 시작 위치로 한 번 만들고, 지금 위치가 늦게 오면 핀만 옮긴다)
  useEffect(() => {
    ready.current = false;
    if (!open) { setFirst(null); setAt(null); setEngine(null); return; }
    if (start) { setFirst(start); return; }
    let live = true;
    setFirst(DAEGU);
    currentSpot().then((p) => {
      if (!live || !p) return;
      if (ready.current) web.current?.setPos(p[0], p[1]);
      else setFirst(p);
    });
    return () => { live = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const init = useMemo<MapInit | null>(() => (first ? { mode: 'pick', theme: t.dark ? 'dark' : 'light', pin: first } : null), [first, t.dark]);

  const here = async () => {
    tick();
    setLocating(true);
    const p = await currentSpot();
    setLocating(false);
    if (!p) { Alert.alert('위치를 알 수 없어요', '휴대폰 설정에서 마일스탬프의 위치 권한을 켜 주세요.'); return; }
    web.current?.setPos(p[0], p[1]);
  };

  return (
    <Sheet open={open} onClose={onClose} full>
      <T v="title">{title}</T>
      <T v="sub" c="ink3" style={{ marginTop: 4, marginBottom: 10 }}>{sub ?? '핀을 끌거나 지도를 눌러 옮겨요'}</T>
      <View style={{ height: 330, borderRadius: 16, overflow: 'hidden', backgroundColor: t.fill }}>
        {!!init && (
          <MapWeb ref={web} init={init}
            onEngine={(e) => { ready.current = true; setEngine(e); }}
            onMsg={(m) => { if (m.type === 'pick') setAt([m.lat, m.lng]); }} />
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <Icon name="map-pin" size={14} color={t.ink3} />
        <T v="cap" c="ink3" style={{ flex: 1, fontVariant: ['tabular-nums'] }}>
          {at ? `${round3(at[0]).toFixed(3)}, ${round3(at[1]).toFixed(3)} · 약 100m 단위로만 저장해요` : '지도를 불러오는 중…'}
        </T>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Btn title="지금 위치" icon="locate-fixed" kind="soft" busy={locating} onPress={here} style={{ flex: 1 }} />
        <Btn title="여기로 정하기" icon="check" disabled={!at} onPress={() => { if (at) onPick(round3(at[0]), round3(at[1])); }} style={{ flex: 1.4 }} />
      </View>
      {engine === 'leaflet' && <T v="cap" c="ink3" style={{ marginTop: 8, fontFamily: F.m }}>지도 © OpenStreetMap 기여자</T>}
    </Sheet>
  );
}
