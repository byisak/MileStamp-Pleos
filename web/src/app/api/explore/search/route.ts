import { exploreHome, exploreSearch } from "@/lib/explore";
import { cleanQuery } from "@/lib/explore-shape";
import { whoFromRequest } from "@/lib/plan";

/**
 * 내가 고르기 · 직접 찾기 (폰·차 공용 인증, /api/plan과 같음)
 *   GET /api/explore/search?q=경주 박물관[&from=lat,lng][&lat&lng]   (from = 기준 위치, 없으면 집)
 * 관광공사 TourAPI searchKeyword2 중 관광지(12)·문화시설(14)만 (음식점·카페·숙박·쇼핑·레포츠 제외). 검색어마다 7일 저장.
 * 우리 명소 중 이름이 맞는 곳(kind 'place', ourStamp)이 먼저, 그 뒤 TourAPI(kind 'tour', id 'ext:tour:<contentId>') 가까운 순.
 * 답 { items, q, home, tour: {ok, …} } · 검색어가 2글자 미만이면 400
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const q = cleanQuery(params.get("q"));
  if (!q) return Response.json({ error: "두 글자 이상 적어 주세요" }, { status: 400 });
  const home = await exploreHome(who, params);
  const r = await exploreSearch({ home, q });
  return Response.json({ items: r.items, q, home: !!home, tour: r.tour });
}
