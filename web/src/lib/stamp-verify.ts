/*
 * 도장 검증 — 엔진 Rules.kt StampVerifier를 줄 단위로 옮긴 것 (서버 2차 검증, 폰 안드로이드 오토 도착 /api/phone/arrive).
 * 0.9 × 직선거리 − 1km ≤ 늘어난 거리 ≤ 1.5 × 경로거리 + 20km
 * GPS 궤적이 믿을 만하면(≥ 0.9 × 직선) 상한을 max(1.5 × 경로 + 20, 1.15 × 궤적 + 3)으로 넓힌다. 엔진을 고치면 여기도.
 */
import { TravelTime } from "./planner";
import { EXT_ID } from "./ext";

export type HoldReason = "ODO_TOO_SHORT" | "ODO_TOO_LONG" | "NO_ODOMETER" | "ALREADY_TODAY";
export type StampVerdict =
  | { kind: "granted"; deltaKm: number; minKm: number; maxKm: number }
  | { kind: "held"; reason: HoldReason; detail: string };

export const GPS_CONSISTENT_RATIO = 0.9;
export const GPS_SLACK_RATIO = 1.15;
export const GPS_SLACK_KM = 3.0;

/**
 * [straightKm] = 출발점 → 장소 직선거리, [deltaKm] = 늘어난 거리(주행거리계, 없으면 GPS 궤적),
 * [routeKm] = 경로거리(모르면 직선 × 도로계수), [gpsPathKm] = GPS 궤적 길이(모르면 null).
 */
export function verifyStamp(o: {
  straightKm: number; deltaKm: number | null; routeKm?: number | null; gpsPathKm?: number | null; alreadyToday?: boolean;
}): StampVerdict {
  if (o.alreadyToday) return { kind: "held", reason: "ALREADY_TODAY", detail: "오늘 이미 찍은 곳이에요" };
  if (o.deltaKm == null || !Number.isFinite(o.deltaKm)) return { kind: "held", reason: "NO_ODOMETER", detail: "주행거리 신호를 받지 못했어요" };
  const route = o.routeKm ?? o.straightKm * TravelTime.ROAD_FACTOR;
  const min = 0.9 * o.straightKm - 1.0;
  const byRoute = 1.5 * route + 20.0;
  const path = o.gpsPathKm;
  const pathOk = path != null && Number.isFinite(path) && path >= GPS_CONSISTENT_RATIO * o.straightKm;
  const max = pathOk ? Math.max(byRoute, GPS_SLACK_RATIO * path! + GPS_SLACK_KM) : byRoute;
  if (o.deltaKm < min) return { kind: "held", reason: "ODO_TOO_SHORT", detail: `주행거리가 이동거리와 맞지 않아요 (${o.deltaKm.toFixed(1)}km < ${min.toFixed(1)}km)` };
  if (o.deltaKm > max) return { kind: "held", reason: "ODO_TOO_LONG", detail: `주행거리가 경로보다 너무 길어요 (${o.deltaKm.toFixed(1)}km > ${max.toFixed(1)}km)` };
  return { kind: "granted", deltaKm: o.deltaKm, minKm: min, maxKm: max };
}

/** /api/phone/arrive 요청 모양 검사 (좌표 없음). 틀리면 { error }. */
export type ArriveBody = {
  placeId: string; odoKm: number | null; gpsPathKm: number; straightKm: number; fromPlaceId: string | null;
  source: "phone" | "odometer"; reason: "STOP_3MIN" | "DISCONNECT"; verdict: "granted" | "held"; at: string;
  /** 쉿 모드(아이가 자는 중)로 찍음 → 가족 폰도 울리지 않는다 (차 도장 payload.silent와 같음) */
  silent: boolean;
};

export function parseArrive(b: unknown): { ok: ArriveBody } | { error: string } {
  if (!b || typeof b !== "object") return { error: "내용이 비었어요" };
  const o = b as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 5000 ? v : null);
  // 명소·축제 id 또는 바깥 장소 'ext:tour:…'·'ext:kto100:…'·'ext:kakao:…'·'ext:pin:…' (도장 없음 → '다녀옴', api/phone/arrive)
  if (typeof o.placeId !== "string" || !(/^[a-z][a-z0-9_-]{1,40}$/.test(o.placeId) || EXT_ID.test(o.placeId))) return { error: "placeId가 이상해요" };
  const odoKm = o.odoKm === null || o.odoKm === undefined ? null : num(o.odoKm);
  if (o.odoKm != null && odoKm === null) return { error: "odoKm이 이상해요" };
  const gpsPathKm = num(o.gpsPathKm), straightKm = num(o.straightKm);
  if (gpsPathKm === null || straightKm === null) return { error: "gpsPathKm·straightKm은 0 이상 숫자예요" };
  const fromPlaceId = typeof o.fromPlaceId === "string" && o.fromPlaceId ? o.fromPlaceId : null;
  if (o.source !== "phone" && o.source !== "odometer") return { error: "source는 phone 또는 odometer예요" };
  if (o.reason !== "STOP_3MIN" && o.reason !== "DISCONNECT") return { error: "reason은 STOP_3MIN 또는 DISCONNECT예요" };
  if (o.verdict !== "granted" && o.verdict !== "held") return { error: "verdict는 granted 또는 held예요" };
  const at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? o.at : new Date().toISOString();
  return { ok: { placeId: o.placeId, odoKm, gpsPathKm, straightKm, fromPlaceId, source: o.source, reason: o.reason, verdict: o.verdict, at, silent: o.silent === true } };
}
