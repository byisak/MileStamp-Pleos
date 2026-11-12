import { sql } from "@/lib/db";
import { currentPhone } from "@/lib/auth";
import { createEvent } from "@/lib/events";
import { place } from "@/lib/places";
import { kst } from "@/lib/kst";
import { familyHome, loadFamily } from "@/lib/plan";
import { festivalRunsOn, km } from "@/lib/planner";
import { findFestival, festivalStampThisYear } from "@/lib/festivals";
import { parseArrive, verifyStamp } from "@/lib/stamp-verify";
import { skyNow, sunsetAt } from "@/lib/sky";
import { arriveReplyPayload, rareFor, skyMinute } from "@/lib/arrive";
import { EXT_ID, extStopOf } from "@/lib/ext";
import { loadCourseRow } from "@/lib/course";
import { recordExtVisit } from "@/lib/explore";

/**
 * 안드로이드 오토(폰이 판정)의 도착 → 도장. 폰 토큰(Bearer)만. 좌표는 받지 않는다(장소 id·숫자만).
 * body { placeId, odoKm|null, gpsPathKm, straightKm, fromPlaceId|null, source:'phone'|'odometer', reason:'STOP_3MIN'|'DISCONNECT',
 *        verdict:'granted'|'held', at(ISO), silent?:boolean }
 * 서버가 다시 검증: 출발점(fromPlaceId 장소, 없으면 가족 집 칸 — 그것도 없으면 폰이 보낸 straightKm) → 장소 직선거리로
 * 0.9×직선−1 ≤ (odoKm ?? gpsPathKm) ≤ max(1.5×경로+20, 1.15×궤적+3) (엔진 StampVerifier = lib/stamp-verify.ts).
 * 같은 곳은 한 차에 하루 한 번(409), 축제 한정 도장은 오늘 열릴 때만 + 해마다 한 번(409). 보류면 422 { reason, detail }.
 * 희귀는 차(엔진 TripEngine)와 같게: 주차한 때 장소 하늘이 비면 '비 오는 날'(축제 도장은 없음, 날씨 모르면 없음 — lib/arrive.ts).
 * 통과하면 stamp 소식 { number, rare, silent, phoneVerified, reason, source } → 가족 폰 알림(보낸 폰은 빼고, 쉿이면 안 울림)
 *   → { id, pushed, payload: { number, rare?, silent?, festivalId?, season?, visit } } (visit = 이 차가 이 장소에서 받은 몇 번째 도장)
 * 바깥 장소 'ext:tour:…'(오늘 코스에만 있는 곳, 도장 없음): 검증·도장 없이 '다녀옴'만 적는다 — 이름·좌표는 오늘 코스 JSON에서
 *   (폰은 좌표를 안 보냄). 오늘 코스에 없는 곳이면 400. 보류 판정이어도 적는다(도장이 아니니까).
 *   → { visited: true, created, extId, name, day }  (하루 한 곳 한 번 — 두 번째는 created:false)
 */
export async function POST(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const parsed = parseArrive(await req.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const b = parsed.ok;
  if (EXT_ID.test(b.placeId)) {
    const row = await loadCourseRow(phone.car_id);
    const hit = extStopOf(row?.course, b.placeId);
    if (!hit) return Response.json({ error: "unknown place", detail: "오늘 코스에 없는 바깥 장소예요" }, { status: 400 });
    const at = new Date(b.at);
    const r = await recordExtVisit({ familyId: phone.car_id, extId: hit.extId, name: hit.name, lat: hit.lat, lng: hit.lng, at: Number.isNaN(at.getTime()) ? undefined : at, source: "auto" });
    return Response.json({ visited: true, created: r.created, extId: hit.extId, name: hit.name, day: r.day });
  }
  if (b.verdict === "held") return Response.json({ error: "held", reason: "CLIENT_HELD", detail: "폰 판정이 보류예요" }, { status: 422 });

  const today = kst(new Date()).day;
  // 장소: 명소(앱이 아는 34곳) 또는 축제
  const fest = b.placeId.startsWith("fest-") ? await findFestival(b.placeId) : null;
  if (b.placeId.startsWith("fest-")) {
    if (!fest || !fest.active) return Response.json({ error: "unknown festival" }, { status: 400 });
    if (!festivalRunsOn({ id: fest.id, starts: fest.starts, ends: fest.ends, weight: fest.weight, placeId: fest.placeId, closedDays: fest.closedDays }, today)) {
      return Response.json({ error: "held", reason: "FESTIVAL_NOT_RUNNING", detail: "축제 기간이 아니에요" }, { status: 422 });
    }
  } else if (!place(b.placeId)) {
    return Response.json({ error: "unknown place" }, { status: 400 });
  }
  const coords = async (id: string): Promise<{ lat: number; lng: number } | null> => {
    if (id.startsWith("fest-")) { const f = id === fest?.id ? fest : await findFestival(id); return f ? f.points[0] : null; }
    const [r] = await sql<{ lat: number; lng: number }[]>`select lat, lng from places where id = ${id}`;
    return r ?? null;
  };
  const target = fest ? fest.points[0] : await coords(b.placeId);
  if (!target) return Response.json({ error: "unknown place" }, { status: 400 });

  // 하루 한 번 (축제는 해마다 한 번)
  if (fest) {
    const dup = await festivalStampThisYear(phone.car_id, fest.id, today);
    if (dup) return Response.json({ error: "duplicate", id: dup.id }, { status: 409 });
  } else {
    const [dup] = await sql<{ id: string }[]>`
      select id from events where car_id = ${phone.car_id} and kind = 'stamp' and place_id = ${b.placeId}
        and (created_at at time zone 'Asia/Seoul')::date = ${today}::date limit 1`;
    if (dup) return Response.json({ error: "duplicate", id: dup.id }, { status: 409 });
  }

  // 출발점: 앞 장소 → 가족 집 → (모르면) 폰이 잰 직선거리
  let from: { lat: number; lng: number } | null = b.fromPlaceId ? await coords(b.fromPlaceId) : null;
  if (!from && !b.fromPlaceId) {
    const { family, homeCell } = await loadFamily(phone.car_id);
    from = familyHome(family, homeCell, null);
  }
  const straightKm = from ? km(from, target) : b.straightKm;
  const verdict = verifyStamp({ straightKm, deltaKm: b.odoKm ?? b.gpsPathKm, gpsPathKm: b.gpsPathKm });
  if (verdict.kind === "held") return Response.json({ error: "held", reason: verdict.reason, detail: verdict.detail }, { status: 422 });

  // 몇 번째 방문 (이번 도장 포함) · 희귀(주차한 때 장소 하늘)
  const placeKey = fest ? fest.id : b.placeId;
  const [[{ n: before }], sky] = await Promise.all([
    sql<{ n: number }[]>`select count(*)::int as n from events where car_id = ${phone.car_id} and kind = 'stamp' and place_id = ${placeKey}`,
    fest ? Promise.resolve("UNKNOWN" as const) : skyNow(target.lat, target.lng, today, skyMinute(b.at, new Date())).catch(() => "UNKNOWN" as const),
  ]);
  // 해 진 뒤 밤 명소면 '밤' (비가 먼저) — 시간 특성 best night 또는 표시 '야경'
  let night: { nowMin: number; sunsetMin: number | null; nightBest: boolean } | undefined;
  if (!fest && sky !== "RAIN") {
    const [pr] = await sql<{ moments: { best?: string[] } | null; tags: string[] | null }[]>`
      select moments, tags from places where id = ${b.placeId}`.catch(() => sql<{ moments: null; tags: string[] | null }[]>`
      select null::jsonb as moments, tags from places where id = ${b.placeId}`);
    const nb = !!pr && (((pr.moments?.best ?? []) as string[]).includes("night") || (pr.tags ?? []).includes("야경"));
    if (nb) night = { nowMin: skyMinute(b.at, new Date()), sunsetMin: await sunsetAt(target.lat, target.lng, today).catch(() => null), nightBest: true };
  }
  const rare = rareFor(sky, !!fest, night);

  const payload: Record<string, unknown> = { phoneVerified: b.source === "phone", reason: b.reason, source: b.source, at: b.at, silent: b.silent };
  const r = fest
    ? await createEvent(phone.car_id, "stamp", fest.id, { ...payload, festivalId: fest.id, festivalName: fest.name, season: fest.season, ring: fest.ring, rare: null },
      { festival: { id: fest.id, name: fest.name }, exceptPhone: phone.id })
    : await createEvent(phone.car_id, "stamp", b.placeId, { ...payload, rare }, { exceptPhone: phone.id });
  return Response.json({
    id: r.id, pushed: r.pushed,
    payload: arriveReplyPayload({ number: r.payload.number, rare, silent: b.silent, visit: before + 1, festival: fest ? { id: fest.id, season: fest.season } : null }),
  });
}
