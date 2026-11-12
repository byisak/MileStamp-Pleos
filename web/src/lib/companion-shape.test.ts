/* 누구랑 가요? 모양 시험 (companion-shape.ts). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { companionSign, fitView, parseFitInput, parseTagsInput } from "./companion-shape";
import { optionJsonOf } from "./plan";
import { firstBoarding, hhmm, defaultProfile, type Place } from "./planner";

test("fit: DB 값 → 4칸 (비면 어른 0.6, kids = kid_fit)", () => {
  assert.deepEqual(fitView(0.9, null), { kids: 0.9, couple: 0.6, friends: 0.6, solo: 0.6 });
  assert.deepEqual(fitView(0.5, { kids: 0.1, couple: 0.85, solo: "x" }), { kids: 0.5, couple: 0.85, friends: 0.6, solo: 0.6 });
});

test("관리자 입력: fit 0~1 · 표시 정리", () => {
  assert.deepEqual(parseFitInput(null, 0.7), { fit: null });
  assert.deepEqual(parseFitInput({ couple: 0.8, friends: "0.4", solo: 1 }, 0.7), { fit: { kids: 0.7, couple: 0.8, friends: 0.4, solo: 1 } });
  assert.ok("error" in parseFitInput({ couple: 2 }, 0.7));
  assert.deepEqual(parseTagsInput(["#야경", " 카페 ", "야경", ""]), ["야경", "카페"]);
  assert.equal(parseTagsInput("야경"), null);
});

test("목록 동행 표시: 어른 위주 행사는 아이와 −, 연인·친구 +", () => {
  const beer = { name: "대구 치맥 페스티벌" };
  assert.equal(companionSign(beer, "kids").sign, -1);
  assert.equal(companionSign(beer, "kids").note, "어른 위주 행사");
  assert.equal(companionSign(beer, "couple").sign, 1);
  assert.equal(companionSign(beer, "friends").sign, 1);
  assert.equal(companionSign(beer, "solo").sign, 0);
  assert.equal(companionSign({ name: "어린이 과학 체험전" }, "kids").sign, 1);
  assert.equal(companionSign({ name: "어린이 과학 체험전" }, "couple").sign, -1);
  // 우리 명소는 fit 값
  const fit = fitView(1.0, { couple: 0.3, friends: 0.6, solo: 0.9 });
  assert.deepEqual(companionSign({ name: "x" }, "couple", fit), { sign: -1, note: "둘이선 심심해요" });
  assert.deepEqual(companionSign({ name: "x" }, "solo", fit), { sign: 1, note: "혼자 좋아요" });
});

test("카드 JSON: kind는 예전 그대로(차 앱), pick이 따로", () => {
  const home = { lat: 35.8858, lng: 128.5828 };
  const p: Place = { id: "chimsan", name: "침산공원", at: { lat: 35.89523, lng: 128.58586 }, indoor: false, dwellP80Min: 40, kidFit: 0.6,
    openMin: 0, closeMin: 1440, popular: 0, stampable: true, tags: ["야경"], fit: { couple: 0.75 } };
  const plan = firstBoarding(hhmm("17:30"), home, { ...defaultProfile(home), companion: "couple" }, [p], { sunriseMin: null, sunsetMin: hhmm("17:41"), sky: "CLEAR", rainFromMin: null });
  const j = plan.options.map((o) => optionJsonOf(o));
  assert.deepEqual(j.map((o) => [o.kind, o.pick]), [["HOMEWARD", "short"], ["GO_HOME", "home"]]);
  assert.deepEqual(j[0].reasons.map((r) => r.text), ["야경 · 해 진 뒤", "우회 +4분", "도장 +1"]);
});
