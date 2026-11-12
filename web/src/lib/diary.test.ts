/* '그날의 기록' 사실 모으기·기본 문장·AI 글 검사 — lib/diary-shape.ts · lib/ai-text.ts. 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CourseJson, OptionJson } from "./livecourse";
import {
  buildFacts, checkStory, clockKo, dateText, diaryDayError, durKo, editText, factLines, fallbackStory, needsStory, parseStoryJson,
  stampKey, storyPrompt, storyView, type DiaryRaw,
} from "./diary-shape";
import { parseTextModels, readChat } from "./ai-text";

const DAY = "2026-11-08"; // 일요일
const at = (hhmm: string, day = DAY) => new Date(`${day}T${hhmm}:00+09:00`);
const course = (over: Partial<CourseJson> = {}): CourseJson => ({
  id: "lc-1", version: 9, chosenBy: "폰:아빠", chosenAtMin: 500, nowMin: 900, here: null, arriveHomeMin: 962, limitMin: 1050, slackMin: 60,
  rainFromMin: null, roadFactor: 1, dwellScale: 1, napTaken: false, etaPending: null,
  stops: [
    { placeId: "nmd", status: "DONE", plannedArriveMin: 535, plannedDepartMin: 615, actualArriveMin: 535, actualDepartMin: 615, dwellGuessMin: 80, name: "국립대구박물관", lat: 35.84, lng: 128.64 },
    { placeId: "thearc", status: "DONE", plannedArriveMin: 658, plannedDepartMin: 730, actualArriveMin: 658, actualDepartMin: 730, dwellGuessMin: 72, name: "디아크", lat: 35.79, lng: 128.47 },
    { placeId: "dgsm", status: "SKIPPED", plannedArriveMin: 800, plannedDepartMin: 860, dwellGuessMin: 60, name: "국립대구과학관" },
  ] as unknown as CourseJson["stops"],
  legs: [{ kind: "HOME", fromMin: 900, toMin: 962 }], warnings: [],
  ...over,
});
const option = {
  kind: "COURSE", label: "1순위", stops: [{ id: "nmd", name: "국립대구박물관", lat: 35.84, lng: 128.64, indoor: true, stampable: true }],
  firstLegMin: 25, detourMin: null, arriveHomeMin: 962, arriveHome: "16:02",
  legs: [{ kind: "DRIVE", fromMin: 510, toMin: 535, placeId: "nmd" }], reasons: [],
} as OptionJson;
const raw = (over: Partial<DiaryRaw> = {}): DiaryRaw => ({
  day: DAY, today: "2026-11-09", course: course(), option, sky: { sky: "RAIN", rainFromMin: 480 }, companion: "kids",
  stamps: [
    { id: "s1", place_id: "nmd", payload: { number: 3 }, created_at: at("08:56") },
    { id: "s2", place_id: "thearc", payload: { number: 4, rare: "비 오는 날" }, created_at: at("10:59") },
  ],
  dwell: [], ext: [], summary: { created_at: at("16:02"), payload: { km: 58.84 } }, departMin: 510,
  nameOf: () => null,
  ...over,
});

test("날짜·시각·시간 글", () => {
  assert.equal(dateText(DAY), "11월 8일 일요일");
  assert.equal(clockKo(510), "오전 8:30");
  assert.equal(clockKo(720), "오후 12:00");
  assert.equal(clockKo(962), "오후 4:02");
  assert.equal(durKo(80), "1시간 20분");
  assert.equal(durKo(60), "1시간");
  assert.equal(durKo(45), "45분");
  assert.equal(stampKey("thearc", { rare: "비 오는 날" }), "thearc_rain");
  assert.equal(stampKey("nmd", { festivalId: "fest-x" }), "fest-x");
});

test("볼 수 있는 날", () => {
  assert.equal(diaryDayError("2026-11-08", "2026-11-09"), null);
  assert.match(diaryDayError("2026-11-10", "2026-11-09")!, /아직/);
  assert.match(diaryDayError("2026-02-30", "2026-11-09")!, /YYYY/);
  assert.match(diaryDayError("2025-01-01", "2026-11-09")!, /1년/);
});

test("사실: 코스의 실제 시각·도장·날씨·주행·귀가", () => {
  const f = buildFacts(raw());
  assert.equal(f.done, true);
  assert.deepEqual(f.weather, { sky: "RAIN", label: "비" });
  assert.deepEqual(f.depart, { min: 510, approx: false });
  assert.deepEqual(f.stops.map((s) => [s.placeId, s.arriveMin, s.departMin, s.stayMin, s.stamps]), [
    ["nmd", 535, 615, 80, ["s1"]],
    ["thearc", 658, 730, 72, ["s2"]],
  ]); // 뺀 곳(SKIPPED)은 없음
  assert.deepEqual(f.stamps.map((s) => [s.key, s.number, s.rare, s.atMin]), [["nmd", 3, null, 536], ["thearc_rain", 4, "비 오는 날", 659]]);
  // 운전 = 25 + 43 + (962 − 730) = 300
  assert.deepEqual(f.drive, { km: 58.8, min: 300, approx: false });
  assert.equal(f.homeMin, 962);
  assert.equal(f.nap, null);
});

test("사실: 출발 기록이 없으면 첫 이동 시간으로 어림, 요약이 없으면 오늘은 아직", () => {
  const f = buildFacts(raw({ departMin: null, summary: null, today: DAY }));
  assert.deepEqual(f.depart, { min: 510, approx: true });
  assert.equal(f.done, false);
  assert.equal(f.homeMin, null);
  assert.equal(f.drive, null);
  // 지난 날이면 요약이 없어도 끝난 날
  assert.equal(buildFacts(raw({ summary: null })).done, true);
});

test("사실: 코스 없이 도장·머무름·다녀옴만, 이름은 표에서", () => {
  const f = buildFacts(raw({
    course: null, option: null, sky: null, departMin: null, summary: null,
    stamps: [{ id: "s9", place_id: "hwabon", payload: { number: 1 }, created_at: at("11:10") }],
    dwell: [{ place_id: "hwabon", arrive_min: 660, depart_min: 735 }],
    ext: [{ ext_id: "ext:tour:1", name: "사유원", lat: 36.0, lng: 128.6, visited_at: at("13:00") }],
    nameOf: (id) => (id === "hwabon" ? { name: "화본역", lat: 36.1, lng: 128.7 } : null),
  }));
  assert.deepEqual(f.stops.map((s) => [s.name, s.arriveMin, s.stayMin, s.stamps.length]), [["화본역", 660, 75, 1], ["사유원", 780, null, 0]]);
  assert.equal(f.weather, null);
  assert.equal(f.depart, null);
});

test("사실: 낮잠은 아이와 + 낮잠 이동을 실제로 했을 때만", () => {
  const nap = { kind: "NAP_DRIVE" as const, fromMin: 730, toMin: 762 };
  assert.deepEqual(buildFacts(raw({ course: course({ napLeg: nap }) })).nap, { min: 32, fromMin: 730 }); // 집으로 가는 낮잠 + 집 도착
  assert.equal(buildFacts(raw({ course: course({ napLeg: nap }), summary: null })).nap, null);
  assert.equal(buildFacts(raw({ course: course({ napLeg: nap }), companion: "couple" })).nap, null);
});

test("기본 문장: 부모 기록·아이 일기, 사실만", () => {
  const f = buildFacts(raw({ course: course({ napLeg: { kind: "NAP_DRIVE", fromMin: 730, toMin: 762 } }) }));
  assert.equal(fallbackStory(f, "parent"),
    "비 오는 날, 오전 8:30에 집을 나섰어요. 국립대구박물관에서 1시간 20분, 디아크에서 1시간 12분을 보냈어요. 도장은 2개(희귀 도장 1개 포함) 받았어요. 돌아오는 길엔 차에서 32분 낮잠 시간을 가졌고, 오후 4:02에 집에 도착했어요.");
  assert.equal(fallbackStory(f, "child"),
    "오늘 나는 비 오는 날 오전 8:30에 집을 나섰다. 국립대구박물관에서 1시간 20분 동안 놀았다. 디아크에서 1시간 12분 동안 놀았다. 도장을 2개 받았다. 돌아오는 차에서 32분 동안 낮잠 시간을 가졌다. 오후 4:02에 집에 왔다.");
  const g = buildFacts(raw({ course: null, option: null, departMin: null, summary: null, sky: null, dwell: [], stamps: [{ id: "s1", place_id: "nmd", payload: {}, created_at: at("09:00") }], nameOf: () => ({ name: "국립대구박물관", lat: 1, lng: 1 }) }));
  assert.equal(fallbackStory(g, "parent"), "국립대구박물관에 들렀어요. 도장은 1개 받았어요.");
  // 기본 문장의 숫자는 모두 사실에 있다 (검사를 그대로 통과)
  assert.ok(checkStory(fallbackStory(f, "parent"), f, "parent"));
  assert.ok(checkStory(fallbackStory(f, "child"), f, "child"));
});

test("AI 글 검사: 사실에 없는 숫자·너무 짧음은 버림, 이모지·따옴표는 다듬음", () => {
  const f = buildFacts(raw());
  assert.equal(checkStory("빗소리를 들으며 오전 8:30에 집을 나섰어요. 국립대구박물관에서 1시간 20분을 보냈어요.", f, "parent")?.startsWith("빗소리"), true);
  assert.equal(checkStory("오전 9:15에 출발했어요. 박물관에서 오래 놀았어요.", f, "parent"), null); // 9·15 없음
  assert.equal(checkStory("좋았어요", f, "parent"), null);
  assert.equal(checkStory(42, f, "parent"), null);
  assert.equal(checkStory("\"디아크에서 1시간 12분 놀았어요 🌧\"", f, "parent"), "디아크에서 1시간 12분 놀았어요");
  assert.equal(checkStory("나는 디아크에서 1시간 12분 동안 놀았다.", f, "child"), "오늘 나는 디아크에서 1시간 12분 동안 놀았다.");
  assert.deepEqual(parseStoryJson('네, 여기요: {"parent":"가","child":"나"} 끝'), { parent: "가", child: "나" });
  assert.deepEqual(parseStoryJson("JSON 아님"), {});
});

test("AI에 넘기는 글: 사실 목록만, 이름 금지", () => {
  const f = buildFacts(raw());
  const lines = factLines(f);
  assert.ok(lines.includes("집에서 출발: 오전 8:30"));
  assert.ok(lines.includes("1번째로 들른 곳: 국립대구박물관, 도착 오전 8:55, 머문 시간 1시간 20분, 도장 받음"));
  assert.ok(lines.includes("2번째로 들른 곳: 디아크, 도착 오전 10:58, 머문 시간 1시간 12분, 희귀 도장(비 오는 날) 받음"));
  assert.ok(lines.includes("달린 거리: 58.8km"));
  const p = storyPrompt(f, ["parent", "child"]);
  assert.match(p.system, /사람 이름을 쓰지 마/);
  assert.match(p.system, /"parent": "…", "child": "…"/);
  assert.match(storyPrompt(f, ["child"], ["지안"]).system, /지안만/);
});

test("저장 모양: 다시 만들 때·보이기·고친 글", () => {
  const now = new Date("2026-11-08T10:00:00Z");
  assert.equal(needsStory(undefined, now), true);
  assert.equal(needsStory({ text: "a", by: "ai", at: "2026-11-08T00:00:00Z" }, now), false);
  assert.equal(needsStory({ text: "a", by: "facts", at: "2026-11-08T09:30:00Z" }, now), false);
  assert.equal(needsStory({ text: "a", by: "facts", at: "2026-11-08T08:00:00Z" }, now), true);
  assert.equal(needsStory({ text: "a", by: "edit", at: "2026-11-08T08:00:00Z" }, now), false);
  assert.deepEqual(storyView({ parent: { text: "p", by: "ai", at: "2026-11-08T07:00:00Z" } }), {
    parent: "p", child: null, generatedAt: "2026-11-08T07:00:00Z", by: { parent: "ai", child: null },
  });
  assert.deepEqual(editText("  두 줄\r\n글  "), { ok: true, text: "두 줄\n글" });
  assert.equal(editText("   ").ok, false);
  assert.equal(editText("가".repeat(801)).ok, false);
});

test("글 AI: 모델 목록·답 읽기", () => {
  assert.deepEqual(parseTextModels({ data: [{ id: "img-x", mode: "image_generation" }, { id: "talk-a", mode: "chat" }, { id: "embed-y" }, { id: "talk-b" }] }), ["talk-a", "talk-b"]);
  assert.equal(readChat({ choices: [{ message: { content: "안녕" } }] }), "안녕");
  assert.equal(readChat({ choices: [{ message: { content: [{ type: "text", text: "가" }, { type: "text", text: "나" }] } }] }), "가나");
  assert.equal(readChat({}), "");
});
