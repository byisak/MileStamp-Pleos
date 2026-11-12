import { adminGuard } from "@/lib/admin-auth";
import { addTagVocab, loadTagVocab } from "@/lib/catalog";

/** 관리자: 태그 단어장 (추천은 단어장에 있는 말만 쓴다). */
export async function GET() {
  const deny = await adminGuard();
  if (deny) return deny;
  return Response.json({ vocab: await loadTagVocab() });
}

/** 관리자: 단어장에 말 더하기 { tag, category } → 목록 버전 +1. */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tag = String(b.tag ?? "").replace(/^#/, "").trim();
  const category = String(b.category ?? "").trim();
  if (!tag || tag.length > 12) return Response.json({ error: "말은 1~12자예요" }, { status: 400 });
  if (!category || category.length > 12) return Response.json({ error: "묶음 이름을 골라 주세요" }, { status: 400 });
  return Response.json({ vocab: await addTagVocab(tag, category) });
}
