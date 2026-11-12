/*
 * 코스 편집 미리 보기(다녀온 곳이 있는 살아 있는 코스) — lib/course.ts simulateEdit.
 * 남은 곳 순서(Remote) + 오늘만 머무름(SetDwell)을 메모리에서만 적용: 다녀온 곳은 그대로, 남은 곳은 새 순서, 머무름은 정한 값.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { course, hhmm, limitMin, type Place } from "./planner";
import { courseFromJson, courseToJson, eventFromJson, fromOption, LiveCourseEngine } from "./livecourse";
import { DEFAULT_FAMILY, toProfile } from "./plan";
import { simulateEdit, type Engine } from "./course";

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, "../../db/places.seed.json"), "utf8")) as Record<string, never>[];
const clock = (t: string) => (t === "24:00" ? 24 * 60 : hhmm(t));
const places: Place[] = seed.map((m: Record<string, never>) => ({
  id: m.id, name: m.name, at: { lat: m.lat, lng: m.lng }, indoor: m.indoor, dwellP80Min: m.dwell, kidFit: m.kidFit,
  openMin: clock(m.open), closeMin: clock(m.close), popular: m.popular, stampable: m.stampable,
}));
const byId = new Map(places.map((p) => [p.id, p]));
const home = { lat: 35.8858, lng: 128.5828 };
const profile = toProfile(DEFAULT_FAMILY, home);
const sky = { sunriseMin: hhmm("06:47"), sunsetMin: hhmm("17:41"), sky: "CLEAR" as const, rainFromMin: null };

const eng: Engine = { engine: new LiveCourseEngine(profile, places), find: (id) => byId.get(id) ?? null, catalog: places };

test("코스 편집(다녀온 곳 있음): 남은 곳 순서·머무름만 바뀌고 다녀온 곳은 그대로, 저장 없이", () => {
  const now = hhmm("08:30");
  const opt = course(now, home, profile, ["hwabon", "samguk", "dgsm"].map((id) => byId.get(id)!), sky)!;
  assert.ok(opt);
  let c = fromOption(opt, { backByMin: limitMin("MORNING", profile, sky), sky }, "폰:엄마", now, home, profile);
  // 화본역 도착 → 머무는 중
  const at = c.stops[0].plannedArriveMin;
  const t = `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
  c = eng.engine.apply(c, eventFromJson({ type: "Arrived", now: t, place: "hwabon" }, c, eng.find)).course;
  const row = { day: "2026-10-31", course: courseToJson(c) };
  const before = JSON.stringify(row.course);
  const out = simulateEdit(eng, row, ["dgsm", "samguk"], { dgsm: 120 }, "폰:엄마");
  assert.equal(JSON.stringify(row.course), before, "저장된 코스는 안 건드림");
  const live = courseFromJson(out, eng.find);
  assert.equal(live.stops.find((s) => s.place.id === "hwabon")?.status, "ARRIVED", "머무는 곳은 그대로");
  assert.deepEqual(live.stops.map((s) => s.place.id), ["hwabon", "dgsm", "samguk"], "남은 곳은 새 순서");
  const hw = live.stops.find((s) => s.place.id === "dgsm")!;
  assert.equal(hw.dwellGuessMin, 120);
  assert.equal(hw.dwellSet, true);
  // 안 건드린 남은 곳은 원래 머무름 그대로 (조사값으로 돌아가지 않음)
  const keep = (x: { stops: { place: { id: string }; dwellGuessMin: number }[] }) => x.stops.find((s) => s.place.id === "samguk")!.dwellGuessMin;
  const tweaked = courseFromJson({ ...row.course, stops: row.course.stops.map((s) => (s.placeId === "samguk" ? { ...s, dwellGuessMin: 95 } : s)) }, eng.find);
  const kept = courseFromJson(simulateEdit(eng, { day: row.day, course: courseToJson(tweaked) }, ["dgsm", "samguk"], {}, "폰:엄마"), eng.find);
  assert.equal(keep(kept), 95);
  assert.equal(keep(live), keep(c));
  // 남은 곳을 다른 곳으로 바꾸기
  const swap = simulateEdit(eng, row, ["samguk"], {}, "폰:엄마");
  const ids = swap.stops.filter((s) => s.status !== "SKIPPED").map((s) => s.placeId);
  assert.deepEqual(ids, ["hwabon", "samguk"]);
  assert.ok(swap.arriveHomeMin < out.arriveHomeMin, "한 곳 빼면 일찍 귀가");
  assert.throws(() => simulateEdit(eng, { day: row.day, course: null }, ["samguk"], {}, "차"));
});
