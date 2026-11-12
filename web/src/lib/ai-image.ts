/*
 * 그림 AI 호출 (서버 전용) — OpenAI 호환 게이트웨이(기본 https://ai.cubion.kr/v1).
 *  1) images/edits (multipart, 참고 그림 여러 장 = 기존 도장 3장으로 그림체 맞추기)
 *  2) 게이트웨이가 edits를 못 받으면(404·405·501·'지원 안 함' 400) images/generations (JSON, 그림체를 글로만)
 *  어느 쪽이 됐는지는 기억해 두고(메모리 + 작업 표 mode) 다음엔 바로 그쪽으로.
 * 모델은 관리자 화면에서 게이트웨이 목록(GET /models) 중에 고른다. 안 고르면 AI_IMAGE_MODEL → 목록에서 자동(gpt-image → gemini·imagen).
 * 환경 변수: AI_API_KEY(없으면 OPENAI_API_KEY) · AI_BASE_URL · AI_IMAGE_MODEL(기본값, 선택) · AI_DAILY_LIMIT(기본 40) · AI_IMAGE_MOCK=1(키 없이 시험)
 */

export const AI_BASE_DEFAULT = "https://ai.cubion.kr/v1";
export const CALL_TIMEOUT_MS = 120_000;

export type GenMode = "edit" | "generate";
export type RefImage = { bytes: Uint8Array; type: string; name: string };
export type ImageOut = { bytes: Uint8Array; type: string; ext: string };
type Fetch = typeof fetch;

export class AiError extends Error {
  constructor(message: string, public status = 502, public code: "nokey" | "balance" | "auth" | "unsupported" | "upstream" | "timeout" = "upstream") {
    super(message);
  }
}

export const aiBase = () => (process.env.AI_BASE_URL || AI_BASE_DEFAULT).replace(/\/+$/, "");
export const aiApiKey = () => process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
export const AI_MODEL_FALLBACK = "gpt-image-1";
export const aiMock = () => process.env.AI_IMAGE_MOCK === "1";
export function aiDailyLimit(): number {
  const n = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40;
}

/** 이 서버 실행 중에 알아낸 길 (모델마다 edits가 되는지). 콜드 스타트 땐 작업 표의 마지막 성공 mode로 채운다. */
const knownModes = new Map<string, GenMode>();
let lastModel: string | null = null;
export const rememberedMode = (model?: string | null) => knownModes.get(model ?? lastModel ?? "") ?? null;
/** m = null이고 모델을 안 주면 모두 잊음 */
export function rememberMode(m: GenMode | null, model?: string | null) {
  if (m === null && !model) return knownModes.clear();
  const k = model ?? lastModel;
  if (!k) return;
  if (m) knownModes.set(k, m);
  else knownModes.delete(k);
}

/** 그림 바이트 → MIME·확장자 (게이트웨이마다 png·webp·jpeg가 섞여 와서). */
export function sniff(b: Uint8Array): { type: string; ext: string } {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "image/png", ext: "png" };
  if (b[0] === 0xff && b[1] === 0xd8) return { type: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return { type: "image/webp", ext: "webp" };
  return { type: "image/png", ext: "png" };
}

/** edits를 이 게이트웨이가 모른다는 뜻인지 (그러면 generations로). */
export function isUnsupported(status: number, msg: string): boolean {
  if (status === 404 || status === 405 || status === 501) return true;
  if (status === 400 || status === 422) {
    return /not (supported|found|allowed|implemented)|unsupported|unknown (endpoint|route|path|url)|no route|invalid (url|endpoint)|images\/edits/i.test(msg);
  }
  return false;
}

function isBalance(status: number, msg: string): boolean {
  return status === 402 || /insufficient|balance|잔액|크레딧|credit|quota|billing/i.test(msg);
}

async function errorText(res: Response): Promise<string> {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t) as { error?: { message?: string } | string; message?: string; detail?: string };
    const e = typeof j.error === "string" ? j.error : j.error?.message;
    return (e ?? j.message ?? j.detail ?? t).slice(0, 300);
  } catch {
    return t.slice(0, 300);
  }
}

function upstream(status: number, msg: string): AiError {
  if (isBalance(status, msg)) return new AiError("이미지 AI 잔액이 부족해요 · 게이트웨이에서 충전한 뒤 다시 해 주세요", 402, "balance");
  if (status === 401 || status === 403) return new AiError("이미지 AI 키가 맞지 않아요 (AI_API_KEY 확인)", 502, "auth");
  return new AiError(`이미지 AI 오류 (${status}): ${msg || "응답 없음"}`, 502, "upstream");
}

/** { data: [{ b64_json } | { url }] } → 그림들. */
async function readImages(json: unknown, f: Fetch): Promise<ImageOut[]> {
  const data = (json as { data?: { b64_json?: string; url?: string }[] })?.data ?? [];
  const out: ImageOut[] = [];
  for (const d of data) {
    let bytes: Uint8Array | null = null;
    if (d.b64_json) bytes = new Uint8Array(Buffer.from(d.b64_json, "base64"));
    else if (d.url) {
      const r = await f(d.url, { signal: AbortSignal.timeout(30_000) });
      if (r.ok) bytes = new Uint8Array(await r.arrayBuffer());
    }
    if (bytes && bytes.length > 100) out.push({ bytes, ...sniff(bytes) });
  }
  return out;
}

async function call(f: Fetch, path: string, init: RequestInit): Promise<Response> {
  try {
    return await f(`${aiBase()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${aiApiKey()}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") throw new AiError("이미지 AI가 2분 안에 답하지 않았어요 · 다시 해 주세요", 504, "timeout");
    throw new AiError(`이미지 AI에 연결하지 못했어요 (${(e as Error).message})`, 502, "upstream");
  }
}

export type ImageModel = { id: string; sizes: string[] };

/** GET /models → 그림 모델들 (mode 'image_generation', 없으면 이름에 image·imagen이 든 것). */
export function parseImageModels(json: unknown): ImageModel[] {
  const data = (json as { data?: Record<string, unknown>[] })?.data ?? [];
  const out: ImageModel[] = [];
  for (const d of data) {
    const id = typeof d?.id === "string" ? d.id : "";
    if (!id) continue;
    const mode = typeof d.mode === "string" ? d.mode : "";
    if (mode ? mode !== "image_generation" : !/image|imagen|dall-e/i.test(id)) continue;
    const img = (d.image ?? {}) as { sizes?: unknown };
    const sizes = Array.isArray(img.sizes) ? img.sizes.filter((x): x is string => typeof x === "string") : [];
    out.push({ id, sizes });
  }
  return out;
}

/** 쓸 모델 고르기: gpt-image(그림체가 기존 도장과 같음) → gemini·imagen → 첫 번째. */
export function pickImageModel(list: ImageModel[]): ImageModel | null {
  const by = (re: RegExp) => list.filter((m) => re.test(m.id)).sort((a, b) => b.id.localeCompare(a.id))[0];
  return by(/gpt-image/i) ?? by(/gemini|imagen/i) ?? list[0] ?? null;
}

/** 모델이 받는 크기면 그대로, 아니면 정사각 → 세로 → 빼기(모델 기본값). */
export function fitSize(want: string, sizes: string[]): string | undefined {
  if (!sizes.length || sizes.includes(want)) return want;
  const [w, h] = want.split("x").map(Number);
  const ratio = w && h ? w / h : 1;
  const parsed = sizes.map((s) => ({ s, r: (() => { const [a, b] = s.split("x").map(Number); return a && b ? a / b : NaN; })() })).filter((x) => Number.isFinite(x.r));
  parsed.sort((a, b) => Math.abs(a.r - ratio) - Math.abs(b.r - ratio));
  return parsed[0]?.s;
}

/** 모델 이름 모양 (화면에서 온 값을 그대로 믿지 않으려고). */
export const isModelId = (s: unknown): s is string => typeof s === "string" && /^[\w.:/@-]{1,80}$/.test(s);

let listCache: ImageModel[] = [];
let listAt = 0;
/** 게이트웨이의 그림 모델 목록 (1시간 기억). 못 받으면 빈 목록. */
export async function listImageModels(fetchImpl?: Fetch): Promise<ImageModel[]> {
  if (listCache.length && Date.now() - listAt < 3600_000) return listCache;
  try {
    const res = await (fetchImpl ?? fetch)(`${aiBase()}/models`, { headers: { Authorization: `Bearer ${aiApiKey()}` }, signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const list = parseImageModels(await res.json());
      if (list.length) {
        listCache = list;
        listAt = Date.now();
      }
      return list;
    }
  } catch {
    /* 목록을 못 받으면 아래 기본값 */
  }
  return [];
}
/** 시험용: 기억한 목록 지우기 */
export function forgetModels() {
  listCache = [];
  listAt = 0;
}

/**
 * 쓸 모델: 화면에서 고른 것(want) → 환경 변수 AI_IMAGE_MODEL → 목록에서 자동 → gpt-image-1.
 * 고른 모델이 목록에 없으면 오류 (목록을 못 받았으면 그 이름 그대로 시도).
 */
export async function resolveImageModel(fetchImpl?: Fetch, want?: string | null): Promise<ImageModel> {
  const list = await listImageModels(fetchImpl);
  if (want) {
    const hit = list.find((m) => m.id === want);
    if (hit) return hit;
    if (list.length) throw new AiError(`게이트웨이에 '${want}' 그림 모델이 없어요 · 다른 모델을 골라 주세요`, 400, "upstream");
    return { id: want, sizes: [] };
  }
  const env = process.env.AI_IMAGE_MODEL;
  if (env) return list.find((m) => m.id === env) ?? { id: env, sizes: [] };
  return pickImageModel(list) ?? { id: AI_MODEL_FALLBACK, sizes: [] };
}

type One = { prompt: string; n: number; size: string; quality: string };
type Run = One & { model: ImageModel };

async function editOnce(f: Fetch, o: Run, refs: RefImage[]): Promise<ImageOut[]> {
  const fd = new FormData();
  const size = fitSize(o.size, o.model.sizes);
  fd.append("model", o.model.id);
  fd.append("prompt", o.prompt);
  fd.append("n", String(o.n));
  if (size) fd.append("size", size);
  fd.append("quality", o.quality);
  for (const r of refs) fd.append(refs.length > 1 ? "image[]" : "image", new Blob([r.bytes as BlobPart], { type: r.type }), r.name);
  const res = await call(f, "/images/edits", { method: "POST", body: fd });
  if (!res.ok) {
    const msg = await errorText(res);
    if (isUnsupported(res.status, msg) && !isBalance(res.status, msg)) throw new AiError(msg, res.status, "unsupported");
    throw upstream(res.status, msg);
  }
  return readImages(await res.json(), f);
}

async function generateOnce(f: Fetch, o: Run): Promise<ImageOut[]> {
  const res = await call(f, "/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: o.model.id, prompt: o.prompt, n: o.n, size: fitSize(o.size, o.model.sizes), quality: /gpt-image/i.test(o.model.id) ? o.quality : undefined }),
  });
  if (!res.ok) {
    const msg = await errorText(res);
    if ((res.status === 400 || res.status === 422) && o.n > 1 && /\bn\b|number of images|only (supports|one)/i.test(msg)) {
      throw new AiError(msg, res.status, "unsupported"); // n>1을 못 받음 → 한 장씩
    }
    throw upstream(res.status, msg);
  }
  return readImages(await res.json(), f);
}

/** n장 모으기: 한 번에 n장 → 모자라면(또는 n>1을 못 받으면) 한 장씩 더. */
async function collect(n: number, once: (k: number) => Promise<ImageOut[]>): Promise<ImageOut[]> {
  let out: ImageOut[] = [];
  try {
    out = await once(n);
  } catch (e) {
    if (!(e instanceof AiError) || e.code !== "unsupported" || n === 1) throw e;
  }
  for (let tries = 0; out.length < n && tries < n; tries++) {
    const more = await once(1);
    if (!more.length) break;
    out = out.concat(more);
  }
  if (!out.length) throw new AiError("이미지 AI가 그림을 돌려주지 않았어요", 502, "upstream");
  return out.slice(0, n);
}

/**
 * 그림 n장 만들기. prompt(withRefs)는 참고 그림을 쓰는지에 따라 다른 글.
 * preferred = 지난번에 된 길 (없으면 edits부터 시험).
 */
export async function generateImages(o: {
  prompt: (withRefs: boolean) => string;
  refs: () => Promise<RefImage[]>;
  n: number;
  size: string;
  quality?: string;
  preferred?: GenMode | null;
  /** 화면에서 고른 모델 (없으면 기본값) */
  model?: string | null;
  fetchImpl?: Fetch;
}): Promise<{ images: ImageOut[]; mode: GenMode; model: string }> {
  if (!aiApiKey()) throw new AiError("이미지 AI 키가 설정되지 않았어요", 503, "nokey");
  const f = o.fetchImpl ?? fetch;
  const quality = o.quality ?? "medium";
  const model = await resolveImageModel(f, o.model);
  lastModel = model.id;
  const mode = knownModes.get(model.id) ?? o.preferred ?? "edit";
  if (mode === "edit") {
    const refs = await o.refs();
    if (refs.length) {
      try {
        const prompt = o.prompt(true);
        const images = await collect(o.n, (k) => editOnce(f, { prompt, n: k, size: o.size, quality, model }, refs));
        knownModes.set(model.id, "edit");
        return { images, mode: "edit", model: model.id };
      } catch (e) {
        if (!(e instanceof AiError) || e.code !== "unsupported") throw e;
        knownModes.set(model.id, "generate"); // 이 모델은 edits를 못 받음 → 다음부터 바로 generations
      }
    }
  }
  const prompt = o.prompt(false);
  const images = await collect(o.n, (k) => generateOnce(f, { prompt, n: k, size: o.size, quality, model }));
  if (!knownModes.has(model.id)) knownModes.set(model.id, "generate");
  return { images, mode: "generate", model: model.id };
}

/** 게이트웨이 잔액 (GET /balance, 원). 모양이 정해져 있지 않아 숫자 칸을 찾아 읽는다. 없으면 null. */
export function parseBalance(json: unknown): { amount: number; currency: string } | null {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): { amount: number; currency: string } | null => {
    if (!v || typeof v !== "object" || seen.has(v) || depth > 3) return null;
    seen.add(v);
    const o = v as Record<string, unknown>;
    const cur = typeof o.currency === "string" ? o.currency.toUpperCase() : "KRW";
    for (const k of ["balance", "krw", "balance_krw", "remaining", "amount", "credit", "credits"]) {
      const x = o[k];
      const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" && !Number.isNaN(Number(x)) ? Number(x) : NaN;
      if (Number.isFinite(n)) return { amount: n, currency: cur };
    }
    for (const x of Object.values(o)) {
      const r = walk(x, depth + 1);
      if (r) return r;
    }
    return null;
  };
  if (typeof json === "number") return { amount: json, currency: "KRW" };
  return walk(json, 0);
}

export async function getBalance(fetchImpl?: Fetch): Promise<{ amount: number; currency: string } | null> {
  if (!aiApiKey()) return null;
  try {
    const res = await (fetchImpl ?? fetch)(`${aiBase()}/balance`, {
      headers: { Authorization: `Bearer ${aiApiKey()}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return parseBalance(await res.json());
  } catch {
    return null;
  }
}
