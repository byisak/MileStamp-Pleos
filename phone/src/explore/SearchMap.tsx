// '직접 찾기' = 검색창 + 카카오 지도 (docs/검색-거리순-계획.md ②)
// - 지도는 기준 위치 가운데(우리 서버 /embed/map, 안 되면 OpenStreetMap). 집은 집 아이콘
// - 자동완성에서 고르면 지도에 핀 + 아래 카드 '이름 · 차로 ○분 · [여기 중심으로]' (= 목록에서 고른 것과 같은 앵커 코스)
// - 지도를 길게 누르면 그 자리에 핀 → 서버가 좌표 → 주소(카카오) → 같은 카드. 이름 없는 곳도 고를 수 있게 (id 'ext:pin:<lat>,<lng>')
// - 카드의 '여기를 기준으로' = 이곳을 목록 기준 위치('직접 정한 곳')로
import { useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { MapWeb, type MapWebHandle } from '../MapWeb';
import type { MapInit } from '../mapEmbed';
import type { AnchorIn } from '../plan';
import { F, R, S } from '../theme';
import { Btn, Icon, T, tick, useTheme } from '../ui';
import { getReverse, refPoint, type RefLoc, type Suggest } from './api';
import { SearchBox, suggestIcon, suggestSub } from './SearchBox';

/** 고른 곳 → 앵커 (우리 명소면 명소, 그 밖은 바깥 장소 — 이름 40자까지) */
export function anchorOfSuggest(s: Suggest): AnchorIn {
  if (s.kind === 'place') return { kind: 'place', id: s.ourPlaceId ?? s.id, name: s.name, lat: s.lat, lng: s.lng };
  return { kind: 'tour', id: s.id, name: s.name.slice(0, 40), lat: s.lat, lng: s.lng };
}

export function SearchMap({ token, refLoc, home, onAnchor, onSetRef }: {
  token: string | null; refLoc: RefLoc; home: { lat: number; lng: number };
  onAnchor: (a: AnchorIn, driveMin: number | null) => void;
  onSetRef: (r: RefLoc) => void;
}) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  const map = useRef<MapWebHandle>(null);
  const [sel, setSel] = useState<(Suggest & { loading?: boolean }) | null>(null);
  const [engine, setEngine] = useState<'kakao' | 'leaflet' | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const from = refPoint(refLoc);
  const center = from ?? home;
  const init = useMemo<MapInit>(() => ({
    mode: 'explore', theme: t.dark ? 'dark' : 'light', dots: [], cluster: false, longpress: true,
    home: [home.lat, home.lng], pin: [center.lat, center.lng], mark: sel ? [sel.lat, sel.lng] : null,
  }), [t.dark, home.lat, home.lng, center.lat, center.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapH = Math.max(280, Math.min(460, Math.round(height * 0.46)));

  const longpress = async (lat: number, lng: number) => {
    tick();
    setSel({ kind: 'pin', id: '', name: '주소를 찾는 중…', label: '지도에서 고른 곳', addr: '', lat, lng, driveMin: null, loading: true });
    if (!token) return;
    const r = await getReverse(token, lat, lng, from);
    setSel((p) => (p && p.loading && p.lat === lat && p.lng === lng ? r : p));
  };

  return (
    <View style={{ marginTop: S.l }}>
      <SearchBox token={token} from={from} placeholder="장소·주소 (예: 팔공산, 대구 달성군 화원읍)" onFocusChange={setListOpen}
        onPick={(s) => { setSel(s); map.current?.setMark(s, true); }} />
      <View style={{ height: mapH, marginTop: S.m, borderRadius: R.lg, overflow: 'hidden', backgroundColor: t.fill, opacity: listOpen ? 0.5 : 1 }}>
        <MapWeb ref={map} init={init} nested onEngine={setEngine}
          onMsg={(m) => { if (m.type === 'longpress') longpress(m.lat, m.lng); }} />
      </View>
      {sel ? (
        <View style={{ marginTop: S.m, backgroundColor: t.surface, borderRadius: R.lg, padding: S.l, gap: S.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s }}>
            <Icon name={suggestIcon(sel)} size={18} color={sel.kind === 'place' ? t.accent : t.ink2} />
            <T v="h" numberOfLines={1} style={{ flex: 1 }}>{sel.name}</T>
            <Btn title="닫기" kind="line" small onPress={() => { setSel(null); map.current?.setMark(null); }} />
          </View>
          <T v="cap" c="ink3" numberOfLines={2}>{suggestSub(sel)}{sel.kind === 'place' ? ' · 우리 도장' : !sel.loading ? ' · 도장 대신 다녀옴' : ''}</T>
          <View style={{ flexDirection: 'row', gap: S.s }}>
            <Btn title="여기 중심으로" icon="route" kind="accent" disabled={!!sel.loading} style={{ flex: 1 }}
              onPress={() => onAnchor(anchorOfSuggest(sel), refLoc.kind === 'home' ? sel.driveMin : null)} />
            <Btn title="여기를 기준으로" icon="map-pin" kind="soft" disabled={!!sel.loading}
              onPress={() => onSetRef({ kind: 'custom', name: sel.name.slice(0, 40), lat: sel.lat, lng: sel.lng })} />
          </View>
        </View>
      ) : (
        <View style={{ marginTop: S.m, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: S.s, paddingHorizontal: S.xxs }}>
          <Icon name="map-pin" size={14} color={t.ink3} />
          <T v="cap" c="ink3" style={{ flex: 1, fontFamily: F.m }}>위에서 찾거나 지도를 길게 눌러 한 곳을 고르면 그곳 중심으로 코스를 짜 드려요</T>
        </View>
      )}
      {engine === 'leaflet' && <T v="cap" c="ink3" style={{ marginTop: S.xs, fontFamily: F.m }}>지도 © OpenStreetMap 기여자</T>}
    </View>
  );
}
