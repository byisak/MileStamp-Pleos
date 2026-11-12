// 오늘 계획 공유: 서버의 '오늘 계획' 하나를 불러와 오늘 탭·개발 탭이 같이 본다.
// - 위치는 앱을 쓰는 동안만, 처음 불러올 때 한 번 묻는다. 거절·실패면 위치 없이(서버가 마지막 칸·집 칸으로 계산)
// - 다른 가족 폰·차에서 고르면 푸시(종류 plan)가 와서 다시 불러온다 (events.tsx의 planPing)
// - 개발 탭 '추천 시험': 데모 차만 시각·하늘을 지정한 계획을 '실제로 돌아가기' 전까지 보여 준다
// 살아 있는 코스(course.ts): 고른 뒤의 '코스 진행'도 여기서 들고 있다 — /api/plan에 실려 오고, 앱이 앞에 있으면 20초마다 /api/plan/course,
//   푸시 course_update가 오면 그 답을 바로 반영. 사건(다음 바꾸기·빼기·들르기·집으로)은 버전과 함께 보내고 409면 최신 코스로 바꾼다.
//   제안 카드: 서버가 함께 주는 proposal(courseProposal)도 읽어서, 알림을 놓치거나 앱을 다시 켜도 제안이 보인다.
//   '그대로 갈게요'는 서버(/api/plan/course/dismiss)에 알려 차·다른 폰에서도 치운다. 보내지 못해도 이 폰에선 다시 안 띄운다.
//   개발 탭 '모의' 토글이 켜지면 서버 대신 courseMock.ts가 답한다(서버에 코스 기능이 아직 없을 때 화면 확인용).
import * as Location from 'expo-location';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { syncAutoNap } from './auto';
import { ApiError } from './api';
import { adoptOption, CourseEvent, CourseEventIn, CourseRes, CourseResult, courseUnsupportedText, dismissProposalApi, getCourse, LiveCourse, normCourse, normProposal, Outcome, sendCourseEvent, stopName, withExplain } from './course';
import { mockAdopt, mockCourse, mockEvent, MOCK_PLACES, mockReset } from './courseMock';
import { useEvents } from './events';
import { AnchorRes, chooseAnchorCourse, chooseCourse, choosePlan, Companion, FamilyView, getFamily, getPlan, hhmm, isMealStop, PlanExtra, PlanRes, type StopRef } from './plan';
import { PLACES } from './places';
import { today } from './catalog';
import { useSession } from './session';
import { getSchedule, moveSchedule, type MoveResult, type ScheduleRes } from './schedule';

export type PlanTest = { key: string; title: string; loc: { lat: number; lng: number }; extra: PlanExtra };

/** 개발 탭 '추천 시험' 네 장면 (서버 시험 사례 plan-cases.json과 같은 조건) */
export const PLAN_TESTS: PlanTest[] = [
  { key: 'sat', title: '① 토 08:30 집 · 15시부터 비', loc: { lat: 35.8858, lng: 128.5828 },
    extra: { at: '2026-10-31T08:30', sky: 'CLEAR', rainFrom: '15:00', sunset: '17:41' } },
  { key: 'rain', title: '② 토 08:30 집 · 종일 비', loc: { lat: 35.8858, lng: 128.5828 },
    extra: { at: '2026-10-31T08:30', sky: 'RAIN', sunset: '17:41' } },
  { key: 'pickup', title: '③ 수 16:10 어린이집 픽업', loc: { lat: 35.889, lng: 128.59 },
    extra: { at: '2026-11-04T16:10', sky: 'CLEAR', sunset: '17:43' } },
  // 저녁 나들이 (plan-cases '저녁 ·'과 같은 하늘): 해 진 뒤 ~ 잠자는 시간 90분 전 → 오늘 탭 저녁 화면
  { key: 'evening', title: '④ 금 18:10 집 · 해 진 뒤 저녁 나들이', loc: { lat: 35.8858, lng: 128.5828 },
    extra: { at: '2026-11-06T18:10', sky: 'CLEAR', sunset: '17:25' } },
];

type Plan = {
  data: PlanRes | null;
  family: FamilyView | null;
  loading: boolean;
  error: string | null;
  /** 위치 없이 계산했으면 true */
  noLoc: boolean;
  test: PlanTest | null;
  /** full: 시험 장면이면 하늘·시각을 다시 지정해 새로 계산 */
  reload: (opts?: { full?: boolean }) => Promise<void>;
  /** dwell = 오늘만 머무름 {장소 id: 분} — 고른 뒤 코스 사건 SetDwell로 보낸다 */
  choose: (idx: number | null, dwell?: Record<string, number>) => Promise<void>;
  /** 정한 장소 순서로 고르기 (코스 편집 '이대로 정하기' · 개발 탭 '이야기 코스로 고르기'). dwell은 choose와 같음 */
  chooseStops: (stops: string[], dwell?: Record<string, number>) => Promise<void>;
  /**
   * 앵커 코스('○○ 중심으로') 카드 고르기 → 서버가 그 계획에 카드를 붙이고 살아 있는 코스를 만든다.
   * extendLimit = 귀가 한계를 넘는 카드를 고르면서 '오늘만 귀가 한계 늦추기'에 예 → 코스 사건 SetEnd {limit: 집 도착 + 10분}
   */
  chooseAnchor: (res: AnchorRes, idx: number, extendLimit: boolean) => Promise<void>;
  /** 다녀온 곳이 있는 코스 고치기: 남은 곳 순서(Remote) + 오늘만 머무름(SetDwell). 차가 먼저 바꿨으면 Error */
  liveEdit: (stops: string[], dwell: Record<string, number>) => Promise<void>;
  setTest: (t: PlanTest | null) => void;
  setFamily: (f: FamilyView) => void;
  /**
   * 대화형 고르기(Ask): 누구랑·어느 날로 계획을 따로 받는다 (공용 계획 data는 안 바꿈). 시험 장면이면 그 위치·시각으로.
   * 서버가 with·day를 아직 모르면 같은 계획이 온다(그대로 씀).
   */
  fetchPlan: (opts: { with?: Companion; day?: string; maxStops?: number; meal?: boolean }) => Promise<PlanRes>;
  /** 계획을 짤 때 쓴 지금 위치 (시험 장면이면 그 위치, 모르면 null) — 코스 지도의 출발점 */
  hereNow: () => { lat: number; lng: number } | null;
  /** 따로 받은 계획(planId)에서 고르기: 카드 번호 또는 장소 순서(코스 고치기). 고른 뒤 공용 계획·코스를 다시 받는다 */
  choosePlanned: (planId: string, pick: { idx: number } | { stops: StopRef[]; anchor?: string }, dwell?: Record<string, number>) => Promise<void>;
  /**
   * 차에 보낸 코스 취소 (고르기 취소 = POST /api/plan/choose {idx: null}, PlanSection '되돌리기'와 같은 API) — 서버 코스가 없어지고
   * 차는 다음 조회 때 코스를 지운다. planId를 모르면 지금 코스가 든 계획(GET /api/plan/course) → 오늘 계획.
   */
  cancelCourse: (planId?: string) => Promise<void>;

  /** 미리 정한 다른 날 코스 (오늘 코스가 없을 때만 서버가 줌) — 오늘 탭은 '11/7(토) 코스 · 출발 예정' 카드로만, 그날이 되면 course로 */
  scheduled: ScheduledCourse | null;

  // ---- 일정 탭 (GET /api/plan/schedule) ----
  /** 날짜별 나들이. 아직 안 받았으면 null, 옛 서버면 'unsupported' */
  schedule: ScheduleRes | 'unsupported' | null;
  scheduleError: string | null;
  loadSchedule: () => Promise<void>;
  /** 정한 코스를 다른 날로 (replace = 그날 이미 정한 코스를 바꿈). 옮기면 계획·코스·일정을 다시 받는다 */
  moveCourse: (planId: string, toDay: string, replace?: boolean) => Promise<MoveResult>;

  // ---- 살아 있는 코스 ----
  course: LiveCourse | null;
  courseVersion: number;
  /** 마지막 답(제안 카드는 여기 options에). 채택하거나 '그대로 갈게요'면 비운다 */
  lastOutcome: Outcome | null;
  /** 서버에 코스 기능이 없거나(404) 불러오지 못했을 때 */
  courseError: string | null;
  courseBusy: boolean;
  /** 서버 대신 모의 엔진 (개발 탭) */
  courseMock: boolean;
  setCourseMock: (on: boolean) => void;
  /** 장소 id → 이름 (계획 카드·제안 카드·내장 목록에서 모은 것) */
  placeName: (id: string) => string;
  /** 고를 수 있는 장소 목록 (들르기·다음 바꾸기 시트) */
  knownPlaces: { id: string; name: string }[];
  loadCourse: () => Promise<void>;
  /** 사건 보내기. 409면 최신 코스로 바꾸고 conflict를 돌려준다. 코스가 없으면 null */
  courseAct: (e: CourseEventIn) => Promise<CourseResult | null>;
  adopt: (idx: number) => Promise<CourseResult | null>;
  /** '그대로 갈게요': 바로 카드를 치우고 서버에도 알린다. conflict = 그새 코스·제안이 바뀌어 최신으로 바꿈 */
  dismissProposal: () => Promise<'ok' | 'conflict' | 'local'>;
  /** 사건에 넣을 '지금' 시각 — 시험 장면이면 코스가 마지막으로 짠 시각, 아니면 폰 시계 */
  courseNow: () => string;
};
export type ScheduledCourse = { course: LiveCourse; planId: string; day: string };
const Ctx = createContext<Plan | null>(null);

const LOC_KEEP_MS = 10 * 60000;
const COURSE_POLL_MS = 20000;

export function PlanProvider({ children }: { children: ReactNode }) {
  const { token, me } = useSession();
  const { planPing, courseUpdate } = useEvents();
  const [data, setData] = useState<PlanRes | null>(null);
  const [course, setCourse] = useState<LiveCourse | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledCourse | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRes | 'unsupported' | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const schedSeq = useRef(0);
  const courseRef = useRef<LiveCourse | null>(null);
  /** 오늘 코스가 든 계획 id (GET /api/plan/course의 planId) — 일정 탭에서 다른 날 코스를 취소할 때 오늘 코스를 건드리지 않게 */
  const coursePlanId = useRef<string | null>(null);
  const [lastOutcome, setLastOutcomeState] = useState<Outcome | null>(null);
  const outcomeRef = useRef<Outcome | null>(null);
  /** 답을 넣을 때마다 +1 — 그 전에 떠난 조회의 '제안 없음'이 방금 받은 제안을 지우지 않게 */
  const outcomeSeq = useRef(0);
  const setLastOutcome = (o: Outcome | null) => { outcomeRef.current = o; outcomeSeq.current++; setLastOutcomeState(o); };
  /** 이 폰에서 '그대로 갈게요' 한 제안 (코스 id·버전·제안 시각) — 서버에 못 알렸어도 다시 띄우지 않는다 */
  const dismissed = useRef<Set<string>>(new Set());
  const proposalKey = (c: LiveCourse, atMin?: number) => `${c.id}:${c.version}:${atMin ?? ''}`;
  const [courseError, setCourseError] = useState<string | null>(null);
  const [courseBusy, setCourseBusy] = useState(false);
  const [courseMock, setCourseMockState] = useState(false);
  const mockRef = useRef(false);
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(Object.values(PLACES).map((p) => [p.id, p.name])));
  const unsupported = useRef(false); // 서버가 404 → 조회를 멈춘다 (계획을 다시 받을 때 다시 시도)
  const [family, setFamily] = useState<FamilyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noLoc, setNoLoc] = useState(false);
  const [test, setTestState] = useState<PlanTest | null>(null);
  const testRef = useRef<PlanTest | null>(null);
  const loc = useRef<{ at: number; v: { lat: number; lng: number } | null } | null>(null);
  const seq = useRef(0);

  /** 지금 위치. 권한은 처음 한 번만 묻고, 10분 동안은 같은 값을 쓴다 */
  const locate = useCallback(async () => {
    if (loc.current && Date.now() - loc.current.at < LOC_KEEP_MS) return loc.current.v;
    let v: { lat: number; lng: number } | null = null;
    try {
      let p = await Location.getForegroundPermissionsAsync();
      if (!p.granted && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
      if (p.granted) {
        const last = await Location.getLastKnownPositionAsync({ maxAge: LOC_KEEP_MS }).catch(() => null);
        const pos = last ?? await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((res) => setTimeout(() => res(null), 6000)),
        ]).catch(() => null);
        if (pos) v = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
    } catch {}
    loc.current = { at: Date.now(), v };
    return v;
  }, []);

  const loadSchedule = useCallback(async () => {
    if (!token) return;
    const my = ++schedSeq.current;
    try {
      const r = await getSchedule(token);
      if (my !== schedSeq.current) return;
      setSchedule(r ?? 'unsupported');
      setScheduleError(null);
    } catch (e: any) {
      if (my !== schedSeq.current) return;
      setScheduleError(/Network request failed|timeout|인터넷|응답/i.test(String(e?.message ?? '')) ? '인터넷이 잠깐 끊겼어요' : '일정을 불러오지 못했어요');
    }
  }, [token]);

  const load = useCallback(async (full = false) => {
    if (!token) return;
    // 일정 탭도 같이 (계획을 다시 받을 때 = 고르기·취소·다른 폰 알림·앱이 앞에 옴)
    loadSchedule();
    const my = ++seq.current;
    setLoading(true);
    try {
      const tst = testRef.current;
      let r: PlanRes;
      if (tst) {
        // 처음(또는 full)엔 하늘·시각을 지정해 새로 계산, 그 뒤엔 같은 시각·칸으로 물어 방금 계획(고른 것 포함)을 다시 받는다
        r = await getPlan(token, tst.loc, full ? { ...tst.extra, fresh: true } : { at: tst.extra.at });
        if (my === seq.current) setNoLoc(false);
      } else {
        const here = await locate();
        r = await getPlan(token, here);
        if (my === seq.current) setNoLoc(!here);
      }
      if (my !== seq.current) return;
      setData(r);
      setError(null);
      learnNames(r.plan.options.flatMap((o) => o.stops));
      // 서버가 계획에 코스를 같이 실어 보내면 그대로, 아니면 따로 받는다
      if (!mockRef.current) {
        if ((r as any).course !== undefined) {
          unsupported.current = false;
          const seqAt = outcomeSeq.current;
          const version = Number((r as any).courseVersion ?? (r as any).course?.version ?? 0);
          const res: CourseRes = { course: withExplain(normCourse((r as any).course), (r as any).courseExplain), version,
            ...('courseProposal' in (r as any) ? { proposal: normProposal((r as any).courseProposal, version) } : {}) };
          if (takeCourse(res.course, res.version)) takeProposal(res, seqAt);
        }
        else loadCourseInner();
      }
    } catch (e: any) {
      if (my !== seq.current) return;
      // 화면엔 쉬운 말만 (원래 오류 글은 보여 주지 않는다)
      const msg = e instanceof ApiError && /위치/.test(e.message)
        ? '위치를 알 수 없어요. 위치 권한을 켜 주세요'
        : /Network request failed|timeout|응답 없음/i.test(String(e?.message ?? '')) ? '인터넷이 잠깐 끊겼어요' : '추천을 불러오지 못했어요';
      setError(msg);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [token, locate, loadSchedule]);

  // ---------- 살아 있는 코스 ----------
  const learnNames = (stops: { id: string; name: string }[]) => {
    if (!stops.length) return;
    setNames((n) => { let changed = false; const next = { ...n }; for (const s of stops) if (s.name && next[s.id] !== s.name) { next[s.id] = s.name; changed = true; } return changed ? next : n; });
  };
  /** 받은 코스를 넣는다. 같은 코스의 낮은 버전은 무시(계획 14번 사건) */
  const takeCourse = (c: LiveCourse | null, version?: number) => {
    const cur = courseRef.current;
    if (c && cur && c.id === cur.id && c.version < cur.version) return false;
    if (c && version != null && version > c.version) c = { ...c, version };
    courseRef.current = c;
    setCourse(c);
    // 코스의 곳마다 서버가 실은 이름 — 계획 카드에 없는 바깥 장소(ext:…)도 이름으로 보이게
    if (c) learnNames(c.stops.map((x) => ({ id: x.placeId, name: x.name ?? '' })));
    if (!c || (cur && c.id !== cur.id)) setLastOutcome(null);
    return true;
  };
  const takeOutcome = (o: Outcome) => {
    if (o.options) learnNames(o.options.flatMap((x) => x.stops));
    if (!takeCourse(o.course)) return;
    // 제안이면 카드가 남고, 아니면 이전 제안은 뜻이 없어진다
    setLastOutcome(o.kind === 'Proposal' || o.kind === 'HomeNow' ? o : (o.change ? o : null));
  };
  /**
   * 서버에 떠 있는 제안(proposal)을 화면 제안 카드로. 같은 코스·같은 버전일 때만:
   * 있으면(이 폰에서 거절한 것이 아니면) 카드를 띄우고, 없으면 떠 있던 제안을 치운다(차·다른 폰이 거절·채택함).
   * seqAt = 요청을 보낼 때의 outcomeSeq — 그새 이 폰이 새 답을 받았으면 이 조회 결과로 제안을 건드리지 않는다.
   */
  const takeProposal = (r: CourseRes, seqAt: number) => {
    if (r.proposal === undefined || seqAt !== outcomeSeq.current) return;
    const c = courseRef.current;
    if (!c || !r.course || r.course.id !== c.id || r.version !== c.version) return;
    const p = r.proposal;
    const cur = outcomeRef.current;
    if (p && p.version === c.version && !dismissed.current.has(proposalKey(c, p.atMin))) {
      if (cur?.kind === 'Proposal' && cur.course.version === c.version && cur.atMin === p.atMin) return; // 이미 보이는 그 제안
      learnNames(p.options.flatMap((x) => x.stops));
      setLastOutcome({ kind: 'Proposal', course: c, change: p.change, voice: p.voice, options: p.options, atMin: p.atMin });
    } else if (cur?.kind === 'Proposal') {
      setLastOutcome(null);
    }
  };
  const loadCourseInner = async () => {
    if (!token || mockRef.current || unsupported.current) return;
    const seqAt = outcomeSeq.current;
    try {
      const r = await getCourse(token);
      if (r === null) { setScheduled(null); unsupported.current = true; setCourseError(courseUnsupportedText(new ApiError('', 404, null))); return; }
      setCourseError(null);
      // 다른 날(미리 정한) 코스: 오늘 코스로 넣지 않는다 (서버는 오늘 코스가 있으면 그것을 먼저 준다)
      if (r.course && r.day && r.day > today() && r.planId) {
        learnNames(r.course.stops.map((x) => ({ id: x.placeId, name: x.name ?? '' })));
        setScheduled({ course: r.course, planId: r.planId, day: r.day });
        if (courseRef.current) takeCourse(null);
        return;
      }
      setScheduled(null);
      coursePlanId.current = r.course ? r.planId ?? null : null;
      if (takeCourse(r.course, r.version)) takeProposal(r, seqAt);
    } catch (e) { setCourseError(courseUnsupportedText(e)); }
  };
  const loadCourse = useCallback(async () => {
    if (mockRef.current) { takeCourse(mockCourse()); return; }
    unsupported.current = false;
    await loadCourseInner();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // 앱이 앞에 있으면 20초마다 (차가 바꾼 것이 보이게). 푸시가 오면 그 답을 바로
  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(loadCourseInner, COURSE_POLL_MS);
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') { if (!timer) timer = setInterval(loadCourseInner, COURSE_POLL_MS); }
      else if (timer) { clearInterval(timer); timer = null; }
    });
    return () => { app.remove(); if (timer) clearInterval(timer); };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!courseUpdate) return;
    if (courseUpdate.outcome) takeOutcome(courseUpdate.outcome);
    else loadCourseInner(); // 알림에 답이 안 실려 왔으면 서버에서
  }, [courseUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  const courseNow = useCallback(() => {
    const c = courseRef.current;
    if ((testRef.current || mockRef.current) && c) return hhmm(c.nowMin);
    const d = new Date();
    return hhmm(d.getHours() * 60 + d.getMinutes());
  }, []);

  const afterResult = (r: CourseResult) => {
    if (r.ok) takeOutcome(r.outcome);
    else { takeCourse(r.course, r.version); setLastOutcome(null); }
    return r;
  };
  const courseAct = useCallback(async (e: CourseEventIn) => {
    const c = courseRef.current;
    if (!c) return null;
    const ev = { ...e, now: e.now ?? courseNow() } as CourseEvent;
    setCourseBusy(true);
    try {
      if (mockRef.current) return afterResult({ ok: true, outcome: mockEvent(ev) });
      if (!token) return null;
      return afterResult(await sendCourseEvent(token, c.version, ev));
    } finally { setCourseBusy(false); }
  }, [token, courseNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const adopt = useCallback(async (idx: number) => {
    const c = courseRef.current;
    if (!c) return null;
    setCourseBusy(true);
    try {
      if (mockRef.current) return afterResult({ ok: true, outcome: mockAdopt(idx) });
      if (!token) return null;
      return afterResult(await adoptOption(token, c.version, idx));
    } finally { setCourseBusy(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismissProposal = useCallback(async (): Promise<'ok' | 'conflict' | 'local'> => {
    const o = outcomeRef.current;
    const c = courseRef.current;
    setLastOutcome(null);
    if (!c || o?.kind !== 'Proposal') return 'local';
    dismissed.current.add(proposalKey(c, o.atMin));
    // 설명 카드가 제안 기준 글이었으면 지운다 (서버 답이 오면 제안 없는 설명으로 바뀜, 그 전엔 폰이 만든 글)
    if (c.explain) { const nc = { ...c, explain: null }; courseRef.current = nc; setCourse(nc); }
    if (mockRef.current || !token) return 'local';
    const seqAt = outcomeSeq.current;
    try {
      const r = await dismissProposalApi(token, c.version, o.atMin);
      if (!r) return 'local'; // 예전 서버: 이 폰에서만 치움
      if (takeCourse(r.res.course, r.res.version)) takeProposal(r.res, seqAt);
      return r.ok ? 'ok' : 'conflict';
    } catch { return 'local'; } // 인터넷이 끊김: 이 폰에선 치운 그대로
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const setCourseMock = useCallback((on: boolean) => {
    mockRef.current = on;
    setCourseMockState(on);
    setLastOutcome(null);
    if (on) { learnNames(MOCK_PLACES); takeCourse(mockReset()); setCourseError(null); }
    else { courseRef.current = null; setCourse(null); unsupported.current = false; loadCourseInner(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 명소 목록·받은 계획·코스의 이름 → 지금 코스에 실린 이름 → (바깥 장소면) '고른 곳'
  // 밥 자리(식당 'ext:food:…')는 이름 앞에 🍽 — 코스 줄·시간표에서 장소와 구별 (도장 없음)
  const placeName = useCallback((id: string) => {
    const n = names[id] ?? stopName(id, courseRef.current?.stops.find((x) => x.placeId === id)?.name);
    return isMealStop(id) ? `🍽 ${n}` : n;
  }, [names, course]); // eslint-disable-line react-hooks/exhaustive-deps
  // 모의 엔진은 자기가 아는 곳만 (시트에 다른 곳이 떠도 계산을 못 한다)
  const knownPlaces = useMemo(() => (courseMock ? MOCK_PLACES.map((x) => ({ id: x.id, name: x.name })) : Object.entries(names).map(([id, name]) => ({ id, name }))), [names, courseMock]);

  const loadFamily = useCallback(async () => {
    if (!token) return;
    try { setFamily(await getFamily(token)); } catch {}
  }, [token]);

  const reload = useCallback(async (opts?: { full?: boolean }) => {
    await Promise.all([load(!!opts?.full), loadFamily()]);
  }, [load, loadFamily]);

  // 처음 · 다른 폰/차에서 골랐다는 알림이 올 때
  const first = useRef(true);
  useEffect(() => {
    if (!token) return;
    if (first.current) { first.current = false; reload(); return; }
    load(false);
  }, [token, planPing]); // eslint-disable-line react-hooks/exhaustive-deps

  // 앱이 다시 앞에 오면 (오래 꺼 뒀다 켜면 계획이 바뀌었을 수 있다)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') { load(false); loadFamily(); } });
    return () => sub.remove();
  }, [load, loadFamily]);

  // 안드로이드 오토 쉿 모드(자동): 가족 낮잠을 받거나 바꿀 때마다 네이티브에 넘긴다
  useEffect(() => {
    if (family) syncAutoNap(family.napStart, family.napLen);
  }, [family?.napStart, family?.napLen]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 오늘만 머무름을 코스에 맞춘다: 남은 곳 중 값이 다르거나 아직 직접 정하지 않은 곳만 SetDwell (하나씩, 버전 이어서) */
  const syncDwell = async (dwell: Record<string, number> | undefined) => {
    if (!dwell || mockRef.current) return;
    for (const [place, minutes] of Object.entries(dwell)) {
      const s = courseRef.current?.stops.find((x) => x.placeId === place && (x.status === 'PLANNED' || x.status === 'NEXT'));
      if (!s || (s.dwellGuessMin === minutes && s.dwellSet)) continue;
      const r = await courseAct({ type: 'SetDwell', place, minutes });
      if (r && !r.ok) throw new Error('차가 먼저 코스를 바꿨어요 · 최신 코스를 보고 다시 해 주세요');
    }
  };

  const choose = useCallback(async (idx: number | null, dwell?: Record<string, number>) => {
    if (!token || !data) return;
    const r = await choosePlan(token, data.planId, idx);
    setData((d) => (d && d.planId === r.planId ? { ...d, chosen: r.chosen, chosenBy: r.chosenBy } : d));
    // 고르면 서버가 살아 있는 코스를 만든다(취소하면 없앤다) → 바로 받아 온다
    if (!mockRef.current) { if (idx == null) { courseRef.current = null; setCourse(null); setLastOutcome(null); } unsupported.current = false; await loadCourseInner(); }
    if (idx != null) await syncDwell(dwell);
  }, [token, data, courseAct]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseStops = useCallback(async (stops: string[], dwell?: Record<string, number>) => {
    if (!token || !data) return;
    await chooseCourse(token, data.planId, stops, dwell);
    // 카드가 하나 늘었으니 계획을 다시 받고(고른 계획이라 같은 것), 서버가 만든 살아 있는 코스도 받는다
    await load(false);
    if (!mockRef.current) { unsupported.current = false; await loadCourseInner(); }
    await syncDwell(dwell);
  }, [token, data, load, courseAct]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseAnchor = useCallback(async (res: AnchorRes, idx: number, extendLimit: boolean) => {
    if (!token) return;
    const o = res.plan.options[idx];
    if (!o) return;
    learnNames(o.stops);
    const dwell = o.anchorId ? { [o.anchorId]: res.anchor.dwell } : {};
    await chooseAnchorCourse(token, res.planId, o, dwell);
    // 오늘 계획·코스를 다시 받는다 (다른 날 계획이면 오늘 추천은 그대로, 코스는 그 계획 것)
    await load(false);
    if (!mockRef.current) { unsupported.current = false; await loadCourseInner(); }
    // 앵커 머무름(정한 값)을 코스에도 — 코스 편집 고르기와 같은 SetDwell
    await syncDwell(dwell);
    // 한계를 넘는 카드: 오늘만 귀가 한계를 집 도착 + 10분(안전 여유)으로 — 자정을 넘기면 안 늦춘다
    if (extendLimit && o.overLimit && o.arriveHomeMin + 10 < 24 * 60) {
      const r = await courseAct({ type: 'SetEnd', limit: hhmm(o.arriveHomeMin + 10) });
      if (r && !r.ok) throw new Error('코스는 골랐지만 귀가 한계를 바꾸지 못했어요 · 코스 카드에서 도착을 바꿔 주세요');
    }
  }, [token, load, courseAct]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveEdit = useCallback(async (stops: string[], dwell: Record<string, number>) => {
    const c = courseRef.current;
    if (!c) return;
    const nick = me?.me.nickname;
    const same = c.stops.filter((x) => x.status === 'PLANNED' || x.status === 'NEXT').map((x) => x.placeId).join() === stops.join();
    if (!same) {
      const r = await courseAct({ type: 'Remote', version: c.version + 1, stops, by: nick ? `폰:${nick}` : '폰' });
      if (r && !r.ok) throw new Error('차가 먼저 코스를 바꿨어요 · 최신 코스를 보고 다시 해 주세요');
    }
    await syncDwell(dwell);
  }, [courseAct, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPlan = useCallback(async (opts: { with?: Companion; day?: string; maxStops?: number; meal?: boolean }) => {
    if (!token) throw new Error('연결이 필요해요');
    const tst = testRef.current;
    const r = tst ? await getPlan(token, tst.loc, { at: tst.extra.at, ...opts }) : await getPlan(token, await locate(), opts);
    learnNames(r.plan.options.flatMap((o) => o.stops));
    return r;
  }, [token, locate]); // eslint-disable-line react-hooks/exhaustive-deps

  const choosePlanned = useCallback(async (planId: string, pick: { idx: number } | { stops: StopRef[]; anchor?: string }, dwell?: Record<string, number>) => {
    if (!token) return;
    if ('idx' in pick) await choosePlan(token, planId, pick.idx);
    else await chooseCourse(token, planId, pick.stops, dwell, pick.anchor);
    await load(false);
    if (!mockRef.current) { unsupported.current = false; await loadCourseInner(); }
    await syncDwell(dwell);
  }, [token, load, courseAct]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelCourse = useCallback(async (planId?: string) => {
    if (!token) return;
    let id = planId ?? null;
    if (!id && !mockRef.current) id = (await getCourse(token).catch(() => null))?.planId ?? null;
    id = id ?? data?.planId ?? null;
    if (!id) return;
    await choosePlan(token, id, null);
    if (scheduled?.planId === id) setScheduled(null);
    // 일정 탭에서 다른 날 코스를 취소하면 오늘 코스는 그대로 (지금 코스가 든 계획이거나 모르면 비운다 — 아래에서 다시 받음)
    else if (!planId || !coursePlanId.current || coursePlanId.current === id || data?.planId === id) { courseRef.current = null; setCourse(null); setLastOutcome(null); }
    await load(false);
    if (!mockRef.current) { unsupported.current = false; await loadCourseInner(); }
  }, [token, data, load, scheduled]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveCourse = useCallback(async (planId: string, toDay: string, replace = false) => {
    if (!token) throw new Error('연결이 필요해요');
    const r = await moveSchedule(token, planId, toDay, replace);
    if (r.ok) {
      if (scheduled?.planId === planId) setScheduled(null);
      await load(false);
      if (!mockRef.current) { unsupported.current = false; await loadCourseInner(); }
    }
    return r;
  }, [token, load, scheduled]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTest = useCallback((tst: PlanTest | null) => {
    testRef.current = tst;
    setTestState(tst);
    setData(null);
    setError(null);
    load(!!tst);
  }, [load]);

  return (
    <Ctx.Provider value={{ data, family, loading, error, noLoc, test, reload, choose, chooseStops, chooseAnchor, liveEdit, setTest, setFamily, fetchPlan, hereNow: () => testRef.current?.loc ?? loc.current?.v ?? null, choosePlanned, cancelCourse, scheduled, schedule, scheduleError, loadSchedule, moveCourse,
      course, courseVersion: course?.version ?? 0, lastOutcome, courseError, courseBusy, courseMock, setCourseMock, placeName, knownPlaces,
      loadCourse, courseAct, adopt, dismissProposal, courseNow }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePlan() {
  const p = useContext(Ctx);
  if (!p) throw new Error('PlanProvider 밖');
  return p;
}
