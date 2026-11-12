/* 식당 구조 칸 · 카카오 가져오기 · 밥 자리 모양 (restaurant-shape.ts · planner.ts mealSessions · ext.ts · diary-shape.ts). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cuisineFromKakao, engineRestaurant, foodCompleteness, kakaoDraft, parseFoodInput, parseKakaoCategory, pickKakaoFoods, type FoodRestaurant, type KakaoFood,
} from "./restaurant-shape";
import { mealSessions, isMealPlace, legJson, legOfJson, type Restaurant } from "./planner";
import { extPlace, isExtId } from "./ext";
import { buildFacts, fallbackStory, type DiaryRaw } from "./diary-shape";

const base = { name: "할매칼국수", lat: 35.84, lng: 128.63, cuisine: ["면"], active: true };

test("식당 입력: 좌표 필수 · 켜려면 음식 종류 1~2개", () => {
  assert.match((parseFoodInput({ ...base, lat: null }) as { error: string }).error, /좌표/);
  assert.match((parseFoodInput({ ...base, cuisine: [] }) as { error: string }).error, /음식 종류/);
  assert.ok("ok" in parseFoodInput({ ...base, cuisine: [], active: false }), "꺼진 초안은 음식 종류 없이도");
  assert.match((parseFoodInput({ ...base, cuisine: ["면", "한식", "분식"] }) as { error: string }).error, /2개까지/);
  assert.match((parseFoodInput({ ...base, cuisine: ["라멘"] }) as { error: string }).error, /음식 종류는/);
});

test("식당 입력: 운영 시간 줄 — 브레이크는 영업 안, 마지막 주문은 쉬는 시간 밖", () => {
  const row = { days: [0, 1, 2, 3, 4, 5, 6], openMin: 630, closeMin: 1230, breaks: [{ fromMin: 900, toMin: 990 }], lastOrderMin: 1200 };
  const ok = parseFoodInput({ ...base, openHours: [row] });
  assert.ok("ok" in ok);
  assert.equal(ok.ok.openHours[0].lastOrderMin, 1200);
  assert.deepEqual(ok.ok.openHours[0].breaks, [{ fromMin: 900, toMin: 990 }]);
  assert.match((parseFoodInput({ ...base, openHours: [{ ...row, lastOrderMin: 950 }] }) as { error: string }).error, /쉬는 시간 안/);
  assert.match((parseFoodInput({ ...base, openHours: [{ ...row, breaks: [{ fromMin: 1200, toMin: 1300 }] }] }) as { error: string }).error, /영업 시간 안/);
});

test("식당 입력: 주차·붐빔·가격·아이 칸·머무름·태그", () => {
  const r = parseFoodInput({
    ...base, parking: { has: "yes", fee: "free" }, wait: { weekday: 0, weekend_lunch: 2 }, price: { level: 1 },
    kid: { high_chair: true, kids_menu: true, nope: true }, dwellMin: 40, tags: ["아이랑", "없는 말"], meal: ["lunch", "brunch"],
  });
  assert.ok("ok" in r);
  assert.deepEqual(r.ok.parking, { has: "yes", fee: "free" });
  assert.deepEqual(r.ok.wait, { weekday: 0, weekend_lunch: 2 });
  assert.deepEqual(r.ok.kid, { high_chair: true, kids_menu: true });
  assert.deepEqual(r.ok.tags, ["아이랑"]);
  assert.deepEqual(r.ok.meal, ["lunch"]);
  assert.match((parseFoodInput({ ...base, wait: { weekday: 3 } }) as { error: string }).error, /붐빔/);
  assert.match((parseFoodInput({ ...base, dwellMin: 200 }) as { error: string }).error, /머무름/);
});

const food = (over: Partial<FoodRestaurant> = {}): FoodRestaurant => {
  const r = parseFoodInput({ ...base, parking: { has: "yes", fee: "free" }, openHours: [{ days: [1, 2, 3, 4, 5], openMin: 660, closeMin: 1260 }] });
  assert.ok("ok" in r);
  return { id: "11111111-1111-1111-1111-111111111111", ...r.ok, aiDrafts: {}, ...over };
};

test("엔진 식당: 확인 필요(check)인 운영 시간·주차는 조건으로 안 쓴다", () => {
  const e = engineRestaurant(food())!;
  assert.equal(e.hours!.length, 1);
  assert.equal(e.parkingHas, "yes");
  const c = engineRestaurant(food({ meta: { hours: { src: "kakao", conf: 0.6, at: "2026-11-03", check: true }, parking: { src: "ai", conf: 0.5, at: "2026-11-03", check: true } } }))!;
  assert.deepEqual(c.hours, []);
  assert.equal(c.parkingHas, null);
  assert.equal(engineRestaurant(food({ lat: null })), null);
  assert.ok(foodCompleteness(food()).done >= 4);
});

test("영업 구간: 브레이크로 나누고 마지막 주문 뒤 구간은 없앤다 · 그날 줄이 없으면 쉼", () => {
  const r: Restaurant = {
    id: "x", name: "x", at: { lat: 0, lng: 0 },
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], holiday: false, openMin: 630, closeMin: 1290, lastEntryMin: null, breaks: [{ fromMin: 900, toMin: 1020 }], validFrom: null, validTo: null, note: null, lastOrderMin: 1200 }],
  };
  assert.deepEqual(mealSessions(r, "2026-11-04"), [{ fromMin: 630, toMin: 900, lastOrderMin: null }, { fromMin: 1020, toMin: 1290, lastOrderMin: 1200 }]);
  assert.deepEqual(mealSessions({ ...r, hours: [{ ...r.hours![0], days: [6] }] }, "2026-11-04"), null);
  assert.deepEqual(mealSessions({ ...r, hours: [] }, "2026-11-04"), [{ fromMin: 660, toMin: 1260, lastOrderMin: null }]);
});

test("카카오 분류 → 음식 종류", () => {
  assert.deepEqual(cuisineFromKakao("음식점 > 한식 > 국수 > 칼국수"), ["면"]);
  assert.deepEqual(cuisineFromKakao("음식점 > 한식 > 해장국"), ["국밥"]);
  assert.deepEqual(cuisineFromKakao("음식점 > 한식 > 육류,고기 > 갈비"), ["고기"]);
  assert.deepEqual(cuisineFromKakao("음식점 > 일식 > 초밥,롤"), ["일식", "해물"]);
  assert.deepEqual(cuisineFromKakao("음식점 > 간식 > 제과,베이커리"), ["베이커리"]);
  assert.deepEqual(cuisineFromKakao("음식점 > 양식 > 이탈리안"), ["양식"]);
  assert.deepEqual(cuisineFromKakao("음식점 > 한식"), ["한식"]);
  assert.deepEqual(cuisineFromKakao("", "CE7"), ["카페"]);
});

test("카카오 답 읽기 · 가까운 3곳 · 이미 있는 번호·같은 건물 같은 이름은 빼기 · 초안은 꺼짐 + 확인 필요", () => {
  const json = {
    documents: [
      { id: "1001", place_name: "먼 집", category_name: "음식점 > 한식", category_group_code: "FD6", x: "128.6", y: "35.8", distance: "1600" },
      { id: "1002", place_name: "할매칼국수", category_name: "음식점 > 한식 > 국수 > 칼국수", category_group_code: "FD6", phone: "053-1", road_address_name: "대구 북구 1", place_url: "http://place.map.kakao.com/1002", x: "128.6", y: "35.8", distance: "100" },
      { id: "1003", place_name: "할매칼국수", category_name: "음식점 > 한식 > 국수", category_group_code: "FD6", x: "128.6001", y: "35.8001", distance: "120" },
      { id: "1004", place_name: "있는 집", category_name: "음식점 > 분식", category_group_code: "FD6", x: "128.6", y: "35.8", distance: "50" },
      { id: "1005", place_name: "국밥", category_name: "음식점 > 한식 > 해장국", category_group_code: "FD6", x: "128.6", y: "35.8", distance: "300" },
      { id: "1006", place_name: "갈비", category_name: "음식점 > 한식 > 육류,고기", category_group_code: "FD6", x: "128.6", y: "35.8", distance: "400" },
      { id: "bad", place_name: "", x: "x" },
    ],
  };
  const items = parseKakaoCategory(json);
  assert.equal(items.length, 6);
  assert.equal(items.find((x) => x.kakaoId === "1002")!.url, "https://place.map.kakao.com/1002");
  const picked = pickKakaoFoods(items, new Set(["1004"]), 3);
  assert.deepEqual(picked.map((x) => x.kakaoId), ["1002", "1005", "1006"]);
  const d = kakaoDraft(picked[0] as KakaoFood, "nmd", "2026-11-03");
  assert.equal(d.active, false);
  assert.equal(d.kakaoId, "1002");
  assert.deepEqual(d.cuisine, ["면"]);
  assert.equal(d.meta.cuisine?.src, "kakao");
  assert.equal(d.meta.cuisine?.check, true);
  assert.equal(d.placeId, "nmd");
});

test("밥 칸 JSON: MEAL은 STAY + meal로 나가고 되읽으면 MEAL", () => {
  const l = { kind: "MEAL" as const, fromMin: 700, toMin: 750, placeId: "ext:food:abc" };
  assert.deepEqual(legJson(l), { kind: "STAY", fromMin: 700, toMin: 750, placeId: "ext:food:abc", meal: true });
  assert.deepEqual(legOfJson(legJson(l)), l);
  assert.deepEqual(legOfJson({ kind: "STAY", fromMin: 1, toMin: 2, placeId: "nmd" }), { kind: "STAY", fromMin: 1, toMin: 2, placeId: "nmd" });
});

test("밥 자리 바깥 장소 'ext:food:<id>' → 식사 자리 Place (실내 · 머무름 그대로 · 마지막 주문)", () => {
  const id = "ext:food:11111111-1111-1111-1111-111111111111";
  assert.ok(isExtId(id));
  const p = extPlace({ id, name: "할매칼국수", lat: 35.84, lng: 128.63, dwell: 50, open: 630, close: 900, lastEntry: 870 });
  assert.ok(typeof p !== "string");
  assert.ok(isMealPlace(p));
  assert.equal(p.indoor, true);
  assert.equal(p.adultDwellMin, 50);
  assert.equal(p.lastEntryMin, 870);
});

test("일기: 들른 밥 자리는 '점심은 ○○에서'", () => {
  const raw: DiaryRaw = {
    day: "2026-10-31", today: "2026-11-01", option: null, sky: null, companion: "kids", stamps: [], dwell: [], ext: [], summary: null, departMin: null,
    course: {
      stops: [
        { placeId: "nmd", status: "DONE", actualArriveMin: 600, actualDepartMin: 690, name: "국립대구박물관" },
        { placeId: "ext:food:abc", status: "DONE", actualArriveMin: 700, actualDepartMin: 750, name: "할매칼국수" },
      ],
    } as never,
    nameOf: () => null,
  } as DiaryRaw;
  const f = buildFacts(raw);
  assert.deepEqual(f.meals?.map((m) => `${m.kind}:${m.name}`), ["점심:할매칼국수"]);
  const s = fallbackStory(f, "parent");
  assert.match(s, /점심은 할매칼국수에서 먹었어요/);
  assert.doesNotMatch(s, /할매칼국수에서 \d/);
  assert.match(fallbackStory(f, "child"), /점심은 할매칼국수에서 먹었다/);
});
