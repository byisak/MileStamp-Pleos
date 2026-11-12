import { test } from "node:test";
import assert from "node:assert/strict";
import { BANS, buildBackgroundPrompt, buildStampPrompt, cleanScene, defaultScene, seasonEn, VISUALS } from "./stamp-prompt";

test("AI 도장 프롬프트: 조사 묘사(visualEn)가 있으면 그대로 장면", () => {
  const s = defaultScene({ kind: "place", place: { id: "chimsan", name: "침산공원", region: "대구 북구", tags: ["정자"], indoor: false } });
  assert.equal(s.sceneEn, VISUALS.chimsan.en);
  assert.equal(s.sceneKo, VISUALS.chimsan.ko);
  assert.equal(s.fromResearch, true);
  assert.equal(Object.keys(VISUALS).length >= 34, true);
});

test("AI 도장 프롬프트: 묘사 없는 명소는 태그·실내/야외로", () => {
  const out = defaultScene({ kind: "place", place: { id: "newplace", name: "새 명소", tags: ["호수", "분수", "없는태그"], indoor: false } });
  assert.equal(out.fromResearch, false);
  assert.match(out.sceneEn, /outdoor/);
  assert.match(out.sceneEn, /a lake, a fountain/);
  assert.doesNotMatch(out.sceneEn, /없는태그/);
  const inside = defaultScene({ kind: "place", place: { id: "x", name: "실내", tags: [], indoor: true } });
  assert.match(inside.sceneEn, /indoor/);
});

test("AI 도장 프롬프트: 축제는 계절 + 붙은 명소 묘사", () => {
  assert.equal(seasonEn("2026 가을"), "autumn");
  assert.equal(seasonEn("", "2026-04-10"), "spring");
  assert.equal(seasonEn(null, "2026-12-24"), "winter");
  const f = defaultScene({ kind: "festival", festival: { id: "fest-a", name: "가을 축제", season: "2026 가을", place: { id: "suseongmot", name: "수성못" } } });
  assert.ok(f.sceneEn.startsWith(VISUALS.suseongmot.en.replace(/\.\s*$/, "")));
  assert.match(f.sceneEn, /autumn festival/);
  assert.match(f.sceneEn, /no writing/);
  const g = defaultScene({ kind: "festival", festival: { id: "fest-b", name: "여름 물놀이", starts: "2026-07-20" } });
  assert.match(g.sceneEn, /summer festival/);
});

test("AI 도장 프롬프트: 원 하나 · 초록 테 · 흰 바탕 · 금지 목록", () => {
  const p = buildStampPrompt("  A pavilion   on a hill. ", { withRefs: true });
  assert.match(p, /single round stamp illustration, centered, filling a square canvas/);
  assert.match(p, /#2C4A3E/);
  assert.match(p, /plain pure-white background outside the circle/);
  assert.match(p, /Scene inside the circle: A pavilion on a hill\./);
  assert.match(p, /attached reference/);
  for (const b of BANS) assert.ok(p.includes(b), b);
  assert.match(p, /No people/);
  assert.match(p, /Namsan Tower/);
  assert.match(p, /red-and-white striped/);
  assert.match(p, /look like writing/);
  assert.match(p, /away from its edge/);
  // 참고 그림 없이: 그림체를 글로 더
  const t = buildStampPrompt("x", { withRefs: false });
  assert.doesNotMatch(t, /attached/);
  assert.match(t, /paper grain/);
  assert.ok(t.length > p.length);
  const bg = buildBackgroundPrompt("x", { withRefs: false });
  assert.match(bg, /vertical/);
  assert.match(bg, /no circle frame/);
});

test("AI 도장 프롬프트: 장면 문장 다듬기", () => {
  assert.equal(cleanScene("a\n\n b  c "), "a b c");
  assert.equal(cleanScene("x".repeat(900)).length, 600);
});
