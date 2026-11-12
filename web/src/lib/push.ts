import webpush, { type PushSubscription } from "web-push";
import { sql } from "./db";
import { sendFcm } from "./fcm";

let ready = false;
function setup() {
  if (ready) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "https://milestamp.vercel.app", pub, priv);
  ready = true;
  return true;
}

/** silent면 알림창 없이 data만 보낸다 (앱이 화면만 조용히 갱신. 웹푸시는 같은 JSON이 가고 서비스 워커가 정한다). */
export type PushMessage = { title: string; body: string; url: string; tag?: string; silent?: boolean };

/**
 * 이 차에 연결된 폰 모두에게. 앱은 FCM, 웹은 웹푸시. 없어진 구독은 지운다. 보낸 수를 돌려준다.
 * except: 이 폰은 빼고 (스스로 한 일은 알리지 않음)
 */
export async function pushToCar(
  carId: string, msg: PushMessage, data: Record<string, string> = {}, opts: { except?: string } = {},
): Promise<number> {
  const phones = await sql<{ id: string; push: PushSubscription | { fcm: string } }[]>`
    select id, push from phones where car_id = ${carId} and push is not null
    ${opts.except ? sql`and id <> ${opts.except}` : sql``}`;
  const results = await Promise.all(
    phones.map(async (p): Promise<"ok" | "gone" | "error"> => {
      if ("fcm" in p.push) return sendFcm(p.push.fcm, { title: msg.title, body: msg.body, tag: msg.tag, silent: msg.silent, data: { url: msg.url, ...data } });
      if (!setup()) return "error";
      try {
        await webpush.sendNotification(p.push, JSON.stringify(msg), { TTL: 600, urgency: "high" });
        return "ok";
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        return code === 404 || code === 410 ? "gone" : "error";
      }
    }),
  );
  await Promise.all(results.map((r, i) => (r === "gone" ? sql`update phones set push = null where id = ${phones[i].id}` : null)));
  return results.filter((r) => r === "ok").length;
}
