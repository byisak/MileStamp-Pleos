import { adminGuard } from "@/lib/admin-auth";
import { kstToday } from "@/lib/festival-shape";
import { deactivateEndedFestivals } from "@/lib/festivals";

/** POST /api/admin/festivals/ended → 끝났는데 켜진 축제 모두 끄기 { ids, version } (끈 게 없으면 version null). */
export async function POST() {
  const deny = await adminGuard();
  if (deny) return deny;
  return Response.json(await deactivateEndedFestivals(kstToday()));
}
