import { cookies } from "next/headers";
import { ADMIN_COOKIE, ADMIN_HOURS, adminPasswordSet, checkPassword, newSessionValue } from "@/lib/admin-auth";

/** 관리자 로그인: { password } 또는 폼 → 맞으면 12시간 쿠키. 폼으로 오면 /admin으로 되돌린다. */
export async function POST(req: Request) {
  const form = (req.headers.get("content-type") ?? "").includes("application/json") ? null : await req.formData().catch(() => null);
  const password = form ? String(form.get("password") ?? "") : String(((await req.json().catch(() => ({}))) as { password?: string }).password ?? "");
  const back = (ok: boolean) =>
    form ? new Response(null, { status: 303, headers: { Location: ok ? "/admin" : "/admin?e=1" } }) : Response.json(ok ? { ok: true } : { error: "비밀번호가 맞지 않아요" }, { status: ok ? 200 : 401 });
  if (!adminPasswordSet()) return form ? back(false) : Response.json({ error: "관리자 비밀번호가 설정되지 않았어요" }, { status: 503 });
  // 마구 넣어 보기를 늦춘다
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 600));
    return back(false);
  }
  (await cookies()).set(ADMIN_COOKIE, newSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_HOURS * 3600,
  });
  return back(true);
}
