// 말 맞추기 — 폰·차·안드로이드 오토·엔진 설명 글이 같은 뜻을 같은 말로 (docs/디자인-개편-계획.md 3절 표).
// 화면 글을 새로 쓸 때는 여기 말을 쓴다. 엔진(Kotlin)·서버(TS) 글도 같은 표를 따른다.
export const W = {
  /** 들렀다 나옴 (상태 DONE) — '끝' 아님 */
  done: '다녀옴',
  here: '머무는 중',
  next: '다음',
  todo: '예정',
  /** 일정에서 빠짐 — 문 닫을 시간 등으로 저절로 */
  skipped: '건너뜀',
  /** 내가 뺌 */
  removed: '뺌',
  /** 소개·설명을 소리로 (폰 기기 음성) */
  listen: '말로 듣기',
  /** 차에서 듣던 것을 폰에서 계속 */
  resume: '이어 듣기',
  /** 집에 와야 하는 시각 — '목표'·'기준' 아님 */
  limit: '귀가 한계',
  /** 코스 고르기 */
  send: '차로 보내기',
  /** 제안 받아들이기 / 거절 */
  adopt: '이걸로 바꾸기',
  keep: '그대로 갈게요',
  /** 미션 끝냄 */
  missionsDone: '완료 미션',
  /** 오늘 탭 숫자 카드 · 기록 */
  stampsToday: '오늘 도장',
  visited: '다녀온 곳',
  record: '오늘의 기록',
  /** 코스 진행 화면 (하루 막대·곳마다 시각·제안 비교) 열기 — 연한 버튼 */
  courseView: '코스 진행 보기',
  courseScreen: '코스 진행',
  /** 머무는 중 큰 버튼 */
  stayMore: '30분 더',
  leaveNow: '지금 나갈게요',
} as const;

/** 예상 도착: 도착지 이름 그대로 — '집 오후 4:17 도착 예정' / '할머니 집 오후 4:17 도착 예정' */
export const arriveText = (dest: string, time: string) => `${dest} ${time} 도착 예정`;
/** 도장 번호: 이 차가 찍은 몇 번째 도장 ('No.29' 대신) */
export const stampNo = (n: number) => `${n}번째 도장`;
/** 모은 칸: '도장북 5/34칸' ('모은 도장 5 / 34' 대신) */
export const albumCount = (got: number, total: number) => `도장북 ${got}/${total}칸`;
