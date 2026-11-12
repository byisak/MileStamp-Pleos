/*
 * 장소 구조 칸 (docs/장소-데이터-구조-계획.md §2 · 1단계) — DB·네트워크 없이 (시험 place-attrs.test.ts).
 *  ① 운영 시간 줄(entity_hours) · ② 쉬는 날 규칙(closed_rules) · ③ 주차 · ⑤ 가격 · ⑥ 어울림 확장(kid_age·evening)
 *  ⑦ 단어장 태그(tag_vocab) · ⑧ 시간 특성(moments) · ⑩ 지역 코드 · ⑪ 출처(meta) · 종류(kind)·드라이브 길(route)
 * 엔진이 쓰는 것은 운영 시간 줄 고르기(hoursFor·pickHoursRow)뿐이고 같은 규칙이 Kotlin 엔진 Model.kt(OpenHours·Holidays)에도 있다.
 * 나머지는 관리자 입력·검사·API 모양 (엔진 규칙은 2단계 저녁 나들이부터).
 * 시각은 0시부터 분. 자정을 넘기면 1440 이상(최대 2160 = 다음 날 12:00). 요일은 0=일 … 6=토.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MD_RE = /^(\d{2})-(\d{2})$/;
const HM_RE = /^(\d{1,2}):(\d{2})$/;

export const DAY_MIN = 1440;
/** 닫는 시각 한도 — 다음 날 12:00 (야시장·야간 개장). */
export const MAX_CLOSE_MIN = 2160;
export const WEEKDAY_TEXT = ["일", "월", "화", "수", "목", "금", "토"];

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const str = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
};

/** 'YYYY-MM-DD' → 요일 (0=일). */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 'YYYY-MM-DD' + n일. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 분 → '9:30' (1440 넘으면 '다음 날 1:00'). */
export function hm(min: number): string {
  const next = min >= DAY_MIN && min !== DAY_MIN;
  const m = next ? min - DAY_MIN : min;
  const t = m === DAY_MIN ? "24:00" : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return next ? `다음 날 ${t}` : t;
}

/** 'HH:MM' → 분 (24:00 허용). 아니면 NaN. */
export function minOfHm(t: string): number {
  const m = HM_RE.exec(t.trim());
  if (!m) return NaN;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return NaN;
  return h * 60 + mi;
}

// ------------------------------------------------------------------ ① 운영 시간 줄

export type BreakRange = { fromMin: number; toMin: number };

/**
 * 운영 시간 한 줄 (DB entity_hours 한 행, API 모양 그대로).
 * days = 그 줄이 쓰이는 요일, holiday = 공휴일에 쓰는 줄 (공휴일엔 holiday 줄이 요일 줄보다 먼저),
 * validFrom·validTo = 'MM-DD' 해마다 되풀이되는 기간(계절 운영, 11-01~02-28처럼 해를 넘겨도 됨, 둘 다 없으면 늘).
 * 기간이 있는 줄은 그 기간엔 기간 없는 줄보다 먼저 — 여름 야간 개장 줄은 그날 하루 전체 시각을 적는다.
 */
export type HoursRow = {
  days: number[];
  holiday: boolean;
  openMin: number;
  closeMin: number;
  lastEntryMin: number | null;
  breaks: BreakRange[];
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  /** 마지막 주문(분, 식당만 — 엔진 OpenHours.lastOrderMin). 없으면 칸도 없음. */
  lastOrderMin?: number | null;
};

export const MAX_HOURS_ROWS = 12;

function validMd(md: string): boolean {
  const m = MD_RE.exec(md);
  if (!m) return false;
  const mo = Number(m[1]), d = Number(m[2]);
  const last = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= (last ?? 0);
}

/** 자정 넘김: 닫는 시각이 여는 시각보다 앞(같음 포함)이면 +1440. */
const pastMidnight = (open: number, t: number) => (t <= open ? t + DAY_MIN : t);

/** 관리자 입력 한 줄 검사. 틀리면 이유. */
function parseHoursRow(v: unknown, i: number): HoursRow | string {
  const at = `운영 시간 ${i + 1}번 줄`;
  if (!v || typeof v !== "object" || Array.isArray(v)) return `${at} 모양이 이상해요`;
  const o = v as Record<string, unknown>;
  const days = [...new Set((Array.isArray(o.days) ? o.days : []).map(num))].sort((a, b) => a - b);
  if (!days.every((d) => isInt(d, 0, 6))) return `${at}: 요일은 0(일)~6(토)이에요`;
  const holiday = o.holiday === true;
  if (!days.length && !holiday) return `${at}: 요일이나 공휴일을 하나 이상 골라 주세요`;
  const open = num(o.openMin);
  let close = num(o.closeMin);
  if (!isInt(open, 0, DAY_MIN - 1)) return `${at}: 여는 시각이 이상해요`;
  if (!Number.isInteger(close) || close < 0) return `${at}: 닫는 시각이 이상해요`;
  if (close <= DAY_MIN) close = pastMidnight(open, close);
  if (close <= open || close > MAX_CLOSE_MIN) return `${at}: 닫는 시각은 여는 시각 뒤, 다음 날 12:00까지예요`;
  let last: number | null = null;
  if (o.lastEntryMin != null && o.lastEntryMin !== "") {
    last = num(o.lastEntryMin);
    if (!Number.isInteger(last) || last < 0) return `${at}: 마지막 입장 시각이 이상해요`;
    if (last < open && close > DAY_MIN) last += DAY_MIN;
    if (last <= open || last > close) return `${at}: 마지막 입장은 여는 시각 뒤, 닫는 시각까지예요`;
  }
  const breaks: BreakRange[] = [];
  for (const b of Array.isArray(o.breaks) ? o.breaks.slice(0, 4) : []) {
    const bo = (b ?? {}) as Record<string, unknown>;
    let from = num(bo.fromMin), to = num(bo.toMin);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return `${at}: 쉬는 시간이 이상해요`;
    if (from < open && close > DAY_MIN) from += DAY_MIN;
    if (to <= from) to += DAY_MIN;
    if (from < open || to > close || to <= from) return `${at}: 쉬는 시간(브레이크)은 영업 시간 안이어야 해요`;
    breaks.push({ fromMin: from, toMin: to });
  }
  breaks.sort((a, b) => a.fromMin - b.fromMin);
  for (let k = 1; k < breaks.length; k++) if (breaks[k].fromMin < breaks[k - 1].toMin) return `${at}: 쉬는 시간이 서로 겹쳐요`;
  let lastOrder: number | null = null;
  if (o.lastOrderMin != null && o.lastOrderMin !== "") {
    lastOrder = num(o.lastOrderMin);
    if (!Number.isInteger(lastOrder) || lastOrder < 0) return `${at}: 마지막 주문 시각이 이상해요`;
    if (lastOrder < open && close > DAY_MIN) lastOrder += DAY_MIN;
    if (lastOrder <= open || lastOrder > close) return `${at}: 마지막 주문은 여는 시각 뒤, 닫는 시각까지예요`;
    if (breaks.some((b) => lastOrder! > b.fromMin && lastOrder! < b.toMin)) return `${at}: 마지막 주문이 쉬는 시간 안이에요`;
  }
  const vf = str(o.validFrom, 5), vt = str(o.validTo, 5);
  if ((vf == null) !== (vt == null)) return `${at}: 기간은 시작·끝을 같이 넣어 주세요`;
  if (vf != null && (!validMd(vf) || !validMd(vt!))) return `${at}: 기간은 MM-DD 모양이에요`;
  return {
    days, holiday, openMin: open, closeMin: close, lastEntryMin: last, breaks, validFrom: vf, validTo: vt, note: str(o.note, 40),
    ...(lastOrder != null ? { lastOrderMin: lastOrder } : {}),
  };
}

/** 관리자 입력 검사. 빈 목록도 됨(= 예전 하루 시각만). */
export function parseHoursRows(v: unknown): { ok: HoursRow[] } | { error: string } {
  if (v == null) return { ok: [] };
  if (!Array.isArray(v)) return { error: "운영 시간 모양이 이상해요" };
  if (v.length > MAX_HOURS_ROWS) return { error: `운영 시간은 ${MAX_HOURS_ROWS}줄까지예요` };
  const out: HoursRow[] = [];
  for (let i = 0; i < v.length; i++) {
    const r = parseHoursRow(v[i], i);
    if (typeof r === "string") return { error: r };
    out.push(r);
  }
  return { ok: out };
}

/** DB·서버 답에서 읽기 — 이상한 줄은 조용히 버린다 (엔진 입력용). */
export function hoursRowsLoose(v: unknown): HoursRow[] {
  if (!Array.isArray(v)) return [];
  const out: HoursRow[] = [];
  v.slice(0, MAX_HOURS_ROWS).forEach((x, i) => {
    const r = parseHoursRow(x, i);
    if (typeof r !== "string") out.push(r);
  });
  return out;
}

/**
 * 공휴일 (한국 날짜, 대체공휴일 포함). 엔진 Model.kt Holidays.KR과 같은 목록 — 바꾸면 둘 다 (place-attrs.test.ts가 비교).
 * 해마다 정부 발표(인사혁신처 관공서 공휴일)로 확인해서 다음 해를 더한다.
 */
export const KR_HOLIDAYS: readonly string[] = [
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02", "2026-05-05", "2026-05-24", "2026-05-25",
  "2026-06-03", "2026-06-06", "2026-08-15", "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05",
  "2026-10-09", "2026-12-25",
  "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-05", "2027-05-13", "2027-06-06",
  "2027-08-15", "2027-08-16", "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-03", "2027-10-04", "2027-10-09", "2027-10-11",
  "2027-12-25", "2027-12-27",
];
const HOLIDAY_SET = new Set(KR_HOLIDAYS);
export const isHoliday = (day: string) => HOLIDAY_SET.has(day);

/** 그 줄의 기간 안인가 ('MM-DD', 해를 넘기는 기간 11-01~02-28도). 기간이 없으면 늘. */
export function inSeason(row: Pick<HoursRow, "validFrom" | "validTo">, day: string): boolean {
  if (row.validFrom == null || row.validTo == null) return true;
  const md = day.slice(5);
  return row.validFrom <= row.validTo ? md >= row.validFrom && md <= row.validTo : md >= row.validFrom || md <= row.validTo;
}

/**
 * 그날 쓰는 줄 하나 (엔진 Place.hoursOn과 같은 규칙):
 *  공휴일이면 그 기간의 holiday 줄 → 없으면 요일 줄. 같은 무리 안에서는 기간 있는 줄이 기간 없는 줄보다 먼저, 그다음 목록 순서.
 *  맞는 줄이 없으면 null (= 그날 쉼).
 */
export function pickHoursRow(rows: readonly HoursRow[], day: string): HoursRow | null {
  if (!DATE_RE.test(day)) return null;
  const firstOf = (xs: HoursRow[]) => xs.find((r) => r.validFrom != null) ?? xs[0] ?? null;
  if (isHoliday(day)) {
    const h = rows.filter((r) => r.holiday && inSeason(r, day));
    if (h.length) return firstOf(h);
  }
  const wd = weekday(day);
  return firstOf(rows.filter((r) => r.days.includes(wd) && inSeason(r, day)));
}

export type DayHours = {
  openMin: number;
  closeMin: number;
  lastEntryMin: number | null;
  breaks: BreakRange[];
  note: string | null;
  /** rows = 운영 시간 줄에서 · columns = 줄이 없어 예전 하루 시각(open_min·close_min) */
  source: "rows" | "columns";
};

/**
 * [day]의 운영 시각. 줄이 없으면 예전 하루 시각(source columns), 줄은 있는데 맞는 게 없으면 null(그날 쉼).
 * 쉬는 요일·임시 휴무·쉬는 날 규칙은 따로 (closedDays·closedDates·closedDatesFromRules).
 */
export function hoursFor(
  place: { hours?: readonly HoursRow[] | null; openMin: number; closeMin: number; lastEntryMin?: number | null },
  day: string,
): DayHours | null {
  const rows = place.hours ?? [];
  if (!rows.length) return { openMin: place.openMin, closeMin: place.closeMin, lastEntryMin: place.lastEntryMin ?? null, breaks: [], note: null, source: "columns" };
  const r = pickHoursRow(rows, day);
  if (!r) return null;
  return { openMin: r.openMin, closeMin: r.closeMin, lastEntryMin: r.lastEntryMin, breaks: r.breaks, note: r.note, source: "rows" };
}

/**
 * 예전 칸 open_min·close_min에 넣을 평일 대표값 (옛 앱용): 기간 없는 줄 중 수요일 → 다른 평일 → 아무 요일 → 첫 줄.
 * 닫는 시각은 1440까지로 자른다 (옛 앱은 하루 안만 앎). 줄이 없으면 null.
 */
export function representativeHours(rows: readonly HoursRow[]): { open: number; close: number } | null {
  if (!rows.length) return null;
  const plain = rows.filter((r) => r.validFrom == null);
  const r = plain.find((x) => x.days.includes(3)) ?? plain.find((x) => x.days.some((d) => d >= 1 && d <= 5)) ?? plain.find((x) => x.days.length) ?? plain[0] ?? rows[0];
  return { open: r.openMin, close: Math.min(DAY_MIN, r.closeMin) };
}

/** 예전 하루 시각 → 줄 하나 (매일). backfill과 같은 모양. */
export function rowsFromColumns(open: number, close: number): HoursRow[] {
  return [{ days: [0, 1, 2, 3, 4, 5, 6], holiday: false, openMin: open, closeMin: close, lastEntryMin: null, breaks: [], validFrom: null, validTo: null, note: null }];
}

// ------------------------------------------------------------------ ② 쉬는 날 규칙

/** 정해진 말만. 날짜로 펴는 건 서버(closedDatesFromRules) — 차는 펴진 closedDates를 받는다. */
export const CLOSED_RULES: Record<string, string> = {
  newyear: "1월 1일",
  seollal: "설 당일",
  seollal_all: "설 연휴",
  chuseok: "추석 당일",
  chuseok_all: "추석 연휴",
  holiday: "공휴일",
  holiday_next: "공휴일 다음 날",
  holiday_shift: "쉬는 요일이 공휴일이면 다음 평일",
};
export const CLOSED_RULE_KEYS = Object.keys(CLOSED_RULES);

/** 설·추석 (음력 날짜를 양력으로, 연휴 3일 — 가운데가 당일). */
const LUNAR: Record<string, { seollal: string[]; chuseok: string[] }> = {
  "2026": { seollal: ["2026-02-16", "2026-02-17", "2026-02-18"], chuseok: ["2026-09-24", "2026-09-25", "2026-09-26"] },
  "2027": { seollal: ["2027-02-06", "2027-02-07", "2027-02-08"], chuseok: ["2027-09-14", "2027-09-15", "2027-09-16"] },
  "2028": { seollal: ["2028-01-25", "2028-01-26", "2028-01-27"], chuseok: ["2028-10-02", "2028-10-03", "2028-10-04"] },
};

export function parseClosedRules(v: unknown): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.map(String))];
  return out.every((r) => CLOSED_RULE_KEYS.includes(r)) ? out.sort() : null;
}

/**
 * 규칙 → 쉬는 날짜 [from, from+n) (한국 날짜). closedDays는 holiday_shift(쉬는 요일이 공휴일이면 다음 평일도 쉼)에만 쓴다.
 * 조심하는 쪽: 공휴일인 쉬는 요일을 '연다'고 하지는 않는다 (그날은 그대로 쉬는 것으로 — 문 닫은 곳 추천보다 낫다).
 */
export function closedDatesFromRules(rules: readonly string[], from: string, n: number, closedDays: readonly number[] = []): string[] {
  if (!rules.length || !DATE_RE.test(from)) return [];
  const out = new Set<string>();
  for (let i = 0; i < n; i++) {
    const d = addDays(from, i);
    const lunar = LUNAR[d.slice(0, 4)];
    if (rules.includes("newyear") && d.slice(5) === "01-01") out.add(d);
    if (lunar) {
      if (rules.includes("seollal") && d === lunar.seollal[1]) out.add(d);
      if (rules.includes("seollal_all") && lunar.seollal.includes(d)) out.add(d);
      if (rules.includes("chuseok") && d === lunar.chuseok[1]) out.add(d);
      if (rules.includes("chuseok_all") && lunar.chuseok.includes(d)) out.add(d);
    }
    if (rules.includes("holiday") && isHoliday(d)) out.add(d);
    if (rules.includes("holiday_next") && isHoliday(addDays(d, -1)) && !isHoliday(d)) out.add(d);
    if (rules.includes("holiday_shift") && !isHoliday(d) && !closedDays.includes(weekday(d)) && weekday(d) >= 1 && weekday(d) <= 5) {
      // 바로 앞 평일들 중 쉬는 요일이면서 공휴일인 날이 있으면 (그 사이가 모두 공휴일·주말) 오늘 쉰다
      for (let k = 1; k <= 4; k++) {
        const p = addDays(d, -k);
        const pw = weekday(p);
        if (closedDays.includes(pw) && isHoliday(p)) { out.add(d); break; }
        if (!isHoliday(p) && pw >= 1 && pw <= 5) break;
      }
    }
  }
  return [...out].sort();
}

// ------------------------------------------------------------------ ③ 주차 · ⑤ 가격

export type Parking = {
  has: "yes" | "no" | "limited";
  kind?: "own" | "public" | "street" | null;
  fee?: "free" | "paid" | "partial" | null;
  fee_note?: string | null;
  size?: "S" | "M" | "L" | null;
  weekend_full?: boolean;
  walk_min?: number | null;
  ev?: boolean;
};

const oneOf = <T extends string>(v: unknown, xs: readonly T[]): T | null => (typeof v === "string" && (xs as readonly string[]).includes(v) ? (v as T) : null);

export function parseParking(v: unknown): { ok: Parking | null } | { error: string } {
  if (v == null) return { ok: null };
  if (typeof v !== "object" || Array.isArray(v)) return { error: "주차 모양이 이상해요" };
  const o = v as Record<string, unknown>;
  const has = oneOf(o.has, ["yes", "no", "limited"] as const);
  if (!has) return { error: "주차: 있음·없음·좁음 중 하나를 골라 주세요" };
  const walk = o.walk_min == null || o.walk_min === "" ? null : num(o.walk_min);
  if (walk != null && !isInt(walk, 0, 60)) return { error: "주차장에서 걷는 시간은 0~60분이에요" };
  const out: Parking = { has };
  const kind = oneOf(o.kind, ["own", "public", "street"] as const);
  const fee = oneOf(o.fee, ["free", "paid", "partial"] as const);
  const size = oneOf(o.size, ["S", "M", "L"] as const);
  if (kind) out.kind = kind;
  if (fee) out.fee = fee;
  const note = str(o.fee_note, 40);
  if (note) out.fee_note = note;
  if (size) out.size = size;
  if (o.weekend_full === true) out.weekend_full = true;
  if (walk != null) out.walk_min = walk;
  if (o.ev === true) out.ev = true;
  return { ok: out };
}

export type Price = { free: boolean; adult?: number | null; child?: number | null; child_free_under?: number | null; level: 0 | 1 | 2 | 3 };

/** 가족(어른 2 + 아이 2) 기준 금액 → 단계: 0 무료 · 1 1만 원 안쪽 · 2 3만 원 안쪽 · 3 그 이상. */
export function priceLevel(p: { free: boolean; adult?: number | null; child?: number | null }): 0 | 1 | 2 | 3 {
  if (p.free) return 0;
  const fam = 2 * (p.adult ?? 0) + 2 * (p.child ?? p.adult ?? 0);
  if (fam <= 0) return 1;
  return fam <= 10000 ? 1 : fam <= 30000 ? 2 : 3;
}

export function parsePrice(v: unknown): { ok: Price | null } | { error: string } {
  if (v == null) return { ok: null };
  if (typeof v !== "object" || Array.isArray(v)) return { error: "가격 모양이 이상해요" };
  const o = v as Record<string, unknown>;
  const free = o.free === true;
  const amt = (x: unknown, label: string): number | null | string => {
    if (x == null || x === "") return null;
    const n = num(x);
    return isInt(n, 0, 500000) ? n : `${label}은 0~500,000원이에요`;
  };
  const adult = amt(o.adult, "어른 요금"), child = amt(o.child, "아이 요금");
  if (typeof adult === "string") return { error: adult };
  if (typeof child === "string") return { error: child };
  const under = o.child_free_under == null || o.child_free_under === "" ? null : num(o.child_free_under);
  if (under != null && !isInt(under, 1, 19)) return { error: "몇 살 아래 무료는 1~19살이에요" };
  const out: Price = { free, level: 0 };
  if (!free) {
    if (adult != null) out.adult = adult;
    if (child != null) out.child = child;
  }
  if (under != null) out.child_free_under = under;
  const lv = o.level == null || o.level === "" ? null : num(o.level);
  out.level = lv != null && isInt(lv, 0, 3) && !free ? (lv as Price["level"]) : priceLevel(out);
  return { ok: out };
}

// ------------------------------------------------------------------ ⑥ 어울림 확장 (kid_age · evening)

export const KID_AGE_BANDS = ["0-3", "4-6", "7-9", "10+"] as const;
export type KidAgeBand = (typeof KID_AGE_BANDS)[number];
export const KID_AGE_TEXT: Record<KidAgeBand, string> = { "0-3": "0~3살", "4-6": "4~6살", "7-9": "7~9살", "10+": "10살 이상" };
export const EVENING_KEYS = ["kids", "couple", "friends", "solo"] as const;
export type FitExtra = { kid_age?: Partial<Record<KidAgeBand, number>>; evening?: Partial<Record<(typeof EVENING_KEYS)[number], number>> };

const n01 = (v: unknown): number | null => {
  const x = num(v);
  return Number.isFinite(x) && x >= 0 && x <= 1 ? Math.round(x * 100) / 100 : null;
};

/** fit jsonb의 kid_age·evening 검사. 없으면 빈 칸, 틀리면 error. */
export function parseFitExtra(v: unknown): { ok: FitExtra } | { error: string } {
  if (v == null) return { ok: {} };
  if (typeof v !== "object" || Array.isArray(v)) return { error: "어울림 모양이 이상해요" };
  const o = v as Record<string, unknown>;
  const out: FitExtra = {};
  for (const [key, keys, label] of [["kid_age", KID_AGE_BANDS, "아이 나이대"], ["evening", EVENING_KEYS, "저녁 어울림"]] as const) {
    const x = o[key];
    if (x == null) continue;
    if (typeof x !== "object" || Array.isArray(x)) return { error: `${label} 모양이 이상해요` };
    const m: Record<string, number> = {};
    for (const k of Object.keys(x)) {
      if (!(keys as readonly string[]).includes(k)) return { error: `${label}: 모르는 칸 ${k}` };
      const val = n01((x as Record<string, unknown>)[k]);
      if (val == null) return { error: `${label}은 0~1이에요` };
      m[k] = val;
    }
    if (Object.keys(m).length) (out as Record<string, unknown>)[key] = m;
  }
  return { ok: out };
}

/** DB fit jsonb에서 kid_age·evening만 (이상하면 빈 칸). */
export function fitExtraOf(v: unknown): FitExtra {
  const r = parseFitExtra(v);
  return "ok" in r ? r.ok : {};
}

// ------------------------------------------------------------------ ⑦ 단어장 태그

export type VocabWord = { tag: string; category: string; sort: number };

/** 처음 단어장 (schema.sql tag_vocab 씨앗과 같게). '엔진' 묶음은 지금 추천 가점에 쓰는 말이라 단어장에 둔다. */
export const DEFAULT_TAG_VOCAB: VocabWord[] = [
  ...["야경", "노을", "호수", "강", "숲", "산", "전망", "꽃", "단풍"].map((t, i) => ({ tag: t, category: "경치", sort: 10 + i })),
  ...["체험", "놀이", "산책", "자전거", "물놀이", "만들기", "동물"].map((t, i) => ({ tag: t, category: "할 것", sort: 30 + i })),
  ...["박물관", "과학", "역사", "전시", "공연"].map((t, i) => ({ tag: t, category: "배움", sort: 50 + i })),
  ...["조용함", "데이트", "사진 명소", "활동적", "카페"].map((t, i) => ({ tag: t, category: "분위기", sort: 70 + i })),
  ...["야경", "야시장", "분수쇼", "조명"].map((t, i) => ({ tag: t, category: "저녁", sort: 90 + i })),
  ...["드라이브", "액티비티"].map((t, i) => ({ tag: t, category: "엔진", sort: 110 + i })),
];

/** 추천에 쓰는 태그 = 단어장에 있는 것만 (예전 자유 태그는 표시용으로 남김). */
export function vocabTags(tags: readonly string[], vocab: readonly VocabWord[]): string[] {
  const words = new Set(vocab.map((v) => v.tag));
  return tags.filter((t) => words.has(t));
}

/** 속성으로 옮긴 예전 태그 (태그가 아니라 칸): 실내 → indoor, 무료 → price.free, 지역 이름 → region_code. */
export const ATTRIBUTE_TAGS = ["실내", "야외", "무료", "북구", "동구", "서구", "남구", "중구", "수성구", "달서구", "달성군", "군위군"];

// ------------------------------------------------------------------ ⑧ 시간 특성

export const BEST_TIMES = ["day", "sunset", "night"] as const;
export type BestTime = (typeof BEST_TIMES)[number];
export const BEST_TEXT: Record<BestTime, string> = { day: "낮", sunset: "노을", night: "밤" };

export type Show = { name: string; times: string[]; days?: number[]; months?: number[] };
export type Moments = {
  best: BestTime[];
  light?: { on: string; off?: string | null } | null;
  shows?: Show[];
  season?: { what: string; months: number[] }[];
};

/** 조명 켜지는 시각: 'sunset' · 'sunset+15' · 'sunset-10' · 'HH:MM'. */
export const LIGHT_ON_RE = /^(sunset([+-]\d{1,3})?|\d{1,2}:\d{2})$/;

function months(v: unknown, label: string): number[] | string {
  if (v == null) return [];
  if (!Array.isArray(v)) return `${label}: 달 모양이 이상해요`;
  const ms = [...new Set(v.map(num))].sort((a, b) => a - b);
  return ms.every((m) => isInt(m, 1, 12)) ? ms : `${label}: 달은 1~12예요`;
}

/** 쇼 시각이 운영 시간 안인가: 그 쇼 요일과 겹치는 줄(요일이 없으면 아무 줄) 중 하나 안이면 됨. 줄이 없으면 예전 하루 시각. */
function showInHours(t: number, days: number[], hours: readonly HoursRow[], open: number, close: number): boolean {
  const inside = (o: number, c: number) => (t >= o && t <= c) || (t + DAY_MIN >= o && t + DAY_MIN <= c);
  if (!hours.length) return inside(open, close);
  return hours.some((r) => (!days.length || r.days.some((d) => days.includes(d)) || r.holiday) && inside(r.openMin, r.closeMin));
}

/** 시간 특성 검사. hours·open·close = 쇼 시각 확인용. */
export function parseMoments(v: unknown, ctx: { hours: readonly HoursRow[]; open: number; close: number }): { ok: Moments | null } | { error: string } {
  if (v == null) return { ok: null };
  if (typeof v !== "object" || Array.isArray(v)) return { error: "시간 특성 모양이 이상해요" };
  const o = v as Record<string, unknown>;
  const best = [...new Set(Array.isArray(o.best) ? o.best.map(String) : [])];
  if (!best.every((b) => (BEST_TIMES as readonly string[]).includes(b))) return { error: "언제 좋은지는 낮·노을·밤 중에서 골라요" };
  const out: Moments = { best: BEST_TIMES.filter((b) => best.includes(b)) };
  if (o.light != null) {
    const l = o.light as Record<string, unknown>;
    const on = String(l.on ?? "").replace(/\s+/g, "");
    const off = l.off == null || l.off === "" ? null : String(l.off).trim();
    if (!LIGHT_ON_RE.test(on) || (/^\d/.test(on) && !Number.isFinite(minOfHm(on)))) return { error: "조명 켜지는 시각은 'sunset+15' 또는 HH:MM이에요" };
    if (off != null && !Number.isFinite(minOfHm(off))) return { error: "조명 꺼지는 시각은 HH:MM이에요" };
    out.light = { on, off };
  }
  const shows: Show[] = [];
  for (const [i, s] of (Array.isArray(o.shows) ? o.shows.slice(0, 8) : []).entries()) {
    const so = (s ?? {}) as Record<string, unknown>;
    const at = `쇼 ${i + 1}번`;
    const name = str(so.name, 30);
    if (!name) return { error: `${at}: 이름을 적어 주세요` };
    const times = [...new Set((Array.isArray(so.times) ? so.times : []).map((x) => String(x).trim()))].sort();
    if (!times.length || times.length > 24) return { error: `${at}: 시각을 1~24개 넣어 주세요` };
    const days = [...new Set((Array.isArray(so.days) ? so.days : []).map(num))].sort((a, b) => a - b);
    if (!days.every((d) => isInt(d, 0, 6))) return { error: `${at}: 요일은 0(일)~6(토)이에요` };
    const ms = months(so.months, at);
    if (typeof ms === "string") return { error: ms };
    for (const t of times) {
      const m = minOfHm(t);
      if (!Number.isFinite(m)) return { error: `${at}: 시각 ${t}이(가) HH:MM이 아니에요` };
      if (!showInHours(m, days, ctx.hours, ctx.open, ctx.close)) return { error: `${at}: ${t}은(는) 운영 시간 밖이에요` };
    }
    shows.push({ name, times, ...(days.length ? { days } : {}), ...(ms.length ? { months: ms } : {}) });
  }
  if (shows.length) out.shows = shows;
  const season: { what: string; months: number[] }[] = [];
  for (const [i, s] of (Array.isArray(o.season) ? o.season.slice(0, 8) : []).entries()) {
    const so = (s ?? {}) as Record<string, unknown>;
    const what = str(so.what, 20);
    const ms = months(so.months, `계절 볼거리 ${i + 1}번`);
    if (typeof ms === "string") return { error: ms };
    if (!what || !ms.length) return { error: `계절 볼거리 ${i + 1}번: 이름과 달을 넣어 주세요` };
    season.push({ what, months: ms });
  }
  if (season.length) out.season = season;
  return { ok: out };
}

// ------------------------------------------------------------------ 종류 · 드라이브 길 · 지역

export const PLACE_KINDS = ["spot", "view", "market", "drive"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const KIND_TEXT: Record<PlaceKind, string> = { spot: "일반", view: "전망대", market: "시장·야시장", drive: "드라이브 길" };

/** 야경 드라이브 길 — 지나갈 점들 + 지나가는 데 걸리는 분 + 쉬어 갈 곳(명소 id). */
export type DriveRoute = { points: { lat: number; lng: number; name?: string }[]; pass_min: number; rest_place_id?: string | null };

export function parseRoute(v: unknown, kind: PlaceKind): { ok: DriveRoute | null } | { error: string } {
  if (kind !== "drive") return { ok: null };
  if (v == null) return { error: "드라이브 길은 지나갈 점을 2개 이상 넣어 주세요" };
  const o = v as Record<string, unknown>;
  const pts: DriveRoute["points"] = [];
  for (const p of Array.isArray(o.points) ? o.points.slice(0, 20) : []) {
    const po = (p ?? {}) as Record<string, unknown>;
    const lat = num(po.lat), lng = num(po.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "드라이브 길 점 좌표가 이상해요" };
    const name = str(po.name, 30);
    pts.push({ lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, ...(name ? { name } : {}) });
  }
  if (pts.length < 2) return { error: "드라이브 길은 지나갈 점을 2개 이상 넣어 주세요" };
  const pass = num(o.pass_min);
  if (!isInt(pass, 5, 240)) return { error: "드라이브 지나가는 시간은 5~240분이에요" };
  const rest = str(o.rest_place_id, 24);
  return { ok: { points: pts, pass_min: pass, ...(rest ? { rest_place_id: rest } : {}) } };
}

/** 지역 코드 = 법정동 시군구 5자리 (관광공사 lDongRegnCd 2자리 + lDongSignguCd 3자리). */
export const REGION_CODE_RE = /^\d{5}$/;

/** 대구·경북 시군구 (지역 글 '대구 북구 …' → 코드). 다른 곳은 관리자가 직접 넣는다. */
export const REGION_CODES: Record<string, string> = {
  "대구 중구": "27110", "대구 동구": "27140", "대구 서구": "27170", "대구 남구": "27200", "대구 북구": "27230",
  "대구 수성구": "27260", "대구 달서구": "27290", "대구 달성군": "27710", "대구 군위군": "27720",
  "경북 포항시": "47110", "경북 경주시": "47130", "경북 김천시": "47150", "경북 안동시": "47170", "경북 구미시": "47190",
  "경북 영주시": "47210", "경북 영천시": "47230", "경북 상주시": "47250", "경북 문경시": "47280", "경북 경산시": "47290",
  "경북 의성군": "47730", "경북 청송군": "47750", "경북 영양군": "47760", "경북 영덕군": "47770", "경북 청도군": "47820",
  "경북 고령군": "47830", "경북 성주군": "47840", "경북 칠곡군": "47850", "경북 예천군": "47900", "경북 봉화군": "47920",
  "경북 울진군": "47930", "경북 울릉군": "47940",
};

/** '대구 북구 침산동' → '27230'. 모르면 null. */
export function regionCodeOf(region: string | null | undefined): string | null {
  if (!region) return null;
  const parts = region.trim().split(/\s+/);
  return REGION_CODES[`${parts[0]} ${parts[1] ?? ""}`] ?? null;
}

export function regionNameOf(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.entries(REGION_CODES).find(([, c]) => c === code)?.[0] ?? null;
}

// ------------------------------------------------------------------ ⑪ 출처 · 확인

export const META_SOURCES = ["admin", "tourapi", "ai", "tip", "seed", "kakao"] as const;
export type MetaSource = (typeof META_SOURCES)[number];
export const SOURCE_TEXT: Record<MetaSource, string> = { admin: "관리자", tourapi: "관광공사", ai: "AI", tip: "팁", seed: "조사", kakao: "카카오" };
/** 출처를 다는 칸 (관리자 화면 배지와 같은 이름). */
export const META_FIELDS = ["hours", "closed", "parking", "price", "facilities", "moments", "fit", "tags", "kind", "region"] as const;
export type MetaField = (typeof META_FIELDS)[number];
/** quote = 그 값을 읽어 낸 원문 한 조각 (AI 초안을 받아들인 칸 — 배지에 보여 줌). */
export type FieldMeta = { src: MetaSource; conf: number; at: string; check?: boolean; quote?: string };
export type PlaceMeta = Partial<Record<MetaField, FieldMeta>>;

/**
 * AI 초안 한 칸 (docs/장소-데이터-구조-계획.md §6.1) — DB meta jsonb의 'drafts' 안에 칸 이름별로 둔다.
 * 진짜 칸(운영 시간·주차 …)은 건드리지 않으므로 앱·엔진은 초안을 모른다. 관리자가 '맞아요'를 눌러야 칸으로 옮긴다.
 * value 모양은 칸마다 (lib/ai-fill-shape.ts 검사를 통과한 것만 들어온다).
 */
export type AiDraft = { src: "ai"; conf: number; at: string; check: true; quote: string; value: unknown };
export type AiDrafts = Partial<Record<string, AiDraft>>;
const DRAFT_KEY_RE = /^[a-z_]{2,20}$/;

/** 관리자 저장·DB 읽기 공용: 이상한 초안은 조용히 버린다 (칸 12개까지, 값 6천 자까지). */
export function parseAiDrafts(v: unknown): AiDrafts {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: AiDrafts = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 12)) {
    if (!DRAFT_KEY_RE.test(k) || !x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const quote = typeof o.quote === "string" ? o.quote.trim().slice(0, 300) : "";
    const at = String(o.at ?? "");
    const conf = n01(o.conf);
    if (!quote || !DATE_RE.test(at) || conf == null || o.value === undefined) continue;
    let size = 0;
    try { size = JSON.stringify(o.value).length; } catch { continue; }
    if (size > 6000) continue;
    out[k] = { src: "ai", conf, at, check: true, quote, value: o.value };
  }
  return out;
}

/** DB meta jsonb → 초안 (meta.drafts). */
export const draftsOf = (meta: unknown): AiDrafts =>
  meta && typeof meta === "object" && !Array.isArray(meta) ? parseAiDrafts((meta as Record<string, unknown>).drafts) : {};
/** 이 날수보다 오래된 값은 '다시 확인'. */
export const STALE_DAYS = 90;

export function parseMeta(v: unknown): { ok: PlaceMeta } | { error: string } {
  if (v == null) return { ok: {} };
  if (typeof v !== "object" || Array.isArray(v)) return { error: "출처 모양이 이상해요" };
  const out: PlaceMeta = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!(META_FIELDS as readonly string[]).includes(k)) continue;
    const o = (x ?? {}) as Record<string, unknown>;
    const src = oneOf(o.src, META_SOURCES);
    const conf = n01(o.conf);
    const at = String(o.at ?? "");
    if (!src || conf == null || !DATE_RE.test(at)) return { error: `출처(${k}) 모양이 이상해요` };
    const quote = typeof o.quote === "string" && o.quote.trim() ? o.quote.trim().slice(0, 300) : null;
    out[k as MetaField] = { src, conf, at, ...(o.check === true ? { check: true } : {}), ...(quote ? { quote } : {}) };
  }
  return { ok: out };
}

export function metaOf(v: unknown): PlaceMeta {
  const r = parseMeta(v);
  return "ok" in r ? r.ok : {};
}

/** 오래됨: at이 [today]보다 STALE_DAYS일 넘게 앞. */
export function isStale(m: FieldMeta | undefined, today: string): boolean {
  if (!m) return false;
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${m.at}T00:00:00Z`) > STALE_DAYS * 86400000;
}

// ------------------------------------------------------------------ 완성도 · 미리 보기

/** 완성도에 세는 칸 (관리자 화면 오른쪽). */
export type CompletenessInput = {
  hours: readonly HoursRow[];
  closedDays: readonly number[];
  closedRules: readonly string[];
  parking: Parking | null;
  price: Price | null;
  facilities: readonly string[];
  moments: Moments | null;
  vocabTagCount: number;
  regionCode: string | null;
  intro: string;
  meta: PlaceMeta;
};

export function completeness(p: CompletenessInput): { done: number; total: number; missing: string[] } {
  const items: [string, boolean][] = [
    ["운영 시간", p.hours.length > 0],
    ["쉬는 날", p.closedDays.length > 0 || p.closedRules.length > 0 || !!p.meta.closed],
    ["주차", !!p.parking],
    ["가격", !!p.price],
    ["시설", p.facilities.length > 0],
    ["시간 특성", !!p.moments && p.moments.best.length > 0],
    ["단어장 태그", p.vocabTagCount > 0],
    ["지역 코드", !!p.regionCode],
    ["소개 글", p.intro.trim().length > 0],
  ];
  return { done: items.filter(([, ok]) => ok).length, total: items.length, missing: items.filter(([, ok]) => !ok).map(([n]) => n) };
}

/**
 * '이 장소가 추천될 수 있는 도착 시각' — 엔진 시간표 규칙(문 열기 [waitMax]분 전까지 기다림, 문 닫기 전 최소 [minVisit]분 또는 머무름 전체,
 * 마지막 입장)으로 요일마다 계산해 같은 것끼리 묶는다. [weekStart] = 기준 주의 월요일('YYYY-MM-DD'), 그 주의 줄·공휴일을 쓴다.
 * 쉬는 요일·그 주 쉬는 날짜(closedDates)는 '쉼'.
 */
export function arrivalWindows(
  p: { hours: readonly HoursRow[]; openMin: number; closeMin: number; closedDays: readonly number[]; closedDates?: readonly string[]; dwell: number },
  weekStart: string,
  opt: { waitMax: number; minVisit: number },
): { label: string; text: string }[] {
  const per: { wd: number; text: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const wd = weekday(day);
    let text: string;
    const h = p.closedDays.includes(wd) || (p.closedDates ?? []).includes(day) ? null : hoursFor({ hours: p.hours, openMin: p.openMin, closeMin: p.closeMin }, day);
    if (!h) text = "쉼";
    else if (h.openMin <= 0 && h.closeMin >= DAY_MIN && h.lastEntryMin == null) text = "언제든";
    else {
      const from = Math.max(0, h.openMin - opt.waitMax);
      let to = h.closeMin - Math.min(p.dwell, opt.minVisit);
      if (h.lastEntryMin != null) to = Math.min(to, h.lastEntryMin);
      text = to < from ? "안 됨" : `${hm(from)}~${hm(to)}`;
    }
    per.push({ wd, text });
  }
  // 월~일 순서로 같은 글끼리 묶기
  const groups: { days: number[]; text: string }[] = [];
  for (const x of per) {
    const g = groups.find((y) => y.text === x.text);
    if (g) g.days.push(x.wd);
    else groups.push({ days: [x.wd], text: x.text });
  }
  return groups.map((g) => ({ label: daysLabel(g.days), text: g.text }));
}

/** 요일 묶음 이름: 매일 · 평일 · 주말 · 월~목 · 화·목. */
export function daysLabel(days: readonly number[]): string {
  const s = new Set(days);
  if (s.size === 7) return "매일";
  const has = (xs: number[]) => xs.length === s.size && xs.every((d) => s.has(d));
  if (has([1, 2, 3, 4, 5])) return "평일";
  if (has([0, 6])) return "주말";
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => s.has(d));
  // 이어진 구간이면 '월~목'
  const idx = order.map((d) => [1, 2, 3, 4, 5, 6, 0].indexOf(d));
  if (order.length >= 3 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)) return `${WEEKDAY_TEXT[order[0]]}~${WEEKDAY_TEXT[order[order.length - 1]]}`;
  return order.map((d) => WEEKDAY_TEXT[d]).join("·");
}

/** 미리 보기 한 줄: '평일 9:30~17:00 · 주말 9:30~16:30 도착이면 추천돼요 · 월 쉼'. */
export function arrivalLine(groups: { label: string; text: string }[]): string {
  const ok = groups.filter((g) => g.text !== "쉼" && g.text !== "안 됨");
  const rest = groups.filter((g) => g.text === "쉼").map((g) => `${g.label} 쉼`);
  const never = groups.filter((g) => g.text === "안 됨").map((g) => `${g.label}엔 시간이 모자라 추천 안 돼요`);
  const head = ok.length ? `${ok.map((g) => `${g.label} ${g.text === "언제든" ? "언제든" : g.text}`).join(" · ")} 도착이면 추천돼요` : "추천될 수 있는 시간이 없어요";
  return [head, ...rest, ...never].join(" · ");
}
