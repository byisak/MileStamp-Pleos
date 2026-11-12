import { communityCaller, communityFail } from "@/lib/community-route";
import { feed, loadProfile, regionPulse } from "@/lib/community";
import { REGION } from "@/lib/community-shape";

/**
 * GET /api/community/feed?cursor= → { region, posts: FeedPost[], nextCursor, pulse | null(첫 쪽만), me: {handle, icon, hidden} | null }
 * 대구·경북만(전국은 나중에). 데모 차 글은 데모 차에게만 보인다. 가린 가족·숨긴 가족·정지된 가족·숨겨진 글은 빠진다.
 */
export async function GET(req: Request) {
  const who = await communityCaller(req);
  if (who instanceof Response) return who;
  try {
    const cursor = new URL(req.url).searchParams.get("cursor");
    const [page, pulse, prof] = await Promise.all([
      feed({ carId: who.carId, demo: who.demo }, cursor),
      cursor ? Promise.resolve(null) : regionPulse(),
      loadProfile(who.carId),
    ]);
    return Response.json({
      region: REGION, ...page, pulse,
      me: prof ? { handle: prof.handle, icon: prof.icon, hidden: prof.hidden } : null,
    });
  } catch (e) {
    return communityFail(e);
  }
}
