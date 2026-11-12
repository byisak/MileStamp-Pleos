import { adminGuard } from "@/lib/admin-auth";
import { getJob } from "@/lib/ai-stamp-jobs";

/**
 * 관리자: 후보 그림을 같은 주소로 다시 보내기 ?n=0 — 브라우저 캔버스(원 찾기·자르기)가 R2 그림을 읽으려면 CORS가 필요해서
 * 서버가 대신 받아 준다. 작업에 저장된 주소만 받는다.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/admin/ai-stamp/[jobId]/image">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const job = await getJob((await ctx.params).jobId);
  const n = Number(new URL(req.url).searchParams.get("n") ?? 0);
  const c = job?.candidates[n];
  if (!c) return Response.json({ error: "그런 후보가 없어요" }, { status: 404 });
  const url = /^https?:/.test(c.url) ? c.url : new URL(c.url, req.url).href;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return Response.json({ error: `그림을 못 받았어요 (${res.status})` }, { status: 502 });
  return new Response(await res.arrayBuffer(), {
    headers: { "Content-Type": res.headers.get("content-type") ?? "image/png", "Cache-Control": "private, max-age=3600" },
  });
}
