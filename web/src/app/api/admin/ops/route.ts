import { adminGuard } from "@/lib/admin-auth";
import { opsStats } from "@/lib/catalog";

export async function GET() {
  const deny = await adminGuard();
  if (deny) return deny;
  return Response.json(await opsStats());
}
