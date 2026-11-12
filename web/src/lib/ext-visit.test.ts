/* '다녀옴' 기록 판정 — 코스가 바뀐 뒤 새로 도착·다녀옴이 된 바깥 장소만 (C단계). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extStopOf, newlyVisitedExt } from "./ext";
import { parseArrive } from "./stamp-verify";

const ext = { name: "해운대해수욕장", lat: 35.1587, lng: 129.1604, indoor: false, dwell: 90, open: 600, close: 1080, kidFit: 0.6 };
const stop = (placeId: string, status: string, more: Record<string, unknown> = {}) => ({ placeId, status, ...more });

test("바깥 장소에 도착하면 그 곳 하나만 다녀옴 (이름·좌표는 코스 JSON에서)", () => {
  const before = { stops: [stop("ext:tour:126081", "NEXT", { name: "해운대해수욕장", lat: 35.1587, lng: 129.1604, ext }), stop("dgsm", "PLANNED")] };
  const after = { stops: [stop("ext:tour:126081", "ARRIVED", { name: "해운대해수욕장", lat: 35.1587, lng: 129.1604, ext }), stop("dgsm", "NEXT")] };
  assert.deepEqual(newlyVisitedExt(before, after), [{ extId: "ext:tour:126081", name: "해운대해수욕장", lat: 35.1587, lng: 129.1604 }]);
});

test("이미 도착해 있던 곳이 DONE이 돼도 다시 적지 않음 · 건너뛴 곳은 안 적음", () => {
  const before = { stops: [stop("ext:tour:1", "ARRIVED", { name: "가" }), stop("ext:kto100:7", "NEXT", { name: "나" })] };
  const after = { stops: [stop("ext:tour:1", "DONE", { name: "가" }), stop("ext:kto100:7", "SKIPPED", { name: "나" })] };
  assert.deepEqual(newlyVisitedExt(before, after), []);
});

test("우리 명소·축제(도장 있는 곳)는 다녀옴에 넣지 않음", () => {
  const before = { stops: [stop("hwabon", "NEXT"), stop("fest-palgong-2026", "PLANNED")] };
  const after = { stops: [stop("hwabon", "ARRIVED"), stop("fest-palgong-2026", "DONE")] };
  assert.deepEqual(newlyVisitedExt(before, after), []);
});

test("전 코스가 없으면(처음 저장) 도착·다녀옴인 바깥 장소 · 이름이 없으면 ext.name", () => {
  const after = { stops: [stop("ext:tour:9", "DONE", { ext })] };
  assert.deepEqual(newlyVisitedExt(null, after), [{ extId: "ext:tour:9", name: "해운대해수욕장", lat: 35.1587, lng: 129.1604 }]);
});

test("안드로이드 오토 도착: 오늘 코스에서 바깥 장소 찾기", () => {
  const course = { stops: [stop("ext:tour:126081", "NEXT", { name: "해운대해수욕장", lat: 35.1587, lng: 129.1604 })] };
  assert.equal(extStopOf(course, "ext:tour:126081")?.name, "해운대해수욕장");
  assert.equal(extStopOf(course, "ext:tour:999"), null);
  assert.equal(extStopOf(course, "hwabon"), null);
  assert.equal(extStopOf(null, "ext:tour:126081"), null);
});

test("/api/phone/arrive 요청: 바깥 장소 id 받기, 이상한 id는 거절", () => {
  const body = { odoKm: null, gpsPathKm: 3, straightKm: 2, fromPlaceId: null, source: "phone", reason: "STOP_3MIN", verdict: "granted" };
  assert.ok("ok" in parseArrive({ ...body, placeId: "ext:tour:126081" }));
  assert.ok("ok" in parseArrive({ ...body, placeId: "ext:kto100:12" }));
  assert.ok("ok" in parseArrive({ ...body, placeId: "hwabon" }));
  assert.ok("error" in parseArrive({ ...body, placeId: "ext:other:1" }));
  assert.ok("error" in parseArrive({ ...body, placeId: "ext:tour:" }));
});
