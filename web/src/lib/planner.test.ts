/*
 * 추천 시험 사례 — 엔진과 같은 파일 `engine/src/test/resources/plan-cases.json`을 읽어
 * 코틀린 PlanCasesTest가 박아 둔 결과(카드 제목·들르는 곳·집 도착·카드마다 이유 칩)와 한 글자까지 같은지 본다.
 * 파일 모양은 PlanCasesTest.kt 맨 위 설명 참고. 실행: `npm test`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asHhmm, firstBoarding, hhmm, rainStartMin, reboard, course, defaultProfile, TravelTime,
  dwellEstimate, dwellSourceText, learnDwell, anchored, explainChoice, isNight, pickOf, parseCompanion, isMealPlace, legJson, legOfJson,
  MEAL_DINNER, MEAL_LUNCH, TimeBudget,
  type AirLevel, type Restaurant, type Companion, type CrowdDwell, type DwellStats, type FamilyProfile, type FestivalInfo, type PlaceDwell, type Place, type Plan, type Sky, type SkyToday,
} from "./planner";

const here = dirname(fileURLToPath(import.meta.url));
const root = JSON.parse(readFileSync(join(here, "../../../engine/src/test/resources/plan-cases.json"), "utf8"));
const seed = JSON.parse(readFileSync(join(here, "../../db/places.seed.json"), "utf8")) as Record<string, unknown>[];

type PlaceJson = {
  id: string; name: string; lat: number; lng: number; indoor: boolean; dwell: number; kidFit: number;
  open: string; close: string; popular: number; stampable: boolean;
  /** 동행별 적합도·분위기 표시·어른 머무름 (선택 — placeFit 표가 붙여 준다) */
  fit?: Partial<Record<"couple" | "friends" | "solo", number>>; tags?: string[]; adultDwell?: number | null;
  /** 쉬는 요일(0=일)·임시 휴무 날짜 (선택 — placeOverrides로) */
  closedDays?: number[]; closedDates?: string[];
  /** 운영 시간 줄 (선택 — placeOverrides로) */
  hours?: { days?: number[]; holiday?: boolean; open: string; close: string; lastEntry?: string | null; validFrom?: string | null; validTo?: string | null }[];
  /** 저녁 나들이 칸 (선택 — placeOverrides로): 종류·드라이브 길·시간 특성·저녁 어울림 */
  kind?: string; route?: { points: number[][]; passMin: number } | null;
  moments?: { best?: string[]; lightOn?: string | null; shows?: { name: string; times: string[]; days?: number[]; months?: number[] }[] } | null;
  fitEvening?: Partial<Record<"kids" | "couple" | "friends" | "solo", number>> | null;
};

/** 장소 시각: "24:00" = 자정(상시 개방의 닫는 시각)도 받는다. */
const clock = (t: string) => (t === "24:00" ? 24 * 60 : hhmm(t));

function place(m: PlaceJson): Place {
  return {
    id: m.id, name: m.name, at: { lat: m.lat, lng: m.lng }, indoor: m.indoor, dwellP80Min: m.dwell, kidFit: m.kidFit,
    openMin: clock(m.open), closeMin: clock(m.close), popular: m.popular, stampable: m.stampable,
    ...(m.fit ? { fit: m.fit } : {}), ...(m.tags ? { tags: m.tags } : {}), ...(m.adultDwell != null ? { adultDwellMin: m.adultDwell } : {}),
    ...(m.closedDays ? { closedDays: m.closedDays } : {}), ...(m.closedDates ? { closedDates: m.closedDates } : {}),
    ...(m.hours?.length ? {
      hours: m.hours.map((h) => ({
        days: h.days ?? [], holiday: !!h.holiday, openMin: clock(h.open), closeMin: clock(h.close),
        lastEntryMin: h.lastEntry ? clock(h.lastEntry) : null, breaks: [], validFrom: h.validFrom ?? null, validTo: h.validTo ?? null, note: null,
      })),
    } : {}),
    ...(m.kind ? { kind: m.kind } : {}),
    ...(m.route ? { route: { points: m.route.points.map(([lat, lng]) => ({ lat, lng })), passMin: m.route.passMin } } : {}),
    ...(m.moments ? {
      moments: {
        best: m.moments.best ?? [], lightOn: m.moments.lightOn ?? null,
        shows: (m.moments.shows ?? []).map((x) => ({ name: x.name, times: x.times.map(hhmm).sort((a, b) => a - b), days: x.days ?? [], months: x.months ?? [] })),
      },
    } : {}),
    ...(m.fitEvening ? { fitEvening: m.fitEvening } : {}),
  };
}

/** 동행별 적합도·분위기 표시 (plan-cases.json "placeFit") — 모든 사례의 장소에 붙는다 (PlanCasesTest와 같음). */
const placeFit = (root.placeFit ?? {}) as Record<string, Partial<PlaceJson>>;

const placesJson = new Map<string, PlaceJson>((root.places as PlaceJson[]).map((p) => [p.id, { ...p, ...(placeFit[p.id] ?? {}) }]));
/** 기간 한정 축제 (사례가 "festivals"로 부를 때만 후보에) — 장소 칸 + festival */
type FestivalJson = PlaceJson & { festival: Omit<FestivalInfo, "id"> };
const festivalsJson = new Map<string, FestivalJson>(((root.festivals ?? []) as FestivalJson[]).map((p) => [p.id, p]));

function profile(m: Record<string, unknown>): FamilyProfile {
  const nap = (m.nap as string[] | null | undefined)?.map(hhmm) ?? [0, 0];
  const back = (m.backBy as string | undefined) ?? "sunset-30";
  const [lat, lng] = m.home as number[];
  return {
    home: { lat, lng },
    napStartMin: nap[0],
    napEndMin: nap[1],
    backBy: back.startsWith("sunset-") ? { sunsetMinus: Number(back.slice(7)) } : { at: hhmm(back.slice(3)) },
    dinnerMin: "dinner" in m ? (m.dinner == null ? null : hhmm(m.dinner as string)) : 18 * 60 + 30,
    kidAges: (m.kidAges as number[] | undefined) ?? [4, 4],
    dwellFactor: (m.dwellFactor as number | undefined) ?? 1.0,
    dwellN: (m.dwellN as number | undefined) ?? 0,
    placeDwell: (m.placeDwell as Record<string, PlaceDwell> | undefined) ?? {},
    crowdDwell: (m.crowdDwell as Record<string, CrowdDwell> | undefined) ?? {},
    history: m.history
      ? (() => {
          const h = m.history as { stamped?: string[]; lastVisitDays?: Record<string, number>; favorites?: string[] };
          return { stamped: h.stamped ?? [], lastVisitDays: h.lastVisitDays ?? {}, favorites: h.favorites ?? [] };
        })()
      : null,
    companion: parseCompanion(m.companion) ?? "kids",
    ...(m.bedtime ? { bedtimeMin: hhmm(m.bedtime as string) } : {}),
    ...(m.lateReturn ? { lateReturnMin: hhmm(m.lateReturn as string) } : {}),
  };
}

/** 사례 공통 입력 (cases·anchor·explain) — PlanCasesTest.input과 같다. */
function input(c: Record<string, unknown>) {
  const now = hhmm(c.now as string);
  const [lat, lng] = c.here as number[];
  const s = c.sky as Record<string, string | null> | null;
  const sky: SkyToday | null = s
    ? {
        sunriseMin: s.sunrise ? hhmm(s.sunrise) : null, sunsetMin: s.sunset ? hhmm(s.sunset) : null,
        sky: ((s.sky as Sky | null) ?? "UNKNOWN"), rainFromMin: s.rainFrom ? hhmm(s.rainFrom) : null,
        air: (s.air as AirLevel | null) ?? null, pm10: (s.pm10 as unknown as number | null) ?? null, pm25: (s.pm25 as unknown as number | null) ?? null,
        tempC: (s.temp as unknown as number | null) ?? null,
      }
    : null;
  const overrides = (c.placeOverrides ?? {}) as Record<string, Partial<PlaceJson>>;
  const table = new Map<string, Place>([...placesJson].map(([id, p]) => [id, place({ ...p, ...(overrides[id] ?? {}) })]));
  const candidates = c.candidates === "all" ? [...table.values()] : (c.candidates as string[]).map((id) => table.get(id)!);
  for (const id of (c.festivals ?? []) as string[]) candidates.push(festivalPlace(id));
  return { now, here: { lat, lng }, profile: profile(c.profile as Record<string, unknown>), sky, table, candidates, day: (c.day ?? null) as string | null };
}

function festivalPlace(id: string): Place {
  const m = festivalsJson.get(id)!;
  const f = m.festival;
  return { ...place(m), festival: { id, starts: f.starts, ends: f.ends, weight: f.weight, placeId: f.placeId ?? null, closedDays: f.closedDays ?? [] } };
}

function describe(name: string, p: Plan): string {
  let s = `── ${name}: ${p.mode} 한계 ${asHhmm(p.backByMin)} 여유 ${p.budgetMin}분\n`;
  for (const o of p.options) {
    s += `   [${o.label}] ${o.stops.map((x) => x.name).join(" → ") || "집"} · 귀가 ${asHhmm(o.arriveHomeMin)}\n`;
    s += "      " + o.legs.map((l) => `${l.kind}${l.placeId ? `:${l.placeId}` : ""} ${asHhmm(l.fromMin)}-${asHhmm(l.toMin)}`).join(" ") + "\n";
    s += "      " + o.reasons.map((r) => r.text).join(" | ") + "\n";
  }
  return s;
}

for (const c of root.cases as Record<string, unknown>[]) {
  test(`시험 사례: ${c.name}`, () => {
    const name = c.name as string;
    const now = hhmm(c.now as string);
    const [lat, lng] = c.here as number[];
    const hereAt = { lat, lng };
    const prof = profile(c.profile as Record<string, unknown>);
    const s = c.sky as Record<string, string | null> | null;
    const sky: SkyToday | null = s
      ? {
          sunriseMin: s.sunrise ? hhmm(s.sunrise) : null,
          sunsetMin: s.sunset ? hhmm(s.sunset) : null,
          sky: ((s.sky as Sky | null) ?? "UNKNOWN"),
          rainFromMin: s.rainFrom ? hhmm(s.rainFrom) : null,
          air: (s.air as AirLevel | null) ?? null,
          pm10: (s.pm10 as unknown as number | null) ?? null,
          pm25: (s.pm25 as unknown as number | null) ?? null,
          tempC: (s.temp as unknown as number | null) ?? null,
        }
      : null;
    const overrides = (c.placeOverrides ?? {}) as Record<string, Partial<PlaceJson>>;
    const table = new Map<string, Place>([...placesJson].map(([id, p]) => [id, place({ ...p, ...(overrides[id] ?? {}) })]));
    const candidates = c.candidates === "all" ? [...table.values()] : (c.candidates as string[]).map((id) => table.get(id)!);

    const festOver = (c.festivalOverrides ?? {}) as Record<string, Partial<FestivalInfo>>;
    for (const id of (c.festivals ?? []) as string[]) {
      const m = festivalsJson.get(id)!;
      const f = { ...m.festival, ...(festOver[id] ?? {}) };
      candidates.push({ ...place(m), festival: { id, starts: f.starts, ends: f.ends, weight: f.weight, placeId: f.placeId ?? null, closedDays: f.closedDays ?? [] } });
    }
    const day = (c.day ?? null) as string | null;
    let plan: Plan;
    if (c.call === "first") plan = firstBoarding(now, hereAt, prof, candidates, sky, day, (c.maxStops as number | undefined) ?? 3);
    else if (c.call === "reboard") plan = reboard(now, hereAt, prof, candidates, sky, day);
    else throw new Error(`call: ${c.call}`);
    const msg = `[${name}]\n${describe(name, plan)}`;
    console.log(describe(name, plan));

    const e = c.expect as Record<string, unknown>;
    const withStops = plan.options.filter((o) => o.stops.length > 0);
    if (e.mode != null) assert.equal(plan.mode, e.mode, msg);
    if (e.options != null) assert.equal(plan.options.length, e.options, msg);
    if (e.limit != null) assert.equal(plan.backByMin, hhmm(e.limit as string), msg);
    if (e.budget != null) assert.equal(plan.budgetMin, e.budget, msg);
    if (e.labels != null) assert.deepEqual(plan.options.map((o) => o.label), e.labels, msg);
    if (e.stops != null) assert.deepEqual(plan.options.map((o) => o.stops.map((p) => p.id)), e.stops, msg);
    if (e.bestReasons != null) assert.deepEqual(plan.options[0].reasons.map((r) => r.text), e.bestReasons, msg);
    if (e.reasons != null) assert.deepEqual(plan.options.map((o) => o.reasons.map((r) => r.text)), e.reasons, msg);
    if (e.arriveHome != null) assert.deepEqual(plan.options.map((o) => asHhmm(o.arriveHomeMin)), e.arriveHome, msg);
    if (e.homeByLimit === true) for (const o of withStops) assert.ok(o.arriveHomeMin <= plan.backByMin, msg);
    if (e.homeBy != null) for (const o of plan.options) assert.ok(o.arriveHomeMin <= hhmm(e.homeBy as string), msg);
    if (e.bestHasNapDrive === true) assert.ok(plan.options[0].legs.some((l) => l.kind === "NAP_DRIVE"), msg);
    if (e.allIndoor === true) {
      assert.ok(withStops.length > 0, msg);
      for (const o of withStops) assert.ok(o.stops.every((p) => p.indoor), msg);
    }
    if (e.noOutdoorInRain === true) {
      const rain = rainStartMin(sky, now)!;
      for (const o of withStops) for (const l of o.legs.filter((l) => l.kind === "STAY")) {
        if (!table.get(l.placeId!)!.indoor) assert.ok(l.toMin <= rain, msg);
      }
    }
    if (e.hasGoHome === true) assert.ok(plan.options.some((o) => o.kind === "GO_HOME"), msg);
    if (e.onlyGoHome === true) assert.deepEqual(plan.options.map((o) => o.kind), ["GO_HOME"], msg);
    if (e.hasStop != null) assert.ok(plan.options.some((o) => o.stops.some((p) => p.id === e.hasStop)), msg);
    if (e.noStop != null) assert.ok(plan.options.every((o) => o.stops.every((p) => p.id !== e.noStop)), msg);
    if (e.picks != null) assert.deepEqual(plan.options.map((o) => pickOf(o)), e.picks, msg);
    if (e.night != null) assert.equal(isNight(now, prof, sky), e.night, msg);
    if (e.evening != null) assert.equal(plan.evening === true, e.evening, msg);
    if ("sunsetTip" in e) assert.equal(plan.sunsetTip ? `${plan.sunsetTip.placeId}@${asHhmm(plan.sunsetTip.arriveByMin)}` : null, e.sunsetTip, msg);
    if (e.reasons != null && (c.festivals as string[] | undefined)?.length) {
      // 축제 칩은 FESTIVAL 색 (차·폰이 색으로 아이콘을 고름)
      for (const o of plan.options) for (const r of o.reasons) if (r.text.startsWith("이번 주말만")) assert.equal(r.tone, "FESTIVAL", msg);
    }

    // 어느 사례든: 하루 막대는 지금부터 귀가까지 빈틈없이 이어지고, 카드마다 이유 칩이 있다
    for (const o of plan.options) {
      assert.ok(o.reasons.length > 0, `${msg}\n칩 없는 카드: ${o.label}`);
      assert.equal(o.legs[0].fromMin, now, msg);
      assert.equal(o.legs[o.legs.length - 1].toMin, o.arriveHomeMin, msg);
      for (let i = 1; i < o.legs.length; i++) assert.equal(o.legs[i - 1].toMin, o.legs[i].fromMin, msg);
    }
    // '가깝게' 카드는 코스 전체가 가깝다: 모든 장소가 집·출발지에서 30분 안, 어느 이동도 30분 이하
    for (const o of plan.options.filter((o) => o.label.startsWith("가깝게"))) {
      for (const l of o.legs) if (l.kind !== "STAY") assert.ok(l.toMin - l.fromMin <= 30, msg);
      for (const p of o.stops) assert.ok(Math.min(TravelTime.minutes(prof.home, p.at), TravelTime.minutes(hereAt, p.at)) <= 30, msg);
    }
  });
}

test("정한 순서 코스(course): 1순위 코스를 그대로 넣으면 같은 시간표", () => {
  const places = new Map([...placesJson].map(([id, p]) => [id, place(p)]));
  const home = { lat: 35.8858, lng: 128.5828 };
  const sky: SkyToday = { sunriseMin: hhmm("06:54"), sunsetMin: hhmm("17:41"), sky: "CLEAR", rainFromMin: hhmm("15:00") };
  const prof = defaultProfile(home);
  const plan = firstBoarding(hhmm("08:30"), home, prof, [...places.values()], sky);
  const best = plan.options[0];
  const o = course(hhmm("08:30"), home, prof, best.stops, sky, "폰에서 고른 코스")!;
  assert.equal(o.label, "폰에서 고른 코스");
  assert.equal(o.arriveHomeMin, best.arriveHomeMin);
  assert.deepEqual(o.legs, best.legs);
  assert.deepEqual(o.reasons, best.reasons);
  // 문 닫는 시각을 넘기는 순서는 null
  assert.equal(course(hhmm("16:50"), home, prof, [places.get("hahoe")!], sky), null);
});

test("장소 씨앗(places.seed.json)은 시험 사례 장소표(= 엔진 SeedPlaces)와 값이 같다", () => {
  const byId = new Map(seed.map((p) => [p.id as string, p]));
  for (const [id, p] of placesJson) {
    const s = byId.get(id);
    assert.ok(s, `씨앗에 ${id}가 없음`);
    for (const k of ["name", "lat", "lng", "indoor", "dwell", "kidFit", "open", "close", "popular", "stampable"] as const) {
      assert.deepEqual(s[k], p[k], `${id}.${k}`);
    }
  }
});

// ---- 머무는 시간: 조사값 → 또래 → 우리 가족 층, EMA 배우기 (PlanCasesTest와 같은 사례) ----

const placeById = new Map((root.places as PlaceJson[]).map((p) => [p.id, place(p)]));

for (const c of (root.dwellEstimate ?? []) as Record<string, unknown>[]) {
  test(`머무름 층: ${c.name}`, () => {
    const prof = profile({ home: [35.8858, 128.5828], ...(c.profile as Record<string, unknown>) });
    const est = dwellEstimate(prof, placeById.get(c.place as string)!);
    const e = c.expect as { minutes: number; source: string; text: string };
    const msg = `[${c.name}] ${est.minutes}분 ${est.source} ${dwellSourceText(est)}`;
    assert.equal(est.minutes, e.minutes, msg);
    assert.equal(est.source, e.source, msg);
    assert.equal(dwellSourceText(est), e.text, msg);
  });
}

for (const c of (root.dwellLearn ?? []) as Record<string, unknown>[]) {
  test(`머무름 배우기: ${c.name}`, () => {
    const stats = (m: Record<string, unknown>): DwellStats => ({ factor: m.factor as number, n: m.n as number, places: (m.places as Record<string, PlaceDwell>) ?? {} });
    let st = stats(c.start as Record<string, unknown>);
    for (const x of c.samples as { place: string; base: number; actual: number }[]) st = learnDwell(st, x.place, x.base, x.actual);
    assert.deepEqual(st, stats(c.expect as Record<string, unknown>), String(c.name));
  });
}

test("머무름 사례가 들어 있다", () => {
  assert.ok(((root.dwellEstimate ?? []) as unknown[]).length >= 5);
  assert.ok(((root.dwellLearn ?? []) as unknown[]).length >= 3);
});

// ---- 앵커 코스·'왜?' 설명 (PlanCasesTest '앵커 코스'·'왜 설명'과 같은 사례) ----

for (const c of (root.anchor ?? []) as Record<string, unknown>[]) {
  test(`앵커 코스: ${c.name}`, () => {
    const inp = input(c);
    const a = c.anchor as { place?: string; festival?: string; inline?: PlaceJson };
    const anchor = a.place ? inp.table.get(a.place)! : a.festival ? festivalPlace(a.festival) : place(a.inline!);
    const r = anchored(inp.now, inp.here, inp.profile, inp.candidates, anchor, (c.dwell as number | undefined) ?? null, inp.sky, inp.day);
    const o = r.plan.options;
    const msg = `[${c.name}]\n${describe(c.name as string, r.plan)}`;
    const e = c.expect as Record<string, unknown>;
    assert.ok(Object.keys(e).length > 0, msg);
    if (e.labels != null) assert.deepEqual(o.map((x) => x.label), e.labels, msg);
    if (e.stops != null) assert.deepEqual(o.map((x) => x.stops.map((p) => p.id)), e.stops, msg);
    if (e.arriveHome != null) assert.deepEqual(o.map((x) => asHhmm(x.arriveHomeMin)), e.arriveHome, msg);
    if (e.reasons != null) assert.deepEqual(o.map((x) => x.reasons.map((r) => r.text)), e.reasons, msg);
    if (e.overLimit != null) assert.deepEqual(o.map((x) => x.overLimit === true), e.overLimit, msg);
    if (e.overnight != null) assert.equal(r.overnight, e.overnight, msg);
    if (e.closed != null) assert.equal(r.closed, e.closed, msg);
    if (e.oneWay != null) assert.equal(r.oneWayMin, e.oneWay, msg);
    if (e.anchorDwell != null) assert.equal(r.anchorDwellMin, e.anchorDwell, msg);
    const prof = { ...inp.profile, dwellSet: { [anchor.id]: r.anchorDwellMin } };
    for (const x of o) {
      // 고르면(choose stops + anchor) 같은 시간표: course(anchorId, lenient)
      const again = course(inp.now, inp.here, prof, x.stops, inp.sky, "고른 코스", { mode: r.plan.mode, lenient: true, anchorId: anchor.id });
      assert.deepEqual(again?.legs, x.legs, msg);
      assert.equal(again?.overLimit === true, x.overLimit === true, msg);
      assert.ok(x.stops.some((p) => p.id === anchor.id), msg);
      assert.equal(x.legs[0].fromMin, inp.now, msg);
      for (let i = 1; i < x.legs.length; i++) assert.equal(x.legs[i - 1].toMin, x.legs[i].fromMin, msg);
    }
  });
}

for (const c of (root.explain ?? []) as Record<string, unknown>[]) {
  test(`왜 설명: ${c.name}`, () => {
    const inp = input(c);
    const plan = c.call === "first"
      ? firstBoarding(inp.now, inp.here, inp.profile, inp.candidates, inp.sky, inp.day)
      : reboard(inp.now, inp.here, inp.profile, inp.candidates, inp.sky, inp.day);
    const why = explainChoice(plan.options[c.option as number], inp.now, inp.here, inp.profile, inp.sky);
    const e = c.expect as { stops?: string[]; why?: string[][]; tones?: string[][] };
    const msg = `[${c.name}] ${JSON.stringify(why)}`;
    if (e.stops) assert.deepEqual(why.map((w) => w.placeId), e.stops, msg);
    if (e.why) assert.deepEqual(why.map((w) => w.lines.map((l) => l.text)), e.why, msg);
    if (e.tones) assert.deepEqual(why.map((w) => w.lines.map((l) => l.tone)), e.tones, msg);
  });
}

// ---- 밥 넣기 (PlanCasesTest '밥 넣기'와 같은 사례 — 한 글자까지 같아야 한다) ----

type RestaurantJson = {
  id: string; name: string; lat: number; lng: number; cuisine?: string[]; kid?: string[]; parking?: { has?: string; fee?: string };
  wait?: Record<string, number>; meal?: string[]; dwell?: number; fit?: Partial<Record<Companion, number>>; tags?: string[];
  hours?: { days?: number[]; holiday?: boolean; open: string; close: string; breaks?: [string, string][]; lastOrder?: string }[];
};
const restaurantsJson = new Map<string, RestaurantJson>(((root.restaurants ?? []) as RestaurantJson[]).map((r) => [r.id, r]));
function restaurant(m: RestaurantJson): Restaurant {
  return {
    id: m.id, name: m.name, at: { lat: m.lat, lng: m.lng }, cuisine: m.cuisine ?? [], kid: m.kid ?? [],
    parkingHas: m.parking?.has ?? null, parkingFee: m.parking?.fee ?? null, wait: m.wait ?? {}, meal: m.meal ?? [],
    dwellMin: m.dwell ?? null, fit: m.fit ?? {}, tags: m.tags ?? [],
    hours: (m.hours ?? []).map((h) => ({
      days: h.days ?? [], holiday: !!h.holiday, openMin: clock(h.open), closeMin: clock(h.close), lastEntryMin: null,
      breaks: (h.breaks ?? []).map(([a, b]) => ({ fromMin: hhmm(a), toMin: hhmm(b) })), validFrom: null, validTo: null, note: null,
      lastOrderMin: h.lastOrder ? hhmm(h.lastOrder) : null,
    })),
  };
}

for (const c of (root.meals ?? []) as Record<string, unknown>[]) {
  test(`밥 넣기: ${c.name}`, () => {
    const inp = input(c);
    const over = (c.restaurantOverrides ?? {}) as Record<string, Partial<RestaurantJson>>;
    const table = new Map([...restaurantsJson].map(([id, r]) => [id, restaurant({ ...r, ...(over[id] ?? {}) })]));
    const rs = c.restaurants === "all" ? [...table.values()] : (c.restaurants as string[]).map((id) => table.get(id)!);
    const run = (p: FamilyProfile) => c.call === "first"
      ? firstBoarding(inp.now, inp.here, p, inp.candidates, inp.sky, inp.day)
      : reboard(inp.now, inp.here, p, inp.candidates, inp.sky, inp.day);
    const plan = run({ ...inp.profile, meal: { restaurants: rs, day: inp.day } });
    const plain = run(inp.profile);
    const o = plan.options;
    const msg = `[${c.name}]\n${describe(c.name as string, plan)}`;
    const e = c.expect as Record<string, unknown>;
    assert.ok(Object.keys(e).length > 0, msg);
    if (e.labels != null) assert.deepEqual(o.map((x) => x.label), e.labels, msg);
    if (e.stops != null) assert.deepEqual(o.map((x) => x.stops.map((p) => p.id)), e.stops, msg);
    if (e.arriveHome != null) assert.deepEqual(o.map((x) => asHhmm(x.arriveHomeMin)), e.arriveHome, msg);
    if (e.reasons != null) assert.deepEqual(o.map((x) => x.reasons.map((r) => r.text)), e.reasons, msg);
    if (e.meals != null) assert.deepEqual(o.map((x) => (x.meal ? `${x.meal.restaurantId}@${asHhmm(x.meal.startMin)}-${asHhmm(x.meal.endMin)}#${x.meal.index}` : null)), e.meals, msg);
    if (e.alts != null) assert.deepEqual(o.map((x) => (x.meal?.alternatives ?? []).map((a) => a.restaurantId)), e.alts, msg);
    if (e.hints != null) assert.deepEqual(o.map((x) => x.mealHint ?? null), e.hints, msg);
    if (e.legs != null) assert.deepEqual(o.map((x) => x.legs.map((l) => `${l.kind}:${l.placeId ?? ""} ${asHhmm(l.fromMin)}-${asHhmm(l.toMin)}`)), e.legs, msg);
    // 밥을 빼면 밥 끔과 같은 카드
    assert.deepEqual(o.map((x) => x.label), plain.options.map((x) => x.label), msg);
    assert.deepEqual(o.map((x) => x.stops.filter((p) => !isMealPlace(p)).map((p) => p.id)), plain.options.map((x) => x.stops.map((p) => p.id)), msg);
    for (const x of o) {
      assert.equal(x.legs[x.legs.length - 1].toMin, x.arriveHomeMin, msg);
      for (let i = 1; i < x.legs.length; i++) assert.equal(x.legs[i - 1].toMin, x.legs[i].fromMin, msg);
      // 내보내는 JSON은 옛 앱이 아는 칸 이름만 (MEAL → STAY + meal) — 되읽으면 같은 칸
      for (const l of x.legs) {
        assert.notEqual(legJson(l).kind, "MEAL" as never, msg);
        assert.deepEqual(legOfJson(legJson(l)), l, msg);
      }
      if (!x.meal) { assert.ok(!x.legs.some((l) => l.kind === "MEAL"), msg); continue; }
      assert.ok(x.arriveHomeMin <= plan.backByMin - TimeBudget.SAFETY_MIN, msg);
      const leg = x.legs.filter((l) => l.kind === "MEAL");
      assert.equal(leg.length, 1, msg);
      assert.equal(leg[0].toMin, x.meal.endMin, msg);
      const w = x.meal.kind === "lunch" ? MEAL_LUNCH : MEAL_DINNER;
      assert.ok(x.meal.startMin >= w.fromMin && x.meal.startMin <= w.toMin, msg);
      assert.equal(x.stops[x.meal.index].id, x.meal.placeId, msg);
      assert.ok(x.reasons.some((r) => r.tone === "MEAL" && r.text === x.meal!.text), msg);
      assert.ok(pickOf(x) === pickOf(plain.options[o.indexOf(x)]), msg);
    }
  });
}

test("앵커·설명 사례가 들어 있다", () => {
  assert.ok(((root.anchor ?? []) as unknown[]).length >= 5);
  assert.ok(((root.explain ?? []) as unknown[]).length >= 3);
});
