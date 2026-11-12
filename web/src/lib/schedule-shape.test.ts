/* 일정 탭 (GET /api/plan/schedule · POST /api/plan/schedule/move) 모양·판정 — lib/schedule-shape.ts. 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Place } from "./planner";
import type { CourseJson } from "./livecourse";
import type { OptionJson } from "./plan";
import { closedMessage, closedOnDay, dayLabel, moveDayError, moveInput, pastItem, upcomingItem, type ScheduleRow } from "./schedule-shape";

const extJ = { name: "대구 동화사", lat: 35.9934, lng: 128.6997, indoor: false, dwell: 90, open: 540, close: 1080, kidFit: 0.6 };
const course = (stops: Partial<CourseJson["stops"][number] & { name: string; lat: number; lng: number; ext: unknown }>[]): CourseJson => ({
  id: "lc-1", version: 3, chosenBy: "폰:아빠", chosenAtMin: 500, nowMin: 510, here: null, arriveHomeMin: 990, limitMin: 1050, slackMin: 60,
  rainFromMin: null, roadFactor: 1, dwellScale: 1, napTaken: false, etaPending: null,
  stops: stops.map((s, i) => ({ placeId: `p${i}`, status: "PLANNED", plannedArriveMin: 540 + i * 120, plannedDepartMin: 630 + i * 120, dwellGuessMin: 90, ...s })) as CourseJson["stops"],
  legs: [{ kind: "DRIVE", fromMin: 510, toMin: 540 }], warnings: [],
});
const option = (label: string, stops: { id: string; name: string }[], anchorId?: string): OptionJson => ({
  kind: "COURSE", label, stops: stops.map((s) => ({ ...s, lat: 35.9, lng: 128.6, indoor: true, stampable: true })),
  firstLegMin: 30, detourMin: null, arriveHomeMin: 990, arriveHome: "16:30", legs: [], reasons: [], ...(anchorId ? { anchorId } : {}),
} as OptionJson);
const row = (c: CourseJson, o: OptionJson, day = "2026-11-07"): ScheduleRow => ({
  id: "11111111-1111-1111-1111-111111111111", day, options: [o], chosen: 0, chosen_by: "폰:엄마", course: c, course_version: 4, companion: "kids",
});

test("dayLabel: '11/7(토)'", () => {
  assert.equal(dayLabel("2026-11-07"), "11/7(토)");
  assert.equal(dayLabel("2026-11-01"), "11/1(일)");
});

test("다가오는 나들이: 이름은 코스 → 카드 → 명소 표, 빠진 곳은 안 보임, 출발·귀가·고른 사람", () => {
  const c = course([
    { placeId: "dgsm", name: "국립대구과학관", lat: 35.68, lng: 128.45 },
    { placeId: "hwabon", status: "SKIPPED" },
    { placeId: "samguk" },
    { placeId: "weather" },
  ]);
  const o = option("고른 코스", [{ id: "samguk", name: "삼국유사테마파크" }]);
  const it = upcomingItem(row(c, o), (id) => (id === "weather" ? { name: "국립대구기상과학관", lat: 35.88, lng: 128.63 } : null));
  assert.deepEqual(it.stops.map((s) => s.name), ["국립대구과학관", "삼국유사테마파크", "국립대구기상과학관"]);
  assert.equal(it.stops[0].lat, 35.68);
  assert.equal(it.stops[1].lat, 35.9); // 카드 좌표
  assert.equal(it.departMin, 510);
  assert.equal(it.arriveHomeMin, 990);
  assert.equal(it.chosenBy, "폰:엄마");
  assert.equal(it.title, "고른 코스");
  assert.equal(it.version, 4);
  assert.equal(it.companion, "kids");
  assert.equal(it.anchorId, undefined);
});

test("다가오는 나들이: 앵커 카드면 anchorId, 이름 없는 바깥 장소는 '고른 곳'", () => {
  const c = course([{ placeId: "ext:tour:1" }, { placeId: "dgsm" }]);
  const it = upcomingItem(row(c, option("국립대구과학관 중심으로", [], "dgsm")), () => null);
  assert.equal(it.anchorId, "dgsm");
  assert.equal(it.title, "국립대구과학관 중심으로");
  assert.equal(it.stops[0].name, "고른 곳");
  assert.equal(it.stops[1].name, "dgsm");
});

test("지난 나들이: 도착·다녀옴 + 그날 도장 + 다녀옴 기록이 visited, 도장 수는 그날 전체", () => {
  const c = course([
    { placeId: "dgsm", status: "DONE" },
    { placeId: "samguk", status: "PLANNED" }, // 코스엔 표시 안 됐지만 도장이 있음
    { placeId: "ext:tour:1", status: "PLANNED" }, // 다녀옴 기록
    { placeId: "hwabon", status: "SKIPPED" },
  ]);
  const it = pastItem(row(c, option("고른 코스", []), "2026-10-31"), () => null, ["samguk", "thearc"], ["ext:tour:1"]);
  assert.deepEqual(it.visited, ["dgsm", "samguk", "ext:tour:1"]);
  assert.equal(it.stampsEarned, 2);
  assert.equal(it.stops.length, 4); // 지난 나들이는 빠진 곳도 보여 줌 (✓ 없이)
});

test("옮길 날: 지난 날·2주 넘음·같은 날·지난 나들이·모양", () => {
  const today = "2026-11-01";
  assert.equal(moveDayError("2026-11-08", "2026-11-07", today), null);
  assert.equal(moveDayError("2026-11-01", "2026-11-07", today), null); // 오늘로 당기기
  assert.equal(moveDayError("2026-11-15", "2026-11-07", today), null); // 14일 뒤까지
  assert.match(moveDayError("2026-11-16", "2026-11-07", today)!, /2주/);
  assert.match(moveDayError("2026-10-31", "2026-11-07", today)!, /지난 날/);
  assert.match(moveDayError("2026-11-07", "2026-11-07", today)!, /같은 날/);
  assert.match(moveDayError("2026-11-08", "2026-10-30", today)!, /지난 나들이/);
  assert.match(moveDayError("11/8", "2026-11-07", today)!, /YYYY-MM-DD/);
  assert.match(moveDayError(undefined, "2026-11-07", today)!, /YYYY-MM-DD/);
});

test("옮길 재료: 빠진 곳 제외, 바깥 장소는 이름·좌표째, 정한 머무름·앵커 머무름", () => {
  const c = course([
    { placeId: "dgsm", dwellSet: true, dwellGuessMin: 120 },
    { placeId: "hwabon", status: "SKIPPED" },
    { placeId: "ext:tour:1", name: "대구 동화사", lat: 35.9934, lng: 128.6997, ext: extJ, dwellGuessMin: 75 },
  ]);
  const m = moveInput(row(c, option("대구 동화사 중심으로", [], "ext:tour:1")));
  assert.equal(m.started, false);
  assert.equal(m.anchor, "ext:tour:1");
  assert.deepEqual(m.dwell, { dgsm: 120, "ext:tour:1": 75 });
  assert.equal(m.stops[0], "dgsm");
  const e = m.stops[1] as Record<string, unknown>;
  assert.equal(e.id, "ext:tour:1");
  assert.equal(e.name, "대구 동화사");
  assert.equal(e.lat, 35.9934);
  assert.equal(e.open, 540);
});

test("옮길 재료: 이미 들른 곳이 있으면 started", () => {
  assert.equal(moveInput(row(course([{ placeId: "dgsm", status: "ARRIVED" }]), option("고른 코스", []))).started, true);
  assert.equal(moveInput(row(course([{ placeId: "dgsm", status: "DONE" }, { placeId: "x" }]), option("고른 코스", []))).started, true);
});

test("그날 쉬는 곳: 쉬는 요일·임시 휴무·그날 없는 축제, 바깥 장소는 넘어감 + 409 글", () => {
  const base = { at: { lat: 0, lng: 0 }, indoor: true, dwellP80Min: 60, kidFit: 1, openMin: 600, closeMin: 1080, popular: 0, stampable: true };
  const places: Record<string, Place> = {
    dgsm: { ...base, id: "dgsm", name: "국립대구과학관", closedDays: [1] } as Place, // 월요일
    weather: { ...base, id: "weather", name: "국립대구기상과학관", closedDates: ["2026-11-03"] } as Place,
    samguk: { ...base, id: "samguk", name: "삼국유사테마파크" } as Place,
  };
  const find = (id: string) => places[id];
  const stops = [
    { id: "dgsm", name: "국립대구과학관" }, { id: "weather", name: "국립대구기상과학관" }, { id: "samguk", name: "삼국유사테마파크" },
    { id: "fest-x", name: "가을 축제" }, { id: "ext:tour:1", name: "대구 동화사" },
  ];
  assert.deepEqual(closedOnDay(stops, find, "2026-11-02"), ["국립대구과학관", "가을 축제"]); // 월
  assert.deepEqual(closedOnDay(stops, find, "2026-11-03"), ["국립대구기상과학관", "가을 축제"]);
  assert.equal(closedMessage("2026-11-02", ["국립대구과학관"]), "11/2(월)에는 국립대구과학관이 문을 열지 않아요. 다른 날을 골라 주세요");
  assert.equal(closedMessage("2026-11-02", ["화본역"]), "11/2(월)에는 화본역이 문을 열지 않아요. 다른 날을 골라 주세요");
  assert.equal(closedMessage("2026-11-02", ["디아크"]), "11/2(월)에는 디아크가 문을 열지 않아요. 다른 날을 골라 주세요");
  assert.equal(closedMessage("2026-11-02", ["가", "나"]), "11/2(월)에는 가, 나 모두 문을 열지 않아요. 다른 날을 골라 주세요");
});
