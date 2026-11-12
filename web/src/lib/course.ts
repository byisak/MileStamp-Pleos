import { sql } from "./db";
import { recordDepart } from "./diary";
import { kst } from "./kst";
import { familyHome, latLngPair, loadFamily, parseCell, toProfile, type OptionJson, type SkyJson, type Who } from "./plan";
import { hhmm, parseCompanion, type Place, type SkyToday } from "./planner";
import {
  LiveCourseEngine, courseFromJson, courseToJson, ctxFromJson, eventFromJson, explainToJson, fromOption, josa, optionFromJson, outcomeToJson,
  type Change, type CourseCtx, type CourseEvent, type CourseJson, type ExplanationJson, type LiveCourse, type Outcome, type OutcomeJson,
} from "./livecourse";
import { pushToCar } from "./push";
import { candidatePlaces } from "./festivals";
import { learnFromCourse, profileWithDwell } from "./dwell";
import { dwellView } from "./dwell-shape";
import { decorateStops, extPlacesOf, withExt } from "./ext";
import { profileWithHistory } from "./history";
import { recordCourseExtVisits } from "./explore";

/*
 * 살아 있는 코스 — 서버 쪽 도우미 (docs/코스-고도화-계획.md 5절·10절).
 * plans.course(LiveCourse JSON) + course_version 을 들고, 폰·차가 보낸 사건을 같은 엔진(livecourse.ts)으로 판정해
 * 새 코스를 저장하고 가족 폰에 `course_update`로 밀어 준다. 차는 다음 조회(GET /api/plan·/api/plan/course) 때 받는다.
 */

/** 코스 줄의 일부 (GET /api/plan의 계획 줄도 이 칸들이 있다). */
export type CourseRowLite = Pick<CourseRow, "id" | "day" | "origin_cell" | "sky" | "course" | "course_version" | "course_proposal" | "companion">;

export type CourseRow = {
  id: string; day: string; origin_cell: string; now_at: Date; sky: SkyJson | null; back_by: number | null;
  course: CourseJson | null; course_version: number; course_updated_at: Date | null; course_proposal: ProposalJson | null;
  /** 이 계획의 동행 (누구랑 가요?) — 코스 엔진의 가족 정보가 이 값으로 (예전 행·없으면 가족 설정). */
  companion?: string | null;
};

/** 마지막 제안 카드들 (adopt용). atMin = 제안을 낸 시각, version = 그때 코스 버전(예전 행엔 없음 → 저장된 버전). */
export type ProposalJson = { options: OptionJson[]; change: Change | null; voice: string | null; atMin: number; version?: number };

/** 차가 실제로 겪은 신호 — 버전이 낮아도 최신 코스 위에 그대로 적용한다 (사실이니까). */
export const SIGNAL_EVENTS = new Set<CourseEvent["type"]>(["Departed", "Arrived", "StillParked", "NaviEta", "StillDriving"]);

/** 이 차의 가장 최근 코스가 있는 계획. 지난 날 것이면 없는 것으로 (데모 차는 미래 날짜 계획도 쓴다). */
export async function loadCourseRow(carId: string, opts: { ahead?: boolean } = {}): Promise<CourseRow | null> {
  // 오늘 코스가 먼저. ahead(폰 보기)면 오늘 코스가 없을 때 가장 가까운 다른 날(미리 정한) 코스도 — 화면은 '11/7(토) 코스 · 출발 예정'.
  // 차·사건(PATCH·adopt·dismiss·도착)은 오늘 코스만: 미리 정한 코스를 오늘 코스로 돌리지 않게
  const today = kst(new Date()).day;
  const [row] = await sql<CourseRow[]>`
    select id, day::text as day, origin_cell, now_at, sky, back_by, course, course_version, course_updated_at, course_proposal, companion
    from plans where car_id = ${carId} and course is not null
      and ${opts.ahead ? sql`day >= ${today}::date` : sql`day = ${today}::date`}
    order by (day = ${today}::date) desc, day asc, created_at desc limit 1`;
  return row ?? null;
}

/** 계획 행의 하늘(JSON) → 엔진 하늘. */
export function skyOfRow(sky: SkyJson | null): SkyToday | null {
  if (!sky) return null;
  const t = (s: string | null) => (s ? hhmm(s) : null);
  return {
    sunriseMin: t(sky.sunrise), sunsetMin: t(sky.sunset), sky: (sky.sky as SkyToday["sky"]) ?? "UNKNOWN", rainFromMin: t(sky.rainFrom),
    air: sky.air?.level ?? null, pm10: sky.air?.pm10 ?? null, pm25: sky.air?.pm25 ?? null,
    tempC: sky.temp ?? null,
  };
}

export type Engine = { engine: LiveCourseEngine; find: (id: string) => Place | null; catalog: Place[] };

/**
 * 장소 찾기에 이 코스·제안 카드에 실린 바깥 장소(ext:…)를 더한 엔진 (장소표에 없는 곳도 되살리게, lib/ext.ts).
 * 사건(Remote·Skip 등)에 바깥 장소 id가 와도 코스에 있던 곳이면 받는다.
 */
export function withCourseExt(eng: Engine, row: { course: CourseJson | null; course_proposal?: ProposalJson | null }): Engine {
  const extra = extPlacesOf(
    row.course?.stops as never,
    ...(row.course_proposal?.options ?? []).map((o) => o.stops as never),
  );
  return extra.length ? { ...eng, find: withExt(eng.find, extra) } : eng;
}

/** 오늘 가족 설정 + 장소표로 엔진 하나. companion = 그 계획의 동행 (없으면 가족 설정의 마지막 동행). */
export async function engineFor(
  carId: string, homeCell: string | null, originCell: string, day = kst(new Date()).day, companion?: string | null,
): Promise<Engine> {
  const { family, homeCell: savedHome } = await loadFamily(carId);
  const home = familyHome(family, savedHome ?? homeCell, originCell) ?? parseCell(originCell)!;
  const catalog = await candidatePlaces(day);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  // 머무는 시간: 우리 가족 배율·장소 기록 + 같은 또래 값 (새로 넣는 곳·오늘 패턴이 이 값을 쓴다)
  // + 방문 기록 ('한 곳 더'·교체 후보도 지금 추천과 같은 점수 — 이미 도장·최근 다녀온 곳은 뒤로)
  const profile = await profileWithHistory(carId, await profileWithDwell(carId, toProfile(family, home, parseCompanion(companion)), day, false, catalog), day);
  const engine = new LiveCourseEngine(profile, catalog);
  engine.day = day; // 교체·'한 곳 더' 후보의 축제 기간
  return { engine, find: (id) => byId.get(id) ?? null, catalog };
}

/** 고른 카드 → 코스 만들어 저장 (version 1). 카드 장소가 장소표에 없으면 null. */
export async function startCourse(
  planId: string, option: OptionJson, row: { origin_cell: string; now_at: Date; sky: SkyJson | null; back_by: number | null; companion?: string | null }, chosenBy: string, carId?: string,
): Promise<CourseJson | null> {
  // 머무름 예상은 우리 가족 값 (carId가 있으면). 카드의 하루 막대가 이미 같은 값으로 짜여 있다.
  const eng = carId ? await engineFor(carId, null, row.origin_cell, kst(row.now_at).day, row.companion) : null;
  const catalog = eng?.catalog ?? await candidatePlaces(kst(row.now_at).day);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  // 바깥 장소(앵커 코스의 ext:…)는 카드에 실린 이름·좌표·머무름으로
  const find = withExt((id: string) => byId.get(id), extPlacesOf(option.stops));
  let opt;
  try { opt = optionFromJson(option, find); } catch { return null; }
  const nowMin = kst(row.now_at).min;
  const course = fromOption(opt, { backByMin: row.back_by ?? opt.arriveHomeMin, sky: skyOfRow(row.sky) }, chosenBy, nowMin, parseCell(row.origin_cell), eng?.engine.profile ?? null);
  const json = courseToJson(course);
  decorateStops(json.stops, find);
  await sql`
    update plans set course = ${sql.json(json as never)}, course_version = ${course.version}, course_updated_at = now(), course_proposal = null
    where id = ${planId}`;
  return json;
}

/**
 * 응답·알림용: 장소마다 머무름 예상의 출처(dwellSource)를 붙인다 — 우리 가족 기록 n번 · 같은 또래 n가족 · 조사값. 저장은 안 한다.
 * 저장된 코스 JSON을 건드리지 않도록 저장 뒤에만 부른다.
 */
export function withDwellSources(course: CourseJson, eng: Engine): CourseJson {
  for (const s of course.stops) {
    const p = eng.find(s.placeId);
    if (p) s.dwellSource = dwellView(eng.engine.profile, p);
  }
  return course;
}

/** 고르기 취소 → 코스도 없앤다. */
export async function clearCourse(planId: string) {
  await sql`update plans set course = null, course_version = 0, course_updated_at = now(), course_proposal = null where id = ${planId}`;
}

/** 답 JSON + 화면 맨 위 쉬운 설명. */
export type OutcomeWithExplain = OutcomeJson & { explain?: ExplanationJson };

/**
 * 설명에 쓸 '지금' — 오늘 계획이면 서버 시각(한국), 오늘이 아닌 계획(데모 차의 시연 날짜)은 벽시계가 뜻이 없어 코스가 마지막으로 짠 시각.
 */
export function nowFor(row: { day: string }, course: { nowMin: number }): number {
  const clock = kst(new Date());
  return row.day === clock.day ? clock.min : course.nowMin;
}

/** 코스 + (같은 버전의) 제안 카드 → 쉬운 설명 JSON (엔진 explain). */
export function explainFor(eng: Engine, row: { day: string; sky: SkyJson | null }, course: LiveCourse, options: Parameters<typeof optionFromJson>[0][] | null | undefined): ExplanationJson | undefined {
  try {
    const opts = (options ?? []).map((o) => optionFromJson(o, eng.find));
    return explainToJson(eng.engine.explain(course, nowFor(row, course), opts, skyOfRow(row.sky)?.sunsetMin ?? null));
  } catch {
    return undefined; // 설명은 덤 — 못 만들어도 코스는 보낸다
  }
}

/**
 * 코스를 꺼낼 때(GET /api/plan/course · GET /api/plan): 오늘 계획인데 시간표가 뒤처졌거나(5분 넘게) 문 닫아 못 가는 곳이 있으면
 * Tick(지금 시각)으로 다시 짜서 저장·알림 — 못 가는 곳은 건너뛰고, 한계를 넘으면 '바로 집으로'를 권한다(엔진 판정).
 * 그다음 설명을 붙여 돌려준다. 데모 차의 시연 날짜(오늘이 아닌 계획)는 벽시계로 건드리지 않는다.
 */
export async function courseView(who: Who, row: CourseRowLite): Promise<{ course: CourseJson; version: number; proposal: ProposalJson | null; explain?: ExplanationJson }> {
  const eng = withCourseExt(await engineFor(who.carId, null, row.origin_cell, row.day, row.companion), row);
  let course: LiveCourse;
  try { course = courseFromJson(row.course!, eng.find); }
  catch { return { course: row.course!, version: row.course_version, proposal: row.course_proposal }; }
  const clock = kst(new Date());
  if (row.day === clock.day && eng.engine.needsTick(course, clock.min)) {
    const r = await applyStep(who, row as CourseRow, (e, c) => e.engine.apply(c, { type: "Tick", nowMin: clock.min }), { retryOnRace: true, by: "서버" }, eng);
    if (r.ok) {
      const latest = await loadCourseRow(who.carId);
      if (latest && latest.id === row.id) row = latest;
      try { course = courseFromJson(row.course!, eng.find); } catch { /* 위에서 읽은 것 그대로 */ }
    }
  }
  const p = row.course_proposal;
  const options = p && (p.version ?? row.course_version) === row.course_version ? p.options : null;
  const out = withDwellSources(structuredClone(row.course!), eng);
  decorateStops(out.stops, eng.find);
  return { course: out, version: row.course_version, proposal: row.course_proposal, explain: explainFor(eng, row, course, options) };
}

export type ApplyResult =
  | { ok: true; outcome: OutcomeWithExplain; version: number; pushed: number }
  | { ok: false; status: number; error: string; course?: CourseJson; version?: number; proposal?: ProposalJson | null };

/** 폰·차가 아는 버전과 저장된 버전이 다를 때 돌려주는 409 몸체. */
export function conflict(row: CourseRow, error = "코스가 그새 바뀌었어요. 최신 코스로 다시 보내 주세요"): ApplyResult {
  return { ok: false, status: 409, error, course: row.course!, version: row.course_version, proposal: row.course_proposal };
}

type Step = (engine: Engine, course: LiveCourse) => Outcome;

/**
 * 코스에 판정 한 번을 적용하고 저장·알림까지. 저장은 course_version이 읽은 값 그대로일 때만(낙관적 잠금) —
 * 그새 바뀌었으면 한 번 더 최신으로 다시 한다(신호 사건) / 409(명령 사건).
 */
async function applyStep(who: Who, row: CourseRow, step: Step, opts: { retryOnRace: boolean; by: string }, engine?: Engine): Promise<ApplyResult> {
  const base = engine ?? await engineFor(who.carId, null, row.origin_cell, row.day, row.companion);
  for (let attempt = 0; attempt < 2; attempt++) {
    const eng = withCourseExt(base, row);
    let course: LiveCourse;
    try { course = courseFromJson(row.course!, eng.find); }
    catch (e) { return { ok: false, status: 500, error: `저장된 코스를 읽지 못했어요: ${(e as Error).message}` }; }
    let outcome: Outcome;
    try { outcome = step(eng, course); }
    catch (e) { return { ok: false, status: (e as { status?: number }).status ?? 400, error: (e as Error).message }; }
    const json: OutcomeWithExplain = outcomeToJson(outcome);
    // 곳마다 이름·좌표(+ 바깥 장소면 ext)를 실어 저장 — 다시 읽을 때·차가 그릴 때
    decorateStops(json.course.stops, eng.find);
    json.explain = explainFor(eng, row, outcome.course, json.options);
    // 제안 카드: 새 제안이면 바꾸고, 코스가 안 바뀐 NoChange(내비 ETA 대기 등)면 그대로, 그 밖엔(코스가 바뀜) 없앤다
    const proposal: ProposalJson | null =
      outcome.kind === "Proposal" ? { options: json.options!, change: json.change, voice: json.voice, atMin: outcome.course.nowMin, version: outcome.course.version }
      : outcome.kind === "NoChange" && outcome.course.version === row.course_version ? row.course_proposal
      : null;
    const [saved] = await sql<{ id: string }[]>`
      update plans set course = ${sql.json(json.course as never)}, course_version = ${outcome.course.version}, course_updated_at = now(),
                       course_proposal = ${proposal ? sql.json(proposal as never) : null}
      where id = ${row.id} and course_version = ${row.course_version}
      returning id`;
    if (saved) {
      // 새로 다녀온 곳(DONE)이 생겼으면 우리 가족 머무름을 배운다 (덤 — 실패해도 코스는 저장됨)
      const after = json.course;
      await learnFromCourse(who.carId, row.course, after, eng.find, {
        day: row.day, kidAges: eng.engine.profile.kidAges, rainy: after.rainFromMin != null && after.rainFromMin <= after.nowMin,
      }).catch(() => 0);
      // 바깥 장소(ext:…)에 새로 도착·다녀옴 → 도장북 '다녀온 곳' (하루 한 곳 한 번, 덤 — 실패해도 코스는 저장됨)
      await recordCourseExtVisits(who.carId, row.course, after, who.phone ? "phone" : "car")
        .catch((e) => { console.error("다녀옴 기록 실패", (e as Error).message); return 0; });
      withDwellSources(json.course, eng);
      const pushed = await pushCourseUpdate(who, row.id, json, opts.by);
      return { ok: true, outcome: json, version: outcome.course.version, pushed };
    }
    // 그새 다른 요청이 저장했다
    const latest = await loadCourseRow(who.carId);
    if (!latest || latest.id !== row.id) return { ok: false, status: 409, error: "코스가 바뀌었어요. 다시 받아 주세요" };
    row = latest;
    if (!opts.retryOnRace) return conflict(row);
  }
  return conflict(row);
}

/** 사건 하나 적용. body = { version, event } (event 모양은 livecourse.ts eventFromJson 참고). */
export async function applyEvent(who: Who, row: CourseRow, version: number, eventJson: Record<string, unknown>): Promise<ApplyResult> {
  const type = eventJson.type as CourseEvent["type"];
  const signal = SIGNAL_EVENTS.has(type);
  // 명령(바꾸기·빼기·들르기·집으로·원격 코스…)은 최신 버전을 알고 보내야 한다. 차의 실제 신호는 늘 최신 위에 적용.
  if (!signal && version < row.course_version) return conflict(row);
  let ctx: CourseCtx;
  try { ctx = ctxFromJson(eventJson); }
  catch (e) { return { ok: false, status: 400, error: (e as Error).message }; }
  // 오늘 도착지 좌표는 소수 셋째 자리(약 100m)로 깎아서만 코스에 저장한다
  if (type === "SetEnd" && eventJson.end && typeof eventJson.end === "object") {
    const end = eventJson.end as Record<string, unknown>;
    const at = latLngPair(end.at);
    if (at) eventJson = { ...eventJson, end: { ...end, at } };
  }
  const by = who.phone ? `폰:${who.phone.nickname}` : "차";
  const ev = eventJson;
  // 그날 처음 집을 나선 때 (아직 들른 곳이 없는데 출발) → '그날의 기록' 출발 시각
  const firstOut = type === "Departed" && !row.course!.stops.some((s) => s.status === "ARRIVED" || s.status === "DONE");
  const r = await applyStep(who, row, (eng, course) => eng.engine.apply(course, eventFromJson(ev, course, eng.find), ctx), { retryOnRace: signal, by });
  if (r.ok && firstOut) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(eventJson.now ?? ""));
    if (m) await recordDepart(who.carId, row.day, Number(m[1]) * 60 + Number(m[2]));
  }
  return r;
}

/**
 * 제안 카드 채택. 제안이 지났으면(코스가 바뀜·카드가 넣는 곳에 이미 감·권한 출발 시각이 지남 — 엔진 proposalExpired) 404.
 * nowMin이 없으면 서버 시각(한국), 단 오늘이 아닌 계획(데모 차의 시연 날짜)은 벽시계가 뜻이 없어 제안을 낸 시각.
 */
export async function adoptOption(who: Who, row: CourseRow, version: number, optionIdx: number, nowMin: number | null, ctx: CourseCtx): Promise<ApplyResult> {
  if (version < row.course_version) return conflict(row);
  const proposal = row.course_proposal;
  if (!proposal || !proposal.options[optionIdx]) return { ok: false, status: 404, error: "채택할 제안 카드가 없어요 (이미 바뀌었거나 번호가 틀려요)" };
  const clock = kst(new Date());
  const at = nowMin ?? (row.day === clock.day ? clock.min : proposal.atMin);
  const by = who.phone ? `폰:${who.phone.nickname}` : "차";
  return applyStep(who, row, (eng, course) => {
    const options = proposal.options.map((o) => optionFromJson(o, eng.find));
    const proposed = { ...course, version: proposal.version ?? course.version, nowMin: proposal.atMin };
    const why = eng.engine.proposalExpired(proposed, options, course, at);
    if (why) throw Object.assign(new Error(`제안이 지났어요: ${why}`), { status: 404 });
    return eng.engine.adopt(course, options[optionIdx], at, ctx);
  }, { retryOnRace: false, by });
}

/**
 * '그대로 갈게요' 판정 (DB 없이, 시험용으로 따로): 폰이 본 코스 버전(과 제안 시각)이 지금 저장된 것과 같을 때만 제안을 지운다.
 *   conflict = 그새 코스나 제안이 바뀜 → 409로 최신을 돌려줌 · none = 지울 제안이 없음(이미 지워짐·채택됨) · clear = 지움
 * 엔진 사건(CourseEvent)을 새로 만들지 않는다 — 제안 카드는 코스가 아니라 plans.course_proposal 칸이라 버전도 그대로 둔다.
 */
export function dismissDecision(row: { course_version: number; course_proposal: ProposalJson | null }, version: number, atMin?: number | null): "conflict" | "none" | "clear" {
  if (version !== row.course_version) return "conflict";
  const p = row.course_proposal;
  if (!p || (p.version ?? row.course_version) !== row.course_version) return "none";
  if (atMin != null && p.atMin !== atMin) return "conflict";
  return "clear";
}

/**
 * 제안 카드 거절('그대로 갈게요') — 폰·차 공용. course_proposal만 비우고(코스·버전은 그대로) 다른 가족 폰에 조용한 course_update.
 * 답은 GET과 같은 모양 + dismissed. 지울 제안이 없으면 dismissed:false (이미 다른 폰·차가 정함).
 */
export async function dismissProposal(who: Who, row: CourseRow, version: number, atMin: number | null): Promise<
  | { ok: true; dismissed: boolean; body: Record<string, unknown> }
  | { ok: false; status: number; error: string; course?: CourseJson; version?: number; proposal?: ProposalJson | null }
> {
  const d = dismissDecision(row, version, atMin);
  const fail = (r: CourseRow, msg?: string) => conflict(r, msg) as Extract<ApplyResult, { ok: false }>;
  if (d === "conflict") return fail(row, "코스나 제안이 그새 바뀌었어요. 최신 코스를 보고 다시 정해 주세요");
  let dismissed = false;
  if (d === "clear") {
    const [saved] = await sql<{ id: string }[]>`
      update plans set course_proposal = null where id = ${row.id} and course_version = ${row.course_version} returning id`;
    if (!saved) {
      const latest = await loadCourseRow(who.carId);
      return latest && latest.id === row.id ? fail(latest) : { ok: false, status: 409, error: "코스가 바뀌었어요. 다시 받아 주세요" };
    }
    dismissed = true;
    row = { ...row, course_proposal: null };
  }
  const v = await courseView(who, row);
  const body = { ...courseBody(row), course: v.course, version: v.version, proposal: v.proposal, explain: v.explain, dismissed };
  if (dismissed) {
    // 다른 가족 폰도 제안 카드를 치우게: 코스가 안 바뀐 NoChange(칩 없음 → 알림창 없이 data만)
    const by = who.phone ? `폰:${who.phone.nickname}` : "차";
    await pushCourseUpdate(who, row.id, { kind: "NoChange", course: v.course, change: null, voice: null, explain: v.explain }, by).catch(() => 0);
  }
  return { ok: true, dismissed, body };
}

const TITLES: Record<OutcomeJson["kind"], string> = {
  NoChange: "코스가 갱신됐어요",
  Retimed: "코스 시간표가 바뀌었어요",
  Proposal: "코스 제안이 있어요",
  HomeNow: "바로 집으로 가요",
};

/**
 * 가족 폰에 `course_update` — data.outcome에 답 JSON 전체(문자열)를 실어 앱이 서버를 깨우지 않고 바로 그린다.
 * 칩이 없는 변화(NoChange·QUIET)는 알림창 없이 data만. 보낸 사람(폰)은 뺀다.
 */
async function pushCourseUpdate(who: Who, planId: string, outcome: OutcomeWithExplain, by: string): Promise<number> {
  const change = outcome.change;
  const quiet = outcome.kind === "NoChange" || !change || change.size === "QUIET";
  const text = JSON.stringify(outcome);
  // FCM data는 메시지 전체 4KB 제한 — 넘치면 카드 없이 코스·칩만 싣고 앱이 GET /api/plan/course로 받게 한다
  const fits = Buffer.byteLength(text, "utf8") <= 3600;
  const slim = fits ? text : JSON.stringify({ ...outcome, options: undefined, truncated: true });
  // 바로 가는 곳은 도착지 이름 그대로 ('바로 할머니 집으로 가요')
  const endName = outcome.course.end?.name ?? "집";
  const title = outcome.kind === "HomeNow" ? `바로 ${josa(endName, "으로/로")} 가요` : TITLES[outcome.kind];
  const body = change ? `${change.text}${by === "차" || by === "서버" ? "" : ` · ${by.replace(/^폰:/, "")}`}` : "시간표를 다시 맞췄어요";
  return pushToCar(
    who.carId,
    { title, body, url: "/", tag: "course", silent: quiet },
    { kind: "course_update", planId, version: String(outcome.course.version), by, full: fits ? "1" : "0", outcome: slim },
    { except: who.phone?.id },
  );
}

/** 응답 몸체 (GET·409 공용): 지금 코스 + 버전 + 마지막 제안. */
export function courseBody(row: CourseRow) {
  return { kind: "NoChange" as const, planId: row.id, day: row.day, course: row.course!, version: row.course_version, proposal: row.course_proposal, updatedAt: row.course_updated_at };
}

/**
 * 코스 편집 미리 보기(다녀온 곳이 있는 코스): 남은 곳 순서(Remote) + 오늘만 머무름(SetDwell)을 메모리에서만 적용한 코스.
 * 폰이 '적용'하면 같은 사건을 PATCH /api/plan/course로 차례로 보낸다 — 여기선 저장·알림 없음. 사건이 틀리면 Error(한글 이유).
 */
export function simulateEdit(eng: Engine, row: { day: string; course: CourseJson | null }, stops: string[], dwell: Record<string, number>, by: string): CourseJson {
  if (!row.course) throw new Error("오늘 고른 코스가 없어요");
  eng = withCourseExt(eng, row);
  let course = courseFromJson(row.course, eng.find);
  const nowMin = nowFor(row, course);
  const now = `${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`;
  const step = (m: Record<string, unknown>) => { course = eng.engine.apply(course, eventFromJson({ now, ...m }, course, eng.find)).course; };
  step({ type: "Remote", version: course.version + 1, stops, by });
  for (const [place, minutes] of Object.entries(dwell)) {
    const s = course.stops.find((x) => x.place.id === place);
    if (s && (s.status === "PLANNED" || s.status === "NEXT") && (s.dwellGuessMin !== minutes || !s.dwellSet)) step({ type: "SetDwell", place, minutes });
  }
  const out = withDwellSources(courseToJson(course), eng);
  decorateStops(out.stops, eng.find);
  return out;
}
