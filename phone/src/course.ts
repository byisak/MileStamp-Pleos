// 살아 있는 코스(LiveCourse) — 고른 코스를 하루 동안 들고 다니는 '버전이 있는 시간표'.
// 모양은 엔진(engine/.../LiveCourse.kt)·계획 docs/코스-고도화-계획.md 10절의 JSON과 같다. 계산은 전부 서버(차도 같은 엔진).
// 폰은 보여 주고, 사건(다음 바꾸기·빼기·들르기·집으로)을 보내고, 제안 카드를 고를(채택) 뿐이다.
//   GET   /api/plan/course                 → { course, version } (고른 코스가 없으면 course null)
//   PATCH /api/plan/course {version, event} → Outcome · 버전이 낮으면 409 { course, version }
//   POST  /api/plan/course/adopt {version, optionIdx} → Outcome (고른 카드대로 코스를 바꿈)
//   POST  /api/plan/course/dismiss {version, atMin} → { course, version, proposal: null, dismissed } ('그대로 갈게요' — 차·다른 폰에서도 치움)
// GET 답·/api/plan 답의 proposal(courseProposal)은 떠 있는 제안 카드 — 앱을 다시 켜거나 알림을 놓쳐도 제안이 보이게 읽는다.
import { ApiError, call } from './api';
import { Leg, PlanOption, hhmm } from './plan';
import { clock } from './timefmt';
import { arriveText, W } from './words';

// ---------- 모양 ----------
export type StopStatus = 'PLANNED' | 'NEXT' | 'ARRIVED' | 'DONE' | 'SKIPPED';
export type ChangeSize = 'QUIET' | 'SOFT' | 'LOUD';

export type LiveStop = {
  placeId: string;
  status: StopStatus;
  plannedArriveMin: number;
  plannedDepartMin: number;
  actualArriveMin?: number | null;
  actualDepartMin?: number | null;
  dwellGuessMin: number;
  /** 건너뛴 까닭: "문 닫음" = 문 닫을 시간이라 못 감 (사람이 뺀 곳은 없음) */
  skipReason?: string | null;
  /** 오늘만 사람이 직접 정한 머무름 (SetDwell·ExtendStay) */
  dwellSet?: boolean;
  /** 머무름 예상의 출처 (서버가 붙임): family = 우리 가족 기록 n번 · crowd = 같은 또래 n가족 · base = 조사값 */
  dwellSource?: DwellSource | null;
  /** 서버가 곳마다 실어 주는 이름·좌표 — 장소 목록 밖의 바깥 장소('ext:…')도 이 이름으로 보인다 */
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
};

/** 이름을 모르는 바깥 장소('ext:…')를 보일 때 쓰는 말 — 날 id를 사람에게 보이지 않는다 (엔진·서버와 같음) */
export const UNNAMED_EXT = '고른 곳';
/**
 * 곳 이름 하나로 정하기 (엔진·서버 stopName과 같음): 코스·계획에 실려 온 이름 → 없으면 바깥 장소는 '고른 곳', 그 밖은 id.
 * 명소 목록에서 먼저 찾는 것은 부르는 쪽(planStore.placeName)이 한다.
 */
export function stopName(id: string, payloadName?: string | null): string {
  const n = typeof payloadName === 'string' ? payloadName.trim() : '';
  return n || (id.startsWith('ext:') ? UNNAMED_EXT : id);
}
/** 머무름 예상과 출처 (서버 dwellView) */
export type DwellSource = { minutes?: number; source: 'family' | 'crowd' | 'base'; n: number; text: string };
/** 오늘 코스의 끝(도착지) — 없으면 집. at = [위도, 경도] (서버가 소수 셋째 자리로 깎아 저장) */
export type CourseEnd = { name: string; at: [number, number] };

/** 마지막 변경: 칩 글(≤40자)·원인·귀가 변화(+ 늦어짐)·크기 */
export type Change = { text: string; cause: string; deltaHomeMin: number; size: ChangeSize; atMin: number };

/**
 * 코스 화면 맨 위 쉬운 설명 (엔진 LiveCourseEngine.explain — 서버가 응답·푸시에 실어 줌).
 * action: GO_HOME = '지금 집으로' 큰 버튼 · END = 아직 집이라 '오늘 코스 마치기'. homeMin = 지금 집으로 가면 도착. warn = 제목 빨강.
 */
export type Explanation = {
  headline: string;
  body: string;
  action?: 'GO_HOME' | 'END' | null;
  homeMin?: number | null;
  warn?: boolean;
  /** 읽어 줄 글 (없으면 제목. 본문) */
  speech?: string;
};

export type LiveCourse = {
  id: string;
  version: number;
  chosenBy: string;
  chosenAtMin: number;
  /** 시간표를 마지막으로 짠 시각·위치 */
  nowMin: number;
  here?: [number, number] | null;
  arriveHomeMin: number;
  limitMin: number;
  slackMin: number;
  rainFromMin?: number | null;
  roadFactor?: number;
  dwellScale?: number;
  napTaken?: boolean;
  stops: LiveStop[];
  legs: Leg[];
  napLeg?: Leg | null;
  warnings?: string[];
  lastChange?: Change | null;
  /** 한 번만 온 내비 ETA (두 번 연속이어야 반영) */
  etaPending?: number | null;
  /** 오늘만 바꾼 도착지 (없으면 집) · 오늘 낮잠 끔 · 오늘 도착 목표를 사용자가 정함 (엔진 SetEnd) */
  end?: CourseEnd | null;
  napOff?: boolean;
  userLimit?: boolean;
  /** 폰만: 서버가 같이 보낸 쉬운 설명 (응답의 explain·courseExplain을 코스에 붙여 둔다) */
  explain?: Explanation | null;
};

export type OutcomeKind = 'NoChange' | 'Retimed' | 'Proposal' | 'HomeNow';
export type Outcome = {
  kind: OutcomeKind;
  course: LiveCourse;
  change?: Change | null;
  voice?: string | null;
  /** Proposal만: 카드 1~3장 (stops = 남은 장소 전체 순서, label = 카드 제목) */
  options?: PlanOption[];
  /** Proposal만: 제안을 낸 시각(분) — 서버 course_proposal.atMin, '그대로 갈게요'를 보낼 때 같은 제안인지 확인용 */
  atMin?: number;
};

/** 서버에 떠 있는 제안 카드 (plans.course_proposal). version = 그 제안을 낸 코스 버전 */
export type ServerProposal = { options: PlanOption[]; change: Change | null; voice: string | null; atMin: number; version: number };

/** 폰이 보내는 사건. 시각은 "HH:MM". 폰은 주행 여부를 모르니 driving:false, 위치(here)도 안 보낸다 */
export type CourseEvent =
  | { type: 'Departed'; now: string; from: string | null; driving?: boolean }
  | { type: 'Arrived'; now: string; place: string; driving?: boolean }
  | { type: 'StillParked'; now: string; driving?: boolean }
  | { type: 'NaviEta'; now: string; remainMin: number; driving?: boolean }
  | { type: 'ReplaceNext'; now: string; place: string; driving?: boolean }
  | { type: 'Skip'; now: string; place: string; driving?: boolean }
  | { type: 'Insert'; now: string; place: string; driving?: boolean }
  | { type: 'Weather'; now: string; sky: 'CLEAR' | 'RAIN' | 'SNOW' | 'UNKNOWN'; rainFrom: string | null; driving?: boolean }
  | { type: 'PlaceClosed'; now: string; place: string; driving?: boolean }
  | { type: 'GoHome'; now: string; driving?: boolean }
  | { type: 'LimitChanged'; now: string; limit: string; driving?: boolean }
  | { type: 'Remote'; now: string; version: number; stops: string[]; by: string; driving?: boolean }
  /** 오늘만: 도착지(end = {name, at} 또는 'home') · 도착 목표 limit · 낮잠 끔 napOff. 넣은 칸만 바뀐다 */
  | { type: 'SetEnd'; now: string; end?: CourseEnd | 'home'; limit?: string; napOff?: boolean; driving?: boolean }
  /** 오늘만: 이 장소 머무름을 minutes분으로 (15~360분, 5분 단위로 서버가 맞춤) */
  | { type: 'SetDwell'; now: string; place: string; minutes: number; driving?: boolean }
  /** 지금 머무는 곳에서 앞으로 minutes분 더 (0 = 지금 나갈게요) */
  | { type: 'ExtendStay'; now: string; minutes: number; driving?: boolean };

/** 폰 화면에서 만드는 사건: now는 저장소가 채운다 (종류마다 칸이 달라 Omit을 하나씩 적용) */
export type CourseEventIn = CourseEvent extends infer E ? (E extends CourseEvent ? Omit<E, 'now'> & { now?: string } : never) : never;

/** proposal: 서버에 떠 있는 제안(없으면 null). undefined = 서버가 이 칸을 안 줌(예전 서버) → 폰이 가진 제안을 건드리지 않는다 */
export type CourseRes = { course: LiveCourse | null; version: number; proposal?: ServerProposal | null; /** 코스가 든 계획 (GET /api/plan/course) */ planId?: string;
  /** 그 계획의 날 'YYYY-MM-DD' (새 서버만) — 오늘보다 뒤면 미리 정한 코스 */
  day?: string };

/** 사건·채택 결과: 받아들여졌거나(outcome), 차·다른 폰이 먼저 바꿔서 최신 코스만 받았거나(conflict) */
export type CourseResult =
  | { ok: true; outcome: Outcome }
  | { ok: false; conflict: true; course: LiveCourse; version: number };

// ---------- 응답 모양 맞추기 (서버가 동시에 만들어지는 중이라 조금 달라도 받아 준다) ----------
function isCourse(x: any): x is LiveCourse {
  return !!x && typeof x === 'object' && Array.isArray(x.stops) && Array.isArray(x.legs) && typeof x.arriveHomeMin === 'number';
}
function isExplain(x: any): x is Explanation {
  return !!x && typeof x === 'object' && typeof x.headline === 'string' && typeof x.body === 'string';
}
/** 응답 몸체의 설명(explain / courseExplain)을 코스에 붙인다 */
export function withExplain(c: LiveCourse | null, ex: any): LiveCourse | null {
  return c && isExplain(ex) ? { ...c, explain: ex } : c;
}
export function normCourse(x: any): LiveCourse | null {
  if (!isCourse(x)) return null;
  return {
    ...x,
    version: Number(x.version ?? 0),
    limitMin: Number(x.limitMin ?? x.arriveHomeMin),
    slackMin: typeof x.slackMin === 'number' ? x.slackMin : Number(x.limitMin ?? x.arriveHomeMin) - x.arriveHomeMin,
    warnings: Array.isArray(x.warnings) ? x.warnings : [],
    stops: x.stops.map((s: any) => ({ ...s, placeId: s.placeId ?? s.place?.id ?? s.id ?? '' })),
  };
}
/** 서버 제안 칸 → ServerProposal (카드가 없으면 null). version이 없는 예전 행은 지금 코스 버전 */
export function normProposal(x: any, version: number): ServerProposal | null {
  if (!x || typeof x !== 'object' || !Array.isArray(x.options) || !x.options.length) return null;
  return { options: x.options, change: x.change ?? null, voice: x.voice ?? null, atMin: Number(x.atMin ?? 0), version: Number(x.version ?? version) };
}
/** { course, version, proposal } · 코스 자체 · { course: null } 모두 받아 준다 */
export function normCourseRes(r: any): CourseRes {
  if (isCourse(r)) { const c = normCourse(r)!; return { course: c, version: c.version }; }
  const c = withExplain(normCourse(r?.course), r?.explain ?? r?.courseExplain);
  const version = Number(r?.version ?? r?.courseVersion ?? c?.version ?? 0);
  const raw = r && typeof r === 'object' ? ('proposal' in r ? r.proposal : 'courseProposal' in r ? r.courseProposal : undefined) : undefined;
  return { course: c, version, ...(raw !== undefined ? { proposal: normProposal(raw, version) } : {}), ...(typeof r?.planId === 'string' ? { planId: r.planId } : {}),
    ...(typeof r?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? { day: r.day } : {}) };
}
/** 답 JSON → Outcome. 모양이 아니면 null */
export function normOutcome(r: any): Outcome | null {
  const course = withExplain(normCourse(r?.course), r?.explain);
  if (!course) return null;
  const kind: OutcomeKind = (['NoChange', 'Retimed', 'Proposal', 'HomeNow'] as const).includes(r.kind) ? r.kind : (r.options?.length ? 'Proposal' : 'Retimed');
  return {
    kind, course, change: r.change ?? course.lastChange ?? null, voice: r.voice ?? null, options: Array.isArray(r.options) ? r.options : undefined,
    // 서버는 제안을 낸 시각 = 답 코스의 nowMin으로 저장한다
    ...(kind === 'Proposal' ? { atMin: course.nowMin } : {}),
  };
}

// ---------- API ----------
/** 서버에 코스 기능이 없으면(404) null. 고른 코스가 없으면 { course: null } */
export async function getCourse(token: string): Promise<CourseRes | null> {
  try { return normCourseRes(await call<unknown>(token, 'GET', '/api/plan/course')); }
  catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
}

function conflictOf(e: unknown): CourseResult | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const r = normCourseRes(e.data);
  return r.course ? { ok: false, conflict: true, course: r.course, version: r.version } : null;
}

/** 사건 하나를 보낸다. 409면 최신 코스를 돌려준다(conflict) */
export async function sendCourseEvent(token: string, version: number, event: CourseEvent): Promise<CourseResult> {
  try {
    const r = await call<unknown>(token, 'PATCH', '/api/plan/course', { version, event: { driving: false, ...event } });
    const o = normOutcome(r);
    if (!o) throw new ApiError('서버 답을 알아볼 수 없어요', 0, r);
    return { ok: true, outcome: o };
  } catch (e) {
    const c = conflictOf(e);
    if (c) return c;
    throw e;
  }
}

/** 제안 카드 idx를 채택 → 코스가 그 카드대로 바뀐다 */
export async function adoptOption(token: string, version: number, idx: number): Promise<CourseResult> {
  try {
    const r = await call<unknown>(token, 'POST', '/api/plan/course/adopt', { version, optionIdx: idx });
    const o = normOutcome(r);
    if (!o) throw new ApiError('서버 답을 알아볼 수 없어요', 0, r);
    return { ok: true, outcome: o };
  } catch (e) {
    const c = conflictOf(e);
    if (c) return c;
    throw e;
  }
}

/**
 * 제안 거절('그대로 갈게요')을 서버에 알린다 → 차·다른 가족 폰에서도 카드가 사라진다.
 * 답: 지금 코스(설명은 제안 없이 다시 쓴 것) · 409면 conflict(그새 바뀐 최신 코스·제안) · 서버에 이 기능이 없으면(404) null
 */
export async function dismissProposalApi(token: string, version: number, atMin?: number | null): Promise<
  { ok: true; res: CourseRes } | { ok: false; conflict: true; res: CourseRes } | null
> {
  try {
    return { ok: true, res: normCourseRes(await call<unknown>(token, 'POST', '/api/plan/course/dismiss', { version, ...(atMin != null ? { atMin } : {}) })) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return { ok: false, conflict: true, res: normCourseRes(e.data) };
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** 코스를 못 불러왔을 때 화면 글 (원래 오류 글은 보여 주지 않는다) */
export const courseUnsupportedText = (e: unknown) =>
  e instanceof ApiError && e.status === 404 ? '코스 진행을 아직 불러올 수 없어요'
  : /Network request failed|timeout|응답 없음/i.test(String((e as any)?.message ?? '')) ? '인터넷이 잠깐 끊겼어요' : '코스 진행을 불러오지 못했어요';

// ---------- 글 도우미 ----------
/** 분 → '1시간 30분' / '45분' / '2시간' */
export function durText(min: number): string {
  if (min < 60) return `${min}분`;
  return min % 60 === 0 ? `${min / 60}시간` : `${Math.floor(min / 60)}시간 ${min % 60}분`;
}
/** 머무름 범위·단위 (엔진 DwellLearning: 15~360분, 5분) */
export const DWELL_MIN = 15;
export const DWELL_MAX = 360;
export const clampDwell = (m: number) => Math.min(DWELL_MAX, Math.max(DWELL_MIN, Math.round(m / 5) * 5));

/** '으로/로': 받침 없거나 ㄹ 받침이면 '로' (할머니 집으로 · 학교로 · 서울로) */
export function ro(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  const jong = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
  return word + (jong !== 0 && jong !== 8 ? '으로' : '로');
}

/** 도착지 이름 (집 또는 오늘만 바꾼 곳) */
export const endName = (c: LiveCourse) => c.end?.name ?? '집';

/** 아직 갈 곳 (순서대로) */
export const remaining = (c: LiveCourse) => c.stops.filter((s) => s.status === 'PLANNED' || s.status === 'NEXT');
export const current = (c: LiveCourse) => c.stops.find((s) => s.status === 'ARRIVED') ?? null;

/** "집 16:47 도착 예정 · 여유 15분" (도착지 이름 그대로) / 넘으면 "귀가 한계 7분 넘어요" */
export function homeLine(c: LiveCourse): { text: string; over: boolean } {
  const slack = c.slackMin ?? c.limitMin - c.arriveHomeMin;
  const arrive = arriveText(endName(c), clock(c.arriveHomeMin));
  return slack >= 0
    ? { text: `${arrive} · 여유 ${slack}분`, over: false }
    : { text: `${arrive} · ${W.limit} ${-slack}분 넘어요`, over: true };
}

/**
 * 서버 설명이 없을 때(모의 엔진·옛 서버) 폰이 대충 만드는 설명. 규칙의 원본은 엔진 explain — 여기는 모양만 맞춘다.
 * 서버 글처럼 시각은 'HH:MM'으로 두고, 보일 때 ExplainCard가 clockText·clockSpeech로 바꾼다.
 */
export function localExplain(c: LiveCourse, o?: Outcome | null): Explanation {
  const rem = remaining(c);
  const dest = endName(c);
  const cur = current(c);
  const slack = c.slackMin ?? c.limitMin - c.arriveHomeMin;
  const best = o?.kind === 'Proposal' ? o.options?.[0] : undefined;
  if (best) {
    return best.stops.length
      ? { headline: '이렇게 바꾸면 좋겠어요', body: `${best.label}, ${dest}에는 ${hhmm(best.arriveHomeMin)}쯤 도착해요.` }
      : { headline: '바로 집으로 갈까요', body: `지금 출발하면 ${dest}에 ${hhmm(best.arriveHomeMin)}쯤 도착해요.` };
  }
  if (!rem.length && !cur) return { headline: `${ro(dest)} 가는 길이에요`, body: `${dest}에는 ${hhmm(c.arriveHomeMin)}쯤 도착해요.` };
  if (slack < 0) return { headline: '오늘은 여기까지가 좋겠어요', body: `남은 곳까지 들르면 ${dest}에 ${hhmm(c.arriveHomeMin)}에야 와요. 남은 곳은 다음에 가요.`, action: 'GO_HOME', warn: true };
  if (c.end && c.lastChange?.cause === '도착지') {
    return { headline: `오늘은 ${ro(dest)} 가요`, body: `${rem[0] ? `다음 곳에 ${hhmm(rem[0].plannedArriveMin)}에 도착해요. ` : ''}${dest}에는 ${hhmm(c.arriveHomeMin)}쯤 와요.` };
  }
  const next = rem[0];
  const first = next ? `다음 곳에 ${hhmm(next.plannedArriveMin)}에 도착해요. ` : '';
  return { headline: '계획대로 가고 있어요', body: `${first}${dest}에는 ${hhmm(c.arriveHomeMin)}쯤 와요.` };
}

/** 지금 시각 "HH:MM" (폰 시계) */
export const nowHhmm = () => { const d = new Date(); return hhmm(d.getHours() * 60 + d.getMinutes()); };
