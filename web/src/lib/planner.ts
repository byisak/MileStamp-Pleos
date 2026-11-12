/*
 * 추천 계산 — 엔진 `engine/src/main/kotlin/kr/milestamp/engine/Planner.kt`(+ Model.kt·Rules.kt 일부)를 줄 단위로 옮긴 것.
 * 규칙과 점수만 쓴다(AI 없음). 같은 입력 → 같은 출력.
 * 두 쪽이 같은 시험 사례(`engine/src/test/resources/plan-cases.json`)로 결과가 같은지 확인하므로
 * 계산 순서·동점 처리·반올림까지 엔진과 똑같이 둔다. 엔진을 고치면 여기도 같이 고친다.
 * 시각은 모두 '그날 0시부터 분'.
 */
import { isHoliday, pickHoursRow, type HoursRow } from "./place-attrs-shape";

// ------------------------------------------------------------------ 모델 (Model.kt)

export type LatLng = { lat: number; lng: number };

export type Sky = "CLEAR" | "RAIN" | "SNOW" | "UNKNOWN";

/** 추천 후보 장소. 좌표는 TourAPI mapx/mapy. */
export type Place = {
  id: string;
  name: string;
  at: LatLng;
  indoor: boolean;
  /** 4살 기준 예상 머무는 시간(분, 상위 80%). */
  dwellP80Min: number;
  /** 아이 적합도 0~1. */
  kidFit: number;
  /** 문 여는·닫는 시각(분). 상시 개방은 0~1440. */
  openMin: number;
  closeMin: number;
  /** 요즘 다녀간 팀 수. 10팀 미만이면 '요즘 많이 감'으로 치지 않는다. */
  popular: number;
  /** 도장 그림이 있어 도장을 찍을 수 있는 곳. */
  stampable: boolean;
  /** 기간 한정 축제·행사면 그 정보. 기간 밖이면 추천에서 빠진다. */
  festival?: FestivalInfo | null;
  /** 동행별 적합도 0~1 (아이와는 kidFit). 칸이 없으면 COMPANION_DEFAULT_FIT (엔진 Place.fit). */
  fit?: Partial<Record<Companion, number>> | null;
  /** 분위기 표시 (야경·카페·데이트·체험·산책·전시·드라이브·액티비티·조용함 …) — 동행별 가점·'왜?' 글 (엔진 Place.tags). */
  tags?: string[] | null;
  /** 어른 기준 머무는 시간(분). 없으면 dwellP80Min × 0.8 (엔진 Place.adultDwellMin). */
  adultDwellMin?: number | null;
  /** 쉬는 요일 (0=일 … 6=토) — 그날 추천에서 빠진다 (엔진 Place.closedDays). */
  closedDays?: number[] | null;
  /** 임시 휴무 날짜 'YYYY-MM-DD' (엔진 Place.closedDates). */
  closedDates?: string[] | null;
  /**
   * 운영 시간 줄 (요일·공휴일·계절별, 엔진 Place.hours). 있으면 그날(day) 맞는 줄의 시각이 openMin·closeMin·lastEntryMin이 되고,
   * 맞는 줄이 없으면 그날 쉰다 (placeOnDay). 없으면 예전처럼 openMin·closeMin 하나.
   */
  hours?: HoursRow[] | null;
  /** 마지막 입장(분). 도착이 이보다 늦으면 못 들어간다. 없으면 따지지 않음 (엔진 Place.lastEntryMin). */
  lastEntryMin?: number | null;
  /** 종류: spot · view · market · drive(야경 드라이브 길, route와 같이) (엔진 Place.kind). 없으면 spot. */
  kind?: string | null;
  /** 야경 드라이브 길 (kind = drive) — 지나갈 점들 · 지나가는 분 (엔진 DriveRoute). */
  route?: EngineRoute | null;
  /** 시간 특성 — best · 조명 켜지는 시각 · 쇼 시간표 (엔진 Moments, 쇼 시각은 분). */
  moments?: EngineMoments | null;
  /** 저녁(해 진 뒤) 어울림 0~1, 동행별 아이와 포함 (엔진 Place.fitEvening, DB fit.evening). */
  fitEvening?: Partial<Record<Companion, number>> | null;
};

/** 야경 드라이브 길 (엔진 DriveRoute): 첫 점 = 들어가는 곳, 끝 점 = 나오는 곳. */
export type EngineRoute = { points: LatLng[]; passMin: number };
/** 쇼 하나 (엔진 Show): 시각은 분(오름차순), 요일(0=일)·달(1~12)은 비면 늘. */
export type EngineShow = { name: string; times: number[]; days?: number[]; months?: number[] };
/** 시간 특성 (엔진 Moments): best = day·sunset·night, lightOn = 'sunset+15' · 'HH:MM'. */
export type EngineMoments = { best: string[]; lightOn?: string | null; shows?: EngineShow[] };

const KIND_DRIVE = "drive";
/** 야경 드라이브 길인가 (엔진 Place.isDrive). */
export const isDrivePlace = (p: Place): boolean => p.kind === KIND_DRIVE && p.route != null && p.route.points.length >= 2;
/** 밤에 좋은 곳: best에 night 또는 표시 '야경' (엔진 Place.nightBest). '밤의 ○○' 도장도 이런 곳만. */
export const nightBest = (p: Place): boolean => (p.moments?.best ?? []).includes("night") || (p.tags ?? []).includes("야경");
/** 노을에 좋은 곳 (엔진 Place.sunsetBest). */
export const sunsetBest = (p: Place): boolean => (p.moments?.best ?? []).includes("sunset") || (p.tags ?? []).includes("노을");

/** 조명 켜지는 시각(분) (엔진 Moments.lightOnMin). 'sunset+N'인데 해 시각을 모르면 null. */
export function lightOnMin(m: EngineMoments | null | undefined, sunsetMin: number | null | undefined): number | null {
  const on = m?.lightOn?.replace(/ /g, "");
  if (!on) return null;
  const sm = /^sunset([+-]\d{1,3})?$/.exec(on);
  if (sm) return sunsetMin == null ? null : sunsetMin + (sm[1] ? Number(sm[1]) : 0);
  try {
    return hhmm(on);
  } catch {
    return null;
  }
}

/** [day]에 하는 쇼인가 (엔진 Show.runsOn). 날짜를 모르면 요일·달 제한이 없는 쇼만. */
export function showRunsOn(sh: EngineShow, day: string | null | undefined): boolean {
  const days = sh.days ?? [], months = sh.months ?? [];
  if (day == null || day.length !== 10) return days.length === 0 && months.length === 0;
  const month = Number(day.slice(5, 7));
  return (days.length === 0 || days.includes(weekdayOf(day))) && (months.length === 0 || months.includes(month));
}

/** 조건 도장 이름 (엔진 RareStamp): 비 오는 날 · 밤(해 진 뒤 + 밤 명소). 축제 도장은 없음. */
export const RARE_RAIN = "비 오는 날";
export const RARE_NIGHT = "밤";
export function rareStampOf(p: Place, sky: Sky, nowMin: number, sunsetMin: number | null | undefined): string | null {
  if (p.festival) return null;
  if (sky === "RAIN") return RARE_RAIN;
  if (sunsetMin != null && nowMin >= sunsetMin && nightBest(p)) return RARE_NIGHT;
  return null;
}

/**
 * 누구랑 가요? (엔진 GoWith) — kids 아이와 · couple 연인·부부 · friends 친구끼리 · solo 혼자.
 * 아이와는 예전 규칙 그대로, 어른끼리는 낮잠 없음 · 귀가 한계 22:00 · 어른 머무름 · 동행 적합도 + 분위기 가점.
 */
export type Companion = "kids" | "couple" | "friends" | "solo";
export const COMPANIONS: readonly Companion[] = ["kids", "couple", "friends", "solo"];
export const COMPANION_TEXT: Record<Companion, string> = { kids: "아이와", couple: "연인·부부", friends: "친구끼리", solo: "혼자" };
/** 장소에 동행 적합도가 없을 때 어른 기본값. */
export const COMPANION_DEFAULT_FIT = 0.6;
/** 'kids'·'couple'·'friends'·'solo' → 값. 모르면 null. */
export function parseCompanion(v: unknown): Companion | null {
  return typeof v === "string" && (COMPANIONS as readonly string[]).includes(v) ? (v as Companion) : null;
}
const companionOf = (p: FamilyProfile): Companion => p.companion ?? "kids";
const isKids = (p: FamilyProfile) => companionOf(p) === "kids";

/** 이 동행에게 맞는 정도 0~1. 아이와 = kidFit (엔진 Place.fitFor). */
export function fitFor(p: Place, c: Companion): number {
  return c === "kids" ? p.kidFit : (p.fit?.[c] ?? COMPANION_DEFAULT_FIT);
}

/**
 * 기간 한정 축제·행사 (엔진 FestivalInfo). 날짜는 한국 날짜 'YYYY-MM-DD', 하루 운영 시각은 Place.openMin·closeMin.
 * placeId = 붙은 명소 (축제가 열리는 날엔 그 명소 대신 축제를 추천), closedDays = 쉬는 요일 (0=일 … 6=토).
 */
export type FestivalInfo = { id: string; starts: string; ends: string; weight: number; placeId: string | null; closedDays: number[] };

/** 추천 가중치: 보통 · 강하게(주말 1순위 후보). */
export const FESTIVAL_WEIGHT_NORMAL = 1.0;
export const FESTIVAL_WEIGHT_STRONG = 2.5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → 요일 (0=일 … 6=토). */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** [day]에 열리나: 기간 안 + 쉬는 요일 아님. 날짜를 모르면 열리지 않는 것으로. */
export function festivalRunsOn(f: FestivalInfo, day: string | null | undefined): boolean {
  return day != null && DATE_RE.test(day) && day >= f.starts && day <= f.ends && !f.closedDays.includes(weekdayOf(day));
}

/** [day]에 쉬나: 쉬는 요일이거나 임시 휴무이거나 운영 시간 줄 중 그날 맞는 게 없음. 날짜를 모르면 쉬지 않는 것으로 (엔진 Place.closedOn). */
export function placeClosedOn(p: Place, day: string | null | undefined): boolean {
  return day != null && DATE_RE.test(day) && ((p.closedDates ?? []).includes(day) || (p.closedDays ?? []).includes(weekdayOf(day))
    || (!!p.hours?.length && pickHoursRow(p.hours, day) == null));
}

/**
 * [day]의 운영 시각을 입힌 장소 (엔진 Place.onDay): 운영 시간 줄이 있고 그날 맞는 줄이 있으면 그 줄의 여는·닫는·마지막 입장.
 * 줄이 없거나 날짜를 모르면 그대로 (예전 openMin·closeMin). 맞는 줄이 없으면 그대로 두고 placeClosedOn이 뺀다.
 */
export function placeOnDay(p: Place, day: string | null | undefined): Place {
  if (!p.hours?.length || day == null || !DATE_RE.test(day)) return p;
  const r = pickHoursRow(p.hours, day);
  if (!r || (r.openMin === p.openMin && r.closeMin === p.closeMin && r.lastEntryMin === (p.lastEntryMin ?? null))) return p;
  return { ...p, openMin: r.openMin, closeMin: r.closeMin, lastEntryMin: r.lastEntryMin };
}

/** 칩 글: '11/9' (끝나는 날). */
export function festivalEndsText(f: FestivalInfo): string {
  const [, m, d] = f.ends.split("-").map(Number);
  return `${m}/${d}`;
}

/** 귀가 규칙: 정해진 시각 또는 '해 지기 N분 전'. */
export type BackBy = { at: number } | { sunsetMinus: number };

/**
 * 미세먼지 등급 — 에어코리아 1시간 등급(1 좋음 2 보통 3 나쁨 4 매우나쁨) 중 나쁜 쪽 (엔진 AirLevel).
 */
export type AirLevel = "GOOD" | "NORMAL" | "BAD" | "VERY_BAD" | "UNKNOWN";

/** 칩 글 ('미세먼지 나쁨'). */
export const AIR_TEXT: Record<AirLevel, string> = { GOOD: "좋음", NORMAL: "보통", BAD: "나쁨", VERY_BAD: "매우 나쁨", UNKNOWN: "모름" };

export const airIsBad = (air: AirLevel | null | undefined): boolean => air === "BAD" || air === "VERY_BAD";

/** 오늘 하늘. 해 시각을 모르면 null. 비는 그칠 때를 따지지 않는다. */
export type SkyToday = {
  sunriseMin: number | null;
  sunsetMin: number | null;
  sky: Sky;
  rainFromMin: number | null;
  /** 지금 미세먼지 등급 (에어코리아 가까운 측정소). 없으면(null·undefined·UNKNOWN) 추천에 영향 없음. */
  air?: AirLevel | null;
  /** 미세먼지(PM10)·초미세먼지(PM2.5) ㎍/㎥. 화면 표시용. */
  pm10?: number | null;
  pm25?: number | null;
  /** 지금 기온(℃). 저녁 나들이가 쌀쌀한지(COLD_C 이하) 본다 (엔진 SkyToday.tempC). */
  tempC?: number | null;
};

export type FamilyProfile = {
  home: LatLng;
  /** 낮잠 시작·끝. 낮잠이 없으면 둘을 같게(길이 0). */
  napStartMin: number;
  napEndMin: number;
  backBy: BackBy;
  /** 저녁 시각. 오후 짧은 나들이에서만 귀가 한계로 쓴다. null이면 따지지 않음. */
  dinnerMin: number | null;
  kidAges: number[];
  /** 우리 가족 머무름 배율 f (실제 ÷ 조사값의 EMA, 0.6~1.6). 없으면 1.0 (엔진 FamilyProfile.dwellFactor). */
  dwellFactor?: number;
  /** 배율을 배운 횟수. 2번 이상이면 카드 칩 '우리 가족은 보통 1.2배 머물러요'. */
  dwellN?: number;
  /** 장소마다 우리 가족이 실제로 머문 평균(분)·횟수. */
  placeDwell?: Record<string, PlaceDwell>;
  /** 장소마다 같은 또래 가족들의 실제 머무름 P75·가족 수 (서버 집계, 10가족 미만은 안 넣음). */
  crowdDwell?: Record<string, CrowdDwell>;
  /** 오늘만 사람이 정한 머무름(분) — 코스 편집 미리 보기·앵커 코스 (엔진 FamilyProfile.dwellSet, 15~360분·5분 단위). */
  dwellSet?: Record<string, number>;
  /** 우리 가족 방문 기록 (엔진 VisitHistory). 없으면(null) 점수·칩·설명에 영향 없음. */
  history?: VisitHistory | null;
  /** 누구랑 가요? 없으면 kids. 아이와가 아니면 낮잠·아이 규칙을 쓰지 않는다 (엔진 FamilyProfile.companion). */
  companion?: Companion;
  /** 아이 잠자는 시간(분, 기본 21:00) — 아이와 저녁 나들이 귀가 한계 (엔진 FamilyProfile.bedtimeMin). */
  bedtimeMin?: number;
  /** 어른끼리 '늦어도 몇 시 귀가'(분, 기본 23:00) — 어른끼리 낮·저녁 귀가 한계 (엔진 FamilyProfile.lateReturnMin). */
  lateReturnMin?: number;
  /** 밥도 같이 짜기 (엔진 FamilyProfile.meal). 없으면(null) 끔 — 예전과 한 글자도 같음. */
  meal?: MealSetup | null;
};

/**
 * 우리 가족 방문 기록 — 추천 점수 보완과 '왜?' 설명. stamped = 도장 받은 장소 id,
 * lastVisitDays = 장소 id → 마지막으로 다녀온 지 며칠(0 = 오늘), favorites = 즐겨찾는 장소 id.
 */
export type VisitHistory = { stamped: string[]; lastVisitDays: Record<string, number>; favorites: string[] };

// ------------------------------------------------------------------ 머무는 시간 (Model.kt DwellLearning·dwellFor)

export type PlaceDwell = { avg: number; n: number };
export type CrowdDwell = { p75: number; n: number };
/** 머무름 출처: FAMILY = 우리 가족 기록 n번 · CROWD = 같은 또래 n가족 · BASE = 조사값(4살 기준). */
export type DwellSource = "FAMILY" | "CROWD" | "BASE";
/** adult = 어른끼리(조사값이 어른 기준) — 아이와면 칸 없음. */
export type DwellEstimate = { minutes: number; source: DwellSource; n: number; adult?: boolean };
export type DwellStats = { factor: number; n: number; places: Record<string, PlaceDwell> };

export const DwellLearning = {
  ALPHA: 0.3,
  FACTOR_MIN: 0.6,
  FACTOR_MAX: 1.6,
  SAMPLE_MIN: 10,
  RATIO_MIN: 0.3,
  RATIO_MAX: 3.0,
  MIN_MIN: 15,
  MAX_MIN: 360,
  STEP_MIN: 5,
  CHIP_MIN_N: 2,
  CROWD_MIN_N: 10,
  CROWD_K: 10,
  FAMILY_K: 3,
} as const;

const clampNum = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** 가족 설정 '머무는 편' → 배율 씨앗. quick 0.8 · normal 1.0 · long 1.25. */
export function prefFactor(pref: string | null | undefined): number {
  return pref === "quick" ? 0.8 : pref === "long" ? 1.25 : 1.0;
}

/** 5분 단위 반올림 (자바 Math.round와 같게 0.5는 위로). */
export const round5 = (x: number) => Math.round(x / DwellLearning.STEP_MIN) * DwellLearning.STEP_MIN;

/** 사용자가 정한 머무름: 5분 단위, 15~360분. */
export const clampUserDwell = (min: number) => clampNum(round5(min), DwellLearning.MIN_MIN, DwellLearning.MAX_MIN);

/** 아이 나이대: 0-3 · 4-6 · 7-9 · 10+ (막내 기준). */
export function ageBand(ages: number[]): string {
  const a = ages.length ? Math.min(...ages) : 4;
  return a <= 3 ? "0-3" : a <= 6 ? "4-6" : a <= 9 ? "7-9" : "10+";
}

/**
 * 우리 가족 기준 머무는 시간(분)과 출처 — 엔진 FamilyProfile.dwellEstimate와 같은 식.
 *  prior = 조사값, 또래 ≥10가족이면 (n_c·P75 + 10·조사값) ÷ (n_c + 10)
 *  우리 기록 n_p번이면 (n_p·평균 + 3·prior·f) ÷ (n_p + 3), 없으면 prior·f → 5분 단위, 15~360분.
 */
export function dwellEstimate(profile: FamilyProfile, p: Place): DwellEstimate {
  // 식사 자리는 정한 머무름 그대로 (기본 50분 · 카페 30분 — 우리 가족 배율·기록을 안 씀)
  if (isMealPlace(p)) {
    const ms = profile.dwellSet?.[p.id];
    return { minutes: ms != null ? clampUserDwell(ms) : p.dwellP80Min, source: "BASE", n: 0, ...(!isKids(profile) ? { adult: true } : {}) };
  }
  const set = profile.dwellSet?.[p.id];
  if (set != null) return { ...dwellEstimate({ ...profile, dwellSet: undefined }, p), minutes: clampUserDwell(set) };
  const adult = !isKids(profile);
  const tag = adult ? { adult: true } : {};
  const base = adult ? adultDwell(p) : p.dwellP80Min;
  const f = profile.dwellFactor ?? 1.0;
  const ownRaw = profile.placeDwell?.[p.id];
  const own = ownRaw && ownRaw.n >= 1 ? ownRaw : null;
  // 또래(아이 나이대) 값은 아이와 갈 때만
  const crowdRaw = profile.crowdDwell?.[p.id];
  const crowd = crowdRaw && crowdRaw.n >= DwellLearning.CROWD_MIN_N && !adult ? crowdRaw : null;
  if (own == null && crowd == null && f === 1.0) return { minutes: base, source: "BASE", n: 0, ...tag };
  const k = DwellLearning.CROWD_K;
  const prior = crowd != null ? (crowd.n * crowd.p75 + k * base) / (crowd.n + k) : base;
  const w = DwellLearning.FAMILY_K;
  const raw = own != null ? (own.n * own.avg + w * prior * f) / (own.n + w) : prior * f;
  const minutes = clampNum(round5(raw), DwellLearning.MIN_MIN, DwellLearning.MAX_MIN);
  if (own != null) return { minutes, source: "FAMILY", n: own.n, ...tag };
  if (crowd != null) return { minutes, source: "CROWD", n: crowd.n, ...tag };
  return { minutes, source: "BASE", n: 0, ...tag };
}

/** 어른끼리 '늦어도 몇 시 귀가' 기본값 (23:00 — 예전 22:00 고정을 대신함, 엔진 FamilyProfile.DEFAULT_LATE_RETURN_MIN). */
export const DEFAULT_LATE_RETURN_MIN = 23 * 60;
/** 아이 잠자는 시간 기본값 (21:00). */
export const DEFAULT_BEDTIME_MIN = 21 * 60;
/** 어른끼리 귀가 한계 (가족 설정). */
export const lateReturnOf = (p: FamilyProfile) => p.lateReturnMin ?? DEFAULT_LATE_RETURN_MIN;
/** 저녁 나들이 귀가 한계: 아이와 = 잠자는 시간 · 어른끼리 = 늦어도 몇 시 귀가 (엔진 FamilyProfile.eveningLimitMin). */
export const eveningLimitOf = (p: FamilyProfile) => (isKids(p) ? p.bedtimeMin ?? DEFAULT_BEDTIME_MIN : lateReturnOf(p));
/** 어른 머무름 = 4살 기준 조사값 × 이 값 (장소에 어른 값이 없을 때). */
export const ADULT_DWELL_RATIO = 0.8;
/** 어른 기준 머무름: 장소의 어른 값 → 조사값 × 0.8 (5분 단위, 15~360분). */
export function adultDwell(p: Place): number {
  return clampNum(p.adultDwellMin ?? round5(p.dwellP80Min * ADULT_DWELL_RATIO), DwellLearning.MIN_MIN, DwellLearning.MAX_MIN);
}

export const dwellFor = (profile: FamilyProfile, p: Place) => dwellEstimate(profile, p).minutes;

/** 화면 글: '우리 가족 기록 3번' · '같은 또래 가족 23곳 기준' · '조사값(4살 기준)'. */
export function dwellSourceText(e: DwellEstimate): string {
  return e.source === "FAMILY" ? (e.adult ? `우리 기록 ${e.n}번` : `우리 가족 기록 ${e.n}번`)
    : e.source === "CROWD" ? `같은 또래 가족 ${e.n}곳 기준` : e.adult ? "조사값(어른 기준)" : "조사값(4살 기준)";
}

/** 카드 칩 '우리 가족은 보통 1.2배 머물러요' — 2번 넘게 배웠고 배율이 1.0(소수 첫째 자리)이 아닐 때만. */
export function dwellChip(profile: FamilyProfile): string | null {
  if ((profile.dwellN ?? 0) < DwellLearning.CHIP_MIN_N) return null;
  const t = Math.round((profile.dwellFactor ?? 1.0) * 10);
  if (t === 10) return null;
  return `우리 가족은 보통 ${Math.floor(t / 10)}.${t % 10}배 머물러요`;
}

/** 다녀온 곳 하나를 배운다 (엔진 DwellLearning.update). baseMin = 조사값, actualMin = 실제 머문 분. */
export function learnDwell(s: DwellStats, placeId: string, baseMin: number, actualMin: number): DwellStats {
  const L = DwellLearning;
  if (baseMin <= 0 || actualMin < L.SAMPLE_MIN) return s;
  const ratio = clampNum(actualMin / baseMin, L.RATIO_MIN, L.RATIO_MAX);
  const f = clampNum((1 - L.ALPHA) * s.factor + L.ALPHA * ratio, L.FACTOR_MIN, L.FACTOR_MAX);
  const factor = Math.round(f * 100) / 100;
  const old = s.places[placeId];
  const pd = old == null ? { avg: actualMin, n: 1 } : { avg: Math.round((old.avg * old.n + actualMin) / (old.n + 1)), n: old.n + 1 };
  return { factor, n: s.n + 1, places: { ...s.places, [placeId]: pd } };
}

/** 해 시각을 모를 때 '해 지기 N분 전' 귀가 대신 쓰는 시각 (17:30). */
export const FALLBACK_BACK_BY_MIN = 17 * 60 + 30;

/** 엔진 FamilyProfile 기본값과 같다: 아이 4·4살, 낮잠 13:00~14:30, 해 지기 30분 전 귀가, 저녁 18:30. */
export function defaultProfile(home: LatLng): FamilyProfile {
  return { home, napStartMin: 13 * 60, napEndMin: 14 * 60 + 30, backBy: { sunsetMinus: 30 }, dinnerMin: 18 * 60 + 30, kidAges: [4, 4] };
}

/** 낮잠 길이. 어른끼리 가면 늘 0 (엔진 FamilyProfile.napLengthMin). */
const napLength = (p: FamilyProfile) => (isKids(p) ? p.napEndMin - p.napStartMin : 0);
const hasNap = (p: FamilyProfile) => napLength(p) > 0;

/** 귀가 규칙을 오늘 시각으로. 해 시각을 모르면 고정 시각 또는 17:30. */
export function backByMin(p: FamilyProfile, sky: SkyToday | null): number {
  if (!isKids(p)) return lateReturnOf(p);
  if ("at" in p.backBy) return p.backBy.at;
  return sky?.sunsetMin != null ? sky.sunsetMin - p.backBy.sunsetMinus : FALLBACK_BACK_BY_MIN;
}

/** "08:30" → 510. */
export function hhmm(text: string): number {
  const [h, m] = text.trim().split(":").map((s) => Number.parseInt(s, 10));
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) throw new Error(`시각 형식은 HH:MM: ${text}`);
  return h * 60 + m;
}

/** 분 → "HH:MM". 자정을 넘기면 다음 날 시각으로 (예: 30:26 → 06:26). */
export function asHhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const EARTH_KM = 6371.0088;
/** 자바 Math.toRadians와 같은 상수. */
const rad = (d: number) => d * 0.017453292519943295;

/** 두 점 사이 직선거리(km, haversine). */
export function km(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// ------------------------------------------------------------------ 규칙 (Rules.kt)

/** 이동시간 근사: 직선거리 × 도로계수 ÷ 평균속도. */
export const TravelTime = {
  ROAD_FACTOR: 1.3,
  AVG_KMH: 50.0,
  roadKm: (a: LatLng, b: LatLng) => km(a, b) * TravelTime.ROAD_FACTOR,
  /** 코틀린 roundToInt와 같은 반올림(0.5는 위로). */
  minutes: (a: LatLng, b: LatLng) => Math.round((TravelTime.roadKm(a, b) / TravelTime.AVG_KMH) * 60),
};

export const TimeBudget = {
  SAFETY_MIN: 10,
  /** B = 귀가 목표 − 지금 − 집까지 − 안전 10분 */
  availableMin: (nowMin: number, backBy: number, toHomeMin: number) => backBy - nowMin - toHomeMin - TimeBudget.SAFETY_MIN,
  /** Δ = τ(지금→후보) + τ(후보→집) − τ(지금→집) */
  detourMin: (toCand: number, candToHome: number, toHome: number) => toCand + candToHome - toHome,
  fits: (detour: number, dwell: number, budget: number) => detour + dwell <= budget,
  /** 낮잠 맞춤: 낮잠 20분 전~10분 후 사이에 출발하고, 이동이 낮잠 길이의 0.7~1.1배. */
  napAligned(departMin: number, travelMin: number, p: FamilyProfile): boolean {
    if (!hasNap(p)) return false;
    const len = napLength(p);
    const departOk = departMin >= p.napStartMin - 20 && departMin <= p.napStartMin + 10;
    const travelOk = travelMin >= 0.7 * len && travelMin <= 1.1 * len;
    return departOk && travelOk;
  },
};

// ------------------------------------------------------------------ 계산 결과

/** MORNING = 14시 전 첫 탑승(하루 코스), AFTERNOON = 14시 이후(짧은 나들이), REBOARD = 내렸다 다시 탐. */
export type PlanMode = "MORNING" | "AFTERNOON" | "REBOARD";
export type OptionKind = "COURSE" | "NEARBY" | "HOMEWARD" | "GO_HOME";
/**
 * 하루 막대의 칸 종류. HOME = 집으로 가는 마지막 이동 (그 이동에서 낮잠을 자면 NAP_DRIVE). MEAL = 식당에서 밥 (엔진 LegKind.MEAL).
 * 밖으로 내보내는 JSON에는 옛 앱 때문에 MEAL을 "STAY" + meal: true 로 싣는다 (legJson·legOfJson).
 */
export type LegKind = "DRIVE" | "STAY" | "NAP_DRIVE" | "HOME" | "MEAL";
/** 이유 칩 색: 보통 · 해 · 낮잠 · 도장 · 비 · 축제 · 미세먼지(나쁨 이상) · 식사. */
export type Tone = "PLAIN" | "SUN" | "NAP" | "STAMP" | "RAIN" | "FESTIVAL" | "AIR" | "MEAL";
/** 머무는 칸 (STAY 또는 MEAL, 엔진 Leg.isStay). */
export const isStayLeg = (l: { kind: string }): boolean => l.kind === "STAY" || l.kind === "MEAL";
/** 응답·저장 JSON 모양 칸 (MEAL → "STAY" + meal: true). */
export type LegJson = { kind: Exclude<LegKind, "MEAL">; fromMin: number; toMin: number; placeId: string | null; meal?: true };
export function legJson(l: Leg): LegJson {
  return l.kind === "MEAL"
    ? { kind: "STAY", fromMin: l.fromMin, toMin: l.toMin, placeId: l.placeId, meal: true }
    : { kind: l.kind, fromMin: l.fromMin, toMin: l.toMin, placeId: l.placeId };
}
/** JSON 칸 → 엔진 칸 ("STAY" + meal: true → MEAL, 예전 MEAL 그대로도). */
export function legOfJson(j: { kind: string; fromMin: number; toMin: number; placeId?: string | null; meal?: unknown }): Leg {
  const kind = (j.kind === "STAY" && j.meal === true ? "MEAL" : j.kind) as LegKind;
  return { kind, fromMin: j.fromMin, toMin: j.toMin, placeId: j.placeId ?? null };
}

/** 하루 막대의 한 칸. placeId는 이동이면 도착할 곳, 머무름이면 그곳. 집으로 가는 이동은 null. */
export type Leg = { kind: LegKind; fromMin: number; toMin: number; placeId: string | null };
export type Reason = { text: string; tone: Tone };

export type PlanOption = {
  kind: OptionKind;
  stops: Place[];
  /** 지금 위치에서 첫 정차지(바로 귀가면 집)까지 분. */
  firstLegMin: number;
  /** 우회 분. 한 곳 들르기(재탑승·오후)만. */
  detourMin: number | null;
  arriveHomeMin: number;
  legs: Leg[];
  reasons: Reason[];
  /** 카드 제목 위 작은 글. */
  label: string;
  /** 귀가 한계(안전 여유 포함)를 넘는 카드 — 앵커 코스의 '여기만'·미리 보기 (엔진 PlanOption.overLimit). 없으면 false. */
  overLimit?: boolean;
  /** 넣은 밥 자리 (엔진 PlanOption.meal) — stops·legs에도 들어 있다. */
  meal?: MealStop | null;
  /** 밥 자리를 못 넣은 까닭 (엔진 PlanOption.mealHint). */
  mealHint?: string | null;
};

export type Plan = {
  mode: PlanMode;
  nowMin: number;
  /** 여유 = 귀가 한계 − 지금 − 집까지 − 10분. 음수면 0. */
  budgetMin: number;
  /** 귀가 한계. */
  backByMin: number;
  options: PlanOption[];
  sky: SkyToday | null;
  /** 저녁 나들이 카드가 들어 있음 (엔진 Plan.evening). mode는 차 앱 때문에 AFTERNOON 그대로. */
  evening?: boolean;
  /** 해가 이미 졌을 때 '내일 노을 보러' 안내 (엔진 Plan.sunsetTip). */
  sunsetTip?: SunsetTip | null;
};

/** '해 질 녘 전망 · 내일 추천' (엔진 SunsetTip). sunsetMin = 오늘 해 지는 시각, arriveByMin = 그 20분 전 도착. */
export type SunsetTip = { placeId: string; placeName: string; sunsetMin: number; arriveByMin: number };

const legMinutes = (l: Leg) => l.toMin - l.fromMin;

// ------------------------------------------------------------------ 상수 (Planner.kt와 같음)

export const AFTERNOON_FROM_MIN = 14 * 60;
const HOMEWARD_DETOUR_MAX_MIN = 15;
/** 하루 코스 최대 장소 수. */
export const MAX_STOPS = 3;
export const AWAKE_DRIVE_MAX_MIN = 60;
export const MIN_VISIT_MIN = 30;
export const MAX_WAIT_MIN = 30;
export const NAP_STRETCH_MAX_MIN = 60;
export const NAP_DEPART_BEFORE_MIN = 10;
const POPULAR_MIN = 10;
/** '가깝게' 코스: 모든 장소가 집(또는 출발지)에서 이 분 안 + 어느 이동도 이 분 이하. */
const NEAR_MAX_MIN = 30;
/** 낮잠이 없는 가족의 '점심 전 귀가' 기준 (13시). */
const LUNCH_MIN = 13 * 60;
const LATE_SLACK_MIN = 30;
export const RAIN_SOON_MIN = 180;
const SUN_CHIP_MAX_MIN = 120;
const AT_HOME_M = 300;
/** 미세먼지 나쁨: 야외 한 곳마다 감점 · 매우 나쁨: 더 세게 · 나쁨 이상: 실내 가점. */
export const AIR_BAD_OUTDOOR = 2.0;
export const AIR_VERY_BAD_OUTDOOR = 4.0;
export const AIR_INDOOR_BONUS = 1.0;
/** 방문 기록 점수 (엔진 Planner.HISTORY_*): 이미 도장 −1 · 안 가 본 곳 +0.5 · 최근 14일 −2 · 즐겨찾기 +1. */
export const HISTORY_STAMPED = -1.0;
export const HISTORY_NEW = 0.5;
export const HISTORY_RECENT = -2.0;
export const RECENT_DAYS = 14;
export const HISTORY_FAVORITE = 1.0;
/** 앵커 코스 (엔진 Planner.ANCHOR_*). */
export const ANCHOR_FESTIVAL_DWELL_MIN = 120;
export const ANCHOR_ON_WAY_MAX_MIN = 20;
export const ANCHOR_NEAR_MAX_MIN = 20;
export const ANCHOR_WAIT_MAX_MIN = 120;
export const OVERNIGHT_MIN = 180;

// 동행 (누구랑 가요?) — 아이와가 아닐 때만 (엔진 Planner와 같음)
export const ADULT_DRIVE_MAX_MIN = 90;
export const DARK_FALLBACK_MIN = 18 * 60;
export const TAG_NIGHT_BONUS = 1.0;
export const TAG_BONUS = 0.5;
export const FRIENDS_FESTIVAL_BONUS = 0.5;
export const DARK_OUTDOOR_MINUS = 0.5;
export const TAG_NIGHT = "야경";
/** 동행마다 가점 받는 표시 (앞에 있을수록 '왜?' 글에 먼저). 야경은 연인·부부가 해 진 뒤만 따로. */
export const COMPANION_TAGS: Partial<Record<Companion, string[]>> = {
  couple: ["데이트", "카페", "산책", "드라이브"],
  friends: ["액티비티", "체험", "드라이브"],
  solo: ["조용함", "전시", "산책"],
};
/** 관리자 화면 표시 고르기 목록. */
export const COMPANION_TAG_CHOICES = ["야경", "카페", "데이트", "체험", "산책", "전시", "드라이브", "액티비티", "조용함"] as const;

// 저녁 나들이 (엔진 Planner.EVENING_* 와 같음)
export const EVENING_PREP_MIN = 90;
export const EVENING_WAIT_MAX_MIN = 40;
export const EVENING_KIDS_OUTING_MAX_MIN = 120;
export const EVENING_ADULT_OUTING_MAX_MIN = 180;
export const EVENING_DWELL_MIN = 30;
export const EVENING_KIDS_DWELL_MAX = 60;
export const EVENING_ADULT_DWELL_MAX = 90;
export const EVENING_COLD_OUTDOOR_MAX = 40;
export const EVENING_KIDS_DRIVE_MAX = 40;
export const EVENING_ADULT_DRIVE_MAX = 60;
export const COLD_C = 5;
export const SHOW_BEFORE_MIN = 10;
export const SUNSET_BEFORE_MIN = 20;
export const EVENING_APPEND_FROM_MIN = 120;
export const EVENING_FIT_GUESS = 0.6;
/** 저녁 카드 제목 머리. 폰·차는 pick(evening·drive)으로 고른다. */
export const EVENING_PREFIX = "저녁 · ";
export const LABEL_DRIVE = "저녁 · 야경 드라이브";
export const LABEL_SUNSET = "노을 전망";

// ------------------------------------------------------------------ 진입점

/**
 * 오늘 첫 탑승: 14시 전이면 하루 코스, 이후면 짧은 나들이.
 * day = 오늘 날짜 'YYYY-MM-DD' (축제 기간 판단). 모르면 축제는 후보에서 빠진다.
 * maxStops = 코스 한 장에 넣을 곳 수 한도 1~3 (폰 '가볍게 한 곳만' = 1). 오후는 늘 한 곳.
 */
export function firstBoarding(
  nowMin: number, here: LatLng, profile: FamilyProfile, candidates: Place[], sky: SkyToday | null, day: string | null = null,
  maxStops: number = MAX_STOPS,
): Plan {
  if (isEvening(nowMin, profile, sky)) return evening(nowMin, here, profile, candidates, sky, day);
  if (nowMin >= darkMin(sky) && nowMin > eveningEndMin(profile)) return lateNight(nowMin, here, profile, candidates, sky, day);
  return nowMin < AFTERNOON_FROM_MIN
    ? morning(nowMin, here, profile, candidates, sky, day, maxStops)
    : afternoon(nowMin, here, profile, candidates, sky, day);
}

/**
 * [day]의 후보: 그날 쉬는 곳(쉬는 요일·임시 휴무)은 빼고, 축제는 그날 열릴 때만(기간 안 + 쉬는 요일 아님),
 * 열리는 축제가 붙은 명소는 빼고 축제가 대신한다. 운영 시간 줄이 있는 곳은 그날 시각을 입힌다(placeOnDay).
 * 하루 운영 시각은 시간표(문 여는·닫는 시각·마지막 입장)가 따진다.
 */
export function forDay(all: Place[], day: string | null | undefined): Place[] {
  const candidates = all.map((p) => placeOnDay(p, day));
  const replaced = new Set<string>();
  for (const p of candidates) if (p.festival && festivalRunsOn(p.festival, day) && p.festival.placeId) replaced.add(p.festival.placeId);
  return candidates.filter((p) => !placeClosedOn(p, day) && (p.festival ? festivalRunsOn(p.festival, day) : !replaced.has(p.id)));
}

/** 축제 칩: '이번 주말만 · 11/9까지'. */
export function festivalReason(f: FestivalInfo): Reason {
  return { text: `이번 주말만 · ${festivalEndsText(f)}까지`, tone: "FESTIVAL" };
}

/** 귀가 한계. 오후 모드만 저녁 시각과 비교. */
export function limitMin(mode: PlanMode, profile: FamilyProfile, sky: SkyToday | null): number {
  const back = backByMin(profile, sky);
  const dinner = profile.dinnerMin;
  return mode === "AFTERNOON" && dinner != null && isKids(profile) ? Math.min(back, dinner) : back;
}

/** 해 진 뒤로 치는 시각: 해 지는 시각, 모르면 18:00. */
export function darkMin(sky: SkyToday | null | undefined): number {
  return sky?.sunsetMin ?? DARK_FALLBACK_MIN;
}

const hasTag = (p: Place, t: string) => (p.tags ?? []).includes(t);

/** 동행 점수 (엔진 Planner.fitScore). 아이와 = 아이 적합×2. stay = 그곳에 머무는 칸. */
export function fitScore(p: Place, stay: Leg | null | undefined, profile: FamilyProfile, sky: SkyToday | null | undefined): number {
  const c = companionOf(profile);
  if (c === "kids") return 2.0 * p.kidFit;
  let s = 2.0 * fitFor(p, c);
  const dark = stay != null && stay.toMin > darkMin(sky);
  const night = hasTag(p, TAG_NIGHT);
  if (c === "couple" && night && dark) s += TAG_NIGHT_BONUS;
  if ((COMPANION_TAGS[c] ?? []).some((t) => hasTag(p, t))) s += TAG_BONUS;
  if (c === "friends" && p.festival) s += FRIENDS_FESTIVAL_BONUS;
  if (dark && !p.indoor && !night) s -= DARK_OUTDOOR_MINUS;
  return s;
}

/**
 * 밤이라 오늘은 더 갈 곳이 없음 → 폰 '내일 계획 짜기' (엔진 Planner.isNight). 저녁 나들이 시간이 끝난 뒤:
 * 아이와 = (귀가 한계나 해 진 뒤) + 잠자는 시간 90분 전 지남, 어른끼리 = 늦어도 몇 시 귀가 90분 전 지남.
 */
export function isNight(nowMin: number, profile: FamilyProfile, sky: SkyToday | null | undefined): boolean {
  const over = nowMin > eveningEndMin(profile);
  if (!isKids(profile)) return over;
  return over && (nowMin >= backByMin(profile, sky ?? null) || (sky?.sunsetMin != null && nowMin >= sky.sunsetMin));
}

/** 저녁 나들이를 권하는 마지막 시각: 귀가 한계 − 90분 (엔진 Planner.eveningEndMin). */
export function eveningEndMin(profile: FamilyProfile): number {
  return eveningLimitOf(profile) - EVENING_PREP_MIN;
}

/** 저녁 모드: 해 진 뒤(모르면 18:00) ~ 귀가 한계 90분 전 (엔진 Planner.isEvening). */
export function isEvening(nowMin: number, profile: FamilyProfile, sky: SkyToday | null | undefined): boolean {
  return nowMin >= darkMin(sky) && nowMin <= eveningEndMin(profile);
}

/** 카드 성격 (엔진 Planner.pickOf): short · full · nap · indoor · popular · near · home. */
export type OptionPick = "short" | "full" | "nap" | "indoor" | "popular" | "near" | "home" | "evening" | "drive";
export function pickOf(o: PlanOption): OptionPick {
  if (o.kind === "GO_HOME") return "home";
  if (o.label.startsWith(LABEL_DRIVE)) return "drive";
  if (o.label.startsWith(EVENING_PREFIX) || o.label.startsWith(LABEL_SUNSET)) return "evening";
  if (o.label.startsWith("짧게") || o.label.startsWith("가볍게")) return "short";
  if (o.label.startsWith("가깝게")) return "near";
  if (o.label.startsWith("요즘 많이")) return "popular";
  if (o.label.startsWith("실내")) return "indoor";
  if (o.legs.some((l) => l.kind === "NAP_DRIVE")) return "nap";
  if (o.stops.filter((p) => !isMealPlace(p)).length >= 2) return "full";
  if (o.kind === "NEARBY") return "near";
  return "short";
}

/** 미세먼지 점수: 나쁨 이상이면 실내 +1, 야외 −2(나쁨)·−4(매우 나쁨). 좋음·보통·모름은 0. */
export function airScore(p: Place, air: AirLevel | null | undefined): number {
  if (air === "BAD") return p.indoor ? AIR_INDOOR_BONUS : -AIR_BAD_OUTDOOR;
  if (air === "VERY_BAD") return p.indoor ? AIR_INDOOR_BONUS : -AIR_VERY_BAD_OUTDOOR;
  return 0.0;
}

/** 방문 기록 점수 (엔진 Planner.historyScore). 기록을 모르면 0. */
export function historyScore(p: Place, h: VisitHistory | null | undefined): number {
  if (h == null) return 0.0;
  let s = 0.0;
  const stamped = h.stamped.includes(p.id);
  const days = h.lastVisitDays[p.id];
  if (stamped && p.stampable) s += HISTORY_STAMPED;
  if (!stamped && days == null) s += HISTORY_NEW;
  if (days != null && days < RECENT_DAYS) s += HISTORY_RECENT;
  if (h.favorites.includes(p.id)) s += HISTORY_FAVORITE;
  return s;
}

/** 이 장소에서 새 도장을 받나: 도장 그림이 있고, 기록을 알면 아직 안 받은 곳만. */
export function newStamp(p: Place, h: VisitHistory | null | undefined): boolean {
  return p.stampable && (h == null || !h.stamped.includes(p.id));
}

/** 미세먼지 칩: '미세먼지 나쁨 → 실내' (나쁨 이상일 때만, 아니면 null). */
export function airReason(sky: SkyToday | null | undefined): Reason | null {
  const air = sky?.air;
  return air && airIsBad(air) ? { text: `미세먼지 ${AIR_TEXT[air]} → 실내`, tone: "AIR" } : null;
}

/** 비가 시작되는 시각. 지금 오고 있으면 지금. 비 소식이 없으면 null. */
export function rainStartMin(sky: SkyToday | null, nowMin: number): number | null {
  if (sky == null) return null;
  if (sky.sky === "RAIN") return nowMin;
  return sky.rainFromMin;
}

// ------------------------------------------------------------------ 하루 코스

/** 장소들을 차례로 돌아본 상태 (집으로 가는 이동 전). */
type Walk = { legs: Leg[]; t: number; at: LatLng; firstLeg: number | null; awake: number; napLeg: Leg | null; wait: number };
/** 집 도착까지 끝난 시간표. */
type Built = { legs: Leg[]; firstLeg: number; arriveHome: number; awakeDriveMin: number; napLeg: Leg | null; napScore: number; waitMin: number };
type Scored = { stops: Place[]; built: Built; score: number; key: string };

const scored = (stops: Place[], built: Built, score: number): Scored => ({ stops, built, score, key: stops.map((p) => p.id).join(",") });

/** 코틀린 String.compareTo와 같은 글자 순 (UTF-16 코드 단위). */
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cmpNum = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

/** 점수 높은 순 → 귀가 이른 순 → 장소 id 글자 순. */
const ORDER = (a: Scored, b: Scored) => cmpNum(b.score, a.score) || cmpNum(a.built.arriveHome, b.built.arriveHome) || cmpStr(a.key, b.key);
/** 귀가 이른 순 → 점수 높은 순 → 장소 id 글자 순. */
const EARLY_ORDER = (a: Scored, b: Scored) => cmpNum(a.built.arriveHome, b.built.arriveHome) || cmpNum(b.score, a.score) || cmpStr(a.key, b.key);

/**
 * 아침 하루 코스: 후보에서 1~3곳을 순서대로 고르는 모든 경우를 따져(시간 넘으면 가지치기)
 * 서로 다른 3장을 고른다 — 1순위 / 가깝게(isNear: 모든 장소가 집·출발지에서 30분 안, 어느 이동도 30분 이하.
 * 그런 코스가 없으면 다음으로 좋은 다른 코스를 '2순위 · 하루 코스'로) / 요즘 많이 가요
 * (자료 없으면: 비 소식이 있고 1순위에 야외가 있으면 '실내 대안', 아니면 낮잠 전에 집에 오는 '짧게').
 */
export function morning(
  nowMin: number, here: LatLng, profile: FamilyProfile, all: Place[], sky: SkyToday | null, day: string | null = null, maxStops: number = MAX_STOPS,
): Plan {
  const candidates = forDay(all, day);
  const depth = clampNum(Math.trunc(maxStops), 1, MAX_STOPS);
  const limit = limitMin("MORNING", profile, sky);
  const toHome = TravelTime.minutes(here, profile.home);
  const budget = TimeBudget.availableMin(nowMin, limit, toHome);
  const safe = limit - TimeBudget.SAFETY_MIN;
  const rain = rainStartMin(sky, nowMin);

  const courses: Scored[] = [];
  const search = (seq: Place[]) => {
    if (seq.length > 0) {
      // 가지치기: 가장 이른 시간표로도 마지막 장소에서 집까지 한계를 넘으면 더 붙여도 소용없다
      const reach = walk(nowMin, here, seq, profile, rain, true, false);
      if (reach == null) return;
      if (reach.t + TravelTime.minutes(reach.at, profile.home) > safe) return;
      const plain = finish(reach, profile);
      const sw = walk(nowMin, here, seq, profile, rain, true, true);
      const stretched = sw ? finish(sw, profile) : null;
      const best = [plain, stretched]
        .filter((b): b is Built => b != null)
        .filter((b) => b.arriveHome <= safe)
        .map((b) => scored(seq, b, courseScore(seq, b, safe, sky, profile)))
        .sort(ORDER)[0];
      if (best) courses.push(best);
    }
    if (seq.length === depth) return;
    for (const p of candidates) if (!seq.some((s) => s.id === p.id)) search([...seq, p]);
  };
  search([]);
  courses.sort(ORDER);

  const ctx: Ctx = { now: nowMin, here, profile, sky, rain, limit };
  if (courses.length === 0) {
    return { mode: "MORNING", nowMin, budgetMin: Math.max(0, budget), backByMin: limit, options: [goHome(toHome, ctx, candidates.length === 0, true)], sky };
  }

  const picked: [Scored, string][] = [];
  const best = courses[0];
  picked.push([best, "1순위 · 하루 코스"]);
  const pickedCourses = () => picked.map((x) => x[0]);

  const near = diverse(courses, pickedCourses(), (c) => isNear(c, ctx));
  if (near) {
    const dry = rain != null && near.stops.every((p) => p.indoor);
    picked.push([near, dry ? "가깝게 · 비 걱정 없이" : "가깝게"]);
  } else {
    // 가까운 코스가 없으면 '가깝게'라고 부르지 않고 다음으로 좋은 다른 코스
    const next = diverse(courses, pickedCourses(), () => true);
    if (next) picked.push([next, "2순위 · 하루 코스"]);
  }

  let maxPop = 0;
  {
    // 코스×곳이 수십만 개가 될 수 있어 펼쳐 넣기(Math.max(...))는 호출 스택을 넘는다 → 하나씩
    for (const c of courses) for (const p of c.stops) if (p.popular > maxPop) maxPop = p.popular;
  }
  let popular: [Scored, string] | null = null;
  if (maxPop >= POPULAR_MIN) {
    const c = diverse(courses, pickedCourses(), (c) => c.stops.some((p) => p.popular === maxPop));
    if (c) popular = [c, "요즘 많이 가요"];
  }
  let indoorAlt: [Scored, string] | null = null;
  if (popular == null && (rain != null || airIsBad(sky?.air)) && best.stops.some((p) => !p.indoor)) {
    const c = diverse(courses, pickedCourses(), (c) => c.stops.every((p) => p.indoor));
    if (c) indoorAlt = [c, "실내 대안"];
  }
  // 짧게: 낮잠 전(낮잠 없으면 13시 전)에 집에 오는 코스 중 최고, 없으면 가장 일찍 오는 코스.
  // 어른끼리 '가볍게'는 한 곳짜리만 (폰 '가볍게 한 곳만'과 같은 뜻) — 한 곳짜리가 없으면 '일찍 귀가'로 부른다
  const kids = isKids(profile);
  const light = (c: Scored) => kids || c.stops.length === 1;
  const shortBy = hasNap(profile) ? profile.napStartMin : LUNCH_MIN;
  const shortC = diverse(courses, pickedCourses(), (c) => c.built.arriveHome <= shortBy && light(c));
  const short: [Scored, string] | null = shortC
    ? [shortC, !kids ? "가볍게 · 반나절" : hasNap(profile) ? "짧게 · 낮잠은 집에서" : "짧게 · 점심 전 귀가"] : null;
  let third = popular ?? indoorAlt ?? short;
  if (third == null) {
    const early = [...courses].sort(EARLY_ORDER);
    const c = diverse(early, pickedCourses(), light);
    if (c) third = [c, kids ? "짧게 · 일찍 귀가" : "가볍게 · 일찍 귀가"];
    else {
      const any = diverse(early, pickedCourses(), () => true);
      if (any) third = [any, "일찍 귀가"];
    }
  }
  if (third) picked.push(third);

  const options = picked.map(([c, label]): PlanOption => {
    const m = mealize(c.stops, c.built, ctx);
    return {
      kind: "COURSE", stops: m.stops, firstLegMin: m.built.firstLeg, detourMin: null, arriveHomeMin: m.built.arriveHome,
      legs: m.built.legs, reasons: withMeal(courseReasons(scored(c.stops, m.built, c.score), ctx), m), label, ...mealFields(m),
    };
  });
  return { mode: "MORNING", nowMin, budgetMin: Math.max(0, budget), backByMin: limit, options, sky };
}

/**
 * 이미 정한 순서(폰에서 고른 코스·시연 코스)의 시간표와 이유 칩. 규칙에 안 맞으면(문 닫음·시간 넘김 등) null.
 * 낮잠 맞추려고 더 머무는 시간표가 되면 그쪽을 쓴다.
 */
export function course(
  nowMin: number, here: LatLng, profile: FamilyProfile, stops: Place[], sky: SkyToday | null, label = "고른 코스",
  opts: { mode?: PlanMode; lenient?: boolean; anchorId?: string | null } = {},
): PlanOption | null {
  if (stops.length === 0) return null;
  const limit = limitMin(opts.mode ?? "MORNING", profile, sky);
  const safe = limit - TimeBudget.SAFETY_MIN;
  const rain = rainStartMin(sky, nowMin);
  // 앵커 코스: 그 장소는 긴 이동·긴 문 열기 기다림·비를 봐준다 (엔진 Planner.course anchorId)
  const anchor = opts.anchorId ? stops.find((p) => p.id === opts.anchorId) : undefined;
  const wo = anchor ? anchorOpts(anchor, here, profile) : DEFAULT_WALK;
  // 앵커 코스는 낮잠에 맞춰 머무름을 늘리지 않는다 (anchored와 같은 시간표)
  const built = (anchor ? [false] : [false, true])
    .map((stretch) => {
      const w = walk(nowMin, here, stops, profile, rain, true, stretch, wo);
      return w ? finish(w, profile, wo) : null;
    })
    .filter((b): b is Built => b != null);
  // lenient(코스 편집 미리 보기): 귀가 한계를 넘어도 시간표는 돌려준다 — 넘는지는 부르는 쪽이 본다
  const fit = built.filter((b) => b.arriveHome <= safe);
  const best = (fit.length || !opts.lenient ? fit : built)
    .map((b) => scored(stops, b, courseScore(stops, b, safe, sky, profile)))
    .sort(ORDER)[0];
  if (!best) return null;
  const ctx: Ctx = { now: nowMin, here, profile, sky, rain, limit };
  const m = mealize(stops, best.built, ctx);
  const b = m.built;
  return {
    kind: "COURSE", stops: m.stops, firstLegMin: b.firstLeg, detourMin: null, arriveHomeMin: b.arriveHome, legs: b.legs,
    reasons: withMeal(courseReasons(scored(stops, b, best.score), ctx), m), label, overLimit: b.arriveHome > safe, ...mealFields(m),
  };
}

/** 가까운 코스: 모든 장소가 집 또는 출발지에서 30분 안 + 어느 이동(집으로 가는 것까지)도 30분 이하. */
function isNear(c: Scored, ctx: Ctx): boolean {
  return (
    c.built.legs.every((l) => isStayLeg(l) || legMinutes(l) <= NEAR_MAX_MIN) &&
    c.stops.every((p) => Math.min(TravelTime.minutes(ctx.profile.home, p.at), TravelTime.minutes(ctx.here, p.at)) <= NEAR_MAX_MIN)
  );
}

function courseScore(stops: Place[], b: Built, safe: number, sky: SkyToday | null | undefined, profile: FamilyProfile): number {
  const air = sky?.air;
  const hist = profile.history;
  let s = 0.0;
  for (const p of stops) {
    s += fitScore(p, b.legs.find((l) => l.kind === "STAY" && l.placeId === p.id), profile, sky);
    if (p.stampable) s += 1.0;
    if (p.popular >= POPULAR_MIN) s += 0.5;
    if (p.festival) s += p.festival.weight;
    s += airScore(p, air);
    s += historyScore(p, hist);
  }
  s -= (b.awakeDriveMin + b.waitMin) / 60.0;
  if (b.napLeg) s += b.napScore;
  const slack = safe - b.arriveHome;
  if (slack < LATE_SLACK_MIN) s -= (LATE_SLACK_MIN - slack) / LATE_SLACK_MIN;
  return s;
}

/**
 * 앞에서 고른 카드와 다른 코스 중 [ok]를 만족하는 첫 코스.
 * 1단계: 장소가 하나도 안 겹침 → 2단계: 첫 장소가 다르고 장소 묶음도 다름 → 3단계: 순서까지 같은 것만 아니면.
 */
function diverse(pool: Scored[], picked: Scored[], ok: (c: Scored) => boolean): Scored | null {
  const ids = picked.map((c) => c.stops.map((p) => p.id));
  const sameSet = (a: string[], b: string[]) => {
    const sa = new Set(a);
    const sb = new Set(b);
    return sa.size === sb.size && [...sa].every((x) => sb.has(x));
  };
  const tiers: ((s: string[]) => boolean)[] = [
    (s) => ids.every((p) => !s.some((x) => p.includes(x))),
    (s) => ids.every((p) => s[0] !== p[0] && !sameSet(s, p)),
    (s) => ids.every((p) => s.length !== p.length || s.some((x, i) => x !== p[i])),
  ];
  for (const tier of tiers) {
    const hit = pool.find((c) => ok(c) && tier(c.stops.map((p) => p.id)));
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------------ 한 곳 들르기 (오후·재탑승)

type Cand = { p: Place; built: Built; detour: number; score: number; wet: boolean };
type Singles = { ranked: Cand[]; ctx: Ctx; toHome: number; budget: number; limit: number };

/**
 * 오후 짧은 나들이 (14시 이후 첫 탑승): 재탑승과 같은 틀, 귀가 한계 = min(귀가 규칙, 저녁 시각).
 * 3장: 귀갓길(우회 ≤ 15분) 최고 · 그 밖의 근처 최고 (둘은 점수순) + 바로 집으로.
 */
export function afternoon(nowMin: number, here: LatLng, profile: FamilyProfile, all: Place[], sky: SkyToday | null, day: string | null = null): Plan {
  const candidates = forDay(all, day);
  const r = rankSingles("AFTERNOON", nowMin, here, profile, candidates, sky);
  const homeward = r.ranked.find((c) => c.detour <= HOMEWARD_DETOUR_MAX_MIN) ?? null;
  // 해 지기 전: 노을 명소에서 해 지는 때를 보는 곳이 있으면 그 카드는 '노을 전망' (귀갓길이 아니면 '근처' 자리에)
  const sunsetPick = r.ranked.find((c) => sunsetCover(c.p, c.built.legs, sky)) ?? null;
  const nearby = (sunsetPick && sunsetPick !== homeward ? sunsetPick : null) ?? r.ranked.find((c) => c !== homeward) ?? null;
  const picks = r.ranked.filter((c) => c === homeward || c === nearby);
  const options = picks.map((c) => single(c, r.ctx, c === sunsetPick ? LABEL_SUNSET : c === homeward ? "집 가는 길에 잠깐" : "근처에서 놀다 가요"));
  // 늦은 오후에 낮 카드가 하나도 없으면 저녁 카드를 붙인다 (저녁 귀가 한계 기준)
  if (r.ranked.length === 0 && nowMin >= darkMin(sky) - EVENING_APPEND_FROM_MIN && nowMin <= eveningEndMin(profile)) {
    const ev = evening(nowMin, here, profile, all, sky, day);
    if (ev.evening) return ev;
  }
  options.push(goHome(r.toHome, r.ctx, candidates.length === 0, r.ranked.length === 0));
  return { mode: "AFTERNOON", nowMin, budgetMin: Math.max(0, r.budget), backByMin: r.limit, options, sky };
}

/** 저녁 나들이 시간도 지난 밤: '바로 집으로' 한 장 (엔진 Planner.lateNight) — 폰은 '내일 미리'. */
export function lateNight(nowMin: number, here: LatLng, profile: FamilyProfile, all: Place[], sky: SkyToday | null, day: string | null = null): Plan {
  const limit = eveningLimitOf(profile);
  const toHome = TravelTime.minutes(here, profile.home);
  const ctx: Ctx = { now: nowMin, here, profile, sky, rain: rainStartMin(sky, nowMin), limit };
  const home = goHome(toHome, ctx, forDay(all, day).length === 0, true);
  // 여유는 0 (더 갈 곳이 없는 밤)
  return { mode: "AFTERNOON", nowMin, budgetMin: 0, backByMin: limit, options: [home], sky };
}

/** 노을 명소에서 해 지는 때를 본다: 해 지기 10분 전까지 도착하고 해 진 뒤까지 머묾 (엔진 sunsetCover). */
function sunsetCover(p: Place, legs: Leg[], sky: SkyToday | null | undefined): boolean {
  const sunset = sky?.sunsetMin;
  if (sunset == null || !sunsetBest(p)) return false;
  const stay = legs.find((l) => l.kind === "STAY" && l.placeId === p.id);
  return !!stay && stay.fromMin <= sunset - 10 && stay.toMin >= sunset;
}

/** 재탑승: 귀가 한계 안에 들어오는 후보를 점수로 줄 세워 상위 2개 + '바로 집으로'. */
export function reboard(nowMin: number, here: LatLng, profile: FamilyProfile, all: Place[], sky: SkyToday | null, day: string | null = null): Plan {
  const candidates = forDay(all, day);
  const r = rankSingles("REBOARD", nowMin, here, profile, candidates, sky);
  const options = [
    ...r.ranked.slice(0, 2).map((c) => single(c, r.ctx, c.detour <= HOMEWARD_DETOUR_MAX_MIN ? "집 가는 길에 잠깐" : "한 곳 더")),
    goHome(r.toHome, r.ctx, candidates.length === 0, r.ranked.length === 0),
  ];
  return { mode: "REBOARD", nowMin, budgetMin: Math.max(0, r.budget), backByMin: r.limit, options, sky };
}

function rankSingles(
  mode: PlanMode, nowMin: number, here: LatLng, profile: FamilyProfile, candidates: Place[], sky: SkyToday | null,
): Singles {
  const limit = limitMin(mode, profile, sky);
  const toHome = TravelTime.minutes(here, profile.home);
  const budget = TimeBudget.availableMin(nowMin, limit, toHome);
  const safe = limit - TimeBudget.SAFETY_MIN;
  const rain = rainStartMin(sky, nowMin);
  const wet = rain != null && rain < nowMin + RAIN_SOON_MIN;

  const ranked: Cand[] = [];
  for (const p of candidates) {
    const toC = TravelTime.minutes(here, p.at);
    const cToH = TravelTime.minutes(p.at, profile.home);
    const detour = TimeBudget.detourMin(toC, cToH, toHome);
    if (!TimeBudget.fits(detour, dwellFor(profile, p), budget)) continue;
    const w = walk(nowMin, here, [p], profile, rain, false, false);
    const b = w ? finish(w, profile) : null;
    if (b == null) continue;
    if (b.arriveHome > safe) continue; // 문 열 때까지 기다리느라 늦어지는 경우
    let score = fitScore(p, b.legs.find((l) => l.kind === "STAY"), profile, sky) - detour / 30.0;
    // 가는 길이 낮잠 이동이면 이동 시간 감점 없음 (집으로 가는 길의 낮잠은 점수에 안 넣음)
    score += b.legs[0].kind === "NAP_DRIVE" ? b.napScore : -toC / 60.0;
    if (wet) score += p.indoor ? 2.0 : -2.0;
    score += airScore(p, sky?.air);
    if (p.festival) score += p.festival.weight;
    score += historyScore(p, profile.history);
    ranked.push({ p, built: b, detour, score, wet });
  }
  ranked.sort((a, b) => cmpNum(b.score, a.score) || cmpNum(a.built.arriveHome, b.built.arriveHome) || cmpStr(a.p.id, b.p.id));
  return { ranked, ctx: { now: nowMin, here, profile, sky, rain, limit }, toHome, budget, limit };
}

function single(c: Cand, ctx: Ctx, label: string): PlanOption {
  const m = mealize([c.p], c.built, ctx);
  const b = m.built;
  const reasons: Reason[] = [];
  if (c.p.festival) reasons.push(festivalReason(c.p.festival));
  if (sunsetCover(c.p, b.legs, ctx.sky)) reasons.push({ text: `노을 ${asHhmm(ctx.sky!.sunsetMin!)}`, tone: "SUN" });
  const air = c.p.indoor ? airReason(ctx.sky) : null;
  if (air) reasons.push(air);
  if (b.napLeg) reasons.push({ text: `낮잠 맞춤 · 차에서 ${legMinutes(b.napLeg)}분`, tone: "NAP" });
  const nightS = nightReason([c.p], b.legs, ctx);
  if (nightS) reasons.push(nightS);
  if (c.wet && c.p.indoor) reasons.push({ text: rainText(ctx), tone: "RAIN" });
  const sun = sunReason(b.arriveHome, ctx);
  if (sun) reasons.push(sun);
  if (c.p.popular >= POPULAR_MIN) reasons.push({ text: `요즘 많이 감 · ${c.p.popular}팀`, tone: "PLAIN" });
  reasons.push({ text: `우회 +${c.detour}분`, tone: "PLAIN" });
  if (newStamp(c.p, ctx.profile.history)) reasons.push({ text: "도장 +1", tone: "STAMP" });
  const dc = dwellChip(ctx.profile);
  if (dc) reasons.push({ text: dc, tone: "PLAIN" });
  const kind: OptionKind = c.detour <= HOMEWARD_DETOUR_MAX_MIN ? "HOMEWARD" : "NEARBY";
  return {
    kind, stops: m.stops, firstLegMin: b.firstLeg, detourMin: c.detour, arriveHomeMin: b.arriveHome, legs: b.legs, reasons: withMeal(reasons, m), label,
    ...mealFields(m),
  };
}

// ------------------------------------------------------------------ 저녁 나들이 (엔진 Planner.evening — 줄 단위로 같게)

/** 저녁 어울림: fit.evening[동행] → 없으면 낮 어울림 × (밤 명소·드라이브 1.0 / 그 밖 0.6). */
export function eveningFit(p: Place, c: Companion): number {
  const v = p.fitEvening?.[c];
  return v ?? fitFor(p, c) * (nightBest(p) || isDrivePlace(p) ? 1.0 : EVENING_FIT_GUESS);
}

/** 저녁 후보: 밤·노을 명소 또는 저녁 어울림이 적힌 곳. 드라이브 길은 어른끼리만. */
export function eveningCandidate(p: Place, c: Companion): boolean {
  if (isDrivePlace(p)) return c !== "kids";
  return nightBest(p) || sunsetBest(p) || p.fitEvening?.[c] != null;
}

/** 쌀쌀함: 기온을 알고 COLD_C℃ 이하. */
export const isCold = (sky: SkyToday | null | undefined): boolean => sky?.tempC != null && sky.tempC <= COLD_C;

/** '7시' · '7시 반' · '7시 15분' (12시간, 오전·오후 없이). */
export function hourText(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const h = hh % 12 === 0 ? 12 : hh % 12;
  const mm = m % 60;
  return mm === 0 ? `${h}시` : mm === 30 ? `${h}시 반` : `${h}시 ${mm}분`;
}

/** 저녁 한 곳에서 머무는 분 (엔진 eveningDwell). */
export function eveningDwell(p: Place, profile: FamilyProfile, cold: boolean): number {
  if (isDrivePlace(p)) return p.route!.passMin;
  const cap = isKids(profile) ? EVENING_KIDS_DWELL_MAX : EVENING_ADULT_DWELL_MAX;
  const d = clampNum(dwellFor(profile, p), EVENING_DWELL_MIN, cap);
  return cold && !p.indoor ? Math.min(d, EVENING_COLD_OUTDOOR_MAX) : d;
}

type ReadyKind = "SHOW" | "SUNSET" | "LIGHT" | "NONE";
type Ready = { min: number; kind: ReadyKind; reason: Reason | null };

/** 도착 시각 맞추기 (엔진 eveningReady): 쇼 → 노을 → 조명 → 바로. null = 너무 일러 못 맞춤. */
function eveningReady(p: Place, arrive: number, sky: SkyToday | null, day: string | null): Ready | null {
  const sunset = sky?.sunsetMin ?? null;
  let show: [number, string] | null = null;
  for (const sh of p.moments?.shows ?? []) {
    if (!showRunsOn(sh, day)) continue;
    for (const t of [...sh.times].sort((a, b) => a - b)) {
      const at = t - SHOW_BEFORE_MIN;
      if (at >= arrive && at - arrive <= EVENING_WAIT_MAX_MIN && (show == null || t < show[0])) show = [t, sh.name];
    }
  }
  if (show) return { min: show[0] - SHOW_BEFORE_MIN, kind: "SHOW", reason: { text: `${hourText(show[0])} ${show[1]} 보러`, tone: "SUN" } };
  if (sunsetBest(p) && sunset != null && arrive <= sunset - 10) {
    const at = Math.max(arrive, sunset - SUNSET_BEFORE_MIN);
    if (at - arrive > EVENING_WAIT_MAX_MIN) return null;
    return { min: at, kind: "SUNSET", reason: { text: `노을 ${asHhmm(sunset)}`, tone: "SUN" } };
  }
  if (nightBest(p) && !isDrivePlace(p)) {
    const on = lightOnMin(p.moments, sunset) ?? darkMin(sky);
    if (arrive < on) {
      if (on - arrive > EVENING_WAIT_MAX_MIN) return null;
      return { min: on, kind: "LIGHT", reason: { text: "조명 켜질 때 도착", tone: "SUN" } };
    }
  }
  return { min: arrive, kind: "NONE", reason: null };
}

type EvBuilt = { built: Built; ready: Ready[]; driveMin: number; openWait: number };

function eveningWalk(
  nowMin: number, here: LatLng, seq: Place[], profile: FamilyProfile, sky: SkyToday | null, day: string | null, rain: number | null, cold: boolean,
): EvBuilt | null {
  const cap = isKids(profile) ? EVENING_KIDS_DRIVE_MAX : EVENING_ADULT_DRIVE_MAX;
  const legs: Leg[] = [];
  const ready: Ready[] = [];
  let t = nowMin;
  let at = here;
  let first: number | null = null;
  let drive = 0;
  let wait = 0;
  let openWait = 0;
  for (const p of seq) {
    const len = TravelTime.minutes(at, p.at);
    if (len > cap) return null;
    legs.push({ kind: "DRIVE", fromMin: t, toMin: t + len, placeId: p.id });
    if (first == null) first = len;
    drive += len;
    t += len;
    const r = eveningReady(p, t, sky, day);
    if (r == null) return null;
    const start = Math.max(Math.max(t, p.openMin), r.min);
    if (start - t > EVENING_WAIT_MAX_MIN) return null;
    const dwell = eveningDwell(p, profile, cold);
    if (start + Math.min(dwell, MIN_VISIT_MIN) > p.closeMin) return null;
    if (p.lastEntryMin != null && start > p.lastEntryMin) return null;
    const end = Math.min(start + dwell, p.closeMin);
    if (!p.indoor && !isDrivePlace(p) && rain != null && end > rain) return null;
    legs.push({ kind: isMealPlace(p) ? "MEAL" : "STAY", fromMin: t, toMin: end, placeId: p.id });
    ready.push(r);
    wait += start - t;
    // 쇼·조명·노을을 기다리는 건 둘러보는 시간 — 점수 감점은 문 열기 기다림만
    openWait += Math.max(t, p.openMin) - t;
    t = end;
    at = isDrivePlace(p) ? p.route!.points[p.route!.points.length - 1] : p.at;
  }
  const home = TravelTime.minutes(at, profile.home);
  if (home > Math.max(cap, TravelTime.minutes(here, profile.home))) return null;
  legs.push({ kind: "HOME", fromMin: t, toMin: t + home, placeId: null });
  drive += home;
  return { built: { legs, firstLeg: first ?? home, arriveHome: t + home, awakeDriveMin: drive, napLeg: null, napScore: 0.0, waitMin: wait }, ready, driveMin: drive, openWait };
}

type EveningType = "drive" | "indoor" | "sunset" | "night";
function eveningType(c: Scored, ready: Ready[]): EveningType {
  if (c.stops.some(isDrivePlace)) return "drive";
  if (c.stops.every((p) => p.indoor)) return "indoor";
  if (ready[0]?.kind === "SUNSET") return "sunset";
  return "night";
}

function eveningLabel(type: EveningType, comp: Companion): string {
  if (type === "drive") return LABEL_DRIVE;
  if (type === "indoor") return EVENING_PREFIX + (comp === "kids" ? "따뜻한 실내" : "늦게 여는 실내");
  if (type === "sunset") return `${EVENING_PREFIX}노을 전망`;
  return EVENING_PREFIX + (comp === "couple" ? "야경 데이트" : comp === "friends" ? "야경 명소" : "야경 산책");
}

/**
 * 저녁 나들이 (엔진 Planner.evening): 저녁 후보에서 1~2곳 코스를 모두 따져 서로 다른 종류로 최대 3장 + 바로 집으로.
 * 귀가 한계 = 아이와 잠자는 시간 · 어른끼리 늦어도 몇 시 귀가. 비: 야외는 비 전에 끝날 때만. 쌀쌀함: 야외 짧게.
 */
export function evening(nowMin: number, here: LatLng, profile: FamilyProfile, all: Place[], sky: SkyToday | null, day: string | null = null): Plan {
  const comp = companionOf(profile);
  const kids = comp === "kids";
  const dayList = forDay(all, day);
  const candidates = dayList.filter((p) => eveningCandidate(p, comp));
  const limit = eveningLimitOf(profile);
  const toHome = TravelTime.minutes(here, profile.home);
  const budget = TimeBudget.availableMin(nowMin, limit, toHome);
  const safe = limit - TimeBudget.SAFETY_MIN;
  const rain = rainStartMin(sky, nowMin);
  const cold = isCold(sky);
  const outing = kids ? EVENING_KIDS_OUTING_MAX_MIN : EVENING_ADULT_OUTING_MAX_MIN;
  const ctx: Ctx = { now: nowMin, here, profile, sky, rain, limit };

  const readyOf = new Map<string, Ready[]>();
  const courses: Scored[] = [];
  const tryCourse = (seq: Place[]) => {
    const ev = eveningWalk(nowMin, here, seq, profile, sky, day, rain, cold);
    if (ev == null) return;
    if (ev.built.arriveHome > safe || ev.built.arriveHome - nowMin > outing) return;
    const sc = scored(seq, ev.built, eveningScore(seq, ev, safe, sky, profile, cold));
    readyOf.set(sc.key, ev.ready);
    courses.push(sc);
  };
  for (const p of candidates) tryCourse([p]);
  // 두 곳 코스는 어른끼리만 (아이와는 짧게 한 곳)
  if (!kids) for (const p of candidates) for (const q of candidates) if (p.id !== q.id && !(isDrivePlace(p) && isDrivePlace(q))) tryCourse([p, q]);
  courses.sort(ORDER);

  let tip: SunsetTip | null = null;
  const sunset = sky?.sunsetMin;
  if (sunset != null && nowMin >= sunset) {
    const best = dayList.filter((p) => sunsetBest(p) && !isDrivePlace(p))
      .sort((a, b) => cmpNum(eveningFit(b, comp), eveningFit(a, comp))
        || cmpNum(TravelTime.minutes(profile.home, a.at), TravelTime.minutes(profile.home, b.at)) || cmpStr(a.id, b.id))[0];
    if (best) tip = { placeId: best.id, placeName: best.name, sunsetMin: sunset, arriveByMin: sunset - SUNSET_BEFORE_MIN };
  }
  const home = goHome(toHome, ctx, dayList.length === 0, courses.length === 0);
  if (courses.length === 0) {
    return { mode: "AFTERNOON", nowMin, budgetMin: Math.max(0, budget), backByMin: limit, options: [home], sky, evening: false, sunsetTip: tip };
  }
  const typeOf = (c: Scored) => eveningType(c, readyOf.get(c.key)!);
  const picked: Scored[] = [courses[0]];
  const pickedTypes = () => new Set(picked.map(typeOf));
  const second = diverse(courses, picked, (c) => !pickedTypes().has(typeOf(c))) ?? diverse(courses, picked, () => true);
  if (second) picked.push(second);
  if (!kids && !pickedTypes().has("drive")) {
    const d = diverse(courses, picked, (c) => typeOf(c) === "drive");
    if (d) picked.push(d);
  }
  if (picked.length < 3) {
    const o = diverse(courses, picked, (c) => !pickedTypes().has(typeOf(c)));
    if (o) picked.push(o);
  }
  const options: PlanOption[] = picked.map((c) => {
    // 저녁 카드는 쇼·조명·노을 시각에 맞춰 둔 시간표라 밥은 마지막 곳 뒤(집 가는 길)에만
    const m = mealize(c.stops, c.built, ctx, true);
    return {
      kind: "COURSE", stops: m.stops, firstLegMin: m.built.firstLeg, detourMin: null, arriveHomeMin: m.built.arriveHome,
      legs: m.built.legs, reasons: withMeal(eveningReasons(scored(c.stops, m.built, c.score), readyOf.get(c.key)!, ctx, cold), m),
      label: eveningLabel(typeOf(c), comp), ...mealFields(m),
    };
  });
  options.push(home);
  return { mode: "AFTERNOON", nowMin, budgetMin: Math.max(0, budget), backByMin: limit, options, sky, evening: true, sunsetTip: tip };
}

function eveningScore(stops: Place[], ev: EvBuilt, safe: number, sky: SkyToday | null, profile: FamilyProfile, cold: boolean): number {
  const c = companionOf(profile);
  let s = 0.0;
  stops.forEach((p, i) => {
    s += 2.0 * eveningFit(p, c);
    if (newStamp(p, profile.history)) s += 0.5;
    if (!isDrivePlace(p)) s += airScore(p, sky?.air);
    s += historyScore(p, profile.history);
    if ((COMPANION_TAGS[c] ?? []).some((t) => hasTag(p, t))) s += TAG_BONUS;
    const k = ev.ready[i].kind;
    if (k === "SHOW" || k === "SUNSET") s += 0.5;
    if (cold) s += p.indoor || isDrivePlace(p) ? 0.5 : -0.5;
    if (isDrivePlace(p) && (c === "couple" || c === "solo")) s += 0.5;
    if (c === "kids" && p.indoor) s += 0.25;
  });
  s -= (ev.driveMin + ev.openWait) / 60.0;
  s -= 0.5 * (stops.length - 1);
  const slack = safe - ev.built.arriveHome;
  if (slack < LATE_SLACK_MIN) s -= (LATE_SLACK_MIN - slack) / LATE_SLACK_MIN;
  return s;
}

/** 저녁 카드 칩 (엔진 eveningReasons): 축제 → 시각 맞춤 → 드라이브 → 'N시까지 열어요' → 비·쌀쌀함 → 미세먼지 → 귀가 → 밤 도장/도장. */
function eveningReasons(c: Scored, ready: Ready[], ctx: Ctx, cold: boolean): Reason[] {
  const out: Reason[] = [];
  const p = ctx.profile;
  const fests = c.stops.map((s) => s.festival).filter((f): f is FestivalInfo => !!f);
  if (fests.length) out.push(festivalReason(fests.reduce((a, b) => (cmpStr(b.ends, a.ends) < 0 ? b : a))));
  const timed = ready.find((r) => r.reason != null);
  if (timed?.reason) out.push(timed.reason);
  const dr = c.stops.find(isDrivePlace);
  if (dr) out.push({ text: `야경 드라이브 · ${dr.route!.passMin}분`, tone: "SUN" });
  const allIndoor = c.stops.every((s) => s.indoor);
  const close = Math.min(...c.stops.map((s) => s.closeMin));
  if (allIndoor && close < 24 * 60) out.push({ text: `${hourText(close)}까지 열어요`, tone: "PLAIN" });
  const outdoor = c.stops.some((s) => !s.indoor && !isDrivePlace(s));
  if (ctx.rain != null && !outdoor) out.push({ text: allIndoor ? "비 와도 실내" : "비 와도 차 안에서", tone: "RAIN" });
  if (cold) out.push({ text: outdoor ? "쌀쌀해요 · 짧게 둘러봐요" : "쌀쌀한 밤 · 따뜻하게", tone: "PLAIN" });
  if (allIndoor) {
    const a = airReason(ctx.sky);
    if (a) out.push(a);
  }
  const arrive = c.built.arriveHome;
  out.push({ text: isKids(p) ? `잠자기 전 귀가 · ${asHhmm(arrive)}` : `${asHhmm(arrive)} 귀가`, tone: "PLAIN" });
  const sunset = ctx.sky?.sunsetMin;
  const nights = c.stops.filter((s) => s.stampable && nightBest(s) && !s.festival && sunset != null && ctx.rain == null
    && c.built.legs.some((l) => l.kind === "STAY" && l.placeId === s.id && l.fromMin >= sunset)).length;
  const stamps = c.stops.filter((s) => newStamp(s, p.history)).length;
  if (nights > 0) out.push({ text: `밤 도장 +${nights}`, tone: "STAMP" });
  else if (stamps > 0) out.push({ text: `${c.stops.filter((p) => !isMealPlace(p)).length}곳 · 도장 ${stamps}`, tone: "STAMP" });
  return out;
}

// ------------------------------------------------------------------ 앵커 코스 ('○○ 중심으로 코스 짜기', 엔진 Planner.anchored)

/** 앵커 코스 결과 (엔진 AnchorPlan). oneWayMin = 지금 위치→앵커와 앵커→집 중 긴 쪽, overnight = 편도 3시간 넘음, closed = 오늘은 못 감. */
export type AnchorPlan = { plan: Plan; anchorId: string; anchorDwellMin: number; oneWayMin: number; overnight: boolean; closed: boolean };

/**
 * 한 곳(앵커)을 꼭 넣고 앞뒤로 0~2곳을 붙여 최대 3장: ① '가는 길에 한 곳 더'(더 운전 20분 안) ② '근처 한 곳 더/두 곳 더'(앵커에서 20분 안, ①과 다른 곳)
 * ③ '여기만 · 여유 있게'. ③도 귀가 한계를 넘으면 그 카드 하나만 overLimit로. 문 닫는 시각 때문에 못 가면 closed + 카드 없음.
 * 앵커 머무름 = anchorDwellMin → 축제 120분 → 우리 가족 머무름. 계산 순서·동점 처리는 엔진과 같다.
 */
export function anchored(
  nowMin: number, here: LatLng, profile: FamilyProfile, all: Place[], anchorPlace: Place, anchorDwellMin: number | null,
  sky: SkyToday | null, day: string | null = null,
): AnchorPlan {
  // 앵커도 그날 운영 시각으로 (운영 시간 줄이 있을 때)
  const anchor = placeOnDay(anchorPlace, day);
  const mode: PlanMode = nowMin < AFTERNOON_FROM_MIN ? "MORNING" : "AFTERNOON";
  const dwell = clampUserDwell(anchorDwellMin ?? (anchor.festival ? ANCHOR_FESTIVAL_DWELL_MIN : dwellFor(profile, anchor)));
  const prof: FamilyProfile = { ...profile, dwellSet: { ...(profile.dwellSet ?? {}), [anchor.id]: dwell } };
  const limit = limitMin(mode, prof, sky);
  const toHome = TravelTime.minutes(here, prof.home);
  const budget = TimeBudget.availableMin(nowMin, limit, toHome);
  const safe = limit - TimeBudget.SAFETY_MIN;
  const rain = rainStartMin(sky, nowMin);
  const oneWay = Math.max(TravelTime.minutes(here, anchor.at), TravelTime.minutes(anchor.at, prof.home));
  const wo = anchorOpts(anchor, here, prof);
  const ctx: Ctx = { now: nowMin, here, profile: prof, sky, rain, limit };
  const extras = forDay(all, day).filter((p) => p.id !== anchor.id && p.id !== anchor.festival?.placeId && p.festival?.placeId !== anchor.id);

  const build = (seq: Place[], strict: boolean): Scored | null => {
    const w = walk(nowMin, here, seq, prof, rain, true, false, wo);
    const b = w ? finish(w, prof, wo) : null;
    if (b == null) return null;
    if (strict && b.arriveHome > safe) return null;
    return scored(seq, b, courseScore(seq, b, safe, sky, prof));
  };
  const driveMin = (c: Scored) => c.built.legs.filter((l) => l.kind !== "STAY").reduce((a, l) => a + legMinutes(l), 0);
  const extrasOf = (c: Scored) => new Set(c.stops.filter((p) => p.id !== anchor.id).map((p) => p.id));
  const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
  const result = (options: PlanOption[], closed: boolean): AnchorPlan => ({
    plan: { mode, nowMin, budgetMin: Math.max(0, budget), backByMin: limit, options, sky },
    anchorId: anchor.id, anchorDwellMin: dwell, oneWayMin: oneWay, overnight: oneWay > OVERNIGHT_MIN, closed,
  });

  // 앵커가 그날 쉬면(쉬는 요일·임시 휴무) 카드 없이 closed
  const alone = placeClosedOn(anchor, day) ? null : build([anchor], false);
  if (alone == null) return result([], true);
  const aloneOver = alone.built.arriveHome > safe;

  const picked: [Scored, string][] = [];
  if (!aloneOver) {
    const base = driveMin(alone);
    const onWay = extras
      .flatMap((x) => [[x, anchor], [anchor, x]])
      .map((seq) => build(seq, true))
      .filter((c): c is Scored => c != null)
      .filter((c) => driveMin(c) - base <= ANCHOR_ON_WAY_MAX_MIN)
      .sort(ORDER)[0];
    if (onWay) picked.push([onWay, "가는 길에 한 곳 더"]);
    const near = extras.filter((p) => TravelTime.minutes(anchor.at, p.at) <= ANCHOR_NEAR_MAX_MIN);
    const seqs: Place[][] = [];
    for (const x of near) { seqs.push([x, anchor]); seqs.push([anchor, x]); }
    for (const x of near) for (const y of near) if (x.id !== y.id) { seqs.push([x, y, anchor]); seqs.push([x, anchor, y]); seqs.push([anchor, x, y]); }
    const nearSeqs = seqs.map((seq) => build(seq, true)).filter((c): c is Scored => c != null).sort(ORDER);
    const taken = onWay ? extrasOf(onWay) : new Set<string>();
    const nearPick = nearSeqs.find((c) => [...extrasOf(c)].every((id) => !taken.has(id))) ?? nearSeqs.find((c) => !sameSet(extrasOf(c), taken));
    if (nearPick) picked.push([nearPick, extrasOf(nearPick).size >= 2 ? "근처 두 곳 더" : "근처 한 곳 더"]);
  }
  picked.push([alone, "여기만 · 여유 있게"]);

  const options = picked.map(([c, label]): PlanOption => {
    const m = mealize(c.stops, c.built, ctx);
    const b = m.built;
    const over = b.arriveHome > safe;
    const r = withMeal(courseReasons(scored(c.stops, b, c.score), ctx), m);
    const reasons = over ? [{ text: `귀가 한계를 넘어요 · 집 ${asHhmm(b.arriveHome)} 도착`, tone: "PLAIN" as Tone }, ...r] : r;
    return {
      kind: "COURSE", stops: m.stops, firstLegMin: b.firstLeg, detourMin: null, arriveHomeMin: b.arriveHome,
      legs: b.legs, reasons, label, overLimit: over, ...mealFields(m),
    };
  });
  return result(options, false);
}

// ------------------------------------------------------------------ '왜?' 설명 (엔진 Planner.explainChoice)

/** '왜?' 설명 한 줄. tone = 칩 색·아이콘 (이유 칩과 같은 색). */
export type WhyLine = { text: string; tone: Tone };
/** 카드의 장소 하나에 대한 '왜?' 설명. */
export type StopWhy = { placeId: string; lines: WhyLine[] };

/**
 * 카드의 장소마다 '왜 여기?'를 쉬운 말 몇 줄로 — 점수에 실제로 들어간 항목을 그대로 말로 (AI 문장 아님).
 * 줄 순서: 축제 → 거리(낮잠 이동이면 낮잠) → 아이 → 도장·방문 기록 → 날씨·미세먼지 → 문 열기 기다림 → 머무름 → 요즘 많이 감 → (마지막 곳) 집 가는 길 낮잠.
 */
export function explainChoice(option: PlanOption, nowMin: number, here: LatLng, profile: FamilyProfile, sky: SkyToday | null): StopWhy[] {
  const h = profile.history ?? null;
  const rain = rainStartMin(sky, nowMin);
  const airBad = airIsBad(sky?.air);
  const age = profile.kidAges.length ? Math.min(...profile.kidAges) : 4;
  const comp = companionOf(profile);
  const kids = comp === "kids";
  const fromHome = km(here, profile.home) * 1000 <= AT_HOME_M;
  const ev = option.label.startsWith(EVENING_PREFIX);
  const line = (text: string, tone: Tone = "PLAIN"): WhyLine => ({ text, tone });
  // 식사 자리는 설명하지 않는다 (밥 칩이 따로 있음). 집 가는 길 낮잠 줄은 마지막 장소에
  let lastPlace = -1;
  option.stops.forEach((p, i) => { if (!isMealPlace(p)) lastPlace = i; });
  const out: StopWhy[] = [];
  option.stops.forEach((p, i) => {
    if (isMealPlace(p)) return;
    const lines: WhyLine[] = [];
    if (p.festival) lines.push(line(`축제 기간이에요 · ${festivalEndsText(p.festival)}까지`, "FESTIVAL"));
    const arrive = option.legs.find((l) => l.kind !== "STAY" && l.placeId === p.id);
    const stay = option.legs.find((l) => l.kind === "STAY" && l.placeId === p.id);
    if (arrive) {
      const m = legMinutes(arrive);
      if (arrive.kind === "NAP_DRIVE") {
        lines.push(line(`낮잠 시간에 차에서 ${m}분 재울 수 있어요`, "NAP"));
      } else {
        const from = i > 0 ? `${option.stops[i - 1].name}에서` : fromHome ? "집에서" : "지금 있는 곳에서";
        const tail = m <= NEAR_MAX_MIN ? " · 가까워요" : m > AWAKE_DRIVE_MAX_MIN ? " · 멀어요" : "";
        lines.push(line(`${from} ${m}분${tail}`));
      }
    }
    lines.push(kids ? line(
      p.kidFit >= 0.8 ? `${age}살 아이가 놀기 좋아요` : p.kidFit >= 0.6 ? `${age}살 아이도 즐길 만해요` : `${age}살 아이에겐 조금 어려울 수 있어요`,
    ) : companionLine(p, comp));
    if (!p.stampable) lines.push(line("도장 대신 '다녀옴'으로 남아요"));
    else if (h == null) lines.push(line("도장을 찍을 수 있어요 · 도장 +1", "STAMP"));
    else if (h.stamped.includes(p.id)) lines.push(line("이미 도장을 받은 곳이에요"));
    else lines.push(line("아직 도장이 없어요 · 도장 +1", "STAMP"));
    if (h != null) {
      const days = h.lastVisitDays[p.id];
      if (days == null && !h.stamped.includes(p.id)) lines.push(line("처음 가 보는 곳이에요"));
      else if (days != null && days === 0) lines.push(line("오늘 이미 다녀온 곳이에요"));
      else if (days != null && days < RECENT_DAYS) lines.push(line(`${days}일 전에 다녀온 곳이에요`));
      if (h.favorites.includes(p.id)) lines.push(line("즐겨찾는 곳이에요"));
    }
    if (stay) {
      const air = sky?.air;
      if (airBad && air) lines.push(line(p.indoor ? `미세먼지 ${AIR_TEXT[air]} · 실내라 괜찮아요` : `미세먼지 ${AIR_TEXT[air]} · 마스크 챙기세요`, "AIR"));
      else if (rain != null && rain <= stay.fromMin) lines.push(line(p.indoor ? "비가 와도 실내라 괜찮아요" : "비 소식이 있어요 · 우산 챙기세요", "RAIN"));
      else if (rain != null && rain < stay.toMin) lines.push(line(p.indoor ? `${asHhmm(rain)}부터 비 · 실내라 괜찮아요` : `${asHhmm(rain)}부터 비 · 우산 챙기세요`, "RAIN"));
      else if (rain != null && !p.indoor) lines.push(line(`비 오기 전(${asHhmm(rain)})에 나와요`, "SUN"));
      else if (rain == null && sky?.sky === "CLEAR" && !p.indoor && ((kids && !ev) || stay.toMin <= darkMin(sky))) lines.push(line("오늘 맑음 · 야외 괜찮아요", "SUN"));
      if ((!kids || ev) && stay.toMin > darkMin(sky) && !isDrivePlace(p)) {
        if (hasTag(p, TAG_NIGHT) || nightBest(p)) lines.push(line("해 진 뒤 야경이 예뻐요", "SUN"));
        else if (!p.indoor) lines.push(line("해 진 뒤엔 어두워요 · 일찍 둘러보세요", "SUN"));
      }
      const wait = Math.max(0, p.openMin - stay.fromMin);
      if (wait > 0) lines.push(line(`문 여는 ${asHhmm(p.openMin)}까지 ${wait}분 기다려요`));
      const d = dwellEstimate(profile, p);
      const extra = legMinutes(stay) - wait - d.minutes;
      if (ev) {
        // 저녁 카드: 머무름은 저녁 기준(짧게) — 실제 칸 길이 그대로, 드라이브는 지나가는 시간
        lines.push(line(isDrivePlace(p) ? `차로 ${legMinutes(stay) - wait}분 지나가요 · 내리지 않아도 돼요` : `저녁엔 ${legMinutes(stay) - wait}분쯤 둘러봐요`));
      } else {
        lines.push(line(`여기서 ${d.minutes}분 ${kids ? "놀아요" : "머물러요"} · ${dwellSourceText(d)}`));
        if (extra > 0) lines.push(line(`낮잠 시간에 맞춰 ${extra}분 더 놀아요`, "NAP"));
      }
    }
    if (p.popular >= POPULAR_MIN) lines.push(line(`요즘 ${p.popular}${kids ? "가족이" : "팀이"} 갔어요`));
    if (i === lastPlace) {
      const home = option.legs[option.legs.length - 1];
      if (home && home.kind === "NAP_DRIVE" && home.placeId == null) lines.push(line(`집에 가는 길에 차에서 ${legMinutes(home)}분 재울 수 있어요`, "NAP"));
    }
    out.push({ placeId: p.id, lines });
  });
  return out;
}

/** 어른끼리 '왜?'의 동행 줄 (엔진 companionLine). */
function companionLine(p: Place, c: Companion): WhyLine {
  const f = fitFor(p, c);
  const tag = [...(c === "couple" ? [TAG_NIGHT] : []), ...(COMPANION_TAGS[c] ?? [])].find((t) => hasTag(p, t));
  const good = c === "couple" ? "연인과 가기 좋아요" : c === "friends" ? "친구들과 놀기 좋아요" : "혼자 조용히 둘러보기 좋아요";
  const text = f >= 0.8 ? (tag != null ? `${good} · ${tag}` : good)
    : f >= 0.6 ? (c === "couple" ? "둘이 가 볼 만해요" : c === "friends" ? "친구들과 가 볼 만해요" : "혼자 가 볼 만해요")
    : c === "couple" ? "둘이 가기엔 조금 심심할 수 있어요" : c === "friends" ? "친구끼리는 조금 심심할 수 있어요" : "혼자 가기엔 조금 어색할 수 있어요";
  return { text, tone: "PLAIN" };
}

// ------------------------------------------------------------------ 바로 집으로

/**
 * '바로 집으로' / '오늘은 쉬어요'. 칩은 늘 1개 이상: 왜 집인지(장소 없음·해 짐·귀가 시각·맞는 곳 없음) +
 * 집 밖이면 도착 시각·해 지기 전, 집 안이면서 이유가 없으면 '낮잠은 집에서' 또는 '집에서 쉬어요'.
 * noneFit = 시간에 맞는 추천이 하나도 없음.
 */
function goHome(toHome: number, ctx: Ctx, noCandidates: boolean, noneFit: boolean): PlanOption {
  const atHome = km(ctx.here, ctx.profile.home) * 1000 <= AT_HOME_M;
  const arrive = ctx.now + toHome;
  const sunset = ctx.sky?.sunsetMin ?? null;
  const p = ctx.profile;
  const reasons: Reason[] = [];
  if (noCandidates) reasons.push({ text: "가까운 추천 장소가 없어요", tone: "PLAIN" });
  else if (sunset != null && ctx.now >= sunset) reasons.push({ text: "해가 졌어요", tone: "SUN" });
  else if (arrive + TimeBudget.SAFETY_MIN >= ctx.limit) reasons.push({ text: "귀가 시각이 다 됐어요", tone: "PLAIN" });
  else if (noneFit) reasons.push({ text: "시간 맞는 곳이 없어요", tone: "PLAIN" });
  if (!atHome) {
    reasons.push({ text: `${asHhmm(arrive)} 도착`, tone: "PLAIN" });
    const sun = sunReason(arrive, ctx);
    if (sun) reasons.push(sun);
  } else if (reasons.length === 0) {
    if (hasNap(p) && ctx.now < p.napStartMin) reasons.push({ text: `낮잠은 집에서 · ${asHhmm(p.napStartMin)}`, tone: "NAP" });
    else reasons.push({ text: "집에서 쉬어요", tone: "PLAIN" });
  }
  return {
    kind: "GO_HOME", stops: [], firstLegMin: toHome, detourMin: null, arriveHomeMin: arrive,
    legs: [{ kind: "HOME", fromMin: ctx.now, toMin: arrive, placeId: null }], reasons,
    label: atHome ? "오늘은 쉬어요" : "바로 집으로",
  };
}

// ------------------------------------------------------------------ 시간표

/**
 * 장소를 차례로 도는 시간표. 문 닫기 30분 전 이후 도착 · 문 열기 30분 넘게 기다림 ·
 * (rainHard면) 야외에 머무는 중 비 · 깨어 있는 이동 60분 초과면 null.
 */
/**
 * 시간표 규칙 늦추기 (앵커 코스만, 엔진 Planner.WalkOpts): awakeMax = 깨어 있는 한 번 이동 최대,
 * freeId = 비 오는 야외·긴 문 열기 기다림(최대 ANCHOR_WAIT_MAX_MIN)을 봐주는 장소(앵커).
 */
type WalkOpts = { awakeMax: number; freeId: string | null };
const DEFAULT_WALK: WalkOpts = { awakeMax: AWAKE_DRIVE_MAX_MIN, freeId: null };

/** 앵커 코스의 규칙 늦추기: 앵커까지·앵커에서 집까지 이동만큼 깨어 있는 이동을 허락. */
function anchorOpts(anchor: Place, here: LatLng, profile: FamilyProfile): WalkOpts {
  return {
    awakeMax: Math.max(AWAKE_DRIVE_MAX_MIN, Math.max(TravelTime.minutes(here, anchor.at), TravelTime.minutes(anchor.at, profile.home))),
    freeId: anchor.id,
  };
}

function walk(
  nowMin: number, here: LatLng, stops: Place[], profile: FamilyProfile,
  rain: number | null, rainHard: boolean, stretchNap: boolean, opts: WalkOpts = DEFAULT_WALK,
): Walk | null {
  const legs: Leg[] = [];
  let t = nowMin;
  let at = here;
  let first: number | null = null;
  let awake = 0;
  let nap: Leg | null = null;
  let wait = 0;
  for (const p of stops) {
    const leg = drive(legs, t, at, p.at, p.id, false, profile, stretchNap, nap, opts);
    if (leg == null) return null;
    if (first == null) first = legMinutes(leg);
    if (leg.kind === "NAP_DRIVE") nap = leg;
    else awake += legMinutes(leg);
    t = leg.toMin;
    at = p.at;
    const start = Math.max(t, p.openMin);
    const free = p.id === opts.freeId;
    if (start - t > (free ? ANCHOR_WAIT_MAX_MIN : MAX_WAIT_MIN)) return null;
    wait += start - t;
    const dwell = dwellFor(profile, p);
    if (start + Math.min(dwell, MIN_VISIT_MIN) > p.closeMin) return null;
    if (p.lastEntryMin != null && start > p.lastEntryMin) return null;
    const end = Math.min(start + dwell, p.closeMin);
    if (rainHard && !free && !p.indoor && rain != null && end > rain) return null;
    legs.push({ kind: isMealPlace(p) ? "MEAL" : "STAY", fromMin: t, toMin: end, placeId: p.id });
    t = end;
  }
  return { legs, t, at, firstLeg: first, awake, napLeg: nap, wait };
}

/** 집으로 가는 마지막 이동을 붙인다. 집 도착을 늦추면서까지 낮잠을 맞추지는 않는다(늘려 머물기 없음). */
function finish(w: Walk, profile: FamilyProfile, opts: WalkOpts = DEFAULT_WALK): Built | null {
  const legs = [...w.legs];
  const leg = drive(legs, w.t, w.at, profile.home, null, true, profile, false, w.napLeg, opts);
  if (leg == null) return null;
  const napping = leg.kind === "NAP_DRIVE";
  const napLeg = napping ? leg : w.napLeg;
  const awake = w.awake + (napping ? 0 : legMinutes(leg));
  const nap = napLeg ? napScore(legMinutes(napLeg), profile) : 0.0;
  return { legs, firstLeg: w.firstLeg ?? legMinutes(leg), arriveHome: leg.toMin, awakeDriveMin: awake, napLeg, napScore: nap, waitMin: w.wait };
}

/**
 * 이동 한 칸을 [legs]에 붙이고 돌려준다. [stretch]면 앞 머무름을 늘려 낮잠 10분 전에 출발하게 맞출 수 있다.
 * 낮잠 이동은 하루 한 번. 깨어 있는 이동이 60분을 넘으면 null.
 */
function drive(
  legs: Leg[], from: number, at: LatLng, to: LatLng, placeId: string | null, last: boolean,
  profile: FamilyProfile, stretch: boolean, napSoFar: Leg | null, opts: WalkOpts = DEFAULT_WALK,
): Leg | null {
  const len = TravelTime.minutes(at, to);
  let t = from;
  if (stretch && napSoFar == null && legs.length > 0 && legs[legs.length - 1].kind === "STAY") {
    const depart = profile.napStartMin - NAP_DEPART_BEFORE_MIN;
    const windowOpen = profile.napStartMin - 20;
    if (t < windowOpen && depart - t <= NAP_STRETCH_MAX_MIN && TimeBudget.napAligned(depart, len, profile)) {
      const stay = legs.pop()!;
      legs.push({ ...stay, toMin: depart });
      t = depart;
    }
  }
  const napping = napSoFar == null && TimeBudget.napAligned(t, len, profile);
  // 어른끼리는 한 번 운전 90분까지 (앵커 코스는 그보다 길어도 봐준 값 그대로)
  const cap = isKids(profile) ? opts.awakeMax : Math.max(opts.awakeMax, ADULT_DRIVE_MAX_MIN);
  if (!napping && len > cap) return null;
  const kind: LegKind = napping ? "NAP_DRIVE" : last ? "HOME" : "DRIVE";
  const leg: Leg = { kind, fromMin: t, toMin: t + len, placeId };
  legs.push(leg);
  return leg;
}

/** 낮잠 길이의 0.9배에 가까운 이동일수록 좋다 (최대 3점). */
function napScore(travelMin: number, profile: FamilyProfile): number {
  const len = napLength(profile);
  const target = 0.9 * len;
  return 3.0 * Math.max(1 - Math.abs(travelMin - target) / (0.4 * len), 0.0);
}

// ------------------------------------------------------------------ 이유 칩

type Ctx = { now: number; here: LatLng; profile: FamilyProfile; sky: SkyToday | null; rain: number | null; limit: number };

/**
 * 하루 코스 칩 (차 화면은 앞 3개만 보이므로 순서 = 중요한 순서). 늘 1개 이상.
 * 축제(이번 주말만) → 미세먼지 나쁨 → 실내(모두 실내일 때) → 낮잠 맞춤 → 낮잠(점심) 전 귀가 → 가까워요 → 날씨 → 해 지기 전 귀가 → 요즘 많이 감 → N곳 · 도장 N
 * → (아무것도 없으면) N곳 · 귀가 시각.
 */
function courseReasons(c: Scored, ctx: Ctx): Reason[] {
  const out: Reason[] = [];
  const arrive = c.built.arriveHome;
  const prof = ctx.profile;
  // 축제가 둘 이상이면 먼저 끝나는 쪽
  const fests = c.stops.map((p) => p.festival).filter((f): f is FestivalInfo => !!f);
  if (fests.length) out.push(festivalReason(fests.reduce((a, b) => (b.ends < a.ends ? b : a))));
  const rain = ctx.rain;
  const outdoor = c.stops.some((p) => !p.indoor);
  const allIndoor = !outdoor;
  // 미세먼지 나쁨 이상: 모두 실내면 칩을 앞쪽에 (안드로이드 오토 목록은 첫 칩만 보인다), 야외가 있으면 '맑음 → 야외'를 붙이지 않는다
  const airBad = airIsBad(ctx.sky?.air);
  const air = allIndoor ? airReason(ctx.sky) : null;
  if (air) out.push(air);
  if (c.built.napLeg) out.push({ text: `낮잠 맞춤 · 차에서 ${legMinutes(c.built.napLeg)}분`, tone: "NAP" });
  const nightC = nightReason(c.stops, c.built.legs, ctx);
  if (nightC) out.push(nightC);
  if (hasNap(prof) && arrive <= prof.napStartMin) out.push({ text: `낮잠 전 귀가 · ${asHhmm(arrive)}`, tone: "NAP" });
  else if (!hasNap(prof) && isKids(prof) && arrive <= LUNCH_MIN) out.push({ text: `점심 전 귀가 · ${asHhmm(arrive)}`, tone: "PLAIN" });
  if (isNear(c, ctx)) out.push({ text: `가까워요 · 첫 이동 ${c.built.firstLeg}분`, tone: "PLAIN" });
  if (rain == null) {
    if (ctx.sky?.sky === "CLEAR" && outdoor && !airBad) out.push({ text: "맑음 → 야외", tone: "SUN" });
  } else if (rain <= ctx.now) {
    if (allIndoor) out.push({ text: "비 → 실내", tone: "RAIN" });
  } else {
    if (outdoor && rain >= 12 * 60 && !airBad) out.push({ text: "오전 맑음 → 야외", tone: "SUN" });
    const wetStay = c.built.legs.some(
      (s) => s.kind === "STAY" && s.toMin > rain && c.stops.find((p) => p.id === s.placeId)!.indoor,
    );
    if (wetStay) out.push({ text: rainText(ctx), tone: "RAIN" });
    else if (allIndoor) out.push({ text: "비 와도 실내", tone: "RAIN" });
  }
  const sun = sunReason(arrive, ctx);
  if (sun) out.push(sun);
  // 가장 많이 가는 곳 (같으면 앞에 있는 곳 — 코틀린 maxByOrNull과 같게)
  let top: Place | null = null;
  for (const p of c.stops) if (p.popular >= POPULAR_MIN && (top == null || p.popular > top.popular)) top = p;
  if (top) out.push({ text: `요즘 많이 감 · ${top.popular}팀`, tone: "PLAIN" });
  const stamps = c.stops.filter((p) => newStamp(p, prof.history)).length;
  const places = c.stops.filter((p) => !isMealPlace(p)).length;
  if (stamps > 0) out.push({ text: `${places}곳 · 도장 ${stamps}`, tone: "STAMP" });
  if (out.length === 0) out.push({ text: `${places}곳 · ${asHhmm(arrive)} 귀가`, tone: "PLAIN" });
  // 우리 가족 머무름 배율 (2번 넘게 배웠을 때만)
  const dc = dwellChip(ctx.profile);
  if (dc) out.push({ text: dc, tone: "PLAIN" });
  return out;
}

function rainText(ctx: Ctx): string {
  const rain = ctx.rain;
  if (rain == null) return "비 → 실내";
  if (rain <= ctx.now) return "비 → 실내";
  if (rain >= 12 * 60) return "오후 비 → 실내";
  return "곧 비 → 실내";
}

/** 어른끼리 해 진 뒤 야경 명소에 머물면 '야경 · 해 진 뒤' (엔진 nightReason). */
function nightReason(stops: Place[], legs: Leg[], ctx: Ctx): Reason | null {
  if (isKids(ctx.profile)) return null;
  const dark = darkMin(ctx.sky);
  const lit = stops.some((p) => hasTag(p, TAG_NIGHT) && legs.some((l) => l.kind === "STAY" && l.placeId === p.id && l.toMin > dark));
  return lit ? { text: "야경 · 해 진 뒤", tone: "SUN" } : null;
}

/** "해 지기 51분 전 귀가" (아이와만. 해 시각을 알고, 해 지기 2시간 안쪽에 도착할 때만). */
function sunReason(arriveMin: number, ctx: Ctx): Reason | null {
  // 어른끼리는 해 지기 전 귀가를 따지지 않는다
  if (!isKids(ctx.profile)) return null;
  const sunset = ctx.sky?.sunsetMin;
  if (sunset == null) return null;
  const left = sunset - arriveMin;
  if (left < 0 || left >= SUN_CHIP_MAX_MIN) return null;
  const text = left < 60 ? `${left}분` : left % 60 === 0 ? `${left / 60}시간` : `${Math.floor(left / 60)}시간 ${left % 60}분`;
  return { text: `해 지기 ${text} 전 귀가`, tone: "SUN" };
}

// ------------------------------------------------------------------ 밥 자리 넣기 (엔진 Meals.kt + Planner.mealize — 줄 단위로 같게)

/**
 * 식당 (엔진 Restaurant). kid = kids_menu · high_chair · play_room · floor_seat · stroller_ok · spicy_free_menu,
 * parkingHas = yes·no·limited, parkingFee = free·paid·partial, wait = {weekday, weekend_lunch, weekend_dinner: 0~2},
 * meal = lunch·dinner·snack (비면 카페·베이커리는 snack, 그 밖은 lunch·dinner), hours = 운영 시간 줄(브레이크·마지막 주문, 비면 11:00~21:00).
 */
export type Restaurant = {
  id: string;
  name: string;
  at: LatLng;
  cuisine?: string[];
  priceLevel?: number | null;
  kid?: string[];
  parkingHas?: string | null;
  parkingFee?: string | null;
  wait?: Record<string, number>;
  meal?: string[];
  dwellMin?: number | null;
  fit?: Partial<Record<Companion, number>> | null;
  tags?: string[];
  hours?: HoursRow[];
  placeId?: string | null;
};
/** 밥도 같이 짜기 켬: 후보 식당과 그날 날짜 (엔진 MealSetup). */
export type MealSetup = { restaurants: Restaurant[]; day?: string | null };
/** 다른 식당 후보 (엔진 MealAlt). index = 식당을 뺀 장소 목록에서 넣을 자리. */
export type MealAlt = {
  restaurantId: string; name: string; at: LatLng; index: number; startMin: number; endMin: number; detourMin: number;
  features: string[]; cuisine: string[]; openMin: number; closeMin: number; lastOrderMin: number | null; dwellMin: number;
};
/** 코스에 넣은 밥 자리 (엔진 MealStop). placeId = 'ext:food:<식당 id>', index = stops에서의 자리. */
export type MealStop = {
  restaurantId: string; placeId: string; name: string; kind: string; startMin: number; endMin: number; index: number; detourMin: number;
  features: string[]; cuisine: string[]; text: string; alternatives: MealAlt[];
};

export const MEAL_KIND = "meal";
export const MEAL_ID_PREFIX = "ext:food:";
export const MEAL_DWELL_MIN = 50;
export const MEAL_CAFE_DWELL_MIN = 30;
export const MEAL_DETOUR_MAX_MIN = 10;
export const MEAL_SPAN_MIN = 60;
export const MEAL_WAIT_MAX_MIN = 30;
export const MEAL_ALT_MAX = 3;
export const MEAL_DEFAULT_OPEN_MIN = 11 * 60;
export const MEAL_DEFAULT_CLOSE_MIN = 21 * 60;
export const MEAL_HINT_NONE = "근처에 등록된 식당이 없어요";
export const MEAL_HINT_TIGHT = "밥 넣을 시간이 빠듯해요";
const mealHintClosed = (w: MealWindow) => `${w.text} 때 문 연 식당이 없어요`;
export const MEAL_CAFE = ["카페", "베이커리"];
export type MealWindow = { key: "lunch" | "dinner"; text: string; fromMin: number; toMin: number; idealMin: number };
export const MEAL_LUNCH: MealWindow = { key: "lunch", text: "점심", fromMin: 11 * 60 + 30, toMin: 13 * 60 + 30, idealMin: 12 * 60 };
export const MEAL_DINNER: MealWindow = { key: "dinner", text: "저녁", fromMin: 17 * 60 + 30, toMin: 19 * 60 + 30, idealMin: 18 * 60 };
const MEAL_WINDOWS = [MEAL_LUNCH, MEAL_DINNER];
/** 아이 시설 글 (칩·화면, 이 순서로). */
export const MEAL_KID_TEXT: [string, string][] = [
  ["high_chair", "아이 의자"], ["kids_menu", "아이 메뉴"], ["play_room", "놀이방"],
  ["floor_seat", "좌식"], ["stroller_ok", "유모차 OK"], ["spicy_free_menu", "안 매운 메뉴"],
];
const MEAL_KID_KEYS = new Set(MEAL_KID_TEXT.map((x) => x[0]));
/** 동행마다 가점 받는 식당 표시. */
export const MEAL_COMPANION_TAG: Record<Companion, string> = { kids: "아이랑", couple: "뷰 맛집", friends: "노포", solo: "혼밥" };

/** 식사 자리인가 (엔진 Place.isMeal). */
export const isMealPlace = (p: { kind?: string | null }): boolean => p.kind === MEAL_KIND;
export const isMealId = (id: string): boolean => id.startsWith(MEAL_ID_PREFIX);
export const isCafe = (r: Restaurant): boolean => (r.cuisine ?? []).length > 0 && (r.cuisine ?? []).every((c) => MEAL_CAFE.includes(c));
export const mealDwellOf = (r: Restaurant): number => r.dwellMin ?? (isCafe(r) ? MEAL_CAFE_DWELL_MIN : MEAL_DWELL_MIN);
const serves = (r: Restaurant, w: MealWindow): boolean => ((r.meal ?? []).length ? (r.meal ?? []).includes(w.key) : !isCafe(r));
/** 주말(토·일·공휴일, 엔진 Meals.weekend). */
export function mealWeekend(day: string | null | undefined): boolean {
  if (day == null || !DATE_RE.test(day)) return false;
  const wd = weekdayOf(day);
  return wd === 0 || wd === 6 || isHoliday(day);
}
export type MealSession = { fromMin: number; toMin: number; lastOrderMin: number | null };
/** 그날 영업 구간 (엔진 Meals.sessions). 줄이 없으면 11:00~21:00, 날짜를 모르면 첫 줄, 그날 줄이 없으면 null. */
export function mealSessions(r: Restaurant, day: string | null | undefined): MealSession[] | null {
  const rows = r.hours ?? [];
  if (!rows.length) return [{ fromMin: MEAL_DEFAULT_OPEN_MIN, toMin: MEAL_DEFAULT_CLOSE_MIN, lastOrderMin: null }];
  const row = day != null && DATE_RE.test(day) ? pickHoursRow(rows, day) : rows[0];
  if (!row) return null;
  const out: MealSession[] = [];
  let from = row.openMin;
  for (const b of [...(row.breaks ?? [])].sort((a, c) => a.fromMin - c.fromMin)) {
    if (b.fromMin > from) out.push({ fromMin: from, toMin: b.fromMin, lastOrderMin: null });
    from = Math.max(from, b.toMin);
  }
  if (row.closeMin > from) out.push({ fromMin: from, toMin: row.closeMin, lastOrderMin: null });
  const lo = row.lastOrderMin ?? null;
  if (lo == null) return out;
  return out.filter((s) => s.fromMin <= lo).map((s) => (lo <= s.toMin ? { ...s, lastOrderMin: lo } : s));
}
function mealStartIn(sessions: MealSession[], arrive: number, dwell: number): [MealSession, number] | null {
  for (const s of sessions) {
    const start = Math.max(arrive, s.fromMin);
    if (start - arrive > MEAL_WAIT_MAX_MIN) return null;
    if (start + dwell > s.toMin) continue;
    if (s.lastOrderMin != null && start > s.lastOrderMin) continue;
    return [s, start];
  }
  return null;
}
const mealWaitLevel = (r: Restaurant, w: MealWindow, weekend: boolean): number =>
  clampNum(r.wait?.[!weekend ? "weekday" : w === MEAL_LUNCH ? "weekend_lunch" : "weekend_dinner"] ?? 0, 0, 2);
/** 식당 점수 (엔진 Meals.score). */
export function mealScore(r: Restaurant, c: Companion, w: MealWindow, weekend: boolean): number {
  let s = 2.0 * (r.fit?.[c] ?? COMPANION_DEFAULT_FIT);
  if (c === "kids") s += 0.25 * Math.min(4, (r.kid ?? []).filter((k) => MEAL_KID_KEYS.has(k)).length);
  if (r.parkingHas === "yes") s += r.parkingFee === "free" ? 0.75 : 0.5;
  else if (r.parkingHas === "no") s -= 0.5;
  s -= 0.5 * mealWaitLevel(r, w, weekend);
  if ((r.tags ?? []).includes(MEAL_COMPANION_TAG[c])) s += 0.5;
  return s;
}
/** 칩 괄호 안 특징 (엔진 Meals.features). */
export function mealFeatures(r: Restaurant, c: Companion, w: MealWindow, weekend: boolean): string[] {
  const out: string[] = [];
  if (c === "kids") {
    const k = MEAL_KID_TEXT.find(([key]) => (r.kid ?? []).includes(key));
    if (k) out.push(k[1]);
  }
  if (r.parkingHas === "yes" && r.parkingFee === "free") out.push("주차 무료");
  else if (r.parkingHas === "yes") out.push("주차 쉬움");
  const key = w === MEAL_LUNCH ? "weekend_lunch" : "weekend_dinner";
  if (weekend && r.wait?.[key] === 0) out.push("주말에도 덜 붐벼요");
  return out;
}
export const mealChipText = (startMin: number, w: MealWindow, name: string, features: string[]): string =>
  `${asHhmm(startMin)} ${w.text} · ${name}` + (features.length ? ` (${features.join("·")})` : "");
/** 식당 → 식사 자리 Place (엔진 Meals.placeOf). */
export function mealPlaceOf(r: Restaurant, s: MealSession, dwell: number): Place {
  const fit: Partial<Record<Companion, number>> = {};
  for (const c of COMPANIONS) if (c !== "kids" && r.fit?.[c] != null) fit[c] = r.fit[c];
  return {
    id: MEAL_ID_PREFIX + r.id, name: r.name, at: r.at, indoor: true, dwellP80Min: dwell, kidFit: r.fit?.kids ?? COMPANION_DEFAULT_FIT,
    openMin: s.fromMin, closeMin: s.toMin, popular: 0, stampable: false, adultDwellMin: dwell, lastEntryMin: s.lastOrderMin,
    kind: MEAL_KIND, tags: r.tags ?? [], fit: Object.keys(fit).length ? fit : null,
  };
}
const exitOf = (p: Place): LatLng => (isDrivePlace(p) ? p.route!.points[p.route!.points.length - 1] : p.at);

type MealCand = {
  r: Restaurant; gap: number; session: MealSession; start: number; dwell: number; detour: number;
  legs: Leg[]; arriveHome: number; firstLeg: number; score: number;
};
export type MealSpliced = { stops: Place[]; legs: Leg[]; arriveHome: number; firstLeg: number; meal: MealStop };
export type MealOutcome = { spliced: MealSpliced | null; hint: string | null };

/** 코스에 밥 자리를 넣는다 (엔진 Meals.plan). 밥 설정이 없거나 끼니 창을 안 지나면 null. */
export function planMeal(
  stops: Place[], legs: Leg[], here: LatLng, profile: FamilyProfile, safe: number, rain: number | null, lastOnly: boolean,
): MealOutcome | null {
  const setup = profile.meal;
  if (!setup) return null;
  if (stops.length === 0 || legs.length === 0 || stops.some(isMealPlace)) return null;
  const begin = legs[0].fromMin;
  const end = legs[legs.length - 1].toMin;
  const w = MEAL_WINDOWS.find((x) => Math.min(end, x.toMin) - Math.max(begin, x.fromMin) >= MEAL_SPAN_MIN);
  if (!w) return null;
  const day = setup.day ?? null;
  const weekend = mealWeekend(day);
  const comp = companionOf(profile);
  const cap = comp === "kids" ? AWAKE_DRIVE_MAX_MIN : ADULT_DRIVE_MAX_MIN;
  const n = stops.length;
  let near = false, open = false, tight = false;
  const cands: MealCand[] = [];
  const gaps = lastOnly ? [n] : Array.from({ length: n + 1 }, (_, i) => i);
  const rs = [...setup.restaurants].sort((a, b) => cmpStr(a.id, b.id));
  for (const g of gaps) {
    const moveIdx = g < n ? legs.findIndex((l) => !isStayLeg(l) && l.placeId === stops[g].id) : legs.length - 1;
    if (moveIdx < 0) continue;
    const move = legs[moveIdx];
    if (isStayLeg(move) || move.kind === "NAP_DRIVE") continue;
    const a = g === 0 ? here : exitOf(stops[g - 1]);
    const b = g < n ? stops[g].at : profile.home;
    const depart = move.fromMin;
    for (const r of rs) {
      if (!serves(r, w)) continue;
      const toR = TravelTime.minutes(a, r.at);
      const fromR = TravelTime.minutes(r.at, b);
      const detour = toR + fromR - legMinutes(move);
      if (detour > MEAL_DETOUR_MAX_MIN || toR > cap || fromR > cap) continue;
      near = true;
      const ses = mealSessions(r, day);
      if (!ses) continue;
      const dwell = mealDwellOf(r);
      const arrive = depart + toR;
      const st = mealStartIn(ses, arrive, dwell);
      if (!st) continue;
      const [s, start] = st;
      if (start < w.fromMin || start > w.toMin) continue;
      open = true;
      const out = mealShift(stops, legs, moveIdx, r, depart, toR, fromR, start, dwell, g < n, profile, safe, rain);
      if (!out) { tight = true; continue; }
      const first = g === 0 ? toR : legMinutes(legs.find((l) => !isStayLeg(l))!);
      const sc = mealScore(r, comp, w, weekend) - detour / 10.0 - Math.abs(start - w.idealMin) / 60.0 - (start - arrive) / 60.0;
      cands.push({ r, gap: g, session: s, start, dwell, detour, legs: out, arriveHome: out[out.length - 1].toMin, firstLeg: first, score: sc });
    }
  }
  if (cands.length === 0) return { spliced: null, hint: tight ? MEAL_HINT_TIGHT : open || near ? mealHintClosed(w) : MEAL_HINT_NONE };
  cands.sort((x, y) => cmpNum(y.score, x.score) || cmpNum(x.arriveHome, y.arriveHome) || cmpStr(x.r.id, y.r.id) || cmpNum(x.gap, y.gap));
  const best = cands[0];
  const perR = new Map<string, MealCand>();
  for (const c of cands) if (c.r.id !== best.r.id && !perR.has(c.r.id)) perR.set(c.r.id, c);
  const alts: MealCand[] = [];
  const used = new Set([(best.r.cuisine ?? [])[0] ?? ""]);
  for (const c of perR.values()) {
    if (alts.length >= MEAL_ALT_MAX) break;
    const k = (c.r.cuisine ?? [])[0] ?? "";
    if (!used.has(k)) { alts.push(c); used.add(k); }
  }
  for (const c of perR.values()) {
    if (alts.length >= MEAL_ALT_MAX) break;
    if (!alts.includes(c)) alts.push(c);
  }
  const feats = mealFeatures(best.r, comp, w, weekend);
  const place = mealPlaceOf(best.r, best.session, best.dwell);
  const meal: MealStop = {
    restaurantId: best.r.id, placeId: place.id, name: best.r.name, kind: w.key, startMin: best.start, endMin: best.start + best.dwell,
    index: best.gap, detourMin: best.detour, features: feats, cuisine: best.r.cuisine ?? [],
    text: mealChipText(best.start, w, best.r.name, feats),
    alternatives: alts.map((c) => ({
      restaurantId: c.r.id, name: c.r.name, at: c.r.at, index: c.gap, startMin: c.start, endMin: c.start + c.dwell, detourMin: c.detour,
      features: mealFeatures(c.r, comp, w, weekend), cuisine: c.r.cuisine ?? [], openMin: c.session.fromMin, closeMin: c.session.toMin,
      lastOrderMin: c.session.lastOrderMin, dwellMin: c.dwell,
    })),
  };
  const newStops = [...stops.slice(0, best.gap), place, ...stops.slice(best.gap)];
  return { spliced: { stops: newStops, legs: best.legs, arriveHome: best.arriveHome, firstLeg: best.firstLeg, meal }, hint: null };
}

function mealShift(
  stops: Place[], legs: Leg[], moveIdx: number, r: Restaurant, depart: number, toR: number, fromR: number, start: number, dwell: number,
  toPlace: boolean, profile: FamilyProfile, safe: number, rain: number | null,
): Leg[] | null {
  const move = legs[moveIdx];
  const id = MEAL_ID_PREFIX + r.id;
  const leave = start + dwell;
  const moveEnd = leave + fromR;
  const delta = moveEnd - move.toMin;
  const out: Leg[] = legs.slice(0, moveIdx);
  out.push({ kind: "DRIVE", fromMin: depart, toMin: depart + toR, placeId: id });
  out.push({ kind: "MEAL", fromMin: depart + toR, toMin: leave, placeId: id });
  out.push({ kind: toPlace ? "DRIVE" : "HOME", fromMin: leave, toMin: moveEnd, placeId: move.placeId });
  for (const l of legs.slice(moveIdx + 1)) {
    const nl: Leg = { ...l, fromMin: l.fromMin + delta, toMin: l.toMin + delta };
    if (l.kind === "NAP_DRIVE" && !TimeBudget.napAligned(nl.fromMin, legMinutes(nl), profile)) return null;
    if (isStayLeg(l)) {
      const p = stops.find((x) => x.id === l.placeId);
      if (p && !isDrivePlace(p)) {
        if (nl.toMin > p.closeMin) return null;
        if (p.lastEntryMin != null && Math.max(nl.fromMin, p.openMin) > p.lastEntryMin) return null;
        if (!p.indoor && rain != null && nl.toMin > rain && l.toMin <= rain) return null;
      }
    }
    out.push(nl);
  }
  if (out[out.length - 1].toMin > safe) return null;
  return out;
}

/** 밥 자리를 넣은 결과 (엔진 Planner.Mealed). 넣지 않았으면 stops·built 그대로. */
type Mealed = { stops: Place[]; built: Built; meal: MealStop | null; hint: string | null };

function mealize(stops: Place[], b: Built, ctx: Ctx, lastOnly = false): Mealed {
  const o = planMeal(stops, b.legs, ctx.here, ctx.profile, ctx.limit - TimeBudget.SAFETY_MIN, ctx.rain, lastOnly);
  if (!o) return { stops, built: b, meal: null, hint: null };
  const s = o.spliced;
  if (!s) return { stops, built: b, meal: null, hint: o.hint };
  const nap = s.legs.find((l) => l.kind === "NAP_DRIVE") ?? null;
  return { stops: s.stops, built: { ...b, legs: s.legs, firstLeg: s.firstLeg, arriveHome: s.arriveHome, napLeg: nap }, meal: s.meal, hint: null };
}

/** 밥 칩: 넣었으면 축제 칩 다음(없으면 맨 앞), 못 넣었으면 맨 끝에 까닭 (엔진 Planner.withMeal). */
function withMeal(rs: Reason[], m: Mealed): Reason[] {
  if (m.meal) {
    const i = rs[0]?.tone === "FESTIVAL" ? 1 : 0;
    return [...rs.slice(0, i), { text: m.meal.text, tone: "MEAL" }, ...rs.slice(i)];
  }
  if (m.hint) return [...rs, { text: m.hint, tone: "MEAL" }];
  return rs;
}

/** 카드에 붙이는 밥 칸 (켰을 때만 — 끔이면 칸 자체가 없어 예전 JSON과 같다). */
const mealFields = (m: Mealed): Pick<PlanOption, "meal" | "mealHint"> =>
  m.meal ? { meal: m.meal } : m.hint ? { mealHint: m.hint } : {};
