import { sql } from "./db";
import { kst } from "./kst";
import { iGa, loadPlaces, type Who } from "./plan";
import { limitMin, parseCompanion } from "./planner";
import { addDays } from "./festival-shape";
import { contextPlan, editCtx } from "./choose-ctx";
import { courseChoice } from "./choose";
import { clearCourse, startCourse } from "./course";
import { pushToCar } from "./push";
import type { CourseJson } from "./livecourse";
import {
  AHEAD_DAYS, PAST_DAYS, closedMessage, closedOnDay, dayLabel, moveDayError, moveInput, pastItem, scheduleStops, titleOf, upcomingItem,
  type NameOf, type PastItem, type ScheduleRow, type UpcomingItem,
} from "./schedule-shape";

/*
 * 일정 탭 — DB 쪽 (모양·판정은 schedule-shape.ts).
 *   loadSchedule: 다가오는 나들이(오늘 ~ +14일) · 지난 나들이(60일)
 *   moveCourse: 정한 코스를 다른 날로 (같은 곳·같은 순서로 그날 시간표를 새로 짠다)
 */

/** 날마다 가장 최근의 코스 있는 계획 (loadCourseRow와 같은 규칙: course is not null, 만든 순서 최신). */
async function rowsBetween(carId: string, from: string, to: string): Promise<ScheduleRow[]> {
  return sql<ScheduleRow[]>`
    select distinct on (day) id, day::text as day, options, chosen, chosen_by, course, course_version, companion
    from plans
    where car_id = ${carId} and course is not null and day >= ${from}::date and day <= ${to}::date
    order by day, created_at desc`;
}

/** 실린 이름이 없을 때만 명소 표를 읽는다. */
async function namesFor(rows: ScheduleRow[]): Promise<NameOf> {
  const missing = rows.some((r) => (r.course?.stops ?? []).some((s) => !(s as { name?: string }).name));
  if (!missing) return () => null;
  const places = await loadPlaces().catch(() => []);
  const m = new Map(places.map((p) => [p.id, { name: p.name, lat: p.lat, lng: p.lng }]));
  return (id) => m.get(id);
}

export async function loadSchedule(carId: string, now = new Date()): Promise<{ today: string; upcoming: UpcomingItem[]; past: PastItem[] }> {
  const today = kst(now).day;
  const since = addDays(today, -PAST_DAYS);
  const [up, past, stamps, ext] = await Promise.all([
    rowsBetween(carId, today, addDays(today, AHEAD_DAYS)),
    rowsBetween(carId, since, addDays(today, -1)),
    sql<{ day: string; place_id: string }[]>`
      select ((created_at at time zone 'Asia/Seoul')::date)::text as day, place_id
      from events
      where car_id = ${carId} and kind = 'stamp' and place_id is not null
        and created_at >= (${since}::date::timestamp at time zone 'Asia/Seoul')`,
    sql<{ day: string; ext_id: string }[]>`
      select day::text as day, ext_id from visits_ext where family_id = ${carId} and day >= ${since}::date`,
  ]);
  const nameOf = await namesFor([...up, ...past]);
  const group = <T,>(xs: T[], key: (x: T) => string, val: (x: T) => string) => {
    const m = new Map<string, string[]>();
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), val(x)]);
    return m;
  };
  const stampsBy = group(stamps, (s) => s.day, (s) => s.place_id);
  const extBy = group(ext, (e) => e.day, (e) => e.ext_id);
  return {
    today,
    upcoming: up.map((r) => upcomingItem(r, nameOf)),
    past: past.map((r) => pastItem(r, nameOf, stampsBy.get(r.day) ?? [], extBy.get(r.day) ?? [])).reverse(),
  };
}

type PlanFull = ScheduleRow & { origin_cell: string; now_at: Date; mode: string };

export type MoveResult =
  | { ok: true; planId: string; day: string; item: UpcomingItem | null; replaced: string | null; pushed: number }
  | { ok: false; status: number; error: string; message: string; closed?: string[]; existing?: { planId: string; day: string; title: string; stops: string[] } };

const fail = (status: number, message: string, error = "bad"): MoveResult => ({ ok: false, status, error, message });

/**
 * 정한 코스를 다른 날로 옮기기 (POST /api/plan/schedule/move).
 * 그날 08:30 집에서 출발(오늘이면 지금)하는 새 문맥 계획에 같은 곳·같은 순서·정한 머무름으로 카드를 짜서(choose stops와 같은 계산 —
 * 그날 하늘·축제·운영 시각) 고르고 살아 있는 코스를 만든다. 그다음 원래 날 계획의 고르기·코스를 지운다(취소와 같음).
 * 그날 이미 정한 코스가 있으면 replace 없이는 409 conflict, 쉬는 곳이 있으면 409 closed, 시간이 안 맞으면 409 no_fit.
 */
export async function moveCourse(who: Who, planId: string, toDay: unknown, replace: boolean, now = new Date()): Promise<MoveResult> {
  const today = kst(now).day;
  const [plan] = await sql<PlanFull[]>`
    select id, day::text as day, options, chosen, chosen_by, course, course_version, companion, origin_cell, now_at, mode
    from plans where id = ${planId} and car_id = ${who.carId}`;
  if (!plan) return fail(404, "계획을 찾지 못했어요", "not_found");
  if (!plan.course) return fail(404, "이 계획엔 정한 코스가 없어요", "no_course");
  const dayErr = moveDayError(toDay, plan.day, today);
  if (dayErr) return fail(400, dayErr);
  const day = toDay as string;
  const input = moveInput(plan);
  if (input.started) return fail(409, "이미 다녀온 곳이 있는 코스는 옮길 수 없어요", "started");
  if (!input.stops.length) return fail(409, "옮길 곳이 없어요", "empty");

  // 그날 이미 정한 코스
  const others = await sql<ScheduleRow[]>`
    select id, day::text as day, options, chosen, chosen_by, course, course_version, companion
    from plans where car_id = ${who.carId} and day = ${day}::date and course is not null and id <> ${plan.id}
    order by created_at desc`;
  if (others.length && !replace) {
    const o = others[0];
    return {
      ok: false, status: 409, error: "conflict",
      message: `${dayLabel(day)}에는 이미 정한 코스가 있어요. 바꿀까요?`,
      existing: { planId: o.id, day, title: titleOf(o), stops: scheduleStops(o, () => null).map((s) => s.name) },
    };
  }

  // 그날 문맥 계획 (오늘이면 지금 시각·마지막 위치, 다른 날이면 08:30 집에서)
  const [last] = await sql<{ origin_cell: string }[]>`select origin_cell from plans where car_id = ${who.carId} order by created_at desc limit 1`;
  const ctxRow = await contextPlan(who.carId, who.demo, day, today, last?.origin_cell ?? null, parseCompanion(plan.companion));
  if (!ctxRow) return fail(400, "집 위치를 몰라요 — 먼저 오늘 추천을 한 번 받아 주세요");
  const drop = async () => { await sql`delete from plans where id = ${ctxRow.id} and chosen is null`; };
  const ctx = await editCtx(who.carId, who.demo, ctxRow);

  // 쉬는 곳 (그날 장소표에 없는 축제 포함)
  const named = scheduleStops(plan, () => null).map((s) => ({ id: s.placeId, name: s.name }));
  const closed = closedOnDay(named, ctx.find, day);
  if (closed.length) {
    await drop();
    return { ok: false, status: 409, error: "closed", message: closedMessage(day, closed), closed };
  }
  const c = courseChoice(input.stops, ctx.find, ctx.nowMin, ctx.here, ctx.profile, ctx.sky, ctx.mode, input.dwell, input.anchor);
  if (!c.ok) {
    await drop();
    return { ok: false, status: c.status === 400 ? 409 : c.status, error: "no_fit", message: day === today
      ? "오늘은 지금 출발해도 시간이 안 맞아요 (문 닫는 시각·귀가 한계). 다른 날을 골라 주세요"
      : `${dayLabel(day)}에는 이 코스로 다녀오기엔 시간이 안 맞아요 (문 닫는 시각·귀가 한계). 다른 날을 골라 주세요` };
  }

  // 카드 이름은 원래 것 그대로 ('1순위 · 하루 코스' 등) — 앵커 코스는 새로 붙은 '○○ 중심으로'
  if (!input.anchor) c.option.label = titleOf(plan);
  const by = who.phone ? `폰:${who.phone.nickname}` : "차";
  const chosenBy = plan.chosen_by ?? by;
  const backBy = limitMin(ctx.mode, ctx.profile, ctx.sky);
  await sql`update plans set options = ${sql.json([c.option] as never)}, chosen = 0, chosen_by = ${chosenBy}, chosen_at = now(), back_by = ${backBy} where id = ${ctxRow.id}`;
  const course = await startCourse(ctxRow.id, c.option, { ...ctxRow, back_by: backBy }, chosenBy, who.carId);
  if (!course) {
    await sql`delete from plans where id = ${ctxRow.id}`;
    return fail(500, "코스를 만들지 못했어요", "start_failed");
  }
  // 사람이 정한 머무름은 '오늘만 정함' 표시도 이어 간다 (폰이 고른 뒤 SetDwell을 보내는 것과 같은 결과)
  if (Object.keys(input.dwell).length) {
    let changed = false;
    for (const s of course.stops) if (input.dwell[s.placeId] === s.dwellGuessMin && !s.dwellSet) { s.dwellSet = true; changed = true; }
    if (changed) await sql`update plans set course = ${sql.json(course as never)} where id = ${ctxRow.id}`;
  }

  // 원래 날 · (바꾸기면) 그날의 다른 코스 지우기 — 고르기 취소와 같다
  await sql`update plans set chosen = null, chosen_by = null, chosen_at = null where id = ${plan.id}`;
  await clearCourse(plan.id);
  for (const o of replace ? others : []) {
    await sql`update plans set chosen = null, chosen_by = null, chosen_at = null where id = ${o.id}`;
    await clearCourse(o.id);
  }

  const nick = who.phone?.nickname;
  const pushed = await pushToCar(
    who.carId,
    { title: nick ? `${nick}${iGa(nick)} 나들이 날짜를 옮겼어요` : "나들이 날짜를 옮겼어요", body: `${dayLabel(plan.day)} → ${dayLabel(day)}`, url: "/", tag: "plan" },
    { kind: "plan", planId: ctxRow.id, idx: "0", chosenBy, courseVersion: String(course.version), course: "" },
    { except: who.phone?.id },
  ).catch(() => 0);

  const row: ScheduleRow = { id: ctxRow.id, day, options: [c.option], chosen: 0, chosen_by: chosenBy, course: course as CourseJson, course_version: course.version, companion: ctxRow.companion };
  return { ok: true, planId: ctxRow.id, day, item: upcomingItem(row, () => null), replaced: replace && others.length ? others[0].id : null, pushed };
}
