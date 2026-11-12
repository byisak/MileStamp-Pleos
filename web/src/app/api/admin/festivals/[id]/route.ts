import { adminGuard } from "@/lib/admin-auth";
import { deleteFestival, saveFestival } from "@/lib/festivals";
import { parseFestivalInput } from "@/lib/festival-shape";

/** 관리자: 축제 고치기 → 목록 버전 +1. */
export async function PUT(req: Request, ctx: RouteContext<"/api/admin/festivals/[id]">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const { id } = await ctx.params;
  const parsed = parseFestivalInput(await req.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const res = await saveFestival(id, parsed.ok, false);
  if (!res) return Response.json({ error: "그런 축제가 없어요" }, { status: 404 });
  return Response.json(res);
}

/** 관리자: 축제 지우기 (이미 찍힌 도장 소식은 남는다). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/festivals/[id]">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const { id } = await ctx.params;
  const version = await deleteFestival(id);
  if (version === null) return Response.json({ error: "그런 축제가 없어요" }, { status: 404 });
  return Response.json({ version });
}
