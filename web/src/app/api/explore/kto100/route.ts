import { adminGuard } from "@/lib/admin-auth";
import { curatedRows, exploreHome, exploreKto100, fillCuratedFromTour, saveCurated, setCuratedPlace, withCompanionSign } from "@/lib/explore";
import { parseCompanion } from "@/lib/planner";
import { parseMaxMin, parseRegions, parseSort } from "@/lib/explore-filter";
import { NEAR_MAX_MIN } from "@/lib/explore-shape";
import { KTO100_LABEL, KTO100_LIST, parseCuratedTable } from "@/lib/kto100-shape";
import { parseFrom } from "@/lib/kakao-local-shape";
import { whoFromRequest } from "@/lib/plan";
import { TourUnavailable } from "@/lib/tourapi";

export const maxDuration = 60;

/**
 * 한국관광 100선 (2025~2026 판, 표 curated_places list 'kto100-2025')
 *   GET /api/explore/kto100?[maxMin=60|120|180][&regions=11,27][&sort=popular|distance][&from=lat,lng][&lat&lng] — 폰·차 공용 인증 (/api/plan과 같음)
 *   → { items: ExploreItem[], label: '한국관광 100선', list, total, maxMin, regions, sort, regionCounts, regionCountsAll, popularReady, scope, nearMaxMin, home }
 *     거르기·정렬은 축제와 같다(explore-filter.ts). from=lat,lng = 기준 위치(없으면 집, 답 ref). 옛 앱의 scope=near = maxMin 120, scope=all·없음 = 제한 없음
 *     우리 명소와 같은 곳은 kind 'place'·우리 id·ourStamp, 아니면 kind 'tour'·'ext:tour:<contentId>'(번호 모르면 'ext:kto100:<no>')
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const maxMin = parseMaxMin(q);
  const regions = parseRegions(q.get("regions"));
  const sort = parseSort(q.get("sort"));
  const scope = maxMin != null && maxMin <= 120 ? "near" : "all";
  const home = await exploreHome(who, q);
  const r = await exploreKto100({ home, query: { maxMin, regions, sort } });
  return Response.json({
    // with(선택) = 누구랑 가요? → 줄마다 fitSign·fitNote
    items: await withCompanionSign(r.items, parseCompanion(q.get("with"))), label: KTO100_LABEL, list: KTO100_LIST, total: r.total, maxMin, regions, sort,
    regionCounts: r.regionCounts, regionCountsAll: r.regionCountsAll, popularReady: r.popularReady,
    scope, nearMaxMin: NEAR_MAX_MIN, home: !!home, ref: !!parseFrom(q.get("from")),
  });
}

/**
 * 관리자만 (쿠키): 100선 표 고치기
 *   { action: 'upload', text: '<CSV 또는 TSV 글>' } — 첫 줄 칸 이름(순번·권역·지역·이름·위도·경도·주소·contentid…), 판에 없는 이름은 지움
 *   { action: 'fill' }  — TourAPI로 번호·좌표·사진 채우기 (빈 곳 25곳씩, DATA_GO_KR_KEY 필요)
 *   { action: 'link', name, placeId: 'chimsan' | null } — 우리 명소와 직접 묶기 / 풀기(null = 이름·거리로 자동)
 * 답 { rows, …결과 }
 */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const list = KTO100_LIST;
  try {
    if (b.action === "upload") {
      const text = typeof b.text === "string" ? b.text : "";
      if (text.length > 500_000) return Response.json({ error: "파일이 너무 커요" }, { status: 413 });
      const { rows, errors } = parseCuratedTable(text);
      if (!rows.length) return Response.json({ error: errors[0] ?? "읽을 줄이 없어요", errors }, { status: 400 });
      if (rows.length < 50 && b.force !== true) {
        return Response.json({ error: `${rows.length}곳뿐이에요 — 판 전체(100곳)를 올려 주세요 (판에 없는 곳은 지워져요)`, errors }, { status: 400 });
      }
      const saved = await saveCurated(list, rows);
      return Response.json({ saved, errors, rows: await curatedRows(list) });
    }
    if (b.action === "fill") {
      const r = await fillCuratedFromTour(list);
      return Response.json({ ...r, rows: await curatedRows(list) });
    }
    if (b.action === "link") {
      const name = String(b.name ?? "");
      const placeId = b.placeId == null || b.placeId === "" ? null : String(b.placeId);
      if (placeId && !/^[a-z][a-z0-9_]{1,23}$/.test(placeId)) return Response.json({ error: "명소 id가 이상해요" }, { status: 400 });
      const n = await setCuratedPlace(list, name, placeId);
      if (!n) return Response.json({ error: "그 이름이 표에 없어요" }, { status: 404 });
      return Response.json({ rows: await curatedRows(list) });
    }
    return Response.json({ error: "action은 upload·fill·link" }, { status: 400 });
  } catch (e) {
    if (e instanceof TourUnavailable) return Response.json({ error: e.message }, { status: e.reason === "nokey" ? 412 : 503 });
    throw e;
  }
}
