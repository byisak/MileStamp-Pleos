import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin-auth";

export async function POST() {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/" });
  return new Response(null, { status: 303, headers: { Location: "/admin" } });
}
