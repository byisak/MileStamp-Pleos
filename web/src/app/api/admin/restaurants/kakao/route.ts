import { adminGuard } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { insertKakaoDrafts, knownKakaoIds } from "@/lib/catalog";
import { KakaoUnavailable, kakaoCategory, kakaoKey } from "@/lib/kakao-local";
import { kakaoDraft, pickKakaoFoods, type FoodInput, type KakaoFood } from "@/lib/restaurant-shape";
import { kstToday } from "@/lib/festival-shape";

export const maxDuration = 120;

/**
 * 카카오에서 근처 식당 가져오기 (관리자, docs/장소-데이터-구조-계획.md §5.3).
 *   POST {placeId} 또는 {region: '대구'|'경북'|'대구 북구' …} [, take: 1~5 (기본 3), cafes: true(카페도 1곳씩), radiusM: 300~3000 (기본 1500)]
 * 장소마다 카카오 로컬 카테고리 검색(FD6 음식점, cafes면 CE7 카페)을 [radiusM] 안 거리순으로 불러 가까운 [take]곳을
 * 꺼진 초안(active=false · meta.src 'kakao' · 확인 필요)으로 넣는다. 같은 카카오 번호는 건너뛰고, 그 장소에 이미 붙은 식당이
 * [take]곳 이상이면 그 장소는 건너뛴다(여러 번 눌러도 장소마다 [take]곳까지). 관리자가 훑고 켠다.
 * 카카오 답은 tour_cache 'kakao:cat:…'에 7일 저장 (키 KAKAO_REST_KEY — 서버에서만). 키가 없으면 503 (로컬 시험은 KAKAO_LOCAL_MOCK=1).
 * 한 번에 장소 60곳까지.
 */
const MAX_PLACES = 60;

export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => null)) as { placeId?: unknown; region?: unknown; take?: unknown; cafes?: unknown; radiusM?: unknown } | null;
  if (!b) return Response.json({ error: "내용이 비었어요" }, { status: 400 });
  const take = b.take == null ? 3 : Number(b.take);
  if (!Number.isInteger(take) || take < 1 || take > 5) return Response.json({ error: "take는 1~5예요" }, { status: 400 });
  const radius = b.radiusM == null ? 1500 : Number(b.radiusM);
  if (!Number.isInteger(radius) || radius < 300 || radius > 3000) return Response.json({ error: "radiusM은 300~3000이에요" }, { status: 400 });
  if (!kakaoKey() && process.env.KAKAO_LOCAL_MOCK !== "1") {
    return Response.json({ error: "카카오 키(KAKAO_REST_KEY)가 서버에 없어요" }, { status: 503 });
  }
  let places: { id: string; name: string; lat: number; lng: number }[];
  if (typeof b.placeId === "string" && b.placeId) {
    places = await sql`select id, name, lat, lng from places where id = ${b.placeId}`;
    if (!places.length) return Response.json({ error: "그런 장소가 없어요" }, { status: 404 });
  } else if (typeof b.region === "string" && b.region.trim().length >= 2) {
    const region = b.region.trim();
    places = await sql`
      select id, name, lat, lng from places
      where active and coalesce(kind, 'spot') <> 'drive' and region like ${region + "%"}
      order by id limit ${MAX_PLACES}`;
    if (!places.length) return Response.json({ error: `'${region}'로 시작하는 켜진 장소가 없어요` }, { status: 404 });
  } else {
    return Response.json({ error: "placeId나 region(대구·경북 …)을 주세요" }, { status: 400 });
  }

  const have = await knownKakaoIds();
  // 장소마다 이미 붙은 식당 수 (켠 것·초안 모두)
  const counts = new Map((await sql<{ place_id: string; n: number }[]>`
    select place_id, count(*)::int as n from restaurants where place_id is not null group by place_id`).map((r) => [r.place_id, r.n]));
  const today = kstToday();
  const drafts: FoodInput[] = [];
  const per: { placeId: string; name: string; found: number; picked: string[]; error?: string }[] = [];
  for (const p of places) {
    const groups: ("FD6" | "CE7")[] = b.cafes === true ? ["FD6", "CE7"] : ["FD6"];
    const picked: KakaoFood[] = [];
    let found = 0;
    const need = take - (counts.get(p.id) ?? 0);
    if (need <= 0) {
      per.push({ placeId: p.id, name: p.name, found: 0, picked: [], error: `이미 ${counts.get(p.id)}곳이 붙어 있어요` });
      continue;
    }
    try {
      for (const g of groups) {
        const r = await kakaoCategory(g, p.lat, p.lng, radius);
        found += r.data.length;
        const got = pickKakaoFoods(r.data, have, g === "CE7" ? 1 : need, radius);
        for (const x of got) { have.add(x.kakaoId); picked.push(x); }
      }
      drafts.push(...picked.map((x) => kakaoDraft(x, p.id, today)));
      per.push({ placeId: p.id, name: p.name, found, picked: picked.map((x) => x.name) });
    } catch (e) {
      if (e instanceof KakaoUnavailable && e.reason === "nokey") return Response.json({ error: e.message }, { status: 503 });
      per.push({ placeId: p.id, name: p.name, found, picked: [], error: e instanceof Error ? e.message : "카카오 오류" });
    }
  }
  const res = await insertKakaoDrafts(drafts);
  return Response.json({ places: places.length, added: res.added, version: res.version, per });
}
