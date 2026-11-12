import { communityCaller, communityFail } from "@/lib/community-route";
import { deletePost } from "@/lib/community";

/** DELETE /api/community/posts/:id → { ok } (우리 가족 글만) */
export async function DELETE(req: Request, ctx: RouteContext<"/api/community/posts/[id]">) {
  const who = await communityCaller(req);
  if (who instanceof Response) return who;
  try {
    const { id } = await ctx.params;
    if (!(await deletePost(who.carId, id))) return Response.json({ error: "지울 수 있는 글이 없어요" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    return communityFail(e);
  }
}
