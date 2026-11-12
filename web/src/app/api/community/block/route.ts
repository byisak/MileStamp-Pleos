import { communityCaller, communityFail, readBody } from "@/lib/community-route";
import { block } from "@/lib/community";

/** POST /api/community/block { postId } → { ok } — 그 글을 쓴 가족을 가린다 (가족 id는 폰에 안 나가므로 글로) */
export async function POST(req: Request) {
  const who = await communityCaller(req);
  if (who instanceof Response) return who;
  try {
    await block(who.carId, (await readBody(req)).postId);
    return Response.json({ ok: true });
  } catch (e) {
    return communityFail(e);
  }
}
