import { adminGuard } from "@/lib/admin-auth";
import { importSpots, isMissingTable, linkSpot, listSpots, setSpotStatus, spotFacets } from "@/lib/spot100";
import { parseSpotQuery, parseSpotRows, SPOT_IMPORT_MAX, SPOT_STATUSES, type SpotStatus } from "@/lib/spot100-shape";

export const maxDuration = 60;

const NO_TABLE = { error: "후보 표가 아직 없어요 — web/db/migrate-2026-11-12-spot100.sql을 먼저 돌려 주세요" };

/**
 * 관리자만 (쿠키): 명소발굴 100x100 후보 목록 — 한 줄 설명(topics[].n)이 들어 있어서 폰·차·공개 API에는 절대 없다.
 *   GET /api/admin/spots?[sido=27][&theme=4][&topic=3][&cid=1|0][&status=new|ok|hidden][&q=이름·주소][&page=1][&size=30]
 *   → { rows, total, page, size, facets: { total, withContentId, sido: {코드: 수}, status: {…} } }
 */
export async function GET(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const q = parseSpotQuery(new URL(req.url).searchParams);
  try {
    const [r, facets] = await Promise.all([listSpots(q), spotFacets()]);
    return Response.json({ ...r, page: q.page, size: q.size, facets });
  } catch (e) {
    if (isMissingTable(e)) return Response.json(NO_TABLE, { status: 503 });
    throw e;
  }
}

/**
 * 관리자만:
 *   { action: 'import', rows: [...] }            — 한 번에 500곳까지 (tools/spot100/spot100-2026.json 의 rows 조각). 몇 번 올려도 같고 status·묶음은 지키며, 목록에 없는 곳은 지우지 않음
 *   { action: 'status', keys: [key…], status }   — new·ok·hidden
 *   { action: 'link', key, placeId | null }      — 우리 명소와 묶기(묶으면 ok) / 풀기. '명소로 올리기'로 명소를 만든 뒤 여기서 묶는다
 */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.action === "import") {
      const { rows, errors } = parseSpotRows(b.rows);
      if (!rows.length) return Response.json({ error: errors[0] ?? "올릴 줄이 없어요", errors }, { status: 400 });
      return Response.json({ saved: await importSpots(rows), errors: errors.slice(0, 20), skipped: errors.length, max: SPOT_IMPORT_MAX });
    }
    if (b.action === "status") {
      const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === "string").slice(0, 200) : [];
      if (!keys.length || !(SPOT_STATUSES as readonly string[]).includes(String(b.status))) return Response.json({ error: "keys·status가 필요해요" }, { status: 400 });
      return Response.json({ updated: await setSpotStatus(keys, b.status as SpotStatus) });
    }
    if (b.action === "link") {
      const key = typeof b.key === "string" ? b.key : "";
      const placeId = b.placeId == null || b.placeId === "" ? null : String(b.placeId);
      if (placeId && !/^[a-z][a-z0-9_]{1,23}$/.test(placeId)) return Response.json({ error: "명소 id가 이상해요" }, { status: 400 });
      if (!(await linkSpot(key, placeId))) return Response.json({ error: "그 후보가 없어요" }, { status: 404 });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "action은 import·status·link" }, { status: 400 });
  } catch (e) {
    if (isMissingTable(e)) return Response.json(NO_TABLE, { status: 503 });
    throw e;
  }
}
