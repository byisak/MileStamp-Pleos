import { carFromRequest } from "@/lib/auth";
import { closedDatesOf, closedDaysOf, loadPlaces } from "@/lib/plan";
import { loadTagVocab } from "@/lib/catalog";
import {
  fitExtraOf, hoursRowsLoose, parseClosedRules, parseMoments, parseParking, parsePrice, parseRoute, vocabTags, PLACE_KINDS,
} from "@/lib/place-attrs-shape";
import { normalizePoints, radiusOf } from "@/lib/catalog-shape";
import { carFestivals } from "@/lib/festivals";
import { fitView } from "@/lib/companion-shape";
import { engineRestaurants } from "@/lib/catalog";
import { carRestaurantJson } from "@/lib/restaurant-shape";

/**
 * 차 엔진용 추천 후보 장소 — 인터넷이 안 될 때 차가 같은 규칙으로 계산하려고 하루 한 번 받아 저장한다.
 * 칸 이름은 엔진 Place와 같게 (시각은 0시부터 분, 상시 개방은 0~1440).
 * points = 도착 지점(원) 여러 개 — 차는 어느 원 안에서든 P단이면 그 장소로 본다. radiusM = 가장 큰 원(예전 차용).
 * stamp = 관리자에서 올린 도장 그림(없으면 url null → 차에 든 그림). 차는 바뀐 것만 files/stamps/<id>_<ver>.webp로 받는다.
 * 축제(지금 열리는 것 — 오늘~내일과 기간이 겹침)도 후보 장소로 같이: festivalId·startDate·endDate·weight·attachedPlaceId·
 * closedDays·season이 붙는다. 엔진이 그날 열리는지(기간·쉬는 요일)를 다시 보고, 열리면 붙은 명소 대신 추천한다.
 * 11/3 장소 구조 칸(새 이름만 더함 — 옛 차는 무시): openHours(운영 시간 줄, 엔진 Place.hours — 그날 맞는 줄의 시각을 씀) ·
 * closedRules(closedDates에는 이미 날짜로 펴서 넣음) · parking · price · moments · kind · route · regionCode · fitKidAge · fitEvening · vocabTags.
 * 11/3 식당(새 키 restaurants — 옛 차는 무시): 켜진 식당 [{id, name, lat, lng, cuisine, priceLevel, kid[], parking {has, fee}, wait, meal,
 * dwellMin, fit, tags, openHours(브레이크·lastOrderMin 포함), placeId}] — 가족 '밥도 같이 짜기'를 켜면 차 엔진(Meals)이 인터넷 없이도 밥 자리를 넣는다.
 */
export async function GET(req: Request) {
  const car = await carFromRequest(req);
  if (!car) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [rows, festivals, vocab, foods] = await Promise.all([loadPlaces(), carFestivals(), loadTagVocab(), engineRestaurants()]);
  return Response.json({
    places: [
      ...rows.map((r) => {
        const points = normalizePoints(r.points, r.lat, r.lng);
        return {
          id: r.id, name: r.name, lat: r.lat, lng: r.lng, indoor: r.indoor,
          dwellP80Min: r.dwell_p80, kidFit: r.kid_fit, openMin: r.open_min, closeMin: r.close_min,
          popular: r.popular, stampable: r.stampable, tags: r.tags, hours: r.hours, group: r.grp,
          // 누구랑 가요? — 동행별 적합도 {kids, couple, friends, solo} · 어른 머무는 분(null = dwellP80Min × 0.8)
          fit: fitView(r.kid_fit, r.fit), adultDwellMin: r.dwell_adult ?? null,
          // 쉬는 요일(0=일)·임시 휴무 날짜 — 엔진 forDay가 그날 쉬는 곳을 뺀다
          // 쉬는 요일(0=일)·임시 휴무 + 쉬는 날 규칙을 펼친 날짜 — 엔진 forDay가 그날 쉬는 곳을 뺀다
          closedDays: closedDaysOf(r), closedDates: closedDatesOf(r),
          points, radiusM: radiusOf(points), album: r.album,
          stamp: { url: r.stamp_url, bwUrl: r.stamp_bw_url, version: r.stamp_version },
          ...structured(r, vocab),
        };
      }),
      ...festivals,
    ],
    restaurants: foods.map(carRestaurantJson),
  });
}

const ok = <T,>(r: { ok: T } | { error: string }): T | null => ("ok" in r ? r.ok : null);

/** 장소 구조 칸 (새 이름만). 이상한 값은 빈 칸으로. */
function structured(r: Awaited<ReturnType<typeof loadPlaces>>[number], vocab: Awaited<ReturnType<typeof loadTagVocab>>) {
  const openHours = hoursRowsLoose(r.open_hours);
  const kind = PLACE_KINDS.find((k) => k === r.kind) ?? "spot";
  const extra = fitExtraOf(r.fit);
  return {
    openHours,
    closedRules: parseClosedRules(r.closed_rules ?? []) ?? [],
    parking: ok(parseParking(r.parking ?? null)),
    price: ok(parsePrice(r.price ?? null)),
    moments: ok(parseMoments(r.moments ?? null, { hours: openHours, open: r.open_min, close: r.close_min })),
    kind,
    route: kind === "drive" ? ok(parseRoute(r.route ?? null, kind)) : null,
    regionCode: r.region_code ?? null,
    fitKidAge: extra.kid_age ?? null,
    fitEvening: extra.evening ?? null,
    vocabTags: vocabTags(r.tags ?? [], vocab),
  };
}
