// 지도 WebView 한 벌 — 우리 서버의 /embed/map 을 열고(카카오 지도, 안 되면 OpenStreetMap), 준비되면 설정(init)을 넣는다.
// 지도 고르기(MapPick)·지도로 보기(ExploreMap)가 같이 쓴다. 나중에 경로 비교도 polylines 로 같은 자리에.
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import { BASE } from './api';
import { embedUrl, mapCall, readMapMsg, type MapInit, type MapLine, type MapMsg } from './mapEmbed';
import { Btn, Icon, T, useTheme } from './ui';

// RN 0.88 타입과 webview 14의 클래스 타입이 안 맞아서 느슨하게 쓴다 (Dev의 view-shot과 같은 사정)
const WebView = RNWebView as unknown as React.ComponentType<any>;

export type MapWebHandle = {
  setPos: (lat: number, lng: number) => void;
  select: (id: string | null) => void;
  setPolylines: (lines: MapLine[]) => void;
  /** 고른 곳 표시 핀 (null = 치움), move면 그리로 옮겨 확대 */
  setMark: (p: { lat: number; lng: number } | null, move?: boolean) => void;
};

/** init이 바뀌면(밝기·점 목록 등) 다시 넣는다. onEngine으로 카카오/OSM 어느 쪽인지 알려 준다(지도 출처 글씨용) */
export const MapWeb = forwardRef<MapWebHandle, {
  init: MapInit;
  onMsg?: (m: MapMsg) => void;
  onEngine?: (e: 'kakao' | 'leaflet') => void;
  /** 스크롤 화면 안에 놓인 지도: 지도를 만지는 동안 바깥 스크롤이 손가락을 가져가지 않게 */
  nested?: boolean;
}>(function MapWeb({ init, onMsg, onEngine, nested }, ref) {
  const t = useTheme();
  const web = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0);
  // 렌더러가 죽으면(다른 지도가 닫히며 같이 정리되는 등) 빈 칸으로 남으니 두 번까지 다시 띄운다
  const gone = useRef(0);
  const run = (js: string) => web.current?.injectJavaScript(js);

  useImperativeHandle(ref, () => ({
    setPos: (lat, lng) => run(mapCall('setPos', lat, lng)),
    select: (id) => run(mapCall('select', id)),
    setPolylines: (lines) => run(mapCall('setPolylines', lines)),
    setMark: (p, move) => run(p ? mapCall('setMark', p.lat, p.lng, !!move) : mapCall('setMark', null)),
  }), []);

  // 준비된 뒤 설정이 바뀌면 다시 넣기 (처음 한 번은 ready 때)
  const initJson = JSON.stringify(init);
  useEffect(() => { if (ready) run(mapCall('init', init)); }, [ready, initJson]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 }}>
        <Icon name="map" size={22} color={t.ink3} />
        <T v="sub" c="ink3" style={{ textAlign: 'center' }}>지도를 불러오지 못했어요{'\n'}인터넷 연결을 확인해 주세요</T>
        <Btn title="다시 불러오기" icon="refresh-cw" kind="soft" small onPress={() => { setFailed(false); setReady(false); setKey((k) => k + 1); }} />
      </View>
    );
  }

  return (
    <WebView key={key} ref={web} source={{ uri: embedUrl(BASE) }} originWhitelist={['https://*', 'http://*']}
      onMessage={(e: { nativeEvent: { data: string } }) => {
        const m = readMapMsg(e.nativeEvent.data);
        if (!m) return;
        if (m.type === 'ready') { setReady(true); onEngine?.(m.engine); }
        onMsg?.(m);
      }}
      onRenderProcessGone={() => { setReady(false); if (gone.current++ < 2) setKey((k) => k + 1); else setFailed(true); }}
      onError={() => setFailed(true)}
      onHttpError={(e: { nativeEvent: { statusCode: number } }) => { if (e.nativeEvent.statusCode >= 400) setFailed(true); }}
      javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false} nestedScrollEnabled={!!nested}
      style={{ backgroundColor: 'transparent' }} />
  );
});
