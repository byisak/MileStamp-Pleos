// 오늘 달 모양 — 네트워크 없이 폰에서 계산 (평균 삭망월 방식, 하루 오차 반나절 안팎).
// 기준 삭: 2000-01-06 18:14 UTC, 삭망월 29.530588853일.
// 리액트·RN을 부르지 않는 순수 계산이라 서버 시험(web/src/lib/moon.test.ts)에서 그대로 불러 쓴다.

export const SYNODIC_DAYS = 29.530588853;
const REF_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;

export type MoonPhase = {
  /** 월령(삭 뒤 지난 날, 0 ~ 29.53) */
  age: number;
  /** 0 ~ 1: 0 삭 · 0.25 상현 · 0.5 보름 · 0.75 하현 */
  phase: number;
  /** 밝은 부분 비율 0 ~ 1 */
  lit: number;
  /** 차는 달(삭 → 보름) — 한국(북반구)에서 오른쪽이 밝다 */
  waxing: boolean;
  /** 이름 ('초승달' · '상현달' · '차오르는 달' · '보름달' · '기우는 달' · '하현달' · '그믐달' · '삭') */
  name: string;
};

export function moonPhase(at: Date): MoonPhase {
  const days = (at.getTime() - REF_NEW_MOON_MS) / DAY_MS;
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
  const phase = age / SYNODIC_DAYS;
  const lit = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return { age, phase, lit, waxing: phase < 0.5, name: moonName(age) };
}

/** 월령 → 우리말 이름 */
export function moonName(age: number): string {
  if (age < 1.5 || age >= 28) return '삭';
  if (age < 6) return '초승달';
  if (age < 9) return '상현달';
  if (age < 13.8) return '차오르는 달';
  if (age < 15.8) return '보름달';
  if (age < 20.5) return '기우는 달';
  if (age < 23.5) return '하현달';
  return '그믐달';
}

/**
 * 밝은 부분 SVG 경로 (중심 cx·cy, 반지름 r). 거의 안 보이면 null.
 * 밝은 쪽 반원 + 명암 경계(반지름 r·|cos|인 반타원)로 닫는다.
 * 차는 달은 오른쪽 반원, 기우는 달은 왼쪽 반원. 반보다 작으면 경계가 밝은 쪽으로, 크면 반대쪽으로 부푼다.
 */
export function moonLitPath(m: Pick<MoonPhase, 'phase' | 'lit' | 'waxing'>, cx: number, cy: number, r: number): string | null {
  if (m.lit < 0.02) return null;
  const top = `${fx(cx)} ${fx(cy - r)}`;
  const bottom = `${fx(cx)} ${fx(cy + r)}`;
  if (m.lit > 0.98) {
    return `M ${top} A ${fx(r)} ${fx(r)} 0 1 1 ${bottom} A ${fx(r)} ${fx(r)} 0 1 1 ${top} Z`;
  }
  const rx = r * Math.abs(Math.cos(2 * Math.PI * m.phase));
  const gibbous = m.lit > 0.5;
  // SVG sweep 1 = 화면에서 시계 방향. 위 → 아래를 시계 방향이면 오른쪽을 지난다
  const outer = m.waxing ? 1 : 0;
  const term = m.waxing ? (gibbous ? 1 : 0) : (gibbous ? 0 : 1);
  return `M ${top} A ${fx(r)} ${fx(r)} 0 0 ${outer} ${bottom} A ${fx(rx)} ${fx(r)} 0 0 ${term} ${top} Z`;
}

const fx = (n: number) => String(Math.round(n * 100) / 100);
