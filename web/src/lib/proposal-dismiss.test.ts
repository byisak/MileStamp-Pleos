/*
 * 제안 카드 거절('그대로 갈게요', POST /api/plan/course/dismiss) 판정 — lib/course.ts dismissDecision.
 * 엔진 사건이 아니라 plans.course_proposal 칸만 비우므로 코스 버전은 그대로. 폰이 본 버전·제안 시각이 다르면 지우지 않고 409.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dismissDecision, type ProposalJson } from "./course";

const proposal = (atMin: number, version?: number): ProposalJson => ({ options: [], change: null, voice: null, atMin, ...(version != null ? { version } : {}) });

test("같은 버전·같은 제안이면 지운다", () => {
  assert.equal(dismissDecision({ course_version: 7, course_proposal: proposal(730, 7) }, 7), "clear");
  assert.equal(dismissDecision({ course_version: 7, course_proposal: proposal(730, 7) }, 7, 730), "clear");
  // 예전 행(제안에 version 칸 없음)은 저장된 버전으로 본다
  assert.equal(dismissDecision({ course_version: 3, course_proposal: proposal(600) }, 3), "clear");
});

test("폰이 본 버전이 다르면 409 (그새 차·다른 폰이 바꿈)", () => {
  assert.equal(dismissDecision({ course_version: 8, course_proposal: proposal(745, 8) }, 7), "conflict");
  assert.equal(dismissDecision({ course_version: 7, course_proposal: proposal(730, 7) }, 9), "conflict");
});

test("같은 버전이라도 제안 시각이 다르면 다른 제안 → 409", () => {
  assert.equal(dismissDecision({ course_version: 7, course_proposal: proposal(745, 7) }, 7, 730), "conflict");
});

test("지울 제안이 없으면 none (이미 거절·채택됨, 또는 지난 버전의 제안)", () => {
  assert.equal(dismissDecision({ course_version: 7, course_proposal: null }, 7), "none");
  assert.equal(dismissDecision({ course_version: 7, course_proposal: proposal(700, 6) }, 7), "none");
});
