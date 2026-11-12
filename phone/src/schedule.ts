// 일정 탭: 날짜별로 정해 둔 나들이(다가오는 · 지난) — 서버 GET /api/plan/schedule, 날짜 옮기기 POST /api/plan/schedule/move.
// 취소는 고르기 취소(POST /api/plan/choose {idx: null}, planStore.cancelCourse)와 같다.
import { ApiError, call } from './api';
import { LiveCourse, normCourse, StopStatus } from './course';
import type { Companion, PlanOption } from './plan';

export type ScheduleStop = {
  placeId: string; name: string; lat: number | null; lng: number | null;
  /** 코스 시간표의 예정 도착·출발 (분) */
  arriveMin: number; departMin: number; status: StopStatus;
};
export type UpcomingPlan = {
  day: string; planId: string; title: string; stops: ScheduleStop[];
  departMin: number; arriveHomeMin: number; chosenBy: string | null; companion?: Companion;
  /** 앵커 코스('○○ 중심으로')면 그 곳 — 코스 고치기에서 못 뺌 */
  anchorId?: string;
  course: LiveCourse; version: number;
};
export type PastPlan = {
  day: string; planId: string; title: string; stops: ScheduleStop[];
  /** 실제로 들른 곳 id */
  visited: string[];
  stampsEarned: number;
};
export type ScheduleRes = { today: string; upcoming: UpcomingPlan[]; past: PastPlan[] };

/** 옛 서버(일정 API 없음)면 null */
export async function getSchedule(token: string): Promise<ScheduleRes | null> {
  try {
    const r = await call<ScheduleRes>(token, 'GET', '/api/plan/schedule');
    const upcoming = (r.upcoming ?? []).flatMap((u) => {
      const course = normCourse(u.course);
      return course ? [{ ...u, course }] : [];
    });
    return { today: r.today, upcoming, past: r.past ?? [] };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export type MoveResult =
  | { ok: true; planId: string; day: string }
  | { ok: false; kind: 'conflict' | 'closed' | 'no_fit' | 'started' | 'bad'; message: string; existing?: { title: string; stops: string[] } };

/** 날짜 옮기기. 409·400은 쉬운 말(message)과 함께 ok:false로 — 그 밖의 오류는 던진다 */
export async function moveSchedule(token: string, planId: string, toDay: string, replace = false): Promise<MoveResult> {
  try {
    const r = await call<{ planId: string; day: string }>(token, 'POST', '/api/plan/schedule/move', { planId, toDay, ...(replace ? { replace: true } : {}) });
    return { ok: true, planId: r.planId, day: r.day };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 409 || e.status === 400)) {
      const d = (e.data ?? {}) as { error?: string; message?: string; existing?: { title: string; stops: string[] } };
      const kind = (['conflict', 'closed', 'no_fit', 'started'] as const).find((k) => k === d.error) ?? 'bad';
      return { ok: false, kind, message: d.message || '옮기지 못했어요', existing: d.existing };
    }
    if (e instanceof ApiError && e.status === 404) throw new ApiError('서버를 새로 올려야 날짜를 옮길 수 있어요', 404);
    throw e;
  }
}

/** 일정 한 줄 → 코스 지도(CourseMiniMap)가 읽는 카드 모양 (좌표 모르는 곳은 뺀다) */
export function optionOfPlan(u: UpcomingPlan): PlanOption {
  const stops = u.stops.filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ id: s.placeId, name: s.name, lat: s.lat!, lng: s.lng!, indoor: false, stampable: false }));
  return {
    kind: 'COURSE', label: u.title, stops, firstLegMin: 0, detourMin: null, arriveHomeMin: u.arriveHomeMin, arriveHome: '',
    legs: u.course.legs, reasons: [], ...(u.anchorId ? { anchorId: u.anchorId } : {}),
  };
}

/** 사람이 고친 코스 (CourseEditSheet)의 바깥 장소(ext:…) 칸: 이름·좌표째 */
export function planStopRef(u: UpcomingPlan, id: string): string | ({ id: string } & Record<string, unknown>) {
  if (!id.startsWith('ext:')) return id;
  const s = u.stops.find((x) => x.placeId === id);
  const ext = (u.course.stops.find((x) => x.placeId === id) as { ext?: Record<string, unknown> } | undefined)?.ext;
  return { ...(ext ?? {}), id, name: s?.name, lat: s?.lat, lng: s?.lng };
}
