import { communityCaller, communityFail } from "@/lib/community-route";
import { savedPosts } from "@/lib/community";

/** GET /api/community/saved → { posts: FeedPost[] } — 📌 담은 글 (최근 담은 순) */
export async function GET(req: Request) {
  const who = await communityCaller(req);
  if (who instanceof Response) return who;
  try {
    return Response.json({ posts: await savedPosts({ carId: who.carId, demo: who.demo }) });
  } catch (e) {
    return communityFail(e);
  }
}
