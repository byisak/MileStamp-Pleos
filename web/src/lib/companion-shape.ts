/*
 * 누구랑 가요? — 장소·축제의 동행 적합도·분위기 표시 모양 (DB·네트워크 없이, 시험은 companion-shape.test.ts).
 * 엔진 규칙은 planner.ts(fitScore·explainChoice), 여기는 관리자 입력 검사·API 모양·'고르기' 목록 표시.
 */
import { COMPANION_DEFAULT_FIT, type Companion } from "./planner";

/** 동행 적합도 4칸 (kids = kid_fit과 같은 값). */
export type FitView = Record<Companion, number>;

const num01 = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) && x >= 0 && x <= 1 ? Math.round(x * 100) / 100 : null;
};

/** DB fit jsonb + kid_fit → 4칸 (비면 어른 기본값). */
export function fitView(kidFit: number, v: unknown): FitView {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return {
    kids: kidFit,
    couple: num01(o.couple) ?? COMPANION_DEFAULT_FIT,
    friends: num01(o.friends) ?? COMPANION_DEFAULT_FIT,
    solo: num01(o.solo) ?? COMPANION_DEFAULT_FIT,
  };
}

/** 관리자 입력 fit {couple, friends, solo} 검사 → 저장할 jsonb ({kids: kidFit, …}). 없으면 null(저장 안 바꿈), 틀리면 error. */
export function parseFitInput(v: unknown, kidFit: number): { fit: FitView | null } | { error: string } {
  if (v == null) return { fit: null };
  if (typeof v !== "object" || Array.isArray(v)) return { error: "동행 적합도 모양이 이상해요" };
  const o = v as Record<string, unknown>;
  const out: FitView = { kids: kidFit, couple: 0, friends: 0, solo: 0 };
  for (const c of ["couple", "friends", "solo"] as const) {
    const x = num01(o[c] ?? COMPANION_DEFAULT_FIT);
    if (x == null) return { error: "동행 적합도는 0~1이에요" };
    out[c] = x;
  }
  return { fit: out };
}

/** 분위기 표시 검사: 글자만, 앞뒤 공백·'#' 빼고, 12자까지, 같은 것 하나만, 16개까지. 틀리면 null. */
export function parseTagsInput(v: unknown): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== "string") return null;
    const s = t.replace(/^#/, "").trim().slice(0, 12);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 16);
}

// ------------------------------------------------------------------ '고르기' 목록 (축제·100선·직접 찾기) 동행 표시

/** 어른 위주 행사로 보이는 이름 (술·밤 공연 등) — 아이와면 −, 연인·친구면 +. */
const ADULTISH = /(맥주|비어|와인|막걸리|전통주|술\s|술축제|칵테일|치맥|재즈|야간|나이트|심야|불꽃|EDM|힙합|락\s?페스|록\s?페스|클럽|DJ)/i;
/** 아이와 가기 좋은 이름. */
const KIDISH = /(어린이|키즈|유아|아이|동요|인형|캐릭터|동물|곤충|과학|체험|놀이|썰매|눈썰매|물놀이|가족)/;

/**
 * 목록 한 줄의 동행 표시: sign +1 = 이 동행에게 좋아요 · −1 = 덜 맞아요 · 0 = 모름. note = 짧은 글 (폰이 칩으로).
 * 우리 명소·축제는 fit 값(0.75 이상 +, 0.45 이하 −), 바깥 곳은 이름으로 짐작(어른 위주 행사: 아이와 −, 연인·친구 +).
 */
export function companionSign(
  item: { name: string; type?: string },
  companion: Companion,
  fit?: FitView | null,
): { sign: -1 | 0 | 1; note: string | null } {
  if (fit) {
    const f = fit[companion];
    if (f >= 0.75) return { sign: 1, note: GOOD[companion] };
    if (f <= 0.45) return { sign: -1, note: MEH[companion] };
    return { sign: 0, note: null };
  }
  const adult = ADULTISH.test(item.name);
  const kid = KIDISH.test(item.name);
  if (companion === "kids") {
    if (adult) return { sign: -1, note: "어른 위주 행사" };
    if (kid) return { sign: 1, note: GOOD.kids };
    return { sign: 0, note: null };
  }
  if (adult && (companion === "couple" || companion === "friends")) return { sign: 1, note: GOOD[companion] };
  if (kid && !adult) return { sign: -1, note: "아이 위주" };
  return { sign: 0, note: null };
}

const GOOD: Record<Companion, string> = { kids: "아이와 좋아요", couple: "연인과 좋아요", friends: "친구와 좋아요", solo: "혼자 좋아요" };
const MEH: Record<Companion, string> = { kids: "아이에겐 어려워요", couple: "둘이선 심심해요", friends: "친구끼린 심심해요", solo: "혼자는 어색해요" };
