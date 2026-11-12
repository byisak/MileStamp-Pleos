import { sql } from "@/lib/db";
import { hashToken, newToken } from "@/lib/auth";

// 차 앱이 처음 켜질 때 한 번. 토큰은 차에만 남고 서버는 해시만 가진다.
export async function POST() {
  const token = newToken();
  const [car] = await sql<{ id: string }[]>`insert into cars (token_hash) values (${hashToken(token)}) returning id`;
  return Response.json({ carId: car.id, token });
}
