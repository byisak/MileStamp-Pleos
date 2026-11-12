/**
 * 도장 No. 정하기 (계산만 — DB는 events.ts의 stampNumber).
 * 앞선 도장 [prev]개 → No.prev+1. 차가 보낸 number가 없거나 다르면 서버 번호로 바꾸고 차 번호는 carNumber에 남긴다.
 */
export function assignStampNumber(payload: Record<string, unknown>, prev: number): Record<string, unknown> {
  const number = prev + 1;
  const rest = { ...payload };
  delete rest.carNumber;
  const sent = typeof payload.number === "number" && Number.isFinite(payload.number) ? payload.number : null;
  return sent === null || sent === number ? { ...rest, number } : { ...rest, number, carNumber: sent };
}
