/*
 * 폰 머리의 달 모양 계산(phone/src/moon.ts) 시험. 기준은 2026년 실제 삭·보름(일식·월식 날 포함, UTC).
 * 평균 삭망월 방식이라 실제와 반나절~하루 어긋날 수 있어 월령은 ±1일로 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { moonLitPath, moonName, moonPhase, SYNODIC_DAYS } from "../../../phone/src/moon";

/** 삭에서 떨어진 날 (0에 가까울수록 삭) */
const fromNew = (age: number) => Math.min(age, SYNODIC_DAYS - age);

test("2026 삭: 2/17 금환일식 · 8/12 개기일식 · 10/10 · 11/9 → 월령 0 ±1일, 거의 안 보임", () => {
  for (const at of ["2026-02-17T12:01Z", "2026-08-12T17:37Z", "2026-10-10T15:50Z", "2026-11-09T07:02Z"]) {
    const m = moonPhase(new Date(at));
    assert.ok(fromNew(m.age) <= 1, `${at} 월령 ${m.age.toFixed(2)}`);
    assert.ok(m.lit < 0.05, `${at} 밝기 ${m.lit.toFixed(3)}`);
  }
});

test("2026 보름: 3/3 개기월식 · 8/28 부분월식 · 10/26 → 월령 14.77 ±1일, 거의 다 밝음", () => {
  for (const at of ["2026-03-03T11:38Z", "2026-08-28T04:18Z", "2026-10-26T04:12Z"]) {
    const m = moonPhase(new Date(at));
    assert.ok(Math.abs(m.age - SYNODIC_DAYS / 2) <= 1, `${at} 월령 ${m.age.toFixed(2)}`);
    assert.ok(m.lit > 0.95, `${at} 밝기 ${m.lit.toFixed(3)}`);
    assert.equal(m.name, "보름달");
  }
});

test("2026-10-28 저녁(한국) = 보름 이틀 뒤 → 기우는 달, 왼쪽이 밝음", () => {
  const m = moonPhase(new Date("2026-10-28T21:00+09:00"));
  assert.equal(m.name, "기우는 달");
  assert.equal(m.waxing, false);
  assert.ok(m.lit > 0.85 && m.lit < 0.99, `밝기 ${m.lit}`);
});

test("상현(2026-10-18 경) = 차는 달 반쪽, 하현(2026-11-01 경) = 기우는 반쪽", () => {
  const first = moonPhase(new Date("2026-10-18T16:13Z"));
  assert.equal(first.waxing, true);
  assert.ok(Math.abs(first.lit - 0.5) < 0.15, `상현 밝기 ${first.lit}`);
  assert.equal(first.name, "상현달");
  const last = moonPhase(new Date("2026-11-01T20:28Z"));
  assert.equal(last.waxing, false);
  assert.ok(Math.abs(last.lit - 0.5) < 0.15, `하현 밝기 ${last.lit}`);
  assert.equal(last.name, "하현달");
});

test("이름 구간", () => {
  assert.equal(moonName(0.5), "삭");
  assert.equal(moonName(3), "초승달");
  assert.equal(moonName(11), "차오르는 달");
  assert.equal(moonName(18), "기우는 달");
  assert.equal(moonName(25), "그믐달");
  assert.equal(moonName(29), "삭");
});

test("그림 경로: 차는 초승달은 오른쪽 반원, 기우는 달은 왼쪽 반원 · 삭은 없음 · 보름은 원", () => {
  // 위(50,35) → 아래(50,65), 바깥 반원 sweep 1 = 오른쪽
  const waxCres = moonLitPath({ phase: 0.1, lit: 0.1, waxing: true }, 50, 50, 15)!;
  assert.match(waxCres, /^M 50 35 A 15 15 0 0 1 50 65 A [\d.]+ 15 0 0 0 50 35 Z$/);
  const wanGib = moonLitPath({ phase: 0.6, lit: 0.9, waxing: false }, 50, 50, 15)!;
  assert.match(wanGib, /^M 50 35 A 15 15 0 0 0 50 65 A [\d.]+ 15 0 0 0 50 35 Z$/);
  const waxGib = moonLitPath({ phase: 0.4, lit: 0.9, waxing: true }, 50, 50, 15)!;
  assert.match(waxGib, / 0 0 1 50 35 Z$/);
  assert.equal(moonLitPath({ phase: 0, lit: 0, waxing: true }, 50, 50, 15), null);
  assert.match(moonLitPath({ phase: 0.5, lit: 1, waxing: false }, 50, 50, 15)!, /0 1 1 50 65 A 15 15 0 1 1 50 35 Z$/);
});
