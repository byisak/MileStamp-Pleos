import { adminGuard } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { ourTourId, tourDetail } from "@/lib/place-detail";
import { draftFromTour } from "@/lib/place-attrs-text";
import { tourKey } from "@/lib/tourapi";

/**
 * 관리자 '관광공사에서 채우기': 이 명소와 같은 TourAPI 장소(이름 + 5km, 30일 기억)의 이용 정보(detailIntro2)를
 * 구조 칸 초안으로 (운영 시간 줄·쉬는 요일·규칙·주차·가격·유모차·반려동물). 저장은 하지 않는다 — 화면이 '확인 필요'로 채우고 관리자가 저장.
 * 답: { draft, contentId, title } · 키 없음 503 · 못 찾음 404.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/admin/places/[id]/tour">) {
  const deny = await adminGuard();
  if (deny) return deny;
  if (!tourKey()) return Response.json({ error: "관광공사 키(DATA_GO_KR_KEY)가 없어요" }, { status: 503 });
  const { id } = await ctx.params;
  const [p] = await sql<{ id: string; name: string; lat: number; lng: number }[]>`select id, name, lat, lng from places where id = ${id}`;
  if (!p) return Response.json({ error: "그런 명소가 없어요" }, { status: 404 });
  const contentId = await ourTourId(p);
  if (!contentId) return Response.json({ error: "관광공사에서 같은 곳을 못 찾았어요 (이름 + 5km)" }, { status: 404 });
  const d = await tourDetail(contentId);
  if (!d?.intro) return Response.json({ error: "관광공사 이용 정보를 못 받았어요 · 잠시 뒤 다시" }, { status: 502 });
  return Response.json({ draft: draftFromTour(d.intro), contentId, title: d.common?.title ?? null });
}
