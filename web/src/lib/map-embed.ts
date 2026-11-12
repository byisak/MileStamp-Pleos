// 지도 한 벌의 약속 (순수 함수만 — 브라우저·node 시험 둘 다에서 돈다).
// 폰 앱 WebView는 우리 주소의 /embed/map 을 열고, 이 파일의 모양대로 말을 주고받는다.
//  1) 지도 페이지가 준비되면 → 앱에 {type:'ready', engine:'kakao'|'leaflet'}
//  2) 앱이 → window.msMap.init({...EmbedInit}) 를 주입 (injectJavaScript)
//  3) 지도에서 일이 생기면 → 앱에 {type:'pick', lat, lng} (핀 옮김) / {type:'select', id} (점 누름, 빈 곳이면 null)
//     / {type:'longpress', lat, lng} (init longpress:true일 때 지도를 0.55초 길게 누름 — 그 자리에 표시 핀도 꽂는다)
//  4) 앱이 더 시킬 일: msMap.setPos(lat,lng) · msMap.select(id) · msMap.setPolylines([...])
//     · msMap.setMark(lat,lng[,move]) / msMap.setMark(null) (고른 곳 표시 핀, move면 그리로 옮겨 확대)
// 카카오 지도 JS 키는 원래 공개용(카카오에 등록한 주소에서만 동작). REST·관리자 키는 절대 여기로 오지 않는다.

export type LatLng = [number, number];
export type DotColor = "g" | "r" | "n";
/**
 * 점 하나. label = 점 안 글자(코스 순서 '1'·'2', 출발 '출발' — 4자까지, 화면엔 글자로만 넣는다)
 * · big = 크게(중심 곳) · tag = 점 아래 작은 이름표('중심', 8자까지)
 */
export type Dot = { id: string; lat: number; lng: number; c: DotColor; label?: string; big?: boolean; tag?: string };
/**
 * 선 모양. go = 가는 길 · back = 오는 길(집으로 오는 마지막 구간) — 코스 지도에선 구간마다 색(LEG_COLORS) + 흐르는 ›
 * (예전엔 go 초록·back 파랑 + 화살표 점이었다)
 * · direct = 바로 가는 길(회색 짧은 점선, 비교용 — 위에 옅게) · via = 옛 이름(가는 길과 같은 초록, 화살표 없음)
 */
export type LineStyle = "via" | "go" | "back" | "direct";
/**
 * leg = 몇 번째 구간인지(0부터, 출발→1번 곳이 0) · min = 그 구간 운전 시간(분, '시간 보기' 말풍선).
 * 둘 다 없어도 된다(옛 폰 앱) — leg가 없으면 바로 가는 길(direct)을 뺀 선 순서로 센다.
 */
export type Polyline = { points: LatLng[]; style: LineStyle; leg?: number; min?: number };
export type EmbedMode = "pick" | "explore" | "route";

export type EmbedInit = {
  mode: EmbedMode;
  dark: boolean;
  /** pick: 핀 처음 자리 (없으면 대구 북구청) */
  pin: LatLng | null;
  dots: Dot[];
  home: LatLng | null;
  /** explore: 거리·지역 제한이 없으면 한반도 전체로 시작 */
  korea: boolean;
  /** 가까운 점 묶기 (explore 기본 켬, route 기본 끔) */
  cluster: boolean;
  polylines: Polyline[];
  /** 길게 누르면 {type:'longpress'} 보내기 (직접 찾기 지도) */
  longpress: boolean;
  /** 처음부터 꽂아 둘 표시 핀 (고른 곳) */
  mark: LatLng | null;
  /** 작은 지도: 점 이름표(tag) 빼고 화살표는 구간마다 하나 */
  compact: boolean;
};

export type EmbedOut =
  | { type: "ready"; engine: "kakao" | "leaflet" }
  | { type: "pick"; lat: number; lng: number }
  | { type: "select"; id: string | null }
  | { type: "longpress"; lat: number; lng: number }
  | { type: "error"; message: string };

/** 길게 누름: 이만큼 누르고 있으면 (ms) · 이만큼 움직이면 끌기로 보고 취소 (px) */
export const LONGPRESS_MS = 550;
export const LONGPRESS_SLOP = 10;

/** 점 색 (우리 도장 초록 · 이번 주말 빨강 · 그 밖 회색) — 폰 ExploreMap 범례와 같은 값 */
export const DOT_COLOR: Record<DotColor, string> = { g: "#1F9D55", r: "#E5484D", n: "#8A877F" };
/**
 * 선 색·굵기 — 폰 지도 아래 범례(phone/src/mapEmbed.ts LINE_COLOR)와 같은 값이어야 한다 (시험이 비교).
 * 가는 길·오는 길은 흰 테두리(casing)를 깔아 지도 위에서 또렷하게, 바로 가는 길은 맨 위에 옅은 점선.
 */
export const LINE: Record<LineStyle, { color: string; weight: number; dashed: boolean; opacity: number; arrows: boolean }> = {
  via: { color: "#1F9D55", weight: 4, dashed: false, opacity: 0.95, arrows: false },
  go: { color: "#1F9D55", weight: 4, dashed: false, opacity: 0.95, arrows: true },
  back: { color: "#2F6FDE", weight: 4, dashed: false, opacity: 0.95, arrows: true },
  direct: { color: "#5F5C55", weight: 3, dashed: true, opacity: 0.75, arrows: false },
};
/** 그리는 순서(아래 → 위): 오는 길 → 가는 길 → 바로 가는 길(비교선은 겹쳐도 보이게 맨 위) */
export const LINE_Z: Record<LineStyle, number> = { back: 1, via: 2, go: 2, direct: 3 };

/**
 * 구간 색 (코스 지도 A-1): 채도를 낮춘 차분한 색을 구간 순서대로. 집으로 오는 마지막 구간(back)은 늘 파랑.
 * 폰 시간표(phone/src/mapEmbed.ts LEG_COLORS)와 같은 값이어야 한다 (시험이 비교).
 * 앞 3개 + 파랑이 기본 4색, 곳이 많으면 뒤 2개(장미·청록)까지 — 모두 6색.
 */
export const LEG_COLORS = ["#2f9e6e", "#e0913a", "#8a6fd6", "#4a7fd9", "#c46a86", "#3d9aa6"] as const;
export const LEG_HOME_COLOR = LEG_COLORS[3];
const GO_COLORS = [LEG_COLORS[0], LEG_COLORS[1], LEG_COLORS[2], LEG_COLORS[4], LEG_COLORS[5]];
/** 구간 i의 색 (back = 집으로 오는 마지막 구간 → 파랑, 나머지는 파랑을 빼고 순서대로 돈다) */
export function legColor(i: number, back: boolean): string {
  return back ? LEG_HOME_COLOR : GO_COLORS[((i % GO_COLORS.length) + GO_COLORS.length) % GO_COLORS.length];
}
/** 구간 선인가 (가는 길·오는 길·옛 via). 바로 가는 길(direct)은 비교선이라 구간이 아님 */
export const isLegLine = (l: Polyline) => l.style !== "direct";
/**
 * 선마다 구간 번호와 색. 구간 선이 아니면 null.
 * leg가 있으면 그 값, 없으면(옛 폰) 구간 선 순서대로 0·1·2… — 폰은 늘 출발→곳→…→집 순서로 보낸다.
 */
export function legInfo(lines: Polyline[]): ({ leg: number; color: string } | null)[] {
  let n = 0;
  return lines.map((l) => {
    if (!isLegLine(l)) return null;
    const leg = l.leg ?? n;
    n++;
    return { leg, color: legColor(leg, l.style === "back") };
  });
}
/** 번호 점 k(1부터)의 색 = 그곳에 도착하는 구간(k-1)의 색. 그런 구간이 없으면 순서 색 */
export function stopColor(k: number, lines: Polyline[]): string {
  const info = legInfo(lines);
  for (let i = 0; i < lines.length; i++) if (info[i]?.leg === k - 1) return info[i]!.color;
  return legColor(k - 1, false);
}
/** 번호 점인가 ('1'·'2'… — '출발' 같은 글자는 아님) → 번호, 아니면 null */
export function stopNumber(d: Dot): number | null {
  return d.label && /^[1-9]\d?$/.test(d.label) ? Number(d.label) : null;
}
/** 구간 시간 말풍선 글 (59 → '59분', 75 → '1시간 15분') */
export function minText(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}시간${m ? ` ${m}분` : ""}` : `${m}분`;
}
export const DAEGU: LatLng = [35.8858, 128.5828];
export const KOREA_BOUNDS: [LatLng, LatLng] = [[33.15, 125.4], [38.45, 129.6]];

const MAX_DOTS = 3000;
const MAX_LINES = 20;
const MAX_LINE_POINTS = 20000;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** [lat, lng] 또는 {lat, lng} → [lat, lng]. 범위 밖·숫자 아님은 null */
export function toLatLng(v: unknown): LatLng | null {
  let a: unknown, b: unknown;
  if (Array.isArray(v)) [a, b] = v;
  else if (v && typeof v === "object") ({ lat: a, lng: b } = v as { lat?: unknown; lng?: unknown });
  else return null;
  const lat = num(a), lng = num(b);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

export function parseDots(v: unknown): Dot[] {
  if (!Array.isArray(v)) return [];
  const out: Dot[] = [];
  for (const d of v) {
    if (out.length >= MAX_DOTS) break;
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const p = toLatLng(o);
    if (!p || typeof o.id !== "string" || !o.id || o.id.length > 200) continue;
    const c: DotColor = o.c === "g" || o.c === "r" ? o.c : "n";
    const dot: Dot = { id: o.id, lat: p[0], lng: p[1], c };
    const label = cleanText(o.label, 4);
    if (label) dot.label = label;
    if (o.big === true) dot.big = true;
    const tag = cleanText(o.tag, 8);
    if (tag) dot.tag = tag;
    out.push(dot);
  }
  return out;
}

export function parsePolylines(v: unknown): Polyline[] {
  if (!Array.isArray(v)) return [];
  const out: Polyline[] = [];
  let budget = MAX_LINE_POINTS;
  for (const l of v) {
    if (out.length >= MAX_LINES || budget <= 0) break;
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    if (!Array.isArray(o.points)) continue;
    const points: LatLng[] = [];
    for (const p of o.points) {
      if (points.length >= budget) break;
      const q = toLatLng(p);
      if (q) points.push(q);
    }
    if (points.length < 2) continue;
    budget -= points.length;
    const style: LineStyle = o.style === "direct" || o.style === "go" || o.style === "back" ? o.style : "via";
    const line: Polyline = { points, style };
    // 이상한 값은 없는 것으로 (옛 폰처럼 순서로 센다)
    if (typeof o.leg === "number" && Number.isInteger(o.leg) && o.leg >= 0 && o.leg < MAX_LINES) line.leg = o.leg;
    if (typeof o.min === "number" && Number.isFinite(o.min) && o.min >= 1 && o.min <= 1440) line.min = Math.round(o.min);
    out.push(line);
  }
  return out;
}

/** 앱이 보낸 init 값을 믿지 않고 다시 다듬는다. 모양이 틀리면 null */
export function parseInit(raw: unknown): EmbedInit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const mode: EmbedMode | null = o.mode === "pick" || o.mode === "explore" || o.mode === "route" ? o.mode : null;
  if (!mode) return null;
  return {
    mode,
    dark: o.dark === true || o.theme === "dark",
    pin: toLatLng(o.pin ?? o.center) ?? (mode === "pick" ? DAEGU : null),
    dots: parseDots(o.dots ?? o.markers),
    home: toLatLng(o.home),
    korea: o.korea === true,
    cluster: typeof o.cluster === "boolean" ? o.cluster : mode === "explore",
    polylines: parsePolylines(o.polylines),
    longpress: o.longpress === true,
    mark: toLatLng(o.mark),
    compact: o.compact === true,
  };
}

/** 점 글자 다듬기: 글자만, 줄바꿈·제어 문자 빼고 앞뒤 공백 자르고 max자까지 (없거나 빈 글이면 null). 화면에 넣을 땐 escapeHtml/textContent */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = [...v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "").trim()].slice(0, max).join("");
  return s || null;
}

/** 점 한 개의 HTML (카카오 CustomOverlay·Leaflet divIcon 공용). 글자는 모두 escapeHtml — 앱이 보낸 글이 태그가 되지 않게 */
/** ring = 코스 지도 번호 점: 흰 동그라미 + 구간 색 테두리·글자 (색은 우리 상수만 — legColor) */
export function dotHtml(d: Dot, sel: string | null, compact = false, ring: string | null = null): string {
  const cls = ["d"];
  if (d.id === sel) cls.push("s");
  if (d.label) cls.push("n");
  if (d.big) cls.push("l");
  if (ring) cls.push("r");
  const label = d.label ? `<b>${escapeHtml(d.label)}</b>` : "";
  const tag = d.tag && !compact ? `<i>${escapeHtml(d.tag)}</i>` : "";
  const style = ring ? `background:#fff;border-color:${ring};color:${ring}` : `background:${DOT_COLOR[d.c]}`;
  return `<div class="${cls.join(" ")}" style="${style}" data-id="${escapeHtml(d.id)}">${label}${tag}</div>`;
}

/** 방향 화살표 자리: 선 위 같은 간격 n곳 (구간 길이 기준) + 화면 방향(도, 0 = 오른쪽, 시계 방향 +). 메르카토르로 위도 늘어남을 맞춤 */
export type ArrowMark = { lat: number; lng: number; deg: number };
export function arrowMarks(points: LatLng[], n: number): ArrowMark[] {
  if (points.length < 2 || n < 1) return [];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) { const d = distanceM(points[i - 1], points[i]); seg.push(d); total += d; }
  if (total <= 0) return [];
  const out: ArrowMark[] = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const want = (total * (k + 0.5)) / n;
    while (i < seg.length - 1 && acc + seg[i] < want) { acc += seg[i]; i++; }
    const a = points[i], b = points[i + 1];
    const t = seg[i] > 0 ? Math.min(1, Math.max(0, (want - acc) / seg[i])) : 0;
    out.push({ lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t, deg: screenDeg(a, b) });
  }
  return out;
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
/** a → b 의 화면 방향 (도). 화면은 y가 아래로 커서 위도가 오르면 음수 쪽 */
export function screenDeg(a: LatLng, b: LatLng): number {
  const dx = ((b[1] - a[1]) * Math.PI) / 180;
  const dy = -(mercY(b[0]) - mercY(a[0]));
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 0; // -0 → 0
}

/** 선마다 화살표 수: 화살표 선(가는·오는 길) 전체 길이에 맞춰 나누고 선마다 1~4개 (작은 지도는 1개) */
export function arrowCounts(lines: Polyline[], compact: boolean): number[] {
  const len = lines.map((l) => (LINE[l.style].arrows ? lineLength(l.points) : 0));
  const total = len.reduce((a, b) => a + b, 0);
  return len.map((x) => (x <= 0 ? 0 : compact ? 1 : Math.max(1, Math.min(4, Math.round((x / total) * 8)))));
}

export function lineLength(points: LatLng[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += distanceM(points[i - 1], points[i]);
  return s;
}

/** 주소 # 뒤 init=… (브라우저에서 바로 열어 볼 때·화면 캡처용) */
export function initFromHash(hash: string): EmbedInit | null {
  const m = /(?:^#|&)init=([^&]+)/.exec(hash);
  if (!m) return null;
  try { return parseInit(JSON.parse(decodeURIComponent(m[1]))); } catch { return null; }
}

/** 카카오 JS 키 모양 (32자리 16진수가 보통). 이상하면 키가 없는 것으로 → Leaflet */
export function kakaoKeyOk(key: string | undefined | null): key is string {
  return !!key && /^[A-Za-z0-9]{16,64}$/.test(key);
}

export function kakaoSdkUrl(key: string): string {
  return `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services,clusterer`;
}

/** 앱 → 지도로 보낼 자바스크립트 한 줄 (injectJavaScript). JSON 안 '<'·줄바꿈 문자를 풀어 써서 스크립트가 깨지지 않게 */
export function jsCall(fn: "init" | "setPos" | "select" | "setPolylines" | "setMark", ...args: unknown[]): string {
  const a = args.map((x) => safeJson(x)).join(",");
  return `window.msMap&&window.msMap.${fn}(${a});true;`;
}

export function safeJson(v: unknown): string {
  return (JSON.stringify(v) ?? "null").replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** 묶음 색: 안에 초록이 하나라도 있으면 초록, 아니면 빨강, 아니면 회색 */
export function clusterColor(cs: DotColor[]): DotColor {
  let c: DotColor = "n";
  for (const x of cs) { if (x === "g") return "g"; if (x === "r") c = "r"; }
  return c;
}

export function clusterSize(n: number): number {
  return n < 10 ? 32 : n < 50 ? 38 : 44;
}

/** 지도 위 두 점 거리 (m) */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 원 오른쪽 가장자리 (반경 손잡이 자리) */
export function eastEdge(lat: number, lng: number, r: number): LatLng {
  return [lat, lng + r / 111320 / Math.cos((lat * Math.PI) / 180)];
}

/** Leaflet 확대 단계 ↔ 카카오 지도 레벨 (카카오 1 = 가장 가까이, 14 = 가장 멀리) */
export const kakaoLevel = (zoom: number) => Math.max(1, Math.min(14, Math.round(20 - zoom)));
