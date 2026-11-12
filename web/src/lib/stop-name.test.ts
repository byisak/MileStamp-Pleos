/* 바깥 장소(ext:…) 이름 — 장소표 밖이어도 코스 JSON에 실린 이름으로, 날 id는 사람에게 보이지 않는다. 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultProfile, type Place } from "./planner";
import { LiveCourseEngine, UNNAMED_EXT, courseFromJson, courseToJson, eventFromJson, stopName, type CourseJson } from "./livecourse";
import { decorateStops, extHit, extPlacesOf, withExt } from "./ext";

const home = { lat: 35.8858, lng: 128.5828 };
const weather: Place = {
  id: "weather", name: "국립대구기상과학관", at: { lat: 35.8868, lng: 128.6352 }, indoor: true, dwellP80Min: 60, kidFit: 0.9,
  openMin: 600, closeMin: 1080, popular: 0, stampable: true,
};
const extJ = { name: "대구 동화사", lat: 35.9934, lng: 128.6997, indoor: false, dwell: 90, open: 540, close: 1080, kidFit: 0.6 };
const json = (): CourseJson => ({
  id: "lc-1", version: 2, chosenBy: "폰:아빠", chosenAtMin: 500, nowMin: 510, here: null, arriveHomeMin: 900, limitMin: 1050, slackMin: 150,
  stops: [
    { placeId: "ext:tour:126019", status: "NEXT", plannedArriveMin: 540, plannedDepartMin: 630, dwellGuessMin: 90, name: "대구 동화사", lat: 35.9934, lng: 128.6997, ext: extJ },
    { placeId: "weather", status: "PLANNED", plannedArriveMin: 660, plannedDepartMin: 720, dwellGuessMin: 60 },
  ],
  legs: [],
} as unknown as CourseJson);

test("stopName: 실려 온 이름 → 바깥 장소면 '고른 곳' → 그 밖은 id", () => {
  assert.equal(stopName("ext:tour:126019", " 대구 동화사 "), "대구 동화사");
  assert.equal(stopName("ext:tour:126019"), UNNAMED_EXT);
  assert.equal(stopName("ext:tour:126019", ""), UNNAMED_EXT);
  assert.equal(stopName("weather"), "weather");
});

test("장소표 밖 바깥 장소: 사건 이름·바꾸기 문장·저장 JSON 모두 이름으로", () => {
  const catalog = [weather];
  const base = (id: string) => catalog.find((p) => p.id === id) ?? null;
  const find = withExt(base, extPlacesOf(json().stops as never));
  const engine = new LiveCourseEngine(defaultProfile(home), catalog);
  const c = courseFromJson(json(), find);
  assert.equal(c.stops[0].place.name, "대구 동화사");
  assert.equal(engine.describe({ type: "Insert", nowMin: 520, placeId: "ext:tour:126019" }, c), "대구 동화사 들르기");
  assert.equal(engine.describe({ type: "Skip", nowMin: 520, placeId: "ext:tour:999" }), `${UNNAMED_EXT} 빼기`);

  // 빼고 → 다시 다음으로 (장소표에 없어도 코스에 있던 곳이면)
  const skipped = engine.apply(c, eventFromJson({ type: "Skip", now: "08:40", place: "ext:tour:126019" }, c, find)).course;
  assert.equal(skipped.stops.find((s) => s.place.id === "ext:tour:126019")?.status, "SKIPPED");
  const back = engine.apply(skipped, eventFromJson({ type: "ReplaceNext", now: "08:41", place: "ext:tour:126019" }, skipped, find));
  const next = back.course.stops.find((s) => s.status === "NEXT");
  assert.equal(next?.place.id, "ext:tour:126019");
  assert.match(back.change?.text ?? "", /대구 동화사/);
  assert.doesNotMatch(JSON.stringify(back.change), /ext:tour/);

  // 저장·응답 JSON의 곳마다 name (폰·차·오토가 이 칸으로 그린다)
  const out = courseToJson(back.course);
  decorateStops(out.stops, find);
  const s = out.stops.find((x) => x.placeId === "ext:tour:126019") as { name?: string; ext?: { name: string } };
  assert.equal(s.name, "대구 동화사");
  assert.equal(s.ext?.name, "대구 동화사");
});

test("다녀옴 기록: 이름이 아무 데도 없으면 날 id 대신 '고른 곳'", () => {
  assert.equal(extHit("ext:tour:5", { placeId: "ext:tour:5" }).name, UNNAMED_EXT);
  assert.equal(extHit("ext:tour:5", { placeId: "ext:tour:5", ext: { name: "가" } }).name, "가");
});
