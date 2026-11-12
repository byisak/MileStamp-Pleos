/* 명소발굴 100x100 후보: 올리는 줄 검사·거르기·지도 주소 (DB 없이). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { likeEscape, parseSpotQuery, parseSpotRows, spotMapLinks, spotNote, spotSidoFromAddr, SPOT_META } from "./spot100-shape";

const row = (o: Record<string, unknown> = {}) => ({
  key: "성심당 본점|대전 중구 대종로480번길 15", name: "성심당 본점", lat: 36.32774, lng: 127.42725,
  addr: "대전 중구 대종로480번길 15", sido: "30", cid: "1796079", img: "http://tong.visitkorea.or.kr/a.jpg", url: "https://naver.me/x",
  topics: [{ t: 3, th: 99, r: 1, n: "대전 대표 빵집" }, { t: 10, th: 4, r: 5, n: "밀가루로드의 시작" }], ...o,
});

test("메타: 테마 8 · 주제 100, 주제의 테마 번호가 범위 안", () => {
  assert.equal(SPOT_META.themes.length, 8);
  assert.equal(SPOT_META.topics.length, 100);
  assert.ok(SPOT_META.topics.every((t) => t.th >= 0 && t.th < 8));
  assert.equal(SPOT_META.topics[3].name, "전국 방방곡곡 빵지순례");
});

test("올리기: 정상 줄은 받고 http 그림은 https로, 테마는 주제에서 다시 정함", () => {
  const { rows, errors } = parseSpotRows([row()]);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].img, "https://tong.visitkorea.or.kr/a.jpg");
  assert.equal(rows[0].sido, "30");
  assert.equal(rows[0].topics[0].th, SPOT_META.topics[3].th);
  assert.equal(rows[0].cid, "1796079");
});

test("올리기: 시·도 코드가 없으면 주소 앞머리로, 모르면 null", () => {
  assert.equal(parseSpotRows([row({ sido: null, addr: "경북 경주시 불국로" })]).rows[0].sido, "47");
  assert.equal(parseSpotRows([row({ sido: null, addr: null, key: "k2" })]).rows[0].sido, null);
});

test("시·도: '전남광주'는 구면 광주, 시·군이면 전남", () => {
  assert.equal(spotSidoFromAddr("전남광주 동구 서석로 1-1"), "29");
  assert.equal(spotSidoFromAddr("전남광주 광산구 어등대로"), "29");
  assert.equal(spotSidoFromAddr("전남광주 목포시"), "46");
  assert.equal(spotSidoFromAddr("전남광주 담양군 담양읍"), "46");
  assert.equal(spotSidoFromAddr("대구 북구"), "27");
  assert.equal(spotSidoFromAddr(""), null);
});

test("올리기: 이상한 줄은 건너뛰고 까닭을 남김", () => {
  const bad = [
    row({ name: "" }), row({ key: "a", lat: 0, lng: 0 }), row({ key: "b", lat: 99 }),
    row({ key: "c", topics: [] }), row({ key: "d", topics: [{ t: 100, n: "x" }] }),
    row({ key: "e", cid: "abc", img: "ftp://x", url: "javascript:1" }),
    row({ key: "e" }),
  ];
  const { rows, errors } = parseSpotRows(bad);
  assert.equal(errors.length, 6);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, null);
  assert.equal(rows[0].img, null);
  assert.equal(rows[0].url, null);
});

test("올리기: 목록이 아니거나 500곳이 넘으면 통째로 막음", () => {
  assert.equal(parseSpotRows({}).rows.length, 0);
  const many = Array.from({ length: 501 }, (_, i) => row({ key: `k${i}` }));
  const r = parseSpotRows(many);
  assert.equal(r.rows.length, 0);
  assert.equal(r.errors.length, 1);
});

test("거르기 값: 틀린 값은 없는 것, 쪽·크기 한도", () => {
  const q = (s: string) => parseSpotQuery(new URLSearchParams(s));
  const a = q("sido=27&theme=4&topic=3&cid=1&status=ok&q=%20빵%20&page=2&size=50");
  assert.deepEqual(a, { sido: "27", theme: 4, topic: 3, hasCid: true, status: "ok", q: "빵", page: 2, size: 50 });
  const b = q("sido=99&theme=8&topic=100&cid=x&status=zzz&page=0&size=9999");
  assert.deepEqual(b, { sido: null, theme: null, topic: null, hasCid: null, status: null, q: "", page: 1, size: 100 });
  assert.equal(q("cid=0").hasCid, false);
  assert.equal(q("").size, 30);
});

test("검색어의 % _ 는 글자 그대로", () => {
  assert.equal(likeEscape("a%b_c\\"), "a\\%b\\_c\\\\");
});

test("지도 주소: 카카오는 이름+좌표, 네이버는 이름 검색", () => {
  const m = spotMapLinks("A/B,C", 35.1, 128.2);
  assert.equal(m.kakao, "https://map.kakao.com/link/map/A%20B%20C,35.1,128.2");
  assert.equal(m.naver, "https://map.naver.com/p/search/A%2FB%2CC");
});

test("대표 설명: 주제 순번이 앞선 것", () => {
  assert.equal(spotNote([{ t: 1, th: 4, r: 9, n: "뒤" }, { t: 2, th: 4, r: 2, n: "앞" }]), "앞");
  assert.equal(spotNote([]), "");
});
