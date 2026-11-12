import { adminGuard } from "@/lib/admin-auth";
import { deleteRestaurant, foodTags, saveRestaurant, setRestaurantActive } from "@/lib/catalog";
import { FOOD_FACILITIES } from "@/lib/catalog-shape";
import { parseFoodInput } from "@/lib/restaurant-shape";

const UUID = /^[0-9a-f-]{36}$/;
const notFound = () => Response.json({ error: "그런 식당이 없어요" }, { status: 404 });

export async function PUT(req: Request, ctx: RouteContext<"/api/admin/restaurants/[id]">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();
  const parsed = parseFoodInput(await req.json().catch(() => null), { tags: await foodTags(), facilities: FOOD_FACILITIES });
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const res = await saveRestaurant(id, parsed.ok);
  return res ? Response.json(res) : notFound();
}

/** 켜기·끄기만 {active} (표 보기·카카오 초안 확인). 켤 때 음식 종류·좌표가 없으면 400. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/restaurants/[id]">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();
  const b = (await req.json().catch(() => null)) as { active?: unknown } | null;
  if (typeof b?.active !== "boolean") return Response.json({ error: "active(true·false)가 필요해요" }, { status: 400 });
  try {
    const res = await setRestaurantActive(id, b.active);
    return res ? Response.json(res) : notFound();
  } catch (e) {
    // 좌표 없는 예전 줄을 켜려 하면 DB 검사(restaurants_latlng_required)에 걸린다
    if ((e as { code?: string })?.code === "23514") return Response.json({ error: "좌표가 없어 켤 수 없어요 — 편집에서 좌표를 넣어 주세요" }, { status: 400 });
    throw e;
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/restaurants/[id]">) {
  const deny = await adminGuard();
  if (deny) return deny;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();
  const version = await deleteRestaurant(id);
  if (version === null) return notFound();
  return Response.json({ version });
}
