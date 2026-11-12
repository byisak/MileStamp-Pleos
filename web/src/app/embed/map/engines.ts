// /embed/map 지도 그리기 — 카카오 한 벌 + Leaflet(물러설 때) 한 벌. 같은 Engine 모양이라 EmbedMap은 어느 쪽인지 몰라도 된다.
// 폰 앱의 옛 Leaflet 지도(MapPick·ExploreMap 안 HTML)는 모두 여기로 옮겼다 → 폰 쪽 Leaflet 코드는 이 파일 한 곳.
// 점 글자(코스 순서·'출발'·'중심')는 앱이 보낸 값이라 dotHtml이 escapeHtml로 넣는다(태그가 되지 않게).
// 코스 지도(route, A-1): 구간마다 색(LEG_COLORS) 실선 + 흰 테두리·옅은 그림자, 선 안에서 흐르는 흰 ›(flow.ts),
// 번호 점은 흰 동그라미 + 그곳에 도착하는 구간 색 테두리. '시간 보기'를 켜면 구간 가운데 'N분' 말풍선(A-2).
// 바로 가는 길(direct)은 예전 그대로 맨 위 옅은 회색 짧은 점선.
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  clusterColor, clusterSize, DAEGU, DOT_COLOR, dotHtml, isLegLine, KOREA_BOUNDS, LINE, kakaoLevel, legInfo, stopColor, stopNumber,
  type Dot, type EmbedInit, type EmbedOut, type LatLng, type Polyline,
} from "@/lib/map-embed";
import { FlowLayer, type FlowLeg } from "./flow";

export interface Engine {
  readonly name: "kakao" | "leaflet";
  init(cfg: EmbedInit): void;
  setPos(p: LatLng): void;
  select(id: string | null): void;
  setPolylines(lines: Polyline[]): void;
  /** 고른 곳 표시 핀 (null = 치움). move면 그리로 옮기고 가까이 */
  setMark(p: LatLng | null, move: boolean): void;
  /** 지도 상자 안 화면 점(px) → 좌표 (길게 누름) */
  pointToLatLng(x: number, y: number): LatLng | null;
  /** '시간 보기': 구간 가운데 'N분' 말풍선 켜기·끄기 */
  setChips(on: boolean): void;
  relayout(): void;
  destroy(): void;
}
export type Post = (m: EmbedOut) => void;

const HOUSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
/** 고르기 핀 (물방울 모양, 아래 끝이 그 자리) */
const PIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44"><path d="M17 42C17 42 3 26.5 3 16.5a14 14 0 0 1 28 0C31 26.5 17 42 17 42z" fill="#2C4A3E" stroke="#fff" stroke-width="3"/><circle cx="17" cy="16.5" r="5" fill="#fff"/></svg>';
const PIN_URL = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(PIN_SVG);

const zOf = (d: Dot, sel: string | null) => (d.id === sel ? 1000 : d.c === "g" ? 300 : d.c === "r" ? 200 : 0);

function fromHtml(html: string): HTMLDivElement {
  const w = document.createElement("div");
  w.innerHTML = html; // dotHtml이 만든 것만 (글자는 escapeHtml 됨)
  return w.firstElementChild as HTMLDivElement;
}
function dotEl(d: Dot, sel: string | null, compact = false): HTMLDivElement {
  return fromHtml(dotHtml(d, sel, compact));
}
/** 구간 선 모양 (코스 지도 A-1) — 작은 지도는 조금 가늘게 */
const legStyle = (compact: boolean) => compact ? { w: 5, casing: 8, shadow: 10 } : { w: 6, casing: 10, shadow: 12 };
/** 선 → 구간 선(그리는 순서: 구간 번호 차례, 집으로 오는 길이 맨 위)과 비교선 */
function splitLines(ls: Polyline[]): { legs: (FlowLeg & { leg: number })[]; others: Polyline[] } {
  const info = legInfo(ls);
  const legs: (FlowLeg & { leg: number })[] = [];
  const others: Polyline[] = [];
  ls.forEach((l, i) => {
    const x = info[i];
    if (x && isLegLine(l)) legs.push({ points: l.points, color: x.color, leg: x.leg, ...(l.min != null ? { min: l.min } : {}) });
    else others.push(l);
  });
  legs.sort((a, b) => a.leg - b.leg);
  return { legs, others };
}
/** 코스 지도 번호 점의 테두리 색 (그 밖의 점은 null = 예전 색 동그라미) */
function ringOf(cfg: EmbedInit | null, d: Dot, ls: Polyline[]): string | null {
  if (cfg?.mode !== "route") return null;
  const k = stopNumber(d);
  return k == null ? null : stopColor(k, ls);
}
let chipsWanted = false;
function clusterEl(n: number, c: Dot["c"]): HTMLDivElement {
  const s = clusterSize(n);
  const el = document.createElement("div");
  el.className = "c";
  el.style.cssText = `width:${s}px;height:${s}px;border-color:${DOT_COLOR[c]}`;
  el.textContent = String(n);
  return el;
}
function homeEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "h";
  el.innerHTML = HOUSE; // 고정된 그림만
  return el;
}

/** 맞춰 볼 점들: 점 + 집 + 선 */
function fitPoints(cfg: EmbedInit, lines: Polyline[]): LatLng[] {
  const pts: LatLng[] = cfg.dots.map((d) => [d.lat, d.lng]);
  if (cfg.home) pts.push(cfg.home);
  for (const l of lines) pts.push(...l.points);
  return pts;
}

// ───────────────────────── 카카오 ─────────────────────────

export function kakaoEngine(kakao: any, el: HTMLElement, post: Post): Engine {
  const K = kakao.maps;
  const ll = (p: LatLng) => new K.LatLng(p[0], p[1]);
  let map: any = null;
  let cfg: EmbedInit | null = null;
  let pin: any = null;
  let sel: string | null = null;
  let clusterer: any = null;
  const dots = new Map<string, { d: Dot; ov: any; el: HTMLDivElement }>();
  const byOv = new Map<any, Dot>();
  let home: any = null;
  let lines: any[] = [];
  let lineData: Polyline[] = [];
  let mark: any = null;
  let flow: FlowLayer | null = null;
  let flowOv: any = null;

  const sendPin = () => { const p = pin.getPosition(); post({ type: "pick", lat: p.getLat(), lng: p.getLng() }); };

  /** 흐르는 › 판: AbstractOverlay의 overlayLayer 판에 붙이고, draw()마다 판 위 픽셀로 다시 잰다 */
  function flowOverlay(f: FlowLayer): any {
    function FlowOv(this: any) { /* 판만 */ }
    FlowOv.prototype = new K.AbstractOverlay();
    FlowOv.prototype.onAdd = function (this: any) { this.getPanels().overlayLayer.appendChild(f.root); };
    FlowOv.prototype.onRemove = function () { f.root.remove(); };
    FlowOv.prototype.draw = function (this: any) {
      const proj = this.getProjection();
      if (!proj || !map) return;
      // 판 위 좌표와 지도 상자 좌표의 차이 → 지금 보이는 칸을 판 위 좌표로
      const c = map.getCenter();
      const a = proj.pointFromCoords(c), b = proj.containerPointFromCoords(c);
      const dx = a.x - b.x, dy = a.y - b.y;
      f.redraw((p) => { const q = proj.pointFromCoords(new K.LatLng(p[0], p[1])); return [q.x, q.y]; },
        { x0: dx, y0: dy, x1: dx + el.clientWidth, y1: dy + el.clientHeight });
    };
    return new (FlowOv as any)();
  }
  function paintRings() {
    for (const x of dots.values()) {
      const ring = ringOf(cfg, x.d, lineData);
      if (!ring) continue;
      x.el.classList.add("r");
      x.el.style.background = "#fff";
      x.el.style.borderColor = ring;
      x.el.style.color = ring;
    }
  }

  function restyle(prev: string | null) {
    for (const id of [prev, sel]) {
      const x = id ? dots.get(id) : null;
      if (!x) continue;
      x.el.classList.toggle("s", x.d.id === sel);
      x.ov.setZIndex(zOf(x.d, sel));
    }
  }
  function choose(id: string | null, fromUser: boolean) {
    if (id === sel) return;
    const prev = sel;
    sel = id;
    restyle(prev);
    if (fromUser) post({ type: "select", id });
  }

  function paintClusters(clusters: any[]) {
    for (const c of clusters ?? []) {
      try {
        const cs = (c.getMarkers() as any[]).map((ov) => byOv.get(ov)?.c ?? "n");
        const box = c.getClusterMarker()?.getContent?.();
        if (box instanceof HTMLElement) box.style.borderColor = DOT_COLOR[clusterColor(cs)];
      } catch { /* 묶음 색은 꾸밈일 뿐 */ }
    }
  }

  function drawDots() {
    if (!cfg) return;
    const list: any[] = [];
    for (const d of cfg.dots) {
      const e = dotEl(d, sel, cfg.compact);
      const ov = new K.CustomOverlay({ position: ll([d.lat, d.lng]), content: e, xAnchor: 0.5, yAnchor: 0.5, zIndex: zOf(d, sel), clickable: true });
      e.addEventListener("click", (ev) => { ev.stopPropagation(); choose(d.id, true); });
      dots.set(d.id, { d, ov, el: e });
      byOv.set(ov, d);
      list.push(ov);
    }
    paintRings();
    if (cfg.cluster && K.MarkerClusterer) {
      const base = {
        boxSizing: "border-box", borderRadius: "50%", background: "rgba(17,17,16,.84)", color: "#fff",
        font: "700 13px/1 -apple-system,Roboto,sans-serif", textAlign: "center", border: "3px solid #8A877F",
        boxShadow: "0 1px 4px rgba(0,0,0,.35)",
      };
      const sized = (s: number) => ({ ...base, width: `${s}px`, height: `${s}px`, lineHeight: `${s - 6}px` });
      clusterer = new K.MarkerClusterer({
        map, averageCenter: true, minLevel: 4, gridSize: 48, disableClickZoom: true,
        calculator: [10, 50], styles: [sized(32), sized(38), sized(44)],
      });
      K.event.addListener(clusterer, "clustered", paintClusters);
      K.event.addListener(clusterer, "clusterclick", (c: any) => {
        const b = c.getBounds();
        const sw = b.getSouthWest(), ne = b.getNorthEast();
        if (sw.getLat() === ne.getLat() && sw.getLng() === ne.getLng()) map.setLevel(Math.max(3, map.getLevel() - 3), { anchor: c.getCenter() });
        else { map.setBounds(b, 48, 48, 48, 48); if (map.getLevel() < 3) map.setLevel(3); }
      });
      clusterer.addMarkers(list);
    } else {
      for (const ov of list) ov.setMap(map);
    }
  }

  function fit() {
    if (!cfg) return;
    // 직접 찾기: 점 없이 기준 위치(pin)·고른 곳(mark) 가운데로
    if (!cfg.dots.length && (cfg.mark || cfg.pin)) { map.setCenter(ll((cfg.mark ?? cfg.pin)!)); map.setLevel(cfg.mark ? 5 : kakaoLevel(12)); return; }
    if (cfg.korea) {
      const b = new K.LatLngBounds(ll(KOREA_BOUNDS[0]), ll(KOREA_BOUNDS[1]));
      map.setBounds(b, 0, 0, 0, 0);
      return;
    }
    const pts = fitPoints(cfg, lineData);
    if (!pts.length) { map.setCenter(ll([36.3, 127.8])); map.setLevel(13); return; }
    if (pts.length === 1) { map.setCenter(ll(pts[0])); map.setLevel(kakaoLevel(11)); return; }
    const b = new K.LatLngBounds();
    for (const p of pts) b.extend(ll(p));
    map.setBounds(b, 36, 36, 36, 36);
    const closest = cfg.mode === "route" ? kakaoLevel(15) : kakaoLevel(12);
    if (map.getLevel() < closest) map.setLevel(closest);
  }

  const api: Engine = {
    name: "kakao",
    init(c) {
      cfg = c;
      sel = null;
      const center = c.mode === "pick" ? (c.pin ?? DAEGU) : (c.home ?? DAEGU);
      map = new K.Map(el, { center: ll(center), level: c.mode === "pick" ? kakaoLevel(16) : 8 });
      map.setMaxLevel(13);
      // 확대 움직임 동안 › 판은 숨기고, 멈추면 다시 잰다
      K.event.addListener(map, "zoom_start", () => flow?.show(false));
      K.event.addListener(map, "idle", () => flowOv?.draw());
      K.event.addListener(map, "click", (e: any) => {
        if (cfg?.mode === "pick" && pin) { pin.setPosition(e.latLng); sendPin(); return; }
        if (sel) choose(null, true);
      });
      if (c.mode === "pick") {
        const img = new K.MarkerImage(PIN_URL, new K.Size(34, 44), { offset: new K.Point(17, 43) });
        pin = new K.Marker({ position: ll(center), draggable: true, image: img, map });
        K.event.addListener(pin, "dragend", sendPin);
        api.setPolylines(c.polylines);
        sendPin();
        return;
      }
      if (c.home) {
        // 코스 지도에선 집이 선·화살표 위에 (출발·도착 자리)
        home = new K.CustomOverlay({ position: ll(c.home), content: homeEl(), xAnchor: 0.5, yAnchor: 0.5, zIndex: c.mode === "route" ? 150 : -1000, clickable: false });
        home.setMap(map);
      }
      drawDots();
      api.setPolylines(c.polylines);
      if (c.mark) api.setMark(c.mark, false);
      fit();
    },
    setPos(p) {
      if (!map) return;
      map.setCenter(ll(p));
      map.setLevel(kakaoLevel(16));
      if (pin) { pin.setPosition(ll(p)); sendPin(); }
    },
    select(id) { choose(id, false); },
    setMark(p, move) {
      if (!map) return;
      if (!p) { mark?.setMap(null); mark = null; return; }
      if (!mark) {
        const img = new K.MarkerImage(PIN_URL, new K.Size(34, 44), { offset: new K.Point(17, 43) });
        mark = new K.Marker({ position: ll(p), image: img, zIndex: 2000, map });
      } else mark.setPosition(ll(p));
      if (move) { if (map.getLevel() > 5) map.setLevel(5); map.panTo(ll(p)); }
    },
    pointToLatLng(x, y) {
      if (!map) return null;
      const q = map.getProjection().coordsFromContainerPoint(new K.Point(x, y));
      return q ? [q.getLat(), q.getLng()] : null;
    },
    setPolylines(ls) {
      if (!map) return;
      lineData = ls;
      for (const l of lines) l.setMap(null);
      lines = [];
      flowOv?.setMap(null);
      flow?.destroy();
      flow = null; flowOv = null;
      const { legs, others } = splitLines(ls);
      const st = legStyle(!!cfg?.compact);
      // 옅은 그림자 → (구간마다) 흰 테두리 + 구간 색 — 뒤 구간이 위에, 집으로 오는 길이 맨 위
      for (const g of legs) lines.push(new K.Polyline({ map, path: g.points.map(ll), strokeWeight: st.shadow, strokeColor: "#1b2a22", strokeOpacity: 0.1, strokeStyle: "solid", zIndex: 1 }));
      legs.forEach((g, i) => {
        const path = g.points.map(ll);
        lines.push(new K.Polyline({ map, path, strokeWeight: st.casing, strokeColor: "#ffffff", strokeOpacity: 0.95, strokeStyle: "solid", zIndex: 2 + i * 2 }));
        lines.push(new K.Polyline({ map, path, strokeWeight: st.w, strokeColor: g.color, strokeOpacity: 1, strokeStyle: "solid", zIndex: 3 + i * 2 }));
      });
      for (const l of others) {
        const s = LINE[l.style];
        lines.push(new K.Polyline({
          map, path: l.points.map(ll), strokeWeight: s.weight, strokeColor: s.color, strokeOpacity: s.opacity,
          strokeStyle: s.dashed ? "shortdash" : "solid", zIndex: 100,
        }));
      }
      paintRings();
      if (legs.length) {
        flow = new FlowLayer({ compact: !!cfg?.compact, zIndex: 100 });
        flow.setLegs(legs);
        flow.setChips(chipsWanted);
        flowOv = flowOverlay(flow);
        flowOv.setMap(map);
      }
    },
    setChips(on) { chipsWanted = on; flow?.setChips(on); },
    relayout() { map?.relayout(); flowOv?.draw(); },
    destroy() {
      clusterer?.clear();
      for (const { ov } of dots.values()) ov.setMap(null);
      for (const l of lines) l.setMap(null);
      flowOv?.setMap(null);
      flow?.destroy();
      flow = null; flowOv = null;
      home?.setMap(null);
      pin?.setMap(null);
      mark?.setMap(null);
      dots.clear(); byOv.clear(); lines = []; home = null; pin = null; mark = null; clusterer = null; map = null;
      el.innerHTML = "";
    },
  };
  return api;
}

// ───────────────────────── Leaflet (물러설 때) ─────────────────────────

export function leafletEngine(L: any, el: HTMLElement, post: Post): Engine {
  let m: any = null;
  let cfg: EmbedInit | null = null;
  let pin: any = null;
  let sel: string | null = null;
  let layer: any = null;
  let lineLayer: any = null;
  let lineData: Polyline[] = [];
  let mark: any = null;
  let flow: FlowLayer | null = null;
  const G = 48;

  const sendPin = () => { const p = pin.getLatLng(); post({ type: "pick", lat: p.lat, lng: p.lng }); };
  const icon = (e: HTMLElement, w: number, h: number, ax = w / 2, ay = h / 2) =>
    L.divIcon({ className: "", html: e.outerHTML, iconSize: [w, h], iconAnchor: [ax, ay] });
  /** 크기가 글자에 따라 달라지는 것(점·화살표): 가운데를 그 자리에 (.lw가 -50% 옮김) */
  const centered = (html: string) => L.divIcon({ className: "", html: `<div class="lw">${html}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] });

  function dot(d: Dot) {
    return L.marker([d.lat, d.lng], { zIndexOffset: zOf(d, sel), icon: centered(dotHtml(d, sel, !!cfg?.compact, ringOf(cfg, d, lineData))) })
      .on("click", () => { sel = d.id; draw(); post({ type: "select", id: d.id }); });
  }

  /** 화면 칸(48px)으로 묶는 짧은 묶음 (플러그인 없이) */
  function draw() {
    if (!cfg || !layer) return;
    layer.clearLayers();
    const z = m.getZoom();
    if (!cfg.cluster) { cfg.dots.forEach((d) => layer.addLayer(dot(d))); return; }
    const cells: Record<string, Dot[]> = {};
    for (const d of cfg.dots) {
      const q = m.project([d.lat, d.lng], z);
      const k = Math.floor(q.x / G) + ":" + Math.floor(q.y / G);
      (cells[k] ??= []).push(d);
    }
    for (const g of Object.values(cells)) {
      if (g.length === 1 || z >= 16) { g.forEach((d) => layer.addLayer(dot(d))); continue; }
      let la = 0, ln = 0;
      for (const d of g) { la += d.lat; ln += d.lng; }
      const n = g.length, s = clusterSize(n);
      layer.addLayer(L.marker([la / n, ln / n], { zIndexOffset: 500, icon: icon(clusterEl(n, clusterColor(g.map((d) => d.c))), s, s) })
        .on("click", () => {
          const b = L.latLngBounds(g.map((d) => [d.lat, d.lng]));
          if (b.getNorthEast().equals(b.getSouthWest())) m.setView(b.getCenter(), Math.min(z + 3, 17));
          else m.fitBounds(b, { padding: [48, 48], maxZoom: 17 });
        }));
    }
  }

  function redrawFlow() {
    if (!flow || !m || !m._loaded) return;
    const size = m.getSize();
    const o = m.containerPointToLayerPoint([0, 0]);
    flow.redraw((p) => { const q = m.latLngToLayerPoint(p); return [q.x, q.y]; }, { x0: o.x, y0: o.y, x1: o.x + size.x, y1: o.y + size.y });
  }

  function fit() {
    if (!cfg) return;
    if (!cfg.dots.length && (cfg.mark || cfg.pin)) { m.setView((cfg.mark ?? cfg.pin)!, cfg.mark ? 15 : 12); return; }
    if (cfg.korea) { m.fitBounds(KOREA_BOUNDS); return; }
    const pts = fitPoints(cfg, lineData);
    if (!pts.length) { m.setView([36.3, 127.8], 7); return; }
    if (pts.length === 1) { m.setView(pts[0], 11); return; }
    m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: cfg.mode === "route" ? 15 : 12 });
  }

  const api: Engine = {
    name: "leaflet",
    init(c) {
      cfg = c;
      sel = null;
      m = L.map(el, { zoomControl: false, attributionControl: true, minZoom: c.mode === "pick" ? 3 : 6 });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      lineLayer = L.layerGroup().addTo(m);
      // 흐르는 › 판: 선(400) 위 · 점(600) 아래
      const fp = m.createPane("msflow");
      fp.style.zIndex = "450";
      fp.style.pointerEvents = "none";
      m.on("zoomstart", () => flow?.show(false));
      m.on("moveend viewreset", redrawFlow);
      if (c.mode === "pick") {
        const p = c.pin ?? DAEGU;
        m.setView(p, 16);
        const e = document.createElement("div");
        e.className = "pin";
        pin = L.marker(p, { draggable: true, icon: L.divIcon({ className: "", html: e.outerHTML, iconSize: [30, 30], iconAnchor: [4, 34] }) }).addTo(m);
        pin.on("dragend", sendPin);
        m.on("click", (ev: any) => { pin.setLatLng(ev.latlng); sendPin(); });
        api.setPolylines(c.polylines);
        sendPin();
        return;
      }
      layer = L.layerGroup().addTo(m);
      if (c.home) L.marker(c.home, { interactive: false, zIndexOffset: c.mode === "route" ? 150 : -1000, icon: icon(homeEl(), 26, 26) }).addTo(m);
      api.setPolylines(c.polylines);
      fit();
      draw();
      if (c.mark) api.setMark(c.mark, false);
      m.on("zoomend", draw);
      m.on("click", () => { if (sel) { sel = null; draw(); post({ type: "select", id: null }); } });
    },
    setPos(p) {
      if (!m) return;
      m.setView(p, 16);
      if (pin) { pin.setLatLng(p); sendPin(); }
    },
    select(id) { if (id !== sel) { sel = id; draw(); } },
    setMark(p, move) {
      if (!m) return;
      if (!p) { mark?.remove(); mark = null; return; }
      if (!mark) {
        const e = document.createElement("div");
        e.className = "pin";
        mark = L.marker(p, { interactive: false, zIndexOffset: 2000, icon: L.divIcon({ className: "", html: e.outerHTML, iconSize: [30, 30], iconAnchor: [4, 34] }) }).addTo(m);
      } else mark.setLatLng(p);
      if (move) m.setView(p, Math.max(m.getZoom(), 15));
    },
    pointToLatLng(x, y) {
      if (!m) return null;
      const q = m.containerPointToLatLng([x, y]);
      return q ? [q.lat, q.lng] : null;
    },
    setPolylines(ls) {
      lineData = ls;
      if (!lineLayer) return;
      lineLayer.clearLayers();
      flow?.destroy();
      flow = null;
      const { legs, others } = splitLines(ls);
      const st = legStyle(!!cfg?.compact);
      const round = { lineCap: "round", lineJoin: "round", interactive: false };
      for (const g of legs) L.polyline(g.points, { ...round, color: "#1b2a22", weight: st.shadow, opacity: 0.1 }).addTo(lineLayer);
      for (const g of legs) {
        L.polyline(g.points, { ...round, color: "#ffffff", weight: st.casing, opacity: 0.95 }).addTo(lineLayer);
        L.polyline(g.points, { ...round, color: g.color, weight: st.w, opacity: 1 }).addTo(lineLayer);
      }
      for (const l of others) {
        const s = LINE[l.style];
        L.polyline(l.points, { color: s.color, weight: s.weight, opacity: s.opacity, dashArray: s.dashed ? "6 7" : undefined, interactive: false }).addTo(lineLayer);
      }
      if (legs.length && m.getPane("msflow")) {
        flow = new FlowLayer({ compact: !!cfg?.compact });
        flow.setLegs(legs);
        flow.setChips(chipsWanted);
        m.getPane("msflow").appendChild(flow.root);
        redrawFlow();
      }
      if (layer) draw(); // 번호 점 테두리 색이 구간 색을 따른다
    },
    setChips(on) { chipsWanted = on; flow?.setChips(on); },
    relayout() { m?.invalidateSize(); redrawFlow(); },
    destroy() { flow?.destroy(); flow = null; m?.remove(); m = null; pin = null; mark = null; layer = null; lineLayer = null; el.innerHTML = ""; },
  };
  return api;
}
