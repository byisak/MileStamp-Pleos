// 오늘 탭 코스 카드의 '지금 어느 때인가' — 폰이 가진 자료(살아 있는 코스의 장소 상태·설명·떠 있는 제안)만으로 정한다.
// 계획: docs/디자인-개편-계획.md 4절 (상태 A~D), 판단 규칙은 같은 문서 '2단계 구현 메모'.
//
// 폰은 차가 달리는지·어디 있는지 모른다. 장소 상태는 차가 서버에 보낸 사건으로만 바뀐다:
//   차가 그곳 300m 안에서 P단 → 사건 Arrived → 그 장소 ARRIVED (= B2 머무는 중)
//   다시 출발 → 사건 Departed → 그 장소 DONE, 다음 곳 NEXT (= B 가는 중, 어림)
// 폰은 이것을 20초마다 받거나(GET /api/plan/course) 푸시 course_update로 받는다 → 실제보다 최대 20초쯤 늦을 수 있다.
// 'N분 남음'은 엔진이 짠 시각(도착 예정·나설 시각)과 폰 시계의 차이일 뿐이라 늘 '약'을 붙인다.
import { current, Explanation, LiveCourse, LiveStop, Outcome, remaining } from '../course';

/** 주인공(다음 목적지 칸)이 무엇을 보여 줄지 */
export type Stage =
  /** A' 보냈고 아직 다녀온 곳·머무는 곳이 없음 → '첫 목적지' */
  | { kind: 'first'; stop: LiveStop }
  /** B 다녀온 곳이 있고 다음 곳이 있음 → '다음 목적지' (가는 중인지는 어림) */
  | { kind: 'going'; stop: LiveStop }
  /** B2 머무는 중: 장소 상태 ARRIVED (차가 그곳에 P단으로 섰다) */
  | { kind: 'stay'; stop: LiveStop }
  /** C 남은 곳 0곳 · 머무는 곳 없음 → 도착지(집)로 가는 길 */
  | { kind: 'homeward' };

/** 큰 버튼 하나 (화면에 하나만). 우선순위: 제안 > 늦어짐·마치기 > 머무는 중 > 없음 */
export type BigAction = 'adopt' | 'goHome' | 'end' | 'stay' | null;

export function stageOf(c: LiveCourse): Stage {
  const cur = current(c);
  if (cur) return { kind: 'stay', stop: cur };
  const rem = remaining(c);
  if (!rem.length) return { kind: 'homeward' };
  const visited = c.stops.some((s) => s.status === 'DONE');
  return { kind: visited ? 'going' : 'first', stop: rem[0] };
}

export function bigActionOf(stage: Stage, ex: Explanation, o: Outcome | null): BigAction {
  if (o?.kind === 'Proposal' && o.options?.length) return 'adopt';
  if (ex.action === 'GO_HOME') return 'goHome';
  if (ex.action === 'END') return 'end';
  if (stage.kind === 'stay') return 'stay';
  return null;
}

/** '약 14분' — 엔진 시각과 지금의 차이 (지났거나 4시간 넘으면 없음) */
export function aboutMin(targetMin: number, nowMin: number): string | null {
  const d = Math.round(targetMin - nowMin);
  if (d <= 0 || d > 240) return null;
  return d < 60 ? `약 ${d}분` : `약 ${Math.floor(d / 60)}시간${d % 60 ? ` ${d % 60}분` : ''}`;
}
