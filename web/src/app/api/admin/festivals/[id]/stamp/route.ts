import { adminGuard } from "@/lib/admin-auth";
import { saveFestivalStamp } from "@/lib/festivals";

/** 관리자: R2에 올린 한정 도장 주소 저장 { url, bwUrl } → stamp_version +1, 목록 버전 +1. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/festivals/[id]/stamp">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { url?: string; bwUrl?: string };
  const ok = (u: unknown): u is string => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) && u.length < 500;
  if (!ok(b.url) || !ok(b.bwUrl)) return Response.json({ error: "그림 주소가 이상해요" }, { status: 400 });
  const res = await saveFestivalStamp(id, b.url, b.bwUrl);
  if (!res) return Response.json({ error: "그런 축제가 없어요" }, { status: 404 });
  return Response.json(res);
}
