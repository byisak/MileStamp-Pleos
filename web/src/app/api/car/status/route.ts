import { sql } from "@/lib/db";
import { carFromRequest } from "@/lib/auth";

// 차 화면의 '폰 n대 연결됨'
export async function GET(req: Request) {
  const car = await carFromRequest(req);
  if (!car) return Response.json({ error: "unauthorized" }, { status: 401 });
  const phones = await sql<{ nickname: string; has_push: boolean }[]>`
    select nickname, (push is not null) as has_push from phones where car_id = ${car.id} order by created_at`;
  return Response.json({ phones });
}
