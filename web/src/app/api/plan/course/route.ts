import { kst } from "@/lib/kst";
import { whoFromRequest } from "@/lib/plan";
import { applyEvent, courseBody, courseView, loadCourseRow } from "@/lib/course";

/**
 * 살아 있는 코스 — 폰(Bearer 폰 토큰)·차(Bearer 차 토큰) 공용. 계획: docs/코스-고도화-계획.md 5절·10절.
 *   GET   /api/plan/course                       → { kind: "NoChange", planId, day, course, version, proposal, explain }  (오늘 코스 없음 404)
 *     폰은 오늘 코스가 없으면 미리 정한 다른 날 코스(가장 가까운 날)를 받는다 — day가 오늘보다 뒤면 '출발 예정'으로만 보여 줄 것. 차는 오늘 코스만.
 *     오늘 계획인데 시간표가 뒤처졌거나 문 닫아 못 가는 곳이 있으면 먼저 Tick(지금 시각)으로 다시 짜서 저장한다(lib/course courseView).
 *     explain = 화면 맨 위 쉬운 설명 {headline, body, action: "GO_HOME"|"END"|null, homeMin, home, warn, speech} (엔진 explain)
 *   PATCH /api/plan/course { version, event }    → 답 JSON { kind, course, change, voice, options?, explain, version, planId, pushed }
 *     event 모양은 10절(= plan-live-cases.json의 사건). 덧붙임 driving(주행 중)·here([위도, 경도])는 선택, now는 "HH:MM".
 *     버전이 저장된 것보다 낮으면 409 + { course, version, proposal }. 단, 차의 실제 신호(Departed·Arrived·StillParked·NaviEta·StillDriving)는
 *     늘 최신 코스 위에 적용한다(사실이니까). 명령(ReplaceNext·Skip·Insert·GoHome·Weather·PlaceClosed·LimitChanged·Remote·SetEnd·SetDwell·ExtendStay)은 최신 버전으로.
 *     머무름: {"type":"SetDwell","place":"dgsm","minutes":90}(오늘만, 15~360분·5분 단위) · {"type":"ExtendStay","minutes":30}(지금 머무는 곳 앞으로 N분 더, 0 = 지금 나갈게요)
 *     코스 stops[]에는 dwellSet(오늘만 직접 정함)과 응답 전용 dwellSource {source: family|crowd|base, n, text}가 붙는다.
 *     새로 DONE이 된 곳(도착·출발 시각 있음)은 저장 뒤 우리 가족 머무름을 배운다(families.dwell_*, dwell_visits).
 *   POST  /api/plan/course/dismiss { version, atMin? } → 제안 카드 거절('그대로 갈게요'): course_proposal만 비움 (dismiss/route.ts)
 *   POST  /api/plan/course + 머리 X-HTTP-Method-Override: PATCH  → 차(안드로이드 HttpURLConnection은 PATCH를 못 보냄)
 * 새 코스는 가족 폰에 `course_update`(data.outcome = 답 JSON 문자열)로 밀어 준다. 보낸 폰은 빼고.
 */

function bad(error: string, status = 400) {
  return Response.json({ error }, { status });
}

export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return bad("unauthorized", 401);
  // 폰은 미리 정한 다른 날 코스도 본다(답 day로 구분), 차는 오늘 코스만
  const row = await loadCourseRow(who.carId, { ahead: !!who.phone });
  if (!row) return bad("오늘 고른 코스가 없어요", 404);
  const v = await courseView(who, row);
  return Response.json({ ...courseBody(row), course: v.course, version: v.version, proposal: v.proposal, explain: v.explain });
}

export async function PATCH(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return bad("unauthorized", 401);
  const body = (await req.json().catch(() => ({}))) as { version?: unknown; event?: unknown };
  if (!Number.isInteger(body.version)) return bad("version(정수)이 필요해요");
  if (!body.event || typeof body.event !== "object" || Array.isArray(body.event)) return bad("event가 필요해요");
  const event = body.event as Record<string, unknown>;
  // now가 없으면 서버 시각(한국)
  if (event.now == null) event.now = hhmmNow();
  const row = await loadCourseRow(who.carId);
  if (!row) return bad("오늘 고른 코스가 없어요", 404);
  const r = await applyEvent(who, row, body.version as number, event);
  if (!r.ok) return Response.json({ error: r.error, course: r.course, version: r.version, proposal: r.proposal }, { status: r.status });
  return Response.json({ ...r.outcome, version: r.version, planId: row.id, pushed: r.pushed });
}

/** 차는 PATCH를 못 보내서 POST + X-HTTP-Method-Override. 그 밖의 POST는 405. */
export async function POST(req: Request) {
  if ((req.headers.get("x-http-method-override") ?? "").toUpperCase() === "PATCH") return PATCH(req);
  return bad("PATCH 또는 POST + X-HTTP-Method-Override: PATCH", 405);
}

function hhmmNow() {
  const m = kst(new Date()).min;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
