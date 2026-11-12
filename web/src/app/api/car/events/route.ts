import type { EventKind } from "@/lib/db";
import { carFromRequest } from "@/lib/auth";
import { createEvent, KINDS } from "@/lib/events";
import { place } from "@/lib/places";
import { festivalRunsOn } from "@/lib/planner";
import { findFestival, festivalStampThisYear } from "@/lib/festivals";
import { kstToday } from "@/lib/festival-shape";
import { loadFamily, loadPlaces, toPlace } from "@/lib/plan";
import { recordVisit } from "@/lib/dwell";
import { after } from "next/server";
import { completeDiary } from "@/lib/diary";

/**
 * 차에서 생긴 일을 받아 저장하고 가족 폰에 알린다.
 * body: { kind, placeId?, payload? }
 *  - handoff: payload { variant: "FULL_60S"|"KIDS_30S", positionMs }
 *  - stamp:   payload { number, rare?, silent? } — No.는 서버가 정해 답 payload.number로 돌려준다
 *             (차 번호가 다르면 payload.carNumber에 남김)
 *             + 선택 arriveMin·departMin(그날 0시부터 분, 떠날 때 다시 보낸 소식) → 우리 가족 머무름 배우기(같은 날 같은 곳 한 번)
 *  - summary: payload { stamps, rare, km, places: [placeId…] } — 집 도착. 응답 뒤 그날 일기를 만들고 가족 폰에 '일기가 완성됐어요'(lib/diary completeDiary)
 *  - 축제 한정 도장: kind 'stamp' + payload.festivalId (placeId는 축제 id 또는 붙은 명소) — 오늘(한국 날짜) 열리는
 *    축제만 받는다(기간 밖·쉬는 요일이면 400). 같은 축제는 한 차에 해마다 한 번 — 이미 있으면 그 소식을 알림 없이 돌려준다(duplicate)
 */
export async function POST(req: Request) {
  const car = await carFromRequest(req);
  if (!car) return Response.json({ error: "unauthorized" }, { status: 401 });

  const raw = await req.text();
  if (raw.length > 4096) return Response.json({ error: "too large" }, { status: 413 });
  let body: { kind?: string; placeId?: string; payload?: Record<string, unknown> };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const kind = body.kind as EventKind;
  if (!KINDS.includes(kind)) return Response.json({ error: "bad kind" }, { status: 400 });
  const festivalId = kind === "stamp" && typeof body.payload?.festivalId === "string" ? body.payload.festivalId : null;
  if (festivalId) {
    const f = await findFestival(festivalId);
    const today = kstToday();
    if (!f || !f.active) return Response.json({ error: "unknown festival" }, { status: 400 });
    if (!festivalRunsOn({ id: f.id, starts: f.starts, ends: f.ends, weight: f.weight, placeId: f.placeId, closedDays: f.closedDays }, today)) {
      return Response.json({ error: "festival not running" }, { status: 400 });
    }
    const dup = await festivalStampThisYear(car.id, f.id, today);
    if (dup) return Response.json({ id: dup.id, pushed: 0, payload: dup.payload, duplicate: true });
    const payload = { ...body.payload, festivalId: f.id, festivalName: f.name, season: f.season, ring: f.ring, rare: null };
    return Response.json(await createEvent(car.id, "stamp", f.id, payload, { festival: { id: f.id, name: f.name } }));
  }
  if (kind !== "summary" && !place(body.placeId)) return Response.json({ error: "unknown place" }, { status: 400 });
  // 차는 도장 찍은 곳마다 미션을 보낸다 — 미션(퀴즈·찾아보기)이 없는 곳은 저장·알림 없이 넘긴다
  if (kind === "mission" && !place(body.placeId)?.mission) return Response.json({ id: null, pushed: 0, skipped: "no mission" });

  const out = await createEvent(car.id, kind, body.placeId ?? null, body.payload ?? {});
  // 집 도착(오늘 요약) → 그날 일기를 만들고 '일기가 완성됐어요' 알림 (응답 뒤에)
  if (kind === "summary") after(() => completeDiary(car.id).catch((e) => console.error("일기 완성 실패", (e as Error).message)));
  // 도장 소식에 도착·출발 시각(그날 0시부터 분)이 있으면 우리 가족 머무름을 배운다 (같은 날 같은 곳은 한 번, 덤)
  const pl = body.payload ?? {};
  if (kind === "stamp" && body.placeId && isMin(pl.arriveMin) && isMin(pl.departMin) && (pl.departMin as number) > (pl.arriveMin as number)) {
    try {
      const row = (await loadPlaces()).find((r) => r.id === body.placeId);
      if (row) {
        const { family } = await loadFamily(car.id);
        await recordVisit(car.id, { placeId: row.id, arriveMin: pl.arriveMin as number, departMin: pl.departMin as number }, toPlace(row),
          { day: kstToday(), kidAges: family.kidAges, rainy: pl.rainy === true, source: "stamp" });
      }
    } catch (e) {
      console.error("머무름 배우기 실패", (e as Error).message);
    }
  }
  return Response.json(out);
}

const isMin = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 24 * 60;
