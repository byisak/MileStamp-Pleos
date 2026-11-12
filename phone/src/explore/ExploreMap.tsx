// '지도로 보기' (시안 C) — 축제·100선·직접 찾기 공용. MapPick.tsx와 같은 방식: 우리 서버 /embed/map 을 WebView로(MapWeb),
// 카카오 지도(키가 없거나 안 되면 OpenStreetMap). 지도 그리기는 web/src/app/embed/map/engines.ts 한 곳.
// - 마커 색: 우리 도장 초록 · 이번 주말 빨강 · 그 밖 회색. 가까이 겹치면 묶음(숫자, 카카오는 MarkerClusterer · OSM은 화면 칸 48px)
//   묶음을 누르면 그 곳들이 보이게 확대. 집은 집 아이콘(누를 수 없음)
// - 처음 화면: 고른 거리·지역 곳들 + 집에 맞춤, 거리·지역 제한이 없으면 한반도 전체
// - 마커를 누르면 아래 카드(이름 · 기간 · 차 시간) → '여기 중심으로' = 목록에서 고른 것과 같은 앵커 코스
// - 어둡게: 지도 그림만 CSS 필터로 어둡게, 마커는 그대로
import React, { useEffect, useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { md } from '../catalog';
import { MapWeb } from '../MapWeb';
import type { MapDot, MapInit } from '../mapEmbed';
import { span } from '../plan';
import { F, R, S } from '../theme';
import { Btn, Icon, Sheet, T, tick, useTheme } from '../ui';
import { PlacePhoto } from '../parts/PlacePhoto';
import { regionName, type Item } from './api';

const COLOR = { g: '#1F9D55', r: '#E5484D', n: '#8A877F' } as const;

export const colorOf = (it: Item): keyof typeof COLOR => (it.ourStamp || it.ourPlaceId ? 'g' : it.thisWeekend ? 'r' : 'n');

export function ExploreMap({ open, onClose, title, items, home, korea, onPick }: {
  open: boolean; onClose: () => void; title: string; items: Item[];
  home: { lat: number; lng: number } | null;
  /** 거리·지역 제한이 없으면 한반도 전체로 시작 */
  korea: boolean;
  onPick: (it: Item) => void;
}) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  const [sel, setSel] = useState<string | null>(null);
  const [engine, setEngine] = useState<'kakao' | 'leaflet' | null>(null);
  useEffect(() => { if (!open) { setSel(null); setEngine(null); } }, [open]);

  const byId = useMemo(() => new Map(items.map((x) => [x.id, x])), [items]);
  const init = useMemo<MapInit | null>(() => {
    if (!open) return null;
    const dots: MapDot[] = items.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)).map((x) => ({ id: x.id, lat: x.lat, lng: x.lng, c: colorOf(x) }));
    return { mode: 'explore', theme: t.dark ? 'dark' : 'light', dots, home: home ? [home.lat, home.lng] : null, korea };
  }, [open, items, home?.lat, home?.lng, korea, t.dark]); // eslint-disable-line react-hooks/exhaustive-deps

  const it = sel ? byId.get(sel) ?? null : null;
  const counts = useMemo(() => {
    const c = { g: 0, r: 0, n: 0 };
    for (const x of items) c[colorOf(x)]++;
    return c;
  }, [items]);
  const mapH = Math.max(260, Math.min(560, Math.round(height * 0.56)));

  return (
    <Sheet open={open} onClose={onClose} full>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s }}>
        <T v="title" accessibilityRole="header" style={{ flex: 1 }}>{title}</T>
        <Btn title="목록으로" icon="layout-list" kind="line" small onPress={() => { tick(); onClose(); }} />
      </View>
      {/* 범례 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.l, marginTop: S.s, marginBottom: S.m }}>
        {([['g', '우리 도장'], ['r', '이번 주말'], ['n', '그 밖']] as const).filter(([k]) => counts[k] > 0).map(([k, label]) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR[k] }} />
            <T v="cap" c="ink2">{label} {counts[k]}</T>
          </View>
        ))}
        {home && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Icon name="house" size={13} color={t.ink2} />
            <T v="cap" c="ink2">우리 집</T>
          </View>
        )}
      </View>
      <View style={{ height: mapH, borderRadius: R.lg, overflow: 'hidden', backgroundColor: t.fill }}>
        {!!init && (
          <MapWeb init={init} onEngine={setEngine}
            onMsg={(m) => { if (m.type === 'select') { if (m.id) tick(); setSel(m.id); } }} />
        )}
      </View>
      {/* 아래 카드 */}
      {it ? (
        <View style={{ marginTop: S.m, backgroundColor: t.fill, borderRadius: R.md + 2, padding: S.l, gap: S.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.l }}>
            <PlacePhoto uri={it.image} id={it.ourPlaceId ?? it.id} w={52} h={52} r={R.sm} icon={it.starts ? 'party-popper' : 'map-pin'} />
            <View style={{ flex: 1, gap: S.xxs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR[colorOf(it)] }} />
            <T v="h" numberOfLines={1} style={{ flex: 1 }}>{it.name}</T>
          </View>
          <T v="cap" c="ink3" numberOfLines={2}>
            {[
              it.starts && it.ends ? `${md(it.starts)}~${md(it.ends)}` : it.type ?? null,
              it.driveMin != null ? `차로 ${span(it.driveMin)}` : null,
              it.region ? regionName(it.region) : null,
              it.popular ? `${it.popular}가족이 골랐어요` : null,
            ].filter(Boolean).join(' · ')}
          </T>
            </View>
          </View>
          <Btn title="여기 중심으로" icon="route" kind="accent" onPress={() => onPick(it)} />
        </View>
      ) : (
        <View style={{ marginTop: S.m, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: S.s, paddingHorizontal: S.xxs }}>
          <Icon name="map-pin" size={14} color={t.ink3} />
          <T v="cap" c="ink3" style={{ flex: 1, fontFamily: F.m }}>
            {items.length ? `${items.length}곳 · 점을 누르면 코스를 짤 수 있어요 · 숫자는 여러 곳이 모인 것` : '이 조건에 맞는 곳이 없어요'}
          </T>
        </View>
      )}
      {engine === 'leaflet' && <T v="cap" c="ink3" style={{ marginTop: S.xs, fontFamily: F.m }}>지도 © OpenStreetMap 기여자</T>}
    </Sheet>
  );
}
