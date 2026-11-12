import { communityCaller, communityFail, readBody } from "@/lib/community-route";
import { createPost } from "@/lib/community";

/**
 * POST /api/community/posts → { post: FeedPost } (내 글은 pending=true면 '집에 도착하면 함께에 보여요')
 *  - { kind: 'stamp', placeId, rare?, festivalId?, text? } — 이 가족이 받은 도장만
 *  - { kind: 'trip', eventId?, text? } — 오늘 요약(집 도착) 소식의 장소 이름·도장 수 (eventId 없으면 마지막 요약)
 *  - { kind: 'tip', placeId, good: boolean, tags: ['유모차 OK'…], text? } — 도장 받은 곳만
 * 글은 140자, 하루 10번(429), 욕설·전화번호·계좌·학교 이름·링크면 400 + 안내 글.
 */
export async function POST(req: Request) {
  const who = await communityCaller(req);
  if (who instanceof Response) return who;
  try {
    return Response.json({ post: await createPost(who.phone, await readBody(req)) });
  } catch (e) {
    return communityFail(e);
  }
}
