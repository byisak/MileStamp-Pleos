/*
 * 머무는 시간 맞춤 — DB 없이 쓰는 모양·계산 (엔진 FamilyProfile.dwellEstimate · DwellLearning의 서버 쪽 도우미).
 * 계산식 자체는 planner.ts(dwellEstimate·learnDwell, 엔진과 같은 사례로 확인). 여기는 코스 → 머문 기록, 또래 통계 고르기, 화면 글.
 */
import { DwellLearning, dwellEstimate, dwellSourceText, prefFactor, type CrowdDwell, type FamilyProfile, type Place } from "./planner";
import type { CourseJson } from "./livecourse";

/** 가족 설정 '머무는 편'. */
export const DWELL_PREFS = ["quick", "normal", "long"] as const;
export type DwellPref = (typeof DWELL_PREFS)[number];
export const DWELL_PREF_TEXT: Record<DwellPref, string> = { quick: "빨리 둘러봐요", normal: "보통", long: "오래 놀아요" };
export const isDwellPref = (v: unknown): v is DwellPref => typeof v === "string" && (DWELL_PREFS as readonly string[]).includes(v);
export { prefFactor };

/** 머문 기록 한 건 (코스에서 다녀온 곳). */
export type Visit = { placeId: string; arriveMin: number; departMin: number };

/** 이번 저장으로 새로 '다녀옴'(DONE)이 된 곳 — 도착·출발 시각이 둘 다 있을 때만. */
export function visitsFromCourse(before: CourseJson | null | undefined, after: CourseJson): Visit[] {
  const wasDone = new Set((before?.stops ?? []).filter((s) => s.status === "DONE").map((s) => s.placeId));
  return after.stops
    .filter((s) => s.status === "DONE" && !wasDone.has(s.placeId) && s.actualArriveMin != null && s.actualDepartMin != null)
    .map((s) => ({ placeId: s.placeId, arriveMin: s.actualArriveMin!, departMin: s.actualDepartMin! }));
}

/** 실제 머문 분: 문 열기 전 기다림은 빼고. */
export const visitDwell = (v: Visit, openMin: number) => Math.max(0, v.departMin - Math.max(v.arriveMin, openMin));

/** 문 닫는 시각(5분 안)에 걸려 나왔으면 진짜 머무름이 아님 → 배우기·통계에서 뺀다. */
export const cutByClose = (departMin: number, closeMin: number) => closeMin < 24 * 60 && departMin >= closeMin - 5;

/** 배울 만한 머무름인가 (10분 이상, 문 닫아 나온 것 아님). */
export const learnable = (dwellMin: number, cut: boolean) => !cut && dwellMin >= DwellLearning.SAMPLE_MIN && dwellMin <= 12 * 60;

/** 또래 통계 한 줄 (place_dwell_stats). */
export type CrowdRow = { place_id: string; bucket: string; n_families: number; p50: number; p75: number };

/**
 * 오늘 쓸 또래 값 고르기: 비 오는 날 실내 장소면 'rain' 칸 → 주말·평일 칸 → 'all' 칸. 칸마다 10가족 이상일 때만.
 * 엔진에는 {p75, n}만 넘긴다 (가족마다 값은 절대 안 나감).
 */
export function pickCrowd(rows: CrowdRow[], ctx: { weekend: boolean; rainy: boolean; indoor: (placeId: string) => boolean }): Record<string, CrowdDwell> {
  const by = new Map<string, Map<string, CrowdRow>>();
  for (const r of rows) {
    if (r.n_families < DwellLearning.CROWD_MIN_N) continue;
    if (!by.has(r.place_id)) by.set(r.place_id, new Map());
    by.get(r.place_id)!.set(r.bucket, r);
  }
  const out: Record<string, CrowdDwell> = {};
  for (const [id, b] of by) {
    const r = (ctx.rainy && ctx.indoor(id) ? b.get("rain") : undefined) ?? b.get(ctx.weekend ? "weekend" : "weekday") ?? b.get("all");
    if (r) out[id] = { p75: r.p75, n: r.n_families };
  }
  return out;
}

/** 분 → '2시간 10분' / '45분'. */
export function durText(min: number): string {
  if (min < 60) return `${min}분`;
  return min % 60 === 0 ? `${min / 60}시간` : `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

/** 머무름 출처 (응답 JSON): family = 우리 가족 기록 n번 · crowd = 같은 또래 n가족 · base = 조사값. */
export type DwellView = { minutes: number; source: "family" | "crowd" | "base"; n: number; text: string };

export function dwellView(profile: FamilyProfile, p: Place): DwellView {
  const e = dwellEstimate(profile, p);
  return { minutes: e.minutes, source: e.source === "FAMILY" ? "family" : e.source === "CROWD" ? "crowd" : "base", n: e.n, text: dwellSourceText(e) };
}

/** 장소 자세히의 '같은 또래 가족' 글: '같은 또래 가족 보통 2시간 10분 (23가족)'. 10가족 미만이면 null. */
export function crowdText(r: { n_families: number; p50: number } | null | undefined): string | null {
  if (!r || r.n_families < DwellLearning.CROWD_MIN_N) return null;
  return `같은 또래 가족 보통 ${durText(r.p50)} (${r.n_families}가족)`;
}
