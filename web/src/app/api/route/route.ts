import { whoFromRequest } from "@/lib/plan";
import { routeFor } from "@/lib/route";
import { isDepart, parsePts } from "@/lib/route-shape";

/**
 * 실제 길 · 교통 반영 시간 (카카오모빌리티 길찾기) — 폰·차 공용 인증 = /api/plan
 *   GET /api/route?pts=lng,lat;lng,lat;…[&depart=YYYYMMDDHHmm]
 *   - pts: 출발 → 경유(≤5) → 도착, 카카오처럼 경도 먼저. 한국 안만
 *   - depart(선택): 그날 출발 시각(한국 시간) → 그날 예상 교통. 없으면 지금 교통
 * 답 { source: 'live'|'future'|'estimate', legs: [{durMin, distKm}], total: {durMin, distKm}, polyline: [[[위도, 경도]…] 구간마다] }
 *   키 없음·한도·실패면 직선 어림(source 'estimate', 선은 곧은 선). 같은 길은 10분(예상 교통은 6시간) 저장.
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const pts = parsePts(q.get("pts"));
  if (!pts) return Response.json({ error: "pts는 경도,위도;경도,위도 모양 2~7점(한국 안)이에요" }, { status: 400 });
  const depart = q.get("depart");
  if (depart != null && !isDepart(depart)) return Response.json({ error: "depart는 YYYYMMDDHHmm이에요" }, { status: 400 });
  return Response.json(await routeFor(pts, depart));
}
