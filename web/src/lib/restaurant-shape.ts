/*
 * 식당 구조 칸 (docs/장소-데이터-구조-계획.md §2.3 · §5.3 · §5.4) — 모양·검사·엔진 변환·카카오 답 읽기. DB·네트워크 없이 (시험 restaurant-shape.test.ts).
 * 장소와 같은 부품을 쓴다: 운영 시간 줄(HoursRow — 브레이크·마지막 주문 포함) · 주차(Parking) · 어울림(fit) · 출처(meta).
 * 엔진 쪽 모양은 planner.ts Restaurant (= 엔진 Meals.kt Restaurant).
 */
import {
  draftsOf, hoursRowsLoose, parseAiDrafts, parseHoursRows, parseParking, isStale, type AiDrafts, type FieldMeta, type HoursRow, type Parking, META_SOURCES,
} from "./place-attrs-shape";
import { COMPANIONS, MEAL_KID_TEXT, type Companion, type Restaurant as EngineRestaurant } from "./planner";

// ------------------------------------------------------------------ 정해진 말

/** 음식 종류 (1~2개). */
export const CUISINES = ["한식", "분식", "면", "고기", "국밥", "해물", "카페", "베이커리", "양식", "중식", "일식", "뷔페"] as const;
export type Cuisine = (typeof CUISINES)[number];
/** 아이 칸 (엔진 Meals.KID_TEXT와 같은 말·순서). */
export const KID_FEATURES = MEAL_KID_TEXT.map(([k]) => k) as readonly string[];
export const KID_TEXT: Record<string, string> = Object.fromEntries(MEAL_KID_TEXT);
/** 식사 자리. */
export const MEAL_TYPES = ["lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export const MEAL_TYPE_TEXT: Record<MealType, string> = { lunch: "점심", dinner: "저녁", snack: "간식" };
/** 예약. */
export const RESERVE_TYPES = ["none", "phone", "app"] as const;
export type Reserve = (typeof RESERVE_TYPES)[number];
export const RESERVE_TEXT: Record<Reserve, string> = { none: "예약 없음", phone: "전화 예약", app: "앱 예약" };
/** 붐빔 0 바로 · 1 조금 기다림 · 2 오래 기다림. */
export const WAIT_KEYS = ["weekday", "weekend_lunch", "weekend_dinner"] as const;
export type WaitKey = (typeof WAIT_KEYS)[number];
export const WAIT_KEY_TEXT: Record<WaitKey, string> = { weekday: "평일", weekend_lunch: "주말 점심", weekend_dinner: "주말 저녁" };
export const WAIT_LEVEL_TEXT = ["바로", "조금", "오래"] as const;
/** 식당 태그 단어장 (tag_vocab 묶음 '식당'). 동행 가점: 아이랑(아이와) · 뷰 맛집(연인) · 노포(친구) · 혼밥(혼자). */
export const FOOD_TAGS = ["아이랑", "뷰 맛집", "노포", "혼밥", "주차 쉬움", "데이트", "단체"] as const;
export const FOOD_TAG_CATEGORY = "식당";
/** 가격 level (1인): 0 무료·시식 · 1 1만 원 안쪽 · 2 2만 원 안쪽 · 3 그 이상. */
export const FOOD_PRICE_TEXT = ["무료", "1만 원 안쪽", "2만 원 안쪽", "2만 원 넘게"] as const;
/** 출처를 다는 칸 (관리자 배지). */
export const FOOD_META_FIELDS = ["location", "hours", "parking", "price", "kid", "wait", "cuisine", "meal", "fit", "tags"] as const;
export type FoodMetaField = (typeof FOOD_META_FIELDS)[number];
export type FoodMeta = Partial<Record<FoodMetaField, FieldMeta>>;
/** 식당 머무름 범위 (분). */
export const FOOD_DWELL_RANGE = [15, 120] as const;

export type FoodPrice = { level: 0 | 1 | 2 | 3 };
export type KidInfo = Partial<Record<string, boolean>>;
export type Wait = Partial<Record<WaitKey, 0 | 1 | 2>>;
export type FoodFit = Partial<Record<Companion, number>>;

/** 관리자·앱 모양 식당 (DB 한 줄). 예전 칸(facilities·hours 글·closed·note)은 표시용으로 남는다. */
export type FoodRestaurant = {
  id: string;
  name: string;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  facilities: string[];
  hours: string | null;
  closed: string | null;
  note: string | null;
  active: boolean;
  cuisine: string[];
  price: FoodPrice | null;
  kid: KidInfo | null;
  parking: Parking | null;
  wait: Wait | null;
  reserve: Reserve | null;
  meal: MealType[];
  dwellMin: number | null;
  fit: FoodFit | null;
  tags: string[];
  meta: FoodMeta;
  kakaoId: string | null;
  phone: string | null;
  address: string | null;
  url: string | null;
  /** 운영 시간 줄 (entity_hours, entity_kind 'restaurant'). */
  openHours: HoursRow[];
  /** AI 초안 (meta.drafts — 칸에는 아직 안 들어감) */
  aiDrafts: AiDrafts;
};

/** 저장 요청: aiDrafts가 없으면(undefined) DB 초안은 그대로 둔다. */
export type FoodInput = Omit<FoodRestaurant, "id" | "aiDrafts"> & { aiDrafts?: AiDrafts };

// ------------------------------------------------------------------ 검사

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const txt = (v: unknown, max: number): string | null => (v === null || v === undefined ? null : String(v).trim().slice(0, max) || null);
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): T | null => (typeof v === "string" && (xs as readonly string[]).includes(v) ? (v as T) : null);
const n01 = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 100) / 100 : null;
};

export function parseCuisine(v: unknown): { ok: string[] } | { error: string } {
  const xs = [...new Set((Array.isArray(v) ? v : []).map(String))];
  if (!xs.every((x) => (CUISINES as readonly string[]).includes(x))) return { error: `음식 종류는 ${CUISINES.join("·")} 중에서 골라요` };
  if (xs.length > 2) return { error: "음식 종류는 2개까지예요" };
  return { ok: xs };
}

export function parseKid(v: unknown): KidInfo | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: KidInfo = {};
  for (const k of KID_FEATURES) if ((v as Record<string, unknown>)[k] === true) out[k] = true;
  return Object.keys(out).length ? out : null;
}

export function parseWait(v: unknown): { ok: Wait | null } | { error: string } {
  if (v == null) return { ok: null };
  if (typeof v !== "object" || Array.isArray(v)) return { error: "붐빔 모양이 이상해요" };
  const out: Wait = {};
  for (const k of WAIT_KEYS) {
    const x = (v as Record<string, unknown>)[k];
    if (x == null || x === "") continue;
    const n = Number(x);
    if (!isInt(n, 0, 2)) return { error: `붐빔(${WAIT_KEY_TEXT[k]})은 0~2예요` };
    out[k] = n as 0 | 1 | 2;
  }
  return { ok: Object.keys(out).length ? out : null };
}

export function parseFoodFit(v: unknown): FoodFit | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: FoodFit = {};
  for (const c of COMPANIONS) {
    const x = n01((v as Record<string, unknown>)[c]);
    if (x != null) out[c] = x;
  }
  return Object.keys(out).length ? out : null;
}

export function parseFoodMeta(v: unknown): FoodMeta {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: FoodMeta = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!(FOOD_META_FIELDS as readonly string[]).includes(k) || !x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const src = oneOf(o.src, META_SOURCES);
    const conf = n01(o.conf);
    const at = String(o.at ?? "");
    if (!src || conf == null || !/^\d{4}-\d{2}-\d{2}$/.test(at)) continue;
    const quote = typeof o.quote === "string" && o.quote.trim() ? o.quote.trim().slice(0, 300) : null;
    out[k as FoodMetaField] = { src, conf, at, ...(o.check === true ? { check: true } : {}), ...(quote ? { quote } : {}) };
  }
  return out;
}

/** 관리자 입력 검사 (§5.4: 좌표 필수 · 켤 때 음식 종류 1~2개 · 운영 시간 줄 검사). */
export function parseFoodInput(body: unknown, opts: { tags?: readonly string[]; facilities?: readonly string[] } = {}): { ok: FoodInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "내용이 비었어요" };
  const b = body as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  if (!name) return { error: "이름을 적어 주세요" };
  const lat = b.lat === null || b.lat === "" || b.lat === undefined ? null : Number(b.lat);
  const lng = b.lng === null || b.lng === "" || b.lng === undefined ? null : Number(b.lng);
  if (lat == null || lng == null) return { error: "좌표(위도·경도)를 넣어 주세요 — 지도에서 찍거나 카카오에서 가져와요" };
  if (!finite(lat) || !finite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "좌표가 이상해요" };
  const active = b.active === undefined ? true : !!b.active;
  const cu = parseCuisine(b.cuisine);
  if ("error" in cu) return cu;
  if (active && cu.ok.length === 0) return { error: "켜려면 음식 종류를 1~2개 골라 주세요" };
  const hr = parseHoursRows(b.openHours ?? []);
  if ("error" in hr) return hr;
  const pk = parseParking(b.parking ?? null);
  if ("error" in pk) return pk;
  const wt = parseWait(b.wait ?? null);
  if ("error" in wt) return wt;
  const pl = (b.price as { level?: unknown } | null)?.level;
  const price = pl == null || pl === "" ? null : isInt(Number(pl), 0, 3) ? { level: Number(pl) as 0 | 1 | 2 | 3 } : undefined;
  if (price === undefined) return { error: "가격은 0~3 단계예요" };
  const dwell = b.dwellMin == null || b.dwellMin === "" ? null : Number(b.dwellMin);
  if (dwell != null && !isInt(dwell, FOOD_DWELL_RANGE[0], FOOD_DWELL_RANGE[1])) return { error: `머무름은 ${FOOD_DWELL_RANGE[0]}~${FOOD_DWELL_RANGE[1]}분이에요` };
  const meal = [...new Set((Array.isArray(b.meal) ? b.meal : []).map(String))].filter((x): x is MealType => (MEAL_TYPES as readonly string[]).includes(x));
  const vocab = opts.tags ?? FOOD_TAGS;
  const tags = [...new Set((Array.isArray(b.tags) ? b.tags : []).map(String))].filter((t) => vocab.includes(t)).slice(0, 8);
  const facilities = [...new Set((Array.isArray(b.facilities) ? b.facilities : []).map(String))].filter((f) => !opts.facilities || opts.facilities.includes(f));
  const url = txt(b.url, 300);
  if (url && !/^https?:\/\//.test(url)) return { error: "주소(url)는 http로 시작해요" };
  const kakaoId = txt(b.kakaoId, 40);
  if (kakaoId && !/^\d{1,20}$/.test(kakaoId)) return { error: "카카오 장소 번호가 이상해요" };
  return {
    ok: {
      name: name.slice(0, 60),
      placeId: txt(b.placeId, 80),
      lat, lng,
      facilities,
      hours: txt(b.hours, 200),
      closed: txt(b.closed, 200),
      note: txt(b.note, 200),
      active,
      cuisine: cu.ok,
      price,
      kid: parseKid(b.kid),
      parking: pk.ok,
      wait: wt.ok,
      reserve: oneOf(b.reserve, RESERVE_TYPES),
      meal,
      dwellMin: dwell,
      fit: parseFoodFit(b.fit),
      tags,
      meta: parseFoodMeta(b.meta),
      ...(b.aiDrafts !== undefined ? { aiDrafts: parseAiDrafts(b.aiDrafts) } : {}),
      kakaoId,
      phone: txt(b.phone, 30),
      address: txt(b.address, 120),
      url,
      openHours: hr.ok,
    },
  };
}

// ------------------------------------------------------------------ DB 줄 → 앱 모양 · 엔진 모양

export type FoodRow = {
  id: string; name: string; place_id: string | null; lat: number | null; lng: number | null; facilities: string[] | null;
  hours: string | null; closed: string | null; note: string | null; active: boolean;
  cuisine?: string[] | null; price?: unknown; kid?: unknown; parking?: unknown; wait?: unknown; reserve?: string | null; meal?: string[] | null;
  dwell_min?: number | null; fit?: unknown; tags?: string[] | null; meta?: unknown; kakao_id?: string | null; phone?: string | null;
  address?: string | null; url?: string | null; open_hours?: unknown;
};

export function foodOfRow(r: FoodRow): FoodRestaurant {
  const pk = parseParking(r.parking ?? null);
  const wt = parseWait(r.wait ?? null);
  const pl = (r.price as { level?: unknown } | null)?.level;
  return {
    id: r.id, name: r.name, placeId: r.place_id, lat: r.lat, lng: r.lng, facilities: r.facilities ?? [],
    hours: r.hours, closed: r.closed, note: r.note, active: r.active,
    cuisine: (r.cuisine ?? []).filter((c) => (CUISINES as readonly string[]).includes(c)),
    price: isInt(pl, 0, 3) ? { level: pl as 0 | 1 | 2 | 3 } : null,
    kid: parseKid(r.kid),
    parking: "ok" in pk ? pk.ok : null,
    wait: "ok" in wt ? wt.ok : null,
    reserve: oneOf(r.reserve, RESERVE_TYPES),
    meal: (r.meal ?? []).filter((x): x is MealType => (MEAL_TYPES as readonly string[]).includes(x)),
    dwellMin: r.dwell_min ?? null,
    fit: parseFoodFit(r.fit),
    tags: r.tags ?? [],
    meta: parseFoodMeta(r.meta),
    kakaoId: r.kakao_id ?? null, phone: r.phone ?? null, address: r.address ?? null, url: r.url ?? null,
    openHours: hoursRowsLoose(r.open_hours),
    aiDrafts: draftsOf(r.meta),
  };
}

/**
 * 엔진 식당 (추천·밥 넣기). 좌표가 없으면 null. 확인 필요(check)인 운영 시간·주차는 조건으로 안 쓴다 (§2 ⑪) —
 * 운영 시간이 확인 전이면 빈 줄(= 11:00~21:00 어림), 주차가 확인 전이면 모름.
 */
export function engineRestaurant(f: FoodRestaurant): EngineRestaurant | null {
  if (f.lat == null || f.lng == null) return null;
  const hoursOk = !f.meta.hours?.check;
  const parkingOk = !f.meta.parking?.check;
  return {
    id: f.id, name: f.name, at: { lat: f.lat, lng: f.lng }, cuisine: f.cuisine,
    priceLevel: f.price?.level ?? null,
    kid: Object.keys(f.kid ?? {}).filter((k) => f.kid?.[k]),
    parkingHas: parkingOk ? f.parking?.has ?? null : null,
    parkingFee: parkingOk ? f.parking?.fee ?? null : null,
    wait: { ...(f.wait ?? {}) } as Record<string, number>,
    meal: f.meal, dwellMin: f.dwellMin, fit: f.fit ?? {}, tags: f.tags,
    hours: hoursOk ? f.openHours : [],
    placeId: f.placeId,
  };
}

/** 차 엔진에 싣는 식당 (/api/car/places restaurants[]) — 엔진 Restaurant 칸 이름 그대로, 시각은 분. */
export function carRestaurantJson(r: EngineRestaurant) {
  return {
    id: r.id, name: r.name, lat: r.at.lat, lng: r.at.lng, cuisine: r.cuisine ?? [], priceLevel: r.priceLevel ?? null,
    kid: r.kid ?? [], parking: r.parkingHas ? { has: r.parkingHas, fee: r.parkingFee ?? null } : null, wait: r.wait ?? {},
    meal: r.meal ?? [], dwellMin: r.dwellMin ?? null, fit: r.fit ?? {}, tags: r.tags ?? [], openHours: r.hours ?? [], placeId: r.placeId ?? null,
  };
}

// ------------------------------------------------------------------ 완성도 · 표 보기

export function foodCompleteness(f: FoodRestaurant): { done: number; total: number; missing: string[] } {
  const items: [string, boolean][] = [
    ["좌표", f.lat != null && f.lng != null],
    ["음식 종류", f.cuisine.length > 0],
    ["운영 시간", f.openHours.length > 0],
    ["주차", !!f.parking],
    ["가격", !!f.price],
    ["아이 칸", !!f.kid],
    ["붐빔", !!f.wait],
    ["식사 자리", f.meal.length > 0],
    ["어울림", !!f.fit],
  ];
  return { done: items.filter(([, ok]) => ok).length, total: items.length, missing: items.filter(([, ok]) => !ok).map(([n]) => n) };
}

/** 확인 필요 칸이 있나 · 90일 지난 칸이 있나 (표 보기 거르기). */
export const foodNeedsCheck = (f: FoodRestaurant) => Object.values(f.meta).some((m) => m?.check);
export const foodStale = (f: FoodRestaurant, today: string) => Object.values(f.meta).some((m) => isStale(m, today));

// ------------------------------------------------------------------ 카카오 '근처 식당 가져오기'

/** 카카오 카테고리 검색 한 줄 (/v2/local/search/category.json documents[]) — 쓰는 칸만. */
export type KakaoFood = {
  kakaoId: string; name: string; category: string; group: string; phone: string | null; address: string | null; url: string | null;
  lat: number; lng: number; distanceM: number | null;
};

export function parseKakaoCategory(json: unknown): KakaoFood[] {
  const docs = (json as { documents?: unknown })?.documents;
  if (!Array.isArray(docs)) return [];
  const out: KakaoFood[] = [];
  for (const d of docs) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const id = String(o.id ?? "");
    const name = String(o.place_name ?? "").trim();
    const lat = Number(o.y), lng = Number(o.x);
    if (!/^\d{1,20}$/.test(id) || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const dist = Number(o.distance);
    out.push({
      kakaoId: id, name: name.slice(0, 60), category: String(o.category_name ?? ""), group: String(o.category_group_code ?? ""),
      phone: s(o.phone)?.slice(0, 30) ?? null, address: (s(o.road_address_name) ?? s(o.address_name))?.slice(0, 120) ?? null,
      url: s(o.place_url)?.replace(/^http:/, "https:").slice(0, 300) ?? null, lat, lng, distanceM: Number.isFinite(dist) ? dist : null,
    });
  }
  return out;
}

/**
 * 카카오 분류 '음식점 > 한식 > 국밥' → 우리 음식 종류 (1~2개). 모르면 한식(음식점) 또는 카페(CE7).
 * 순서: 세부 낱말 먼저(국밥·면·고기·해물·베이커리) → 큰 묶음(분식·양식·중식·일식·뷔페·카페) → 한식.
 */
export function cuisineFromKakao(category: string, group = ""): string[] {
  const c = category.replace(/\s+/g, "");
  const rules: [RegExp, Cuisine][] = [
    [/국밥|해장국|설렁탕|곰탕|순대|감자탕|추어탕|국수전골/, "국밥"],
    [/칼국수|국수|냉면|우동|라면|소바|막국수|쌀국수|면요리/, "면"],
    [/육류|고기|갈비|삼겹살|곱창|막창|닭갈비|족발|보쌈|소고기|돼지고기|오리/, "고기"],
    [/해물|생선|회|초밥|조개|게|대게|장어|아구|해산물/, "해물"],
    [/제과|베이커리|빵|도넛/, "베이커리"],
    [/분식|떡볶이|김밥/, "분식"],
    [/양식|이탈리안|피자|파스타|햄버거|스테이크|패밀리레스토랑|브런치/, "양식"],
    [/중식|중국요리|중화요리|짬뽕|짜장/, "중식"],
    [/일식|돈까스|돈가스|라멘|일본식/, "일식"],
    [/뷔페/, "뷔페"],
    [/카페|커피|디저트|차,|전통찻집/, "카페"],
  ];
  const out: string[] = [];
  for (const [re, k] of rules) if (re.test(c) && !out.includes(k)) out.push(k);
  // 일식 + 해물(초밥)은 해물보다 일식이 먼저 보이게
  if (out.includes("일식") && out.includes("해물") && /초밥|일식/.test(c)) out.splice(out.indexOf("일식"), 1), out.unshift("일식");
  if (!out.length) out.push(group === "CE7" ? "카페" : "한식");
  return out.slice(0, 2);
}

/**
 * 근처 식당 후보 고르기: 우리 장소에서 [radiusM] 안, 이미 있는 카카오 번호는 빼고, 거리순으로 [take]곳.
 * 같은 이름·50m 안 중복(체인 지점이 한 건물에 둘)도 뺀다.
 */
export function pickKakaoFoods(items: KakaoFood[], have: ReadonlySet<string>, take: number, radiusM = 1500): KakaoFood[] {
  const out: KakaoFood[] = [];
  const sorted = [...items].sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9) || (a.kakaoId < b.kakaoId ? -1 : 1));
  for (const x of sorted) {
    if (out.length >= take) break;
    if (have.has(x.kakaoId) || (x.distanceM != null && x.distanceM > radiusM)) continue;
    if (out.some((y) => y.kakaoId === x.kakaoId || (y.name === x.name && Math.abs(y.lat - x.lat) < 0.0005 && Math.abs(y.lng - x.lng) < 0.0005))) continue;
    out.push(x);
  }
  return out;
}

/** 카카오 한 줄 → 초안 식당 (꺼짐 · 출처 kakao · 확인 필요). [placeId] = 근처 우리 장소. */
export function kakaoDraft(x: KakaoFood, placeId: string | null, today: string): FoodInput {
  const m: FieldMeta = { src: "kakao", conf: 0.6, at: today, check: true };
  return {
    name: x.name, placeId, lat: x.lat, lng: x.lng, facilities: [], hours: null, closed: null, note: x.category || null, active: false,
    cuisine: cuisineFromKakao(x.category, x.group), price: null, kid: null, parking: null, wait: null, reserve: null,
    meal: x.group === "CE7" ? ["snack"] : [], dwellMin: null, fit: null, tags: [],
    meta: { location: { ...m, conf: 0.9 }, cuisine: m },
    kakaoId: x.kakaoId, phone: x.phone, address: x.address, url: x.url, openHours: [],
  };
}
