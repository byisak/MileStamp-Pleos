import { sql } from "@/lib/db";
import { currentPhone } from "@/lib/auth";

// 웹푸시 구독 저장 / 해제
export async function POST(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const sub = (await req.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string }; fcm?: string } | null;
  // 앱: FCM 토큰
  if (typeof sub?.fcm === "string" && /^[\w:-]{20,4096}$/.test(sub.fcm)) {
    await sql`update phones set push = ${sql.json({ fcm: sub.fcm })} where id = ${phone.id}`;
    return Response.json({ ok: true });
  }
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth)
    return Response.json({ error: "bad subscription" }, { status: 400 });
  const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  await sql`update phones set push = ${sql.json(clean)} where id = ${phone.id}`;
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  await sql`update phones set push = null where id = ${phone.id}`;
  return Response.json({ ok: true });
}
