import { whoFromRequest, loadFamily, familyHome, DEMO_HOME_CELL, toProfile } from "@/lib/plan";
import { crowdTextFor, profileWithDwell } from "@/lib/dwell";
import { dwellView } from "@/lib/dwell-shape";
import { candidatePlaces } from "@/lib/festivals";
import { kstToday } from "@/lib/festival-shape";
import { dwellChip } from "@/lib/planner";

/**
 * 장소마다 '보통 머무는 시간' — 폰(도장북·추천의 장소 자세히)·차 공용.
 *   GET /api/family/dwell              → { chip, places: { placeId: { minutes, source, n, text } } }
 *   GET /api/family/dwell?place=dgsm   → { chip, place: { minutes, source, n, text, crowd } }
 *     source: "family"(우리 가족 기록 n번) | "crowd"(같은 또래 n가족) | "base"(조사값 4살 기준) — 엔진 dwellEstimate와 같은 값
 *     crowd: "같은 또래 가족 보통 2시간 10분 (23가족)" — 10가족 이상 모였을 때만, 아니면 null (가족마다 값은 안 나감)
 *     chip: "우리 가족은 보통 1.2배 머물러요" (2번 넘게 배웠을 때) 또는 null
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const placeId = new URL(req.url).searchParams.get("place");
  const day = kstToday();
  const [{ family, homeCell }, catalog] = await Promise.all([loadFamily(who.carId), candidatePlaces(day)]);
  const home = familyHome(family, homeCell, DEMO_HOME_CELL)!;
  const profile = await profileWithDwell(who.carId, toProfile(family, home), day, false, catalog);
  const chip = dwellChip(profile);
  if (placeId) {
    const p = catalog.find((x) => x.id === placeId);
    if (!p) return Response.json({ error: "모르는 장소예요" }, { status: 404 });
    const crowd = await crowdTextFor(p.id, family.kidAges).catch(() => null);
    return Response.json({ chip, place: { ...dwellView(profile, p), crowd } });
  }
  return Response.json({ chip, places: Object.fromEntries(catalog.map((p) => [p.id, dwellView(profile, p)])) });
}
