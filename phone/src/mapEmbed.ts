// 지도 WebView와 주고받는 말 (순수 함수 — RN 없이 web 시험이 그대로 불러 쓴다: web/src/lib/map-embed.test.ts).
// 지도는 우리 서버 주소 /embed/map 에서 연다 (카카오 지도 JS 키는 등록한 주소에서만 돌아서 앱 안 HTML로는 안 됨).
// 1) 지도 → {type:'ready', engine} 2) 앱 → msMap.init(설정) 3) 지도 → {type:'pick',lat,lng} / {type:'select',id}
//    / {type:'longpress',lat,lng}(init longpress:true일 때) 4) 앱 → msMap.setMark(lat,lng,move) · setMark(null) (고른 곳 표시 핀)
// 자세한 약속은 web/src/lib/map-embed.ts 맨 위.

export type LatLng = [number, number];
/** label = 점 안 글자(코스 순서 '1'·'출발', 4자까지) · big = 크게(중심 곳) · tag = 점 아래 작은 이름표('중심') */
export type MapDot = { id: string; lat: number; lng: number; c: 'g' | 'r' | 'n'; label?: string; big?: boolean; tag?: string };
/**
 * go = 가는 길 · back = 오는 길(집으로 오는 마지막 구간) · direct = 바로 가는 길(회색 짧은 점선, 비교) · via = 옛 이름.
 * 코스 지도는 구간마다 색(LEG_COLORS) + 선 안에서 흐르는 › — leg = 몇 번째 구간(0부터, 출발→1번 곳이 0),
 * min = 그 구간 운전 시간(분, 지도의 '시간 보기' 말풍선). 둘 다 없으면 지도가 선 순서로 센다(옛 앱).
 */
export type MapLine = { points: LatLng[]; style: 'via' | 'go' | 'back' | 'direct'; leg?: number; min?: number };
/** 선 색 — 바로 가는 길(비교) 범례. go·back은 예전 한 색(지금 지도는 구간 색 LEG_COLORS). 지도 페이지 LINE과 같아야 한다 (web 시험이 비교) */
export const LINE_COLOR = { go: '#1F9D55', back: '#2F6FDE', direct: '#5F5C55' } as const;
/**
 * 구간 색 — 지도 페이지(web/src/lib/map-embed.ts LEG_COLORS)와 같은 값을 그대로 옮겨 둔 것 (공유 패키지가 없어서, web 시험이 비교).
 * 가는 구간은 0·1·2·4·5번을 차례로 돌고, 집으로 오는 마지막 구간은 늘 3번(파랑).
 */
export const LEG_COLORS = ['#2f9e6e', '#e0913a', '#8a6fd6', '#4a7fd9', '#c46a86', '#3d9aa6'] as const;
const GO_COLORS = [LEG_COLORS[0], LEG_COLORS[1], LEG_COLORS[2], LEG_COLORS[4], LEG_COLORS[5]];
/** 구간 i의 색 (지도 페이지 legColor와 같은 규칙) */
export const legColor = (i: number, back: boolean): string => (back ? LEG_COLORS[3] : GO_COLORS[((i % 5) + 5) % 5]);
export type MapInit = {
  mode: 'pick' | 'explore' | 'route';
  theme: 'dark' | 'light';
  pin?: LatLng | null;
  dots?: MapDot[];
  home?: LatLng | null;
  korea?: boolean;
  cluster?: boolean;
  polylines?: MapLine[];
  /** 길게 누르면 {type:'longpress'} (직접 찾기 지도) */
  longpress?: boolean;
  /** 표시 핀 (고른 곳) */
  mark?: LatLng | null;
  /** 작은 지도: 점 이름표 빼고 화살표는 구간마다 하나 */
  compact?: boolean;
};
export type MapMsg =
  | { type: 'ready'; engine: 'kakao' | 'leaflet' }
  | { type: 'pick'; lat: number; lng: number }
  | { type: 'select'; id: string | null }
  | { type: 'longpress'; lat: number; lng: number }
  | { type: 'error'; message: string };

export const embedUrl = (base: string) => `${base.replace(/\/+$/, '')}/embed/map`;

const safeJson = (v: unknown) =>
  (JSON.stringify(v) ?? 'null').replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** injectJavaScript 로 넣을 한 줄 */
export const mapCall = (fn: 'init' | 'setPos' | 'select' | 'setPolylines' | 'setMark', ...args: unknown[]) =>
  `window.msMap&&window.msMap.${fn}(${args.map(safeJson).join(',')});true;`;

/** 지도에서 온 말 읽기. 모르는 모양이면 null */
export function readMapMsg(data: string): MapMsg | null {
  let o: any;
  try { o = JSON.parse(data); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'ready' && (o.engine === 'kakao' || o.engine === 'leaflet')) return { type: 'ready', engine: o.engine };
  if (o.type === 'pick' && Number.isFinite(o.lat) && Number.isFinite(o.lng)) return { type: 'pick', lat: o.lat, lng: o.lng };
  if (o.type === 'longpress' && Number.isFinite(o.lat) && Number.isFinite(o.lng)) return { type: 'longpress', lat: o.lat, lng: o.lng };
  if (o.type === 'select') return { type: 'select', id: typeof o.id === 'string' ? o.id : null };
  if (o.type === 'error') return { type: 'error', message: String(o.message ?? '') };
  return null;
}
