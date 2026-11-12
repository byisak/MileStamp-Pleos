import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayLabel, feeWord, hoursFromText, infoLine, NO_INFO, parkingWord, parseTourCommon, parseTourIntro, plain, restsOn,
} from "./place-detail-shape";

const wrap = (item: unknown) => ({ response: { header: { resultCode: "0000" }, body: { items: { item: [item] }, totalCount: 1 } } });

test("plain: <br>·태그·엔티티를 풀고 줄은 남긴다", () => {
  assert.equal(plain("09:00~18:00<br>(입장마감 17:00)&nbsp;"), "09:00~18:00\n(입장마감 17:00)");
  assert.equal(plain(null), "");
});

test("hoursFromText: 여러 모양의 시간 범위", () => {
  assert.deepEqual(hoursFromText("09:00~18:00"), { open: 540, close: 1080 });
  assert.deepEqual(hoursFromText("하절기 09:30 - 17:30 (입장 마감 16:30)"), { open: 570, close: 1050 });
  assert.deepEqual(hoursFromText("10시~18시"), { open: 600, close: 1080 });
  assert.deepEqual(hoursFromText("24시간 상시 개방"), { open: 0, close: 1440 });
  assert.equal(hoursFromText("홈페이지 참고"), null);
  assert.equal(hoursFromText("18:00~09:00"), null); // 밤새 여는 곳은 짐작 안 함
});

test("restsOn: '매주 ○요일'만 믿는다", () => {
  assert.equal(restsOn("매주 월요일(공휴일이면 다음날)", 1), true);
  assert.equal(restsOn("매주 월요일", 2), false);
  assert.equal(restsOn("연중무휴", 1), false);
  assert.equal(restsOn("1월 1일, 설·추석", 1), false);
});

test("parkingWord·feeWord: 애매하면 null", () => {
  assert.equal(parkingWord("가능 (승용차 120대)"), "주차 가능");
  assert.equal(parkingWord("있음", "무료"), "주차 무료");
  assert.equal(parkingWord("불가"), "주차 어려움");
  assert.equal(parkingWord("문의"), null);
  assert.equal(parkingWord(""), null);
  assert.equal(feeWord("무료"), "입장 무료");
  assert.equal(feeWord("어른 3000원, 어린이 1,500원"), "입장 3,000원~");
  assert.equal(feeWord("입장료: 무료 (일부 체험 유료)"), "입장 무료");
  assert.equal(feeWord("홈페이지 참고"), null);
});

test("관광지(12) 답 → 이용 시간·쉬는 날·주차 (요금 칸 없음)", () => {
  const i = parseTourIntro(wrap({ contentid: "126508", contenttypeid: "12", usetime: "09:00~18:00<br>", restdate: "매주 월요일", parking: "가능(소형 50대)", infocenter: "053-000-0000" }))!;
  assert.equal(i.usetime, "09:00~18:00");
  assert.equal(i.restdate, "매주 월요일");
  assert.equal(parkingWord(i.parking, i.parkingFee), "주차 가능");
  assert.equal(i.fee, "");
});

test("문화시설(14) 답 → usetimeculture·parkingculture·usefee", () => {
  const i = parseTourIntro(wrap({ contenttypeid: "14", usetimeculture: "10:00~17:30", restdateculture: "매주 월요일, 1월 1일", parkingculture: "있음", parkingfee: "무료", usefee: "무료" }))!;
  assert.deepEqual(hoursFromText(i.usetime), { open: 600, close: 1050 });
  assert.equal(parkingWord(i.parking, i.parkingFee), "주차 무료");
  assert.equal(feeWord(i.fee), "입장 무료");
  assert.equal(restsOn(i.restdate, 1), true);
});

test("축제(15) 답 → playtime·usetimefestival(요금)", () => {
  const i = parseTourIntro(wrap({ contenttypeid: "15", playtime: "10:00 ~ 21:00", usetimefestival: "무료", eventplace: "팔공산" }))!;
  assert.deepEqual(hoursFromText(i.usetime), { open: 600, close: 1260 });
  assert.equal(feeWord(i.fee), "입장 무료");
});

test("답이 비었거나 이상하면 null", () => {
  assert.equal(parseTourIntro({ response: { body: { items: "" } } }), null);
  assert.equal(parseTourIntro("x"), null);
  assert.equal(parseTourCommon({}), null);
  const c = parseTourCommon(wrap({ contenttypeid: "12", title: "사유원", firstimage: "http://tong.visitkorea.or.kr/a.jpg" }))!;
  assert.deepEqual(c, { contentTypeId: "12", title: "사유원", image: "https://tong.visitkorea.or.kr/a.jpg" });
});

test("infoLine: 한 줄 · 모르면 '운영 정보 없음'", () => {
  assert.equal(infoLine({ dayLabel: "오늘", open: 540, close: 1080, closed: false, parking: "주차 가능", fee: "입장 무료" }), "오늘 9:00~18:00 · 주차 가능 · 입장 무료");
  assert.equal(infoLine({ dayLabel: "오늘", open: 0, close: 1440, closed: false, parking: null, fee: null }), "오늘 언제나 열려 있어요");
  assert.equal(infoLine({ dayLabel: "11/3(화)", open: 540, close: 1080, closed: true, parking: "주차 가능", fee: null }), "11/3(화) 쉬어요 · 주차 가능");
  assert.equal(infoLine({ dayLabel: "오늘", open: 600, close: 1050, closed: false, parking: null, fee: null, general: true }), "보통 10:00~17:30");
  assert.equal(infoLine({ dayLabel: "오늘", open: null, close: null, closed: false, parking: null, fee: null }), NO_INFO);
});

test("dayLabel: 오늘 / 다른 날은 날짜(요일)", () => {
  assert.equal(dayLabel("2026-11-01", "2026-11-01"), "오늘");
  assert.equal(dayLabel("2026-11-03", "2026-11-01"), "11/3(화)");
});
