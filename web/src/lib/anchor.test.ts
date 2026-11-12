/*
 * '내가 고르기' A·B 서버 계산 — 방문 기록 모양(history.ts), 바깥 장소(ext.ts), 앵커 카드 고르기(choose.ts anchor), '왜?'(plan.ts optionJsonOf).
 * 엔진 규칙 자체(앵커·설명·점수)는 planner.test.ts가 엔진과 같은 사례로 본다. 여기선 서버 쪽 이음새만.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anchored, hhmm, type Place } from "./planner";
import { courseChoice, parseStops } from "./choose";
import { DEFAULT_FAMILY, optionJsonOf, toProfile } from "./plan";
import { historyFrom, daysBetween } from "./history";
import { decorateStops, extPlace, extPlacesOf, withExt } from "./ext";

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, "../../db/places.seed.json"), "utf8")) as Record<string, never>[];
const clock = (t: string) => (t === "24:00" ? 24 * 60 : hhmm(t));
const places: Place[] = seed.map((m: Record<string, never>) => ({
  id: m.id, name: m.name, at: { lat: m.lat, lng: m.lng }, indoor: m.indoor, dwellP80Min: m.dwell, kidFit: m.kidFit,
  openMin: clock(m.open), closeMin: clock(m.close), popular: m.popular, stampable: m.stampable,
}));
const byId = new Map(places.map((p) => [p.id, p]));
const home = { lat: 35.8858, lng: 128.5828 };
const profile = toProfile(DEFAULT_FAMILY, home);
const sky = { sunriseMin: hhmm("06:47"), sunsetMin: hhmm("17:41"), sky: "CLEAR" as const, rainFromMin: null };
const now = hhmm("08:30");
const HAEUNDAE = { id: "ext:tour:126508", name: "해운대해수욕장", lat: 35.1587, lng: 129.1604 };

test("방문 기록: 도장·다녀옴·즐겨찾기 → 엔진 VisitHistory (축제 도장은 그해만, 미래 기록은 0일)", () => {
  const h = historyFrom("2026-10-31", [
    { place_id: "dgsm", festival_id: null, last_day: "2026-10-20" },
    { place_id: "hajungdo", festival_id: "fest-hajungdo", last_day: "2025-10-30" },
    { place_id: "nmd", festival_id: null, last_day: "2026-11-02" },
  ], [{ ext_id: "ext:tour:1", last_day: "2026-10-30" }], ["eworld", "eworld"]);
  assert.deepEqual(h.stamped, ["dgsm", "hajungdo", "nmd"]);
  assert.deepEqual(h.lastVisitDays, { dgsm: 11, hajungdo: 366, nmd: 0, "ext:tour:1": 1 });
  assert.deepEqual(h.favorites, ["eworld"]);
  assert.equal(daysBetween("2026-10-28", "2026-11-01"), 4);
});

test("바깥 장소: 기본값(머무름 90·10~18시·아이 0.6·도장 없음)·틀린 모양은 이유", () => {
  const p = extPlace(HAEUNDAE);
  assert.ok(typeof p !== "string");
  assert.deepEqual([p.dwellP80Min, p.openMin, p.closeMin, p.kidFit, p.stampable, p.indoor], [90, 600, 1080, 0.6, false, false]);
  const q = extPlace({ ...HAEUNDAE, open: "09:00", close: "21:30", dwell: 120, indoor: true });
  assert.ok(typeof q !== "string");
  assert.deepEqual([q.openMin, q.closeMin, q.dwellP80Min, q.indoor], [540, 1290, 120, true]);
  assert.equal(typeof extPlace({ ...HAEUNDAE, id: "seokgul" }), "string");
  assert.equal(typeof extPlace({ ...HAEUNDAE, lat: 999 }), "string");
  assert.equal(typeof extPlace({ ...HAEUNDAE, open: "18:00", close: "10:00" }), "string");
});

test("stops에 바깥 장소 칸: 이름·좌표로 받고, 카드 JSON에 ext가 실려 다시 찾을 수 있다", () => {
  const ps = parseStops(["nmd", HAEUNDAE], (id) => byId.get(id));
  assert.ok(ps.ok);
  assert.deepEqual(ps.places.map((p) => p.id), ["nmd", "ext:tour:126508"]);
  // 같은 장소 두 번
  assert.equal(parseStops([HAEUNDAE, HAEUNDAE], (id) => byId.get(id)).ok, false);
  // 바깥 장소 id만 글자로 오면 모름
  assert.equal(parseStops(["ext:tour:126508"], (id) => byId.get(id)).ok, false);
  const r = courseChoice([HAEUNDAE], (id) => byId.get(id), now, home, profile, sky, "MORNING", undefined, "ext:tour:126508");
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.equal(r.option.label, "해운대해수욕장 중심으로");
  assert.equal(r.option.anchorId, "ext:tour:126508");
  assert.deepEqual(r.option.stops[0].ext, { name: "해운대해수욕장", lat: 35.1587, lng: 129.1604, indoor: false, dwell: 90, open: 600, close: 1080, kidFit: 0.6 });
  const find = withExt((id: string) => byId.get(id), extPlacesOf(r.option.stops));
  assert.equal(find("ext:tour:126508")?.name, "해운대해수욕장");
  // 코스 JSON 곳마다 이름·좌표 + 바깥 장소면 ext
  const stops = decorateStops([{ placeId: "nmd" }, { placeId: "ext:tour:126508" }], find);
  assert.equal(stops[0].name, "국립대구박물관");
  assert.equal(stops[0].ext, undefined);
  assert.equal(stops[1].ext?.dwell, 90);
});

test("앵커 카드를 고르면(stops + anchor + 앵커 머무름) 같은 시간표 — 귀가 한계를 넘는 카드도 받는다", () => {
  const anchor = byId.get("hahoe")!;
  const r = anchored(hhmm("14:30"), home, profile, places, anchor, null, sky, null);
  assert.equal(r.plan.options.length, 1);
  const card = r.plan.options[0];
  assert.equal(card.overLimit, true);
  // 앵커 없이 고르면 귀가 한계 때문에 400
  assert.equal(courseChoice(["hahoe"], (id) => byId.get(id), hhmm("14:30"), home, profile, sky, "AFTERNOON").ok, false);
  const c = courseChoice(["hahoe"], (id) => byId.get(id), hhmm("14:30"), home, profile, sky, "AFTERNOON", { hahoe: r.anchorDwellMin }, "hahoe");
  assert.ok(c.ok, !c.ok ? c.error : "");
  assert.equal(c.option.overLimit, true);
  assert.deepEqual(c.option.legs, card.legs.map((l) => ({ ...l })));
  assert.equal(c.option.arriveHomeMin, card.arriveHomeMin);
});

test("카드 JSON의 '왜?': 장소마다 줄, 바깥 장소는 '다녀옴'", () => {
  const r = anchored(now, home, profile, places, extPlace(HAEUNDAE) as Place, null, sky, null);
  const j = optionJsonOf(r.plan.options[r.plan.options.length - 1], profile, { nowMin: now, here: home, sky });
  assert.equal(j.why?.length, 1);
  assert.ok(j.why![0].lines.some((l) => l.text === "도장 대신 '다녀옴'으로 남아요"));
  assert.ok(j.why![0].lines[0].text.startsWith("집에서 150분"));
});
