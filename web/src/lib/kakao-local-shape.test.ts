/* 직접 찾기 = 지도 검색 · 거리순 (docs/검색-거리순-계획.md): 카카오 답 읽기·순서·주소 감지·바깥 장소 id·from/sort. 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isCoordText, kakaoExtId, kakaoLabel, kakaoTier, looksLikeAddress, mergeSuggest, parseAddress, parseCoord2Address, parseFrom,
  parseKeyword, parsePinId, pinExtId, pinItem,
} from "./kakao-local-shape";
import { EXT_ID, extPlace, isExtId } from "./ext";
import { applyExploreQuery, parseSort } from "./explore-filter";
import type { ExploreItem } from "./explore-shape";

const fx = JSON.parse(readFileSync(join(import.meta.dirname, "kakao-fixtures.json"), "utf8"));
const HOME = { lat: 35.8858, lng: 128.5828 };
const OURS = [
  { id: "donghwa", name: "팔공산 동화사", lat: 35.98431, lng: 128.69853, stampable: true, region: "대구 동구" },
  { id: "cablecar", name: "팔공산 케이블카", lat: 35.99085, lng: 128.69487, stampable: true, region: "대구 동구" },
];

test("카카오 키워드 답 읽기: 좌표 숫자·도로명 먼저·이상한 줄 버림", () => {
  const ps = parseKeyword(fx.keyword);
  assert.equal(ps.length, 7);
  assert.deepEqual(ps[0], { id: "11111", name: "팔공산 왕건길 카페", category: "음식점 > 카페", group: "CE7", addr: "대구 동구 팔공산로 1", lat: 35.99, lng: 128.695 });
  assert.equal(ps[1].addr, "대구 동구 용수동 2");
  assert.deepEqual(parseKeyword({ documents: [{ id: "x", place_name: "a", x: "1", y: "2" }, { id: "1", place_name: "", x: "1", y: "2" }, null] }), []);
  assert.deepEqual(parseKeyword(null), []);
});

test("묶음 순서: 관광명소·문화시설 → 공원·체험·키즈(키즈카페 포함) → 그 밖 → 음식점·카페", () => {
  assert.equal(kakaoTier({ group: "AT4", category: "여행 > 관광,명소" }), 0);
  assert.equal(kakaoTier({ group: "CT1", category: "문화,예술 > 박물관" }), 0);
  assert.equal(kakaoTier({ group: "", category: "여행 > 공원 > 자연공원" }), 1);
  assert.equal(kakaoTier({ group: "CE7", category: "가정,생활 > 어린이 > 키즈카페" }), 1);
  assert.equal(kakaoTier({ group: "SW8", category: "교통,수송 > 지하철" }), 2);
  assert.equal(kakaoTier({ group: "FD6", category: "음식점 > 한식" }), 3);
  assert.equal(kakaoTier({ group: "CE7", category: "음식점 > 카페" }), 3);
  assert.equal(kakaoLabel({ group: "AT4", category: "여행 > 관광,명소 > 문화유적" }), "문화유적");
  assert.equal(kakaoLabel({ group: "AT4", category: "" }), "관광명소");
});

test("자동완성 합치기: 우리 명소 먼저 · 같은 곳(동화사) 빼기 · 음식점·카페는 맨 아래 · driveMin은 기준에서", () => {
  const items = mergeSuggest({ q: "팔공산", ref: HOME, ours: OURS, kakao: parseKeyword(fx.keyword), addresses: [] });
  assert.deepEqual(items.map((x) => x.kind), ["place", "place", "kakao", "kakao", "kakao", "kakao", "kakao", "kakao"]);
  assert.equal(items[0].id, "donghwa");
  assert.equal(items[0].label, "우리 도장");
  assert.ok(!items.some((x) => x.id === "ext:kakao:77777"), "우리 동화사와 같은 곳은 뺌");
  const ids = items.slice(2).map((x) => x.id);
  assert.deepEqual(ids.slice(0, 2).sort(), ["ext:kakao:44444", "ext:kakao:66666"]);
  assert.deepEqual(ids.slice(-2).sort(), ["ext:kakao:11111", "ext:kakao:22222"]);
  assert.ok(ids.indexOf("ext:kakao:55555") < ids.indexOf("ext:kakao:11111"), "키즈카페는 카페보다 위");
  assert.ok(items.every((x) => typeof x.driveMin === "number" && x.driveMin > 0));
  // 기준이 바뀌면 driveMin도
  const far = mergeSuggest({ q: "팔공산", ref: { lat: 37.56, lng: 126.97 }, ours: OURS, kakao: parseKeyword(fx.keyword), addresses: [] });
  assert.ok(far[2].driveMin! > items[2].driveMin! + 120);
  // 같은 id 두 번 → 한 번
  const dup = mergeSuggest({ q: "x", ref: null, ours: [], kakao: [...parseKeyword(fx.keyword), ...parseKeyword(fx.keyword)], addresses: [] });
  assert.equal(dup.length, 7);
  assert.equal(dup[0].driveMin, null);
});

test("주소처럼 보이나 + 주소 줄('이 주소로')은 우리 명소 다음", () => {
  for (const s of ["대구 달성군 화원읍", "동대구로 123", "연암로 40", "산격동 1300", "산격동 1300-5", "경북 경주시 불국로 385", "화원읍 성산리 1"]) {
    assert.ok(looksLikeAddress(s), s);
  }
  for (const s of ["경주 박물관", "팔공산", "대구 아쿠아리움", "키즈카페", "서울숲"]) assert.ok(!looksLikeAddress(s), s);
  const addrs = parseAddress(fx.address);
  assert.deepEqual(addrs[0], { name: "북구청", addr: "대구 북구 연암로 40 (대구 북구 산격동 1300)", lat: 35.8858, lng: 128.5828 });
  const items = mergeSuggest({ q: "연암로 40", ref: HOME, ours: OURS, kakao: parseKeyword(fx.keyword), addresses: addrs });
  assert.equal(items[0].kind, "address");
  assert.equal(items[0].id, "ext:pin:35.88580,128.58280");
  assert.equal(items[0].driveMin, 0);
});

test("좌표 → 주소 · 지도 핀 줄", () => {
  const r = parseCoord2Address(fx.coord2address);
  assert.deepEqual(r, { name: "대구 달성군 화원읍 사문진로 1", addr: "대구 달성군 화원읍 사문진로 1" });
  assert.equal(parseCoord2Address({ documents: [] }), null);
  const p = pinItem(35.861234567, 128.4567891, r, HOME);
  assert.equal(p.id, "ext:pin:35.86123,128.45679");
  assert.equal(p.kind, "pin");
  assert.equal(pinItem(35.8, 128.4, null, null).name, "지도에서 고른 곳");
});

test("바깥 장소 id: kakao·pin도 받는다 (앵커·고르기·다녀옴 공용 규칙)", () => {
  for (const id of ["ext:tour:126508", "ext:kto100:7", kakaoExtId("8228396"), pinExtId(35.8858, 128.5828), "ext:pin:-33.1,151.2"]) {
    assert.ok(isExtId(id), id);
    assert.ok(EXT_ID.test(id), id);
  }
  for (const id of ["ext:pin:35,128", "ext:pin:abc", "ext:kakao:", "ext:other:1", "ext:kakao:1;drop", "tour:1"]) assert.ok(!isExtId(id), id);
  assert.deepEqual(parsePinId("ext:pin:35.88580,128.58280"), { lat: 35.8858, lng: 128.5828 });
  assert.equal(parsePinId("ext:pin:99.0,128.0"), null);
  const p = extPlace({ id: "ext:pin:35.86123,128.45679", name: "사문진 나루터", lat: 35.86123, lng: 128.45679 });
  assert.ok(typeof p !== "string" && p.stampable === false && p.dwellP80Min === 90);
  assert.ok(typeof extPlace({ id: kakaoExtId("1"), name: "카페", lat: 35, lng: 128 }) !== "string");
});

test("from=lat,lng: 약 1km 반올림 · 한국 밖·날짜·이상한 값은 무시 / sort=distance", () => {
  assert.deepEqual(parseFrom("35.88581,128.58279"), { lat: 35.89, lng: 128.58 });
  assert.deepEqual(parseFrom(" 37.5665,126.978 "), { lat: 37.57, lng: 126.98 });
  assert.equal(parseFrom("2026-10-31"), null);
  assert.equal(parseFrom("40.7,-74.0"), null);
  assert.equal(parseFrom(null), null);
  assert.ok(isCoordText("35.8,128.5"));
  assert.ok(!isCoordText("2026-10-31"));
  assert.equal(parseSort("distance"), "distance");
  assert.equal(parseSort("popular"), "popular");
  assert.equal(parseSort("near"), "default");
  const it = (id: string, driveMin: number | null, ourStamp = false): ExploreItem =>
    ({ kind: ourStamp ? "place" : "tour", id, name: id, lat: 35.9, lng: 128.6, addr: "대구", image: null, driveMin, ourStamp, region: "27" });
  const items = [it("a", 50, true), it("b", 10), it("c", null), it("d", 30)];
  const r = applyExploreQuery(items, { maxMin: null, regions: [], sort: "distance" }, new Map());
  assert.deepEqual(r.items.map((x) => x.id), ["b", "d", "a", "c"]);
  const near = applyExploreQuery(items, { maxMin: 60, regions: [], sort: "distance" }, new Map());
  assert.deepEqual(near.items.map((x) => x.id), ["b", "d", "a", "c"]);
  assert.deepEqual(applyExploreQuery(items, { maxMin: null, regions: [], sort: "default" }, new Map()).items.map((x) => x.id), ["a", "b", "c", "d"]);
});
