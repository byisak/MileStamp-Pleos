import { test } from "node:test";
import assert from "node:assert/strict";
import { insideAny, normalizePoints, parsePlaceInput, parseRestaurantInput, radiusOf } from "./catalog-shape";
import { newSessionValue, validSession } from "./admin-auth";

test("도착 지점: 없으면 대표 좌표 + 300m, 반경은 50~1500으로", () => {
  assert.deepEqual(normalizePoints(null, 35.9, 128.6), [{ lat: 35.9, lng: 128.6, r: 300, name: "정문·주차장" }]);
  const ps = normalizePoints([{ lat: 35.9, lng: 128.6, r: 20 }, { lat: 35.91, lng: 128.61, r: 9999, name: "후문" }, { lat: "x" }], 0, 0);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].r, 50);
  assert.equal(ps[1].r, 1500);
  assert.equal(ps[0].name, "도착 지점 1");
  assert.equal(radiusOf(ps), 1500);
});

test("어느 원 안이든 도착 (엔진 Place.contains와 같은 규칙)", () => {
  const ps = [{ lat: 36.0489, lng: 128.6409, r: 300, name: "정문" }, { lat: 36.0569, lng: 128.6489, r: 250, name: "후문" }];
  assert.ok(insideAny(ps, { lat: 36.0489, lng: 128.6409 }));
  assert.ok(insideAny(ps, { lat: 36.0569, lng: 128.6489 }));
  assert.ok(!insideAny(ps, { lat: 36.0529, lng: 128.6449 }));
});

test("명소 저장 검사", () => {
  const base = {
    name: "침산공원", album: "town", open: 0, close: 1440, dwell: 40, kidFit: 0.6,
    points: [{ lat: 35.895, lng: 128.585, r: 300, name: "정문" }], closedDays: [1, 1, 9], tempClosed: ["2026-11-03", "bad"],
    facilities: ["수유실", "수유실"], mission: { quiz: { q: "", options: [] }, find: "" },
  };
  const ok = parsePlaceInput(base);
  assert.ok("ok" in ok);
  if ("ok" in ok) {
    assert.deepEqual(ok.ok.closedDays, [1]);
    assert.deepEqual(ok.ok.tempClosed, ["2026-11-03"]);
    assert.deepEqual(ok.ok.facilities, ["수유실"]);
    assert.equal(ok.ok.mission, null);
    assert.equal(ok.ok.active, true);
  }
  assert.deepEqual(parsePlaceInput({ ...base, name: " " }), { error: "이름을 적어 주세요" });
  assert.ok("error" in parsePlaceInput({ ...base, open: 600, close: 600 }));
  assert.ok("error" in parsePlaceInput({ ...base, points: [] }));
  assert.ok("error" in parsePlaceInput({ ...base, album: "nope" }));
});

test("맛집 검사: 편의 칩은 정해진 것만", () => {
  const r = parseRestaurantInput({ name: "국밥", facilities: ["유아 의자", "없는칩"], placeId: "chimsan" });
  assert.ok("ok" in r && r.ok.facilities.length === 1 && r.ok.placeId === "chimsan");
});

test("관리자 쿠키: 서명·만료", () => {
  process.env.ADMIN_PASSWORD = "pw-1";
  const now = 1_800_000_000_000;
  const v = newSessionValue(now);
  assert.ok(validSession(v, now + 1000));
  assert.ok(!validSession(v, now + 13 * 3600_000)); // 12시간 지남
  assert.ok(!validSession(v.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now));
  process.env.ADMIN_PASSWORD = "pw-2"; // 비밀번호를 바꾸면 이전 쿠키 무효
  assert.ok(!validSession(v, now));
  delete process.env.ADMIN_PASSWORD;
  assert.ok(!validSession(v, now));
});
