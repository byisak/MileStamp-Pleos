import { stopName, type CourseJson } from "./livecourse";
import { isExtId } from "./ext";
import { addDays } from "./festival-shape";
import { placeClosedOn, weekdayOf, type Place } from "./planner";
import type { OptionJson } from "./plan";

/*
 * 일정 탭 (GET /api/plan/schedule · POST /api/plan/schedule/move) — DB 없이 시험하려고 모양 만들기·판정만 여기 둔다.
 * 날마다 '가장 최근에 만든, 코스가 있는 계획' 하나가 그날의 나들이다 (GET /api/plan/course의 loadCourseRow와 같은 규칙).
 */

/** 앞으로 며칠까지 보여 주고 옮길 수 있나 (GET /api/plan?day=와 같은 2주). */
export const AHEAD_DAYS = 14;
/** 지난 나들이를 며칠 전까지. */
export const PAST_DAYS = 60;

export type ScheduleRow = {
  id: string; day: string; options: OptionJson[]; chosen: number | null; chosen_by: string | null;
  course: CourseJson; course_version: number; companion: string | null;
};

export type ScheduleStop = {
  placeId: string; name: string; lat: number | null; lng: number | null;
  /** 코스 시간표 (그날 아침 짠 예정 시각, 분) */
  arriveMin: number; departMin: number; status: string;
};

export type UpcomingItem = {
  day: string; planId: string; title: string; stops: ScheduleStop[];
  departMin: number; arriveHomeMin: number; chosenBy: string | null; companion?: string;
  /** 앵커 코스('○○ 중심으로')면 그 곳 id — 폰 '코스 고치기'에서 빼기 막음 */
  anchorId?: string;
  /** 코스 그대로 (지도·코스 고치기용). version = course_version */
  course: CourseJson; version: number;
};

export type PastItem = {
  day: string; planId: string; title: string; stops: ScheduleStop[];
  /** 실제로 들른 곳 (코스 도착·다녀옴 + 그날 도장 + 그날 '다녀옴' 기록) */
  visited: string[];
  /** 그날 받은 도장 수 (코스 밖 곳도 포함) */
  stampsEarned: number;
};

/** 이름·좌표 찾기 (명소 표) — 코스·카드에 실린 이름이 먼저. */
export type NameOf = (id: string) => { name: string; lat: number; lng: number } | null | undefined;

const WD = ["일", "월", "화", "수", "목", "금", "토"];
/** '11/7(토)' */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${m}/${d}(${WD[weekdayOf(day)]})`;
}

const chosenOption = (r: Pick<ScheduleRow, "options" | "chosen">): OptionJson | null =>
  r.chosen != null && Array.isArray(r.options) ? r.options[r.chosen] ?? null : null;

/** 코스 곳들 → 이름·좌표가 붙은 줄. skipped = 빠진 곳도 넣을지 (지난 나들이는 넣음). */
export function scheduleStops(row: Pick<ScheduleRow, "course" | "options" | "chosen">, nameOf: NameOf, skipped = false): ScheduleStop[] {
  const opt = chosenOption(row);
  const byOpt = new Map((opt?.stops ?? []).map((s) => [s.id, s]));
  return (row.course?.stops ?? [])
    .filter((s) => skipped || s.status !== "SKIPPED")
    .map((s) => {
      const x = s as typeof s & { name?: string; lat?: number; lng?: number };
      const o = byOpt.get(s.placeId);
      const known = nameOf(s.placeId);
      const num = (...v: (number | undefined | null)[]) => v.find((n) => typeof n === "number" && Number.isFinite(n)) ?? null;
      return {
        placeId: s.placeId,
        name: stopName(s.placeId, x.name || o?.name || known?.name),
        lat: num(x.lat, o?.lat, known?.lat),
        lng: num(x.lng, o?.lng, known?.lng),
        arriveMin: s.plannedArriveMin, departMin: s.plannedDepartMin, status: s.status,
      };
    });
}

/** 카드 제목: 고른 카드 이름 ('고른 코스' · '○○ 중심으로' …). */
export function titleOf(row: Pick<ScheduleRow, "options" | "chosen">): string {
  return chosenOption(row)?.label?.trim() || "고른 코스";
}

export function upcomingItem(row: ScheduleRow, nameOf: NameOf): UpcomingItem {
  const c = row.course;
  const anchorId = (chosenOption(row) as (OptionJson & { anchorId?: string }) | null)?.anchorId;
  return {
    day: row.day, planId: row.id, title: titleOf(row), stops: scheduleStops(row, nameOf),
    departMin: c.legs?.[0]?.fromMin ?? c.nowMin, arriveHomeMin: c.arriveHomeMin, chosenBy: row.chosen_by,
    ...(row.companion ? { companion: row.companion } : {}),
    ...(anchorId ? { anchorId } : {}),
    course: c, version: row.course_version,
  };
}

const VISITED = new Set(["ARRIVED", "DONE"]);

/**
 * 지난 나들이 한 줄. stamps = 그날 도장 받은 곳 id들(같은 곳 여러 번이면 여러 번) · ext = 그날 '다녀옴' 기록한 바깥 장소 id들.
 */
export function pastItem(row: ScheduleRow, nameOf: NameOf, stamps: string[], ext: string[]): PastItem {
  const stops = scheduleStops(row, nameOf, true);
  const hit = new Set<string>([...stamps, ...ext]);
  const visited = stops.filter((s) => VISITED.has(s.status) || hit.has(s.placeId)).map((s) => s.placeId);
  return { day: row.day, planId: row.id, title: titleOf(row), stops, visited: [...new Set(visited)], stampsEarned: stamps.length };
}

/** 옮길 날 확인 — 틀리면 쉬운 말 이유. */
export function moveDayError(toDay: unknown, fromDay: string, today: string): string | null {
  if (typeof toDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(toDay) || Number.isNaN(Date.parse(`${toDay}T00:00:00Z`))) return "toDay는 YYYY-MM-DD예요";
  if (fromDay < today) return "지난 나들이는 옮길 수 없어요";
  if (toDay < today) return "지난 날로는 옮길 수 없어요";
  if (toDay > addDays(today, AHEAD_DAYS)) return "2주 안의 날로만 옮길 수 있어요";
  if (toDay === fromDay) return "같은 날이에요";
  return null;
}

/**
 * 옮길 코스의 재료: 남은 곳 순서(바깥 장소는 이름·좌표째) + 사람이 정한 머무름 + 앵커.
 * 이미 들른 곳(도착·다녀옴)이 있으면 started — 오늘 다니는 중인 코스는 옮기지 않는다.
 */
export function moveInput(row: Pick<ScheduleRow, "course" | "options" | "chosen">): {
  stops: (string | Record<string, unknown>)[]; dwell: Record<string, number>; anchor: string | null; started: boolean;
} {
  const all = row.course?.stops ?? [];
  const started = all.some((s) => VISITED.has(s.status));
  const left = all.filter((s) => s.status !== "SKIPPED");
  const opt = chosenOption(row) as (OptionJson & { anchorId?: string }) | null;
  const anchor = opt?.anchorId && left.some((s) => s.placeId === opt.anchorId) ? opt.anchorId : null;
  const dwell: Record<string, number> = {};
  for (const s of left) if (s.dwellSet || s.placeId === anchor) dwell[s.placeId] = s.dwellGuessMin;
  const stops = left.map((s) => {
    if (!isExtId(s.placeId)) return s.placeId;
    const x = s as typeof s & { ext?: Record<string, unknown>; name?: string; lat?: number; lng?: number };
    const o = opt?.stops.find((y) => y.id === s.placeId);
    return { ...(o?.ext ?? {}), ...(x.ext ?? {}), id: s.placeId, name: x.name ?? o?.name, lat: x.lat ?? o?.lat, lng: x.lng ?? o?.lng };
  });
  return { stops, dwell, anchor, started };
}

/**
 * 그날 쉬는 곳 이름들. known = 그날 장소표(축제는 그날 열리는 것만)에서 찾은 곳 — 못 찾은 우리 장소(끝난 축제 등)도 '못 가는 곳'.
 * 바깥 장소(ext:…)는 쉬는 날을 몰라서 넘어간다.
 */
export function closedOnDay(stops: { id: string; name: string }[], find: (id: string) => Place | null | undefined, day: string): string[] {
  const out: string[] = [];
  for (const s of stops) {
    if (isExtId(s.id)) continue;
    const p = find(s.id);
    if (!p || placeClosedOn(p, day)) out.push(p?.name ?? s.name);
  }
  return out;
}

/** '국립대구과학관, 화본역' → 409 글 (쉬는 날·축제 기간 밖 모두 '문을 열지 않아요') */
export function closedMessage(day: string, names: string[]): string {
  return `${dayLabel(day)}에는 ${names.length > 1 ? `${names.join(", ")} 모두` : `${names[0]}${josaIGa(names[0])}`} 문을 열지 않아요. 다른 날을 골라 주세요`;
}

/** 받침 있으면 '이', 없으면 '가' */
function josaIGa(word: string): string {
  const c = word.trim().slice(-1).charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return "이";
  return (c - 0xac00) % 28 ? "이" : "가";
}
