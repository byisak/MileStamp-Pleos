import { communityCaller, communityFail, readBody } from "@/lib/community-route";
import { react } from "@/lib/community";
import { REACTIONS, type ReactionKind } from "@/lib/community-shape";

/** POST /api/community/posts/:id/react { kind: 'clap'|'want'|'save', on: boolean } → { post } (새 수·내 반응) */
export async function POST(req: Request, ctx: RouteContext<"/api/community/posts/[id]/react">) {
  const who = await communityCaller(req);
  if (who instanceof Response) return who;
  try {
    const { id } = await ctx.params;
    const b = await readBody(req);
    if (!REACTIONS.includes(b.kind as ReactionKind)) return Response.json({ error: "bad kind" }, { status: 400 });
    return Response.json({ post: await react({ carId: who.carId, demo: who.demo }, id, b.kind as ReactionKind, b.on !== false) });
  } catch (e) {
    return communityFail(e);
  }
}
