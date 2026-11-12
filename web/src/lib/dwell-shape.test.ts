/* 머무는 시간 맞춤 — 코스 → 머문 기록, 또래 통계 고르기, 화면 글 (DB 없이). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { crowdText, cutByClose, dwellView, learnable, pickCrowd, visitDwell, visitsFromCourse } from "./dwell-shape";
import { defaultProfile, type Place } from "./planner";
import type { CourseJson } from "./livecourse";

const stop = (placeId: string, status: string, a?: number, d?: number) =>
  ({ placeId, status, plannedArriveMin: 0, plannedDepartMin: 0, dwellGuessMin: 60, ...(a != null ? { actualArriveMin: a } : {}), ...(d != null ? { actualDepartMin: d } : {}) }) as CourseJson["stops"][number];
const course = (stops: CourseJson["stops"]) => ({ stops } as CourseJson);

test("새로 다녀온 곳만 기록 (이미 DONE이던 곳·시각 없는 곳은 빼고)", () => {
  const before = course([stop("seokgul", "DONE", 540, 570), stop("samguk", "ARRIVED", 600), stop("dgsm", "PLANNED")]);
  const after = course([stop("seokgul", "DONE", 540, 570), stop("samguk", "DONE", 600, 760), stop("dgsm", "SKIPPED")]);
  assert.deepEqual(visitsFromCourse(before, after), [{ placeId: "samguk", arriveMin: 600, departMin: 760 }]);
  assert.deepEqual(visitsFromCourse(null, course([stop("x", "DONE", 600)])), []);
});

test("머문 분·문 닫아 나옴·배울 만한가", () => {
  assert.equal(visitDwell({ placeId: "samguk", arriveMin: 590, departMin: 760 }, 600), 160);
  assert.equal(cutByClose(1077, 1080), true);
  assert.equal(cutByClose(1000, 1080), false);
  assert.equal(cutByClose(1439, 1440), false); // 상시 개방
  assert.equal(learnable(9, false), false);
  assert.equal(learnable(60, true), false);
  assert.equal(learnable(60, false), true);
});

test("또래 값 고르기: 비 오는 날 실내 → 주말 → 전체, 10가족 미만은 안 씀", () => {
  const rows = [
    { place_id: "dgsm", bucket: "all", n_families: 23, p50: 110, p75: 150 },
    { place_id: "dgsm", bucket: "weekend", n_families: 12, p50: 120, p75: 160 },
    { place_id: "dgsm", bucket: "rain", n_families: 10, p50: 130, p75: 170 },
    { place_id: "samguk", bucket: "all", n_families: 9, p50: 100, p75: 120 },
    { place_id: "eworld", bucket: "all", n_families: 15, p50: 150, p75: 200 },
    { place_id: "eworld", bucket: "rain", n_families: 11, p50: 90, p75: 100 },
  ];
  const indoor = (id: string) => id === "dgsm";
  assert.deepEqual(pickCrowd(rows, { weekend: true, rainy: true, indoor }), { dgsm: { p75: 170, n: 10 }, eworld: { p75: 200, n: 15 } });
  assert.deepEqual(pickCrowd(rows, { weekend: false, rainy: false, indoor }), { dgsm: { p75: 150, n: 23 }, eworld: { p75: 200, n: 15 } });
  assert.equal(crowdText(rows[0]), "같은 또래 가족 보통 1시간 50분 (23가족)");
  assert.equal(crowdText(rows[3]), null);
});

test("머무름 출처 글", () => {
  const p = { id: "dgsm", dwellP80Min: 120 } as Place;
  const prof = defaultProfile({ lat: 35.8858, lng: 128.5828 });
  assert.deepEqual(dwellView(prof, p), { minutes: 120, source: "base", n: 0, text: "조사값(4살 기준)" });
  assert.deepEqual(dwellView({ ...prof, crowdDwell: { dgsm: { p75: 150, n: 23 } } }, p), { minutes: 140, source: "crowd", n: 23, text: "같은 또래 가족 23곳 기준" });
  assert.deepEqual(dwellView({ ...prof, placeDwell: { dgsm: { avg: 90, n: 3 } } }, p), { minutes: 105, source: "family", n: 3, text: "우리 가족 기록 3번" });
});
