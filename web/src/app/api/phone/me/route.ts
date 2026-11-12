import { sql } from "@/lib/db";
import { currentPhone } from "@/lib/auth";

// 내 폰과 같은 차에 연결된 가족 폰들 (우리 차 탭)
export async function GET(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const family = await sql<{ id: string; nickname: string; has_push: boolean; created_at: Date }[]>`
    select id, nickname, (push is not null) as has_push, created_at from phones where car_id = ${phone.car_id} order by created_at`;
  const [car] = await sql<{ demo: boolean }[]>`select demo from cars where id = ${phone.car_id}`;
  return Response.json({
    demo: !!car?.demo,
    me: { id: phone.id, nickname: phone.nickname, hasPush: phone.has_push },
    family: family.map((f) => ({ nickname: f.nickname, hasPush: f.has_push, me: f.id === phone.id, since: f.created_at })),
  });
}

// 이름 바꾸기
export async function PATCH(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const { nickname } = (await req.json().catch(() => ({}))) as { nickname?: string };
  const nick = (nickname ?? "").trim().slice(0, 10);
  if (!nick) return Response.json({ error: "empty" }, { status: 400 });
  await sql`update phones set nickname = ${nick} where id = ${phone.id}`;
  return Response.json({ ok: true, nickname: nick });
}

// 이 폰의 연결 끊기 (서버에서 지움)
export async function DELETE(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  await sql`delete from phones where id = ${phone.id}`;
  return Response.json({ ok: true });
}
