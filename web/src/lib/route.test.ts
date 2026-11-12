/* 실제 길 · 교통 반영 시간 (카카오모빌리티): 답 읽기 · 선 줄이기 · 저장 키 · 카드 다시 재기. 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dedupePts, departOf, directionsQuery, estimateRoute, expandLegs, isDepart, MAX_LEG_POINTS, optionPts, parseDirections, parsePts,
  retimeOption, routeKey, simplify, withTotal, departFor,
} from "./route-shape";
import type { OptionJson } from "./plan";

const fx = JSON.parse(readFileSync(join(import.meta.dirname, "route-fixtures.json"), "utf8"));
const HOME = { lat: 35.8858, lng: 128.5828 };
const DH = { lat: 35.98431, lng: 128.69853 };

function option(over: Partial<OptionJson> = {}): OptionJson {
  return {
    kind: "COURSE", label: "오늘 코스", pick: "short",
    stops: [{ id: "donghwa", name: "팔공산 동화사", lat: DH.lat, lng: DH.lng, indoor: false, stampable: true }],
    firstLegMin: 20, detourMin: null, arriveHomeMin: 11 * 60 + 30, arriveHome: "11:30",
    legs: [
      { kind: "DRIVE", fromMin: 8 * 60 + 30, toMin: 8 * 60 + 50, placeId: "donghwa" },
      { kind: "STAY", fromMin: 8 * 60 + 50, toMin: 11 * 60 + 10, placeId: "donghwa" },
      { kind: "HOME", fromMin: 11 * 60 + 10, toMin: 11 * 60 + 30, placeId: null },
    ],
    reasons: [
      { text: "낮잠 전 귀가 · 11:30", tone: "NAP" },
      { text: "가까워요 · 첫 이동 20분", tone: "PLAIN" },
      { text: "해 지기 1시간 전 귀가", tone: "SUN" },
    ],
    ...over,
  };
}

test("카카오 답: 구간마다 분·km, 선은 [위도, 경도]로 줄임", () => {
  const r = parseDirections(fx.ok, 2)!;
  assert.deepEqual(r.legs, [{ durMin: 33, distKm: 20.5 }, { durMin: 29, distKm: 20.7 }]);
  assert.equal(r.polyline.length, 2);
  for (const line of r.polyline) assert.ok(line.length >= 2 && line.length <= MAX_LEG_POINTS);
  // 첫 점 = 출발(경도·위도 뒤집힘 확인), 끝 점 = 동화사
  assert.deepEqual(r.polyline[0][0], [35.8858, 128.5828]);
  const end = r.polyline[0][r.polyline[0].length - 1];
  assert.ok(Math.abs(end[0] - 35.98431) < 0.003 && Math.abs(end[1] - 128.69853) < 0.003);
});

test("카카오 답: 실패 코드·구간 수 다름이면 null", () => {
  assert.equal(parseDirections(fx.fail, 1), null);
  assert.equal(parseDirections(fx.ok, 3), null);
  assert.equal(parseDirections({}, 1), null);
});

test("선 줄이기: 곧은 선은 두 점, 구불한 선은 상한 안", () => {
  const straight = Array.from({ length: 500 }, (_, i) => [35 + i * 0.0001, 128 + i * 0.0001] as [number, number]);
  assert.equal(simplify(straight).length, 2);
  const zig = Array.from({ length: 5000 }, (_, i) => [35 + i * 0.0001, 128 + (i % 2) * 0.01] as [number, number]);
  assert.ok(simplify(zig).length <= MAX_LEG_POINTS);
});

test("저장 키: 약 100m로 묶고 지금 교통은 10분 칸, 예상 교통은 출발 시각", () => {
  const a = routeKey([HOME, DH], null, 1_000_000_000_000);
  const b = routeKey([{ lat: 35.88581, lng: 128.58284 }, DH], null, 1_000_000_000_000 + 60_000);
  assert.equal(a, b);
  assert.notEqual(a, routeKey([HOME, DH], null, 1_000_000_000_000 + 600_000));
  assert.match(routeKey([HOME, DH], "202611071030", 0), /^route:f:20261107103:128\.583,35\.886;/);
});

test("점 읽기·출발 시각 모양", () => {
  assert.deepEqual(parsePts("128.5828,35.8858;128.69853,35.98431"), [HOME, DH]);
  assert.equal(parsePts("128.5,35.8"), null);
  assert.equal(parsePts("-122.4,37.7;128.5,35.8"), null); // 한국 밖
  assert.ok(isDepart("202611071030"));
  assert.ok(!isDepart("202613071030"));
  assert.equal(departOf("2026-11-07", 8 * 60 + 37), "202611070830");
  const q = directionsQuery([HOME, DH, HOME], "202611070830");
  assert.equal(q.get("origin"), "128.582800,35.885800");
  assert.equal(q.get("waypoints"), "128.698530,35.984310");
  assert.equal(q.get("departure_time"), "202611070830");
});

test("그날 출발이 20분 넘게 뒤면 예상 교통, 아니면 지금 교통", () => {
  const now = new Date("2026-11-01T09:00:00+09:00");
  assert.equal(departFor("2026-11-07", 510, now), "202611070830");
  assert.equal(departFor("2026-11-01", 9 * 60 + 5, now), null);
  assert.equal(departFor("2026-11-01", 8 * 60, now), null);
});

test("같은 곳(50m 안) 구간은 부르지 않고 0분으로 펴기", () => {
  const near = { lat: HOME.lat + 0.0001, lng: HOME.lng };
  const pts = [HOME, near, DH, HOME];
  const { call, keep } = dedupePts(pts);
  assert.equal(call.length, 3);
  assert.deepEqual(keep, [false, true, true]);
  const got = parseDirections(fx.ok, 2)!;
  const ex = expandLegs(pts, keep, got);
  assert.deepEqual(ex.legs.map((l) => l.durMin), [0, 33, 29]);
  assert.equal(ex.polyline.length, 3);
});

test("카드 다시 재기: 이동만 바꾸고 머무름은 그대로, 이유 칩 시각도", () => {
  const got = parseDirections(fx.ok, 2)!;
  const o = retimeOption(option(), withTotal("live", got.legs, got.polyline), 13 * 60);
  // 08:30 출발 → 33분 → 09:03 도착 → 머무름 140분 → 11:23 출발 → 29분 → 11:52 집
  assert.deepEqual(o.legs.map((l) => [l.fromMin, l.toMin]), [[510, 543], [543, 683], [683, 712]]);
  assert.equal(o.arriveHomeMin, 712);
  assert.equal(o.arriveHome, "11:52");
  assert.equal(o.firstLegMin, 33);
  assert.equal(o.route?.source, "live");
  assert.equal(o.route?.homeMin, 712);
  assert.equal(o.route?.driveMin, 62);
  assert.deepEqual(o.reasons.map((r) => r.text), ["낮잠 전 귀가 · 11:52", "가까워요 · 첫 이동 33분", "해 지기 38분 전 귀가"]);
  assert.ok(!o.overLimit);
});

test("카드 다시 재기: 실제 길로 귀가 한계를 넘으면 경고 이유 + overLimit", () => {
  const got = parseDirections(fx.ok, 2)!;
  const o = retimeOption(option(), withTotal("future", got.legs, got.polyline), 11 * 60 + 40);
  assert.equal(o.overLimit, true);
  assert.equal(o.reasons[0].text, "실제 길로는 귀가 한계를 12분 넘어요");
  assert.equal(o.route?.source, "future");
});

test("카드 다시 재기: 어림이면 시각은 그대로, 구간 수가 다르면 손대지 않음", () => {
  const est = retimeOption(option(), estimateRoute(optionPts(option(), HOME, HOME)), 13 * 60);
  assert.equal(est.arriveHomeMin, 690);
  assert.equal(est.route?.source, "estimate");
  assert.equal(est.route?.polyline, undefined);
  const got = parseDirections(fx.ok, 2)!;
  const three = withTotal("live", [...got.legs, { durMin: 5, distKm: 1 }], [...got.polyline, []]);
  assert.equal(retimeOption(option(), three, 13 * 60).route, undefined);
});

test("해 진 뒤가 되면 해 지기 칩은 뺀다", () => {
  const o = option({ reasons: [{ text: "해 지기 10분 전 귀가", tone: "SUN" }] });
  const got = parseDirections(fx.ok, 2)!;
  assert.deepEqual(retimeOption(o, withTotal("live", got.legs, got.polyline), null).reasons, []);
});
