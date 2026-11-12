import { AiError, aiApiKey, aiBase } from "./ai-image";
import { recordAiUsage, usageOf, type AiFeature } from "./ai-usage";

/*
 * 글 AI 호출 (서버 전용) — 그림 AI와 같은 OpenAI 호환 게이트웨이·같은 키(AI_API_KEY · AI_BASE_URL).
 * 모델: 환경 변수 AI_TEXT_MODEL → 없으면 게이트웨이 목록(GET /models)에서 글 모델(그림·소리·임베딩이 아닌 것) 첫 번째.
 * AI_TEXT_MOCK=1이면 부르지 않는다(로컬 시험: 부르는 쪽이 기본 문장을 씀).
 */

type Fetch = typeof fetch;
export const aiTextMock = () => process.env.AI_TEXT_MOCK === "1";
const NOT_TEXT = /image|imagen|dall-e|embed|whisper|tts|audio|speech|moderation|rerank|transcri|realtime|video|veo|sora/i;

/** GET /models → 글 모델 id들 (mode가 있으면 'chat'만, 없으면 이름으로 그림·소리·임베딩을 뺌). */
export function parseTextModels(json: unknown): string[] {
  const data = (json as { data?: Record<string, unknown>[] })?.data ?? [];
  const out: string[] = [];
  for (const d of data) {
    const id = typeof d?.id === "string" ? d.id : "";
    if (!id) continue;
    const mode = typeof d.mode === "string" ? d.mode : "";
    if (mode ? mode !== "chat" : NOT_TEXT.test(id)) continue;
    out.push(id);
  }
  return out;
}

let cached: { id: string; at: number } | null = null;
async function textModel(f: Fetch): Promise<string> {
  const env = (process.env.AI_TEXT_MODEL ?? "").trim();
  if (env) return env;
  if (cached && Date.now() - cached.at < 3600_000) return cached.id;
  try {
    const res = await f(`${aiBase()}/models`, { headers: { Authorization: `Bearer ${aiApiKey()}` }, signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const id = parseTextModels(await res.json())[0];
      if (id) { cached = { id, at: Date.now() }; return id; }
    }
  } catch {
    /* 아래 오류 */
  }
  throw new AiError("글 AI 모델을 찾지 못했어요 (AI_TEXT_MODEL)", 503, "unsupported");
}

/** chat/completions 답 → 글 (choices[0].message.content, 글 조각 배열도 이어 붙임). */
export function readChat(json: unknown): string {
  const c = (json as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : "")).join("");
  return "";
}

/** 짧은 글 하나 받기. 키가 없으면 AiError('nokey'). feature = 사용량 기록 이름(ai_usage, 기본 'text'). */
export async function chatText(
  system: string, user: string,
  opts: { fetchImpl?: Fetch; timeoutMs?: number; maxTokens?: number; feature?: AiFeature; temperature?: number } = {},
): Promise<string> {
  if (!aiApiKey()) throw new AiError("글 AI 키가 없어요", 503, "nokey");
  const f = opts.fetchImpl ?? fetch;
  const model = await textModel(f);
  let res: Response;
  try {
    res = await f(`${aiBase()}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${aiApiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens ?? 700,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    });
  } catch (e) {
    void recordAiUsage(opts.feature ?? "text", { calls: 1, failures: 1 });
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") throw new AiError("글 AI가 늦어요", 504, "timeout");
    throw new AiError("글 AI에 연결하지 못했어요", 502, "upstream");
  }
  if (!res.ok) void recordAiUsage(opts.feature ?? "text", { calls: 1, failures: 1 });
  if (!res.ok) throw new AiError(`글 AI 오류 (${res.status})`, 502, res.status === 401 || res.status === 403 ? "auth" : res.status === 402 ? "balance" : "upstream");
  const json = await res.json().catch(() => null);
  void recordAiUsage(opts.feature ?? "text", { calls: 1, ...usageOf(json) });
  const text = readChat(json).trim();
  if (!text) throw new AiError("글 AI가 빈 답을 줬어요", 502, "upstream");
  return text;
}
