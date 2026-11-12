/*
 * '정한 코스 고르기'(POST /api/plan/choose { planId, stops }, 모든 차)·코스 편집 미리 보기(POST /api/plan/preview) 계산 — lib/choose.ts.
 * 서버 장소표(db/places.seed.json, 34곳 모두 도장)와 시연 조건(토 08:30 집 · 맑음 · 15시부터 비 · 해 짐 17:41)으로 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { course, firstBoarding, hhmm, type Place } from "./planner";
import { courseChoice, coursePreview, placeCandidates, withOption, optionJson, MAX_STOPS } from "./choose";
import { DEFAULT_FAMILY, toProfile } from "./plan";

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, "../../db/places.seed.json"), "utf8")) as Record<string, never>[];
const clock = (t: string) => (t === "24:00" ? 24 * 60 : hhmm(t));
const places: Place[] = seed.map((m: Record<string, never>) => ({
  id: m.id, name: m.name, at: { lat: m.lat, lng: m.lng }, indoor: m.indoor, dwellP80Min: m.dwell, kidFit: m.kidFit,
  openMin: clock(m.open), closeMin: clock(m.close), popular: m.popular, stampable: m.stampable,
}));
const byId = new Map(places.map((p) => [p.id, p]));
const find = (id: string) => byId.get(id);
const home = { lat: 35.8858, lng: 128.5828 };
const profile = toProfile(DEFAULT_FAMILY, home);
const sky = { sunriseMin: hhmm("06:47"), sunsetMin: hhmm("17:41"), sky: "CLEAR" as const, rainFromMin: hhmm("15:00") };
const now = hhmm("08:30");
const STORY = ["hwabon", "samguk", "dgsm"];

test("정한 코스 고르기: 엔진 Planner.course와 같은 '고른 코스' 카드 (모든 차 — 데모 구분 없음)", () => {
  const r = courseChoice(STORY, find, now, home, profile, sky);
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.equal(r.option.label, "고른 코스");
  assert.deepEqual(r.option.stops.map((s) => s.id), STORY);
  assert.deepEqual(r.option, optionJson(course(now, home, profile, STORY.map((id) => byId.get(id)!), sky)!, profile, { nowMin: now, here: home, sky }));
  assert.ok(r.option.stops.every((s) => s.dwell && s.dwell.minutes >= 15), "장소마다 머무름 예상");
  assert.ok(r.option.legs.some((l) => l.kind === "NAP_DRIVE"), "낮잠 이동 칸");
  // 34곳 모두 도장이라 계획 3장엔 이야기 코스가 없을 수 있다 → 끝에 붙여 4번째(번호 3)로 고른다
  const plan = firstBoarding(now, home, profile, places, sky);
  const cards = plan.options.map((o) => optionJson(o));
  const added = withOption(cards, r.option);
  const had = cards.findIndex((o) => o.stops.map((s) => s.id).join() === STORY.join());
  if (had >= 0) assert.equal(added.idx, had);
  else { assert.equal(added.idx, cards.length); assert.equal(added.options.length, cards.length + 1); }
  // 같은 순서를 또 고르면 붙이지 않고 그 카드
  const again = withOption(added.options, r.option);
  assert.equal(again.idx, added.idx);
  assert.equal(again.options, added.options);
});

test("정한 코스 고르기: 모양이 틀리면 400", () => {
  for (const bad of [[], ["hwabon", "hwabon"], ["없는곳"], "hwabon", ["a", "b", "c", "d"], [1]]) {
    const r = courseChoice(bad, find, now, home, profile, sky);
    assert.equal(!r.ok && r.status, 400, JSON.stringify(bad));
  }
  // 시간이 안 맞음 (20:40 출발)
  const late = courseChoice(STORY, find, hhmm("20:40"), home, profile, sky);
  assert.equal(!late.ok && late.status, 400);
});

test("코스 편집 미리 보기: 머무름을 안 바꾸면 고르기 카드와 같고, 한계 안이면 over 아님", () => {
  const r = coursePreview(STORY, undefined, find, now, home, profile, sky);
  assert.ok(r.ok, !r.ok ? r.error : "");
  const c = courseChoice(STORY, find, now, home, profile, sky);
  assert.ok(c.ok);
  assert.deepEqual(r.option, c.option);
  assert.equal(r.fits, true);
  assert.equal(r.over, false);
  assert.equal(r.overMin, 0);
  assert.equal(r.limit, "17:11"); // 해 짐 17:41 − 30분
});

test("코스 편집 미리 보기: 오늘만 머무름을 늘리면 귀가가 늦어지고, 한계를 넘어도 시간표는 준다", () => {
  const one = ["dgsm"];
  const base = coursePreview(one, {}, find, now, home, profile, sky);
  assert.ok(base.ok, !base.ok ? base.error : "");
  const was = base.option.stops[0].dwell!.minutes;
  const more = coursePreview(one, { dgsm: was + 60 }, find, now, home, profile, sky);
  assert.ok(more.ok, !more.ok ? more.error : "");
  assert.ok(more.option.arriveHomeMin > base.option.arriveHomeMin, "귀가가 늦어짐");
  assert.equal(more.option.stops[0].dwell?.minutes, was + 60, "카드의 머무름도 바뀐 값");
  // 12:30에 6시간으로 늘려 한계(17:11)를 넘김 (과학관은 실내라 비와 상관없음)
  const over = coursePreview(one, { dgsm: 360 }, find, hhmm("12:30"), home, profile, sky);
  assert.ok(over.ok, !over.ok ? over.error : "");
  assert.equal(over.fits, false, "늘린 머무름으론 고를 수 없음");
  assert.equal(over.over, true);
  const noDwell = courseChoice(one, find, hhmm("12:30"), home, profile, sky);
  assert.ok(noDwell.ok, "머무름을 안 바꾸면 고를 수 있음");
  const withDwell = courseChoice(one, find, hhmm("12:30"), home, profile, sky, "MORNING", { dgsm: 360 });
  assert.equal(!withDwell.ok && withDwell.status, 400);
  // 줄인 머무름으로는 고르기 카드에도 그 값
  const short = courseChoice(one, find, now, home, profile, sky, "MORNING", { dgsm: 30 });
  assert.ok(short.ok);
  assert.equal(short.option.stops[0].dwell?.minutes, 30);
  assert.equal(over.overMin, over.option.arriveHomeMin - (over.limitMin - 10));
  assert.ok(over.overMin > 0);
  // 값은 15~360분·5분 단위로 맞춤
  const odd = coursePreview(one, { dgsm: 7 }, find, now, home, profile, sky);
  assert.ok(odd.ok);
  assert.equal(odd.option.stops[0].dwell?.minutes, 15);
});

test("코스 편집 미리 보기: 모양이 틀리면 400", () => {
  for (const [stops, dwell] of [[["없는곳"], {}], [STORY, { samguk: "길게" }], [["dgsm"], { hwabon: 60 }], [["dgsm"], [60]], [[], {}]] as [unknown, unknown][]) {
    const r = coursePreview(stops, dwell, find, now, home, profile, sky);
    assert.equal(!r.ok && r.status, 400, JSON.stringify([stops, dwell]));
  }
  assert.equal(MAX_STOPS, 3);
});

test("코스 편집 미리 보기: 오후 계획이면 저녁 시각이 한계", () => {
  const pm = hhmm("16:00");
  const r = coursePreview(["dgsm"], {}, find, pm, home, profile, sky, "AFTERNOON");
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.equal(r.limitMin, Math.min(hhmm("17:11"), DEFAULT_FAMILY.dinner!));
  const m = coursePreview(["dgsm"], {}, find, pm, home, { ...profile, dinnerMin: hhmm("16:30") }, sky, "AFTERNOON");
  assert.ok(m.ok, !m.ok ? m.error : "");
  assert.equal(m.limit, "16:30");
  assert.equal(m.fits, false, "고르기(stops)는 받아 주지 않음");
  assert.equal(m.over, true);
  // 아침 계획이면 저녁 시각은 안 따짐
  const am = coursePreview(["dgsm"], {}, find, pm, home, { ...profile, dinnerMin: hhmm("16:30") }, sky, "MORNING");
  assert.ok(am.ok);
  assert.equal(am.limit, "17:11");
});

test("더할 곳 후보: 코스에서 가까운 순, 실내·머무름 같이", () => {
  const c = placeCandidates(places, [home, byId.get("dgsm")!.at], profile, 10);
  assert.equal(c.length, 10);
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].km <= c[i].km);
  assert.ok(c.every((x) => typeof x.indoor === "boolean" && x.dwell >= 15));
  assert.equal(c[0].id, "dgsm", "코스 위의 곳이 0km");
});

test("앵커 코스 고치기 미리 보기: 순서를 바꿔도 고르기(choose anchor)와 같은 카드, 중심 곳은 뺄 수 없음", () => {
  // 화본역 → 삼국유사 카드를 삼국유사(중심) → 화본역으로 바꿈: 보통 코스로는 안 맞지만 앵커 규칙으론 받음
  const swapped = ["samguk", "hwabon"];
  assert.equal(coursePreview(swapped, undefined, find, now, home, profile, sky).ok, false);
  const pv = coursePreview(swapped, { samguk: 90 }, find, now, home, profile, sky, "MORNING", "samguk");
  assert.ok(pv.ok, !pv.ok ? pv.error : "");
  assert.deepEqual(pv.option.stops.map((s) => s.id), swapped, "바꾼 순서 그대로");
  assert.equal(pv.option.anchorId, "samguk");
  assert.equal(pv.fits, true, "앵커 코스는 한계를 넘어도 고를 수 있음");
  const c = courseChoice(swapped, find, now, home, profile, sky, "MORNING", { samguk: 90 }, "samguk");
  assert.ok(c.ok);
  assert.deepEqual(pv.option, c.option);
  const gone = coursePreview(["hwabon"], undefined, find, now, home, profile, sky, "MORNING", "samguk");
  assert.equal(!gone.ok && gone.status, 400);
});
