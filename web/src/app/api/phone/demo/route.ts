import type { EventKind } from "@/lib/db";
import { sql } from "@/lib/db";
import { currentPhone } from "@/lib/auth";
import { createEvent } from "@/lib/events";
import { PLACES } from "@/lib/places";
import { findFestival } from "@/lib/festivals";
import { after } from "next/server";
import { completeDiary } from "@/lib/diary";

// 데모 차에 연결된 폰에서만: 차가 보낸 것처럼 시험 소식을 만든다 (알림까지 실제로 간다)
//   { kind, placeId?, rare?, quiet?, push? }
//   - placeId: 알려진 장소만 (없으면 종류별 기본 장소)
//   - stamp: number는 서버가 정함 (이 차의 앞선 도장 수 + 1). rare면 '비 오는 날 디아크'
//   - quiet: 쉿 모드 도장(payload.silent) / push: false면 알림 없이 저장만 (폰 도장북에서 앱이 직접 연출할 때)
//   - festivalId: 축제 한정 도장 (stamp만, 켜진 축제면 기간과 상관없이 — 개발 모드 시험용)
type Body = { kind?: string; placeId?: string; rare?: boolean | string; quiet?: boolean; push?: boolean; festivalId?: string };

const KINDS: EventKind[] = ["handoff", "intro", "mission", "stamp", "summary"];
const DEFAULT_PLACE: Partial<Record<EventKind, string>> = { handoff: "samguk", intro: "dgsm", mission: "seokgul", stamp: "thearc" };

async function demoPhone(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return { error: Response.json({ error: "not paired" }, { status: 401 }) };
  const [car] = await sql<{ demo: boolean }[]>`select demo from cars where id = ${phone.car_id}`;
  if (!car?.demo) return { error: Response.json({ error: "데모 차에서만 쓸 수 있어요" }, { status: 403 }) };
  return { phone };
}

export async function POST(req: Request) {
  const { phone, error } = await demoPhone(req);
  if (!phone) return error;
  const body = (await req.json().catch(() => ({}))) as Body;
  const kind = body.kind as EventKind;
  if (!KINDS.includes(kind)) return Response.json({ error: "bad kind" }, { status: 400 });
  if (kind === "stamp" && body.festivalId) {
    const f = await findFestival(body.festivalId);
    if (!f || !f.active) return Response.json({ error: "모르는 축제예요" }, { status: 400 });
    const payload = { rare: null, silent: body.quiet === true, festivalId: f.id, festivalName: f.name, season: f.season, ring: f.ring };
    const r = await createEvent(phone.car_id, "stamp", f.id, payload, { push: body.push !== false, festival: { id: f.id, name: f.name } });
    return Response.json({ ...r, kind, placeId: f.id });
  }
  if (body.placeId && !PLACES[body.placeId]) return Response.json({ error: "모르는 장소예요" }, { status: 400 });
  if (kind === "mission" && body.placeId && !PLACES[body.placeId].mission) return Response.json({ error: "미션이 없는 곳이에요" }, { status: 400 });
  let placeId: string | null = kind === "summary" ? null : body.placeId || DEFAULT_PLACE[kind] || null;

  let payload: Record<string, unknown>;
  switch (kind) {
    case "handoff": payload = { variant: "FULL_60S", positionMs: 9000 }; break;
    case "intro": payload = { variant: "FULL_60S" }; break;
    case "mission": payload = {}; break;
    case "summary": payload = { stamps: 4, rare: 1, km: 169, places: ["seokgul", "samguk", "dgsm", "thearc"] }; break;
    case "stamp": {
      const rare = body.rare ? (typeof body.rare === "string" ? body.rare : "비 오는 날") : null;
      if (rare) placeId = "thearc"; // 희귀 도장은 지금 '비 오는 날 디아크' 하나
      // No.는 createEvent가 정한다 (이 차의 앞선 도장 수 + 1 — 진짜 차 도장과 같은 규칙)
      payload = { rare, silent: body.quiet === true };
      break;
    }
  }
  const r = await createEvent(phone.car_id, kind, placeId, payload, { push: body.push !== false });
  // 오늘 요약(= 집 도착) → 그날 일기 완성 알림 (진짜 차 /api/car/events와 같게)
  if (kind === "summary" && body.push !== false) after(() => completeDiary(phone.car_id).catch(() => 0));
  return Response.json({ ...r, kind, placeId });
}

// 데모 차의 소식 모두 지우기 (다시 처음부터 시험)
export async function DELETE(req: Request) {
  const { phone, error } = await demoPhone(req);
  if (!phone) return error;
  await sql`delete from events where car_id = ${phone.car_id}`;
  return Response.json({ ok: true });
}
