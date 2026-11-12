import { adminGuard } from "@/lib/admin-auth";
import { foodTags, loadRestaurants, saveRestaurant } from "@/lib/catalog";
import { FOOD_FACILITIES } from "@/lib/catalog-shape";
import { parseFoodInput } from "@/lib/restaurant-shape";

/** 관리자 식당 목록 (꺼진 초안 포함) + 식당 태그 단어장. */
export async function GET() {
  const deny = await adminGuard();
  if (deny) return deny;
  const [restaurants, tags] = await Promise.all([loadRestaurants(), foodTags()]);
  return Response.json({ restaurants, tags });
}

/** 새 식당 (좌표 필수 · 켤 때 음식 종류 1~2개). */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const parsed = parseFoodInput(await req.json().catch(() => null), { tags: await foodTags(), facilities: FOOD_FACILITIES });
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  return Response.json(await saveRestaurant(null, parsed.ok));
}
