/*
 * 도장 만들기 (브라우저 안에서만) — tools/stampgen/sheet_wrap.py + gen.compose 를 옮긴 것.
 *  1) findCircles: ChatGPT 시트(흰 바탕 + 진초록 테두리 원 N개)에서 원 찾기
 *  2) cutArt: 원 안쪽 그림만 잘라 892px 원형 PNG (테두리·흰 틈은 버림)
 *  3) composeStamp: 크림 바탕 + 잉크 바깥 테 + 안쪽 테 + Gowun Batang 글씨(위·아래 호) SVG → 720px webp
 *  4) toBw: 폰 흑백판 (회색 × 0.85 + 34, 기존 *_bw.webp와 같은 식)
 */

export type Circle = { cx: number; cy: number; rx: number; ry: number };

export const INK = "#2c4a3e";
export const INK_GOLD = "#8a6a2a";
/** 축제 한정 도장 붉은 인주 (festival-shape FESTIVAL_INK와 같음). */
export const INK_FEST = "#A33B2B";
const PAPER = "#f5f2e6";
const ART = 892; // 1000 좌표계에서 그림 지름 (gen: 원 r=446)

// ------------------------------------------------------------------ 1) 원 찾기

/**
 * 원 찾기. 작업 크기(긴 변 ~900px)로 줄여서:
 * 전경(흰색이 아니거나 채도 있는 칸) → 닫기(팽창·침식) → 구멍 메우기(가장자리에서 배경 채우기) → 열기(가는 연결 끊기)
 * → 덩어리 나누기 → 가로세로 비 0.85~1.15 + 원 채움 비율 0.7 이상 + 충분히 큰 것만 → 줄 단위로 왼→오.
 */
export function findCircles(img: ImageData): Circle[] {
  const scale = Math.min(1, 900 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const d = img.data;
  let m: Uint8Array = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const i = (sy * img.width + sx) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      m[y * w + x] = mn < 228 || mx - mn > 22 ? 1 : 0;
    }
  }
  const k = Math.max(1, Math.round(w / 300));
  m = erode(dilate(m, w, h, k), w, h, k); // 닫기
  m = fillHoles(m, w, h);
  m = dilate(erode(m, w, h, k * 2), w, h, k * 2); // 열기

  const seen = new Uint8Array(w * h);
  const out: Circle[] = [];
  const minArea = (w * h) / 400;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || seen[s]) continue;
    let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && m[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && m[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && m[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && m[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    if (n < minArea) continue;
    const rx = (x1 - x0 + 1) / 2, ry = (y1 - y0 + 1) / 2;
    if (!(rx / ry > 0.85 && rx / ry < 1.15)) continue;
    if (n / (Math.PI * rx * ry) < 0.7) continue; // 사각형·글씨 덩어리 빼기
    out.push({ cx: (x0 + x1) / 2 / scale, cy: (y0 + y1) / 2 / scale, rx: rx / scale, ry: ry / scale });
  }
  // 줄 나누기: 앞 원과 반지름 절반 이상 차이 나면 다음 줄
  out.sort((a, b) => a.cy - b.cy);
  const rows: Circle[][] = [];
  for (const c of out) {
    const row = rows[rows.length - 1];
    if (row && c.cy - row[row.length - 1].cy <= c.ry * 0.5) row.push(c);
    else rows.push([c]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx));
}

function dilate(m: Uint8Array, w: number, h: number, k: number): Uint8Array {
  return morph(m, w, h, k, 1);
}
function erode(m: Uint8Array, w: number, h: number, k: number): Uint8Array {
  return morph(m, w, h, k, 0);
}
/** 정사각 창(2k+1) 팽창(want=1)·침식(want=0) — 가로·세로 두 번으로 나눠 빠르게. */
function morph(m: Uint8Array, w: number, h: number, k: number, want: 0 | 1): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = want === 1 ? 0 : 1;
      for (let dx = -k; dx <= k; dx++) {
        const xx = x + dx;
        const s = xx < 0 || xx >= w ? 0 : m[y * w + xx];
        if (want === 1 ? s : !s) { v = want; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = want === 1 ? 0 : 1;
      for (let dy = -k; dy <= k; dy++) {
        const yy = y + dy;
        const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x];
        if (want === 1 ? s : !s) { v = want; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
/** 가장자리에서 닿는 배경만 배경, 나머지(원 안 흰 틈 등)는 전경으로. */
function fillHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const bg = new Uint8Array(w * h);
  const st: number[] = [];
  const push = (p: number) => { if (!m[p] && !bg[p]) { bg[p] = 1; st.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) {
    const p = st.pop()!;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = bg[i] ? 0 : 1;
  return out;
}

// ------------------------------------------------------------------ 2) 그림 잘라 내기

/** 바깥에서 안으로 훑어 진초록 테두리 → 흰 틈 → 그림이 시작되는 비율 s (못 찾으면 0.9). */
export function artScale(img: ImageData, c: Circle): number {
  const N = 720;
  let state: "out" | "ring" | "gap" = "out";
  for (let s = 1.02; s > 0.8; s -= 0.002) {
    let white = 0, dark = 0;
    for (let t = 0; t < N; t++) {
      const th = (t / N) * Math.PI * 2;
      const x = Math.min(img.width - 1, Math.max(0, Math.round(c.cx + s * c.rx * Math.cos(th))));
      const y = Math.min(img.height - 1, Math.max(0, Math.round(c.cy + s * c.ry * Math.sin(th))));
      const i = (y * img.width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      if (mn > 225 && mx - mn < 18) white++;
      if (mx < 120) dark++;
    }
    const wr = white / N, dr = dark / N;
    if (state === "out" && dr > 0.6) state = "ring";
    else if (state === "ring" && dr < 0.3 && wr > 0.5) state = "gap";
    else if (state === "gap" && wr < 0.08) return s;
  }
  return 0.9;
}

/** 원 안쪽 그림 → 892px 원형(바깥 투명) PNG data URL. */
export function cutArt(sheet: HTMLCanvasElement, img: ImageData, c: Circle, padPx = 4): { png: string; scale: number } {
  const s = artScale(img, c);
  const ax = s * c.rx - padPx, ay = s * c.ry - padPx;
  const cv = document.createElement("canvas");
  cv.width = ART;
  cv.height = ART;
  const x = cv.getContext("2d")!;
  x.imageSmoothingQuality = "high";
  x.beginPath();
  x.arc(ART / 2, ART / 2, ART / 2, 0, Math.PI * 2);
  x.clip();
  x.drawImage(sheet, c.cx - ax, c.cy - ay, ax * 2, ay * 2, 0, 0, ART, ART);
  return { png: cv.toDataURL("image/png"), scale: s };
}

// ------------------------------------------------------------------ 3) 테두리·글씨 두르기

const fontCache = new Map<string, Promise<string>>();

/** Gowun Batang 700을 Google Fonts에서 필요한 글자만(text=) 받아 data URL로 (SVG 그림 안에 넣으려고). */
export function gowunBatang(text: string): Promise<string> {
  const chars = [...new Set([...text.replace(/\s/g, ""), "·"])].sort().join("");
  let p = fontCache.get(chars);
  if (!p) {
    p = (async () => {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@700&text=${encodeURIComponent(chars)}`)).text();
      const url = /url\((https:[^)]+)\)/.exec(css)?.[1];
      if (!url) throw new Error("글꼴을 못 받았어요");
      const buf = await (await fetch(url)).arrayBuffer();
      const fmt = /format\('([a-z0-9]+)'\)/.exec(css)?.[1] ?? "woff2";
      return `data:font/${fmt};base64,${b64(new Uint8Array(buf))}`;
    })();
    p.catch(() => fontCache.delete(chars));
    fontCache.set(chars, p);
  }
  return p;
}

function b64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** gen.py COMMON_DEFS 중 테두리에 쓰는 것 (종이결 grain · 잉크 번짐 ink · 그림 원 scene). */
const DEFS = `
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 .18  0 0 0 0 .22  0 0 0 0 .18  0 0 0 .55 -.2"/>
</filter>
<filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="3" result="t"/>
  <feDisplacementMap in="SourceGraphic" in2="t" scale="3.2" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="11" result="sp"/>
  <feColorMatrix in="sp" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 1.9" result="m"/>
  <feComposite in="d" in2="m" operator="in"/>
</filter>
<clipPath id="scene"><circle cx="500" cy="500" r="446"/></clipPath>`;

/** 축제 테두리의 작은 깃발 (별 자리에, 왼쪽은 오른쪽을 향해·오른쪽은 왼쪽을 향해 펄럭). */
function flag(x: number, ink: string, mirror: boolean): string {
  return `<g transform="translate(${x} 500)${mirror ? " scale(-1 1)" : ""}"><rect x="-2" y="-17" width="4" height="34" rx="1.5" fill="${ink}"/>` +
    `<path d="M2 -17 Q11 -15 20 -10 Q11 -6 2 -4Z" fill="${ink}"/></g>`;
}

/**
 * gen.compose와 같은 SVG (그림은 data URL, 글꼴은 data URL로 안에 넣음).
 * festival = 축제 한정 도장: 붉은 인주 두 겹 테 + 안쪽 점선 테 + 별 대신 작은 깃발 (아래 글씨는 '2026 가을' 같은 해·계절).
 */
export function stampSvg(o: { art: string; top: string; bottom: string; ink?: string; rare?: boolean; festival?: boolean; font: string; size?: number }): string {
  const ink = o.ink ?? (o.festival ? INK_FEST : INK);
  const size = o.size ?? 1000;
  const rings = o.festival
    ? `<circle cx="500" cy="500" r="490" fill="none" stroke="${ink}" stroke-width="8"/><circle cx="500" cy="500" r="477" fill="none" stroke="${ink}" stroke-width="1.6"/><circle cx="500" cy="500" r="458" fill="none" stroke="${ink}" stroke-width="2" stroke-dasharray="3 9"/>`
    : o.rare
    ? `<circle cx="500" cy="500" r="494" fill="none" stroke="${ink}" stroke-width="2"/><circle cx="500" cy="500" r="486" fill="none" stroke="${ink}" stroke-width="7"/><circle cx="500" cy="500" r="474" fill="none" stroke="${ink}" stroke-width="1.6"/>`
    : `<circle cx="500" cy="500" r="490" fill="none" stroke="${ink}" stroke-width="7"/><circle cx="500" cy="500" r="476" fill="none" stroke="${ink}" stroke-width="1.6"/>`;
  const stars = o.festival
    ? flag(36, ink, false) + flag(964, ink, true)
    : [40, 960]
      .map((x) => `<path transform="translate(${x} 500)" d="M0 -9 L2.4 -2.4 L9 0 L2.4 2.4 L0 9 L-2.4 2.4 L-9 0 L-2.4 -2.4Z" fill="${ink}"/>`)
      .join("");
  const text =
    `<path id="tt" d="M500,500 m-452,0 a452,452 0 1,1 904,0" fill="none"/>` +
    `<path id="bt" d="M500,500 m-471,0 a471,471 0 1,0 942,0" fill="none"/>` +
    `<text font-family="GB" font-weight="700" font-size="31" letter-spacing="7" fill="${ink}"><textPath href="#tt" startOffset="50%" text-anchor="middle">${esc(o.top)}</textPath></text>` +
    `<text font-family="GB" font-weight="700" font-size="27" letter-spacing="5" fill="${ink}"><textPath href="#bt" startOffset="50%" text-anchor="middle">${esc(o.bottom)}</textPath></text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1000 1000" width="${size}" height="${size}">` +
    `<defs><style>@font-face{font-family:"GB";font-weight:700;src:url(${o.font})}</style>${DEFS}</defs>` +
    `<circle cx="500" cy="500" r="497" fill="${PAPER}"/>` +
    `<g clip-path="url(#scene)"><image href="${o.art}" xlink:href="${o.art}" x="54" y="54" width="${ART}" height="${ART}"/>` +
    `<rect x="0" y="0" width="1000" height="1000" filter="url(#grain)" opacity=".55"/></g>` +
    `<circle cx="500" cy="500" r="446" fill="none" stroke="${ink}" stroke-width="3"/>` +
    `<g filter="url(#ink)">${rings}${stars}${text}</g>` +
    `</svg>`
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("그림을 못 그렸어요"));
    im.src = src;
  });
}

/** 완성 도장 (컬러) 720px 캔버스. */
export async function composeStamp(o: { art: string; top: string; bottom: string; ink?: string; rare?: boolean; festival?: boolean; size?: number }): Promise<HTMLCanvasElement> {
  const size = o.size ?? 720;
  const font = await gowunBatang(o.top + o.bottom);
  const svg = stampSvg({ ...o, font, size: 1000 });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const im = await loadImage(url);
    // SVG 안 글꼴이 그려질 틈을 한 번 준다
    await new Promise((r) => setTimeout(r, 30));
    const cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    const x = cv.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.drawImage(im, 0, 0, size, size);
    return cv;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 폰 흑백판: 회색조 × 0.85 + 34 (sheet_wrap.phone_bw와 같은 식), 투명도는 그대로. */
export function toBw(src: HTMLCanvasElement): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = src.width;
  cv.height = src.height;
  const x = cv.getContext("2d")!;
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, cv.width, cv.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    const g = Math.max(0, Math.min(255, Math.round(l * 0.85 + 34)));
    p[i] = p[i + 1] = p[i + 2] = g;
  }
  x.putImageData(d, 0, 0);
  return cv;
}

export function toWebp(cv: HTMLCanvasElement, quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) =>
    cv.toBlob((b) => (b && b.type === "image/webp" ? resolve(b) : reject(new Error("이 브라우저는 webp로 저장을 못 해요 (크롬을 써 주세요)"))), "image/webp", quality),
  );
}

/** 시트 순서·문구 (sheet_wrap.py SHEETS와 같음) — 파일 이름에 sheet-A 같은 글자가 있으면 처음 값으로. */
export const SHEETS: Record<string, [string, string, string][]> = {
  A: [
    ["weather", "대구 동구 · 기상과학관", "구름 보고 바람 재는 마당"],
    ["eduseum", "대구 북구 · 교육역사관", "난로 위 도시락 데우던 교실"],
    ["unamji", "대구 북구 · 운암지 수변공원", "함지산 아래 오리 떠가는 못"],
    ["hajungdo", "대구 북구 · 금호꽃섬", "강 한가운데 꽃으로 덮인 섬"],
    ["chimsan", "대구 북구 · 침산공원", "언덕 위 정자에서 보는 노을"],
    ["dalseong", "대구 중구 · 달성공원", "옛 토성 길 따라 사슴 만나러"],
    ["aayang", "대구 동구 · 아양기찻길", "기차 대신 사람이 건너는 다리"],
    ["duryu", "대구 달서구 · 두류공원", "메타세쿼이아 길 끝 너른 풀밭"],
  ],
  B: [
    ["samsung", "대구 북구 · 삼성창조캠퍼스", "붉은 벽돌 공장 앞 너른 잔디"],
    ["hanbam", "대구 군위 · 한밤마을 돌담길", "돌담 골목에 벚꽃 내리는 날"],
    ["bullo", "대구 동구 · 불로동 고분군", "둥근 언덕 사이 나홀로나무"],
    ["samunjin", "대구 달성 · 사문진나루터", "피아노가 처음 건너온 나루"],
    ["suseongmot", "대구 수성구 · 수성못", "오리배 타고 분수 곁으로"],
    ["aquarium", "대구 동구 · 대구아쿠아리움", "머리 위로 가오리가 날아요"],
    ["kidsworld", "대구 수성구 · 어린이세상", "숲속 놀이터와 꼬마 신호등"],
    ["nmd", "대구 수성구 · 국립대구박물관", "옛 석탑이 지키는 잔디 마당"],
  ],
  C: [
    ["safety", "대구 동구 · 시민안전테마파크", "빨간 소방차와 배우는 안전"],
    ["bangjja", "대구 동구 · 방짜유기박물관", "두드려 빚은 황금빛 놋그릇"],
    ["gumisci", "경북 구미 · 구미과학관", "둥근 천장 가득 별자리"],
    ["daegaya", "경북 고령 · 대가야박물관", "왕릉 언덕과 반짝이는 금관"],
    ["naturepark", "대구 달성 · 네이처파크", "유리 온실 속 동물 친구들"],
    ["eworld", "대구 달서구 · 이월드", "83타워 아래 빙글빙글"],
    ["suppia", "경북 칠곡 · 가산수피아", "소나무 숲 속 하얀 알파카"],
    ["songhae", "대구 달성 · 옥연지 송해공원", "호수 위 다리 건너 풍차까지"],
  ],
  D: [
    ["arboretum", "대구 달서구 · 대구수목원", "꽃길 따라 연못까지 산책"],
    ["honeybee", "경북 칠곡 · 꿀벌나라테마공원", "윙윙 꿀벌 친구들의 강변"],
    ["cablecar", "대구 동구 · 팔공산 케이블카", "단풍 위로 둥실 오르는 곤돌라"],
  ],
};

/** 위 글씨 처음 값: '대구 북구 · 침산공원' (지역 앞 두 낱말 + 이름). */
export function defaultTop(region: string | null, name: string): string {
  const r = (region ?? "").split(/\s+/).slice(0, 2).map((w, i) => (i === 1 ? w.replace(/(군|시)$/, "") : w)).join(" ");
  return r ? `${r} · ${name}` : name;
}

/** 아래 글씨 처음 값: 시트 문구가 있는 명소는 그 문구, 없으면 빈칸. */
export function defaultBottom(id: string): string {
  for (const rows of Object.values(SHEETS)) for (const [pid, , bottom] of rows) if (pid === id) return bottom;
  return "";
}

/**
 * AI 후보 한 장(원 하나짜리 시트) → 잘라 낸 그림 PNG data URL. 시트와 같은 원 찾기·자르기를 쓰고,
 * 원을 못 찾으면 가운데 큰 원(지름 92%)으로 본다. src는 같은 주소(캔버스를 읽어야 해서 CORS 없이).
 */
export async function cutSingle(src: string): Promise<{ art: string; found: boolean }> {
  const im = await loadImage(src);
  const cv = document.createElement("canvas");
  cv.width = im.naturalWidth;
  cv.height = im.naturalHeight;
  const x = cv.getContext("2d", { willReadFrequently: true })!;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, cv.width, cv.height);
  x.drawImage(im, 0, 0);
  const data = x.getImageData(0, 0, cv.width, cv.height);
  const circles = findCircles(data).sort((a, b) => b.rx * b.ry - a.rx * a.ry);
  const big = circles[0];
  const min = Math.min(cv.width, cv.height);
  const ok = !!big && big.rx > min * 0.3;
  const c: Circle = ok ? big : { cx: cv.width / 2, cy: cv.height / 2, rx: min * 0.46, ry: min * 0.46 };
  return { art: cutArt(cv, data, c).png, found: ok };
}
