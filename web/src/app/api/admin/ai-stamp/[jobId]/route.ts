import { adminGuard } from "@/lib/admin-auth";
import { getJob, setChosen } from "@/lib/ai-stamp-jobs";

/** 관리자: AI 작업 진행 상황 · 후보 주소 (화면이 2초마다). */
export async function GET(_req: Request, ctx: RouteContext<"/api/admin/ai-stamp/[jobId]">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const job = await getJob((await ctx.params).jobId);
  if (!job) return Response.json({ error: "그런 작업이 없어요" }, { status: 404 });
  return Response.json({ job });
}

/** 관리자: 고른 후보 기록 { chosen } (등록할 때). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/ai-stamp/[jobId]">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => ({}))) as { chosen?: number };
  const n = Number(b.chosen);
  if (!Number.isInteger(n) || n < 0 || n > 9) return Response.json({ error: "후보 번호가 이상해요" }, { status: 400 });
  if (!(await setChosen((await ctx.params).jobId, n))) return Response.json({ error: "끝난 작업이 아니에요" }, { status: 404 });
  return Response.json({ ok: true });
}
