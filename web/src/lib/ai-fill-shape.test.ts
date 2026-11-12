/* AI 입력 돕기 — 원문 인용 검사 · 칸 검사 · 합치기 · 받아들이기 (ai-fill-shape.ts) + 사용량 읽기 (ai-usage.ts). 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptFoodDraft, acceptPlaceDraft, buildFillPrompt, discardDraft, draftText, extractJson, fillTargets, hoursFromAi, mergeDrafts, quoteFound,
  scrubPersonal, sourceText, validateAiAnswer,
} from "./ai-fill-shape";
import { draftsOf, parseAiDrafts, parseMeta, DEFAULT_TAG_VOCAB, type AiDraft } from "./place-attrs-shape";
import { parseFoodInput, type FoodRestaurant } from "./restaurant-shape";
import { parsePlaceInput, type AdminPlace } from "./catalog-shape";
import { estimateKrw, usageOf } from "./ai-usage";

const TODAY = "2026-11-03";
const SOURCE = sourceText([
  { label: "관광공사 이용 정보", text: "이용시간: 09:00~18:00 (입장마감 17:00)\n쉬는날: 매주 월요일, 설·추석 당일\n주차: 공영주차장(무료) 이용, 정문까지 도보 3분" },
  { label: "관리자 붙여 넣기", text: "야간 조명은 22시까지 운영합니다. 문의 053-123-4567 / help@park.kr" },
]);
const CTX = { source: SOURCE, today: TODAY, vocab: DEFAULT_TAG_VOCAB.map((v) => v.tag), hours: [], open: 540, close: 1080 };

const place = (over: Partial<AdminPlace> = {}): AdminPlace => ({
  id: "chimsan", name: "침산공원", lat: 35.895, lng: 128.585, region: "대구 북구", research: null, album: "weekend", indoor: false,
  open: 540, close: 1080, dwell: 40, kidFit: 0.8, fit: { kids: 0.8, couple: 0.6, friends: 0.6, solo: 0.5 }, dwellAdult: null,
  stampable: true, active: true, tags: [], hours: null, closed: null, facilities: [], closedDays: [], tempClosed: [],
  points: [{ lat: 35.895, lng: 128.585, r: 300, name: "정문" }], intro: "", mission: null, stamp: { url: null, bwUrl: null, version: 1 },
  popular: 0, editedAt: null, openHours: [], closedRules: [], parking: null, price: null, moments: null, regionCode: null, kind: "spot",
  route: null, fitExtra: {}, meta: {}, aiDrafts: {}, ...over,
});

test("원문: 전화·메일은 지우고 보낸다 (개인정보 · 가게 전화도 AI엔 필요 없음)", () => {
  assert.equal(scrubPersonal("문의 053-123-4567, 010 1234 5678, 1588-1234, a.b@c.kr"), "문의 (전화), (전화), (전화), (메일)");
  assert.ok(!SOURCE.includes("053-123-4567") && !SOURCE.includes("help@park.kr"));
  assert.ok(SOURCE.includes("[관광공사 이용 정보]"));
  // 부탁 글에도 남지 않음 · 정해진 말 목록이 들어감
  const p = buildFillPrompt({ kind: "place", name: "침산공원", sources: [{ label: "x", text: "전화 010-9999-8888" }], fields: ["parking", "tags"], vocab: ["야경"] });
  assert.ok(!p.user.includes("9999") && p.user.includes('"야경"') && p.user.includes('"parking"'));
});

test("원문 인용: 띄어쓰기·문장 부호가 달라도 같은 글이면 있음, 지어낸 글은 없음", () => {
  assert.ok(quoteFound("공영주차장(무료) 이용", SOURCE));
  assert.ok(quoteFound("09:00 ~ 18:00", SOURCE));
  assert.ok(!quoteFound("주차 1시간 무료", SOURCE));
  assert.ok(!quoteFound("월", SOURCE), "한 글자 인용은 근거로 안 침");
});

test("AI 답 읽기: 울타리·앞뒤 말이 있어도 JSON만", () => {
  assert.deepEqual(extractJson('네, 여기요:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(extractJson("모르겠어요"), null);
  assert.equal(extractJson("[1,2]"), null);
});

test("AI 답 검사: 물은 칸만 · 인용이 원문에 있어야 · 값은 저장 검사와 같은 함수", () => {
  const answer = {
    hours: { value: [{ days: [0, 2, 3, 4, 5, 6], open: "09:00", close: "18:00", last_entry: "17:00" }], quote: "이용시간: 09:00~18:00 (입장마감 17:00)" },
    closed: { value: { days: ["월"], rules: ["seollal", "chuseok", "lunar_whatever"] }, quote: "매주 월요일, 설·추석 당일" },
    parking: { value: { has: "yes", kind: "public", fee: "free", walk_min: 3 }, quote: "공영주차장(무료) 이용, 정문까지 도보 3분" },
    price: { value: { free: true }, quote: "입장료 무료" }, // 원문에 없음 → 버림
    moments: { value: { best: ["night"], light: { on: "sunset", off: "22:00" } } }, // 인용 없음 → 버림
    tags: { value: ["야경", "없는말"], quote: "야간 조명" },
    facilities: { value: ["엘리베이터"], quote: "정문까지 도보 3분" }, // 정해진 말 아님 → 버림
    kid: { value: ["high_chair"], quote: "정문" }, // 묻지 않은 칸
  };
  const fields = ["hours", "closed", "parking", "price", "moments", "tags", "facilities"];
  const { drafts, dropped } = validateAiAnswer("place", answer, { ...CTX, fields });
  assert.deepEqual(Object.keys(drafts).sort(), ["closed", "hours", "parking", "tags"]);
  assert.equal((drafts.hours!.value as { lastEntryMin: number }[])[0].lastEntryMin, 1020);
  assert.deepEqual(drafts.closed!.value, { closedDays: [1], closedRules: ["chuseok", "seollal"] });
  assert.deepEqual(drafts.tags!.value, ["야경"]);
  assert.equal(drafts.parking!.src, "ai");
  assert.equal(drafts.parking!.check, true);
  assert.equal(drafts.parking!.at, TODAY);
  const why = Object.fromEntries(dropped.map((d) => [d.field, d.reason]));
  assert.match(why.price, /원문에 없/);
  assert.match(why.moments, /근거/);
  assert.match(why.facilities, /시설/);
  assert.match(why.kid, /묻지 않은/);
  assert.deepEqual(validateAiAnswer("place", null, { ...CTX, fields }).drafts, {});
});

test("AI 운영 시간: 틀린 줄은 통째로 버림 (마지막 입장이 닫는 뒤 · HH:MM 아님 · 식당 마지막 주문)", () => {
  assert.ok("error" in hoursFromAi([{ days: [1], open: "09:00", close: "18:00", last_entry: "19:00" }], false));
  assert.ok("error" in hoursFromAi([{ days: [1], open: "아침", close: "18:00" }], false));
  assert.ok("error" in hoursFromAi([], false));
  const food = hoursFromAi([{ days: [1, 2], open: "11:00", close: "21:00", last_order: "20:30", breaks: [{ from: "15:00", to: "17:00" }] }], true);
  assert.ok("ok" in food);
  assert.equal(food.ok[0].lastOrderMin, 1230);
  assert.deepEqual(food.ok[0].breaks, [{ fromMin: 900, toMin: 1020 }]);
  // 자정 넘김
  const late = hoursFromAi([{ days: [5, 6], open: "18:00", close: "02:00" }], false);
  assert.ok("ok" in late && late.ok[0].closeMin === 1560);
});

test("물을 칸: 빈 칸·확인 필요만, 관리자가 확인한 칸은 묻지도 않음, 오늘 초안이 있으면 건너뜀", () => {
  const p = place({
    parking: { has: "yes" }, meta: { parking: { src: "admin", conf: 1, at: TODAY }, hours: { src: "tourapi", conf: 0.7, at: TODAY, check: true } },
    openHours: [{ days: [1], holiday: false, openMin: 540, closeMin: 1080, lastEntryMin: null, breaks: [], validFrom: null, validTo: null, note: null }],
  });
  const t = fillTargets("place", p, { vocab: DEFAULT_TAG_VOCAB, today: TODAY });
  assert.ok(t.includes("hours"), "확인 필요 → 물음");
  assert.ok(!t.includes("parking"), "관리자 확인 → 안 물음");
  assert.ok(t.includes("price") && t.includes("tags") && t.includes("fit"));
  // 콕 집어 물어도 확인한 칸은 빼고
  assert.deepEqual(fillTargets("place", p, { requested: ["parking", "price"] }), ["price"]);
  // 오늘 이미 초안이 있으면 건너뜀 (force면 다시)
  const d: AiDraft = { src: "ai", conf: 0.6, at: TODAY, check: true, quote: "x", value: {} };
  const p2 = { ...p, aiDrafts: { price: d } };
  assert.ok(!fillTargets("place", p2, { vocab: DEFAULT_TAG_VOCAB, today: TODAY }).includes("price"));
  assert.ok(fillTargets("place", p2, { vocab: DEFAULT_TAG_VOCAB, today: TODAY, force: true }).includes("price"));
  // 조사 씨앗(확인 표시 없음)은 사람이 본 적 없음 → 콕 집으면 물음
  const seed = place({ parking: { has: "yes" }, meta: { parking: { src: "seed", conf: 0.5, at: TODAY } } });
  assert.deepEqual(fillTargets("place", seed, { requested: ["parking"] }), ["parking"]);
});

test("초안 합치기: 같은 칸은 새것, 그사이 확인한 칸의 초안은 버림", () => {
  const d = (q: string): AiDraft => ({ src: "ai", conf: 0.6, at: TODAY, check: true, quote: q, value: { has: "yes" } });
  const m = mergeDrafts({ parking: d("옛"), price: d("가격") }, { parking: d("새") }, { price: { src: "admin", conf: 1, at: TODAY } });
  assert.deepEqual(Object.keys(m), ["parking"]);
  assert.equal(m.parking!.quote, "새");
});

test("받아들이기(명소): 진짜 칸으로 + 출처 AI·확인함·인용 · 초안은 지움 · 저장 검사 통과", () => {
  const { drafts } = validateAiAnswer("place", {
    parking: { value: { has: "yes", kind: "public", fee: "free", walk_min: 3 }, quote: "공영주차장(무료)" },
    hours: { value: [{ days: [0, 1, 2, 3, 4, 5, 6], open: "09:00", close: "18:00" }], quote: "09:00~18:00" },
    tags: { value: ["야경"], quote: "야간 조명" },
  }, { ...CTX, fields: ["parking", "hours", "tags"] });
  let p = place({ tags: ["예전"], aiDrafts: drafts });
  p = acceptPlaceDraft(p, "parking", TODAY);
  p = acceptPlaceDraft(p, "hours", TODAY);
  p = acceptPlaceDraft(p, "tags", TODAY);
  assert.deepEqual(p.parking, { has: "yes", kind: "public", fee: "free", walk_min: 3 });
  assert.equal(p.openHours[0].openMin, 540);
  assert.deepEqual(p.tags, ["예전", "야경"]);
  assert.deepEqual(p.meta.parking, { src: "ai", conf: 0.8, at: TODAY, quote: "공영주차장(무료)" });
  assert.equal(p.meta.parking?.check, undefined);
  assert.deepEqual(p.aiDrafts, {});
  assert.equal(draftText("place", "parking", p.parking), "있음 · 공영 · 무료 · 걷기 3분");
  // 저장 요청 검사도 통과 (meta.quote · 초안 그대로)
  const body = { ...p, open: 540, close: 1080, aiDrafts: { price: { src: "ai", conf: 0.6, at: TODAY, check: true, quote: "무료", value: { free: true } } } };
  const r = parsePlaceInput(body);
  assert.ok("ok" in r, "error" in r ? r.error : "");
  assert.equal(r.ok.meta?.parking?.quote, "공영주차장(무료)");
  assert.equal(r.ok.aiDrafts?.price?.quote, "무료");
  // 버리기
  assert.deepEqual(discardDraft({ aiDrafts: { a: drafts.parking! } }, "a").aiDrafts, {});
});

test("받아들이기(식당): 음식 종류·아이 칸·가격 단계 · 확인 필요가 풀려 엔진 조건으로 씀", () => {
  const src = sourceText([{ label: "카카오", text: "음식점 > 한식 > 국수 · 아기의자 있음 · 점심 영업 11:00~15:00" }]);
  const { drafts, dropped } = validateAiAnswer("restaurant", {
    cuisine: { value: ["면", "한식"], quote: "한식 > 국수" },
    kid: { value: ["high_chair", "magic"], quote: "아기의자 있음" },
    meal: { value: ["lunch"], quote: "점심 영업" },
    hours: { value: [{ days: [1, 2, 3, 4, 5], open: "11:00", close: "15:00" }], quote: "11:00~15:00" },
    price: { value: { level: 5 }, quote: "국수" },
  }, { source: src, today: TODAY, vocab: [], hours: [], open: 0, close: 1440, fields: ["cuisine", "kid", "meal", "hours", "price"] });
  assert.deepEqual(Object.keys(drafts).sort(), ["cuisine", "hours", "kid", "meal"]);
  assert.match(dropped.find((d) => d.field === "price")!.reason, /0~3/);
  const base = parseFoodInput({ name: "할매칼국수", lat: 35.8, lng: 128.6, active: false });
  assert.ok("ok" in base);
  let r: FoodRestaurant = { id: "x", ...base.ok, aiDrafts: drafts, meta: { hours: { src: "kakao", conf: 0.6, at: TODAY, check: true } } };
  for (const f of ["cuisine", "kid", "meal", "hours"]) r = acceptFoodDraft(r, f, TODAY);
  assert.deepEqual(r.cuisine, ["면", "한식"]);
  assert.deepEqual(r.kid, { high_chair: true });
  assert.deepEqual(r.meal, ["lunch"]);
  assert.equal(r.meta.hours?.check, undefined);
  assert.equal(r.openHours[0].closeMin, 900);
});

test("초안 저장 모양: 이상한 초안은 조용히 버림 · meta.drafts에서 읽음 · meta 인용 유지", () => {
  const good = { src: "ai", conf: 0.6, at: TODAY, check: true, quote: "근거", value: { has: "no" } };
  const got = parseAiDrafts({ parking: good, Bad: good, price: { ...good, quote: "" }, hours: { ...good, at: "어제" }, moments: { ...good, value: "x".repeat(7000) } });
  assert.deepEqual(Object.keys(got), ["parking"]);
  assert.deepEqual(draftsOf({ parking: { src: "admin", conf: 1, at: TODAY }, drafts: { parking: good } }), { parking: good });
  assert.deepEqual(draftsOf(null), {});
  const m = parseMeta({ parking: { src: "ai", conf: 0.8, at: TODAY, quote: "공영주차장(무료)" }, drafts: { parking: good } });
  assert.ok("ok" in m);
  assert.deepEqual(m.ok, { parking: { src: "ai", conf: 0.8, at: TODAY, quote: "공영주차장(무료)" } }, "drafts는 출처 칸이 아님");
});

test("AI 사용량: 게이트웨이 usage 읽기 · 단가가 있을 때만 원 어림", () => {
  assert.deepEqual(usageOf({ usage: { prompt_tokens: 812, completion_tokens: 120 } }), { tokensIn: 812, tokensOut: 120 });
  assert.deepEqual(usageOf({ usage: { input_tokens: 5, output_tokens: 7 } }), { tokensIn: 5, tokensOut: 7 });
  assert.deepEqual(usageOf(null), { tokensIn: 0, tokensOut: 0 });
  assert.equal(estimateKrw(10_000, 2, {}), null);
  assert.equal(estimateKrw(10_000, 2, { AI_KRW_PER_1K_TOKENS: "3", AI_KRW_PER_IMAGE: "60" }), 150);
});
