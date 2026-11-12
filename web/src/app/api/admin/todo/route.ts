import { adminGuard } from "@/lib/admin-auth";
import { todoStats } from "@/lib/admin-todo";

/** GET /api/admin/todo → 할 일 첫 화면 숫자 (추천 횟수 · 이번 주 · 신고 · AI 사용). */
export async function GET() {
  const deny = await adminGuard();
  if (deny) return deny;
  return Response.json(await todoStats());
}
