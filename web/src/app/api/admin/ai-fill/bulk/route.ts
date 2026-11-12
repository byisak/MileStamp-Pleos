import { adminGuard } from "@/lib/admin-auth";
import { AiError } from "@/lib/ai-image";
import { FillError, fillMany } from "@/lib/ai-fill";

export const maxDuration = 300;

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined);

/**
 * POST /api/admin/ai-fill/bulk { kind, ids?, skip?, limit? (≤10) } — '확인 필요'·빈 칸을 AI 초안으로 한 묶음.
 *   → { done: [{id, name, added, dropped} | {id, name, error}], remaining, stopped, mock }. 화면은 remaining이 있으면 다시 부른다.
 */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = b.kind === "place" || b.kind === "restaurant" ? b.kind : null;
  if (!kind) return Response.json({ error: "kind가 필요해요" }, { status: 400 });
  try {
    return Response.json(await fillMany(kind, { ids: strs(b.ids), skip: strs(b.skip), limit: typeof b.limit === "number" ? b.limit : undefined }));
  } catch (e) {
    if (e instanceof FillError || e instanceof AiError) return Response.json({ error: e.message }, { status: e.status });
    console.error("AI 한꺼번에 채우기 실패", e);
    return Response.json({ error: "AI 채우기에 실패했어요 · 잠시 뒤 다시" }, { status: 500 });
  }
}
