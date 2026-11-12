/*
 * 지금 날씨(초단기실황) 시험 — 인터넷·키 없이. 응답 예시는 공공데이터포털 활용 가이드의 모양대로 만든 것.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ncstBaseFor, ncstUrl, parseUltraSrtNcst, ptyToSky } from "./weather";

const ncst = (values: Record<string, string>, baseDate = "20261028", baseTime = "1400", code = "00") => ({
  response: {
    header: { resultCode: code, resultMsg: code === "00" ? "NORMAL_SERVICE" : "NO_DATA" },
    body: {
      dataType: "JSON",
      items: { item: Object.entries(values).map(([category, obsrValue]) => ({ baseDate, baseTime, category, nx: 89, ny: 91, obsrValue })) },
      pageNo: 1, numOfRows: 20, totalCount: 8,
    },
  },
});

test("발표 시각: 40분 전이면 한 시간 전, 자정 넘어 00:40 전이면 어제 23시", () => {
  assert.deepEqual(ncstBaseFor("2026-10-28", 14 * 60 + 39), { baseDate: "20261028", baseTime: "1300" });
  assert.deepEqual(ncstBaseFor("2026-10-28", 14 * 60 + 40), { baseDate: "20261028", baseTime: "1400" });
  assert.deepEqual(ncstBaseFor("2026-10-28", 0 * 60 + 39), { baseDate: "20261027", baseTime: "2300" });
  assert.deepEqual(ncstBaseFor("2026-10-28", 0 * 60 + 45), { baseDate: "20261028", baseTime: "0000" });
  assert.deepEqual(ncstBaseFor("2026-11-01", 10), { baseDate: "20261031", baseTime: "2300" });
});

test("실황 읽기: 기온·강수 없음 → clear, 관측 시각은 한국 시간", () => {
  const r = parseUltraSrtNcst(ncst({ PTY: "0", REH: "55", RN1: "0", T1H: "12.3", UUU: "1.2", VEC: "250", VVV: "-0.4", WSD: "1.5" }));
  assert.deepEqual(r, { tempC: 12.3, sky: "clear", at: "2026-10-28T14:00:00+09:00" });
});

test("실황 읽기: 강수 형태별 하늘", () => {
  assert.equal(parseUltraSrtNcst(ncst({ PTY: "1", T1H: "8" }))?.sky, "rain");
  assert.equal(parseUltraSrtNcst(ncst({ PTY: "3", T1H: "-2.5" }))?.sky, "snow");
  assert.equal(parseUltraSrtNcst(ncst({ PTY: "2", T1H: "0.4" }))?.sky, "sleet");
  assert.equal(parseUltraSrtNcst(ncst({ PTY: "5", T1H: "9" }))?.sky, "drizzle");
  assert.equal(ptyToSky(6), "sleet");
  assert.equal(ptyToSky(7), "snow");
  assert.equal(ptyToSky(4), "rain");
  assert.equal(parseUltraSrtNcst(ncst({ PTY: "3", T1H: "-2.5" }))?.tempC, -2.5);
});

test("실황 읽기: 오류·기온 없음·결측 값이면 null", () => {
  assert.equal(parseUltraSrtNcst(ncst({ T1H: "12" }, "20261028", "1400", "03")), null);
  assert.equal(parseUltraSrtNcst(ncst({ PTY: "0" })), null);
  assert.equal(parseUltraSrtNcst(ncst({ PTY: "0", T1H: "-998.9" })), null);
  assert.equal(parseUltraSrtNcst(null), null);
  assert.equal(parseUltraSrtNcst({ OpenAPI_ServiceResponse: {} }), null);
  // 강수 형태가 빠지면 비 없음으로
  assert.equal(parseUltraSrtNcst(ncst({ T1H: "15" }))?.sky, "clear");
});

test("실황 주소: 초단기실황·격자·발표 시각", () => {
  const u = ncstUrl("ab+c/d==", 89, 91, { baseDate: "20261028", baseTime: "1400" });
  assert.ok(u.startsWith("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey="));
  assert.ok(u.includes("nx=89") && u.includes("ny=91") && u.includes("base_time=1400") && u.includes("dataType=JSON"));
});
