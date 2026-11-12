/* 도장 검증 (엔진 RulesTest와 같은 숫자) · /api/phone/arrive 요청 검사. 실행: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArrive, verifyStamp } from "./stamp-verify";

test("도장 검증: 하한·상한·GPS 궤적으로 넓힌 상한 (엔진 StampVerifier와 같은 식)", () => {
  // 직선 30km: 하한 26km, 경로 어림 39km → 상한 78.5km
  assert.equal(verifyStamp({ straightKm: 30, deltaKm: 35 }).kind, "granted");
  const short = verifyStamp({ straightKm: 30, deltaKm: 2 });
  assert.equal(short.kind === "held" && short.reason, "ODO_TOO_SHORT");
  const long = verifyStamp({ straightKm: 30, deltaKm: 90 });
  assert.equal(long.kind === "held" && long.reason, "ODO_TOO_LONG");
  // 돌아온 길: 궤적 80km(믿을 만함) → 상한 max(78.5, 95) = 95
  assert.equal(verifyStamp({ straightKm: 30, deltaKm: 90, gpsPathKm: 80 }).kind, "granted");
  // 궤적이 직선보다 한참 짧으면(튐) 넓히지 않음
  assert.equal(verifyStamp({ straightKm: 30, deltaKm: 90, gpsPathKm: 10 }).kind, "held");
  assert.equal((verifyStamp({ straightKm: 5, deltaKm: null }) as { reason: string }).reason, "NO_ODOMETER");
  assert.equal((verifyStamp({ straightKm: 5, deltaKm: 6, alreadyToday: true }) as { reason: string }).reason, "ALREADY_TODAY");
});

test("도착 요청 검사: 좌표 없이 숫자·종류만", () => {
  const ok = parseArrive({ placeId: "chimsan", odoKm: null, gpsPathKm: 3.2, straightKm: 2.1, fromPlaceId: null, source: "phone", reason: "STOP_3MIN", verdict: "granted", at: "2026-10-31T10:00:00+09:00" });
  assert.ok("ok" in ok && ok.ok.odoKm === null && ok.ok.source === "phone");
  assert.ok("error" in parseArrive({ placeId: "chimsan", gpsPathKm: -1, straightKm: 1, source: "phone", reason: "STOP_3MIN", verdict: "granted" }));
  assert.ok("error" in parseArrive({ placeId: "chimsan", gpsPathKm: 1, straightKm: 1, source: "gps", reason: "STOP_3MIN", verdict: "granted" }));
  assert.ok("error" in parseArrive({ placeId: "Chim san", gpsPathKm: 1, straightKm: 1, source: "phone", reason: "STOP_3MIN", verdict: "granted" }));
  assert.ok("ok" in parseArrive({ placeId: "fest-palgong-2026", gpsPathKm: 1, straightKm: 1, source: "odometer", odoKm: 1.4, reason: "DISCONNECT", verdict: "held" }));
});
