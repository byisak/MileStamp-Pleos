import { adminGuard } from "@/lib/admin-auth";
import { savePlace } from "@/lib/catalog";
import { parsePlaceInput } from "@/lib/catalog-shape";

/** 관리자: 명소 한 곳 저장 → 목록 버전 +1 (폰·차는 다음 실행 때 받는다). */
export async function PUT(req: Request, ctx: RouteContext<"/api/admin/places/[id]">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const { id } = await ctx.params;
  const parsed = parsePlaceInput(await req.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const res = await savePlace(id, parsed.ok);
  if (!res) return Response.json({ error: "그런 명소가 없어요" }, { status: 404 });
  return Response.json(res);
}
