import { RARE_NIGHT, RARE_RAIN, type Sky } from "./planner";
import { kst } from "./kst";

/*
 * /api/phone/arrive(안드로이드 오토·폰이 판정한 도착) 도장에 붙이는 것 — 차(엔진 TripEngine.grant)와 같은 규칙.
 *  - 희귀: 주차한 때의 하늘이 비(RAIN)면 '비 오는 날'. 모든 명소에 붙고(도장북 '비 오는 날 디아크' 칸은 thearc일 때만 따로),
 *    축제 도장은 그 자체로 한정이라 붙이지 않는다. 날씨를 모르면(키 없음·실패 = UNKNOWN) 희귀 아님. 눈(SNOW)도 아님(엔진과 같게).
 *    비가 아니고 해 진 뒤 도착 + 밤 명소(시간 특성 best night 또는 표시 '야경')면 '밤' ('밤의 수성못', 엔진 RareStamp와 같은 규칙).
 *  - 몇 번째 방문: 이 차가 이 장소(축제면 축제 id)에서 받은 도장 수 + 1 (메달 '또 왔어요' 칸).
 */

export { RARE_NIGHT, RARE_RAIN };

/** '밤의 ○○' 칸이 있는 명소 (폰 places.ts ALBUM · 차 StampAlbum과 같은 목록). 그 밖의 '밤' 도장은 장소 칸에 '희귀 · 밤'으로. */
export const NIGHT_ALBUM = ["suseongmot", "chimsan", "eworld"] as const;

/** 도장 → 도장북 칸: 비 오는 날 디아크 = thearc_rain · 밤의 ○○ = '<id>_night' (칸이 있을 때) · 그 밖 = 장소 id. */
export function albumKeyOf(placeId: string, rare: unknown): string {
  if (typeof rare === "string" && rare === RARE_NIGHT) return (NIGHT_ALBUM as readonly string[]).includes(placeId) ? `${placeId}_night` : placeId;
  return placeId === "thearc" && rare ? "thearc_rain" : placeId;
}

/** [night] = 해 진 뒤 판정 재료 (주차한 때 분 · 그날 해 지는 분 · 밤 명소인가). 없으면 비만 본다. */
export function rareFor(sky: Sky, festival: boolean, night?: { nowMin: number; sunsetMin: number | null; nightBest: boolean }): string | null {
  if (festival) return null;
  if (sky === "RAIN") return RARE_RAIN;
  if (night && night.sunsetMin != null && night.nowMin >= night.sunsetMin && night.nightBest) return RARE_NIGHT;
  return null;
}

/**
 * 날씨를 볼 시각(한국 분): 폰이 보낸 도착 시각(at)이 오늘이고 지금보다 늦지 않으면 그 시각, 아니면 지금.
 * (못 보내 쌓였다가 나중에 보낸 도장도 주차한 때의 하늘로 — 단 날씨는 오늘 것만 있다)
 */
export function skyMinute(at: string, now: Date): number {
  const n = kst(now);
  const t = new Date(at);
  if (Number.isNaN(t.getTime()) || t.getTime() > now.getTime() + 5 * 60_000) return n.min;
  const k = kst(t);
  return k.day === n.day ? k.min : n.min;
}

/** 답 payload: { number, rare?, silent?, festivalId?, season?, visit } — 빈 값은 뺀다. */
export function arriveReplyPayload(o: {
  number: unknown; rare: string | null; silent: boolean; visit: number;
  festival?: { id: string; season: string | null } | null;
}): Record<string, unknown> {
  const p: Record<string, unknown> = { number: o.number, visit: Math.max(1, Math.round(o.visit)) };
  if (o.rare) p.rare = o.rare;
  if (o.silent) p.silent = true;
  if (o.festival) {
    p.festivalId = o.festival.id;
    if (o.festival.season) p.season = o.festival.season;
  }
  return p;
}
