import { test } from "node:test";
import assert from "node:assert/strict";
import { assignStampNumber } from "./stamp-number";

test("도장 No.: 서버가 앞선 도장 수 + 1로 정한다", () => {
  // 차 번호가 맞으면 그대로
  assert.deepEqual(assignStampNumber({ number: 6, rare: null, silent: false }, 5), { number: 6, rare: null, silent: false });
  // 차가 번호를 안 보냄 (데모) → 서버 번호만
  assert.deepEqual(assignStampNumber({ rare: "비 오는 날" }, 0), { rare: "비 오는 날", number: 1 });
  // 날마다 23부터 다시 세던 차 → 서버 번호, 차 번호는 carNumber
  assert.deepEqual(assignStampNumber({ number: 23, silent: true }, 30), { number: 31, silent: true, carNumber: 23 });
  // 숫자가 아닌 값은 없는 것으로
  assert.deepEqual(assignStampNumber({ number: "x" }, 2), { number: 3 });
});
