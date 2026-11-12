import { isExtId } from "@/lib/ext";
import { addDays, kstToday } from "@/lib/festival-shape";
import { whoFromRequest } from "@/lib/plan";
import { placeDetail } from "@/lib/place-detail";

/**
 * 장소 운영 정보·사진 한 곳 (폰·차 공용 인증, /api/plan과 같음)
 *   GET /api/explore/detail?id=<명소 id | fest-… | ext:…>[&day=YYYY-MM-DD]   (day 없으면 오늘, 지난 날·2주 넘게 뒤는 오늘로)
 * 답 { id, name, image, open, close, closed, parking, fee, line, source } — line = '오늘 9:00~18:00 · 주차 가능 · 입장 무료'
 * 모르면 '운영 정보 없음' (짐작하지 않음). TourAPI 답은 tour_cache에 하루. 없는 id는 404.
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const id = (params.get("id") ?? "").trim();
  if (!id || id.length > 120 || !(isExtId(id) || /^[a-z0-9][a-z0-9_-]{0,80}$/i.test(id))) return Response.json({ error: "id가 이상해요" }, { status: 400 });
  const today = kstToday();
  const q = params.get("day") ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q) && q >= today && q <= addDays(today, 14) ? q : today;
  const d = await placeDetail(id, day);
  if (!d) return Response.json({ error: "없는 곳이에요" }, { status: 404 });
  return Response.json(d);
}
