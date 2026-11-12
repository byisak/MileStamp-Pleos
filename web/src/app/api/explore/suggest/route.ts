import { exploreHome, exploreSuggest, withCompanionSign } from "@/lib/explore";
import { parseCompanion } from "@/lib/planner";
import { cleanQuery } from "@/lib/explore-shape";
import { whoFromRequest } from "@/lib/plan";

/**
 * 직접 찾기 · 자동완성 (docs/검색-거리순-계획.md ②, 폰·차 공용 인증 = /api/plan)
 *   GET /api/explore/suggest?q=팔공산[&from=lat,lng]
 * 폰은 2글자 이상·0.3초 쉬면 부르고, 앞 요청은 취소한다. 카카오 로컬(서버 키 KAKAO_REST_KEY, 같은 검색어 하루 저장).
 * 답 { items: SuggestItem[], q, ref, address, kakao: {ok, …} }
 *   items 순서: 우리 명소(이름 맞는 곳, kind 'place', '우리 도장') → 주소처럼 보이면 '이 주소로'(kind 'address', id 'ext:pin:<lat>,<lng>')
 *   → 카카오 장소(kind 'kakao', id 'ext:kakao:<장소 id>'): 관광명소·문화시설 → 공원·체험·키즈 → 그 밖 → 음식점·카페
 *   줄마다 name·label(종류)·addr·lat·lng·driveMin(기준 위치에서 차로 몇 분). 카카오가 안 되면 kakao.ok=false, 우리 명소만
 *   검색어가 2글자 미만이면 400
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const q = cleanQuery(params.get("q"));
  if (!q) return Response.json({ error: "두 글자 이상 적어 주세요" }, { status: 400 });
  const ref = await exploreHome(who, params);
  const r = await exploreSuggest({ ref, q });
  // with(선택) = 누구랑 가요? → 줄마다 fitSign·fitNote
  return Response.json({ items: await withCompanionSign(r.items, parseCompanion(new URL(req.url).searchParams.get("with"))), q, ref: !!ref, address: r.address ?? false, kakao: r.kakao });
}
