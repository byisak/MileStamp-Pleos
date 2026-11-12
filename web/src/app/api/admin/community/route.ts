import { adminGuard } from "@/lib/admin-auth";
import { adminHandleReports, adminReported, createNotice } from "@/lib/community";
import { communityFail } from "@/lib/community-route";

/** GET /api/admin/community → { posts: AdminPost[], handles } (숨겨진 글 · 신고 들어온 글 · 운영팀 글 · 별명 신고) */
export async function GET() {
  const deny = await adminGuard();
  if (deny) return deny;
  try {
    const [posts, handles] = await Promise.all([adminReported(), adminHandleReports()]);
    return Response.json({ posts, handles });
  } catch (e) {
    return communityFail(e);
  }
}

/** POST /api/admin/community { text, placeIds?: string[] } → { id } — 운영팀 글 올리기 */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  try {
    const b = (await req.json().catch(() => ({}))) as { text?: unknown; placeIds?: unknown };
    const ids = Array.isArray(b.placeIds) ? b.placeIds.filter((x): x is string => typeof x === "string") : [];
    return Response.json({ id: await createNotice(typeof b.text === "string" ? b.text : "", ids) });
  } catch (e) {
    return communityFail(e);
  }
}
