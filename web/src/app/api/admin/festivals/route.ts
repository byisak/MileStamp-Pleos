import { adminGuard } from "@/lib/admin-auth";
import { catalogVersion } from "@/lib/catalog";
import { loadAdminFestivals, saveFestival } from "@/lib/festivals";
import { parseFestivalInput, validFestivalId } from "@/lib/festival-shape";

/** 관리자: 축제 전부 + 목록 버전. */
export async function GET() {
  const deny = await adminGuard();
  if (deny) return deny;
  const [festivals, version] = await Promise.all([loadAdminFestivals(), catalogVersion()]);
  return Response.json({ festivals, version });
}

/** 관리자: 새 축제 { id: 'fest-…', …칸 } → 저장하고 목록 버전 +1. */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(b.id ?? "").trim();
  if (!validFestivalId(id)) return Response.json({ error: "id는 'fest-' 뒤에 영문 소문자·숫자·- (2~31자)예요" }, { status: 400 });
  const parsed = parseFestivalInput(b);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const res = await saveFestival(id, parsed.ok, true);
  if (!res) return Response.json({ error: "같은 id가 이미 있어요" }, { status: 409 });
  return Response.json(res);
}
