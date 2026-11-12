/* /api/phone/arrive 희귀·몇 번째 방문 (차 엔진 TripEngine.grant와 같은 규칙). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { arriveReplyPayload, rareFor, skyMinute } from "./arrive";
import { rareStampOf, hourText, lightOnMin, isEvening, isNight, defaultProfile, type Place } from "./planner";
import { parseArrive } from "./stamp-verify";

test("희귀: 주차한 때 비면 '비 오는 날' — 모든 명소, 축제는 없음, 날씨 모름·눈·맑음은 없음", () => {
  assert.equal(rareFor("RAIN", false), "비 오는 날");
  assert.equal(rareFor("RAIN", true), null);
  assert.equal(rareFor("UNKNOWN", false), null);
  assert.equal(rareFor("SNOW", false), null);
  assert.equal(rareFor("CLEAR", false), null);
});

test("날씨 볼 시각: 오늘 보낸 도착 시각, 미래·지난 날·이상한 값이면 지금", () => {
  const now = new Date("2026-10-31T03:00:00Z"); // 한국 12:00
  assert.equal(skyMinute("2026-10-31T02:10:00Z", now), 11 * 60 + 10);
  assert.equal(skyMinute("2026-10-30T02:10:00Z", now), 12 * 60);
  assert.equal(skyMinute("2026-10-31T05:00:00Z", now), 12 * 60);
  assert.equal(skyMinute("엉터리", now), 12 * 60);
  assert.equal(skyMinute("2026-10-30T15:30:00Z", now), 30); // 한국 0:30 = 오늘
});

test("답 payload: 번호·방문 수는 늘, 희귀·쉿·축제는 있을 때만", () => {
  assert.deepEqual(arriveReplyPayload({ number: 12, rare: null, silent: false, visit: 1 }), { number: 12, visit: 1 });
  assert.deepEqual(arriveReplyPayload({ number: 13, rare: "비 오는 날", silent: true, visit: 3 }), { number: 13, visit: 3, rare: "비 오는 날", silent: true });
  assert.deepEqual(
    arriveReplyPayload({ number: 14, rare: null, silent: false, visit: 1, festival: { id: "fest-palgong-2026", season: "2026 가을" } }),
    { number: 14, visit: 1, festivalId: "fest-palgong-2026", season: "2026 가을" },
  );
  assert.equal(arriveReplyPayload({ number: 1, rare: null, silent: false, visit: 0 }).visit, 1);
});

test("도착 요청: silent는 true일 때만 켜짐", () => {
  const base = { placeId: "chimsan", gpsPathKm: 3, straightKm: 2, source: "phone", reason: "STOP_3MIN", verdict: "granted" };
  const on = parseArrive({ ...base, silent: true });
  const off = parseArrive({ ...base, silent: "yes" });
  assert.ok("ok" in on && on.ok.silent === true);
  assert.ok("ok" in off && off.ok.silent === false);
});

test("희귀 '밤': 해 진 뒤 + 밤 명소만, 비가 먼저, 축제·해 지기 전·밤 명소 아님은 없음 (엔진 RareStamp와 같음)", () => {
  const n = (nowMin: number, sunsetMin: number | null, nightBest = true) => ({ nowMin, sunsetMin, nightBest });
  assert.equal(rareFor("CLEAR", false, n(18 * 60, 17 * 60 + 25)), "밤");
  assert.equal(rareFor("UNKNOWN", false, n(18 * 60, 17 * 60 + 25)), "밤");
  assert.equal(rareFor("RAIN", false, n(18 * 60, 17 * 60 + 25)), "비 오는 날");
  assert.equal(rareFor("CLEAR", true, n(18 * 60, 17 * 60 + 25)), null);
  assert.equal(rareFor("CLEAR", false, n(17 * 60, 17 * 60 + 25)), null);
  assert.equal(rareFor("CLEAR", false, n(18 * 60, null)), null);
  assert.equal(rareFor("CLEAR", false, n(18 * 60, 17 * 60 + 25, false)), null);
  const p: Place = { id: "x", name: "x", at: { lat: 35.9, lng: 128.6 }, indoor: false, dwellP80Min: 40, kidFit: 0.7, openMin: 0, closeMin: 1440, popular: 0, stampable: true };
  assert.equal(rareStampOf({ ...p, moments: { best: ["night"] } }, "CLEAR", 1100, 1045), "밤");
  assert.equal(rareStampOf({ ...p, tags: ["야경"] }, "CLEAR", 1100, 1045), "밤");
  assert.equal(rareStampOf(p, "CLEAR", 1100, 1045), null);
});

test("저녁 도우미: 시각 글 · 조명 시각 · 저녁 모드 경계 (엔진 Planner와 같음)", () => {
  assert.equal(hourText(19 * 60), "7시");
  assert.equal(hourText(19 * 60 + 30), "7시 반");
  assert.equal(hourText(12 * 60 + 5), "12시 5분");
  assert.equal(lightOnMin({ best: ["night"], lightOn: "sunset+15" }, 1045), 1060);
  assert.equal(lightOnMin({ best: ["night"], lightOn: "sunset-10" }, 1045), 1035);
  assert.equal(lightOnMin({ best: ["night"], lightOn: "18:30" }, null), 1110);
  assert.equal(lightOnMin({ best: ["night"], lightOn: "sunset" }, null), null);
  const kids = defaultProfile({ lat: 35.88, lng: 128.58 });
  const sky = { sunriseMin: 420, sunsetMin: 17 * 60 + 25, sky: "CLEAR" as const, rainFromMin: null };
  assert.equal(isEvening(17 * 60 + 24, kids, sky), false);
  assert.equal(isEvening(17 * 60 + 25, kids, sky), true);
  assert.equal(isEvening(19 * 60 + 30, kids, sky), true);
  assert.equal(isEvening(19 * 60 + 31, kids, sky), false);
  assert.equal(isNight(19 * 60 + 31, kids, sky), true);
  const couple = { ...kids, companion: "couple" as const };
  assert.equal(isNight(21 * 60 + 30, couple, sky), false);
  assert.equal(isNight(21 * 60 + 31, couple, sky), true);
  assert.equal(isNight(21 * 60 + 31, { ...couple, lateReturnMin: 24 * 60 - 1 }, sky), false);
});

test("도장북 칸: 비 오는 날 디아크 · 밤의 ○○(칸 있는 곳만) · 그 밖은 장소 (폰 albumKeyOf · 차 StampAlbum.keyOf와 같음)", async () => {
  const { albumKeyOf } = await import("./arrive");
  assert.equal(albumKeyOf("thearc", "비 오는 날"), "thearc_rain");
  assert.equal(albumKeyOf("suseongmot", "밤"), "suseongmot_night");
  assert.equal(albumKeyOf("unamji", "밤"), "unamji");
  assert.equal(albumKeyOf("aquarium", "비 오는 날"), "aquarium");
  assert.equal(albumKeyOf("eworld", null), "eworld");
});
