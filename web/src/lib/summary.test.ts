// 폰 결과 카드 한 문장 (phone/src/summary.ts — 순수 함수라 폰 파일을 그대로 불러 시험)
import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryOf } from "../../../phone/src/summary";

type Tone = string;
type PlanOption = Parameters<typeof summaryOf>[0] & Record<string, unknown>;
const stop = (id: string, indoor = false) => ({ id, name: id, lat: 35.9, lng: 128.6, indoor, stampable: true });
const opt = (o: { stops?: ReturnType<typeof stop>[]; reasons?: [string, Tone][]; why?: string[]; legs?: Parameters<typeof summaryOf>[0]["legs"] }): PlanOption => {
  const stops = o.stops ?? [stop("arboretum")];
  return {
    kind: "COURSE", label: "", stops, firstLegMin: 10, detourMin: null, arriveHomeMin: 900, arriveHome: "15:00",
    legs: o.legs ?? [{ kind: "DRIVE", fromMin: 540, toMin: 550, placeId: stops[0].id }],
    reasons: (o.reasons ?? []).map(([text, tone]) => ({ text, tone })),
    why: o.why ? [{ placeId: stops[0].id, lines: o.why.map((text) => ({ text, tone: "PLAIN" as Tone })) }] : undefined,
  };
};

test("가까움 + 연인 산책 → '집에서 10분, 둘이 산책하기 좋은 곳이에요'", () => {
  const s = summaryOf(opt({ reasons: [["가까워요 · 첫 이동 10분", "PLAIN"]], why: ["집에서 10분 · 가까워요", "연인과 가기 좋아요 · 산책"] }), "couple")!;
  assert.equal(s.text, "집에서 10분, 둘이 산책하기 좋은 곳이에요");
  assert.deepEqual(s.used, ["가까워요 · 첫 이동 10분", "연인과 가기 좋아요 · 산책"]);
});

test("낮잠 + 해 지기 전 (아이와)", () => {
  const s = summaryOf(opt({
    reasons: [["낮잠 맞춤 · 차에서 63분", "NAP"], ["해 지기 40분 전 귀가", "SUN"]],
    legs: [{ kind: "NAP_DRIVE", fromMin: 780, toMin: 843, placeId: "arboretum" }],
    why: ["낮잠 시간에 차에서 63분 재울 수 있어요", "4살 아이도 즐길 만해요"],
  }), "kids")!;
  assert.equal(s.text, "낮잠 시간에 차에서 63분 재울 수 있고 아이도 즐길 만하고 해 지기 전에 와요");
});

test("비 → 실내 는 앞에, 문장은 두 개까지", () => {
  const s = summaryOf(opt({
    stops: [stop("dgsm", true)],
    reasons: [["오후 비 → 실내", "RAIN"], ["가까워요 · 첫 이동 12분", "PLAIN"], ["1곳 · 도장 1", "STAMP"]],
    why: ["집에서 12분 · 가까워요", "4살 아이가 놀기 좋아요"],
  }), "kids")!;
  assert.equal(s.text, "비 소식이 있어 실내로 골랐고 집에서 12분이면 가요");
});

test("비만 있으면 '비 소식이 있어 실내로 골랐어요'", () => {
  assert.equal(summaryOf(opt({ stops: [stop("x", true)], reasons: [["비 와도 실내", "RAIN"]] }), "solo")!.text, "비 소식이 있어 실내로 골랐어요");
});

test("어른끼리는 아이·낮잠·나이 말이 안 나온다", () => {
  const s = summaryOf(opt({
    reasons: [["낮잠 맞춤 · 차에서 63분", "NAP"], ["해 지기 40분 전 귀가", "SUN"], ["야경 · 해 진 뒤", "SUN"]],
    legs: [{ kind: "NAP_DRIVE", fromMin: 780, toMin: 843, placeId: "arboretum" }],
    why: ["4살 아이가 놀기 좋아요", "친구들과 놀기 좋아요 · 액티비티"],
  }), "friends")!;
  assert.doesNotMatch(s.text, /살|아이|낮잠|재울/);
  assert.equal(s.text, "해 진 뒤 야경까지 보고 친구들과 같이 놀기 좋은 곳이에요");
});

test("축제 · 여러 곳 코스", () => {
  const s = summaryOf(opt({
    stops: [stop("fest-a"), stop("b")],
    reasons: [["이번 주말만 · 11/9까지", "FESTIVAL"], ["2곳 · 도장 2", "STAMP"]],
    why: ["축제 기간이에요 · 11/9까지", "지금 있는 곳에서 15분 · 가까워요", "혼자 조용히 둘러보기 좋아요"],
  }), "solo")!;
  assert.equal(s.text, "11/9까지만 하는 축제이고 여기서 15분, 혼자 둘러보기 좋은 코스예요");
});

test("읽을 이유가 없으면 null (화면은 예전 첫 줄)", () => {
  assert.equal(summaryOf(opt({ reasons: [["우회 +5분", "PLAIN"]] }), "kids"), null);
  assert.equal(summaryOf({ ...opt({}), stops: [] }, "kids"), null);
});

test("3분 안쪽은 '집 바로 근처', 어른 맑음은 '걷기'", () => {
  const s = summaryOf(opt({ reasons: [["가까워요 · 첫 이동 1분", "PLAIN"], ["맑음 → 야외", "SUN"]], why: ["집에서 1분 · 가까워요", "둘이 가 볼 만해요"] }), "couple")!;
  assert.equal(s.text, "집 바로 근처이고 날이 맑아 걷기 좋고 둘이 가 볼 만한 곳이에요");
});

test("아침 코스에는 '야경 보기'를 쓰지 않는다", () => {
  const s = summaryOf(opt({ reasons: [["가까워요 · 첫 이동 8분", "PLAIN"]], why: ["집에서 8분 · 가까워요", "연인과 가기 좋아요 · 야경"] }), "couple")!;
  assert.equal(s.text, "집에서 8분, 둘이 가기 좋은 곳이에요");
});
