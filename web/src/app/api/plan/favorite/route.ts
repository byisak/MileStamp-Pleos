import { whoFromRequest } from "@/lib/plan";
import { loadFavPlaces, setFavPlace } from "@/lib/history";
import { EXT_ID } from "@/lib/ext";

/**
 * 즐겨찾는 장소 (추천 점수 +1, '왜?' 설명 '즐겨찾는 곳이에요') — 폰·차 공용.
 *   GET  /api/plan/favorite → { placeIds: [...] }
 *   POST /api/plan/favorite { placeId, on: true|false } → { placeIds }
 * 장소 id = 우리 명소·축제 id 또는 바깥 장소 'ext:tour:<번호>'. 저장은 families.fav_places (30곳까지, 넘치면 오래된 것부터).
 * 바꾸면 다음 새 계산부터 반영 (이미 받은 오늘 계획은 그대로).
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ placeIds: await loadFavPlaces(who.carId) });
}

export async function POST(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { placeId?: unknown; on?: unknown } | null;
  const id = body?.placeId;
  if (typeof id !== "string" || !(/^[a-z0-9-]{1,40}$/.test(id) || EXT_ID.test(id))) return Response.json({ error: "placeId가 이상해요" }, { status: 400 });
  if (typeof body!.on !== "boolean") return Response.json({ error: "on은 true/false예요" }, { status: 400 });
  try {
    return Response.json({ placeIds: await setFavPlace(who.carId, id, body!.on) });
  } catch {
    // 운영 DB에 families.fav_places 칸이 아직 없을 때 (schema.sql 반영 전)
    return Response.json({ error: "즐겨찾기를 아직 저장할 수 없어요" }, { status: 503 });
  }
}
