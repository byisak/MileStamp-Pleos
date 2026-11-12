import { exploreFestivals, exploreHome, FESTIVAL_DAYS_DEFAULT, withCompanionSign } from "@/lib/explore";
import { parseCompanion } from "@/lib/planner";
import { parseMaxMin, parseRegions, parseSort } from "@/lib/explore-filter";
import { NEAR_MAX_MIN } from "@/lib/explore-shape";
import { addDays, kstToday } from "@/lib/festival-shape";
import { isCoordText, parseFrom } from "@/lib/kakao-local-shape";
import { whoFromRequest } from "@/lib/plan";

/**
 * 내가 고르기 · 축제 (폰 Bearer 폰 토큰·웹 쿠키, 차 Bearer 차 토큰 — /api/plan과 같음)
 *   GET /api/explore/festivals?[maxMin=60|120|180][&regions=27,47][&sort=popular|distance][&places=1][&from=lat,lng][&day=YYYY-MM-DD][&days=30][&lat&lng]
 *   - maxMin: 집에서 차로 몇 분 안 (없으면 거리 제한 없음). 옛 앱의 scope=near는 120, scope=all은 제한 없음
 *   - regions: 시·도 코드(KorService2 lDongRegnCd, 쉼표) — 없으면 전국. 거리와 함께 거른다
 *   - sort=popular: 최근 30일 고른·다녀간 가족 순(3가족 이상만) → 이번 주말 → 가까운 순. 줄에 popular(가족 수, 3 이상만)
 *     sort=distance: 기준 위치에서 차로 가까운 순 (docs/검색-거리순-계획.md ①)
 *   - from=lat,lng: 기준 위치('지금 내 위치'·'직접 정한 곳', 약 1km로 반올림) — driveMin과 maxMin이 이 기준. 없으면 집. 답 ref:true면 썼음
 *   - places=1: 우리 명소도 같은 거르기로 places에
 *   - day(옛 이름 from=YYYY-MM-DD): 기준 날짜(기본 오늘, 오늘~60일 뒤). 그날 열리고 있거나 days일 안에 시작하는 축제
 *   - lat·lng: 집을 모를 때만 차 시간 기준으로 씀
 *   - with(선택): 누구랑 가요? kids·couple·friends·solo — 줄마다 fitSign(+1 좋아요·−1 덜 맞아요·0)·fitNote('어른 위주 행사' 등)
 * 답 { items: ExploreItem[](줄마다 region), places?, total, maxMin, regions, sort, regionCounts, regionCountsAll, popularReady,
 *       scope(옛 앱용), from, days, nearMaxMin, home: true|false, weekend: {sat, sun}, tour: {ok, …} }
 *   - 등록 축제(kind 'festival', id 'fest-…', ourStamp true)가 먼저 → 이번 주말 → 가까운 순
 *   - TourAPI 축제는 kind 'tour', id 'ext:tour:<contentId>'. 키가 없거나 한도면 tour.ok=false, 등록 축제만
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const maxMin = parseMaxMin(q);
  const regions = parseRegions(q.get("regions"));
  const sort = parseSort(q.get("sort"));
  const scope = maxMin != null && maxMin <= 120 ? "near" : "all";
  const today = kstToday();
  const rawFrom = q.get("from");
  const from = q.get("day") ?? (rawFrom && !isCoordText(rawFrom) ? rawFrom : null) ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < today || from > addDays(today, 60)) {
    return Response.json({ error: "day(from)는 오늘부터 60일 안의 YYYY-MM-DD예요" }, { status: 400 });
  }
  const daysRaw = Number(q.get("days") ?? FESTIVAL_DAYS_DEFAULT);
  const days = Number.isInteger(daysRaw) && daysRaw >= 0 && daysRaw <= 90 ? daysRaw : FESTIVAL_DAYS_DEFAULT;
  const home = await exploreHome(who, q);
  const r = await exploreFestivals({ home, from, days, query: { maxMin, regions, sort }, withPlaces: q.get("places") === "1" });
  const comp = parseCompanion(q.get("with"));
  return Response.json({
    items: await withCompanionSign(r.items, comp), ...(r.places ? { places: await withCompanionSign(r.places, comp) } : {}), total: r.total, maxMin, regions, sort,
    regionCounts: r.regionCounts, regionCountsAll: r.regionCountsAll, popularReady: r.popularReady,
    scope, from, days, nearMaxMin: NEAR_MAX_MIN, home: !!home, ref: !!parseFrom(rawFrom), weekend: r.weekend, tour: r.tour,
  });
}
