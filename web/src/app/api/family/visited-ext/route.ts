import { listExtVisits } from "@/lib/explore";
import { whoFromRequest } from "@/lib/plan";

/**
 * 우리 가족이 다녀온 바깥 장소 ('다녀옴', 도장 없는 곳 — 도장북 '다녀온 곳' 묶음·지도 핀용). 폰·차 공용 인증.
 *   GET /api/family/visited-ext → { items: [{ extId, name, lat, lng, times, first, last, days[] }] } (최근 순)
 * 넣기는 서버 안에서 lib/explore.ts recordExtVisit() (차 도착 판정·코스 DONE이 부름).
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ items: await listExtVisits(who.carId) });
}
