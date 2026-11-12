/* 고르기 탭 2차: 거리 칩(maxMin)·시·도(regions)·인기 정렬(3가족 규칙) (DB·네트워크 없이). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyExploreQuery, inRegions, parseMaxMin, parseRegions, parseSort, popularScore, sortPopular, withinMin, withPopular, withRegions,
  type Popularity,
} from "./explore-filter";
import { normRegionCode, regionFromLatLng, regionFromText, regionOf, REGIONS } from "./explore-region";
import { curatedItem, ourPlaceItem, tourFestivalItem, type ExploreItem } from "./explore-shape";

const item = (id: string, o: Partial<ExploreItem> = {}): ExploreItem => ({
  kind: "tour", id, name: id, lat: 35.87, lng: 128.6, addr: "", image: null, driveMin: 30, ourStamp: false, ...o,
});

test("maxMin: 60·120·180만, 없으면 옛 scope (near=120 · all·없음 = 제한 없음)", () => {
  const q = (s: string) => parseMaxMin(new URLSearchParams(s));
  assert.equal(q("maxMin=60"), 60);
  assert.equal(q("maxMin=120"), 120);
  assert.equal(q("maxMin=180"), 180);
  assert.equal(q("maxMin=90"), null);
  assert.equal(q("maxMin=abc"), null);
  assert.equal(q(""), null);
  assert.equal(q("scope=near"), 120);
  assert.equal(q("scope=all"), null);
  assert.equal(q("maxMin=60&scope=all"), 60);
  assert.equal(parseSort("popular"), "popular");
  assert.equal(parseSort(null), "default");
});

test("거리 거르기: 차로 N분 안 (집 몰라 driveMin null이면 남김)", () => {
  const xs = [item("a", { driveMin: 50 }), item("b", { driveMin: 61 }), item("c", { driveMin: 170 }), item("d", { driveMin: null }), item("e", { driveMin: 200 })];
  assert.deepEqual(withinMin(xs, 60).map((x) => x.id), ["a", "d"]);
  assert.deepEqual(withinMin(xs, 120).map((x) => x.id), ["a", "b", "d"]);
  assert.deepEqual(withinMin(xs, 180).map((x) => x.id), ["a", "b", "c", "d"]);
  assert.equal(withinMin(xs, null).length, 5);
});

test("시·도 코드: 17곳 · 옛 코드 · 글 · 좌표", () => {
  assert.equal(REGIONS.length, 17);
  assert.deepEqual(parseRegions("27,47, 99,27,abc,4"), ["27", "47"]);
  assert.deepEqual(parseRegions(null), []);
  assert.equal(normRegionCode("42"), "51"); // 강원 옛 코드
  assert.equal(normRegionCode("45"), "52"); // 전북 옛 코드
  assert.equal(normRegionCode("27110"), "27");
  assert.equal(normRegionCode(""), null);
  assert.equal(regionFromText("경북 경주시 불국로"), "47");
  assert.equal(regionFromText("경상북도 안동시"), "47");
  assert.equal(regionFromText("대구광역시 동구"), "27");
  assert.equal(regionFromText("강원특별자치도 춘천시"), "51");
  assert.equal(regionFromText("전북특별자치도 전주시"), "52");
  assert.equal(regionFromText("전라남도 여수시"), "46");
  assert.equal(regionFromText("충청북도 단양군"), "43");
  assert.equal(regionFromText("제주특별자치도 서귀포시"), "50");
  assert.equal(regionFromText("세종"), "36");
  assert.equal(regionFromText("어딘가"), null);
  // 좌표: 대구 시내·군위(대구)·경주·하회마을·서울·제주·부산 해운대·전주
  assert.equal(regionFromLatLng(35.8714, 128.6014), "27");
  assert.equal(regionFromLatLng(36.17, 128.64), "27");
  assert.equal(regionFromLatLng(35.84, 129.21), "47");
  assert.equal(regionFromLatLng(36.539, 128.518), "47");
  assert.equal(regionFromLatLng(37.57, 126.98), "11");
  assert.equal(regionFromLatLng(33.38, 126.55), "50");
  assert.equal(regionFromLatLng(35.16, 129.16), "26");
  assert.equal(regionFromLatLng(35.82, 127.15), "52");
  // 순서: 코드 → 글 → 좌표
  assert.equal(regionOf({ region: "47", addr: "대구 중구", lat: 37.5, lng: 127 }), "47");
  assert.equal(regionOf({ addr: "대구 중구", lat: 37.5, lng: 127 }), "27");
  assert.equal(regionOf({ addr: "", lat: 37.5665, lng: 126.978 }), "11");
});

test("줄 만들 때 시·도: TourAPI 코드 · 명소 지역 글 · 100선 지역 칸", () => {
  const t = tourFestivalItem({ contentId: "1", contentTypeId: "15", title: "청송사과축제", addr: "경상북도 청송군", lat: 36.43, lng: 129.06, image: null, starts: "2026-11-04", ends: "2026-11-08", region: "47" }, null, { sat: "2026-10-31", sun: "2026-11-01" });
  assert.equal(t?.region, "47");
  const p = ourPlaceItem({ id: "x", name: "군위 화본역", lat: 36.15, lng: 128.78, indoor: false, stampable: true, region: "대구 군위군 산성면" }, null);
  assert.equal(p.region, "27");
  const c = curatedItem({ no: 1, name: "5대 고궁", content_id: null, lat: 37.58, lng: 126.98, area: "수도권", region: "서울", addr: "서울 종로구", image: null }, null, null);
  assert.equal(c?.region, "11");
  // 코드가 없는 등록 축제는 목록 낼 때 좌표로
  const [f] = withRegions([item("fest-x", { kind: "festival", lat: 35.87, lng: 128.6 })]);
  assert.equal(f.region, "27");
});

test("시·도 거르기 + 시·도별 수 (거리와 함께)", () => {
  const xs = [
    item("dg", { lat: 35.87, lng: 128.6, driveMin: 10 }),
    item("gb", { addr: "경북 경주시", lat: 35.84, lng: 129.21, driveMin: 60 }),
    item("gb2", { region: "47", driveMin: 150 }),
    item("se", { region: "11", driveMin: 230 }),
  ];
  const r = applyExploreQuery(xs, { maxMin: 120, regions: ["27", "47"], sort: "default" }, new Map());
  assert.deepEqual(r.items.map((x) => x.id), ["dg", "gb"]);
  assert.deepEqual(r.regionCounts, { "27": 1, "47": 1 });
  assert.deepEqual(r.regionCountsAll, { "27": 1, "47": 2, "11": 1 });
  // 전국 + 3시간 = 3시간 안 전국
  const r2 = applyExploreQuery(xs, { maxMin: 180, regions: [], sort: "default" }, new Map());
  assert.deepEqual(r2.items.map((x) => x.id), ["dg", "gb", "gb2"]);
  // 거리 제한 없이 서울만
  const r3 = applyExploreQuery(xs, { maxMin: null, regions: ["11"], sort: "default" }, new Map());
  assert.deepEqual(r3.items.map((x) => x.id), ["se"]);
  assert.deepEqual(inRegions(withRegions(xs), []).length, 4);
});

test("인기: 3가족 이상만 숫자·순위, 점수 = 고른 가족 + 간 가족 × 2", () => {
  const pop: Popularity = new Map([
    ["a", { picked: 12, visited: 0 }], // 12
    ["b", { picked: 3, visited: 5 }], // 13
    ["c", { picked: 2, visited: 1 }], // 3가족 미만 → 0
    ["d", { picked: 0, visited: 3 }], // 6
  ]);
  assert.equal(popularScore(pop.get("a")), 12);
  assert.equal(popularScore(pop.get("b")), 13);
  assert.equal(popularScore(pop.get("c")), 0);
  assert.equal(popularScore(undefined), 0);
  const xs = [item("c", { driveMin: 5 }), item("a", { driveMin: 90 }), item("d", { driveMin: 40 }), item("b", { driveMin: 100 }), item("z", { driveMin: 1 })];
  assert.deepEqual(sortPopular(xs, pop).map((x) => x.id), ["b", "a", "d", "z", "c"]);
  const w = withPopular(xs, pop);
  assert.equal(w.find((x) => x.id === "a")?.popular, 12);
  assert.equal(w.find((x) => x.id === "b")?.popular, 5); // 고른 3 · 간 5 → 큰 쪽
  assert.equal(w.find((x) => x.id === "c")?.popular, undefined); // 2가족 → 숫자 안 보임
  assert.equal(w.find((x) => x.id === "z")?.popular, undefined);
});

test("인기 처음(가족이 적을 때): 이번 주말 → 가까운 순", () => {
  const pop: Popularity = new Map([["far", { picked: 2, visited: 0 }]]);
  const xs = [
    item("near", { driveMin: 20 }),
    item("weekendFar", { driveMin: 100, thisWeekend: true }),
    item("far", { driveMin: 150 }),
    item("weekendNear", { driveMin: 30, thisWeekend: true }),
  ];
  const r = applyExploreQuery(xs, { maxMin: null, regions: [], sort: "popular" }, pop);
  assert.deepEqual(r.items.map((x) => x.id), ["weekendNear", "weekendFar", "near", "far"]);
  assert.equal(r.popularReady, false);
  // 기본 정렬이면 들어온 순서 그대로
  const d = applyExploreQuery(xs, { maxMin: null, regions: [], sort: "default" }, pop);
  assert.deepEqual(d.items.map((x) => x.id), ["near", "weekendFar", "far", "weekendNear"]);
});

test("인기: 100선 우리 명소는 우리 id로도 센다", () => {
  const pop: Popularity = new Map([["hahoe", { picked: 4, visited: 1 }]]);
  const xs = [item("ext:tour:1", { ourPlaceId: "hahoe", kind: "place" }), item("ext:tour:2")];
  const r = applyExploreQuery(xs, { maxMin: null, regions: [], sort: "popular" }, pop);
  assert.equal(r.items[0].id, "ext:tour:1");
  assert.equal(r.items[0].popular, 4);
  assert.equal(r.popularReady, true);
});
