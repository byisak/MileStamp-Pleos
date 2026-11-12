// 코스 지도 A-1: 구간 선 안에서 천천히 흐르는 흰 › 와 '시간 보기' 말풍선(A-2) — 카카오·Leaflet 공용.
// 지도 선(Polyline)은 움직일 수 없어서, 선 바로 위 판(카카오 AbstractOverlay 판 · Leaflet 전용 pane)에 SVG를 하나 깔고
// 엔진이 준 좌표 → 판 위 픽셀(project)로 구간마다 화면 길이를 재 둔 뒤, 한 프레임마다 › 자리만 옮긴다.
// 아끼기: 화면(조금 넓게) 안 구간만 › 를 둔다 · 모두 MAX_CHEVRONS개까지 · 초당 약 30번 · 페이지가 안 보이면 멈춤
// · '움직임 줄이기'(prefers-reduced-motion)면 멈춘 › 한 번만 그린다.
import { minText, type LatLng } from "@/lib/map-embed";

export type FlowLeg = { points: LatLng[]; color: string; min?: number };
/** 판 위 픽셀 사각형 (화면 + 여유) */
export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Project = (p: LatLng) => [number, number];

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_CHEVRONS = 260;
/** 코스 전체가 화면에서 이보다 짧으면(멀리 축소) › 없이 선만 */
const MIN_ROUTE_PX = 420;
/** › 간격(px) · 흐르는 빠르기(px/초) · 한 프레임 최소 간격(ms) */
const GAP = 44, GAP_COMPACT = 34, SPEED = 14, FRAME_MS = 33;
/** › 모양: 높이 약 6.4px (선 굵기 5px보다 조금 크게), 흰 선 */
const CHEVRON = "M-1.4 -2L1.1 0L-1.4 2"; // 선(굵기 6) 안에 쏙 들어가는 크기

type Screen = { xs: Float64Array; ys: Float64Array; cum: Float64Array; len: number; spans: [number, number][] };

export class FlowLayer {
  readonly root: HTMLDivElement;
  private svg: SVGSVGElement;
  private chipBox: HTMLDivElement;
  private pool: SVGPathElement[] = [];
  private legs: FlowLeg[] = [];
  private screens: Screen[] = [];
  private chipsOn = false;
  private raf = 0;
  private last = 0;
  private phase = 0;
  private readonly gap: number;
  private readonly still: boolean;
  private readonly onVis = () => this.kick();

  constructor(private readonly opts: { compact: boolean; zIndex?: number }) {
    this.gap = opts.compact ? GAP_COMPACT : GAP;
    this.still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.root = document.createElement("div");
    this.root.className = "flow";
    if (opts.zIndex != null) this.root.style.zIndex = String(opts.zIndex);
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("width", "1");
    this.svg.setAttribute("height", "1");
    this.root.appendChild(this.svg);
    this.chipBox = document.createElement("div");
    this.root.appendChild(this.chipBox);
    document.addEventListener("visibilitychange", this.onVis);
    this.phase = this.gap / 2;
  }

  setLegs(legs: FlowLeg[]) {
    this.legs = legs;
    this.screens = [];
  }

  setChips(on: boolean) {
    this.chipsOn = on && !this.opts.compact;
    this.drawChips();
  }

  /** 지도가 움직이거나 확대가 바뀌면: 판 위 픽셀로 다시 재고 그린다 */
  redraw(project: Project, view: Rect) {
    const pad = 200;
    const r: Rect = { x0: view.x0 - pad, y0: view.y0 - pad, x1: view.x1 + pad, y1: view.y1 + pad };
    this.screens = this.legs.map((l) => measure(l.points.map(project), r));
    this.show(true);
    this.drawChips();
    this.frame(true);
    this.kick();
  }

  /** 확대 움직임 동안은 숨긴다 (판이 따라 늘지 않아서) */
  show(on: boolean) {
    this.root.style.visibility = on ? "" : "hidden";
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener("visibilitychange", this.onVis);
    this.root.remove();
  }

  private kick() {
    if (this.still || this.raf || document.hidden || !this.screens.length) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = 0;
      if (document.hidden) return;
      const dt = now - this.last;
      if (dt >= FRAME_MS) {
        this.last = now;
        this.phase = (this.phase + (Math.min(dt, 200) / 1000) * SPEED) % this.gap;
        this.frame(false);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** › 자리 옮기기: 구간마다 phase + k·gap 자리 (보이는 칸 안만) */
  private frame(force: boolean) {
    if (!force && this.root.style.visibility === "hidden") return;
    let used = 0;
    const gap = this.gap, ph = this.phase;
    // 축소해서 코스가 작게 보이면 › 를 안 그린다 (선만): 코스 전체가 화면에서 MIN_ROUTE_PX보다 짧을 때 · 구간이 › 3개 자리도 안 될 때
    const total = this.screens.reduce((a, sc) => a + sc.len, 0);
    for (const sc of total < MIN_ROUTE_PX ? [] : this.screens) {
      if (sc.len < gap * 2.5) continue;
      for (const [a, b] of sc.spans) {
        const lo = Math.max(a, 6), hi = Math.min(b, sc.len - 6);
        for (let k = Math.ceil((lo - ph) / gap), s = ph + k * gap; s <= hi && used < MAX_CHEVRONS; k++, s = ph + k * gap) {
          const p = at(sc, s);
          const el = this.chevron(used++);
          el.setAttribute("transform", `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)}) rotate(${p[2].toFixed(1)})`);
        }
      }
    }
    for (let i = used; i < this.pool.length; i++) if (this.pool[i].style.display !== "none") this.pool[i].style.display = "none";
  }

  private chevron(i: number): SVGPathElement {
    let el = this.pool[i];
    if (!el) {
      el = document.createElementNS(SVG_NS, "path");
      el.setAttribute("d", CHEVRON);
      el.setAttribute("class", "chev");
      this.svg.appendChild(el);
      this.pool[i] = el;
    }
    if (el.style.display) el.style.display = "";
    return el;
  }

  /** 구간 가운데 'N분' 말풍선 (흰 바탕 + 구간 색 테두리·글자). 코스 바깥쪽으로 조금 비켜 놓는다 */
  private drawChips() {
    this.chipBox.textContent = "";
    if (!this.chipsOn || !this.screens.length) return;
    // 코스 가운데(모든 점 평균) — 말풍선은 그 반대쪽으로
    let cx = 0, cy = 0, n = 0;
    for (const sc of this.screens) for (let i = 0; i < sc.xs.length; i++) { cx += sc.xs[i]; cy += sc.ys[i]; n++; }
    if (n) { cx /= n; cy /= n; }
    this.legs.forEach((l, i) => {
      const sc = this.screens[i];
      if (l.min == null || !sc || sc.len <= 0) return;
      const [x, y, deg] = at(sc, sc.len / 2);
      const r = (deg * Math.PI) / 180;
      let nx = -Math.sin(r), ny = Math.cos(r);
      if ((x - cx) * nx + (y - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const off = sc.len < 60 ? 0 : 15;
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.style.cssText = `left:${(x + nx * off).toFixed(1)}px;top:${(y + ny * off).toFixed(1)}px;border-color:${l.color};color:${l.color}`;
      chip.textContent = minText(l.min);
      this.chipBox.appendChild(chip);
    });
  }
}

/** 판 위 점들 → 누적 길이 + 화면 칸 안에 걸친 길이 구간들 */
function measure(pts: [number, number][], r: Rect): Screen {
  const n = pts.length;
  const xs = new Float64Array(n), ys = new Float64Array(n), cum = new Float64Array(n);
  const spans: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i][0]; ys[i] = pts[i][1];
    if (i) {
      cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      const inView = Math.max(xs[i], xs[i - 1]) >= r.x0 && Math.min(xs[i], xs[i - 1]) <= r.x1
        && Math.max(ys[i], ys[i - 1]) >= r.y0 && Math.min(ys[i], ys[i - 1]) <= r.y1;
      if (inView) {
        const lastSpan = spans[spans.length - 1];
        if (lastSpan && lastSpan[1] === cum[i - 1]) lastSpan[1] = cum[i];
        else spans.push([cum[i - 1], cum[i]]);
      }
    }
  }
  return { xs, ys, cum, len: n ? cum[n - 1] : 0, spans };
}

/** 길이 s 자리의 [x, y, 방향(도)] */
function at(sc: Screen, s: number): [number, number, number] {
  const { xs, ys, cum } = sc;
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < s) lo = mid + 1; else hi = mid; }
  // 길이 0인 마디는 건너 방향을 잡는다
  let i = lo;
  while (i < cum.length - 1 && cum[i] - cum[i - 1] <= 0) i++;
  const seg = cum[i] - cum[i - 1];
  const t = seg > 0 ? Math.min(1, Math.max(0, (s - cum[i - 1]) / seg)) : 0;
  const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1];
  return [xs[i - 1] + dx * t, ys[i - 1] + dy * t, (Math.atan2(dy, dx) * 180) / Math.PI];
}
