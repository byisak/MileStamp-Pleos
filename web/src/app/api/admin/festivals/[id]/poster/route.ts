import { adminGuard } from "@/lib/admin-auth";
import { saveFestivalPoster } from "@/lib/festivals";

/** 관리자: R2에 올린 포스터 주소 저장 { url } → poster_version +1, 목록 버전 +1. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/festivals/[id]/poster">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { url?: string };
  if (typeof b.url !== "string" || !/^https:\/\/[^\s]+$/.test(b.url) || b.url.length >= 500) {
    return Response.json({ error: "그림 주소가 이상해요" }, { status: 400 });
  }
  const res = await saveFestivalPoster(id, b.url);
  if (!res) return Response.json({ error: "그런 축제가 없어요" }, { status: 404 });
  return Response.json(res);
}
