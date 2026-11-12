import { exploreHome, exploreReverse } from "@/lib/explore";
import { whoFromRequest } from "@/lib/plan";

/**
 * 지도 길게 누름 → 그 자리 (docs/검색-거리순-계획.md ②, 폰·차 공용 인증 = /api/plan)
 *   GET /api/explore/reverse?lat=35.88&lng=128.58[&from=lat,lng]
 * 카카오 좌표 → 주소(약 10m로 묶어 30일 저장). 답 { item: {kind 'pin', id 'ext:pin:<lat>,<lng>', name(건물 이름·도로명·지번,
 * 모르면 '지도에서 고른 곳'), label, addr, lat, lng, driveMin}, kakao: {ok, …} } — 주소를 못 찾아도 item은 온다.
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const lat = Number(params.get("lat")), lng = Number(params.get("lng"));
  if (!params.get("lat") || !params.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "lat·lng가 필요해요" }, { status: 400 });
  }
  // lat·lng는 핀 자리라 '집을 모를 때 기준'으로 쓰이지 않게 빼고 넘긴다
  const refParams = new URLSearchParams(params);
  refParams.delete("lat");
  refParams.delete("lng");
  const ref = await exploreHome(who, refParams);
  const r = await exploreReverse({ ref, lat, lng });
  return Response.json(r);
}
