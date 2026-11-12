import { currentPhone } from "./auth";
import { sql } from "./db";
import { CommunityError } from "./community";

/** 함께 API 공통: 폰 인증(/api/phone과 같음) + 데모 차인지. 실패하면 Response. */
export async function communityCaller(req: Request): Promise<{ phone: { id: string; car_id: string; nickname: string }; carId: string; demo: boolean } | Response> {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const [car] = await sql<{ demo: boolean }[]>`select demo from cars where id = ${phone.car_id}`;
  return { phone, carId: phone.car_id, demo: !!car?.demo };
}

/** CommunityError는 그 한국어 안내 + 상태, 그 밖엔 500 (표가 아직 없으면 503 '준비 중') */
export function communityFail(e: unknown): Response {
  if (e instanceof CommunityError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  if ((e as { code?: string }).code === "42P01") return Response.json({ error: "함께는 아직 준비 중이에요", code: "notready" }, { status: 503 });
  console.error("함께 API 오류", (e as Error).message);
  return Response.json({ error: "잠시 뒤 다시 해 주세요" }, { status: 500 });
}

/** 본문 JSON (4KB까지) */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > 4096) throw new CommunityError("너무 길어요", 413);
  try {
    const j = JSON.parse(raw || "{}");
    return j && typeof j === "object" ? j : {};
  } catch {
    throw new CommunityError("bad json");
  }
}
