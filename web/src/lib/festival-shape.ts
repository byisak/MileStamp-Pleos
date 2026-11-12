/*
 * 축제·행사 모양과 검사 — 서버·관리자 화면이 같이 쓴다 (DB 접근 없음, 순수 함수).
 * 날짜는 한국 날짜 'YYYY-MM-DD', 시각은 0시부터 분, 쉬는 요일은 0=일 … 6=토. 표 설명은 db/schema.sql '축제·행사' 절.
 */
import { normalizePoints, type ArrivalPoint, type StampRef } from "./catalog-shape";
import { parseFitInput, parseTagsInput, type FitView } from "./companion-shape";

/** 추천 가중치: 보통 · 강하게(주말 1순위 후보) — 엔진 FestivalInfo.WEIGHT_NORMAL·WEIGHT_STRONG. */
export const WEIGHT_NORMAL = 1.0;
export const WEIGHT_STRONG = 2.5;
/** 축제 도장 잉크 (붉은 인주). 차·폰 메달 색도 같은 값. */
export const FESTIVAL_INK = "#A33B2B";

export type FestivalStatus = "upcoming" | "running" | "ended";
export const STATUS_LABEL: Record<FestivalStatus, string> = { running: "진행 중", upcoming: "예정", ended: "끝남" };

/** 관리자 화면이 다루는 축제 한 건. */
export type AdminFestival = {
  id: string;
  name: string;
  summary: string;
  placeId: string | null;
  points: ArrivalPoint[];
  lat: number;
  lng: number;
  starts: string;
  ends: string;
  open: number;
  close: number;
  closedDays: number[];
  dwell: number;
  indoor: boolean;
  kidFit: number;
  /** 동행별 적합도 4칸 (kids = kidFit) · 분위기 표시 (누구랑 가요?) */
  fit: FitView;
  tags: string[];
  weight: number;
  crowdNote: string;
  season: string;
  poster: { url: string | null; version: number };
  stamp: StampRef;
  ring: string;
  source: string | null;
  active: boolean;
  createdAt: string | null;
  editedAt: string | null;
};

/** 앱(폰·차)이 받는 축제 한 건 (GET /api/catalog festivals[]). 상태는 앱이 날짜로 다시 계산해도 된다. */
export type CatalogFestival = {
  id: string;
  name: string;
  summary: string | null;
  placeId: string | null;
  points: ArrivalPoint[];
  lat: number;
  lng: number;
  starts: string;
  ends: string;
  open: number;
  close: number;
  closedDays: number[];
  dwell: number;
  indoor: boolean;
  kidFit: number;
  fit: FitView;
  tags: string[];
  weight: "normal" | "strong";
  crowdNote: string | null;
  season: string;
  poster: string | null;
  stamp: StampRef;
  ring: string;
  status: FestivalStatus;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^fest-[a-z0-9][a-z0-9-]{1,30}$/;

/** 한국 시각 기준 오늘 'YYYY-MM-DD' (서버가 어디서 돌든). */
export function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' + n일. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 날짜로 정하는 상태: 예정 · 진행 중 · 끝남 (쉬는 요일은 따지지 않음). */
export function festivalStatus(f: { starts: string; ends: string }, today: string): FestivalStatus {
  if (today < f.starts) return "upcoming";
  if (today > f.ends) return "ended";
  return "running";
}

/** '2026 가을' — 도장 아래 글씨·도장북 '지난 축제' 칸. 12~2월은 겨울(1·2월은 앞 해 겨울). */
export function seasonLabel(starts: string): string {
  const [y, m] = starts.split("-").map(Number);
  if (m >= 3 && m <= 5) return `${y} 봄`;
  if (m >= 6 && m <= 8) return `${y} 여름`;
  if (m >= 9 && m <= 11) return `${y} 가을`;
  return `${m === 12 ? y : y - 1} 겨울`;
}

/** '10/20~11/9' */
export function periodText(f: { starts: string; ends: string }): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return `${md(f.starts)}~${md(f.ends)}`;
}

export const weightName = (w: number): "normal" | "strong" => (w >= WEIGHT_STRONG ? "strong" : "normal");

export type FestivalInput = Omit<AdminFestival, "id" | "lat" | "lng" | "poster" | "stamp" | "ring" | "createdAt" | "editedAt" | "source"> & {
  posterUrl: string | null;
  source: string | null;
};

const okUrl = (u: unknown): u is string => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) && u.length < 600;

/** 새 축제 id 검사 ('fest-' + 영문 소문자·숫자·-). */
export function validFestivalId(id: string): boolean {
  return ID_RE.test(id);
}

/** 관리자 저장 요청 검사. 잘못된 칸이 있으면 { error } (한국어). */
export function parseFestivalInput(body: unknown): { ok: FestivalInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "내용이 비었어요" };
  const b = body as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  if (!name) return { error: "이름을 적어 주세요" };
  if (name.length > 40) return { error: "이름은 40자까지예요" };
  const starts = String(b.starts ?? ""), ends = String(b.ends ?? "");
  if (!DATE_RE.test(starts) || !DATE_RE.test(ends)) return { error: "기간(시작일·종료일)을 골라 주세요" };
  if (ends < starts) return { error: "종료일이 시작일보다 앞이에요" };
  const open = Number(b.open), close = Number(b.close);
  if (!Number.isInteger(open) || !Number.isInteger(close) || open < 0 || close > 1440 || open >= close)
    return { error: "여는 시각이 닫는 시각보다 앞이어야 해요" };
  const dwell = Number(b.dwell ?? 90);
  if (!Number.isInteger(dwell) || dwell < 10 || dwell > 600) return { error: "머무는 시간은 10~600분이에요" };
  const kidFit = Number(b.kidFit ?? 0.8);
  if (!Number.isFinite(kidFit) || kidFit < 0 || kidFit > 1) return { error: "아이 적합도는 0~1이에요" };
  const kf = Math.round(kidFit * 100) / 100;
  const fitR = parseFitInput(b.fit, kf);
  if ("error" in fitR) return { error: fitR.error };
  const tags = parseTagsInput(b.tags);
  if (!tags) return { error: "분위기 표시 모양이 이상해요" };
  const points = Array.isArray(b.points) ? normalizePoints(b.points, NaN, NaN) : [];
  if (!points.length || points.some((p) => !Number.isFinite(p.lat))) return { error: "도착 지점이 하나 이상 있어야 해요" };
  const closedDays = [...new Set((Array.isArray(b.closedDays) ? b.closedDays : []).map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort();
  const placeId = typeof b.placeId === "string" && b.placeId ? b.placeId : null;
  const posterUrl = b.posterUrl === null || b.posterUrl === undefined || b.posterUrl === "" ? null : b.posterUrl;
  if (posterUrl !== null && !okUrl(posterUrl)) return { error: "포스터 주소는 https:// 로 시작해야 해요" };
  const txt = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
  return {
    ok: {
      name,
      summary: txt(b.summary, 120),
      placeId,
      points,
      starts,
      ends,
      open,
      close,
      closedDays,
      dwell,
      indoor: !!b.indoor,
      kidFit: kf,
      fit: fitR.fit ?? { kids: kf, couple: 0.6, friends: 0.6, solo: 0.6 },
      tags,
      weight: Number(b.weight) >= WEIGHT_STRONG ? WEIGHT_STRONG : WEIGHT_NORMAL,
      crowdNote: txt(b.crowdNote, 60),
      season: txt(b.season, 20) || seasonLabel(starts),
      posterUrl,
      source: typeof b.source === "string" ? b.source.slice(0, 60) : null,
      active: b.active === undefined ? true : !!b.active,
    },
  };
}

/** TourAPI searchFestival2 한 줄 → 관리자 폼 처음 값 (사람이 검수 후 저장). */
export type TourFestival = {
  contentId: string;
  title: string;
  addr: string;
  starts: string;
  ends: string;
  lat: number | null;
  lng: number | null;
  image: string | null;
  tel: string;
};

/** '20261020' → '2026-10-20' (모양이 다르면 ''). */
export function ymdToIso(s: unknown): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** searchFestival2 응답 JSON → 목록. 응답이 이상하면 빈 목록. */
export function parseTourFestivals(json: unknown): TourFestival[] {
  const items = (json as { response?: { body?: { items?: { item?: unknown } | "" } } })?.response?.body?.items;
  const raw = items && typeof items === "object" ? items.item : undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: TourFestival[] = [];
  for (const it of list as Record<string, unknown>[]) {
    const starts = ymdToIso(it.eventstartdate), ends = ymdToIso(it.eventenddate);
    if (!starts || !ends || !it.title) continue;
    const lat = Number(it.mapy), lng = Number(it.mapx);
    const img = typeof it.firstimage === "string" && it.firstimage ? it.firstimage.replace(/^http:\/\//, "https://") : null;
    out.push({
      contentId: String(it.contentid ?? ""),
      title: String(it.title).trim(),
      addr: String(it.addr1 ?? "").trim(),
      starts,
      ends,
      lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
      lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
      image: img,
      tel: String(it.tel ?? ""),
    });
  }
  return out;
}
