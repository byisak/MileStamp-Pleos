/*
 * AI 도장 작업 (서버 전용) — 표 ai_stamp_jobs (db/schema.sql 'AI 도장 그림' 절).
 * POST /api/admin/ai-stamp 가 작업을 만들고 after()로 runJob을 돌린다. 화면은 2초마다 GET으로 확인.
 */
import { sql } from "./db";
import { recordAiUsage } from "./ai-usage";
import { findFestival } from "./festivals";
import { aiKey, putObject, r2Ready } from "./r2";
import { AiError, generateImages, rememberedMode, rememberMode, type GenMode, type RefImage } from "./ai-image";
import { BG_SIZE, STAMP_CANDIDATES, STAMP_SIZE, buildBackgroundPrompt, buildStampPrompt, defaultScene, type PromptPlace, type PromptTarget } from "./stamp-prompt";

export type AiKind = "place" | "festival";
export type AiPurpose = "stamp" | "background";
export type Candidate = { url: string; key?: string };
export type AiJob = {
  id: string;
  kind: AiKind;
  targetId: string;
  purpose: AiPurpose;
  scene: string;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  candidates: Candidate[];
  chosen: number | null;
  nImages: number;
  mode: string | null;
  /** 쓴 그림 모델 (옛 기록은 null) */
  model: string | null;
  mock: boolean;
  createdAt: string;
  finishedAt: string | null;
};

type Row = {
  id: string; target_kind: AiKind; target_id: string; purpose: AiPurpose; scene: string; status: AiJob["status"]; error: string | null;
  candidates: Candidate[] | null; chosen: number | null; n_images: number; mode: string | null; model: string | null; mock: boolean; created_at: Date; finished_at: Date | null;
};

/** 6분 넘게 '만드는 중'이면 함수가 끊긴 것 (maxDuration 300초). */
const STALE_MS = 6 * 60_000;

const toJob = (r: Row): AiJob => ({
  id: r.id, kind: r.target_kind, targetId: r.target_id, purpose: r.purpose, scene: r.scene, status: r.status, error: r.error,
  candidates: r.candidates ?? [], chosen: r.chosen, nImages: r.n_images, mode: r.mode, model: r.model ?? null, mock: r.mock,
  createdAt: r.created_at.toISOString(), finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
});

/** 기본 참고 그림 = 가족 실루엣 없는 새 판 3장 (web/public/ai-refs, 흰 바탕 + 초록 테). AI_REF_URLS(쉼표)로 바꿀 수 있음. */
export const DEFAULT_REFS = ["/ai-refs/chimsan.webp", "/ai-refs/suseongmot.webp", "/ai-refs/arboretum.webp"];
export function refUrls(origin: string): string[] {
  const env = (process.env.AI_REF_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (env.length ? env : DEFAULT_REFS).slice(0, 3).map((u) => (/^https?:/.test(u) ? u : `${origin}${u}`));
}

// ------------------------------------------------------------------ 대상

export type AiTargetInfo = { kind: AiKind; id: string; name: string; prompt: PromptTarget; stampUrl: string | null; fallbackStamp: string };

async function placeRow(id: string) {
  const [p] = await sql<{ id: string; name: string; region: string | null; tags: string[]; indoor: boolean; stamp_url: string | null }[]>`
    select id, name, region, tags, indoor, stamp_url from places where id = ${id}`;
  return p ?? null;
}

export async function loadTarget(kind: AiKind, id: string): Promise<AiTargetInfo | null> {
  if (kind === "place") {
    const p = await placeRow(id);
    if (!p) return null;
    const place: PromptPlace = { id: p.id, name: p.name, region: p.region, tags: p.tags ?? [], indoor: p.indoor };
    return { kind, id, name: p.name, prompt: { kind: "place", place }, stampUrl: p.stamp_url, fallbackStamp: `/stamps/${p.id}.webp` };
  }
  const f = await findFestival(id);
  if (!f) return null;
  const p = f.placeId ? await placeRow(f.placeId) : null;
  return {
    kind, id, name: f.name,
    prompt: { kind: "festival", festival: { id: f.id, name: f.name, season: f.season, starts: f.starts, indoor: f.indoor,
      place: p ? { id: p.id, name: p.name, region: p.region, tags: p.tags ?? [], indoor: p.indoor } : null } },
    stampUrl: f.stamp.url ?? p?.stamp_url ?? null,
    fallbackStamp: p ? `/stamps/${p.id}.webp` : DEFAULT_REFS[0],
  };
}

export function sceneFor(t: AiTargetInfo) {
  return defaultScene(t.prompt);
}

// ------------------------------------------------------------------ 한도

/** 한국 날짜 오늘 만든(만드는 중 포함) 그림 수 — 모의 작업 빼고. */
export async function usedToday(): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select coalesce(sum(n_images), 0)::int as n from ai_stamp_jobs
    where not mock and created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`;
  return r?.n ?? 0;
}

/** 콜드 스타트: 이 모델로 마지막에 성공한 길 (edits가 되는지). 모델을 모르면(기본값) 아무 모델의 마지막 길. */
async function lastMode(model: string | null): Promise<GenMode | null> {
  const mem = model ? rememberedMode(model) : null;
  if (mem) return mem;
  const [r] = await sql<{ mode: string }[]>`
    select mode from ai_stamp_jobs where status = 'done' and mode in ('edit', 'generate')
      and (${model}::text is null or model = ${model}) order by finished_at desc limit 1`;
  return (r?.mode as GenMode | undefined) ?? null;
}

// ------------------------------------------------------------------ 작업

export async function createJob(o: { kind: AiKind; id: string; purpose: AiPurpose; scene: string; prompt: string; n: number; mock: boolean; model: string | null }): Promise<string> {
  const [r] = await sql<{ id: string }[]>`
    insert into ai_stamp_jobs (target_kind, target_id, purpose, scene, prompt, n_images, mock, status, model)
    values (${o.kind}, ${o.id}, ${o.purpose}, ${o.scene}, ${o.prompt}, ${o.n}, ${o.mock}, 'queued', ${o.model})
    returning id`;
  return r.id;
}

export async function getJob(jobId: string): Promise<AiJob | null> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const [r] = await sql<Row[]>`select * from ai_stamp_jobs where id = ${jobId}`;
  if (!r) return null;
  if ((r.status === "running" || r.status === "queued") && Date.now() - r.created_at.getTime() > STALE_MS) {
    const [u] = await sql<Row[]>`
      update ai_stamp_jobs set status = 'failed', error = '시간이 너무 오래 걸려 멈췄어요 · 다시 해 주세요', finished_at = now()
      where id = ${jobId} and status in ('queued', 'running') returning *`;
    return toJob(u ?? r);
  }
  return toJob(r);
}

export async function listJobs(kind: AiKind, id: string, limit = 12): Promise<AiJob[]> {
  const rs = await sql<Row[]>`
    select * from ai_stamp_jobs where target_kind = ${kind} and target_id = ${id} order by created_at desc limit ${limit}`;
  return rs.map(toJob);
}

export async function setChosen(jobId: string, chosen: number): Promise<boolean> {
  const r = await sql`update ai_stamp_jobs set chosen = ${chosen} where id = ${jobId} and status = 'done'`;
  return r.count > 0;
}

export async function placeBg(id: string): Promise<string | null> {
  const [r] = await sql<{ bg_url: string | null }[]>`select bg_url from places where id = ${id}`;
  return r?.bg_url ?? null;
}

async function fetchRefs(urls: string[]): Promise<RefImage[]> {
  const out: RefImage[] = [];
  for (const u of urls) {
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new AiError(`참고 그림을 못 받았어요 (${u} · ${res.status})`, 502);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("content-type")?.split(";")[0] || "image/webp";
    out.push({ bytes, type, name: u.split("/").pop() || "ref.webp" });
  }
  return out;
}

/**
 * 작업 돌리기 (after() 안). 실패해도 throw 하지 않고 표에 failed + 이유를 남긴다.
 * 모의(AI_IMAGE_MOCK=1): 3초 기다렸다가 참고 그림 3장 + 지금 도장 1장을 후보로 (R2·키 없이 화면 흐름 시험).
 */
export async function runJob(jobId: string, ctx: { origin: string; target: AiTargetInfo; purpose: AiPurpose; scene: string; mock: boolean; model: string | null }) {
  const { target, purpose } = ctx;
  try {
    await sql`update ai_stamp_jobs set status = 'running' where id = ${jobId}`;
    const refs = refUrls(ctx.origin);
    let candidates: Candidate[];
    let mode: string;
    let model = ctx.model;
    if (ctx.mock) {
      await new Promise((r) => setTimeout(r, 3000));
      const stamp = target.stampUrl ?? target.fallbackStamp;
      const rel = (u: string) => (u.startsWith(ctx.origin) ? u.slice(ctx.origin.length) : u);
      candidates = purpose === "background" ? [{ url: rel(refs[1] ?? refs[0]) }] : [...refs.map(rel), stamp].map((url) => ({ url }));
      mode = "mock";
    } else {
      if (!r2Ready()) throw new AiError("저장소(R2) 연결이 필요해요", 503);
      const n = purpose === "background" ? 1 : STAMP_CANDIDATES;
      const build = purpose === "background" ? buildBackgroundPrompt : buildStampPrompt;
      const res = await generateImages({
        prompt: (withRefs) => build(ctx.scene, { withRefs }),
        refs: () => fetchRefs(refs),
        n,
        size: purpose === "background" ? BG_SIZE : STAMP_SIZE,
        quality: "medium",
        preferred: await lastMode(ctx.model),
        model: ctx.model,
      });
      rememberMode(res.mode, res.model);
      void recordAiUsage("stamp-image", { calls: 1, images: res.images.length });
      mode = res.mode;
      model = res.model;
      candidates = [];
      for (let i = 0; i < res.images.length; i++) {
        const im = res.images[i];
        const key = aiKey(target.kind, target.id, jobId, purpose === "background" ? "bg" : i, im.ext);
        candidates.push({ url: await putObject(key, im.bytes, im.type), key });
      }
      // 실제로 쓴 프롬프트(참고 그림 유무에 따라 다름)를 남긴다
      await sql`update ai_stamp_jobs set prompt = ${build(ctx.scene, { withRefs: res.mode === "edit" })} where id = ${jobId}`;
    }
    await sql`
      update ai_stamp_jobs set status = 'done', candidates = ${sql.json(candidates)}, n_images = ${candidates.length},
        mode = ${mode}, model = ${model}, finished_at = now()
      where id = ${jobId}`;
    if (purpose === "background" && target.kind === "place" && candidates[0]) {
      await sql`update places set bg_url = ${candidates[0].url}, updated_at = now() where id = ${target.id}`;
    }
  } catch (e) {
    const msg = e instanceof AiError ? e.message : `만들지 못했어요: ${(e as Error).message}`;
    console.error("[ai-stamp]", jobId, e);
    // 실패 = 만든 그림 0장 (한도에서 빠짐)
    await sql`update ai_stamp_jobs set status = 'failed', error = ${msg}, n_images = 0, finished_at = now() where id = ${jobId}`.catch(() => {});
  }
}
