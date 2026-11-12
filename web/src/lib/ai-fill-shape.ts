/*
 * AI 입력 돕기 (docs/장소-데이터-구조-계획.md §6.1 A) — 모양·검사·합치기. DB·네트워크 없이 (시험 ai-fill-shape.test.ts).
 *
 * 흐름: 원문(관광공사 이용 정보 · 조사 원문 · 소개 글 · 카카오 분류 · 관리자가 붙여 넣은 글) → AI에 '정해진 JSON만' 부탁 →
 *   칸마다 { value, quote } → ① quote가 원문에 그대로 있나(지어낸 근거 막기) ② 값이 서버 저장 검사와 같은 함수를 통과하나 →
 *   통과한 칸만 초안(meta.drafts, src 'ai' · check true · quote · at)으로. 진짜 칸은 관리자가 '맞아요'를 눌러야 바뀐다.
 * 지키는 것: 관리자가 확인한 칸(출처가 있고 '확인 필요'가 아님, 조사 씨앗 제외)은 초안도 만들지 않는다 · 개인정보(전화·메일)는 원문에서 지우고 보낸다.
 */
import { PLACE_FACILITIES, type AdminPlace } from "./catalog-shape";
import {
  BEST_TEXT, CLOSED_RULES, daysLabel, hm, parseClosedRules, parseHoursRows, parseMoments, parseParking, parsePrice, priceLevel,
  representativeHours, vocabTags, WEEKDAY_TEXT,
  type AiDraft, type AiDrafts, type FieldMeta, type HoursRow, type Moments, type Parking, type Price, type VocabWord,
} from "./place-attrs-shape";
import {
  CUISINES, FOOD_PRICE_TEXT, KID_FEATURES, KID_TEXT, MEAL_TYPE_TEXT, MEAL_TYPES, parseCuisine, parseFoodFit, parseKid,
  type FoodRestaurant, type MealType,
} from "./restaurant-shape";
import { COMPANIONS, COMPANION_TEXT } from "./planner";

export type AiKind = "place" | "restaurant";
export const PLACE_AI_FIELDS = ["hours", "closed", "parking", "price", "facilities", "moments", "tags", "fit"] as const;
export const FOOD_AI_FIELDS = ["hours", "parking", "price", "kid", "cuisine", "meal", "tags", "fit"] as const;
export type PlaceAiField = (typeof PLACE_AI_FIELDS)[number];
export type FoodAiField = (typeof FOOD_AI_FIELDS)[number];
export const aiFieldsOf = (kind: AiKind): readonly string[] => (kind === "place" ? PLACE_AI_FIELDS : FOOD_AI_FIELDS);

export const AI_FIELD_TEXT: Record<string, string> = {
  hours: "운영 시간", closed: "쉬는 날", parking: "주차", price: "가격", facilities: "시설", moments: "시간 특성", tags: "태그", fit: "어울림",
  kid: "아이 칸", cuisine: "음식 종류", meal: "식사 자리",
};

/** AI 초안의 처음 믿음 (관리자가 받아들이면 그대로 출처에 남음). */
export const AI_CONF = 0.6;

export type AiSource = { label: string; text: string };

// ------------------------------------------------------------------ 원문 · 개인정보

/** 원문에서 개인정보처럼 보이는 것 지우기 — 메일 · 전화번호(휴대폰·지역번호·대표번호). 가게 전화도 AI엔 필요 없다. */
export function scrubPersonal(t: string): string {
  return t
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "(메일)")
    .replace(/(?<!\d)(?:\+82[-\s]?)?0\d{1,2}[-\s.)]?\d{3,4}[-\s.]?\d{4}(?!\d)/g, "(전화)")
    .replace(/(?<!\d)1[5-9]\d{2}-\d{4}(?!\d)/g, "(전화)");
}

/** 원문 묶음 → AI에 보낼 글 (빈 것 빼고, 각 2,000자 · 전체 6,000자까지). */
export function sourceText(sources: readonly AiSource[]): string {
  let out = "";
  for (const s of sources) {
    const t = scrubPersonal(s.text).replace(/\s+\n/g, "\n").trim().slice(0, 2000);
    if (!t) continue;
    const block = `[${s.label}]\n${t}\n\n`;
    if (out.length + block.length > 6000) break;
    out += block;
  }
  return out.trim();
}

/** 인용 비교용: 띄어쓰기·따옴표·괄호·흔한 문장 부호·물결 모양을 지우고 소문자. */
export function normQuote(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s"'“”‘’`「」『』()[\]{}<>·•,.。:;!?~\-–—∼〜～/|]/g, "");
}

/** quote가 원문에 그대로 있나 (2자 이상). AI가 근거를 지어내면 그 칸은 버린다. */
export function quoteFound(quote: string, source: string): boolean {
  const q = normQuote(quote);
  return q.length >= 2 && normQuote(source).includes(q);
}

// ------------------------------------------------------------------ 무엇을 부탁하나

/** 관리자가 확인한 칸: 출처가 있고 '확인 필요'가 아님 (조사 씨앗은 사람이 본 적이 없어 제외). */
export const confirmedMeta = (m: FieldMeta | undefined): boolean => !!m && !m.check && m.src !== "seed";

const placeEmpty = (p: AdminPlace, f: PlaceAiField, vocab: readonly VocabWord[]): boolean => {
  switch (f) {
    case "hours": return !p.openHours.length;
    case "closed": return !p.closedDays.length && !p.closedRules.length && !p.meta.closed;
    case "parking": return !p.parking;
    case "price": return !p.price;
    case "facilities": return !p.facilities.some((x) => (PLACE_FACILITIES as readonly string[]).includes(x));
    case "moments": return !p.moments?.best.length;
    case "tags": return !vocabTags(p.tags, vocab).length;
    case "fit": return !p.meta.fit;
  }
};
const foodEmpty = (r: FoodRestaurant, f: FoodAiField): boolean => {
  switch (f) {
    case "hours": return !r.openHours.length;
    case "parking": return !r.parking;
    case "price": return !r.price;
    case "kid": return !r.kid;
    case "cuisine": return !r.cuisine.length;
    case "meal": return !r.meal.length;
    case "tags": return !r.tags.length;
    case "fit": return !r.fit;
  }
};

/**
 * AI에 물을 칸. requested가 있으면 그 칸만(확인한 칸 빼고), 없으면 '빈 칸 또는 확인 필요'인 칸.
 * 이미 오늘 만든 초안이 있는 칸은 다시 묻지 않는다 (force면 다시).
 */
export function fillTargets(
  kind: AiKind,
  e: AdminPlace | FoodRestaurant,
  opts: { requested?: readonly string[]; vocab?: readonly VocabWord[]; today?: string; force?: boolean } = {},
): string[] {
  const all = aiFieldsOf(kind);
  const meta = e.meta as Record<string, FieldMeta | undefined>;
  const want = opts.requested?.length ? all.filter((f) => opts.requested!.includes(f)) : all.filter((f) =>
    meta[f]?.check || (kind === "place" ? placeEmpty(e as AdminPlace, f as PlaceAiField, opts.vocab ?? []) : foodEmpty(e as FoodRestaurant, f as FoodAiField)));
  return want.filter((f) => !confirmedMeta(meta[f]) && (opts.force || !opts.today || e.aiDrafts[f]?.at !== opts.today));
}

// ------------------------------------------------------------------ 부탁 글

const HOURS_SCHEMA = (food: boolean) =>
  `[{"days":[1,2,3,4,5],"holiday":false,"open":"09:00","close":"18:00","${food ? "last_order" : "last_entry"}":"17:00 또는 null","breaks":[{"from":"15:00","to":"17:00"}],"valid_from":"MM-DD 또는 null","valid_to":"MM-DD 또는 null"}]  (days 0=일 … 6=토, 자정 넘기면 close를 다음 날 시각으로)`;

/** AI에 줄 부탁 글 (system · user). 정해진 칸·정해진 말만, 원문 인용 필수, 모르면 칸을 빼라고. */
export function buildFillPrompt(o: {
  kind: AiKind; name: string; sources: readonly AiSource[]; fields: readonly string[]; vocab: readonly string[];
}): { system: string; user: string } {
  const food = o.kind === "restaurant";
  const schema: Record<string, string> = {
    hours: HOURS_SCHEMA(food),
    closed: `{"days":[1],"rules":[${Object.keys(CLOSED_RULES).map((k) => `"${k}"`).join(",")} 중에서]}  (days = 매주 쉬는 요일)`,
    parking: `{"has":"yes|no|limited","kind":"own|public|street","fee":"free|paid|partial","fee_note":"1시간 1,000원","walk_min":5}`,
    price: food ? `{"level":0~3}  (1인 0 무료 · 1 1만 원 안쪽 · 2 2만 원 안쪽 · 3 그 넘게)` : `{"free":false,"adult":3000,"child":1000,"child_free_under":6}  (원)`,
    facilities: `[${PLACE_FACILITIES.map((f) => `"${f}"`).join(",")} 중에서]`,
    moments: `{"best":["day","sunset","night" 중에서],"light":{"on":"sunset+15 또는 HH:MM","off":"HH:MM"},"shows":[{"name":"음악분수","times":["19:00"],"days":[5,6,0],"months":[5,6,7,8,9,10]}],"season":[{"what":"단풍","months":[10,11]}]}`,
    tags: `[${o.vocab.map((t) => `"${t}"`).join(",")} 중에서]`,
    fit: `{${COMPANIONS.map((c) => `"${c}":0~1`).join(",")}}  (${COMPANIONS.map((c) => `${c}=${COMPANION_TEXT[c]}`).join(" · ")} 얼마나 어울리는지)`,
    kid: `[${KID_FEATURES.map((k) => `"${k}"`).join(",")} 중에서]  (${KID_FEATURES.map((k) => `${k}=${KID_TEXT[k]}`).join(" · ")})`,
    cuisine: `[${CUISINES.map((c) => `"${c}"`).join(",")} 중 1~2개]`,
    meal: `[${MEAL_TYPES.map((m) => `"${m}"`).join(",")} 중에서]  (lunch 점심 · dinner 저녁 · snack 간식)`,
  };
  const lines = o.fields.filter((f) => schema[f]).map((f) => `- "${f}": ${schema[f]}`);
  const system = [
    "너는 장소 정보 입력을 돕는 도우미다. 주어진 원문에서 확인되는 사실만 정해진 JSON으로 옮긴다.",
    "규칙: (1) JSON 하나만 답한다. 설명·마크다운 금지. (2) 원문에 근거가 없는 칸은 아예 넣지 않는다 — 짐작 금지.",
    "(3) 칸마다 {\"value\": 값, \"quote\": \"원문에서 그대로 복사한 근거 한 조각(60자 안)\"}. quote는 원문 글자를 바꾸지 말 것.",
    "(4) 값은 아래 모양과 정해진 말만 쓴다. 시각은 24시간 HH:MM.",
  ].join("\n");
  const user = [
    `${food ? "식당" : "장소"}: ${o.name}`,
    "채울 칸 (근거가 있는 것만):",
    ...lines,
    "",
    "원문:",
    sourceText(o.sources),
    "",
    '답 모양 예: {"parking":{"value":{"has":"yes","fee":"free"},"quote":"무료 주차 가능"}}',
  ].join("\n");
  return { system, user };
}

/** AI 답 글 → JSON (```json 울타리·앞뒤 말이 있어도 첫 { … 끝 } 를 읽는다). 못 읽으면 null. */
export function extractJson(text: string): Record<string, unknown> | null {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(t.slice(a, b + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ 칸마다 검사 (서버 저장 검사와 같은 함수)

const DAY_WORD: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
/** 'HH:MM' → 분 (24:00 = 1440). 숫자면 그대로. */
function minOfTime(v: unknown): number {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return NaN;
  const h = Number(m[1]), mi = Number(m[2]);
  return h <= 36 && mi < 60 ? h * 60 + mi : NaN;
}
const dayNum = (d: unknown): number => (typeof d === "string" && d in DAY_WORD ? DAY_WORD[d] : Number(d));

/** AI 운영 시간 줄 (HH:MM) → HoursRow 입력 모양 → parseHoursRows. */
export function hoursFromAi(v: unknown, food: boolean): { ok: HoursRow[] } | { error: string } {
  if (!Array.isArray(v) || !v.length) return { error: "운영 시간 줄이 없어요" };
  const rows = v.slice(0, 8).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const opt = (k: string) => (o[k] == null || o[k] === "" ? null : minOfTime(o[k]));
    return {
      days: (Array.isArray(o.days) ? o.days : []).map(dayNum),
      holiday: o.holiday === true,
      openMin: minOfTime(o.open),
      closeMin: minOfTime(o.close),
      lastEntryMin: food ? null : opt("last_entry"),
      ...(food ? { lastOrderMin: opt("last_order") } : {}),
      breaks: (Array.isArray(o.breaks) ? o.breaks : []).map((b) => ({ fromMin: minOfTime((b as Record<string, unknown>)?.from), toMin: minOfTime((b as Record<string, unknown>)?.to) })),
      validFrom: o.valid_from ?? null,
      validTo: o.valid_to ?? null,
      note: null,
    };
  });
  if (rows.some((r) => !Number.isFinite(r.openMin) || !Number.isFinite(r.closeMin))) return { error: "운영 시각이 HH:MM이 아니에요" };
  return parseHoursRows(rows);
}

type Ctx = { vocab: readonly string[]; hours: readonly HoursRow[]; open: number; close: number };

/** 칸 하나 검사 → 저장할 값. 틀리면 이유. */
export function validateField(kind: AiKind, field: string, v: unknown, ctx: Ctx): { ok: unknown } | { error: string } {
  const food = kind === "restaurant";
  const arr = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
  switch (field) {
    case "hours": return hoursFromAi(v, food);
    case "closed": {
      if (food) break;
      const o = (v ?? {}) as Record<string, unknown>;
      const days = [...new Set((Array.isArray(o.days) ? o.days : []).map(dayNum))].sort((a, b) => a - b);
      if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return { error: "쉬는 요일이 이상해요" };
      const rules = parseClosedRules(arr(o.rules).filter((r) => r in CLOSED_RULES));
      if (!days.length && !rules?.length) return { error: "쉬는 날이 비었어요" };
      return { ok: { closedDays: days, closedRules: rules ?? [] } };
    }
    case "parking": {
      const r = parseParking(v);
      if ("error" in r) return r;
      return r.ok ? { ok: r.ok } : { error: "주차가 비었어요" };
    }
    case "price": {
      if (food) {
        const lv = Number((v as { level?: unknown } | null)?.level ?? v);
        return Number.isInteger(lv) && lv >= 0 && lv <= 3 ? { ok: { level: lv } } : { error: "가격 단계는 0~3이에요" };
      }
      const r = parsePrice(v);
      if ("error" in r) return r;
      return r.ok ? { ok: r.ok } : { error: "가격이 비었어요" };
    }
    case "facilities": {
      if (food) break;
      const xs = [...new Set(arr(v))].filter((f) => (PLACE_FACILITIES as readonly string[]).includes(f));
      return xs.length ? { ok: xs } : { error: "정해진 시설 말이 없어요" };
    }
    case "moments": {
      if (food) break;
      const r = parseMoments(v, { hours: ctx.hours, open: ctx.open, close: ctx.close });
      if ("error" in r) return r;
      return r.ok && (r.ok.best.length || r.ok.shows?.length || r.ok.season?.length || r.ok.light) ? { ok: r.ok } : { error: "시간 특성이 비었어요" };
    }
    case "tags": {
      const xs = [...new Set(arr(v))].filter((t) => ctx.vocab.includes(t)).slice(0, 8);
      return xs.length ? { ok: xs } : { error: "단어장에 있는 태그가 없어요" };
    }
    case "fit": {
      const r = parseFoodFit(v);
      return r ? { ok: r } : { error: "어울림 숫자(0~1)가 없어요" };
    }
    case "kid": {
      if (!food) break;
      const keys = Array.isArray(v) ? v : Object.keys((v ?? {}) as object).filter((k) => (v as Record<string, unknown>)[k] === true);
      const r = parseKid(Object.fromEntries(keys.map((k) => [String(k), true])));
      return r ? { ok: r } : { error: "정해진 아이 칸 말이 없어요" };
    }
    case "cuisine": {
      if (!food) break;
      const r = parseCuisine(arr(v).slice(0, 2));
      if ("error" in r) return r;
      return r.ok.length ? r : { error: "음식 종류가 비었어요" };
    }
    case "meal": {
      if (!food) break;
      const xs = [...new Set(arr(v))].filter((m): m is MealType => (MEAL_TYPES as readonly string[]).includes(m));
      return xs.length ? { ok: xs } : { error: "식사 자리가 비었어요" };
    }
  }
  return { error: "이 칸은 채우지 않아요" };
}

/**
 * AI 답 검사 → 초안. 물은 칸(fields)만, quote가 원문에 있고 값 검사를 통과한 칸만. 버린 칸은 이유와 함께.
 */
export function validateAiAnswer(
  kind: AiKind,
  answer: Record<string, unknown> | null,
  ctx: Ctx & { source: string; fields: readonly string[]; today: string },
): { drafts: AiDrafts; dropped: { field: string; reason: string }[] } {
  const drafts: AiDrafts = {};
  const dropped: { field: string; reason: string }[] = [];
  if (!answer) return { drafts, dropped: [{ field: "*", reason: "AI 답을 JSON으로 읽지 못했어요" }] };
  for (const [field, raw] of Object.entries(answer)) {
    if (!ctx.fields.includes(field)) { dropped.push({ field, reason: "묻지 않은 칸" }); continue; }
    const o = (raw ?? {}) as Record<string, unknown>;
    const quote = typeof o.quote === "string" ? o.quote.trim() : "";
    if (!quote) { dropped.push({ field, reason: "근거(원문 인용)가 없어요" }); continue; }
    if (!quoteFound(quote, ctx.source)) { dropped.push({ field, reason: "근거가 원문에 없어요" }); continue; }
    const r = validateField(kind, field, o.value, ctx);
    if ("error" in r) { dropped.push({ field, reason: r.error }); continue; }
    drafts[field] = { src: "ai", conf: AI_CONF, at: ctx.today, check: true, quote: quote.slice(0, 300), value: r.ok };
  }
  return { drafts, dropped };
}

/** 새 초안 합치기: 같은 칸은 새것으로, 그사이 관리자가 확인한 칸의 초안은 버린다. */
export function mergeDrafts(old: AiDrafts, incoming: AiDrafts, meta: Record<string, FieldMeta | undefined>): AiDrafts {
  const out: AiDrafts = {};
  for (const [k, d] of Object.entries({ ...old, ...incoming })) if (d && !confirmedMeta(meta[k])) out[k] = d;
  return out;
}

// ------------------------------------------------------------------ 받아들이기 (화면 · 표 한꺼번에)

/** 저장된 초안 값(이미 검사를 통과한 모양) 다시 검사 — 받아들이기 직전 (DB에서 읽은 값을 믿지 않음). */
export function checkStored(kind: AiKind, field: string, v: unknown, ctx: Ctx): { ok: unknown } | { error: string } {
  if (field === "hours") return parseHoursRows(v);
  if (field === "closed" && kind === "place") {
    const c = (v ?? {}) as { closedDays?: unknown; closedRules?: unknown };
    return validateField(kind, field, { days: c.closedDays, rules: c.closedRules }, ctx);
  }
  return validateField(kind, field, v, ctx);
}

const acceptedMeta = (d: AiDraft, today: string): FieldMeta => ({ src: "ai", conf: Math.max(d.conf, 0.8), at: today, quote: d.quote });
const withoutDraft = (drafts: AiDrafts, f: string): AiDrafts => { const n = { ...drafts }; delete n[f]; return n; };

/** 명소 초안 한 칸을 진짜 칸으로 (출처 AI · 확인함 · 오늘). 값이 이상하면 초안만 지운다. */
export function acceptPlaceDraft(p: AdminPlace, field: string, today: string): AdminPlace {
  const d = p.aiDrafts[field];
  if (!d) return p;
  const base = { ...p, aiDrafts: withoutDraft(p.aiDrafts, field) };
  const rep = representativeHours(p.openHours) ?? { open: p.open, close: p.close };
  const r = checkStored("place", field, d.value, { vocab: [], hours: p.openHours, open: rep.open, close: rep.close });
  // 태그는 단어장을 화면이 모를 수 있어 값 그대로 (저장 때 서버가 모양만 본다)
  const v = field === "tags" ? d.value : "ok" in r ? r.ok : undefined;
  if (v === undefined) return base;
  const meta = { ...p.meta, [field]: acceptedMeta(d, today) };
  switch (field) {
    case "hours": return { ...base, openHours: v as HoursRow[], meta };
    case "closed": { const c = v as { closedDays: number[]; closedRules: string[] }; return { ...base, closedDays: c.closedDays, closedRules: c.closedRules, meta }; }
    case "parking": return { ...base, parking: v as Parking, meta };
    case "price": return { ...base, price: v as Price, meta };
    case "facilities": return { ...base, facilities: [...new Set([...p.facilities, ...(v as string[])])], meta };
    case "moments": return { ...base, moments: v as Moments, meta };
    case "tags": return { ...base, tags: [...new Set([...p.tags, ...(Array.isArray(v) ? v.map(String) : [])])], meta };
    case "fit": {
      const f = v as Partial<Record<(typeof COMPANIONS)[number], number>>;
      return { ...base, kidFit: f.kids ?? p.kidFit, fit: { ...p.fit, ...f }, meta };
    }
  }
  return base;
}

/** 식당 초안 한 칸을 진짜 칸으로. */
export function acceptFoodDraft<T extends Omit<FoodRestaurant, "id">>(r: T, field: string, today: string): T {
  const d = r.aiDrafts[field];
  if (!d) return r;
  const base = { ...r, aiDrafts: withoutDraft(r.aiDrafts, field) };
  const res = checkStored("restaurant", field, d.value, { vocab: [], hours: r.openHours, open: 0, close: 1440 });
  const v = field === "tags" ? d.value : "ok" in res ? res.ok : undefined;
  if (v === undefined) return base;
  const meta = { ...r.meta, [field]: acceptedMeta(d, today) };
  switch (field) {
    case "hours": return { ...base, openHours: v as HoursRow[], meta };
    case "parking": return { ...base, parking: v as Parking, meta };
    case "price": return { ...base, price: v as FoodRestaurant["price"], meta };
    case "kid": return { ...base, kid: v as FoodRestaurant["kid"], meta };
    case "cuisine": return { ...base, cuisine: v as string[], meta };
    case "meal": return { ...base, meal: v as MealType[], meta };
    case "tags": return { ...base, tags: [...new Set([...r.tags, ...(Array.isArray(v) ? v.map(String) : [])])], meta };
    case "fit": return { ...base, fit: { ...(r.fit ?? {}), ...(v as object) }, meta };
  }
  return base;
}

/** 버리기. */
export function discardDraft<T extends { aiDrafts: AiDrafts }>(e: T, field: string): T {
  return { ...e, aiDrafts: withoutDraft(e.aiDrafts, field) };
}

// ------------------------------------------------------------------ 보여 주기

const PK_HAS: Record<string, string> = { yes: "있음", limited: "좁음", no: "없음" };
const PK_KIND: Record<string, string> = { own: "자체", public: "공영", street: "길가" };
const PK_FEE: Record<string, string> = { free: "무료", paid: "유료", partial: "일부 무료" };

export function hoursText(rows: readonly HoursRow[]): string {
  return rows.map((r) => {
    const days = r.holiday ? `${r.days.length ? `${daysLabel(r.days)}·` : ""}공휴일` : daysLabel(r.days);
    const extra = [r.lastEntryMin != null ? `입장 ${hm(r.lastEntryMin)}까지` : "", r.lastOrderMin != null ? `주문 ${hm(r.lastOrderMin)}까지` : "",
      r.breaks.length ? `쉬는 시간 ${r.breaks.map((b) => `${hm(b.fromMin)}~${hm(b.toMin)}`).join(",")}` : "",
      r.validFrom ? `${r.validFrom}~${r.validTo}` : ""].filter(Boolean).join(" · ");
    return `${days} ${hm(r.openMin)}–${hm(r.closeMin)}${extra ? ` (${extra})` : ""}`;
  }).join(" / ");
}

export function parkingText(p: Parking): string {
  return [PK_HAS[p.has], p.kind ? PK_KIND[p.kind] : "", p.fee ? PK_FEE[p.fee] : "", p.fee_note ?? "", p.walk_min != null ? `걷기 ${p.walk_min}분` : "", p.weekend_full ? "주말 꽉 참" : ""]
    .filter(Boolean).join(" · ");
}

/** 초안 값 한 줄 (AI 초안 칸 · 표 · 나란히 보기). */
export function draftText(kind: AiKind, field: string, v: unknown): string {
  try {
    switch (field) {
      case "hours": return hoursText(v as HoursRow[]);
      case "closed": {
        const c = v as { closedDays: number[]; closedRules: string[] };
        return [c.closedDays.length ? `매주 ${c.closedDays.map((d) => WEEKDAY_TEXT[d]).join("·")}` : "", ...c.closedRules.map((r) => CLOSED_RULES[r])].filter(Boolean).join(" · ");
      }
      case "parking": return parkingText(v as Parking);
      case "price": {
        if (kind === "restaurant") return FOOD_PRICE_TEXT[(v as { level: number }).level] ?? "";
        const p = v as Price;
        return p.free ? "무료 입장" : [p.adult != null ? `어른 ${p.adult.toLocaleString()}원` : "", p.child != null ? `아이 ${p.child.toLocaleString()}원` : "", p.child_free_under ? `${p.child_free_under}살 아래 무료` : ""].filter(Boolean).join(" · ") || `단계 ${priceLevel(p)}`;
      }
      case "facilities": case "tags": case "cuisine": return (v as string[]).join(" · ");
      case "moments": {
        const m = v as Moments;
        return [m.best.map((b) => BEST_TEXT[b]).join("·"), m.light ? `조명 ${m.light.on.replace("sunset", "해 지고 ")}` : "", ...(m.shows ?? []).map((s) => `${s.name} ${s.times.join(",")}`), ...(m.season ?? []).map((s) => `${s.what} ${s.months.join(",")}월`)].filter(Boolean).join(" · ");
      }
      case "fit": return COMPANIONS.filter((c) => (v as Record<string, number>)[c] != null).map((c) => `${COMPANION_TEXT[c]} ${(v as Record<string, number>)[c].toFixed(1)}`).join(" · ");
      case "kid": return KID_FEATURES.filter((k) => (v as Record<string, boolean>)[k]).map((k) => KID_TEXT[k]).join(" · ");
      case "meal": return (v as MealType[]).map((m) => MEAL_TYPE_TEXT[m]).join(" · ");
    }
  } catch {
    /* 아래 */
  }
  return JSON.stringify(v).slice(0, 80);
}

