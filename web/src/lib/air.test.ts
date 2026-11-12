/*
 * 미세먼지 시험 (인터넷·키 없이): 에어코리아 측정소 목록·시도별 실시간 응답 읽기 · 등급 · 가까운 측정소 고르기 · 주소.
 * 응답 예시는 공공데이터포털 활용 가이드(에어코리아 대기오염정보·측정소정보 조회서비스)의 JSON 모양대로 만든 것.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AIR_SIDOS, airLevelOf, distKm, gradeLevel, nearestStations, parseRealtime, parseStations, pickAir, pm10ToGrade, pm25ToGrade,
  realtimeUrl, stationsUrl, type AirReading,
} from "./air";

// ---- 측정소정보 getMsrstnList (addr=대구)

const STATIONS_DAEGU = {
  response: {
    body: {
      totalCount: 4,
      items: [
        { dmX: "35.875432", item: "SO2, CO, O3, NO2, PM10, PM2.5", mangName: "도시대기", year: "1998", addr: "대구 중구 수창동 61-1 (수창초등학교)", stationName: "수창동", dmY: "128.587143" },
        { dmX: "35.885617", item: "SO2, CO, O3, NO2, PM10, PM2.5", mangName: "도시대기", year: "2005", addr: "대구 북구 침산동 210 (침산동 행정복지센터)", stationName: "침산동", dmY: "128.582958" },
        { dmX: "35.811436", item: "SO2, CO, O3, NO2, PM10, PM2.5", mangName: "도시대기", year: "1999", addr: "대구 수성구 지산동", stationName: "지산동", dmY: "128.637931" },
        // 좌표가 비어 있는 측정소는 뺀다
        { dmX: "", item: "PM10", mangName: "도로변대기", year: "2024", addr: "대구 어딘가", stationName: "새측정소", dmY: "" },
      ],
      pageNo: 1,
      numOfRows: 1000,
    },
    header: { resultMsg: "NORMAL_CODE", resultCode: "00" },
  },
};

// dmX·dmY 순서가 바뀌어 와도(경도, 위도) 값 범위로 가린다
const STATIONS_GB = {
  response: {
    body: { totalCount: 1, items: [{ dmX: "128.7290", dmY: "36.5680", addr: "경북 안동시 옥동", stationName: "옥동", mangName: "도시대기" }], pageNo: 1, numOfRows: 1000 },
    header: { resultMsg: "NORMAL_CODE", resultCode: "00" },
  },
};

test("측정소 목록 읽기: 이름·시도·좌표(WGS84), 좌표 없는 곳 빼기, 위경도 순서 가리기", () => {
  const list = parseStations(STATIONS_DAEGU, "대구")!;
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { name: "수창동", sido: "대구", lat: 35.875432, lng: 128.587143, addr: "대구 중구 수창동 61-1 (수창초등학교)" });
  const gb = parseStations(STATIONS_GB, "경북")!;
  assert.deepEqual([gb[0].lat, gb[0].lng], [36.568, 128.729]);
  assert.equal(parseStations({ response: { header: { resultCode: "30", resultMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } } }, "대구"), null);
  assert.equal(parseStations("<OpenAPI_ServiceResponse/>", "대구"), null);
  assert.deepEqual(parseStations({ response: { header: { resultCode: "00" }, body: { items: [] } } }, "대구"), []);
});

// ---- 대기오염정보 getCtprvnRltmMesureDnsty (sidoName=대구, ver=1.3)

const REALTIME_DAEGU = {
  response: {
    body: {
      totalCount: 3,
      items: [
        {
          so2Grade: "1", coFlag: null, khaiValue: "112", so2Value: "0.003", coValue: "0.5", pm25Flag: null, pm10Flag: null,
          o3Grade: "1", pm10Value: "95", khaiGrade: "3", pm25Value: "40", sidoName: "대구", no2Flag: null, no2Grade: "1",
          o3Flag: null, pm25Grade: "3", so2Flag: null, dataTime: "2026-10-31 08:00", coGrade: "1", no2Value: "0.021",
          stationName: "수창동", pm10Grade: "2", o3Value: "0.012", pm10Grade1h: "3", pm25Grade1h: "3", mangName: "도시대기",
          pm10Value24: "70", pm25Value24: "33",
        },
        {
          // 측정기 점검: 값은 '-', 1시간 등급 없음 → 이 측정소는 건너뛴다
          pm10Value: "-", pm25Value: "-", pm10Grade1h: null, pm25Grade1h: null, pm10Flag: "통신장애", pm25Flag: "통신장애",
          dataTime: "2026-10-31 08:00", stationName: "침산동", sidoName: "대구", mangName: "도시대기",
        },
        {
          // 1시간 등급이 비어도 농도로 등급을 계산 (PM10 160 → 매우나쁨)
          pm10Value: "160", pm25Value: "30", pm10Grade1h: "", pm25Grade1h: "", dataTime: "2026-10-31 08:00",
          stationName: "지산동", sidoName: "대구", mangName: "도시대기",
        },
      ],
      pageNo: 1,
      numOfRows: 200,
    },
    header: { resultMsg: "NORMAL_CODE", resultCode: "00" },
  },
};

test("실시간 응답 읽기: 농도·1시간 등급, '-'는 없음, 등급이 비면 농도로", () => {
  const r = parseRealtime(REALTIME_DAEGU)!;
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { station: "수창동", pm10: 95, pm25: 40, pm10Grade: 3, pm25Grade: 3, dataTime: "2026-10-31 08:00" });
  assert.deepEqual(r[1], { station: "침산동", pm10: null, pm25: null, pm10Grade: null, pm25Grade: null, dataTime: "2026-10-31 08:00" });
  assert.deepEqual([r[2].pm10Grade, r[2].pm25Grade], [4, 2]);
  assert.equal(parseRealtime({ response: { header: { resultCode: "99", resultMsg: "SERVICE TIMEOUT" } } }), null);
  // items가 {item: [...]} 모양이어도
  assert.equal(parseRealtime({ response: { header: { resultCode: "00" }, body: { items: { item: REALTIME_DAEGU.response.body.items } } } })!.length, 3);
});

test("등급: 1 좋음 2 보통 3 나쁨 4 매우나쁨, 둘 중 나쁜 쪽", () => {
  assert.equal(gradeLevel(1), "GOOD");
  assert.equal(gradeLevel(2), "NORMAL");
  assert.equal(gradeLevel(3), "BAD");
  assert.equal(gradeLevel(4), "VERY_BAD");
  assert.equal(gradeLevel(null), "UNKNOWN");
  assert.equal(airLevelOf({ pm10Grade: 2, pm25Grade: 3 }), "BAD");
  assert.equal(airLevelOf({ pm10Grade: 1, pm25Grade: null }), "GOOD");
  assert.equal(airLevelOf({ pm10Grade: null, pm25Grade: null }), "UNKNOWN");
  // 환경부 기준 경계
  assert.deepEqual([30, 31, 80, 81, 150, 151].map(pm10ToGrade), [1, 2, 2, 3, 3, 4]);
  assert.deepEqual([15, 16, 35, 36, 75, 76].map(pm25ToGrade), [1, 2, 2, 3, 3, 4]);
});

test("가까운 측정소: 30km 안, 가까운 순 → 값 있는 첫 곳 (침산동 점검 중이면 수창동)", () => {
  const stations = [...parseStations(STATIONS_DAEGU, "대구")!, ...parseStations(STATIONS_GB, "경북")!];
  // 북구 집(35.8858, 128.5828) — 침산동이 가장 가깝고, 안동 옥동은 30km 밖
  const near = nearestStations(stations, 35.8858, 128.5828);
  assert.deepEqual(near.map((s) => s.name), ["침산동", "수창동", "지산동"]);
  const readings = new Map<string, AirReading[]>([["대구", parseRealtime(REALTIME_DAEGU)!]]);
  assert.deepEqual(pickAir(near, readings), { level: "BAD", pm10: 95, pm25: 40, station: "수창동", dataTime: "2026-10-31 08:00" });
  // 수성구 지산동 근처면 지산동(매우나쁨)
  assert.equal(pickAir(nearestStations(stations, 35.81, 128.64), readings)?.level, "VERY_BAD");
  // 측정소가 멀면(제주) 모름
  assert.deepEqual(nearestStations(stations, 33.5, 126.5), []);
  assert.equal(pickAir([], readings), null);
  // 실시간 값을 못 받았으면 모름
  assert.equal(pickAir(near, new Map()), null);
  assert.ok(Math.abs(distKm(35.8858, 128.5828, 35.875432, 128.587143) - 1.2) < 0.2);
});

test("주소: 키는 한 번만 인코딩, JSON·시도·ver 1.3(1시간 등급)", () => {
  assert.match(realtimeUrl("ab+c/d==", "대구"), /ArpltnInforInqireSvc\/getCtprvnRltmMesureDnsty\?serviceKey=ab%2Bc%2Fd%3D%3D&/);
  assert.match(realtimeUrl("k", "대구"), /returnType=json&numOfRows=200&pageNo=1&sidoName=%EB%8C%80%EA%B5%AC&ver=1\.3/);
  assert.match(stationsUrl("k", "경북"), /MsrstnInfoInqireSvc\/getMsrstnList\?serviceKey=k&returnType=json&numOfRows=1000&pageNo=1&addr=%EA%B2%BD%EB%B6%81/);
  assert.deepEqual(AIR_SIDOS.map((s) => s.sido), ["대구", "경북"]);
});
