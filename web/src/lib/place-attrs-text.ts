/*
 * 글 → 구조 칸 초안 (관리자 '관광공사에서 채우기'·'조사 원문에서 채우기'). DB·네트워크 없이 (시험 place-attrs.test.ts).
 * 입력은 TourAPI detailIntro2(이용 시간·쉬는 날·주차·요금·유모차·반려동물) 또는 조사 원문(places.hours·closed).
 * 원칙: 모르는 건 짐작하지 않는다 — 읽은 칸만 채우고, 모두 '확인 필요'(meta.check)로 관리자가 훑고 저장한다.
 */
import {
  rowsFromColumns, parsePrice, priceLevel,
  type HoursRow, type Parking, type Price,
} from "./place-attrs-shape";
import { restsOn, type TourIntro } from "./place-detail-shape";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DOW = "일월화수목금토";
const LAST_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n: number) => String(n).padStart(2, "0");

const normalize = (t: string) => t.replace(/[∼〜～]/g, "~").replace(/\s*[~\-–]\s*/g, "~");

/** 처음 나오는 시간 범위 '09:00~18:00'·'9시~18시' → [여는, 닫는, 범위가 끝난 위치]. */
function firstRange(t: string): { open: number; close: number; index: number; end: number } | null {
  const m = /(\d{1,2})\s*(?::|시)\s*(\d{2})?\s*분?\s*~\s*(\d{1,2})\s*(?::|시)\s*(\d{2})?/.exec(t);
  if (!m) return null;
  const a = Number(m[1]) * 60 + Number(m[2] ?? 0);
  let b = Number(m[3]) * 60 + Number(m[4] ?? 0);
  if (a >= 1440 || b > 1440 + 720) return null;
  if (b <= a) b += 1440; // 자정 넘김 (18:00~02:00)
  if (b > 2160) return null;
  return { open: a, close: b, index: m.index, end: m.index + m[0].length };
}

/** 마지막 입장: '입장 마감 17:30'·'17:00 입장 마감'·'매표 마감 17시'·'마감 30분 전 입장'·'마감 1시간 전까지 입장'. */
function lastEntryIn(t: string, close: number): number | null {
  let m = /(?:입장|매표|발권)\s*마감\s*:?\s*(\d{1,2})\s*(?::|시)\s*(\d{2})?/.exec(t) ?? /(\d{1,2})\s*:\s*(\d{2})\s*(?:까지\s*)?(?:입장|매표)\s*마감/.exec(t);
  if (m) {
    let v = Number(m[1]) * 60 + Number(m[2] ?? 0);
    if (close > 1440 && v < close - 1440 + 1) v += 1440;
    return v <= close ? v : null;
  }
  m = /(?:마감|폐장|종료|폐관)\s*(\d{1,2})\s*(분|시간)\s*전[^,\n]{0,6}입장/.exec(t);
  if (m) return close - Number(m[1]) * (m[2] === "시간" ? 60 : 1);
  return null;
}

/** 앞쪽 글의 달 기간: '3~10월' · '1~4월·9~12월' · '하절기(4~9월)' → [{from, to}] ('MM-DD'). 여러 개면 줄을 그만큼. */
function monthRanges(t: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const re = /(\d{1,2})\s*월?\s*~\s*(\d{1,2})\s*월/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 12) out.push({ from: `${pad(a)}-01`, to: `${pad(b)}-${LAST_DAY[b - 1] === 29 ? 28 : LAST_DAY[b - 1]}` });
  }
  if (!out.length) {
    const one = /(?<!\d)(\d{1,2})\s*월(?!\s*\d+\s*일)/.exec(t);
    if (one) {
      const a = Number(one[1]);
      if (a >= 1 && a <= 12) out.push({ from: `${pad(a)}-01`, to: `${pad(a)}-${LAST_DAY[a - 1] === 29 ? 28 : LAST_DAY[a - 1]}` });
    }
  }
  return out;
}

/** 앞쪽 글의 요일: '월~목' · '금~일·공휴일' · '평일·일·공휴일' · '주말' · '토요일' → 요일 + 공휴일. 없으면 null(매일). */
function daysIn(raw: string): { days: number[]; holiday: boolean } | null {
  let t = raw.replace(/\d{1,2}\s*월?\s*~\s*\d{1,2}\s*월/g, " ").replace(/\d{1,2}\s*월/g, " ");
  const days = new Set<number>();
  let holiday = false;
  let found = false;
  if (/공휴일|휴일/.test(t)) { holiday = true; found = true; t = t.replace(/공휴일|휴일/g, " "); }
  if (/매일|연중/.test(t)) { ALL_DAYS.forEach((d) => days.add(d)); found = true; t = t.replace(/매일|연중/g, " "); }
  if (/평일/.test(t)) { [1, 2, 3, 4, 5].forEach((d) => days.add(d)); found = true; t = t.replace(/평일/g, " "); }
  if (/주말/.test(t)) { [6, 0].forEach((d) => days.add(d)); found = true; t = t.replace(/주말/g, " "); }
  const range = /([월화수목금토일])(?:요일)?\s*~\s*([월화수목금토일])(?:요일)?/g;
  let m: RegExpExecArray | null;
  while ((m = range.exec(t))) {
    const a = DOW.indexOf(m[1]), b = DOW.indexOf(m[2]);
    // 월~일 순서로 돈다 (금~일 = 5,6,0)
    for (let k = 0, d = a; k < 7; k++, d = (d + 1) % 7) { days.add(d); if (d === b) break; }
    found = true;
  }
  t = t.replace(range, " ");
  const single = /(?:^|[^가-힣])([월화수목금토일])(?:요일)?(?=$|[^가-힣])/g;
  while ((m = single.exec(t))) { days.add(DOW.indexOf(m[1])); found = true; }
  return found ? { days: [...days].sort((x, y) => x - y), holiday } : null;
}

/**
 * 이용 시간 글 → 운영 시간 줄. 쉼표·줄바꿈으로 나눈 조각마다 '앞쪽 요일·달 + 첫 시간 범위 + 마지막 입장'.
 * '24시간·상시 개방'만 있으면 매일 0~24시. 못 읽으면 null.
 */
export function hoursRowsFromText(text: string): HoursRow[] | null {
  const t = normalize(text ?? "");
  if (!t.trim()) return null;
  if (/24\s*시간|상시\s*개방|연중\s*개방|상시\s*이용/.test(t) && !firstRange(t)) return rowsFromColumns(0, 1440);
  const rows: HoursRow[] = [];
  const pieces = t.split(/\n|,(?![^()]*\))|\/(?![^()]*\))|;/).map((s) => s.trim()).filter(Boolean);
  let globalLast: string | null = null;
  for (const piece of pieces) {
    const r = firstRange(piece);
    if (!r) {
      // 범위 없이 '입장 마감 17:00'만 있는 조각 → 모든 줄에
      if (/마감/.test(piece)) globalLast = piece;
      continue;
    }
    const head = piece.slice(0, r.index);
    const tail = piece.slice(r.end);
    const d = daysIn(head);
    const seasons = monthRanges(head);
    const last = lastEntryIn(tail, r.close) ?? lastEntryIn(head, r.close);
    const note = /하절기|동절기|춘추기|여름|겨울|야간/.exec(head)?.[0] ?? null;
    for (const s of seasons.length ? seasons : [null]) {
      rows.push({
        days: d?.days.length ? d.days : d?.holiday ? [] : ALL_DAYS, holiday: !!d?.holiday,
        openMin: r.open, closeMin: r.close, lastEntryMin: last != null && last > r.open ? last : null, breaks: [],
        validFrom: s?.from ?? null, validTo: s?.to ?? null, note,
      });
    }
  }
  if (globalLast) for (const row of rows) if (row.lastEntryMin == null) {
    const v = lastEntryIn(globalLast, row.closeMin);
    if (v != null && v > row.openMin) row.lastEntryMin = v;
  }
  // 같은 기간 없는 줄들이 요일이 겹치고 시각이 같으면 하나로 (평일·일 10~18 + 토 10~21 같은 건 그대로)
  return rows.length ? rows.slice(0, 12) : null;
}

/** 쉬는 날 글 → 쉬는 요일 + 규칙. '연중무휴'면 둘 다 빈 칸(= 확인된 값). 읽은 게 없으면 null. */
export function closuresFromText(text: string): { closedDays: number[]; closedRules: string[] } | null {
  const t = (text ?? "").replace(/\s+/g, "");
  if (!t) return null;
  const closedDays: number[] = [];
  for (let d = 0; d < 7; d++) if (restsOn(text, d)) closedDays.push(d);
  const rules = new Set<string>();
  if (/1월1일|신정/.test(t)) rules.add("newyear");
  // '설·추석 당일' = 당일, '설·추석 연휴' = 연휴 (당일 말이 없고 연휴가 있으면 둘 다 연휴)
  const all = /연휴/.test(t) && !/당일/.test(t);
  if (/(?<![가-힣])설(날|·|,|및|과|연휴|당일|$)/.test(t)) rules.add(all ? "seollal_all" : "seollal");
  if (/추석/.test(t)) rules.add(all ? "chuseok_all" : "chuseok");
  if (/공휴일(이면|인경우|일경우)[^,]{0,8}(다음|익일)/.test(t)) rules.add("holiday_shift");
  else if (/공휴일다음날|공휴일익일/.test(t)) rules.add("holiday_next");
  if (/연중무휴|휴무없음|없음/.test(t) && !closedDays.length && !rules.size) return { closedDays: [], closedRules: [] };
  return closedDays.length || rules.size ? { closedDays, closedRules: [...rules].sort() } : null;
}

/** 주차 글(+ 주차 요금 글) → 주차 칸. 못 읽으면 null. */
export function parkingFromText(parking: string, fee = ""): Parking | null {
  const p = (parking ?? "").replace(/\s+/g, "");
  const f = (fee ?? "").replace(/\s+/g, "");
  if (!p && !f) return null;
  let has: Parking["has"] | null = null;
  if (/불가|없음|불가능|주차장없/.test(p)) has = "no";
  else if (/협소|좁|혼잡|부족/.test(p)) has = "limited";
  else if (/가능|있음|있습니다|\d+대|주차장|유료|무료/.test(p) || /유료|무료|\d+원/.test(f)) has = "yes";
  if (!has) return null;
  const out: Parking = { has };
  if (has === "no") return out;
  if (/공영/.test(p)) out.kind = "public";
  else if (/노상|갓길|도로변/.test(p)) out.kind = "street";
  const both = p + f;
  if (/무료/.test(both) && /유료|\d+원/.test(both)) out.fee = "partial";
  else if (/무료/.test(both)) out.fee = "free";
  else if (/유료|\d+원/.test(both)) out.fee = "paid";
  const won = /(\d+(?:시간|분))?[^\d]{0,3}(\d{1,3}(?:,\d{3})+|\d+)원/.exec(fee || parking);
  if (won) out.fee_note = won[0].slice(0, 40);
  const cars = [...p.matchAll(/(\d+)대/g)].reduce((a, m) => a + Number(m[1]), 0);
  if (cars > 0) out.size = cars < 30 ? "S" : cars < 150 ? "M" : "L";
  if (/전기차|충전/.test(p)) out.ev = true;
  return out;
}

/** 요금 글 → 가격 칸. '무료'만이면 무료, 어른·아이 금액·몇 살 아래 무료를 읽는다. 못 읽으면 null. */
export function priceFromText(fee: string): Price | null {
  const f = (fee ?? "").replace(/\s+/g, " ").trim();
  if (!f) return null;
  const won = (re: RegExp) => { const m = re.exec(f); return m ? Number(m[m.length - 1].replace(/,/g, "")) : null; };
  const adult = won(/(어른|성인|대인|일반)[^\d]{0,8}(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
  const child = won(/(어린이|소인|아동|초등학생|초등|청소년)[^\d]{0,8}(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
  let under: number | null = null;
  const u = /(\d{1,2})\s*세\s*(이하|미만)[^,\n]{0,10}무료/.exec(f) ?? /(\d{1,2})\s*개월\s*(미만)[^,\n]{0,10}무료/.exec(f);
  if (u && !/개월/.test(u[0])) under = u[2] === "이하" ? Number(u[1]) + 1 : Number(u[1]);
  else if (/미취학[^,\n]{0,8}무료/.test(f)) under = 7;
  const anyWon = /\d[\d,]*\s*원/.test(f);
  if (/무료/.test(f) && !anyWon) return { free: true, level: 0, ...(under ? { child_free_under: under } : {}) };
  if (adult == null && child == null) {
    const one = won(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
    if (one == null) return null;
    const r = parsePrice({ free: false, adult: one, child_free_under: under });
    return "ok" in r ? r.ok : null;
  }
  const r = parsePrice({ free: false, adult, child, child_free_under: under });
  return "ok" in r && r.ok ? { ...r.ok, level: priceLevel(r.ok) } : null;
}

/** 유모차·반려동물 글 → 시설 칩. */
export function facilitiesFromText(intro: Pick<TourIntro, "babycarriage" | "pet">): string[] {
  const out: string[] = [];
  const ok = (s?: string) => !!s && /가능|대여|있음|허용/.test(s) && !/불가|없음|금지/.test(s);
  if (ok(intro.babycarriage)) out.push("유모차 가능");
  if (ok(intro.pet)) out.push("반려동물");
  return out;
}

/** 초안 (읽은 칸만). raw = 원문 (관리자 화면에 같이 보여 줌). */
export type AttrDraft = {
  hours?: HoursRow[];
  closedDays?: number[];
  closedRules?: string[];
  parking?: Parking;
  price?: Price;
  facilities?: string[];
  raw: Record<string, string>;
};

/** TourAPI 이용 정보 → 초안. */
export function draftFromTour(intro: TourIntro): AttrDraft {
  const d: AttrDraft = { raw: {} };
  const raw = { 이용시간: intro.usetime, 쉬는날: intro.restdate, 주차: intro.parking, 주차요금: intro.parkingFee, 요금: intro.fee, 유모차: intro.babycarriage ?? "", 반려동물: intro.pet ?? "" };
  for (const [k, v] of Object.entries(raw)) if (v) d.raw[k] = v;
  const hours = intro.usetime ? hoursRowsFromText(intro.usetime) : null;
  if (hours) d.hours = hours;
  const cl = intro.restdate ? closuresFromText(intro.restdate) : null;
  if (cl) { d.closedDays = cl.closedDays; d.closedRules = cl.closedRules; }
  const pk = parkingFromText(intro.parking, intro.parkingFee);
  if (pk) d.parking = pk;
  const pr = intro.fee ? priceFromText(intro.fee) : null;
  if (pr) d.price = pr;
  const fac = facilitiesFromText(intro);
  if (fac.length) d.facilities = fac;
  return d;
}

/** 조사 원문(places.hours·closed) → 초안 (시간·쉬는 날만). */
export function draftFromResearch(hours: string | null, closed: string | null): AttrDraft {
  const d: AttrDraft = { raw: {} };
  if (hours) d.raw["운영 시간 원문"] = hours;
  if (closed) d.raw["쉬는 날 원문"] = closed;
  const h = hours ? hoursRowsFromText(hours) : null;
  if (h) d.hours = h;
  const cl = closed ? closuresFromText(closed) : null;
  if (cl) { d.closedDays = cl.closedDays; d.closedRules = cl.closedRules; }
  return d;
}
