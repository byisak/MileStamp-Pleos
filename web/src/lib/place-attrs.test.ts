import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  arrivalLine, arrivalWindows, closedDatesFromRules, completeness, daysLabel, hoursFor, hoursRowsLoose, isStale, KR_HOLIDAYS,
  parseClosedRules, parseFitExtra, parseHoursRows, parseMeta, parseMoments, parseParking, parsePrice, parseRoute, pickHoursRow,
  priceLevel, regionCodeOf, representativeHours, vocabTags, DEFAULT_TAG_VOCAB, type HoursRow,
} from "./place-attrs-shape";
import { closuresFromText, draftFromTour, hoursRowsFromText, parkingFromText, priceFromText } from "./place-attrs-text";
import { parsePlaceInput } from "./catalog-shape";
import { forDay, placeClosedOn, placeOnDay, type Place } from "./planner";

const row = (o: Partial<HoursRow>): HoursRow => ({
  days: [0, 1, 2, 3, 4, 5, 6], holiday: false, openMin: 540, closeMin: 1080, lastEntryMin: null, breaks: [], validFrom: null, validTo: null, note: null, ...o,
});
const ok = <T,>(r: { ok: T } | { error: string }): T => {
  if ("error" in r) throw new Error(r.error);
  return r.ok;
};
const err = (r: { ok: unknown } | { error: string }): string => ("error" in r ? r.error : "(ok)");

// ------------------------------------------------------------------ 운영 시간 줄 검사

test("운영 시간 줄: 자정 넘김 허용 · 마지막 입장 ≤ 닫는 · 브레이크는 영업 안", () => {
  const rows = ok(parseHoursRows([
    { days: [5, 6], openMin: 1080, closeMin: 120, lastEntryMin: 60, note: "야시장" }, // 18:00~다음 날 02:00
    { days: [1, 2, 3, 4], openMin: 660, closeMin: 1260, breaks: [{ fromMin: 900, toMin: 1020 }] },
  ]));
  assert.equal(rows[0].closeMin, 1560);
  assert.equal(rows[0].lastEntryMin, 1500);
  assert.deepEqual(rows[1].breaks, [{ fromMin: 900, toMin: 1020 }]);
  assert.match(err(parseHoursRows([{ days: [1], openMin: 600, closeMin: 1080, lastEntryMin: 1100 }])), /마지막 입장/);
  assert.match(err(parseHoursRows([{ days: [1], openMin: 600, closeMin: 1080, breaks: [{ fromMin: 500, toMin: 700 }] }])), /브레이크/);
  assert.match(err(parseHoursRows([{ days: [], openMin: 600, closeMin: 1080 }])), /요일/);
  assert.match(err(parseHoursRows([{ days: [1], openMin: 600, closeMin: 1080, validFrom: "02-30", validTo: "03-01" }])), /MM-DD/);
  assert.match(err(parseHoursRows([{ days: [1], openMin: 600, closeMin: 1080, validFrom: "07-01" }])), /같이/);
  assert.match(err(parseHoursRows([{ days: [1], openMin: 600, closeMin: 1080, breaks: [{ fromMin: 700, toMin: 800 }, { fromMin: 750, toMin: 900 }] }])), /겹/);
  // DB에서 읽을 땐 이상한 줄만 버린다
  assert.equal(hoursRowsLoose([{ days: [1], openMin: 600, closeMin: 1080 }, { days: [9], openMin: 1, closeMin: 2 }, "x"]).length, 1);
});

test("그날 줄 고르기: 요일 · 계절(해 넘김) · 공휴일 줄 먼저 · 맞는 줄 없으면 쉼", () => {
  const rows = [
    row({ days: [1, 2, 3, 4, 5], openMin: 600, closeMin: 1080 }),
    row({ days: [0, 6], holiday: true, openMin: 540, closeMin: 1140 }),
    row({ days: [5, 6], openMin: 540, closeMin: 1320, validFrom: "07-01", validTo: "08-31", note: "여름 야간 개장" }),
    row({ days: [1, 2, 3, 4, 5], openMin: 600, closeMin: 1020, validFrom: "11-01", validTo: "02-28", note: "겨울" }),
  ];
  assert.equal(pickHoursRow(rows, "2026-10-07")?.closeMin, 1080); // 수 · 보통
  assert.equal(pickHoursRow(rows, "2026-11-04")?.closeMin, 1020); // 수 · 겨울 (기간 줄 먼저)
  assert.equal(pickHoursRow(rows, "2027-01-13")?.note, "겨울"); // 해를 넘긴 기간
  assert.equal(pickHoursRow(rows, "2026-07-10")?.closeMin, 1320); // 금 · 여름 야간
  assert.equal(pickHoursRow(rows, "2026-07-11")?.closeMin, 1320); // 토 · 여름 야간이 주말 줄보다 먼저
  assert.equal(pickHoursRow(rows, "2026-10-09")?.openMin, 540); // 금 · 한글날(공휴일) → 공휴일 줄
  assert.equal(pickHoursRow([row({ days: [2, 3] })], "2026-11-02"), null); // 월 · 줄 없음
  assert.equal(hoursFor({ hours: [row({ days: [2, 3] })], openMin: 540, closeMin: 1080 }, "2026-11-02"), null);
  assert.deepEqual(hoursFor({ hours: [], openMin: 570, closeMin: 1050 }, "2026-11-02"), { openMin: 570, closeMin: 1050, lastEntryMin: null, breaks: [], note: null, source: "columns" });
  assert.equal(hoursFor({ hours: rows, openMin: 0, closeMin: 1 }, "2026-10-07")?.source, "rows");
});

test("평일 대표값 (옛 칸): 기간 없는 수요일 줄 → 다른 평일 → 첫 줄, 닫는 시각은 24시까지", () => {
  assert.deepEqual(representativeHours([row({ days: [0, 6], openMin: 540, closeMin: 1200 }), row({ days: [2, 3], openMin: 600, closeMin: 1080 })]), { open: 600, close: 1080 });
  assert.deepEqual(representativeHours([row({ days: [5, 6], openMin: 1080, closeMin: 1560 })]), { open: 1080, close: 1440 });
  assert.deepEqual(representativeHours([row({ validFrom: "07-01", validTo: "08-31", openMin: 1 }), row({ days: [6], openMin: 600 })]), { open: 600, close: 1080 });
  assert.equal(representativeHours([]), null);
});

test("공휴일 목록이 엔진(Model.kt Holidays.KR)과 같다", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const kt = readFileSync(join(here, "../../../engine/src/main/kotlin/kr/milestamp/engine/Model.kt"), "utf8");
  const block = /object Holidays \{[\s\S]*?\n\}/.exec(kt)![0];
  assert.deepEqual([...block.matchAll(/"(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]), [...KR_HOLIDAYS]);
});

// ------------------------------------------------------------------ 엔진에 입히기

const place = (o: Partial<Place>): Place => ({
  id: "p", name: "곳", at: { lat: 35.9, lng: 128.6 }, indoor: true, dwellP80Min: 60, kidFit: 0.8, openMin: 540, closeMin: 1080, popular: 0, stampable: true, ...o,
});

test("placeOnDay·forDay: 그날 줄의 시각, 줄 없는 날은 빠짐, 날짜 모르면 그대로", () => {
  const p = place({ hours: [row({ days: [2, 3, 4, 5], openMin: 660 }), row({ days: [0, 6], openMin: 540, lastEntryMin: 1050 })] });
  assert.equal(placeOnDay(p, "2026-11-03").openMin, 660);
  assert.equal(placeOnDay(p, "2026-11-07").lastEntryMin, 1050);
  assert.equal(placeOnDay(p, null), p);
  assert.equal(placeClosedOn(p, "2026-11-02"), true);
  assert.equal(placeClosedOn(p, null), false);
  assert.deepEqual(forDay([p], "2026-11-02"), []);
  assert.equal(forDay([p], "2026-11-03")[0].openMin, 660);
  // 줄이 없는 곳은 같은 물건 그대로 (예전 계산과 한 글자도 같게)
  const q = place({ id: "q" });
  assert.equal(forDay([q], "2026-11-03")[0], q);
});

// ------------------------------------------------------------------ 쉬는 날 규칙

test("쉬는 날 규칙 → 날짜: 1월 1일 · 설·추석 당일/연휴 · 공휴일 다음 날 · 쉬는 요일이 공휴일이면 다음 평일", () => {
  assert.deepEqual(closedDatesFromRules(["newyear", "seollal"], "2026-12-30", 50), ["2027-01-01", "2027-02-07"]);
  assert.deepEqual(closedDatesFromRules(["chuseok_all"], "2026-09-01", 40), ["2026-09-24", "2026-09-25", "2026-09-26"]);
  assert.deepEqual(closedDatesFromRules(["holiday_next"], "2026-10-01", 12), ["2026-10-04", "2026-10-06", "2026-10-10"]); // 10/3(토)·10/5(월 대체)·10/9(금) 다음 날
  // 월요일 쉼 + 10/5(월) 대체공휴일 → 10/6(화) 쉼
  assert.deepEqual(closedDatesFromRules(["holiday_shift"], "2026-10-01", 10, [1]), ["2026-10-06"]);
  assert.deepEqual(parseClosedRules(["seollal", "seollal"]), ["seollal"]);
  assert.equal(parseClosedRules(["설날"]), null);
});

// ------------------------------------------------------------------ 주차·가격·시간 특성·어울림·출처

test("주차·가격 검사와 가격 단계", () => {
  assert.deepEqual(ok(parseParking({ has: "limited", fee: "paid", fee_note: " 1시간 1,000원 ", weekend_full: true, walk_min: "5", size: "X" })),
    { has: "limited", fee: "paid", fee_note: "1시간 1,000원", weekend_full: true, walk_min: 5 });
  assert.match(err(parseParking({ has: "maybe" })), /있음·없음·좁음/);
  assert.match(err(parseParking({ has: "yes", walk_min: 99 })), /0~60/);
  assert.deepEqual(ok(parsePrice({ free: true, adult: 3000 })), { free: true, level: 0 });
  assert.deepEqual(ok(parsePrice({ free: false, adult: 3000, child: 1000, child_free_under: 6 })), { free: false, adult: 3000, child: 1000, child_free_under: 6, level: 1 });
  assert.equal(priceLevel({ free: false, adult: 8000, child: 5000 }), 2);
  assert.equal(priceLevel({ free: false, adult: 20000 }), 3);
});

test("시간 특성: 언제 좋은지 · 조명 sunset+N/HH:MM · 쇼 시각은 운영 시간 안 · 달 1~12", () => {
  const hours = [row({ days: [5, 6, 0], openMin: 600, closeMin: 1320 }), row({ days: [1, 2, 3, 4], openMin: 600, closeMin: 1080 })];
  const m = ok(parseMoments({
    best: ["night", "day", "night"], light: { on: "sunset+15", off: "22:30" },
    shows: [{ name: "음악분수", times: ["20:00", "19:00"], days: [5, 6, 0], months: [5, 6, 7, 8, 9, 10] }],
    season: [{ what: "단풍", months: [11, 10] }],
  }, { hours, open: 600, close: 1080 }))!;
  assert.deepEqual(m.best, ["day", "night"]);
  assert.deepEqual(m.shows![0].times, ["19:00", "20:00"]);
  assert.deepEqual(m.season, [{ what: "단풍", months: [10, 11] }]);
  // 평일 줄만 있으면 20:00 쇼는 밖
  assert.match(err(parseMoments({ best: [], shows: [{ name: "쇼", times: ["20:00"], days: [1] }] }, { hours, open: 600, close: 1080 })), /운영 시간 밖/);
  assert.match(err(parseMoments({ best: [], light: { on: "해질녘" } }, { hours: [], open: 0, close: 1440 })), /sunset/);
  assert.match(err(parseMoments({ best: [], season: [{ what: "벚꽃", months: [13] }] }, { hours: [], open: 0, close: 1440 })), /1~12/);
  assert.equal(ok(parseMoments({ best: [], light: { on: "18:40" } }, { hours: [], open: 0, close: 1440 }))!.light!.on, "18:40");
});

test("어울림 확장·출처·종류·지역 코드", () => {
  assert.deepEqual(ok(parseFitExtra({ kid_age: { "0-3": 0.7, "4-6": "1" }, evening: { couple: 0.9 } })), { kid_age: { "0-3": 0.7, "4-6": 1 }, evening: { couple: 0.9 } });
  assert.match(err(parseFitExtra({ kid_age: { "5-8": 1 } })), /모르는 칸/);
  assert.deepEqual(ok(parseMeta({ price: { src: "ai", conf: 0.6, at: "2026-11-02", check: true }, zzz: {} })), { price: { src: "ai", conf: 0.6, at: "2026-11-02", check: true } });
  assert.match(err(parseMeta({ hours: { src: "who", conf: 1, at: "2026-11-02" } })), /출처/);
  assert.equal(isStale({ src: "admin", conf: 1, at: "2026-07-01" }, "2026-11-02"), true);
  assert.equal(isStale({ src: "admin", conf: 1, at: "2026-10-01" }, "2026-11-02"), false);
  assert.match(err(parseRoute({ points: [{ lat: 35.8, lng: 128.5 }], pass_min: 20 }, "drive")), /2개 이상/);
  assert.equal(ok(parseRoute(null, "spot")), null);
  assert.equal(regionCodeOf("대구 북구 침산동"), "27230");
  assert.equal(regionCodeOf("경북 칠곡군 석적읍"), "47850");
  assert.equal(regionCodeOf("서울 종로구"), null);
  assert.deepEqual(vocabTags(["실내", "야경", "북구", "드라이브"], DEFAULT_TAG_VOCAB), ["야경", "드라이브"]);
});

// ------------------------------------------------------------------ 글 → 초안 (관광공사·조사 원문)

test("이용 시간 글 → 줄: 요일 나눔 · 공휴일 · 계절(해 넘김) · 입장 마감 · 마감 N분 전 · 상시 개방 · 자정 넘김", () => {
  const a = hoursRowsFromText("월~목 10:30~20:00, 금~일·공휴일 10:30~20:30 (입장 마감 19:00)")!;
  assert.deepEqual(a.map((r) => [r.days, r.holiday, r.openMin, r.closeMin, r.lastEntryMin]), [[[1, 2, 3, 4], false, 630, 1200, null], [[0, 5, 6], true, 630, 1230, 1140]]);
  const b = hoursRowsFromText("하절기(4~9월) 09:00~18:00, 동절기(10~3월) 09:00~17:00 (마감 30분 전 입장)")!;
  assert.deepEqual(b.map((r) => [r.validFrom, r.validTo, r.closeMin, r.lastEntryMin, r.note]), [["04-01", "09-30", 1080, null, "하절기"], ["10-01", "03-31", 1020, 990, "동절기"]]);
  const c = hoursRowsFromText("평일·일·공휴일 10:00~18:00(입장 마감 17:00), 토 10:00~21:00(입장 마감 20:00)")!;
  assert.deepEqual(c.map((r) => [r.days, r.holiday, r.closeMin]), [[[0, 1, 2, 3, 4, 5], true, 1080], [[6], false, 1260]]);
  assert.deepEqual(hoursRowsFromText("10:00~17:30 (17:00 입장 마감)")![0].lastEntryMin, 1020);
  assert.deepEqual(hoursRowsFromText("24시간 상시 개방")!.map((r) => [r.openMin, r.closeMin]), [[0, 1440]]);
  assert.equal(hoursRowsFromText("18:00~02:00")![0].closeMin, 1560);
  assert.equal(hoursRowsFromText("홈페이지 참조"), null);
  // 읽은 줄은 저장 검사를 통과한다
  ok(parseHoursRows([...a, ...b, ...c]));
});

test("쉬는 날·주차·요금 글 → 칸", () => {
  assert.deepEqual(closuresFromText("매주 월요일(공휴일이면 다음 평일), 1월 1일, 설·추석 당일"), { closedDays: [1], closedRules: ["chuseok", "holiday_shift", "newyear", "seollal"] });
  assert.deepEqual(closuresFromText("연중무휴"), { closedDays: [], closedRules: [] });
  assert.deepEqual(closuresFromText("설날 및 추석 연휴"), { closedDays: [], closedRules: ["chuseok_all", "seollal_all"] });
  assert.equal(closuresFromText("시설 점검일"), null);
  assert.deepEqual(parkingFromText("가능(소형 50대)"), { has: "yes", size: "M" });
  assert.deepEqual(parkingFromText("공영주차장 있음", "1시간 1,000원"), { has: "yes", kind: "public", fee: "paid", fee_note: "1시간 1,000원" });
  assert.deepEqual(parkingFromText("불가"), { has: "no" });
  assert.deepEqual(priceFromText("어른 3,000원 / 어린이 1,000원 (7세 이하 무료)"), { free: false, adult: 3000, child: 1000, child_free_under: 8, level: 1 });
  assert.deepEqual(priceFromText("입장료: 무료 (일부 체험 유료)"), { free: true, level: 0 });
  assert.equal(priceFromText("홈페이지 참조"), null);
  const d = draftFromTour({ usetime: "09:00~18:00", restdate: "매주 월요일", parking: "있음", parkingFee: "무료", fee: "무료", babycarriage: "대여 가능", pet: "불가" });
  assert.deepEqual(d.closedDays, [1]);
  assert.deepEqual(d.parking, { has: "yes", fee: "free" });
  assert.deepEqual(d.facilities, ["유모차 가능"]);
  assert.equal(d.raw["이용시간"], "09:00~18:00");
});

// ------------------------------------------------------------------ 관리자 화면 도우미 · 저장 검사

test("추천 도착 시각 미리 보기: 문 열기 30분 전부터 · 닫기 전 최소 30분(또는 머무름) · 마지막 입장 · 쉬는 요일", () => {
  const g = arrivalWindows({
    hours: [row({ days: [2, 3, 4, 5], openMin: 600, closeMin: 1080, lastEntryMin: 1020 }), row({ days: [0, 6], openMin: 540, closeMin: 1080 })],
    openMin: 600, closeMin: 1080, closedDays: [1], dwell: 120,
  }, "2026-11-09", { waitMax: 30, minVisit: 30 });
  assert.deepEqual(g, [{ label: "월", text: "쉼" }, { label: "화~금", text: "9:30~17:00" }, { label: "주말", text: "8:30~17:30" }]);
  assert.equal(arrivalLine(g), "화~금 9:30~17:00 · 주말 8:30~17:30 도착이면 추천돼요 · 월 쉼");
  assert.equal(arrivalLine(arrivalWindows({ hours: [], openMin: 0, closeMin: 1440, closedDays: [], dwell: 40 }, "2026-11-09", { waitMax: 30, minVisit: 30 })), "매일 언제든 도착이면 추천돼요");
  assert.equal(daysLabel([1, 2, 3, 4, 5]), "평일");
  assert.equal(daysLabel([2, 4]), "화·목");
});

test("완성도: 9칸 중 채운 것", () => {
  const c = completeness({ hours: [row({})], closedDays: [], closedRules: [], parking: { has: "yes" }, price: null, facilities: [], moments: { best: ["day"] }, vocabTagCount: 2, regionCode: "27230", intro: "", meta: {} });
  assert.equal(c.total, 9);
  assert.equal(c.done, 5);
  assert.deepEqual(c.missing, ["쉬는 날", "가격", "시설", "소개 글"]);
});

test("관리자 저장 검사: 구조 칸은 보낸 것만 · 줄이 있으면 예전 open·close는 평일 대표값 · 예전 칩 맞춤", () => {
  const base = { name: "곳", album: "weekend", open: 540, close: 1080, dwell: 60, kidFit: 0.8, points: [{ lat: 35.9, lng: 128.6, r: 300, name: "정문" }] };
  const old = parsePlaceInput(base);
  assert.ok("ok" in old && old.ok.openHours === undefined && old.ok.parking === undefined);
  const r = parsePlaceInput({
    ...base, facilities: ["유모차 가능", "입장료 있음"],
    openHours: [{ days: [0, 6], openMin: 540, closeMin: 1200 }, { days: [1, 2, 3, 4, 5], openMin: 600, closeMin: 1080 }],
    parking: { has: "yes" }, price: { free: true }, kind: "spot", regionCode: "27230", closedRules: ["newyear"],
    moments: { best: ["day"] }, fit: { couple: 0.6, friends: 0.6, solo: 0.6 }, fitExtra: { kid_age: { "4-6": 1 } },
    meta: { hours: { src: "admin", conf: 1, at: "2026-11-02" } },
  });
  assert.ok("ok" in r, err(r as never));
  if (!("ok" in r)) return;
  assert.equal(r.ok.open, 600);
  assert.equal(r.ok.close, 1080);
  assert.deepEqual(r.ok.facilities, ["유모차 가능", "주차장"]);
  assert.deepEqual((r.ok.fit as { kid_age?: unknown }).kid_age, { "4-6": 1 });
  assert.match(err(parsePlaceInput({ ...base, kind: "drive", route: { points: [], pass_min: 10 } })), /2개 이상/);
  assert.match(err(parsePlaceInput({ ...base, regionCode: "북구" })), /5자리/);
});
