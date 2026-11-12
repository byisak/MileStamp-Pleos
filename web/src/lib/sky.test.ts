/*
 * 하늘 정보 시험 (인터넷·키 없이): 천문 공식 · 천문연 응답 읽기 · 기상청 격자·발표 시각·응답 읽기 · 한국 시간.
 * 응답 예시는 공공데이터포털 활용 가이드의 모양대로 만든 것.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { kasiUrl, parseKasi, riseSetFormula, serviceKeyParam } from "./sun";
import { baseTimeFor, latLngToGrid, parseVilageFcst, vilageUrl } from "./weather";
import { kst, parseAt } from "./kst";
import { hhmm } from "./planner";

const near = (actual: number, expected: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} ${actual} ≠ ${expected} ±${tol}`);

// ---- 천문 공식 (엔진 SunTest와 같은 값)

test("대구 2026-10-31 해 뜨고 지는 시각 (06:46 / 17:32 ±3분, 남중 12:09)", () => {
  const rs = riseSetFormula(35.8714, 128.6014, "2026-10-31")!;
  near(rs.sunriseMin, hhmm("06:46"), 3, "해 뜸");
  near(rs.sunsetMin, hhmm("17:32"), 3, "해 짐");
  near((rs.sunriseMin + rs.sunsetMin) / 2, hhmm("12:09"), 2, "남중");
});

test("여름이 겨울보다 해가 길다 (하지 05:09/19:45, 동지 07:32/17:15)", () => {
  const june = riseSetFormula(35.8714, 128.6014, "2026-06-21")!;
  const dec = riseSetFormula(35.8714, 128.6014, "2026-12-21")!;
  near(june.sunriseMin, hhmm("05:09"), 3);
  near(june.sunsetMin, hhmm("19:45"), 3);
  near(dec.sunriseMin, hhmm("07:32"), 3);
  near(dec.sunsetMin, hhmm("17:15"), 3);
});

test("극지방 백야는 null", () => {
  assert.equal(riseSetFormula(78.2, 15.6, "2026-06-21"), null);
});

// ---- 천문연 출몰시각

const KASI_OK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
<body><items><item><aste>1906  </aste><astm>0522  </astm><civile>1759  </civile><civilm>0619  </civilm>
<latitude>3589</latitude><latitudeNum>35.8900000000</latitudeNum><location>-</location><locdate>20261031</locdate>
<longitude>12858</longitude><longitudeNum>128.5800000000</longitudeNum><moonrise>1830  </moonrise><moonset>0921  </moonset>
<moontransit>0115  </moontransit><naute>1832  </naute><nautm>0550  </nautm><sunrise>0647  </sunrise><sunset>1732  </sunset>
<suntransit>1209  </suntransit></item></items><numOfRows>10</numOfRows><pageNo>1</pageNo><totalCount>1</totalCount></body></response>`;

const KASI_KEY_ERROR = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>
<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

test("천문연 응답 읽기", () => {
  assert.deepEqual(parseKasi(KASI_OK), { sunriseMin: hhmm("06:47"), sunsetMin: hhmm("17:32"), civilDawnMin: hhmm("06:19"), civilDuskMin: hhmm("17:59") });
  assert.equal(parseKasi(KASI_KEY_ERROR), null);
  assert.equal(parseKasi(KASI_OK.replace("<sunset>1732  </sunset>", "<sunset></sunset>")), null);
  assert.equal(parseKasi("<html>gateway timeout</html>"), null);
});

test("천문연 주소: 십진수 위경도·날짜, 키는 한 번만 인코딩", () => {
  const u = kasiUrl("ab+c/d==", 35.8858, 128.5828, "2026-10-31");
  assert.match(u, /getLCRiseSetInfo\?serviceKey=ab%2Bc%2Fd%3D%3D&/);
  assert.match(u, /longitude=128\.58&latitude=35\.89&locdate=20261031&dnYn=Y/);
  assert.equal(serviceKeyParam("ab%2Bc"), "ab%2Bc");
});

// ---- 기상청 격자·발표 시각

test("위경도 → 기상청 격자", () => {
  assert.deepEqual(latLngToGrid(37.5665, 126.978), { nx: 60, ny: 127 }); // 서울 중구
  assert.deepEqual(latLngToGrid(35.8691, 128.6061), { nx: 89, ny: 90 }); // 대구 중구
});

test("발표 시각: 발표 10분 뒤부터, 02:10 전이면 어제 23시", () => {
  assert.deepEqual(baseTimeFor("2026-10-31", hhmm("08:30")), { baseDate: "20261031", baseTime: "0800" });
  assert.deepEqual(baseTimeFor("2026-10-31", hhmm("08:05")), { baseDate: "20261031", baseTime: "0500" });
  assert.deepEqual(baseTimeFor("2026-10-31", hhmm("16:10")), { baseDate: "20261031", baseTime: "1400" });
  assert.deepEqual(baseTimeFor("2026-10-31", hhmm("23:59")), { baseDate: "20261031", baseTime: "2300" });
  assert.deepEqual(baseTimeFor("2026-11-01", hhmm("01:00")), { baseDate: "20261031", baseTime: "2300" });
  assert.match(vilageUrl("k", 89, 91, { baseDate: "20261031", baseTime: "0800" }), /dataType=JSON&base_date=20261031&base_time=0800&nx=89&ny=91/);
});

// ---- 기상청 단기예보 응답

/** 시간별 [시각, 강수확률, 강수형태, 하늘]로 응답 모양 만들기 (기온 등 다른 항목도 섞어 둠). */
function fcst(rows: [string, number, number, number][], date = "20261031") {
  const item = rows.flatMap(([t, pop, pty, sky]) => [
    { baseDate: date, baseTime: "0800", category: "TMP", fcstDate: date, fcstTime: t, fcstValue: "12", nx: 89, ny: 91 },
    { baseDate: date, baseTime: "0800", category: "POP", fcstDate: date, fcstTime: t, fcstValue: String(pop), nx: 89, ny: 91 },
    { baseDate: date, baseTime: "0800", category: "PTY", fcstDate: date, fcstTime: t, fcstValue: String(pty), nx: 89, ny: 91 },
    { baseDate: date, baseTime: "0800", category: "SKY", fcstDate: date, fcstTime: t, fcstValue: String(sky), nx: 89, ny: 91 },
  ]);
  item.push({ baseDate: date, baseTime: "0800", category: "POP", fcstDate: "20261101", fcstTime: "0900", fcstValue: "90", nx: 89, ny: 91 });
  return { response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { dataType: "JSON", items: { item }, pageNo: 1, numOfRows: 1000, totalCount: item.length } } };
}

test("오전 맑음 → 15시 비", () => {
  const rows: [string, number, number, number][] = [
    ["0900", 0, 0, 1], ["1000", 10, 0, 1], ["1100", 20, 0, 3], ["1200", 30, 0, 3], ["1300", 30, 0, 4],
    ["1400", 50, 0, 4], ["1500", 60, 1, 4], ["1600", 70, 1, 4], ["1700", 60, 1, 4],
  ];
  const w = parseVilageFcst(fcst(rows), "2026-10-31", hhmm("08:40"))!;
  assert.equal(w.sky, "CLEAR"); // 지금 칸이 없으면(예보가 9시부터) 첫 칸
  assert.equal(w.rainFromMin, hhmm("15:00"));
  assert.equal(w.hours.length, 9);
  assert.deepEqual(w.hours[6], { min: hhmm("15:00"), pop: 60, pty: 1, sky: 4, tmp: 12 });
  assert.equal(w.tempC, 12); // 지금 칸 기온 (저녁 나들이 '쌀쌀함')

  const later = parseVilageFcst(fcst(rows), "2026-10-31", hhmm("15:20"))!;
  assert.equal(later.sky, "RAIN");
  assert.equal(later.rainFromMin, hhmm("15:00"));
});

test("강수 확률 60% 이상이면 비 오는 시간으로 · 흐림은 맑다고 하지 않음 · 눈", () => {
  const w = parseVilageFcst(fcst([["1600", 20, 0, 4], ["1700", 60, 0, 4]]), "2026-10-31", hhmm("16:10"))!;
  assert.equal(w.sky, "UNKNOWN");
  assert.equal(w.rainFromMin, hhmm("17:00"));
  const snow = parseVilageFcst(fcst([["1600", 80, 3, 4]]), "2026-10-31", hhmm("16:10"))!;
  assert.equal(snow.sky, "SNOW");
  assert.equal(snow.rainFromMin, hhmm("16:00"));
  const dry = parseVilageFcst(fcst([["1600", 0, 0, 1], ["1700", 10, 0, 1]]), "2026-10-31", hhmm("16:10"))!;
  assert.equal(dry.sky, "CLEAR");
  assert.equal(dry.rainFromMin, null);
});

test("기상청 오류·빈 응답은 null", () => {
  assert.equal(parseVilageFcst({ response: { header: { resultCode: "03", resultMsg: "NO_DATA" } } }, "2026-10-31", 600), null);
  assert.equal(parseVilageFcst(null, "2026-10-31", 600), null);
  assert.equal(parseVilageFcst(fcst([], "20261030"), "2026-10-31", 600), null);
});

// ---- 한국 시간

test("한국 시간 날짜·분, 시각 지정(at)", () => {
  assert.deepEqual(kst(new Date("2026-10-30T23:30:00Z")), { day: "2026-10-31", min: hhmm("08:30") });
  assert.deepEqual(kst(parseAt("2026-10-31T08:30")!), { day: "2026-10-31", min: hhmm("08:30") });
  assert.deepEqual(kst(parseAt("2026-10-28T16:10:00+09:00")!), { day: "2026-10-28", min: hhmm("16:10") });
  assert.deepEqual(kst(parseAt("2026-10-28T07:10:00Z")!), { day: "2026-10-28", min: hhmm("16:10") });
  assert.equal(parseAt("어제"), null);
  assert.equal(parseAt("2026-13-45T99:99"), null);
});
