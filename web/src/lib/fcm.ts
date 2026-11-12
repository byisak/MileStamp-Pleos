import { createSign } from "node:crypto";

// 앱 푸시(FCM HTTP v1). 서비스 계정 JSON은 환경 변수 FIREBASE_SERVICE_ACCOUNT에만 둔다(저장소에 없음).
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let sa: ServiceAccount | null | undefined;
function account(): ServiceAccount | null {
  if (sa !== undefined) return sa;
  try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? "") as ServiceAccount; }
  catch { sa = null; }
  return sa;
}

let cached: { token: string; until: number } | null = null;

/** 서비스 계정으로 서명한 JWT → 구글 액세스 토큰 (1시간, 55분 재사용) */
async function accessToken(a: ServiceAccount): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: a.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(a.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new Error(`구글 토큰 실패 ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, until: Date.now() + Math.min(j.expires_in, 3300) * 1000 };
  return j.access_token;
}

/** silent면 notification 없이 data만 (앱이 받아 조용히 처리). */
export type FcmMessage = { title: string; body: string; data: Record<string, string>; tag?: string; silent?: boolean };

/** 보낸 결과: ok / gone(토큰이 없어짐 → 지울 것) / error */
export async function sendFcm(token: string, m: FcmMessage): Promise<"ok" | "gone" | "error"> {
  const a = account();
  if (!a) return "error";
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(a)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: m.silent
        ? { token, data: m.data, android: { priority: "HIGH", ttl: "600s" } }
        : {
            token,
            notification: { title: m.title, body: m.body },
            data: m.data,
            android: { priority: "HIGH", ttl: "600s", notification: { channel_id: "trip", tag: m.tag, default_sound: true } },
          },
    }),
  });
  if (res.ok) return "ok";
  const text = await res.text();
  if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) return "gone";
  console.error("FCM 실패", res.status, text.slice(0, 300));
  return "error";
}
