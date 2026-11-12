/* 지도 한 벌(/embed/map) 약속: 설정 다듬기 · 카카오 SDK 주소 · 앱이 넣는 스크립트 줄 (브라우저·네트워크 없이). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arrowCounts, arrowMarks, cleanText, clusterColor, DAEGU, distanceM, dotHtml, eastEdge, escapeHtml, initFromHash, jsCall, kakaoKeyOk, kakaoLevel, kakaoSdkUrl,
  LINE, LINE_Z, parseDots, parseInit, parsePolylines, safeJson, screenDeg, toLatLng,
} from "./map-embed";
// 폰 앱 쪽 짝 (RN 없이 순수 함수라 그대로 불러옴)
import { embedUrl, LEG_COLORS as PHONE_LEG_COLORS, legColor as phoneLegColor, LINE_COLOR, mapCall, readMapMsg, type MapInit } from "../../../phone/src/mapEmbed";

test("카카오 SDK 주소: autoload=false · services·clusterer · 키는 주소 안전하게", () => {
  const key = "0123456789abcdef0123456789abcdef";
  assert.equal(kakaoSdkUrl(key), `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services,clusterer`);
  assert.ok(kakaoKeyOk(key));
  assert.ok(!kakaoKeyOk(""));
  assert.ok(!kakaoKeyOk(undefined));
  assert.ok(!kakaoKeyOk("abc"));
  assert.ok(!kakaoKeyOk('x"><script>alert(1)</script>'));
});

test("init: pick은 핀 없으면 대구 북구청, 밝기·묶음 기본값", () => {
  assert.deepEqual(parseInit({ mode: "pick", theme: "dark" }), {
    mode: "pick", dark: true, pin: DAEGU, dots: [], home: null, korea: false, cluster: false, polylines: [], longpress: false, mark: null, compact: false,
  });
  const ex = parseInit({ mode: "explore", theme: "light", dots: [{ id: "a", lat: 35.9, lng: 128.6, c: "g" }], home: [35.88, 128.58], korea: true });
  assert.equal(ex?.cluster, true);
  assert.equal(ex?.dark, false);
  assert.equal(ex?.pin, null);
  assert.deepEqual(ex?.home, [35.88, 128.58]);
  assert.equal(parseInit({ mode: "route" })?.cluster, false);
  assert.equal(parseInit({ mode: "route", cluster: true })?.cluster, true);
});

test("init: 모양이 틀린 값은 버린다 (모드·좌표·점 id·색)", () => {
  assert.equal(parseInit(null), null);
  assert.equal(parseInit({ mode: "satellite" }), null);
  assert.equal(parseInit("pick"), null);
  const r = parseInit({
    mode: "explore",
    dots: [
      { id: "ok", lat: 36, lng: 128, c: "r" },
      { id: "", lat: 36, lng: 128 },
      { id: "far", lat: 95, lng: 128 },
      { id: "nan", lat: Number.NaN, lng: 128 },
      { id: 7, lat: 36, lng: 128 },
      { id: "color", lat: 36, lng: 128, c: "purple" },
      "junk",
    ],
    home: [200, 1],
  })!;
  assert.deepEqual(r.dots.map((d) => [d.id, d.c]), [["ok", "r"], ["color", "n"]]);
  assert.equal(r.home, null);
  assert.deepEqual(toLatLng({ lat: 1, lng: 2 }), [1, 2]);
  assert.equal(toLatLng([1]), null);
});

test("선(polylines): via 초록 실선 · direct 회색 점선, 점 2개 미만은 버림", () => {
  const l = parsePolylines([
    { points: [[35.8, 128.5], [35.9, 128.6], [99, 1]], style: "via" },
    { points: [[35.8, 128.5], { lat: 36, lng: 129 }], style: "direct" },
    { points: [[35.8, 128.5]] },
    { points: "x" },
    { points: [[35, 128], [36, 129]], style: "weird" },
  ]);
  assert.deepEqual(l.map((x) => [x.style, x.points.length]), [["via", 2], ["direct", 2], ["via", 2]]);
  assert.equal(parseInit({ mode: "route", polylines: l })?.polylines.length, 3);
});

test("앱 → 지도 스크립트 줄: </script>·줄 구분 문자가 있어도 깨지지 않음, 폰 짝과 같은 글", () => {
  const evil = { mode: "explore", dots: [{ id: "</script><img src=x onerror=alert(1)>\u2028", lat: 36, lng: 128, c: "g" }] };
  const s = jsCall("init", evil);
  assert.ok(!s.includes("<"));
  assert.ok(!s.includes("\u2028"));
  assert.equal(s, mapCall("init", evil));
  assert.equal(mapCall("setPos", 35.1, 128.2), "window.msMap&&window.msMap.setPos(35.1,128.2);true;");
  // 되살리면 같은 값
  const json = safeJson(evil);
  assert.deepEqual(JSON.parse(json), evil);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("폰이 만든 설정을 지도가 그대로 받는다", () => {
  const init: MapInit = {
    mode: "explore", theme: "dark", dots: [{ id: "fest-1", lat: 35.95, lng: 128.69, c: "r" }], home: [35.886, 128.583], korea: false,
    polylines: [{ points: [[35.886, 128.583], [35.95, 128.69]], style: "direct" }],
  };
  const got = parseInit(JSON.parse(JSON.stringify(init)))!;
  assert.equal(got.dark, true);
  assert.deepEqual(got.dots, init.dots);
  assert.deepEqual(got.polylines, init.polylines);
  assert.equal(embedUrl("https://milestamp.vercel.app/"), "https://milestamp.vercel.app/embed/map");
  assert.equal(embedUrl("http://10.0.2.2:3200"), "http://10.0.2.2:3200/embed/map");
});

test("지도 → 앱 말 읽기", () => {
  assert.deepEqual(readMapMsg('{"type":"ready","engine":"kakao"}'), { type: "ready", engine: "kakao" });
  assert.deepEqual(readMapMsg('{"type":"pick","lat":35.1,"lng":128.2}'), { type: "pick", lat: 35.1, lng: 128.2 });
  assert.deepEqual(readMapMsg('{"type":"select","id":null}'), { type: "select", id: null });
  assert.deepEqual(readMapMsg('{"type":"select","id":"a"}'), { type: "select", id: "a" });
  assert.equal(readMapMsg('{"type":"ready","engine":"google"}'), null);
  assert.equal(readMapMsg('{"type":"pick","lat":"35"}'), null);
  assert.equal(readMapMsg("not json"), null);
});

test("주소 #init= 로 열기 (브라우저 확인용)", () => {
  const h = "#init=" + encodeURIComponent(JSON.stringify({ mode: "pick", pin: [36, 128] }));
  assert.deepEqual(initFromHash(h)?.pin, [36, 128]);
  assert.equal(initFromHash("#init=%7Bbad"), null);
  assert.equal(initFromHash(""), null);
});

test("묶음 색·거리·반경 손잡이·확대 단계", () => {
  assert.equal(clusterColor(["n", "r", "g"]), "g");
  assert.equal(clusterColor(["n", "r"]), "r");
  assert.equal(clusterColor(["n"]), "n");
  const e = eastEdge(35.88, 128.58, 300);
  assert.ok(Math.abs(distanceM([35.88, 128.58], e) - 300) < 1);
  assert.equal(kakaoLevel(16), 4);
  assert.equal(kakaoLevel(30), 1);
  assert.equal(kakaoLevel(0), 14);
});

test("길게 누름·표시 핀 (직접 찾기 지도): init longpress·mark, 지도 → 앱 longpress, 앱 → setMark 줄", () => {
  const c = parseInit({ mode: "explore", longpress: true, mark: [35.99, 128.7], pin: [35.9, 128.6] })!;
  assert.equal(c.longpress, true);
  assert.deepEqual(c.mark, [35.99, 128.7]);
  assert.equal(parseInit({ mode: "explore", longpress: "yes", mark: [999, 1] })!.longpress, false);
  assert.equal(parseInit({ mode: "explore", mark: [999, 1] })!.mark, null);
  assert.deepEqual(readMapMsg('{"type":"longpress","lat":35.5,"lng":128.5}'), { type: "longpress", lat: 35.5, lng: 128.5 });
  assert.equal(readMapMsg('{"type":"longpress","lat":null,"lng":128.5}'), null);
  assert.equal(mapCall("setMark", 35.5, 128.5, true), jsCall("setMark", 35.5, 128.5, true));
  assert.equal(mapCall("setMark", null), "window.msMap&&window.msMap.setMark(null);true;");
  const fromPhone: MapInit = { mode: "explore", theme: "light", home: [35.88, 128.58], pin: [36.0, 128.7], longpress: true, mark: null };
  assert.equal(parseInit(fromPhone)!.longpress, true);
});

test("점 글자: 코스 순서·출발·중심 이름표를 받고, 줄바꿈·제어 문자 빼고 길이 자름", () => {
  const ds = parseDots([
    { id: "a", lat: 35.9, lng: 128.6, c: "g", label: "1", big: true, tag: "중심" },
    { id: "_start", lat: 35.8, lng: 128.5, c: "n", label: " 출발\n" },
    { id: "b", lat: 35.7, lng: 128.4, c: "g", label: 3, tag: "" },
    { id: "c", lat: 35.7, lng: 128.4, c: "g", label: "12345678", tag: "아주아주아주긴이름표예요" },
  ]);
  assert.deepEqual(ds[0], { id: "a", lat: 35.9, lng: 128.6, c: "g", label: "1", big: true, tag: "중심" });
  assert.deepEqual(ds[1], { id: "_start", lat: 35.8, lng: 128.5, c: "n", label: "출발" });
  assert.deepEqual(ds[2], { id: "b", lat: 35.7, lng: 128.4, c: "g" });
  assert.equal(ds[3].label, "1234");
  assert.equal(ds[3].tag, "아주아주아주긴이");
  assert.equal(cleanText("\u2028", 4), null);
  assert.equal(cleanText(null, 4), null);
});

test("점 HTML: 앱이 보낸 글자는 escape — 태그·속성이 되지 않음", () => {
  const evil = parseDots([{ id: 'x" onclick="alert(1)', lat: 35.9, lng: 128.6, c: "g", label: "<img", tag: "<b>&'\"" }])[0];
  const html = dotHtml(evil, null);
  assert.ok(!html.includes("<img"), html);
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("<i>&lt;b&gt;&amp;&#39;&quot;</i>"), html);
  assert.ok(html.includes('data-id="x&quot; onclick=&quot;alert(1)"'), html);
  // 이름표는 작은 지도(compact)에서 뺌, 고른 점은 s, 번호 점은 n, 큰 점은 l
  const d = { id: "a", lat: 1, lng: 2, c: "g" as const, label: "2", big: true, tag: "중심" };
  assert.equal(dotHtml(d, "a"), '<div class="d s n l" style="background:#1F9D55" data-id="a"><b>2</b><i>중심</i></div>');
  assert.equal(dotHtml(d, null, true), '<div class="d n l" style="background:#1F9D55" data-id="a"><b>2</b></div>');
  assert.equal(dotHtml({ id: "p", lat: 1, lng: 2, c: "n" }, null), '<div class="d" style="background:#8A877F" data-id="p"></div>');
});

test("선 모양: go·back·direct·via, 모르는 값은 via. 그리는 순서 = 오는 길 < 가는 길 < 바로 가는 길(맨 위)", () => {
  const pts = [[35.9, 128.6], [35.8, 128.5]];
  const ls = parsePolylines(["go", "back", "direct", "via", "zz"].map((style) => ({ points: pts, style })));
  assert.deepEqual(ls.map((l) => l.style), ["go", "back", "direct", "via", "via"]);
  assert.ok(LINE_Z.back < LINE_Z.go && LINE_Z.go < LINE_Z.direct);
  assert.ok(LINE.direct.dashed && !LINE.go.dashed && !LINE.back.dashed);
  assert.ok(LINE.go.arrows && LINE.back.arrows && !LINE.direct.arrows);
  assert.ok(LINE.go.weight <= 4 && LINE.direct.weight <= 3, "선이 너무 굵지 않게");
  assert.equal(parseInit({ mode: "route", compact: true })?.compact, true);
});

test("범례 색 = 지도 선 색 (폰 LINE_COLOR ↔ 지도 LINE)", () => {
  assert.equal(LINE_COLOR.go, LINE.go.color);
  assert.equal(LINE_COLOR.back, LINE.back.color);
  assert.equal(LINE_COLOR.direct, LINE.direct.color);
  assert.notEqual(LINE.go.color, LINE.back.color);
});

test("방향 화살표: 같은 간격 · 화면 방향(동 0 · 남 90 · 북 -90 · 서 180)", () => {
  assert.equal(screenDeg([35, 128], [35, 129]), 0);
  assert.equal(screenDeg([35, 128], [34, 128]), 90);
  assert.equal(screenDeg([35, 128], [36, 128]), -90);
  assert.equal(Math.abs(screenDeg([35, 129], [35, 128])), 180);
  const ms = arrowMarks([[35, 128], [35, 129]], 2);
  assert.equal(ms.length, 2);
  assert.ok(Math.abs(ms[0].lng - 128.25) < 1e-6 && Math.abs(ms[1].lng - 128.75) < 1e-6);
  // 꺾인 선: 화살표는 그 자리 구간 방향
  const bent = arrowMarks([[35, 128], [35, 128.1], [34.9, 128.1]], 2);
  assert.equal(bent[0].deg, 0);
  assert.equal(bent[1].deg, 90);
  assert.deepEqual(arrowMarks([[35, 128]], 3), []);
  // 선마다 수: 화살표 선만, 작은 지도는 1개
  const L2 = [
    { points: [[35, 128], [35, 129]] as [number, number][], style: "go" as const },
    { points: [[35, 129], [35, 129.1]] as [number, number][], style: "back" as const },
    { points: [[35, 128], [35, 129.1]] as [number, number][], style: "direct" as const },
  ];
  assert.deepEqual(arrowCounts(L2, true), [1, 1, 0]);
  const full = arrowCounts(L2, false);
  assert.ok(full[0] >= full[1] && full[1] >= 1 && full[2] === 0 && full[0] <= 4);
});

test("코스 지도 A-1: 구간 번호·시간 읽기 · 옛 폰은 순서로 · 색 규칙", async () => {
  const m = await import("./map-embed");
  const P: [number, number][] = [[35, 128], [35.1, 128.1]];
  const ls = m.parsePolylines([
    { points: P, style: "go", leg: 0, min: 22.4 },
    { points: P, style: "go", leg: -1, min: 0 },
    { points: P, style: "go", leg: 1.5, min: "9" },
    { points: P, style: "back", leg: 3, min: 99999 },
    { points: P, style: "direct", leg: 2, min: 5 },
  ]);
  assert.deepEqual(ls.map((l) => [l.leg, l.min]), [[0, 22], [undefined, undefined], [undefined, undefined], [3, undefined], [2, 5]]);
  // 옛 폰: leg 없음 → 비교선(direct)을 뺀 순서, 마지막 오는 길은 파랑
  const old = m.parsePolylines([{ points: P, style: "go" }, { points: P, style: "direct" }, { points: P, style: "go" }, { points: P, style: "go" }, { points: P, style: "back" }]);
  const info = m.legInfo(old);
  assert.deepEqual(info.map((x) => x?.leg ?? null), [0, null, 1, 2, 3]);
  assert.deepEqual(info.map((x) => x?.color ?? null), ["#2f9e6e", null, "#e0913a", "#8a6fd6", "#4a7fd9"]);
  // 번호 점 k = 도착하는 구간(k-1) 색
  assert.equal(m.stopColor(1, old), "#2f9e6e");
  assert.equal(m.stopColor(3, old), "#8a6fd6");
  assert.equal(m.stopNumber({ id: "a", lat: 0, lng: 0, c: "g", label: "2" }), 2);
  assert.equal(m.stopNumber({ id: "a", lat: 0, lng: 0, c: "n", label: "출발" }), null);
  // 곳이 많으면 파랑을 빼고 6색 안에서 돈다
  const many = Array.from({ length: 7 }, (_, i) => m.legColor(i, false));
  assert.ok(!many.includes(m.LEG_HOME_COLOR));
  assert.equal(new Set([...many, m.legColor(7, true)]).size, 6);
  assert.equal(m.minText(22), "22분");
  assert.equal(m.minText(75), "1시간 15분");
  assert.equal(m.minText(120), "2시간");
  // 번호 점 테두리: 글자는 그대로 escape, 색만 구간 색
  const html = m.dotHtml({ id: "x", lat: 0, lng: 0, c: "g", label: "1" }, null, false, "#2f9e6e");
  assert.ok(html.includes('class="d n r"') && html.includes("border-color:#2f9e6e"));
});

test("구간 색 = 폰 시간표 색 (폰 LEG_COLORS ↔ 지도 LEG_COLORS)", async () => {
  const m = await import("./map-embed");
  assert.deepEqual([...PHONE_LEG_COLORS], [...m.LEG_COLORS]);
  for (let i = 0; i < 8; i++) for (const b of [false, true]) assert.equal(phoneLegColor(i, b), m.legColor(i, b));
});
