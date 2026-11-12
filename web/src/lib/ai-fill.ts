/*
 * AI 입력 돕기 (서버 전용, docs/장소-데이터-구조-계획.md §6.1 A) — 원문 모으기 → 글 AI(ai-text.ts) → 검사(ai-fill-shape.ts) → 초안 저장(meta.drafts).
 * 진짜 칸·목록 버전은 건드리지 않는다. 관리자가 화면에서 '맞아요'를 눌러 저장해야 앱·차에 간다.
 *
 * 원문: 명소 = 관광공사 이용 정보(키가 있을 때, 하루 캐시) · 조사 원문(hours·closed 글) · 소개 글 · 관리자가 붙여 넣은 글
 *       식당 = 이름 · 카카오 분류(메모) · 곁 장소 이름 · 관리자가 붙여 넣은 글 (카카오 로컬 답엔 운영 시간이 없다)
 * 개인정보: 집·가족·아이 이름 같은 건 원래 안 모으고, 원문의 전화·메일도 지워서 보낸다 (scrubPersonal).
 * 한도: 하루 AI_FILL_DAILY_LIMIT번(기본 200, 한국 날짜, ai_usage 'fill'), 한꺼번에 채우기는 한 번에 한 묶음 · 동시 2곳 · 묶음당 10곳까지.
 * 로컬 시험: AI_TEXT_MOCK=1 또는 AI_FILL_MOCK=1이면 AI를 부르지 않고 원문을 규칙으로 읽은 모의 답 (화면에 '모의').
 */
import { AiError, aiApiKey } from "./ai-image";
import { aiTextMock, chatText } from "./ai-text";
import { aiCallsToday } from "./ai-usage";
import {
  aiFieldsOf, buildFillPrompt, extractJson, fillTargets, mergeDrafts, sourceText, validateAiAnswer,
  type AiKind, type AiSource,
} from "./ai-fill-shape";
import { loadAdminPlaces, loadRestaurants, loadTagVocab, saveAiDrafts } from "./catalog";
import type { AdminPlace } from "./catalog-shape";
import { kstToday } from "./festival-shape";
import { ourTourId, tourDetail } from "./place-detail";
import { closuresFromText, hoursRowsFromText, parkingFromText, priceFromText } from "./place-attrs-text";
import { hm, representativeHours, type AiDrafts, type HoursRow, type VocabWord } from "./place-attrs-shape";
import { cuisineFromKakao, FOOD_TAG_CATEGORY, type FoodRestaurant } from "./restaurant-shape";

export const aiFillMock = () => aiTextMock() || process.env.AI_FILL_MOCK === "1";
export const aiFillReady = () => aiFillMock() || !!aiApiKey();
export function aiFillDailyLimit(): number {
  const n = Number(process.env.AI_FILL_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}
export const BULK_MAX = 10;
const CONCURRENCY = 2;

type Entity = { kind: "place"; e: AdminPlace } | { kind: "restaurant"; e: FoodRestaurant; placeName: string | null };

async function loadEntity(kind: AiKind, id: string): Promise<Entity | null> {
  if (kind === "place") {
    const e = (await loadAdminPlaces()).find((p) => p.id === id);
    return e ? { kind, e } : null;
  }
  const e = (await loadRestaurants()).find((r) => r.id === id);
  if (!e) return null;
  const placeName = e.placeId ? (await loadAdminPlaces()).find((p) => p.id === e.placeId)?.name ?? null : null;
  return { kind, e, placeName };
}

/** 원문 모으기 (관리자 '원문과 나란히 보기'에도 그대로 보여 준다). */
export async function gatherSources(ent: Entity, pasted?: string | null): Promise<AiSource[]> {
  const out: AiSource[] = [];
  if (ent.kind === "place") {
    const p = ent.e;
    const contentId = await ourTourId(p).catch(() => null);
    const d = contentId ? await tourDetail(contentId).catch(() => null) : null;
    const i = d?.intro;
    if (i) {
      const lines = [
        i.usetime && `이용 시간: ${i.usetime}`, i.restdate && `쉬는 날: ${i.restdate}`, i.parking && `주차: ${i.parking}`,
        i.parkingFee && `주차 요금: ${i.parkingFee}`, i.fee && `요금: ${i.fee}`, i.babycarriage && `유모차: ${i.babycarriage}`, i.pet && `반려동물: ${i.pet}`,
      ].filter(Boolean);
      if (lines.length) out.push({ label: `관광공사 이용 정보${d?.common?.title ? ` · ${d.common.title}` : ""}`, text: lines.join("\n") });
    }
    const research = [p.hours && `이용 시간: ${p.hours}`, p.closed && `쉬는 날: ${p.closed}`].filter(Boolean);
    if (research.length) out.push({ label: "조사 원문", text: research.join("\n") });
    if (p.intro.trim()) out.push({ label: "소개 글", text: p.intro });
  } else {
    const r = ent.e;
    const lines = [`이름: ${r.name}`, r.note && `카카오 분류: ${r.note}`, ent.placeName && `곁 장소: ${ent.placeName}`, r.hours && `영업 시간: ${r.hours}`, r.closed && `쉬는 날: ${r.closed}`]
      .filter(Boolean);
    out.push({ label: "식당 정보", text: lines.join("\n") });
  }
  const t = (pasted ?? "").trim();
  if (t) out.push({ label: "관리자가 붙여 넣은 글", text: t.slice(0, 4000) });
  return out;
}

// ------------------------------------------------------------------ 모의 답 (로컬 시험 — 규칙으로 원문 읽기)

const aiRow = (r: HoursRow) => ({
  days: r.days, holiday: r.holiday, open: hm(r.openMin), close: hm(r.closeMin),
  last_entry: r.lastEntryMin != null ? hm(r.lastEntryMin) : null, breaks: r.breaks.map((b) => ({ from: hm(b.fromMin), to: hm(b.toMin) })),
  valid_from: r.validFrom, valid_to: r.validTo,
});

function mockAnswer(ent: Entity, sources: AiSource[], fields: readonly string[], vocab: readonly string[]): Record<string, unknown> {
  const ans: Record<string, unknown> = {};
  const put = (f: string, value: unknown, quote: string) => { if (fields.includes(f) && !(f in ans)) ans[f] = { value, quote: quote.slice(0, 60) }; };
  // 줄·문장마다 (붙여 넣은 글은 한 줄에 여러 문장)
  const lines = sources.flatMap((s) => s.text.split(/\n|(?<=[다요])\.\s+/)).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const body = l.replace(/^[^:：]{1,12}[:：]\s*/, "");
    if (/시간|영업|이용/.test(l)) { const h = hoursRowsFromText(body); if (h?.length) put("hours", h.map(aiRow), body); }
    if (/쉬는|휴무|휴관/.test(l)) { const c = closuresFromText(body); if (c && (c.closedDays.length || c.closedRules.length)) put("closed", { days: c.closedDays, rules: c.closedRules }, body); }
    if (/주차/.test(l) && !/^주차 ?요금/.test(l)) { const p = parkingFromText(body); if (p) put("parking", p, body); }
    if (/^요금|입장료|관람료/.test(l)) { const p = priceFromText(body); if (p) put("price", p, body); }
    if (/야경|야간|조명/.test(l)) { const w = /야경|야간|조명/.exec(l)![0]; put("moments", { best: ["day", "night"] }, w); }
    if (ent.kind === "restaurant" && /분류/.test(l)) {
      const c = cuisineFromKakao(body);
      if (c.length) put("cuisine", c, body);
      put("meal", /카페|베이커리|디저트/.test(body) ? ["snack"] : ["lunch", "dinner"], body);
    }
  }
  const all = lines.join(" ");
  const tags = vocab.filter((t) => all.includes(t));
  if (tags.length) put("tags", tags.slice(0, 3), tags[0]);
  return ans;
}

// ------------------------------------------------------------------ 한 곳 채우기

export type FillResult = {
  id: string; name: string; asked: string[]; drafts: AiDrafts; added: string[];
  dropped: { field: string; reason: string }[]; mock: boolean;
};

export class FillError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function fillEntity(ent: Entity, vocab: VocabWord[], o: { fields?: string[]; pasted?: string | null; force?: boolean }): Promise<FillResult> {
  const today = kstToday();
  const e = ent.e;
  // 좌표 없는 예전 식당 줄은 DB 검사(restaurants_latlng_required)에 걸려 초안도 못 쓴다
  if (ent.kind === "restaurant" && (ent.e.lat == null || ent.e.lng == null)) throw new FillError("좌표가 없는 식당이에요 · 지도에서 위치를 찍어 저장한 뒤 AI로 채워 주세요", 400);
  const asked = fillTargets(ent.kind, e, { requested: o.fields, vocab, today, force: o.force || !!o.pasted || !!o.fields?.length });
  const base = { id: e.id, name: e.name, asked, mock: aiFillMock() };
  if (!asked.length) return { ...base, drafts: e.aiDrafts, added: [], dropped: [] };
  const sources = await gatherSources(ent, o.pasted);
  const source = sourceText(sources);
  if (source.length < 8) return { ...base, drafts: e.aiDrafts, added: [], dropped: [{ field: "*", reason: "읽을 원문이 없어요 · 공식 안내 글을 붙여 넣어 주세요" }] };
  const words = vocab.filter((v) => (ent.kind === "restaurant" ? v.category === FOOD_TAG_CATEGORY : v.category !== FOOD_TAG_CATEGORY)).map((v) => v.tag);
  let answer: Record<string, unknown> | null;
  if (aiFillMock()) {
    answer = mockAnswer(ent, sources, asked, words);
  } else {
    if ((await aiCallsToday("fill")) >= aiFillDailyLimit()) throw new FillError(`오늘 AI 채우기 한도(${aiFillDailyLimit()}번)를 다 썼어요 · 내일 다시`, 429);
    const p = buildFillPrompt({ kind: ent.kind, name: e.name, sources, fields: asked, vocab: words });
    answer = extractJson(await chatText(p.system, p.user, { feature: "fill", maxTokens: 1400, timeoutMs: 40_000, temperature: 0.1 }));
  }
  const rep = ent.kind === "place" ? representativeHours(e.openHours) ?? { open: (e as AdminPlace).open, close: (e as AdminPlace).close } : { open: 0, close: 1440 };
  const { drafts, dropped } = validateAiAnswer(ent.kind, answer, { source, fields: asked, today, vocab: words, hours: e.openHours, open: rep.open, close: rep.close });
  const merged = mergeDrafts(e.aiDrafts, drafts, e.meta as Record<string, never>);
  await saveAiDrafts(ent.kind, e.id, merged);
  return { ...base, drafts: merged, added: Object.keys(drafts), dropped };
}

/** 한 곳 (관리자 편집 화면 'AI로 채우기'). fields = 그 칸만, pasted = 붙여 넣은 공식 안내 글. */
export async function fillOne(kind: AiKind, id: string, o: { fields?: string[]; pasted?: string | null; force?: boolean } = {}): Promise<FillResult> {
  if (!aiFillReady()) throw new FillError("AI 키가 없어요 · '관광공사에서 채우기'를 써 주세요", 503);
  const ent = await loadEntity(kind, id);
  if (!ent) throw new FillError(kind === "place" ? "그런 명소가 없어요" : "그런 식당이 없어요", 404);
  const fields = o.fields?.filter((f) => aiFieldsOf(kind).includes(f));
  return fillEntity(ent, await loadTagVocab(), { ...o, fields });
}

/** 원문만 (나란히 보기). */
export async function sourcesOf(kind: AiKind, id: string): Promise<AiSource[] | null> {
  const ent = await loadEntity(kind, id);
  return ent ? gatherSources(ent) : null;
}

// ------------------------------------------------------------------ 한꺼번에 (확인 필요·빈 칸, 묶음마다)

let running = false;

/**
 * 한꺼번에 채우기: ids가 있으면 그곳만, 없으면 켠 곳 먼저 '물을 칸'이 있는 곳 limit곳. 동시에 2곳, 한 번에 한 묶음만.
 * 답: 이번에 한 곳들 · 남은 곳 수 (화면은 남은 게 있으면 이번에 한 곳을 skip에 넣어 다시 부른다 — 못 채운 곳을 되풀이하지 않게).
 */
export async function fillMany(kind: AiKind, o: { ids?: string[]; skip?: string[]; limit?: number } = {}) {
  if (!aiFillReady()) throw new FillError("AI 키가 없어요 · '관광공사에서 채우기'를 써 주세요", 503);
  if (running) throw new FillError("다른 AI 채우기가 아직 도는 중이에요 · 잠시 뒤에", 409);
  running = true;
  try {
    const vocab = await loadTagVocab();
    const today = kstToday();
    const places = await loadAdminPlaces();
    const list: Entity[] = kind === "place"
      ? places.map((e) => ({ kind: "place" as const, e }))
      : (await loadRestaurants()).map((e) => ({ kind: "restaurant" as const, e, placeName: places.find((p) => p.id === e.placeId)?.name ?? null }));
    const want = (o.ids?.length ? list.filter((x) => o.ids!.includes(x.e.id)) : list)
      .filter((x) => !o.skip?.includes(x.e.id) && (x.kind === "place" || (x.e.lat != null && x.e.lng != null)) && fillTargets(kind, x.e, { vocab, today }).length)
      .sort((a, b) => Number(b.e.active) - Number(a.e.active));
    const limit = Math.max(1, Math.min(BULK_MAX, Math.floor(o.limit ?? BULK_MAX)));
    const batch = want.slice(0, limit);
    const results: (FillResult | { id: string; name: string; error: string })[] = [];
    let stop: string | null = null;
    let next = 0;
    const worker = async () => {
      while (next < batch.length && !stop) {
        const ent = batch[next++];
        try {
          results.push(await fillEntity(ent, vocab, {}));
        } catch (e) {
          const msg = e instanceof FillError || e instanceof AiError ? e.message : "AI 채우기 실패";
          results.push({ id: ent.e.id, name: ent.e.name, error: msg });
          // 한도·키·잔액 문제면 묶음을 멈춘다
          if ((e instanceof FillError && e.status === 429) || (e instanceof AiError && ["nokey", "balance", "auth"].includes(e.code))) stop = msg;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { done: results, remaining: Math.max(0, want.length - batch.length), stopped: stop, mock: aiFillMock() };
  } finally {
    running = false;
  }
}
