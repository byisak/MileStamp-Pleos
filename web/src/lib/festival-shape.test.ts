/* 축제 모양·검사 (DB 없이). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, festivalStatus, kstToday, parseFestivalInput, parseTourFestivals, periodText, seasonLabel, validFestivalId,
  WEIGHT_NORMAL, WEIGHT_STRONG,
} from "./festival-shape";
import { festivalReason, festivalRunsOn, forDay, weekdayOf, type Place } from "./planner";
import { festivalKey } from "./r2";

test("축제 상태: 날짜로 예정·진행 중·끝남 (첫날·마지막 날은 진행 중)", () => {
  const f = { starts: "2026-10-20", ends: "2026-11-09" };
  assert.equal(festivalStatus(f, "2026-10-19"), "upcoming");
  assert.equal(festivalStatus(f, "2026-10-20"), "running");
  assert.equal(festivalStatus(f, "2026-11-09"), "running");
  assert.equal(festivalStatus(f, "2026-11-10"), "ended");
  assert.equal(periodText(f), "10/20~11/9");
});

test("한국 날짜·날짜 더하기·계절 이름", () => {
  assert.equal(kstToday(new Date("2026-10-26T15:30:00Z")), "2026-10-27"); // 한국 00:30
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-10-27", -365), "2025-10-27");
  assert.equal(seasonLabel("2026-10-20"), "2026 가을");
  assert.equal(seasonLabel("2026-04-01"), "2026 봄");
  assert.equal(seasonLabel("2026-12-24"), "2026 겨울");
  assert.equal(seasonLabel("2027-01-10"), "2026 겨울");
});

test("엔진 이식: 열리는 날·쉬는 요일·붙은 명소 대신", () => {
  const info = { id: "fest-a", starts: "2026-10-24", ends: "2026-11-01", weight: WEIGHT_STRONG, placeId: "hajungdo", closedDays: [1] };
  assert.equal(weekdayOf("2026-10-26"), 1); // 월
  assert.ok(festivalRunsOn(info, "2026-10-24"));
  assert.ok(!festivalRunsOn(info, "2026-10-26"));
  assert.ok(!festivalRunsOn(info, null));
  assert.deepEqual(festivalReason(info), { text: "이번 주말만 · 11/1까지", tone: "FESTIVAL" });
  const p = (id: string, festival?: typeof info): Place => ({
    id, name: id, at: { lat: 35.9, lng: 128.56 }, indoor: false, dwellP80Min: 60, kidFit: 0.8, openMin: 600, closeMin: 1080, popular: 0, stampable: true, festival,
  });
  const cands = [p("hajungdo"), p("chimsan"), p("fest-a", info)];
  assert.deepEqual(forDay(cands, "2026-10-31").map((x) => x.id), ["chimsan", "fest-a"]);
  assert.deepEqual(forDay(cands, "2026-11-02").map((x) => x.id), ["hajungdo", "chimsan"]);
});

test("관리자 입력 검사: 기간·시각·도착 지점·가중치·계절 처음 값", () => {
  const base = {
    name: "팔공산 단풍축제", starts: "2026-10-20", ends: "2026-11-09", open: 570, close: 1050, dwell: 120, kidFit: 0.85,
    points: [{ lat: 35.99085, lng: 128.69487, r: 400, name: "케이블카 주차장" }], weight: 2.5, closedDays: [1, 1, 9],
  };
  const ok = parseFestivalInput(base);
  assert.ok("ok" in ok);
  if ("ok" in ok) {
    assert.equal(ok.ok.weight, WEIGHT_STRONG);
    assert.equal(ok.ok.season, "2026 가을");
    assert.deepEqual(ok.ok.closedDays, [1]);
    assert.equal(ok.ok.active, true);
  }
  const normal = parseFestivalInput({ ...base, weight: 1.7 });
  assert.ok("ok" in normal && normal.ok.weight === WEIGHT_NORMAL);
  assert.ok("error" in parseFestivalInput({ ...base, ends: "2026-10-01" }));
  assert.ok("error" in parseFestivalInput({ ...base, points: [] }));
  assert.ok("error" in parseFestivalInput({ ...base, open: 1100 }));
  assert.ok("error" in parseFestivalInput({ ...base, posterUrl: "http://x.kr/a.jpg" }));
  assert.ok(validFestivalId("fest-palgong-2026"));
  assert.ok(!validFestivalId("palgong"));
  assert.ok(!validFestivalId("fest-팔공"));
});

test("TourAPI searchFestival2 응답 읽기 (한 건·여러 건·빈 응답)", () => {
  const one = { response: { body: { items: { item: {
    contentid: "123", title: "팔공산 단풍축제", addr1: "대구 동구", eventstartdate: "20261020", eventenddate: "20261109",
    mapx: "128.69487", mapy: "35.99085", firstimage: "http://tong.visitkorea.or.kr/a.jpg",
  } } } } };
  const r = parseTourFestivals(one);
  assert.equal(r.length, 1);
  assert.equal(r[0].starts, "2026-10-20");
  assert.equal(r[0].lat, 35.99085);
  assert.equal(r[0].image, "https://tong.visitkorea.or.kr/a.jpg");
  assert.deepEqual(parseTourFestivals({ response: { body: { items: "" } } }), []);
  assert.deepEqual(parseTourFestivals(null), []);
});

test("R2 축제 키", () => {
  assert.equal(festivalKey("fest-a", "poster", 2), "festivals/fest-a/poster-2.webp");
  assert.equal(festivalKey("fest-a", "stamp", 1, true), "festivals/fest-a/stamp-1_bw.webp");
});
