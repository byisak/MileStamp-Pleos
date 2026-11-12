import { carFromRequest } from "@/lib/auth";
import { loadFamily } from "@/lib/plan";
import { crowdFor, loadDwell } from "@/lib/dwell";
import { candidatePlaces } from "@/lib/festivals";
import { kstToday } from "@/lib/festival-shape";

/**
 * 차가 받는 우리 가족 설정 (차 토큰). 차는 켤 때·하루 초기화 때 받아 엔진의 가족 정보(FamilyProfile)로 쓴다.
 *   GET /api/car/family → { saved, kidAges, napStart, napLen, backBy, dinner, home: [위도, 경도] | null, favorites: [{name, lat, lng}],
 *                           dwellPref, dwellFactor, dwellN, placeDwell: {placeId: {avg, n}}, crowdDwell: {placeId: {p75, n}},
 *                           bedtime(분, 아이 잠자는 시간 · 기본 1260), lateReturn(분, 어른끼리 늦어도 귀가 · 기본 1380),
 *                           mealPlan(밥도 같이 짜기, 기본 false — 켜면 차 엔진도 /api/car/places restaurants로 식당을 넣는다) }
 * home이 null이면 폰에서 집을 아직 안 정한 것 → 차는 자기 집(데모 차는 북구청)을 그대로 쓴다. 좌표는 소수 셋째 자리.
 * 머무름: dwellFactor(우리 가족 배율 0.6~1.6)·dwellN(배운 횟수)·placeDwell(장소마다 우리 평균) + crowdDwell(오늘 같은 또래 P75, 10가족 이상만)
 * → 엔진 FamilyProfile.dwellEstimate가 그대로 쓴다. 또래 값은 날씨를 모르는 채(주말·평일 칸) 준다.
 */
export async function GET(req: Request) {
  const car = await carFromRequest(req);
  if (!car) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { family, saved } = await loadFamily(car.id);
  const day = kstToday();
  let dwell = { dwellPref: "normal", dwellFactor: 1.0, dwellN: 0, placeDwell: {}, crowdDwell: {} } as Record<string, unknown>;
  try {
    const [d, catalog] = await Promise.all([loadDwell(car.id), candidatePlaces(day)]);
    const indoor = new Map(catalog.map((p) => [p.id, p.indoor]));
    const crowd = await crowdFor(family.kidAges, day, false, (id) => indoor.get(id) ?? false);
    dwell = { dwellPref: d.pref, dwellFactor: d.factor, dwellN: d.n, placeDwell: d.places, crowdDwell: crowd };
  } catch (e) {
    console.error("머무름 읽기 실패", (e as Error).message);
  }
  return Response.json({ saved, ...family, ...dwell });
}
