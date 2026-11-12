import { adminGuard } from "@/lib/admin-auth";
import { adminAct } from "@/lib/community";
import { communityFail } from "@/lib/community-route";

const ACTIONS = ["restore", "remove", "ban", "unban"] as const;

/** POST /api/admin/community/:id { action: 'restore'|'remove'|'ban'|'unban' } → { ok } (ban = 그 글을 쓴 가족 정지) */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/community/[id]">) {
  const deny = await adminGuard();
  if (deny) return deny;
  try {
    const { id } = await ctx.params;
    const { action } = (await req.json().catch(() => ({}))) as { action?: string };
    const a = ACTIONS.find((x) => x === action);
    if (!a) return Response.json({ error: "bad action" }, { status: 400 });
    await adminAct(id, a);
    return Response.json({ ok: true });
  } catch (e) {
    return communityFail(e);
  }
}
