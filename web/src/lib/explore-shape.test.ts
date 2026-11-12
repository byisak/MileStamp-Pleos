/* 내가 고르기: TourAPI 답 읽기·축제 합치기·정렬·차 시간 거르기·100선 맞추기 (DB·네트워크 없이). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanQuery, curatedItem, driveMinFrom, matchOurPlace, mergeFestivals, namesMatch, nearOnly, normName, ourFestivalItem,
  sortNearest, tourPlaceItem, weekendOf, type ExploreItem,
} from "./explore-shape";
import { curatedSql, curatedTsv, parseCuratedTable } from "./kto100-shape";
import { parseTourPage, tourError, tourUrl } from "./tourapi-shape";
import { TravelTime } from "./planner";

const fx = JSON.parse(readFileSync(join(import.meta.dirname, "explore-fixtures.json"), "utf8"));
const HOME = { lat: 35.8858, lng: 128.5828 }; // 대구 북구청 (데모 집)

const OUR_PLACES = [
  { id: "hahoe", name: "안동 하회마을", lat: 36.539, lng: 128.518, stampable: true, indoor: false },
  { id: "cablecar", name: "팔공산 케이블카", lat: 35.99085, lng: 128.69487, stampable: true, indoor: false },
  { id: "donghwa", name: "팔공산 동화사", lat: 35.98431, lng: 128.69853, stampable: true, indoor: false },
  { id: "hanbam", name: "한밤마을 돌담길", lat: 36.0593, lng: 128.655, stampable: false, indoor: false },
  { id: "dgsm", name: "국립대구과학관", lat: 35.6862, lng: 128.46642, stampable: true, indoor: true },
  { id: "nmd", name: "국립대구박물관", lat: 35.84586, lng: 128.63721, stampable: true, indoor: true },
  { id: "aquarium", name: "대구아쿠아리움", lat: 35.87802, lng: 128.62943, stampable: true, indoor: true },
  { id: "bullo", name: "대구 불로동 고분군", lat: 35.91545, lng: 128.64689, stampable: true, indoor: false },
];

test("TourAPI 답 읽기: 축제 여러 줄·좌표 0은 null·http 그림은 https·날짜 모양", () => {
  const p = parseTourPage(fx.festival);
  assert.equal(p.items.length, 6);
  assert.equal(p.totalCount, 6);
  const a = p.items[0];
  assert.deepEqual(
    { id: a.contentId, type: a.contentTypeId, starts: a.starts, ends: a.ends, lat: a.lat, lng: a.lng, image: a.image, region: a.region },
    { id: "3100001", type: "15", starts: "2026-10-20", ends: "2026-11-09", lat: 35.991, lng: 128.695, image: "https://tong.visitkorea.or.kr/cms/a.jpg", region: "27" },
  );
  assert.equal(p.items[1].image, null);
  const noCoord = p.items.find((x) => x.contentId === "3100005")!;
  assert.equal(noCoord.lat, null);
  assert.equal(noCoord.lng, null);
});

test("TourAPI 답 읽기: 한 줄이면 배열이 아니라 객체·빈 답은 ''·오류 답", () => {
  const s = parseTourPage(fx.search);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].addr, "경상북도 안동시 풍천면 전서로 186 (풍천면)");
  assert.equal(s.items[0].starts, undefined);
  assert.deepEqual(parseTourPage(fx.empty).items, []);
  assert.deepEqual(parseTourPage(null).items, []);
  assert.equal(tourError(fx.festival), null);
  assert.match(tourError(fx.keyError)!, /SERVICE_KEY/);
  assert.match(tourError(fx.headerError)!, /^22 /);
  assert.ok(tourError("문자열"));
});

test("TourAPI 주소: 키는 이미 %가 있으면 그대로, 아니면 한 번만 바꿈", () => {
  assert.match(tourUrl("searchKeyword2", "ab%2Bc", { keyword: "경주" }), /serviceKey=ab%2Bc&MobileOS=ETC&MobileApp=milestamp&_type=json&keyword=%EA%B2%BD%EC%A3%BC$/);
  assert.match(tourUrl("searchFestival2", "a+b/c=", {}), /\/KorService2\/searchFestival2\?serviceKey=a%2Bb%2Fc%3D&/);
});

test("이번 주말: 평일이면 다가오는 토·일, 토요일은 토·일, 일요일은 그날만", () => {
  assert.deepEqual(weekendOf("2026-10-28"), { sat: "2026-10-31", sun: "2026-11-01" }); // 수
  assert.deepEqual(weekendOf("2026-10-31"), { sat: "2026-10-31", sun: "2026-11-01" }); // 토
  assert.deepEqual(weekendOf("2026-11-01"), { sat: "2026-11-01", sun: "2026-11-01" }); // 일
  assert.deepEqual(weekendOf("2026-12-28"), { sat: "2027-01-02", sun: "2027-01-03" }); // 해 넘김
});

test("차 시간: planner TravelTime 그대로 (직선 × 1.3 ÷ 50km/h, 반올림)", () => {
  const to = { lat: 36.539, lng: 128.518 };
  assert.equal(driveMinFrom(HOME, to.lat, to.lng), TravelTime.minutes(HOME, to));
  assert.equal(driveMinFrom(null, to.lat, to.lng), null);
  assert.equal(driveMinFrom(HOME, HOME.lat, HOME.lng), 0);
});

function festivals(from = "2026-10-28", days = 30) {
  const wk = weekendOf(from);
  const ours = [
    ourFestivalItem({ id: "fest-palgong-2026", name: "팔공산 단풍축제", starts: "2026-10-20", ends: "2026-11-09", lat: 35.99085, lng: 128.69487, indoor: false, poster: null }, HOME, wk),
    ourFestivalItem({ id: "fest-old", name: "지난 축제", starts: "2026-09-01", ends: "2026-09-10", lat: 35.9, lng: 128.6, indoor: false, poster: null }, HOME, wk),
  ];
  return mergeFestivals({ ours, tour: parseTourPage(fx.festival).items, home: HOME, from, days });
}

test("축제 합치기: 등록 축제가 먼저(ourStamp), 같은 축제 TourAPI 줄은 빠짐, 끝난 것·좌표 없는 것 빠짐", () => {
  const xs = festivals();
  assert.deepEqual(xs.map((x) => x.id), [
    "fest-palgong-2026",   // 우리 축제 (이번 주말 열림)
    "ext:tour:3100006",    // 이번 주말(11/1) · 가까움
    "ext:tour:3100002",    // 이번 주말(10/31~11/1) · 경주
    "ext:tour:3100003",    // 이번 주말 · 서울 (멀다)
  ]);
  assert.equal(xs[0].kind, "festival");
  assert.equal(xs[0].ourStamp, true);
  assert.equal(xs[1].kind, "tour");
  assert.equal(xs[1].ourStamp, false);
  assert.ok(xs.every((x) => x.thisWeekend));
  // 이름이 같은 TourAPI '팔공산 단풍축제'(3100001)는 등록 축제와 겹쳐 빠짐
  assert.ok(!xs.some((x) => x.id === "ext:tour:3100001"));
});

test("축제 정렬: 이번 주말이 아닌 축제는 가까워도 뒤로", () => {
  const xs = festivals("2026-11-02", 30); // 월요일 → 이번 주말 11/7~8
  const ids = xs.map((x) => x.id);
  // 서울 빛초롱(11/1~11/30)은 11/7~8에 열림 → 멀어도 앞. 수성못(11/1~2)은 오늘(월)까지라 주말이 아님 → 가까워도 뒤
  assert.deepEqual(ids, ["fest-palgong-2026", "ext:tour:3100003", "ext:tour:3100006"]);
  assert.equal(xs[1].thisWeekend, true);
  assert.equal(xs[2].thisWeekend, false);
  assert.ok(xs[2].driveMin! < xs[1].driveMin!);
});

test("가까운 곳만(차로 2시간): 서울 축제는 빠지고, 집을 모르면 거르지 않음", () => {
  const xs = festivals();
  const near = nearOnly(xs);
  assert.ok(!near.some((x) => x.id === "ext:tour:3100003"));
  assert.ok(near.some((x) => x.id === "ext:tour:3100002"));
  assert.ok(near.every((x) => x.driveMin! <= 120));
  const unknown: ExploreItem[] = xs.map((x) => ({ ...x, driveMin: null }));
  assert.equal(nearOnly(unknown).length, unknown.length);
});

test("이름 맞추기: 띄어쓰기·괄호·[]는 무시, 짧은 지역 이름만으로는 안 묶임", () => {
  assert.equal(normName("안동 하회마을 [유네스코 세계유산]"), "안동하회마을");
  assert.ok(namesMatch("안동하회마을", "안동 하회마을"));
  assert.ok(namesMatch("안동 하회마을 [유네스코 세계유산]", "안동 하회마을"));
  assert.ok(namesMatch("팔공산국립공원", "팔공산 케이블카"));
  assert.ok(namesMatch("동화사", "팔공산 동화사"));
  assert.ok(!namesMatch("국립대구과학관", "국립대구박물관"));
  assert.ok(!namesMatch("대구아쿠아리움", "대구 불로동 고분군"));
  assert.ok(!namesMatch("사유원", "한밤마을 돌담길"));
});

test("100선 ↔ 우리 명소: 이름이 비슷하고 5km 안인 곳 중 가장 가까운 곳, 좌표만 가까우면 안 묶음", () => {
  assert.equal(matchOurPlace({ name: "안동하회마을", lat: 36.539, lng: 128.518 }, OUR_PLACES)?.id, "hahoe");
  assert.equal(matchOurPlace({ name: "팔공산국립공원", lat: 35.99, lng: 128.695 }, OUR_PLACES)?.id, "cablecar");
  assert.equal(matchOurPlace({ name: "사유원", lat: 36.0593, lng: 128.655 }, OUR_PLACES), null); // 같은 자리여도 이름이 다르면 X
  assert.equal(matchOurPlace({ name: "안동하회마을", lat: 37.5, lng: 127.0 }, OUR_PLACES), null); // 이름은 같아도 멀면 X
  assert.equal(matchOurPlace({ name: "안동하회마을", lat: null, lng: null }, OUR_PLACES), null);
});

test("100선 줄: 우리 명소면 kind 'place'·도장, 아니면 ext:tour(번호 알 때) / ext:kto100(모를 때)", () => {
  const row = { no: 82, name: "안동하회마을", content_id: null, lat: 36.539, lng: 128.518, area: "경상권", region: "경북", addr: "경북 안동시", image: null };
  const ours = curatedItem(row, matchOurPlace(row, OUR_PLACES), HOME)!;
  assert.deepEqual({ kind: ours.kind, id: ours.id, ourStamp: ours.ourStamp, ourPlaceId: ours.ourPlaceId, type: ours.type, no: ours.no },
    { kind: "place", id: "hahoe", ourStamp: true, ourPlaceId: "hahoe", type: "한국관광 100선", no: 82 });
  const ext = curatedItem({ ...row, no: 73, name: "사유원", lat: 36.033, lng: 128.68 }, null, HOME)!;
  assert.equal(ext.id, "ext:kto100:73");
  assert.equal(ext.kind, "tour");
  assert.equal(curatedItem({ ...row, name: "사유원", content_id: "2785394" }, null, HOME)!.id, "ext:tour:2785394");
  assert.equal(curatedItem({ ...row, lat: null }, null, HOME), null);
});

test("찾기 줄·가까운 순: 우리 도장 먼저, 그다음 차 시간", () => {
  const t = parseTourPage(fx.search).items[0];
  const item = tourPlaceItem(t, HOME)!;
  assert.equal(item.id, "ext:tour:125413");
  assert.equal(item.type, "관광지");
  const near: ExploreItem = { ...item, id: "ext:tour:1", driveMin: 10 };
  const mine: ExploreItem = { ...item, id: "hahoe", kind: "place", ourStamp: true, driveMin: 90 };
  assert.deepEqual(sortNearest([item, near, mine]).map((x) => x.id), ["hahoe", "ext:tour:1", "ext:tour:125413"]);
});

test("검색어 다듬기: 공백 정리·2글자 미만은 빈 값", () => {
  assert.equal(cleanQuery("  경주   박물관 "), "경주 박물관");
  assert.equal(cleanQuery("가"), "");
  assert.equal(cleanQuery(" 가 "), "");
  assert.equal(cleanQuery(null), "");
});

test("100선 표: TSV·CSV(따옴표·BOM) 읽기, 이름 없는 줄·중복·이상한 좌표는 오류", () => {
  const tsv = readFileSync(join(import.meta.dirname, "../../../tools/kto100/kto100-2025.tsv"), "utf8");
  const { rows, errors } = parseCuratedTable(tsv);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map((r) => r.no)).size, 100);
  assert.ok(rows.every((r) => r.lat! > 33 && r.lat! < 39 && r.lng! > 126 && r.lng! < 131));
  assert.deepEqual(rows.filter((r) => r.region === "대구").map((r) => r.name), ["사유원", "서문시장&동성로", "팔공산국립공원"]);

  const csv = '﻿순번,권역,관광지,위도,경도,콘텐츠ID\r\n1,경상권,"불국사&석굴암, 경주",35.79,129.332,126207\r\n2,경상권,,1,2,\r\n3,경상권,"불국사&석굴암, 경주",1,2,\r\n4,제주권,우도,999,1,\r\n5,제주권,비자림,,,\r\n';
  const r = parseCuratedTable(csv);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { no: 1, name: "불국사&석굴암, 경주", area: "경상권", region: null, lat: 35.79, lng: 129.332, addr: null, content_id: "126207", image: null, our_place_id: null });
  assert.equal(r.rows[1].lat, null);
  assert.equal(r.errors.length, 3);
  assert.match(parseCuratedTable("a,b\n1,2").errors[0], /이름/);
});

test("100선 SQL: 여러 번 돌려도 같은 모양(on conflict), 따옴표 이스케이프, 판에 없는 이름 지움", () => {
  const { rows } = parseCuratedTable("no\tname\tlat\tlng\n1\t어린이's 숲\t35.1\t128.1\n2\t우도\t33.5\t126.95\n");
  const s = curatedSql("kto100-2025", rows);
  assert.match(s, /on conflict \(list, name\) do update/);
  assert.match(s, /'어린이''s 숲'/);
  assert.match(s, /delete from curated_places where list = 'kto100-2025' and name not in \('어린이''s 숲', '우도'\);/);
  assert.equal(parseCuratedTable(curatedTsv(rows)).rows.length, 2);
});
