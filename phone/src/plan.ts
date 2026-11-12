// '오늘 어디 갈까요?' — 서버 API(web/src/app/api/plan·plan/choose·family)와 모양, 화면에 쓰는 작은 도우미.
// 계산은 전부 서버(엔진 규칙을 옮긴 planner.ts). 폰은 받아서 보여 주고 고르기만 한다.
import { ApiError, call } from './api';
import type { IconName } from './icon';
import type { OptionRoute } from './route';
import { clockHour } from './timefmt';

// ---------- 모양 (서버 lib/plan.ts의 OptionJson·SkyJson과 같음) ----------
export type LegKind = 'DRIVE' | 'STAY' | 'NAP_DRIVE' | 'HOME';
/** MEAL = 밥 칩 (새 서버, 식사 넣기) — 예전 앱은 모르는 색이라 보통 칩으로 */
export type Tone = 'PLAIN' | 'SUN' | 'NAP' | 'STAMP' | 'RAIN' | 'FESTIVAL' | 'AIR' | 'MEAL';
export type PlanMode = 'MORNING' | 'AFTERNOON' | 'REBOARD';

/** meal = 밥 먹는 머무름 (새 서버 — kind는 'STAY' 그대로, 식당 placeId 'ext:food:…') */
export type Leg = { kind: LegKind; fromMin: number; toMin: number; placeId: string | null; meal?: boolean };
export type Reason = { text: string; tone: Tone };
/** dwell = 이 카드에서 머무는 시간 예상과 출처 (서버가 붙임, 예전 계획엔 없음) */
export type Stop = {
  id: string; name: string; lat: number; lng: number; indoor: boolean; stampable: boolean;
  dwell?: { minutes: number; source: 'family' | 'crowd' | 'base'; n: number; text: string };
  /** 바깥 장소(ext:tour:…)만 — 장소표에 없어서 이름·좌표·머무름·운영 시각(분)을 같이 싣는다 (서버 lib/ext.ts) */
  ext?: ExtJson;
};
export type ExtJson = { name: string; lat: number; lng: number; indoor: boolean; dwell: number; open: number; close: number; kidFit: number; lastEntry?: number };

// ---------- 밥 자리 (식사 넣기 — 서버 lib/plan.ts MealJson, 엔진 Meals) ----------
/** 다른 식당 후보. index = 식당을 뺀 곳 목록에서 넣을 자리, ext = 코스에 넣을 때 보낼 칸 */
export type MealAlt = {
  restaurantId: string; placeId: string; name: string; lat: number; lng: number; index: number; startMin: number; start: string; detourMin: number;
  features: string[]; cuisine: string[]; ext: ExtJson;
};
/** 넣은 밥 자리. kind lunch·dinner, text = 칩 글 '12:10 점심 · 할매칼국수 (아이 의자·주차 무료)' */
export type MealJson = {
  restaurantId: string; placeId: string; name: string; kind: 'lunch' | 'dinner' | string; startMin: number; endMin: number; start: string; end: string;
  index: number; detourMin: number; features: string[]; cuisine: string[]; text: string; alternatives: MealAlt[];
};
/** 밥 자리(식당) id인가 — 'ext:food:<식당 id>' (도장 없음, 다녀오면 일기에 '점심은 ○○에서') */
export const isMealStop = (id: string) => id.startsWith('ext:food:');
export const MEAL_WORD = (kind: string) => (kind === 'dinner' ? '저녁' : '점심');
/** 코스가 점심(11:30~13:30)·저녁(17:30~19:30) 때를 60분 넘게 지나나 (서버 엔진 Meals와 같은 기준) — '점심도 넣어 줘요'를 보일지 */
export function mealWindowOf(o: { legs: Leg[]; arriveHomeMin: number }): 'lunch' | 'dinner' | null {
  const begin = o.legs[0]?.fromMin;
  if (begin == null) return null;
  const end = o.arriveHomeMin;
  if (Math.min(end, 810) - Math.max(begin, 690) >= 60) return 'lunch';
  if (Math.min(end, 1170) - Math.max(begin, 1050) >= 60) return 'dinner';
  return null;
}
/**
 * 밥 자리 바꾸기·빼기로 보낼 곳 목록 (choose·preview stops): 식당을 뺀 곳들 + [alt]를 그 자리에.
 * 바깥 장소(ext)는 이름·좌표째, 그 밖은 id.
 */
export function stopsWithMeal(o: PlanOption, alt: MealAlt | null): StopRef[] {
  const base: StopRef[] = o.stops.filter((s) => !isMealStop(s.id)).map((s) => (s.ext ? { id: s.id, ...s.ext } : s.id));
  if (!alt) return base;
  const at = Math.max(0, Math.min(alt.index, base.length));
  return [...base.slice(0, at), { id: alt.placeId, ...alt.ext }, ...base.slice(at)];
}
/** '왜?' 설명 한 줄 (엔진 explainChoice — 점수에 실제로 들어간 항목을 쉬운 말로). tone = 이유 칩과 같은 색 */
export type WhyLine = { text: string; tone: Tone };
export type StopWhy = { placeId: string; lines: WhyLine[] };
export type PlanOption = {
  kind: 'COURSE' | 'NEARBY' | 'HOMEWARD' | 'GO_HOME' | string;
  label: string;
  stops: Stop[];
  firstLegMin: number;
  detourMin: number | null;
  arriveHomeMin: number;
  arriveHome: string;
  legs: Leg[];
  reasons: Reason[];
  /** 장소마다 '왜?' 설명 (예전 계획엔 없음 → 'ⓘ 왜?'를 안 보임) */
  why?: StopWhy[];
  /** 귀가 한계를 넘는 카드 (앵커 코스 '여기만') — 고르면 '오늘만 귀가 한계 늦추기'를 묻는다 */
  overLimit?: boolean;
  /** 앵커 코스 카드면 앵커 id */
  anchorId?: string;
  /** 카드 모양 (새 서버 — kind는 차 앱이 읽는 예전 값 그대로) */
  pick?: OptionShape;
  /** 실제 길로 다시 잰 값 (새 서버, 카카오모빌리티) — legs·arriveHomeMin은 이미 이 값으로 바뀌어 온다 */
  route?: OptionRoute;
  /** 넣은 밥 자리 (새 서버, 밥 켬) — 식당은 stops에도 'ext:food:…'로 있다 */
  meal?: MealJson;
  /** 밥 자리를 못 넣은 까닭 ('근처에 등록된 식당이 없어요' …) */
  mealHint?: string;
};
/** 누구랑 가요? (대화형 고르기 · 서버 계약 with=) */
export type Companion = 'kids' | 'couple' | 'friends' | 'solo';
export const COMPANIONS: Companion[] = ['kids', 'couple', 'friends', 'solo'];
export const isCompanion = (v: unknown): v is Companion => typeof v === 'string' && (COMPANIONS as string[]).includes(v);
/** 카드 종류 (새 서버 options[i].kind). 예전 서버는 COURSE·NEARBY… → 폰이 어림(ask.ts optionShape) */
/** evening = 저녁에 잠깐(야경·노을·늦게 여는 실내) · drive = 야경 드라이브 (새 서버, 저녁 나들이) */
export type OptionShape = 'short' | 'full' | 'nap' | 'indoor' | 'popular' | 'near' | 'home' | 'evening' | 'drive';
export type SkyJson = {
  sunrise: string | null; sunset: string | null; sky: 'CLEAR' | 'RAIN' | 'SNOW' | 'UNKNOWN' | string; rainFrom: string | null;
  sunSource: string; weatherSource: string;
  hours: { at: string; pop: number | null; pty: number | null }[];
  /** 지금 미세먼지 (에어코리아 가까운 측정소). 예전 서버·키 없음이면 없거나 UNKNOWN */
  air?: AirJson;
  /** 지금 기온(℃) — 새 서버 */
  temp?: number | null;
  /** 해가 이미 졌을 때 '내일 노을 보러' 명소 (새 서버, 저녁 계획에만) */
  sunsetTip?: { placeId: string; name: string; sunset: string; arriveBy: string } | null;
};
export type AirLevel = 'GOOD' | 'NORMAL' | 'BAD' | 'VERY_BAD' | 'UNKNOWN';
export type AirJson = { level: AirLevel; pm10: number | null; pm25: number | null; station: string | null; source: 'airkorea' | 'none' };
export type PlanRes = {
  planId: string;
  day: string;
  reused: boolean;
  plan: { mode: PlanMode; now: string; nowMin: number; budgetMin: number; backByMin: number; options: PlanOption[] };
  sky: SkyJson | null;
  backBy: string;
  chosen: number | null;
  /** '차' 또는 '폰:엄마' */
  chosenBy: string | null;
  createdAt: string;
  /** 이 계획을 짠 동행 (새 서버) */
  companion?: Companion;
  /** 밤: 내일 계획 힌트 (새 서버 — 있으면 '내일 미리 정해 둘까요?' 질문) */
  tomorrowHint?: boolean | { day?: string; text?: string } | string | null;
  /** tomorrowHint와 같이 오는 내일 날짜 */
  tomorrow?: string;
  /** 저녁 나들이 계획 (새 서버) — 해 진 뒤 ~ 귀가 한계 90분 전. 카드 label '저녁 · …', pick evening·drive */
  evening?: boolean;
  /** 저녁 계획의 귀가 한계 'HH:MM' (아이와 = 잠자는 시간 · 어른끼리 = 늦어도 몇 시 귀가) */
  eveningLimit?: string;
  /** 이 계획을 밥 켬으로 짰나 (새 서버) */
  meal?: boolean;
};
export type ChooseRes = { ok: true; planId: string; chosen: number | null; chosenBy: string | null; pushed: number };

export type Family = {
  kidAges: number[];
  /** 낮잠 시작·길이(분). 낮잠 없으면 둘 다 null */
  napStart: number | null;
  napLen: number | null;
  /** 'sunset-30' | 'at:17:30' */
  backBy: string;
  /** 저녁 시각(분). null이면 따지지 않음 */
  dinner: number | null;
  /** 집 [위도, 경도] — 서버는 소수 셋째 자리(약 100m)로만 저장. 안 정했으면 null(차가 아는 집으로 계산) */
  home?: [number, number] | null;
  /** 즐겨찾는 도착지 (할머니 집 등) — 오늘 도착지 고르기에 씀 */
  favorites?: Favorite[];
  /** 지난번 고른 동행 (새 서버, 대화형 고르기가 기억) */
  companion?: Companion | null;
  /** 아이 잠자는 시간(분, 기본 21:00) — 아이와 저녁 나들이 귀가 한계 (새 서버) */
  bedtime?: number;
  /** 어른끼리 '늦어도 몇 시 귀가'(분, 기본 23:00) (새 서버) */
  lateReturn?: number;
  /** '밥도 같이 짜기' (새 서버, 기본 끔) — 켜면 코스가 점심·저녁 때를 지날 때 식당 한 곳을 넣는다 */
  mealPlan?: boolean;
};
export type Favorite = { name: string; lat: number; lng: number };
/** 머무는 편: 빨리 둘러봐요 0.8× · 보통 1.0× · 오래 놀아요 1.25× (바꾸면 머무름 배율을 이 값으로 다시 시작) */
export type DwellPref = 'quick' | 'normal' | 'long';
export type FamilyView = Family & {
  saved: boolean; text: { nap: string; backBy: string; dinner: string; home?: string; bedtime?: string; lateReturn?: string; mealPlan?: string };
  dwellPref?: DwellPref;
  /** 우리 가족 머무름: text 예 '우리 가족은 보통 1.2배 머물러요 (5번 기록)' */
  dwell?: { pref: DwellPref; factor: number; n: number; text: string };
};

/** 데모 차에서만 쓰는 시험 값 (개발 탭 '추천 시험') */
export type PlanExtra = { at?: string; sky?: 'CLEAR' | 'RAIN' | 'SNOW' | 'UNKNOWN'; rainFrom?: string; sunset?: string; air?: AirLevel; fresh?: boolean;
  /** 대화형 고르기: 누구랑 · 어느 날(YYYY-MM-DD) · 코스 한 장의 곳 수 한도('가볍게 한 곳만' = 1, 예전 서버는 무시) */
  with?: Companion; day?: string; maxStops?: number;
  /** 이 계획만 밥 자리 넣기 켬·끔 (없으면 가족 설정 — 예전 서버는 무시) */
  meal?: boolean };

// ---------- API ----------
export function getPlan(token: string, loc: { lat: number; lng: number } | null, extra?: PlanExtra) {
  const q: string[] = [];
  if (loc) q.push(`lat=${loc.lat.toFixed(4)}`, `lng=${loc.lng.toFixed(4)}`);
  if (extra?.at) q.push(`at=${encodeURIComponent(extra.at)}`);
  if (extra?.sky) q.push(`sky=${extra.sky}`);
  if (extra?.rainFrom) q.push(`rainFrom=${encodeURIComponent(extra.rainFrom)}`);
  if (extra?.sunset) q.push(`sunset=${encodeURIComponent(extra.sunset)}`);
  if (extra?.air) q.push(`air=${extra.air}`);
  if (extra?.fresh) q.push('fresh=1');
  if (extra?.with) q.push(`with=${extra.with}`);
  if (extra?.day) q.push(`day=${extra.day}`);
  if (extra?.maxStops) q.push(`maxStops=${extra.maxStops}`);
  if (extra?.meal != null) q.push(`meal=${extra.meal ? 1 : 0}`);
  return call<PlanRes>(token, 'GET', `/api/plan${q.length ? `?${q.join('&')}` : ''}`);
}

/** idx null = 고른 것 취소 */
export const choosePlan = (token: string, planId: string, idx: number | null) =>
  call<ChooseRes>(token, 'POST', '/api/plan/choose', { planId, idx });
/** 정한 장소 순서(1~3곳)로 '고른 코스' 카드를 만들어 고른다 (서버가 계획 카드 끝에 붙임, 모든 차 — 코스 편집·데모 시연) */
/** 한 칸 = 장소 id, 또는 바깥 장소 {id, name, lat, lng, …}(앵커 카드에 실려 온 ext). anchor = 앵커 코스를 고친 것('○○ 중심으로' 규칙) */
export type StopRef = string | ({ id: string } & Record<string, unknown>);
export const chooseCourse = (token: string, planId: string, stops: StopRef[], dwell?: Record<string, number>, anchor?: string) =>
  call<ChooseRes>(token, 'POST', '/api/plan/choose', {
    planId, stops, ...(dwell && Object.keys(dwell).length ? { dwell } : {}), ...(anchor ? { anchor } : {}),
  });

/** 더할 곳 후보 (코스에서 가까운 순): 실내 여부·우리 가족 머무름(분)·거리(km) */
export type PlaceCand = { id: string; name: string; indoor: boolean; stampable: boolean; dwell: number; km: number };
/**
 * 코스 편집 미리 보기 (저장 안 함). live = 다녀온 곳이 있는 코스 → stops는 남은 곳, 답은 course(살아 있는 코스 JSON).
 * 아니면 option(카드). over = 귀가 한계를 넘음, fits = 머무름을 안 바꾼 이 순서를 고를 수 있음.
 */
export type PreviewRes = {
  ok: true; live?: boolean;
  option?: PlanOption;
  course?: { arriveHomeMin: number; limitMin: number; stops: { placeId: string; status: string; plannedArriveMin: number; dwellGuessMin: number }[]; legs: Leg[] };
  limitMin: number; limit: string; over: boolean; overMin: number; fits: boolean;
  places?: PlaceCand[];
};
export const previewCourse = (token: string, body: { planId: string; stops: StopRef[]; dwell?: Record<string, number>; places?: boolean; live?: boolean; anchor?: string }) =>
  call<PreviewRes>(token, 'POST', '/api/plan/preview', body);

// ---------- 내가 고르기: 앵커 코스 ('○○ 중심으로', POST /api/plan/anchor) ----------
export type AnchorKind = 'place' | 'festival' | 'tour';
/** 고른 곳. tour(바깥 장소)는 이름·좌표가 꼭 있어야 한다. open·close = 분 */
export type AnchorIn = { kind: AnchorKind; id: string; name: string; lat: number; lng: number; dwell?: number; indoor?: boolean; open?: number; close?: number };
export type AnchorRes = {
  planId: string; day: string;
  anchor: { kind: AnchorKind; id: string; name: string; dwell: number; oneWayMin: number; overnight: boolean; closed: boolean };
  plan: { mode: PlanMode; now: string; nowMin: number; budgetMin: number; backByMin: number; options: PlanOption[] };
  sky: SkyJson | null; backBy: string;
};
export const anchorPlan = (token: string, anchor: AnchorIn, day?: string, withC?: Companion, meal?: boolean) =>
  call<AnchorRes>(token, 'POST', '/api/plan/anchor', { anchor, ...(day ? { day } : {}), ...(withC ? { with: withC } : {}), ...(meal != null ? { meal } : {}) });
/** 앵커 카드 고르기: 카드 순서 그대로 + 앵커 머무름 + anchor (바깥 장소는 이름·좌표째) */
export const chooseAnchorCourse = (token: string, planId: string, o: PlanOption, dwell: Record<string, number>) =>
  call<ChooseRes>(token, 'POST', '/api/plan/choose', {
    planId, dwell, anchor: o.anchorId,
    stops: o.stops.map((s) => (s.ext ? { id: s.id, ...s.ext } : s.id)),
  });

/** 즐겨찾는 장소 (추천 점수 +1) */
export const getFavPlaces = (token: string) => call<{ placeIds: string[] }>(token, 'GET', '/api/plan/favorite');
export const setFavPlace = (token: string, placeId: string, on: boolean) => call<{ placeIds: string[] }>(token, 'POST', '/api/plan/favorite', { placeId, on });

// ---------- 둘러보기 목록 (/api/explore/*, 서버 lib/explore-shape.ts ExploreItem) ----------
export type ExploreItem = {
  kind: 'festival' | 'place' | 'tour'; id: string; name: string; starts?: string; ends?: string;
  lat: number; lng: number; addr: string; image: string | null; driveMin: number | null; indoor?: boolean;
  ourStamp: boolean; thisWeekend?: boolean; ourPlaceId?: string | null; type?: string; area?: string; no?: number; contentId?: string;
  /** ?with= 목록: 그 동행에 맞는지 (+1 잘 맞음 · 0 · -1 덜 맞음) + 짧은 글 ('어른 위주 행사') */
  fitSign?: number; fitNote?: string;
};
/** soon = 서버에 아직 그 목록이 없음(404) · ok = 목록 (tourOk=false면 관광공사 목록을 못 받아 우리 것만) */
export type ExploreList = { status: 'ok'; items: ExploreItem[]; tourOk: boolean } | { status: 'soon' };
export async function getExplore(token: string, kind: 'festivals' | 'kto100' | 'search', opts: { q?: string; scope?: 'near' | 'all' } = {}): Promise<ExploreList> {
  const q: string[] = [];
  if (opts.scope) q.push(`scope=${opts.scope}`);
  if (opts.q) q.push(`q=${encodeURIComponent(opts.q)}`);
  try {
    const r = await call<{ items?: ExploreItem[]; tour?: { ok?: boolean } }>(token, 'GET', `/api/explore/${kind}${q.length ? `?${q.join('&')}` : ''}`);
    return { status: 'ok', items: r.items ?? [], tourOk: r.tour?.ok !== false };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return { status: 'soon' };
    throw e;
  }
}

export const getFamily = (token: string) => call<FamilyView>(token, 'GET', '/api/family');
export const putFamily = (token: string, f: Partial<Family> & { dwellPref?: DwellPref }) => call<FamilyView>(token, 'PUT', '/api/family', f);

export const DEFAULT_FAMILY: Family = { kidAges: [4, 4], napStart: 13 * 60, napLen: 90, backBy: 'sunset-30', dinner: 18 * 60 + 30, home: null, favorites: [], bedtime: 21 * 60, lateReturn: 23 * 60 };
/** 저녁 나들이 귀가 기준 기본값 (엔진 FamilyProfile.DEFAULT_BEDTIME_MIN · DEFAULT_LATE_RETURN_MIN) */
export const DEFAULT_BEDTIME = 21 * 60;
export const DEFAULT_LATE_RETURN = 23 * 60;

// ---------- 글 도우미 ----------
/** 분 → 'HH:MM' — 서버로 보내거나 다시 읽는 값(데이터)용. 화면에 보일 시각은 timefmt.ts clock() */
export const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const toMin = (s: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** 93 → '1시간 33분' */
export const span = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`;
};

/** 받침이 있으면 '이', 없으면 '가' (엄마가 · 할아버지가 · 삼촌이) */
export function iGa(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 === 0 ? '가' : '이';
  return '가';
}

/** 카드 제목: 장소들을 화살표로 */
export const optionTitle = (o: PlanOption) => (o.stops.length ? o.stops.map((s) => s.name).join(' → ') : '바로 집으로');

/** 카드 한 줄 설명: 첫 이동 · 도장 · 귀가 */
export function optionMeta(o: PlanOption) {
  if (!o.stops.length) return `${o.firstLegMin}분 · ${o.arriveHome} 도착`;
  const stamps = o.stops.filter((s) => s.stampable).length;
  return [`첫 이동 ${o.firstLegMin}분`, stamps ? `도장 ${stamps}` : null, `${o.arriveHome} 귀가`].filter(Boolean).join(' · ');
}

/** 하늘 칩 (아이콘 + 글). 날씨를 모르면 null */
export function weatherText(sky: SkyJson | null): { icon: IconName; text: string } | null {
  if (!sky) return null;
  const from = toMin(sky.rainFrom);
  const fromText = sky.rainFrom ? `${clockHour(Number(sky.rainFrom.slice(0, 2)))}부터 비` : null;
  if (sky.sky === 'RAIN') return { icon: 'cloud-rain', text: '비 와요 · 실내 위주' };
  if (sky.sky === 'SNOW') return { icon: 'snowflake', text: '눈 와요' };
  if (sky.sky === 'CLEAR') return { icon: 'sun', text: fromText ? `${from != null && from >= 12 * 60 ? '오전 맑음' : '맑다가'} · ${fromText}` : '맑음' };
  return fromText ? { icon: 'cloud-rain', text: fromText } : null;
}

const AIR_TEXT: Record<AirLevel, string> = { GOOD: '좋음', NORMAL: '보통', BAD: '나쁨', VERY_BAD: '매우 나쁨', UNKNOWN: '모름' };

/** 미세먼지 칩: '미세먼지 나쁨' (나쁨 이상이면 bad = 주황빨강). 모르면 null */
export function airText(sky: SkyJson | null): { icon: IconName; text: string; bad: boolean } | null {
  const a = sky?.air;
  if (!a || a.level === 'UNKNOWN' || !(a.level in AIR_TEXT)) return null;
  return { icon: 'wind', text: `미세먼지 ${AIR_TEXT[a.level]}`, bad: a.level === 'BAD' || a.level === 'VERY_BAD' };
}

/** '폰:엄마' → { who: '엄마', car: false } */
export function chooser(by: string | null): { car: boolean; who: string } | null {
  if (!by) return null;
  if (by === '차') return { car: true, who: '차' };
  return { car: false, who: by.replace(/^폰:/, '') };
}

/** 이유 칩 아이콘: 색(tone)과 글로 고른다. 맞는 게 없으면 아이콘 없이 */
export function reasonIcon(r: Reason): IconName | null {
  switch (r.tone) {
    case 'NAP': return 'moon';
    case 'RAIN': return 'cloud-rain';
    case 'STAMP': return 'stamp';
    case 'FESTIVAL': return 'party-popper';
    case 'AIR': return 'wind';
    case 'MEAL': return 'utensils';
    case 'SUN': return /해/.test(r.text) ? 'sunset' : 'sun';
  }
  if (/귀가|집/.test(r.text)) return 'house';
  // 오늘만 바꾼 도착지 ('약속 장소 16:29 도착'처럼 집이 아닌 곳)
  if (/ \d{1,2}:\d{2} 도착$/.test(r.text)) return 'map-pin';
  if (/가까워요|우회/.test(r.text)) return 'route';
  if (/많이 감/.test(r.text)) return 'users';
  return null;
}

/** 아이 칩: [4,4] → '4살 2명', [3,6] → '3살 · 6살' */
export function kidsText(ages: number[]) {
  if (!ages.length) return '아이 없음';
  return ages.every((a) => a === ages[0]) ? `${ages[0]}살${ages.length > 1 ? ` ${ages.length}명` : ''}` : ages.map((a) => `${a}살`).join(' · ');
}

/** 장소 하나의 '보통 머무는 시간' (GET /api/family/dwell?place=) — 출처 글 + 같은 또래 글(10가족 이상일 때만) */
export type PlaceDwellView = { minutes: number; source: 'family' | 'crowd' | 'base'; n: number; text: string; crowd: string | null };
export const getPlaceDwell = (token: string, placeId: string) =>
  call<{ chip: string | null; place: PlaceDwellView }>(token, 'GET', `/api/family/dwell?place=${encodeURIComponent(placeId)}`);

/** 카드의 한 곳 머무름(분): 서버 dwell, 없으면 하루 막대의 머무름 칸 */
export function stopDwell(o: PlanOption, st: Stop): number {
  return st.dwell?.minutes ?? o.legs.filter((l) => l.kind === 'STAY' && l.placeId === st.id).reduce((a, l) => a + l.toMin - l.fromMin, 0);
}

/**
 * 고르기 전 카드에서 머무름만 바꿔 보기 (폰 안에서만): 그곳 머무름 칸을 늘리거나 줄이고 그 뒤 칸을 모두 같은 만큼 민다.
 * 문 닫는 시각·낮잠은 다시 따지지 않는 어림 — 고르면 서버 엔진(SetDwell)이 정확히 다시 짠다.
 */
export function withDwellOverrides(o: PlanOption, ov: Record<string, number> | undefined): PlanOption {
  if (!ov || !Object.keys(ov).length) return o;
  let legs = o.legs.map((l) => ({ ...l }));
  let shift = 0;
  const stops = o.stops.map((st) => {
    const want = ov[st.id];
    if (want == null) return st;
    const cur = stopDwell(o, st);
    const delta = want - cur;
    // 그곳의 마지막 머무름 칸 끝을 delta만큼, 그 뒤 칸은 모두 delta만큼
    const at = legs.map((l) => l.kind === 'STAY' && l.placeId === st.id).lastIndexOf(true);
    if (at >= 0 && delta) {
      legs = legs.map((l, i) => (i === at ? { ...l, toMin: l.toMin + delta } : i > at ? { ...l, fromMin: l.fromMin + delta, toMin: l.toMin + delta } : l));
      shift += delta;
    }
    return { ...st, dwell: st.dwell ? { ...st.dwell, minutes: want } : { minutes: want, source: 'base' as const, n: 0, text: '' } };
  });
  const arriveHomeMin = o.arriveHomeMin + shift;
  return { ...o, stops, legs, arriveHomeMin, arriveHome: hhmm(arriveHomeMin) };
}
