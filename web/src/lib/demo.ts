import { randomBytes } from "node:crypto";
import { sql } from "./db";
import { hashToken } from "./auth";

/**
 * 개발자 시험용 '데모 차'. 차 에뮬레이터 없이 폰 앱만으로 연결·알림을 시험한다.
 * 통과 코드는 환경 변수 DEV_PASS_CODE(6자리)에만 둔다 — 저장소에 적지 않는다.
 */
export function isPassCode(code: string) {
  const pass = (process.env.DEV_PASS_CODE ?? "").trim().toUpperCase();
  return pass.length >= 6 && code.trim().toUpperCase() === pass;
}

export async function demoCarId(): Promise<string> {
  const [found] = await sql<{ id: string }[]>`select id from cars where demo order by created_at limit 1`;
  if (found) return found.id;
  // 데모 차는 차 토큰이 쓰이지 않으므로 아무도 모르는 무작위 값의 해시
  const [car] = await sql<{ id: string }[]>`
    insert into cars (token_hash, demo) values (${hashToken(randomBytes(32).toString("hex"))}, true) returning id`;
  return car.id;
}
