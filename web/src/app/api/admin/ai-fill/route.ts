import { adminGuard } from "@/lib/admin-auth";
import { AiError } from "@/lib/ai-image";
import { aiFillMock, aiFillReady, FillError, fillOne, sourcesOf } from "@/lib/ai-fill";

export const maxDuration = 60;

const kindOf = (v: unknown) => (v === "place" || v === "restaurant" ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 12) : undefined);

function fail(e: unknown) {
  if (e instanceof FillError || e instanceof AiError) return Response.json({ error: e.message }, { status: e.status });
  console.error("AI 채우기 실패", e);
  return Response.json({ error: "AI 채우기에 실패했어요 · 잠시 뒤 다시" }, { status: 500 });
}

/**
 * POST /api/admin/ai-fill { kind: 'place'|'restaurant', id, fields?: string[], text?: 붙여 넣은 글, force? }
 *   → { id, name, asked, drafts, added, dropped, mock } — 초안(meta.drafts)만 저장, 진짜 칸·목록 버전은 그대로.
 */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = kindOf(b.kind);
  if (!kind || typeof b.id !== "string") return Response.json({ error: "kind·id가 필요해요" }, { status: 400 });
  try {
    return Response.json(await fillOne(kind, b.id, { fields: strs(b.fields), pasted: typeof b.text === "string" ? b.text : null, force: b.force === true }));
  } catch (e) {
    return fail(e);
  }
}

/** GET /api/admin/ai-fill?kind=&id= → { sources, ready, mock } (원문과 나란히 보기) · id 없으면 ready만. */
export async function GET(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const u = new URL(req.url);
  const kind = kindOf(u.searchParams.get("kind"));
  const id = u.searchParams.get("id");
  if (!kind || !id) return Response.json({ ready: aiFillReady(), mock: aiFillMock() });
  try {
    const sources = await sourcesOf(kind, id);
    if (!sources) return Response.json({ error: "그런 곳이 없어요" }, { status: 404 });
    return Response.json({ sources, ready: aiFillReady(), mock: aiFillMock() });
  } catch (e) {
    return fail(e);
  }
}
