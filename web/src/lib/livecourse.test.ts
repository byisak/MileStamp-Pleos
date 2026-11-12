/*
 * 살아 있는 코스 시험 사례 — 엔진과 같은 파일 `engine/src/test/resources/plan-live-cases.json`을 읽어
 * 코틀린 LiveCourseCasesTest가 박아 둔 결과(종류·남은 곳·귀가·칩·음성·카드 제목·계수…)와 한 글자까지 같은지 본다.
 * 파일 모양은 LiveCourseCasesTest.kt 맨 위 설명 참고. 장소표는 plan-cases.json의 "places". 실행: `npm test`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asHhmm, course as courseOption, hhmm, limitMin, morning,
  type AirLevel, type CrowdDwell, type FamilyProfile, type PlaceDwell, type Place, type Sky, type SkyToday,
} from "./planner";
import {
  CHIP_MAX, endNameOf, LiveCourseEngine, courseFromJson, courseToJson, ctxFromJson, eventFromJson, fromOption, outcomeToJson,
  remainingOf, slackMin, type LiveCourse, type Outcome,
} from "./livecourse";

const here = dirname(fileURLToPath(import.meta.url));
const resources = join(here, "../../../engine/src/test/resources");
const root = JSON.parse(readFileSync(join(resources, "plan-live-cases.json"), "utf8"));
const placesRoot = JSON.parse(readFileSync(join(resources, root.placesFrom ?? "plan-cases.json"), "utf8"));

type PlaceJson = {
  id: string; name: string; lat: number; lng: number; indoor: boolean; dwell: number; kidFit: number;
  open: string; close: string; popular: number; stampable: boolean;
};
const clock = (t: string) => (t === "24:00" ? 24 * 60 : hhmm(t));
const places: Place[] = (placesRoot.places as PlaceJson[]).map((m) => ({
  id: m.id, name: m.name, at: { lat: m.lat, lng: m.lng }, indoor: m.indoor, dwellP80Min: m.dwell, kidFit: m.kidFit,
  openMin: clock(m.open), closeMin: clock(m.close), popular: m.popular, stampable: m.stampable,
}));
const byId = new Map(places.map((p) => [p.id, p]));
const find = (id: string) => byId.get(id) ?? null;
const place = (id: string) => {
  const p = byId.get(id);
  if (!p) throw new Error(`장소 없음: ${id}`);
  return p;
};

const latLng = (v: unknown) => {
  const [lat, lng] = v as number[];
  return { lat, lng };
};

function profile(m: Record<string, unknown>): FamilyProfile {
  const nap = (m.nap as string[] | null | undefined)?.map(hhmm) ?? [0, 0];
  const back = (m.backBy as string | undefined) ?? "sunset-30";
  let backBy: FamilyProfile["backBy"];
  if (back.startsWith("sunset-")) backBy = { sunsetMinus: Number(back.slice(7)) };
  else if (back.startsWith("at:")) backBy = { at: hhmm(back.slice(3)) };
  else throw new Error(`backBy: ${back}`);
  return {
    home: latLng(m.home),
    napStartMin: nap[0],
    napEndMin: nap[1],
    backBy,
    dinnerMin: "dinner" in m ? (m.dinner == null ? null : hhmm(m.dinner as string)) : 18 * 60 + 30,
    kidAges: (m.kidAges as number[] | undefined) ?? [4, 4],
    dwellFactor: (m.dwellFactor as number | undefined) ?? 1.0,
    dwellN: (m.dwellN as number | undefined) ?? 0,
    placeDwell: (m.placeDwell as Record<string, PlaceDwell> | undefined) ?? {},
    crowdDwell: (m.crowdDwell as Record<string, CrowdDwell> | undefined) ?? {},
  };
}

function sky(s: Record<string, string | null> | null | undefined): SkyToday | null {
  if (!s) return null;
  return {
    sunriseMin: s.sunrise ? hhmm(s.sunrise) : null,
    sunsetMin: s.sunset ? hhmm(s.sunset) : null,
    sky: ((s.sky as Sky | null) ?? "UNKNOWN"),
    rainFromMin: s.rainFrom ? hhmm(s.rainFrom) : null,
    air: (s.air as AirLevel | null | undefined) ?? null,
  };
}

const base = root.base as Record<string, unknown>;
const profBase = profile(base.profile as Record<string, unknown>);
const prof = profBase;
/** 사례마다 가족 값 덮어쓰기 ("profile": {dwellFactor·placeDwell·crowdDwell …}). */
const caseProfile = (c: Record<string, unknown> | null) =>
  c?.profile ? profile({ ...(base.profile as Record<string, unknown>), ...(c.profile as Record<string, unknown>) }) : profBase;
const skyToday = sky(base.sky as Record<string, string | null>);
/** 사례마다 하늘 덮어쓰기 ("sky": {air …}). */
const caseSky = (c: Record<string, unknown> | null) =>
  c?.sky ? sky({ ...(base.sky as Record<string, string | null>), ...(c.sky as Record<string, string | null>) }) : skyToday;

/** 기준 하루의 코스: course()로 짠 카드 → 살아 있는 코스 (코틀린 테스트 baseCourse와 같은 길). */
function baseCourse(prof: FamilyProfile = profBase, skyToday: SkyToday | null = caseSky(null)): LiveCourse {
  const now = hhmm(base.now as string);
  const at = latLng(base.here);
  const stops = (base.course as string[]).map(place);
  const option = courseOption(now, at, prof, stops, skyToday);
  assert.ok(option, "기준 코스가 규칙에 안 맞음");
  return fromOption(option, { backByMin: limitMin("MORNING", prof, skyToday), sky: skyToday }, base.chosenBy as string, now, at, prof);
}

function describe(name: string, o: Outcome | null, c: LiveCourse): string {
  let s = `── ${name}: ${o?.kind ?? "-"} v${c.version} 귀가 ${asHhmm(c.arriveHomeMin)} 한계 ${asHhmm(c.limitMin)} 여유 ${slackMin(c)}분`;
  s += ` 계수 ${c.roadFactor} 머무름×${c.dwellScale}${c.napTaken ? " 낮잠끝" : ""}\n`;
  s += "   장소 " + c.stops.map((x) => `${x.place.name}[${x.status} ${asHhmm(x.plannedArriveMin)}-${asHhmm(x.plannedDepartMin)} ${x.dwellGuessMin}분]`).join(" → ") + "\n";
  s += "   막대 " + c.legs.map((l) => `${l.kind}${l.placeId ? `:${l.placeId}` : ""} ${asHhmm(l.fromMin)}-${asHhmm(l.toMin)}`).join(" ") + "\n";
  if (c.warnings.length) s += "   경고 " + c.warnings.join(" | ") + "\n";
  if (o?.change) s += `   칩(${o.change.size} ${o.change.cause} ${o.change.deltaHomeMin}분) ${o.change.text}\n`;
  if (o?.voice) s += `   음성 ${o.voice}\n`;
  if (o?.kind === "Proposal") for (const x of o.options) {
    s += `   [${x.label}] ${x.stops.map((p) => p.name).join(" → ") || "집"} · 귀가 ${asHhmm(x.arriveHomeMin)} · ${x.reasons.map((r) => r.text).join(" | ")}\n`;
  }
  return s;
}

function run(events: Record<string, unknown>[], prof: FamilyProfile = profBase, sk: SkyToday | null = skyToday) {
  const engine = new LiveCourseEngine(prof, places);
  let course = baseCourse(prof, sk);
  let outcome: Outcome | null = null;
  let proposal: Extract<Outcome, { kind: "Proposal" }> | null = null;
  let lastNow = 0;
  for (const m of events) {
    outcome = engine.apply(course, eventFromJson(m, course, find), ctxFromJson(m));
    course = outcome.course;
    lastNow = hhmm(m.now as string);
    if (outcome.kind === "Proposal") proposal = outcome;
  }
  return { engine, outcome, course, proposal, lastNow };
}

test("기준 코스", () => {
  const c = baseCourse();
  console.log(describe("기준", null, c));
  assert.deepEqual(remainingOf(c).map((s) => s.place.id), ["seokgul", "samguk", "dgsm"]);
  assert.equal(c.arriveHomeMin, hhmm("16:47"));
  assert.equal(c.limitMin, hhmm("17:02"));
  assert.equal(c.version, 1);
  assert.ok(c.legs.some((l) => l.kind === "NAP_DRIVE" && l.placeId === "dgsm"));
});

const cases = root.cases as Record<string, unknown>[];
assert.ok(cases.length >= 12);

for (const c of cases) {
  test(`시험 사례: ${c.name}`, () => {
    const name = c.name as string;
    const { engine, outcome: o, course, proposal, lastNow } = run(c.events as Record<string, unknown>[], caseProfile(c), caseSky(c));
    assert.ok(o, `${name}: 사건이 없음`);
    const text = describe(name, o, course);
    console.log(text);
    const e = c.expect as Record<string, unknown>;
    const msg = `[${name}]\n${text}`;
    const last = (id: string) => [...course.stops].reverse().find((s) => s.place.id === id)!;
    if (e.kind != null) assert.equal(o.kind, e.kind, msg);
    if (e.remaining != null) assert.deepEqual(remainingOf(course).map((s) => s.place.id), e.remaining, msg);
    for (const [id, st] of Object.entries((e.status as Record<string, string>) ?? {})) assert.equal(last(id).status, st, `${msg}\n${id} 상태`);
    if (e.arriveHome != null) assert.equal(asHhmm(course.arriveHomeMin), e.arriveHome, msg);
    if (e.slack != null) assert.equal(slackMin(course), e.slack, msg);
    if (e.version != null) assert.equal(course.version, e.version, msg);
    if (e.chip != null) assert.equal(o.change?.text, e.chip, msg);
    if (e.voice != null) assert.equal(o.voice, e.voice, msg);
    if (e.size != null) assert.equal(o.change?.size, e.size, msg);
    if (e.cause != null) assert.equal(o.change?.cause, e.cause, msg);
    if (e.deltaHome != null) assert.equal(o.change?.deltaHomeMin, e.deltaHome, msg);
    const options = o.kind === "Proposal" ? o.options : [];
    if (e.labels != null) assert.deepEqual(options.map((x) => x.label), e.labels, msg);
    if (e.optionStops != null) assert.deepEqual(options.map((x) => x.stops.map((p) => p.id)), e.optionStops, msg);
    if (e.optionArriveHome != null) assert.deepEqual(options.map((x) => asHhmm(x.arriveHomeMin)), e.optionArriveHome, msg);
    if (e.napDrive != null) assert.equal(course.napLeg != null, e.napDrive, msg);
    if (e.roadFactor != null) assert.ok(Math.abs(course.roadFactor - (e.roadFactor as number)) < 0.001, `${msg}\n계수 ${course.roadFactor} ≠ ${e.roadFactor}`);
    if (e.dwellScale != null) assert.ok(Math.abs(course.dwellScale - (e.dwellScale as number)) < 0.001, `${msg}\n머무름 배율 ${course.dwellScale} ≠ ${e.dwellScale}`);
    if (e.dwellSet != null) assert.deepEqual(course.stops.filter((s) => s.dwellSet).map((s) => s.place.id), e.dwellSet, msg);
    for (const [id, d] of Object.entries((e.dwell as Record<string, number>) ?? {})) assert.equal(last(id).dwellGuessMin, d, `${msg}\n${id} 머무름`);
    if (e.warnings != null) assert.deepEqual(course.warnings, e.warnings, msg);
    if (e.end != null) assert.equal(endNameOf(course), e.end, msg);
    if (e.limit != null) assert.equal(asHhmm(course.limitMin), e.limit, msg);
    if ("proposalExpired" in e) {
      assert.ok(proposal, `${msg}\n제안이 없음`);
      const chk = c.check as { at?: string; visited?: string[] } | undefined;
      const at = chk?.at ? hhmm(chk.at) : lastNow;
      const expired = engine.proposalExpired(proposal.course, proposal.options, course, at, new Set(chk?.visited ?? []));
      assert.equal(expired, e.proposalExpired, `${msg}\n제안 지남 (${asHhmm(at)})`);
    }
    if (e.explain != null) {
      const x = e.explain as { headline: string; body: string; action: string | null; home?: string };
      const chk = c.check as { explainAt?: string } | undefined;
      const at = chk?.explainAt ? hhmm(chk.explainAt) : lastNow;
      const ex = engine.explain(course, at, options, skyToday?.sunsetMin ?? null);
      console.log(`   설명(${asHhmm(at)}) ${ex.headline} / ${ex.body} / ${ex.action} ${ex.homeMin != null ? asHhmm(ex.homeMin) : ""}`);
      assert.equal(ex.headline, x.headline, `${msg}\n설명 제목`);
      assert.equal(ex.body, x.body, `${msg}\n설명 본문`);
      assert.equal(ex.action, x.action, `${msg}\n설명 할 일`);
      if (x.home != null) assert.equal(ex.homeMin != null ? asHhmm(ex.homeMin) : null, x.home, `${msg}\n설명 귀가`);
    }
    if (o.change) assert.ok(o.change.text.length <= CHIP_MAX, `${msg}\n칩 40자 초과`);
    // 어느 사례든: 시간표는 지금부터 귀가까지 이어지고, 제안 카드는 모두 한계 안
    assert.equal(course.legs[course.legs.length - 1].toMin, course.arriveHomeMin, msg);
    for (let i = 1; i < course.legs.length; i++) assert.equal(course.legs[i - 1].toMin, course.legs[i].fromMin, msg);
    for (const x of options) assert.ok(x.arriveHomeMin <= course.limitMin, `${msg}\n카드 ${x.label} 한계 넘음`);

    // JSON으로 저장했다 읽어도 같은 코스 (서버가 plans.course에 넣는 모양)
    const json = JSON.parse(JSON.stringify(outcomeToJson(o)));
    assert.deepEqual(courseFromJson(json.course, find), course, `${msg}\nJSON 왕복이 다름`);
    assert.equal(json.kind, o.kind);
    assert.equal(json.course.slackMin, slackMin(course));
    if (o.kind === "Proposal") assert.deepEqual(json.options.map((x: { label: string }) => x.label), options.map((x) => x.label));
    else assert.equal(json.options, undefined);
  });
}

test("성능 - 아침 완전탐색 100ms, 사건 하나 20ms", () => {
  const perf = root.perf as Record<string, unknown>;
  const searchMax = perf.morningSearchMaxMs as number;
  const eventMax = perf.eventMaxMs as number;
  const now = hhmm(base.now as string);
  const at = latLng(base.here);
  const ms = (f: () => void) => {
    const t0 = process.hrtime.bigint();
    f();
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  for (let i = 0; i < 3; i++) morning(now, at, prof, places, skyToday);
  const search = Array.from({ length: 5 }, () => ms(() => morning(now, at, prof, places, skyToday))).sort((a, b) => a - b)[2];
  console.log(`아침 완전탐색 ${places.length}곳: 중앙값 ${search.toFixed(1)}ms`);
  assert.ok(search <= searchMax, `아침 완전탐색 ${search}ms > ${searchMax}ms`);

  const events = perf.events as Record<string, unknown>[];
  const one = () => {
    const engine = new LiveCourseEngine(prof, places);
    let course = baseCourse();
    return events.map((m) => {
      let out: Outcome | null = null;
      const t = ms(() => { out = engine.apply(course, eventFromJson(m, course, find), ctxFromJson(m)); });
      course = out!.course;
      return t;
    });
  };
  for (let i = 0; i < 3; i++) one();
  const runs = Array.from({ length: 5 }, one);
  const worst = Math.max(...events.map((_, i) => runs.map((r) => r[i]).sort((a, b) => a - b)[2]));
  console.log(`사건 ${events.length}개 연속: 사건마다 중앙값 최대 ${worst.toFixed(1)}ms`);
  assert.ok(worst <= eventMax, `사건 처리 ${worst}ms > ${eventMax}ms`);
});

test("JSON 사건 모양이 틀리면 한글 이유로 거절", () => {
  const c = baseCourse();
  assert.throws(() => eventFromJson({ type: "Arrived", now: "09:00", place: "없는곳" }, c, find), /모르는 장소/);
  assert.throws(() => eventFromJson({ type: "Departed" }, c, find), /now/);
  assert.throws(() => eventFromJson({ type: "뭐", now: "09:00" }, c, find), /모르는 사건/);
  assert.throws(() => ctxFromJson({ here: [1] }), /here/);
  assert.throws(() => eventFromJson({ type: "StillDriving", now: "09:00" }, c, find), /here/);
  assert.deepEqual(eventFromJson({ type: "StillDriving", now: "08:57", here: [35.9, 128.6] }, c, find), { type: "StillDriving", nowMin: 537, here: { lat: 35.9, lng: 128.6 } });
  assert.equal(courseToJson(c).version, 1);
  // SetEnd: end는 {name, at} 또는 "home", 이름 20자 이내, at은 [위도, 경도]
  assert.throws(() => eventFromJson({ type: "SetEnd", now: "09:00", end: { name: "할머니 집" } }, c, find), /end\.at/);
  assert.throws(() => eventFromJson({ type: "SetEnd", now: "09:00", end: { name: "", at: [35.8, 128.5] } }, c, find), /end\.name/);
  assert.throws(() => eventFromJson({ type: "SetEnd", now: "09:00", napOff: "yes" }, c, find), /napOff/);
  assert.throws(() => eventFromJson({ type: "SetDwell", now: "09:00", place: "dgsm" }, c, find), /minutes/);
  assert.throws(() => eventFromJson({ type: "SetDwell", now: "09:00", place: "없는곳", minutes: 60 }, c, find), /모르는 장소/);
  assert.throws(() => eventFromJson({ type: "ExtendStay", now: "09:00", minutes: -5 }, c, find), /minutes/);
  assert.deepEqual(eventFromJson({ type: "SetDwell", now: "08:30", place: "dgsm", minutes: 90 }, c, find), { type: "SetDwell", nowMin: 510, placeId: "dgsm", minutes: 90 });
  assert.deepEqual(eventFromJson({ type: "ExtendStay", now: "12:00", minutes: 30 }, c, find), { type: "ExtendStay", nowMin: 720, minutes: 30 });
  assert.deepEqual(eventFromJson({ type: "SetEnd", now: "08:30", end: "home", limit: "19:00" }, c, find),
    { type: "SetEnd", nowMin: 510, end: null, toHome: true, limitMin: 1140, napOff: null });
});
