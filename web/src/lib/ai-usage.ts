import { kstToday } from "./festival-shape";

/*
 * AI 사용량 (표 ai_usage — 한국 날짜 × 기능). 부르는 곳: ai-text.ts chatText(글) · ai-stamp-jobs.ts(그림).
 * 기록이 실패해도(표가 없는 DB 등) 부른 일은 그대로 — 조용히 건너뛴다. 개인정보 없음(기능 이름과 숫자만).
 * 값 어림: 환경 변수 AI_KRW_PER_1K_TOKENS · AI_KRW_PER_IMAGE가 있으면 원으로, 없으면 횟수만 보여 준다.
 */

export type AiFeature = "fill" | "diary" | "moderation" | "stamp-image" | "text";
export type AiUse = { calls?: number; failures?: number; tokensIn?: number; tokensOut?: number; images?: number };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

/** chat/completions 답의 usage → 토큰 (prompt/completion 또는 input/output 이름 둘 다). */
export function usageOf(json: unknown): { tokensIn: number; tokensOut: number } {
  const u = (json as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  return { tokensIn: n(u.prompt_tokens ?? u.input_tokens), tokensOut: n(u.completion_tokens ?? u.output_tokens) };
}

export async function recordAiUsage(feature: AiFeature, u: AiUse): Promise<void> {
  try {
    const { sql } = await import("./db");
    await sql`
      insert into ai_usage (day, feature, calls, failures, tokens_in, tokens_out, images)
      values (${kstToday()}, ${feature}, ${n(u.calls)}, ${n(u.failures)}, ${n(u.tokensIn)}, ${n(u.tokensOut)}, ${n(u.images)})
      on conflict (day, feature) do update set
        calls = ai_usage.calls + excluded.calls, failures = ai_usage.failures + excluded.failures,
        tokens_in = ai_usage.tokens_in + excluded.tokens_in, tokens_out = ai_usage.tokens_out + excluded.tokens_out,
        images = ai_usage.images + excluded.images, updated_at = now()`;
  } catch {
    /* 표가 없거나 DB가 안 되면 기록만 건너뜀 */
  }
}

/** 오늘(한국 날짜) 이 기능을 부른 횟수 — 하루 한도. 표가 없으면 0. */
export async function aiCallsToday(feature: AiFeature): Promise<number> {
  try {
    const { sql } = await import("./db");
    const [r] = await sql<{ n: number }[]>`select coalesce(sum(calls), 0)::int as n from ai_usage where day = ${kstToday()} and feature = ${feature}`;
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

export type AiWeek = {
  tracked: boolean;
  calls: number;
  failures: number;
  tokens: number;
  images: number;
  byFeature: { feature: string; calls: number }[];
  /** 환경 변수 단가가 있을 때만 (원) */
  krw: number | null;
};

/** 원 어림 (단가 환경 변수가 없으면 null). */
export function estimateKrw(tokens: number, images: number, env: Record<string, string | undefined> = process.env): number | null {
  const pt = Number(env.AI_KRW_PER_1K_TOKENS), pi = Number(env.AI_KRW_PER_IMAGE);
  const hasT = Number.isFinite(pt) && pt > 0, hasI = Number.isFinite(pi) && pi > 0;
  if (!hasT && !hasI) return null;
  return Math.round((hasT ? (tokens / 1000) * pt : 0) + (hasI ? images * pi : 0));
}

/** 지난 7일(오늘 포함) 사용량. 표가 없으면 tracked=false. */
export async function aiWeek(): Promise<AiWeek> {
  try {
    const { sql } = await import("./db");
    const rows = await sql<{ feature: string; calls: number; failures: number; tokens: number; images: number }[]>`
      select feature, sum(calls)::int as calls, sum(failures)::int as failures, sum(tokens_in + tokens_out)::bigint::float8 as tokens, sum(images)::int as images
      from ai_usage where day > (${kstToday()}::date - 7) group by feature order by calls desc`;
    const sum = (k: "calls" | "failures" | "tokens" | "images") => rows.reduce((a, r) => a + Number(r[k]), 0);
    const tokens = sum("tokens"), images = sum("images");
    return {
      tracked: true, calls: sum("calls"), failures: sum("failures"), tokens, images,
      byFeature: rows.map((r) => ({ feature: r.feature, calls: r.calls })), krw: estimateKrw(tokens, images),
    };
  } catch {
    return { tracked: false, calls: 0, failures: 0, tokens: 0, images: 0, byFeature: [], krw: null };
  }
}
