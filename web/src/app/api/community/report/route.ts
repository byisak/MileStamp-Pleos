import { communityCaller, communityFail, readBody } from "@/lib/community-route";
import { report } from "@/lib/community";

/** POST /api/community/report { postId | handle, reason: 'spam'|'abuse'|'privacy'|'child_safety'|'other' } → { ok, hidden } */
export async function POST(req: Request) {
  const who = await communityCaller(req);
  if (who instanceof Response) return who;
  try {
    const r = await report(who.carId, await readBody(req));
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return communityFail(e);
  }
}
