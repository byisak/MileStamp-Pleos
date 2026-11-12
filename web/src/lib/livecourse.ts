/*
 * 살아 있는 코스 — 엔진 `engine/src/main/kotlin/kr/milestamp/engine/LiveCourse.kt`(자료) +
 * `LiveCourseEngine.kt`(판정)를 줄 단위로 옮긴 것. 계획: docs/코스-고도화-계획.md 2절·10절.
 * 차(Kotlin)와 서버(TS)가 같은 사건에 같은 답을 내야 하므로 계산 순서·동점 처리·반올림·글자까지 엔진과 똑같이 둔다.
 * 두 쪽이 같은 시험 사례(`engine/src/test/resources/plan-live-cases.json`)로 한 글자까지 같은지 확인한다(`npm test`).
 * 엔진을 고치면 여기도 같이 고친다. 시각은 모두 '그날 0시부터 분'.
 */
import {
  AIR_TEXT, airIsBad, airReason, asHhmm, clampUserDwell, dwellFor, festivalReason, forDay, hhmm, km, rainStartMin, reboard, round5, TimeBudget, TravelTime, DwellLearning,
  AWAKE_DRIVE_MAX_MIN, MAX_WAIT_MIN, MIN_VISIT_MIN, NAP_DEPART_BEFORE_MIN, NAP_STRETCH_MAX_MIN, RAIN_SOON_MIN,
  isMealPlace, isStayLeg, legOfJson, type AirLevel, type FamilyProfile, type LatLng, type Leg, type Place, type PlanOption, type Reason, type Sky, type SkyToday,
} from "./planner";

/** 이름을 모르는 바깥 장소('ext:…')를 보일 때 쓰는 말 — 날 id를 사람에게 보이지 않는다 (엔진 UNNAMED_EXT와 같음). */
export const UNNAMED_EXT = "고른 곳";

/**
 * 곳 이름 하나로 정하기 (엔진 stopName과 같음): 코스·계획에 실려 온 이름 → 없으면 바깥 장소('ext:…')는 '고른 곳', 그 밖은 id.
 * 장소 목록(명소)에서 먼저 찾는 것은 부르는 쪽이 한다.
 */
export function stopName(id: string, payloadName?: string | null): string {
  const n = typeof payloadName === "string" ? payloadName.trim() : "";
  return n || (id.startsWith("ext:") ? UNNAMED_EXT : id);
}

// ------------------------------------------------------------------ 자료 (LiveCourse.kt)

/** 장소 하나의 진행 상태: 아직 갈 곳 · 다음 목적지 · 지금 머무는 중 · 다녀옴 · 뺌. */
export type StopStatus = "PLANNED" | "NEXT" | "ARRIVED" | "DONE" | "SKIPPED";

/** 코스 안의 장소 하나. 예정 시각은 시간표를 다시 짤 때마다 갱신, 실제 시각은 신호로 채운다. */
export type LiveStop = {
  place: Place;
  status: StopStatus;
  plannedArriveMin: number;
  plannedDepartMin: number;
  actualArriveMin: number | null;
  actualDepartMin: number | null;
  /** 지금 쓰는 머무름 예상(분). 장소 P80에 오늘 패턴(×0.9)·사용자 '덜 놀기'를 반영. */
  dwellGuessMin: number;
  /** 건너뛴 까닭 (SKIPPED일 때만): "문 닫음" = 문 닫을 시간이라 못 감(Tick·PlaceClosed). 사람이 뺀 곳은 null. */
  skipReason: string | null;
  /** 사람이 오늘만 직접 정한 머무름(SetDwell·ExtendStay) — 오늘 패턴 ×0.9가 덮어쓰지 않는다. */
  dwellSet: boolean;
};

const remainingStop = (s: LiveStop) => s.status === "PLANNED" || s.status === "NEXT";

function liveStop(
  place: Place, status: StopStatus, plannedArriveMin: number, plannedDepartMin: number, dwellGuessMin: number,
  actualArriveMin: number | null = null, actualDepartMin: number | null = null, skipReason: string | null = null,
): LiveStop {
  return { place, status, plannedArriveMin, plannedDepartMin, actualArriveMin, actualDepartMin, dwellGuessMin, skipReason, dwellSet: false };
}

/** 변경의 크기. QUIET = 시간표만(칩 없음) · SOFT = 칩 한 줄 · LOUD = 칩 + 음성 한 문장. */
export type ChangeSize = "QUIET" | "SOFT" | "LOUD";

/** 마지막 변경. text는 칩 글(40자 이내), cause는 원인 이름(같은 원인은 30분에 한 번만 LOUD), deltaHomeMin은 귀가 예정이 움직인 분(+ 늦어짐). */
export type Change = { text: string; cause: string; deltaHomeMin: number; size: ChangeSize; atMin: number };

/** 들어오는 사건. 시각은 모두 '그날 0시부터 분'. 장소는 id. */
export type CourseEvent =
  /** 출발 또는 출발 준비(재탑승). from은 떠나는 장소 id, 집·길 위면 null. */
  | { type: "Departed"; nowMin: number; from: string | null }
  /** 장소 도착(P + 반경 안). */
  | { type: "Arrived"; nowMin: number; placeId: string }
  /** 아직 서 있음 — 예정 출발이 지났거나(5분마다) 장소 아닌 곳에 10분 넘게 정차. */
  | { type: "StillParked"; nowMin: number }
  /** 내비 남은 시간(분). 두 번 연속 같은 방향으로 어림과 ≥8분 또는 15% 다를 때만 반영. */
  | { type: "NaviEta"; nowMin: number; remainMin: number }
  /**
   * 아직 달리는 중인데 다음 곳 예정 도착(−2분)이 지났고 최근 10분 동안 내비 ETA가 없음 (차가 주행 중 5분마다).
   * here에서 남은 구간을 보정된 계수로 다시 어림(최소 3분)해 시간표를 민다. 내비 ETA가 있으면 그쪽을 쓴다.
   */
  | { type: "StillDriving"; nowMin: number; here: LatLng }
  /** 다음 목적지를 이곳으로 (원래 다음 곳은 그 뒤로 밀림). */
  | { type: "ReplaceNext"; nowMin: number; placeId: string }
  /** 이 장소 빼기·건너뛰기 (지금 머무는 곳이면 지금 나서기). */
  | { type: "Skip"; nowMin: number; placeId: string }
  /** 들르기 — 남은 자리마다 넣어 보고 되는 쪽. */
  | { type: "Insert"; nowMin: number; placeId: string }
  /**
   * 날씨 갱신. 지금 비면 sky = RAIN, 아니면 rainFromMin에 비 시작 시각(없으면 null).
   * air는 미세먼지 등급 (없음 = 이번엔 모름, 코스가 아는 값을 그대로). 나쁨 이상인데 남은 곳에 야외가 있으면 경고 칩.
   */
  | { type: "Weather"; nowMin: number; sky: Sky; rainFromMin: number | null; air?: AirLevel | null }
  /** 문 닫음·휴무 → 그 장소는 못 가니 교체안. */
  | { type: "PlaceClosed"; nowMin: number; placeId: string }
  /** 지금 집으로. */
  | { type: "GoHome"; nowMin: number }
  /** 귀가 한계가 바뀜 (해 짐 갱신·저녁·가족 설정). */
  | { type: "LimitChanged"; nowMin: number; limitMin: number }
  /** 폰·서버가 바꾼 코스. 버전이 낮으면 무시, 높으면 받아들임, 같으면 실제 신호를 가진 차 것이 이김. */
  | { type: "Remote"; nowMin: number; version: number; course: LiveCourse }
  /**
   * 시간이 흘렀다 (서버가 코스를 꺼낼 때·화면 설명). 시간표가 behindMin 5분 넘게 뒤처졌거나 문 닫기 전에 못 가는 곳이 있으면
   * 지금 시각으로 다시 짠다. 문 닫을 시간이라 못 가는 곳은 건너뛴다(SKIPPED). 그 밖이면 NoChange.
   */
  | { type: "Tick"; nowMin: number }
  /** 이 장소에서 머무는 시간을 오늘만 minutes분으로 (15~360분, 5분 단위). 머무는 중인 곳이면 도착부터 센 전체 시간. 원인 "머무름". */
  | { type: "SetDwell"; nowMin: number; placeId: string; minutes: number }
  /** 지금 머무는 곳에서 앞으로 minutes분 더 (0 = 지금 나갈게요, 360분까지, 5분 단위). 머무는 곳이 없으면 NoChange. */
  | { type: "ExtendStay"; nowMin: number; minutes: number }
  /**
   * 오늘만 바꾸는 코스 끝 (폰 '도착 시간·도착지' 시트). 넣은 칸만 바뀐다.
   * end = 새 도착지, toHome = 집으로 되돌림, limitMin = 오늘만 도착 목표(넣으면 그 뒤 LimitChanged 무시), napOff = 오늘 낮잠 안 잠.
   */
  | { type: "SetEnd"; nowMin: number; end: CourseEnd | null; toHome: boolean; limitMin: number | null; napOff: boolean | null };

/** 오늘 코스의 끝(도착지). 코스의 end가 null이면 집(profile.home). 좌표는 서버에 소수 셋째 자리(약 100m)로만 저장. */
export type CourseEnd = { name: string; at: LatLng };

/** 설명의 '할 일' 버튼. GO_HOME = 지금 집으로(남은 곳 건너뛰고 집으로 안내) · END = 아직 집이라 오늘 코스 마치기. */
export type ExplainAction = "GO_HOME" | "END";

/**
 * 코스 화면 맨 위 쉬운 설명 (LiveCourseEngine.explain). headline은 한 줄 제목, body는 해요체 한두 문장.
 * action이 있으면 큰 버튼 하나, homeMin은 지금 집으로 가면 도착 시각, warn이면 제목을 빨강으로.
 */
export type Explanation = { headline: string; body: string; action: ExplainAction | null; homeMin: number | null; warn: boolean };

/** 읽어 줄 글 (제목 + 본문). */
export const speechOf = (e: Explanation) => `${e.headline}. ${e.body}`;

/** 사건을 넣을 때의 차 상황. driving이면 카드 없이 칩·음성만, here는 지금 위치(모르면 코스가 아는 마지막 위치). */
export type CourseCtx = { driving?: boolean; here?: LatLng | null };

/**
 * 살아 있는 코스. 바뀔 때마다 version +1 (폰·차·서버 충돌 판정).
 * 시간표(legs)는 마지막으로 다시 짠 시각(nowMin)·위치(here)에서 집 도착까지.
 */
export type LiveCourse = {
  id: string;
  version: number;
  chosenBy: string;
  chosenAtMin: number;
  /** 순서 유지. DONE·SKIPPED도 남겨 둔다(기록·폰 화면). */
  stops: LiveStop[];
  /** 지금부터의 시간표 (하루 막대). */
  legs: Leg[];
  /** 시간표를 짠 시각·위치. */
  nowMin: number;
  here: LatLng | null;
  arriveHomeMin: number;
  /** 귀가 한계 (해 지기 N분 전 또는 고정 시각). */
  limitMin: number;
  /** 차에서 낮잠 구간(있으면). */
  napLeg: Leg | null;
  lastChange: Change | null;
  /** 탐색용 규칙을 어긴 곳 — 버리지 않고 경고 칩으로만. */
  warnings: string[];
  /** 비 시작 시각(이미 오면 지금 이전 시각). 모르면 null. */
  rainFromMin: number | null;
  /** 미세먼지 등급 (고를 때의 하늘 → 날씨 갱신). 나쁨 이상이고 야외가 남아 있으면 경고 칩. 모르면 null. */
  air: AirLevel | null;
  /** 이동 시간 어림 계수. 내비 ETA와 어림의 비율을 EMA(α 0.3)로 보정. */
  roadFactor: number;
  /** 오늘 머무름 패턴. 예정의 80% 미만으로 머물면 남은 곳 ×0.9. */
  dwellScale: number;
  /** 낮잠 이동을 이미 했는지 (하루 한 번). */
  napTaken: boolean;
  /** 아직 한 번만 온 내비 ETA (두 번 연속이어야 반영). */
  etaPending: number | null;
  /** 오늘 코스의 끝. null = 집. 시간표의 마지막 구간(HOME)이 여기서 끝난다. */
  end: CourseEnd | null;
  /** 오늘만 낮잠 안 자요 — 낮잠 이동을 짜지 않는다. */
  napOff: boolean;
  /** 사용자가 오늘 도착 목표(limitMin)를 직접 정함 — 해 시각·가족 설정의 한계 변경을 무시한다. */
  userLimit: boolean;
};

/** 도착지 이름 (집 또는 할머니 집 등). */
export const endNameOf = (c: { end: CourseEnd | null }) => c.end?.name ?? "집";
/** 두 도착지가 같은지 (엔진 data class 같음과 같게: 이름·위도·경도). */
export const sameEnd = (a: CourseEnd | null, b: CourseEnd | null) =>
  a === b || (a != null && b != null && a.name === b.name && a.at.lat === b.at.lat && a.at.lng === b.at.lng);

/** 엔진이 내는 답. change.text는 주행 중에도 보여 줄 칩 한 줄(40자 이내), voice는 읽어 줄 한 문장. */
export type Outcome =
  /** 변화가 임계(5분) 미만. 코스의 숨은 값(상태·보정 계수)만 갱신됐을 수 있다. */
  | { kind: "NoChange"; course: LiveCourse; change?: undefined; voice?: undefined }
  /** 시각만 바뀜. 칩은 change.size가 QUIET이 아닐 때만. */
  | { kind: "Retimed"; course: LiveCourse; change: Change; voice: string }
  /** 제안 1~3장. 정차 중에만 카드, 주행 중엔 칩·음성만 두고 다음 P단까지 보류. */
  | { kind: "Proposal"; course: LiveCourse; options: PlanOption[]; change: Change; voice: string }
  /** 귀가만 가능. 남은 곳이 이미 SKIPPED면 결정된 것(집으로 안내), 아니면 '바로 집으로' 확인을 받는다. */
  | { kind: "HomeNow"; course: LiveCourse; change: Change; voice: string };

/** 여유 = 한계 − 귀가 예정. */
export const slackMin = (c: LiveCourse) => c.limitMin - c.arriveHomeMin;
/** 아직 갈 곳 (순서대로). */
export const remainingOf = (c: LiveCourse) => c.stops.filter(remainingStop);
/** 다음 목적지. */
export const nextOf = (c: LiveCourse): LiveStop | null => remainingOf(c)[0] ?? null;
/** 지금 머무는 곳. */
export const currentOf = (c: LiveCourse): LiveStop | null => c.stops.find((s) => s.status === "ARRIVED") ?? null;
/** 남은 장소들 (길 안내용). */
export const remainingPlaces = (c: LiveCourse) => remainingOf(c).map((s) => s.place);

const legMinutes = (l: Leg) => l.toMin - l.fromMin;
const reason = (text: string, tone: Reason["tone"] = "PLAIN"): Reason => ({ text, tone });

/** 남은 코스를 카드 모양으로 (길 안내 재요청·화면). 남은 곳이 없으면 '바로 집으로'. */
export function asOption(c: LiveCourse, label = "고른 코스"): PlanOption {
  const stops = remainingPlaces(c);
  const first = c.legs.find((l) => !isStayLeg(l));
  return {
    kind: stops.length === 0 ? "GO_HOME" : "COURSE",
    stops,
    firstLegMin: first ? legMinutes(first) : 0,
    detourMin: null,
    arriveHomeMin: c.arriveHomeMin,
    legs: c.legs,
    reasons: [reason(c.end == null ? `${asHhmm(c.arriveHomeMin)} 귀가` : `${endNameOf(c)} ${asHhmm(c.arriveHomeMin)} 도착`)],
    label: stops.length === 0 ? `바로 ${josa(endNameOf(c), "으로/로")}` : label,
  };
}

/** `LiveCourse.from`에 필요한 계획 값만 (귀가 한계·하늘). */
export type PlanLite = { backByMin: number; sky: SkyToday | null };

/**
 * 고른 카드에서 코스를 만든다. 예정 시각은 카드의 하루 막대에서, 한계는 계획의 귀가 한계에서.
 * here는 고른 순간의 위치(모르면 null — 첫 도착 전까지는 집·출발지 어림을 쓴다).
 */
export function fromOption(
  option: PlanOption, plan: PlanLite, chosenBy: string, nowMin: number, here: LatLng | null = null, profile: FamilyProfile | null = null,
): LiveCourse {
  const stops = option.stops.map((p, i) => {
    const stay = option.legs.find((l) => isStayLeg(l) && l.placeId === p.id);
    return liveStop(p, i === 0 ? "NEXT" : "PLANNED", stay?.fromMin ?? nowMin, stay?.toMin ?? nowMin, profile ? dwellFor(profile, p) : p.dwellP80Min);
  });
  return {
    id: `lc-${nowMin}`,
    version: 1,
    chosenBy,
    chosenAtMin: nowMin,
    stops,
    legs: option.legs,
    nowMin,
    here,
    arriveHomeMin: option.arriveHomeMin,
    limitMin: plan.backByMin,
    napLeg: option.legs.find((l) => l.kind === "NAP_DRIVE") ?? null,
    lastChange: null,
    warnings: [],
    rainFromMin: rainStartMin(plan.sky, nowMin),
    air: plan.sky?.air ?? null,
    roadFactor: TravelTime.ROAD_FACTOR,
    dwellScale: 1.0,
    napTaken: false,
    etaPending: null,
    end: null,
    napOff: false,
    userLimit: false,
  };
}

// ------------------------------------------------------------------ 상수 (LiveCourseEngine.companion)

/** 이 미만 변화는 NoChange. */
export const QUIET_MIN = 5;
/** 이 이상 변화는 칩 + 음성. */
export const LOUD_MIN = 15;
/** 여유가 이만큼이면 '한 곳 더' (최소 머무름 30 + 우회 15). */
export const EXTRA_SLACK_MIN = 45;
/** 같은 원인 LOUD 반복 간격. */
export const SAME_CAUSE_MIN = 30;
/** 내비 ETA가 어림과 이만큼(분) 또는 비율로 다르면 반영. */
export const ETA_DIFF_MIN = 8;
export const ETA_DIFF_RATIO = 0.15;
/** 짧은 구간의 ETA는 계수 보정에 안 쓴다 (주차·유턴 잡음). */
export const ETA_MIN_LEG_MIN = 10;
export const EMA_ALPHA = 0.3;
export const FACTOR_MIN = 0.8;
export const FACTOR_MAX = 2.5;
/** 예정의 이 비율 미만으로 머물면 오늘 패턴 ×0.9. */
export const DWELL_SHORT_RATIO = 0.8;
export const DWELL_SCALE = 0.9;
/** 한계를 이만큼까지 넘기면 '덜 놀기'로 맞춰 본다. */
export const SHORTEN_MAX_MIN = 30;
/** 내비 없이 늦어질 때 남은 구간 어림의 최소(분) — 거의 다 왔어도 주차까지. */
export const STILL_DRIVING_MIN_REMAIN = 3;
/** 칩 글자 수 상한. */
export const CHIP_MAX = 40;
/** 건너뛴 까닭: 문 닫을 시간이라 못 감 (LiveStop.skipReason). */
export const CLOSED = "문 닫음";

/** 받침에 따라 조사 고르기 ("을/를", "이/가", "은/는", "으로/로" — ㄹ 받침은 '로'). */
export function josa(word: string, pair: string): string {
  if (word.length === 0) return word;
  const code = word.charCodeAt(word.length - 1);
  const jong = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0;
  const [a, b] = pair.split("/");
  const useA = jong !== 0 && !(pair === "으로/로" && jong === 8);
  return word + (useA ? a : b);
}

/** 미세먼지 경고 칩: '미세먼지 나쁨 · 마스크 챙기세요'. */
export const airWarning = (air: AirLevel) => `미세먼지 ${AIR_TEXT[air]} · 마스크 챙기세요`;

/** 음성: '나빠요' / '매우 나빠요'. */
export const airVoice = (air: AirLevel) => (air === "VERY_BAD" ? "매우 나빠요" : "나빠요");

/** 분 → "1시간 30분" / "45분". */
export function dur(min: number): string {
  if (min < 60) return `${min}분`;
  if (min % 60 === 0) return `${min / 60}시간`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

/** 칩 글: 조각을 ' · '로 잇고 40자에서 자른다. */
/** '앞으로 N분 더': 0~360분, 5분 단위. */
export const extendMin = (min: number) => Math.min(Math.max(round5(min), 0), DwellLearning.MAX_MIN);

export function chip(...parts: (string | null | undefined)[]): string {
  const s = parts.filter((p): p is string => p != null && p.length > 0).join(" · ");
  return s.length <= CHIP_MAX ? s : s.substring(0, CHIP_MAX - 1) + "…";
}

/** 코틀린 roundToInt와 같은 반올림(0.5는 위로). */
const roundToInt = (x: number) => Math.round(x);

/** 코틀린 data class 동등 비교와 같은 깊은 비교 (bump의 '바뀐 게 있나' 판정). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ------------------------------------------------------------------ 작업 중인 초안

/** 원인: key는 30분 반복 판정용, chip은 칩 머리, voice는 음성 첫 문장. */
type Cause = { key: string; chip: string; voice: string };
const cause = (key: string, chip: string, voice: string): Cause => ({ key, chip, voice });

/** 사건을 반영하는 동안의 작업 복사본. */
class Draft {
  stops: LiveStop[];
  limit: number;
  rain: number | null;
  air: AirLevel | null;
  factor: number;
  dwellScale: number;
  napTaken: boolean;
  chosenBy: string;
  version: number;
  end: CourseEnd | null;
  napOff: boolean;
  userLimit: boolean;
  /** 낮잠 이동을 짜지 않음 (이미 했거나 오늘은 안 잠). */
  get noNap(): boolean { return this.napTaken || this.napOff; }
  /** 시간표 끝 (도착지 또는 집). */
  get endName(): string { return this.end?.name ?? "집"; }
  /** 카드 이유 칩의 도착 글: 집이면 '16:47 귀가', 다른 도착지면 '할머니 집 16:29 도착' (도착지 이름 그대로). */
  arriveWord(min: number): string { return this.end == null ? `${asHhmm(min)} 귀가` : `${this.endName} ${asHhmm(min)} 도착`; }
  /** 다음 구간에 쓸 내비 ETA. */
  eta: number | null = null;
  cause: Cause = cause("", "", "");
  /** 머무름을 바꾼 한 줄 ('국립대구과학관을 90분으로 바꿨어요') — 칩·쉬운 설명 제목. */
  note: string | null = null;
  /** 사용자 명령 → 변화가 작아도 칩(SOFT). */
  forced = false;
  /** '한 곳 더'를 따지지 않음. */
  noExtra = false;
  /** 비 교체안을 따지지 않음. */
  noRain = false;
  /** 정차 중 출발 준비 → 낮잠 '더 머물기' 안을 따진다. */
  stretchCheck = false;
  /** 마지막 남은 곳에서 정차 중 출발 준비 → '한 곳 더' + '바로 집으로' 카드. */
  lastStop = false;
  /** 교체안을 넣을 자리 (문 닫음). */
  replaceAt: number | null = null;
  replaced: Place | null = null;

  constructor(c: LiveCourse, public now: number, public here: LatLng | null) {
    this.stops = c.stops;
    this.limit = c.limitMin;
    this.rain = c.rainFromMin;
    this.air = c.air;
    this.factor = c.roadFactor;
    this.dwellScale = c.dwellScale;
    this.napTaken = c.napTaken;
    this.chosenBy = c.chosenBy;
    this.version = c.version;
    this.end = c.end;
    this.napOff = c.napOff;
    this.userLimit = c.userLimit;
  }
}

/** 다시 짠 시간표. closedStop은 문 닫기 전에 못 가는 첫 장소, wetStops는 비 걸치는 야외 장소 id. */
type Timetable = {
  stops: LiveStop[];
  legs: Leg[];
  arriveHomeMin: number;
  napLeg: Leg | null;
  warnings: string[];
  closedStop: LiveStop | null;
  wetStops: string[];
};

function fixNext(stops: LiveStop[]): LiveStop[] {
  let first = true;
  return stops.map((s) => {
    if (!remainingStop(s)) return s;
    if (first) {
      first = false;
      return { ...s, status: "NEXT" };
    }
    return { ...s, status: "PLANNED" };
  });
}

const insertAt = <T,>(list: T[], at: number, item: T): T[] => [...list.slice(0, at), item, ...list.slice(at)];
const indexOfFirst = <T,>(list: T[], pred: (x: T) => boolean) => list.findIndex(pred);

/**
 * 살아 있는 코스의 판정 (docs/코스-고도화-계획.md 2절). 사건 하나를 넣으면 답(Outcome) 하나.
 *
 * 판정 순서 (모든 사건 공통)
 * 1. retime — 남은 장소 순서 유지, 출발점 = 지금 위치·시각. 이동 = 내비 ETA(다음 구간, 두 번 연속 확인) > 어림(계수 보정).
 *    머무름 = 보정된 예상. 탐색용 규칙(깨어 있는 이동 60분 초과·문 열기 30분 기다림·비 맞는 야외)은 경고 칩으로만 두고
 *    시간표를 버리지 않는다. 문 닫는 시각으로 자르는 것(그리고 닫기 전 30분도 못 있으면 '못 감')은 그대로.
 * 2. 한계 안이고 변화가 작으면 → NoChange(5분 미만) / Retimed(5~15분 QUIET, 15분↑ LOUD).
 * 3. 한계를 넘으면 → '덜 놀기'(넘긴 만큼 마지막 곳 머무름 줄이기, 30분 이내) → 뒤에서부터 한 곳씩 빼 보기 → 다 안 되면 HomeNow.
 * 4. 여유 ≥ 45분(머무름 30 + 우회 15)이면 '한 곳 더' 1장 (기존 재탑승 점수식).
 * 5. 낮잠 이동이 깨지면(정차 중 출발 준비) '더 머물기' 안을 먼저.
 * 6. 야외 머무름에 비가 걸치면 실내 교체안 (지금 머무는 곳이면 '비 오기 전 출발').
 * 7. 마지막 남은 곳에서 다시 타면(정차 중 출발 준비) 코스를 버리지 않고 '한 곳 더'(여유 ≥ 45분일 때) + '바로 집으로' 카드.
 * 같은 원인의 LOUD는 30분에 한 번. 떠 있는 제안이 지났는지는 proposalExpired.
 */
export class LiveCourseEngine {
  constructor(
    public profile: FamilyProfile,
    /** 교체·들르기·'한 곳 더' 후보. */
    public catalog: Place[],
  ) {}

  /** 오늘 날짜 'YYYY-MM-DD' — 교체·'한 곳 더' 후보의 축제 기간 판단(forDay). 모르면 축제는 빠진다. */
  day: string | null = null;

  /** 이동 시간 어림 (계수 보정 반영). */
  estimate(a: LatLng, b: LatLng, factor: number): number {
    return roundToInt(((km(a, b) * factor) / TravelTime.AVG_KMH) * 60);
  }

  // ------------------------------------------------------------------ 사건 → 답

  apply(course: LiveCourse, event: CourseEvent, ctx: CourseCtx = {}): Outcome {
    switch (event.type) {
      case "Remote": return this.remote(course, event, ctx);
      case "GoHome": return this.goHome(course, event.nowMin, ctx);
      case "NaviEta": return this.naviEta(course, event, ctx);
      case "StillDriving": return this.stillDriving(course, event);
      default: {
        const d = this.mutate(course, event, ctx);
        return d ? this.judge(course, d) : { kind: "NoChange", course };
      }
    }
  }

  /** 사용자가 제안 카드 하나를 골랐다 → 그 카드대로 코스를 바꾼다. 카드의 stops는 남은 장소 전체 순서. */
  adopt(course: LiveCourse, option: PlanOption, nowMin: number, ctx: CourseCtx = {}): Outcome {
    const ids = option.stops.map((p) => p.id);
    const old = course.stops;
    const stops: LiveStop[] = [];
    // 다녀온 곳·머무는 곳은 그대로 (머무는 곳은 카드의 머무름 칸으로 끝 시각을 바꿀 수 있다)
    for (const s of old) if (!remainingStop(s)) {
      const stay = option.legs.find((l) => isStayLeg(l) && l.placeId === s.place.id);
      stops.push(
        s.status === "ARRIVED" && stay
          ? { ...s, dwellGuessMin: Math.max(0, stay.toMin - Math.max(s.actualArriveMin ?? stay.fromMin, s.place.openMin)) }
          : s,
      );
    }
    // 남은 곳은 카드 순서대로 (카드에 없는 곳은 뺌)
    for (const s of old) if (remainingStop(s) && !ids.includes(s.place.id)) stops.push({ ...s, status: "SKIPPED" });
    for (const p of option.stops) {
      const prev = old.find((s) => s.place.id === p.id && remainingStop(s)) ?? null;
      const stay = option.legs.find((l) => isStayLeg(l) && l.placeId === p.id);
      const dwell = stay ? stay.toMin - Math.max(stay.fromMin, p.openMin) : prev?.dwellGuessMin ?? dwellFor(this.profile, p);
      stops.push({ ...(prev ?? liveStop(p, "PLANNED", nowMin, nowMin, dwell)), dwellGuessMin: Math.max(0, dwell) });
    }
    const d = new Draft(course, Math.max(nowMin, option.legs[0]?.fromMin ?? nowMin), ctx.here ?? course.here);
    d.stops = fixNext(stops);
    d.cause = cause("선택", option.label, `${option.label}로 갈게요.`);
    d.forced = true;
    d.noExtra = true;
    d.noRain = true;
    const tt = this.retime(d);
    const made = this.finish(course, d, tt);
    const change: Change = {
      text: chip(option.label, this.homeChip(d, asHhmm(tt.arriveHomeMin))), cause: "선택",
      deltaHomeMin: tt.arriveHomeMin - course.arriveHomeMin, size: "SOFT", atMin: d.now,
    };
    const out = { ...made, lastChange: change };
    if (remainingOf(out).length === 0 && currentOf(out) == null) {
      return { kind: "HomeNow", course: this.bump(course, out), change, voice: `${josa(endNameOf(out), "으로/로")} 안내할게요. ${asHhmm(tt.arriveHomeMin)}쯤 도착해요.` };
    }
    return { kind: "Retimed", course: this.bump(course, out), change, voice: `${option.label}. ${endNameOf(out)}에는 ${asHhmm(tt.arriveHomeMin)}쯤 도착해요.` };
  }

  /** '바로 집으로' 카드 (한계 침범 때 확인용): 남은 곳을 모두 빼고 지금 떠나는 시간표. */
  goHomeOption(course: LiveCourse, nowMin: number, ctx: CourseCtx = {}): PlanOption {
    const home = this.goHome(course, nowMin, ctx).course;
    return asOption(home, `바로 ${josa(endNameOf(home), "으로/로")}`);
  }

  /**
   * 떠 있는(보류 중이거나 화면에 있는) 제안이 지났는지. 지났으면 이유 글, 아직 쓸 수 있으면 null.
   *  1. 제안을 낸 뒤 다른 사건이 코스를 바꿨다 (버전이 다름)
   *  2. 카드가 새로 넣는 첫 장소에 이미 도착했거나 다녀왔다 (visited = 차가 오늘 실제로 선 장소, 코스 밖 포함)
   *  3. 카드가 권한 출발 시각(제안 시각보다 뒤, 예: '12:50에 출발')이 지났다
   * proposed는 제안을 낼 때의 코스(Proposal 답의 course), course는 지금 코스. 카드 하나라도 지났으면 제안 전체가 지난 것.
   */
  proposalExpired(proposed: LiveCourse, options: PlanOption[], course: LiveCourse, nowMin: number, visited: ReadonlySet<string> = new Set()): string | null {
    if (course.version !== proposed.version) return "코스가 바뀌었어요";
    const proposedRemaining = remainingOf(proposed);
    for (const o of options) {
      const fresh = o.stops.find((p) => !proposedRemaining.some((s) => s.place.id === p.id));
      if (fresh && (visited.has(fresh.id) || course.stops.some((s) => s.place.id === fresh.id && (s.status === "ARRIVED" || s.status === "DONE")))) {
        return `${fresh.name}에 이미 갔어요`;
      }
      const depart = o.legs.find((l) => !isStayLeg(l))?.fromMin;
      if (depart != null && depart > proposed.nowMin && nowMin > depart) return `${asHhmm(depart)} 출발이 지났어요`;
    }
    return null;
  }

  /** 사건 이름 (보류 칩 등에 쓰는 짧은 글). course = 지금 코스 — 장소 목록 밖의 바깥 장소('ext:…') 이름을 거기서 찾는다. */
  describe(event: CourseEvent, course?: LiveCourse | null): string {
    const name = (id: string) => this.name(id, course);
    switch (event.type) {
      case "Departed": return "출발";
      case "Arrived": return `${name(event.placeId)} 도착`;
      case "StillParked": return "정차 중";
      case "NaviEta": return `내비 ${event.remainMin}분`;
      case "StillDriving": return "아직 가는 중";
      case "ReplaceNext": return `다음은 ${name(event.placeId)}`;
      case "Skip": return `${name(event.placeId)} 빼기`;
      case "Insert": return `${name(event.placeId)} 들르기`;
      case "Weather": {
        const rain = event.sky === "RAIN" ? "비" : event.rainFromMin != null ? `비 ${asHhmm(event.rainFromMin)}부터` : null;
        const air = event.air ?? null;
        return [rain ?? (air == null ? "비 소식 없음" : null), air != null ? `미세먼지 ${AIR_TEXT[air]}` : null]
          .filter((x): x is string => x != null).join(" · ");
      }
      case "PlaceClosed": return `${name(event.placeId)} 문 닫음`;
      case "GoHome": return "집으로";
      case "LimitChanged": return `귀가 한계 ${asHhmm(event.limitMin)}`;
      case "Remote": return `${event.course.chosenBy}의 코스 v${event.version}`;
      case "Tick": return "시간 지남";
      case "SetDwell": return `${name(event.placeId)} ${clampUserDwell(event.minutes)}분`;
      case "ExtendStay": return event.minutes <= 0 ? "지금 나갈게요" : `${dur(extendMin(event.minutes))} 더`;
      case "SetEnd": {
        const parts = [
          event.toHome ? "도착지 집" : event.end ? `도착지 ${event.end.name}` : null,
          event.limitMin != null ? `${asHhmm(event.limitMin)}까지 도착` : null,
          event.napOff != null ? (event.napOff ? "오늘 낮잠 안 자요" : "낮잠 다시 맞춤") : null,
        ].filter((x): x is string => x != null);
        return parts.length ? parts.join(" · ") : "도착지 그대로";
      }
    }
  }

  /** 장소 목록 → 코스에 실린 곳(바깥 장소) → stopName. */
  private name(id: string, course?: LiveCourse | null) {
    return this.catalog.find((p) => p.id === id)?.name ?? stopName(id, course?.stops.find((s) => s.place.id === id)?.place.name);
  }

  /** 사건의 장소: 장소 목록 → 코스에 이미 있던 곳 (목록 밖 바깥 장소도 순서 바꾸기·다시 들르기가 되게). */
  private placeOf(id: string, c: LiveCourse): Place | undefined {
    return this.catalog.find((p) => p.id === id) ?? c.stops.find((s) => s.place.id === id)?.place;
  }

  // ------------------------------------------------------------------ 시간 흐름 · 쉬운 설명

  /**
   * 시간표가 nowMin보다 얼마나 뒤처졌는지(분). 머무는 곳이 있으면 그 예정 출발, 없으면 다음 곳 예정 도착이 기준.
   * 주행 중 늦어짐은 차가 StillDriving으로 따로 알리니, 이 값이 크면 보통 '아직 출발 안 함'·'차가 꺼져 있음'이다.
   */
  behindMin(c: LiveCourse, nowMin: number): number {
    if (nowMin <= c.nowMin) return 0;
    const due = currentOf(c)?.plannedDepartMin ?? nextOf(c)?.plannedArriveMin;
    if (due == null) return 0;
    return Math.max(0, nowMin - Math.max(due, c.nowMin));
  }

  /** 남은 곳 중 문 닫기 전에 못 가는 곳이 있는지 (시간표 경고). */
  private hasClosed(c: LiveCourse): boolean {
    return remainingOf(c).some((s) => c.warnings.some((w) => w.startsWith(`${s.place.name} 문 닫기 전에 못 가요`)));
  }

  /** Tick이 무언가를 바꿀지 (5분 넘게 뒤처짐 또는 못 가는 곳이 있음). */
  needsTick(c: LiveCourse, nowMin: number): boolean {
    return this.behindMin(c, nowMin) >= QUIET_MIN || this.hasClosed(c);
  }

  /**
   * 코스 화면 맨 위 쉬운 설명 — 제목 한 줄 + 해요체 한두 문장, 엔진 값으로만 만든다 ('한계'·'여유' 같은 말은 안 쓴다).
   * nowMin은 지금 시각(벽시계). 시간표가 뒤처졌으면 Tick을 해 본 결과로 설명한다(저장은 안 함).
   * options는 떠 있는 제안 카드(첫 장 = 가장 좋은 안), sunsetMin이 있으면 '해 지기 N분 전'.
   * 순서: 제안 → 집으로 가는 중 → 늦음(지금 집으로 / 아직 집이면 오늘은 마치기) → 계획대로.
   */
  explain(course: LiveCourse, nowMin: number, options: PlanOption[] = [], sunsetMin: number | null = null): Explanation {
    let c = course;
    let opts = options;
    if (this.needsTick(course, nowMin)) {
      const o = this.apply(course, { type: "Tick", nowMin });
      if (o.kind !== "NoChange") { c = o.course; opts = o.kind === "Proposal" ? o.options : []; }
    }
    const now = Math.max(nowMin, c.nowMin);
    const rem = remainingOf(c);
    const cur = currentOf(c);
    const homeAt = asHhmm(c.arriveHomeMin);
    /** 도착지 이름 (집 또는 오늘만 바꾼 곳). */
    const dest = endNameOf(c);
    const ex = (headline: string, body: string, action: ExplainAction | null = null, homeMin: number | null = null, warn = false): Explanation =>
      ({ headline, body, action, homeMin, warn });

    // 문 닫을 시간이라 못 가는 곳 (시간표 경고 + 방금 Tick이 건너뛴 곳), 집에서 아직 안 떠났는지
    const warnClosed = rem.filter((s) => c.warnings.some((w) => w.startsWith(`${s.place.name} 문 닫기 전에 못 가요`)));
    // 문 닫아 건너뛴 곳: 방금 해 본 Tick이 건너뛴 곳 + 마지막 변경이 '문 닫음'이면 그때 건너뛴 곳
    const tickSkipped = remainingOf(course).filter((s) => c.stops.some((x) => x.place.id === s.place.id && x.status === "SKIPPED"));
    const lastClosed = c.lastChange?.cause === CLOSED ? c.stops.filter((s) => s.status === "SKIPPED" && s.skipReason === CLOSED) : [];
    const closed = [...new Set([...lastClosed, ...tickSkipped, ...warnClosed].map((s) => s.place.name))];
    const others = rem.filter((s) => !warnClosed.some((w) => w.place.id === s.place.id)).map((s) => s.place.name);
    const home = this.goHome(c, now, {}).course.arriveHomeMin;
    const started = c.stops.some((s) => s.status === "DONE" || s.status === "ARRIVED") || home - now > 5;
    const late = c.arriveHomeMin > c.limitMin || warnClosed.length > 0;
    /** 아직 집(출발 전)인데 지금 떠나도 너무 늦다 → 오늘 코스는 마치기. */
    const notStarted = () => {
      const first = closed.length > 0 ? `${josa(closed.join("·"), "은/는")} 벌써 문 닫을 시간이에요. ` : "";
      const second = others.length > 0 && late ? `남은 곳까지 다녀오면 ${homeAt}에야 ${dest}에 와요.` : "오늘은 집에서 쉬어요.";
      return ex("오늘은 다음에 가는 게 좋겠어요", first + second, "END", home, true);
    };

    // 1. 제안 카드 → 가장 좋은 안을 한 문장으로 (모두 빼는 안인데 아직 집이면 '오늘은 다음에')
    const best = opts[0];
    if (best) return best.stops.length === 0 && !started ? notStarted() : this.explainOption(c, best);

    // 2. 남은 곳이 없고 머무는 곳도 없음 → 집으로 가는 길
    if (rem.length === 0 && cur == null) {
      const n = c.stops.filter((s) => s.status === "DONE").length;
      return ex(`${josa(dest, "으로/로")} 가는 길이에요`, (n > 0 ? `오늘 ${n}곳을 다녀왔어요. ` : "") + `${dest}에는 ${homeAt}쯤 도착해요.`);
    }


    // 3. 늦음: 집 도착이 귀가 목표를 넘거나, 문 닫기 전에 못 가는 곳이 있음
    if (late) {
      if (!started) return notStarted();
      const second =
        closed.length > 0 && others.length === 0 ? `남은 ${josa(closed.join("·"), "은/는")} 문을 닫아서 다음에 가요.`
        : closed.length > 0 ? `${josa(closed.join("·"), "은/는")} 문을 닫았고, ${josa(others.join("·"), "은/는")} 다음에 가요.`
        : others.length > 0 ? `남은 ${josa(others.join("·"), "은/는")} 다음에 가요.`
        : "더 머물면 너무 늦어져요.";
      return ex("오늘은 여기까지가 좋겠어요", `지금 바로 출발하면 ${dest}에 ${asHhmm(home)}에 도착해요. ${second}`, "GO_HOME", home, true);
    }

    // 4. 계획대로
    const last = c.lastChange && now - c.lastChange.atMin <= SAME_CAUSE_MIN ? c.lastChange : null;
    const headline =
      // 도착지·도착 목표를 바꾼 직후: 귀가 변화는 '일찍·늦게'가 아니라 바꾼 결과
      last?.cause === "도착지" ? (c.end != null ? `오늘은 ${josa(dest, "으로/로")} 가요` : "계획대로 가고 있어요")
      // 머무름을 바꾼 직후: 무엇을 바꿨는지 ('국립대구과학관을 90분으로 바꿨어요')
      // (제안 칩이었으면 글이 '과학관 90분'이라 일반 제목으로)
      : last?.cause === "머무름" ? (last.text.split(" · ")[0].endsWith("요") ? last.text.split(" · ")[0] : "머무는 시간을 바꿨어요")
      : last != null && last.deltaHomeMin >= QUIET_MIN ? "조금 늦어졌지만 괜찮아요"
      : last != null && last.deltaHomeMin <= -QUIET_MIN ? "예정보다 일찍 가고 있어요"
      : "계획대로 가고 있어요";
    const next = nextOf(c);
    // 머무는 곳의 나설 시각이 지금(2분 안)이면 '지금 나서면'
    const leaveNow = cur != null && cur.plannedDepartMin <= now + 2;
    const first =
      cur != null && next != null && leaveNow ? `지금 나서면 ${next.place.name}에 ${asHhmm(next.plannedArriveMin)}에 도착해요.`
      : cur != null && next != null ? `${asHhmm(cur.plannedDepartMin)}에 나서면 ${next.place.name}에 ${asHhmm(next.plannedArriveMin)}에 도착해요.`
      : cur != null && leaveNow ? `이제 ${cur.place.name}에서 나설 시간이에요.`
      : cur != null ? `${cur.place.name}에서 ${asHhmm(cur.plannedDepartMin)}까지 놀고 집으로 가요.`
      : next != null ? `다음은 ${next.place.name}, ${asHhmm(next.plannedArriveMin)}에 도착해요.`
      : "";
    if (closed.length > 0) {
      // 문 닫을 시간이라 건너뛴 곳이 있지만 나머지는 시간 안 → 그 얘기 먼저
      return ex("계획을 조금 바꿨어요", `${josa(closed.join("·"), "은/는")} 문 닫을 시간이라 건너뛰어요. ${first}`.trim());
    }
    const second = sunsetMin != null && c.arriveHomeMin < sunsetMin
      ? `${dest}에는 ${homeAt}쯤, 해 지기 ${dur(sunsetMin - c.arriveHomeMin)} 전에 와요.`
      : `${dest}에는 ${homeAt}쯤 와요.`;
    return ex(headline, `${first} ${second}`.trim());
  }

  /** 제안 카드 한 장 → 쉬운 설명. 카드 제목은 이 엔진이 만든 글이라 모양으로 종류를 가린다. */
  private explainOption(c: LiveCourse, o: PlanOption): Explanation {
    const arr = asHhmm(o.arriveHomeMin);
    const label = o.label;
    const dest = endNameOf(c);
    const dep = o.legs.find((l) => !isStayLeg(l))?.fromMin;
    const depart = dep != null ? asHhmm(dep) : "null";
    const ex = (headline: string, body: string, warn = false): Explanation => ({ headline, body, action: null, homeMin: null, warn });
    if (label.startsWith("한 곳 더 · ")) {
      const p = o.stops[o.stops.length - 1];
      return ex("한 곳 더 갈 수 있어요", `${p.name}에 들렀다 가도 ${dest}에 ${arr}쯤 도착해요.`);
    }
    if (label.startsWith("비 오기 전 ")) return ex("곧 비가 와요", `${depart}에 먼저 나서면 비를 피할 수 있어요. ${dest}에는 ${arr}쯤 도착해요.`);
    if (label.endsWith("에 출발")) return ex("조금 더 놀다 가도 돼요", `${depart}에 출발하면 아이들이 차에서 낮잠을 잘 수 있어요. ${dest}에는 ${arr}쯤 도착해요.`);
    if (label.endsWith(" 덜 놀기")) {
      const parts = label.slice(0, -" 덜 놀기".length);
      const cut = parts.lastIndexOf(" ");
      const name = cut >= 0 ? parts.slice(0, cut) : parts;
      const less = cut >= 0 ? parts.slice(cut + 1) : parts;
      return ex("이대로면 조금 늦어요", `${name}에서 ${less}만 덜 놀면 ${dest}에 ${arr}에 도착해요.`, true);
    }
    if (label.endsWith(" 빼기")) {
      const names = label.slice(0, -" 빼기".length);
      return ex("이대로면 늦어요", `${josa(names, "을/를")} 빼면 ${dest}에 ${arr}에 도착해요.`, true);
    }
    if (o.stops.length === 0) return ex(`바로 ${josa(dest, "으로/로")} 갈까요`, `지금 출발하면 ${dest}에 ${arr}쯤 도착해요.`);
    if (label.includes(" → ")) {
      const at = label.indexOf(" → ");
      const old = label.slice(0, at);
      const nu = label.slice(at + 3);
      const why = c.lastChange?.cause === "문 닫음" ? `${josa(old, "이/가")} 문을 닫았어요. ` : c.lastChange?.cause === "비" ? "비가 와서 실내로 바꾸면 좋아요. " : "";
      return ex(`${old} 대신 ${nu} 어때요`, `${why}${josa(nu, "으로/로")} 바꾸면 ${dest}에 ${arr}쯤 도착해요.`);
    }
    return ex("이렇게 바꾸면 좋겠어요", `${label}, ${dest}에는 ${arr}쯤 도착해요.`);
  }

  /** 머무는 곳을 떠난다. learn이면 오늘 패턴: 예정의 80% 미만으로 머물렀으면 남은 곳 머무름 ×0.9 (명령으로 떠날 땐 안 배움). */
  private leave(d: Draft, cur: LiveStop, now: number, learn = true) {
    const start = Math.max(cur.actualArriveMin ?? now, cur.place.openMin);
    const actual = now - start;
    d.stops = d.stops.map((s) => (s.place.id === cur.place.id && s.status === "ARRIVED" ? { ...s, status: "DONE", actualDepartMin: now } : s));
    if (learn && cur.dwellGuessMin > 0 && actual < DWELL_SHORT_RATIO * cur.dwellGuessMin && d.dwellScale === 1.0) {
      d.dwellScale = DWELL_SCALE;
      d.stops = d.stops.map((s) => (remainingStop(s) && !s.dwellSet ? { ...s, dwellGuessMin: roundToInt(dwellFor(this.profile, s.place) * DWELL_SCALE) } : s));
    }
  }

  private earlyLate(diff: number, early: string, late: string, onTime: string): Cause {
    if (diff >= 10) return cause(early, `${diff}분 일찍`, `${diff}분 일찍 나섰어요`);
    if (diff <= -10) return cause(late, `${-diff}분 늦게`, `${-diff}분 늦게 나섰어요`);
    return cause(onTime, onTime, `${onTime}했어요`);
  }

  /** 사건을 초안에 반영한다. 반영할 게 없으면 null (NoChange). */
  private mutate(c: LiveCourse, e: CourseEvent, ctx: CourseCtx): Draft | null {
    const d = new Draft(c, e.nowMin, ctx.here ?? c.here);
    const now = e.nowMin;
    switch (e.type) {
      case "Departed": {
        const cur = currentOf(c);
        if (cur) {
          this.leave(d, cur, now);
          d.here = ctx.here ?? cur.place.at;
          d.cause = this.earlyLate(cur.plannedDepartMin - now, "일찍 출발", "늦게 출발", "출발");
          d.stretchCheck = !ctx.driving;
          d.lastStop = !ctx.driving && !d.stops.some(remainingStop);
        } else {
          d.cause = cause("출발", "출발", "출발했어요");
        }
        d.stops = fixNext(d.stops);
        break;
      }
      case "Arrived": {
        const place = this.catalog.find((p) => p.id === e.placeId) ?? c.stops.find((s) => s.place.id === e.placeId)?.place;
        if (!place) return null;
        const cur = currentOf(c);
        if (cur) this.leave(d, cur, cur.actualDepartMin ?? now);
        const idx = indexOfFirst(d.stops, (s) => s.place.id === e.placeId && remainingStop(s));
        const napNow = c.legs.some((l) => l.kind === "NAP_DRIVE" && l.placeId === e.placeId);
        if (idx >= 0) {
          const s = d.stops[idx];
          d.stops = d.stops.map((x, i) => {
            if (i === idx) return { ...x, status: "ARRIVED" as StopStatus, actualArriveMin: now };
            if (i < idx && remainingStop(x)) return { ...x, status: "SKIPPED" as StopStatus };
            return x;
          });
          const diff = s.plannedArriveMin - now;
          d.cause =
            diff >= 10 ? cause("도착", `${place.name} ${diff}분 일찍`, `${place.name}에 ${diff}분 일찍 도착했어요`)
            : diff <= -10 ? cause("도착", `${place.name} ${-diff}분 늦게`, `${place.name}에 ${-diff}분 늦게 도착했어요`)
            : cause("도착", `${place.name} 도착`, `${place.name}에 도착했어요`);
        } else {
          // 예정에 없던 곳 — 다음 목적지 앞에 끼워 넣는다
          const found = indexOfFirst(d.stops, remainingStop);
          const at = found < 0 ? d.stops.length : found;
          const stop = liveStop(place, "ARRIVED", now, now, roundToInt(dwellFor(this.profile, place) * d.dwellScale), now);
          d.stops = insertAt(d.stops, at, stop);
          d.cause = cause("도착", `${place.name} 들름`, `예정에 없던 ${place.name}에 들렀어요`);
          d.forced = true;
        }
        d.napTaken = d.napTaken || napNow;
        d.here = place.at;
        d.stops = fixNext(d.stops);
        break;
      }
      case "StillParked": {
        const cur = currentOf(c);
        d.cause = cur
          ? cause("머무름 길어짐", `아직 ${cur.place.name}`, `${cur.place.name}에 예정보다 오래 있어요`)
          : cause("예상 밖 정차", "정차 중", "길에서 쉬었어요");
        break;
      }
      case "ReplaceNext": {
        const place = this.placeOf(e.placeId, c);
        if (!place) return null;
        const next = nextOf(c);
        if (next?.place.id === place.id) return null;
        const found = indexOfFirst(d.stops, remainingStop);
        const at = found < 0 ? d.stops.length : found;
        const stop = liveStop(place, "NEXT", now, now, roundToInt(dwellFor(this.profile, place) * d.dwellScale));
        d.stops = fixNext(insertAt(d.stops.filter((s) => !(s.place.id === place.id && remainingStop(s))), at, stop));
        d.cause = cause("다음 바꾸기", `다음은 ${place.name}`, `다음은 ${josa(place.name, "으로/로")} 안내할게요`);
        d.forced = true;
        break;
      }
      case "Skip": {
        const s = c.stops.find((x) => x.place.id === e.placeId && (remainingStop(x) || x.status === "ARRIVED"));
        if (!s) return null;
        if (s.status === "ARRIVED") {
          this.leave(d, s, now, false);
          d.here = ctx.here ?? s.place.at;
        } else {
          d.stops = d.stops.map((x) => (x.place.id === s.place.id && remainingStop(x) ? { ...x, status: "SKIPPED" as StopStatus } : x));
        }
        d.stops = fixNext(d.stops);
        d.cause = cause("빼기", `${s.place.name} 뺐어요`, `${josa(s.place.name, "을/를")} 뺐어요`);
        d.forced = true;
        break;
      }
      case "Insert": {
        const place = this.placeOf(e.placeId, c);
        if (!place) return null;
        if (c.stops.some((s) => s.place.id === place.id && (remainingStop(s) || s.status === "ARRIVED"))) return null;
        const stop = liveStop(place, "PLANNED", now, now, roundToInt(dwellFor(this.profile, place) * d.dwellScale));
        const slots = [...new Set([...d.stops.map((s, i) => (remainingStop(s) ? i : -1)).filter((i) => i >= 0), d.stops.length])];
        let best: [LiveStop[], Timetable] | null = null;
        for (const at of slots) {
          const trial = fixNext(insertAt(d.stops, at, stop));
          const tt = this.retime(d, trial);
          if (tt.closedStop != null || tt.arriveHomeMin > d.limit) continue;
          if (best == null || tt.arriveHomeMin < best[1].arriveHomeMin) best = [trial, tt];
        }
        d.cause = cause("들르기", `${place.name} 들러요`, `${place.name}에 들렀다 갈게요`);
        d.forced = true;
        if (best == null) {
          d.cause = cause("들르기", `${place.name}는 시간이 안 맞아요`, `${josa(place.name, "은/는")} 오늘 시간이 안 맞아요`);
          d.noExtra = true;
        } else {
          d.stops = best[0];
        }
        break;
      }
      case "Weather": {
        const rain = e.sky === "RAIN" ? now : e.rainFromMin;
        const air = e.air ?? c.air;
        if (rain === c.rainFromMin && air === c.air) return null;
        d.rain = rain;
        d.air = air;
        if (rain !== c.rainFromMin) {
          d.cause =
            rain == null ? cause("비", "비 소식 없음", "비 소식이 없어졌어요")
            : rain <= now ? cause("비", "비", "비가 와요")
            : cause("비", `비 ${asHhmm(rain)}부터`, `비가 ${asHhmm(rain)}부터 와요`);
        } else if (air != null && airIsBad(air)) {
          // 미세먼지만 바뀜: 나빠졌고 야외가 남아 있으면 칩으로 알린다 (시간표는 그대로)
          const outdoor = c.stops.some((s) => (remainingStop(s) || s.status === "ARRIVED") && !s.place.indoor);
          d.forced = outdoor;
          d.cause = cause("미세먼지", airWarning(air), outdoor ? `미세먼지가 ${airVoice(air)}. 마스크 챙기세요` : `미세먼지가 ${airVoice(air)}`);
        } else {
          d.cause = cause("미세먼지", `미세먼지 ${air != null ? AIR_TEXT[air] : "모름"}`, "미세먼지가 괜찮아졌어요");
        }
        break;
      }
      case "PlaceClosed": {
        const idx = indexOfFirst(c.stops, (s) => s.place.id === e.placeId && remainingStop(s));
        if (idx < 0) return null;
        const s = c.stops[idx];
        d.stops = fixNext(d.stops.map((x, i) => (i === idx ? { ...x, status: "SKIPPED" as StopStatus, skipReason: CLOSED } : x)));
        d.replaceAt = idx;
        d.replaced = s.place;
        d.cause = cause("문 닫음", `${s.place.name} 문 닫음`, `${josa(s.place.name, "이/가")} 문을 닫았어요`);
        d.forced = true;
        break;
      }
      case "LimitChanged": {
        // 오늘 사용자가 정한 도착 목표(SetEnd)가 이긴다
        if (e.limitMin === c.limitMin || c.userLimit) return null;
        d.limit = e.limitMin;
        d.cause = cause("한계", `귀가 한계 ${asHhmm(e.limitMin)}`, `귀가 한계가 ${asHhmm(e.limitMin)}으로 바뀌었어요`);
        break;
      }
      case "Tick": {
        const lag = this.behindMin(c, now);
        if (lag < QUIET_MIN && !this.hasClosed(c)) return null;
        // 문 닫을 시간이라 못 가는 곳은 건너뛴다 (앞에서부터 하나씩 — 하나를 빼면 뒤 시간표가 당겨진다)
        const gone: Place[] = [];
        for (;;) {
          const cs = this.retime(d).closedStop;
          if (cs == null) break;
          d.stops = fixNext(d.stops.map((x) => (x.place.id === cs.place.id && remainingStop(x) ? { ...x, status: "SKIPPED" as StopStatus, skipReason: CLOSED } : x)));
          gone.push(cs.place);
        }
        if (gone.length === 0) {
          d.cause = cause("늦어짐", `예정보다 ${lag}분 늦어요`, `예정보다 ${lag}분 늦어졌어요`);
        } else {
          const names = gone.map((p) => p.name).join("·");
          const head = gone.length === 1 ? `${names} 문 닫을 시간` : `${gone.length}곳 문 닫을 시간`;
          d.cause = cause("문 닫음", head, `${josa(names, "은/는")} 문 닫을 시간이라 건너뛰었어요`);
          d.forced = true;
        }
        d.noExtra = true;
        break;
      }
      case "SetDwell": {
        const idx = d.stops.findIndex((x) => x.place.id === e.placeId && (remainingStop(x) || x.status === "ARRIVED"));
        if (idx < 0) return null;
        const st = d.stops[idx];
        const m = clampUserDwell(e.minutes);
        if (st.dwellGuessMin === m && st.dwellSet) return null;
        d.stops = d.stops.map((x, i) => (i === idx ? { ...x, dwellGuessMin: m, dwellSet: true } : x));
        const name = st.place.name;
        d.note = `${josa(name, "을/를")} ${m}분으로 바꿨어요`;
        d.cause = cause("머무름", `${name} ${m}분`, d.note);
        d.forced = true;
        break;
      }
      case "ExtendStay": {
        const cur = currentOf(c);
        if (!cur) return null;
        const more = extendMin(e.minutes);
        const start = Math.max(cur.actualArriveMin ?? now, cur.place.openMin);
        const dwell = Math.max(0, now + more - start);
        if (dwell === cur.dwellGuessMin && cur.dwellSet) return null;
        d.stops = d.stops.map((x) => (x.place.id === cur.place.id && x.status === "ARRIVED" ? { ...x, dwellGuessMin: dwell, dwellSet: true } : x));
        const name = cur.place.name;
        d.note = more === 0 ? `${name}에서 지금 나서요` : `${name}에서 ${dur(more)} 더 놀아요`;
        d.cause = cause("머무름", more === 0 ? "지금 출발" : `${dur(more)} 더`, d.note);
        d.forced = true;
        break;
      }
      case "SetEnd": {
        const end = e.toHome ? null : e.end ?? c.end;
        const limit = e.limitMin ?? c.limitMin;
        const napOff = e.napOff ?? c.napOff;
        if (sameEnd(end, c.end) && limit === c.limitMin && napOff === c.napOff) return null;
        d.end = end;
        d.limit = limit;
        d.napOff = napOff;
        if (e.limitMin != null) d.userLimit = true;
        const name = end?.name ?? "집";
        const chips: string[] = [];
        const voices: string[] = [];
        if (!sameEnd(end, c.end)) { chips.push(`도착지 ${name}`); voices.push(`도착지를 ${josa(name, "으로/로")} 바꿨어요`); }
        if (limit !== c.limitMin) { chips.push(`${asHhmm(limit)}까지`); voices.push(`${asHhmm(limit)}까지 도착하게 맞출게요`); }
        if (napOff !== c.napOff) {
          chips.push(napOff ? "낮잠 안 자요" : "낮잠 다시 맞춤");
          voices.push(napOff ? "오늘은 낮잠 없이 짤게요" : "낮잠 시간을 다시 맞출게요");
        }
        d.cause = cause("도착지", chips.join(" · "), voices.join(". "));
        d.forced = true;
        d.noExtra = true;
        break;
      }
      default:
        throw new Error("따로 처리");
    }
    return d;
  }

  private naviEta(c: LiveCourse, e: Extract<CourseEvent, { type: "NaviEta" }>, ctx: CourseCtx): Outcome {
    const next = nextOf(c);
    if (!next) return { kind: "NoChange", course: c };
    const here = ctx.here ?? c.here ?? this.profile.home;
    const est = this.estimate(here, next.place.at, c.roadFactor);
    const pending = c.etaPending;
    const sameWay = pending != null && (pending - est) * (e.remainMin - est) > 0;
    const big = Math.abs(e.remainMin - est) >= ETA_DIFF_MIN || Math.abs(e.remainMin - est) >= ETA_DIFF_RATIO * est;
    if (!sameWay || !big) return { kind: "NoChange", course: { ...c, etaPending: e.remainMin } };
    const d = new Draft(c, e.nowMin, here);
    d.eta = e.remainMin;
    if (est >= ETA_MIN_LEG_MIN && e.remainMin >= ETA_MIN_LEG_MIN) {
      const sample = (c.roadFactor * e.remainMin) / est;
      const mixed = Math.min(Math.max((1 - EMA_ALPHA) * c.roadFactor + EMA_ALPHA * sample, FACTOR_MIN), FACTOR_MAX);
      d.factor = roundToInt(mixed * 100) / 100.0;
    }
    const diff = e.remainMin - est;
    d.cause = cause("내비", `내비 ${diff > 0 ? "+" : ""}${diff}분`, `내비 예상이 어림보다 ${Math.abs(diff)}분 ${diff > 0 ? "길어요" : "짧아요"}`);
    d.noExtra = diff > 0;
    return this.judge(c, d);
  }

  /**
   * 내비 없이 늦어짐: 지금 위치에서 다음 곳까지 남은 구간을 보정된 계수로 다시 어림(최소 3분)해 그 값으로 다시 짠다.
   * 계수는 배우지 않는다(어림끼리 비교라). 임계·한계 침범·30분 반복 판정은 내비 ETA와 같다. 원인 '늦어짐'.
   */
  private stillDriving(c: LiveCourse, e: Extract<CourseEvent, { type: "StillDriving" }>): Outcome {
    const next = nextOf(c);
    if (!next) return { kind: "NoChange", course: c };
    const d = new Draft(c, e.nowMin, e.here);
    d.eta = Math.max(this.estimate(e.here, next.place.at, c.roadFactor), STILL_DRIVING_MIN_REMAIN);
    d.cause = cause("늦어짐", "예정보다 늦어요", "예정보다 늦어지고 있어요");
    d.noExtra = true;
    return this.judge(c, d);
  }

  private goHome(c: LiveCourse, now: number, ctx: CourseCtx): Outcome {
    const d = new Draft(c, now, ctx.here ?? c.here);
    const cur = currentOf(c);
    if (cur) {
      this.leave(d, cur, now, false);
      d.here = ctx.here ?? cur.place.at;
    }
    d.stops = d.stops.map((s) => (remainingStop(s) ? { ...s, status: "SKIPPED" as StopStatus } : s));
    const tt = this.retime(d);
    const to = josa(d.endName, "으로/로");
    const change: Change = {
      text: chip(to, `${asHhmm(tt.arriveHomeMin)} 도착`), cause: "집으로",
      deltaHomeMin: tt.arriveHomeMin - c.arriveHomeMin, size: "LOUD", atMin: now,
    };
    const out = { ...this.finish(c, d, tt), lastChange: change };
    return { kind: "HomeNow", course: this.bump(c, out), change, voice: `${to} 안내할게요. ${asHhmm(tt.arriveHomeMin)}쯤 도착해요.` };
  }

  /** 폰·서버 코스: 버전이 높을 때만 받아들인다. 차가 실제로 다녀온 곳의 상태는 차 것을 지킨다. */
  private remote(c: LiveCourse, e: Extract<CourseEvent, { type: "Remote" }>, ctx: CourseCtx): Outcome {
    if (e.version <= c.version) return { kind: "NoChange", course: c };
    const r = e.course;
    const stops: LiveStop[] = [];
    for (const s of c.stops) if (!remainingStop(s)) stops.push(s);
    for (const s of r.stops) {
      const local = c.stops.find((x) => x.place.id === s.place.id);
      if (local && !remainingStop(local)) continue;
      stops.push(liveStop(
        s.place, s.status === "SKIPPED" ? "SKIPPED" : "PLANNED",
        s.plannedArriveMin, s.plannedDepartMin,
        s.dwellGuessMin > 0 ? s.dwellGuessMin : roundToInt(dwellFor(this.profile, s.place) * c.dwellScale),
      ));
      stops[stops.length - 1].dwellSet = s.dwellSet ?? false;
    }
    const d = new Draft(c, e.nowMin, ctx.here ?? c.here);
    d.stops = fixNext(stops);
    d.version = e.version;
    d.chosenBy = r.chosenBy;
    // 폰이 정한 오늘 도착지·낮잠·도착 목표도 따라간다 (도착 목표는 사용자가 정했을 때만 — 그 밖엔 차의 해 시각이 기준)
    d.end = r.end ?? null;
    d.napOff = r.napOff ?? false;
    if (r.userLimit) { d.limit = r.limitMin; d.userLimit = true; }
    const who = josa(r.chosenBy, "이/가");
    d.cause = cause("폰 변경", `${who} 코스를 바꿨어요`, `${who} 코스를 바꿨어요`);
    d.forced = true;
    return this.judge(c, d);
  }

  // ------------------------------------------------------------------ 판정

  private judge(c: LiveCourse, d: Draft): Outcome {
    const tt = this.retime(d);
    const made = this.finish(c, d, tt);
    const delta = tt.arriveHomeMin - c.arriveHomeMin;
    const cNext = nextOf(c);
    const nextOld = cNext ? c.stops.find((s) => s.place.id === cNext.place.id)?.plannedArriveMin ?? null : null;
    const madeNext = nextOf(made);
    const nextNew = madeNext?.plannedArriveMin ?? null;
    const nextDelta = nextOld != null && nextNew != null && cNext?.place.id === madeNext?.place.id ? nextNew - nextOld : 0;
    const moved = Math.max(Math.abs(delta), Math.abs(nextDelta));
    // 예상 밖 정차는 잃은 시간을 알고 나서 글을 만든다
    if (d.cause.key === "예상 밖 정차") d.cause = cause(d.cause.key, `예상 밖 정차 ${delta}분`, `길에서 ${delta}분 쉬었어요`);

    // 3. 한계 침범 → 덜 놀기 → 빼기 → 바로 귀가
    if (tt.arriveHomeMin > d.limit || tt.closedStop != null) return this.breach(c, d, made, delta);

    // 머무름은 사람이 직접 바꾼 것 → 변화가 작아도 칩으로 알려 준다
    const size: ChangeSize = moved >= LOUD_MIN ? "LOUD" : d.cause.key === "머무름" ? "SOFT" : moved >= QUIET_MIN ? "QUIET" : d.forced ? "SOFT" : "QUIET";
    const options: PlanOption[] = [];
    let head: string | null = null;
    let voice: string | null = null;

    // 5. 낮잠 이동이 깨짐 → 더 머물기 (정차 중 출발 준비일 때만)
    if (d.stretchCheck && tt.napLeg == null && !d.noNap) {
      const st = this.stretchOption(d, made);
      if (st) {
        const [o, more] = st;
        options.push(o);
        const len = legMinutes(o.legs.find((l) => l.kind === "NAP_DRIVE")!);
        head = `${more}분 더 놀면 차에서 낮잠`;
        voice = `${more}분만 더 놀다 가면 아이들이 차에서 ${len}분 낮잠 잘 수 있어요.`;
      }
    }
    // 교체안 (문 닫음)
    if (d.replaceAt != null) {
      const o = this.replacementOption(d, d.replaceAt, d.replaced!, false);
      if (o) options.push(o);
    }
    // 6. 야외 머무름에 비 → 실내로
    if (!d.noRain && tt.wetStops.length > 0) {
      const r = this.rainOptions(d, made, tt);
      if (r) {
        const [o, h, v] = r;
        options.push(o);
        if (head == null) { head = h; voice = v; }
      }
    }
    // 4. 여유 ≥ 45분 → 한 곳 더
    const slackNew = d.limit - tt.arriveHomeMin;
    if (!d.noExtra && slackNew >= EXTRA_SLACK_MIN && (moved >= QUIET_MIN || d.forced || d.lastStop || slackMin(c) < EXTRA_SLACK_MIN)) {
      const o = this.extraOption(d, made);
      if (o) {
        options.push(o);
        if (head == null) {
          head = "한 곳 더 갈 수 있어요";
          voice = `시간이 ${dur(slackNew)} 남아요. ${o.stops[o.stops.length - 1].name}에 들렀다 갈까요?`;
        }
      }
    }
    // 7. 마지막 곳에서 다시 탐 → '바로 집으로' 카드 (새 3장 대신 코스 화면에서 고른다)
    if (d.lastStop) {
      const to = josa(d.endName, "으로/로");
      options.push(this.option(tt, `바로 ${to}`, [reason(d.arriveWord(tt.arriveHomeMin))]));
      if (head == null) {
        head = `바로 ${to} 갈까요`;
        voice = `바로 ${to} 가면 ${asHhmm(tt.arriveHomeMin)}쯤 도착해요.`;
      }
    }

    const next = nextOf(made);
    const cz = d.cause;
    if (options.length > 0) {
      // 원인이 '비'면 비 제안 글이 이미 비를 말하니 겹쳐 쓰지 않는다
      const rainSaid = cz.key === "비" && tt.wetStops.length > 0;
      const change = this.throttle(c, { text: rainSaid ? chip(head) : chip(cz.chip, head), cause: cz.key, deltaHomeMin: delta, size: "LOUD", atMin: d.now }, d.now);
      const v = rainSaid ? (voice ?? cz.voice) : `${cz.voice}. ${voice ?? ""}`.trim();
      return { kind: "Proposal", course: this.bump(c, this.keep(c, made, change)), options, change, voice: v };
    }
    if (size === "QUIET" && moved < QUIET_MIN && !d.forced) {
      return { kind: "NoChange", course: this.bump(c, { ...made, lastChange: c.lastChange }) };
    }
    const arrive = asHhmm(tt.arriveHomeMin);
    const text =
      cz.key === "머무름 길어짐"
        ? chip(`지금 나서면 ${this.homeChip(d, arrive)}`, slackNew > 0 ? `${asHhmm(d.now + slackNew)}까지 출발` : null)
        : cz.key === "도착지"
        ? chip(cz.chip, `${d.endName}에 ${arrive} 도착`)
        : cz.key === "머무름"
        ? chip(d.note ?? cz.chip, `${d.endName}에 ${arrive}쯤`)
        : cz.key === "미세먼지"
        ? chip(cz.chip)
        : cz.key === "늦어짐"
        ? chip(cz.chip, next ? `다음 도착 ${asHhmm(next.plannedArriveMin)}` : null, this.homeChip(d, arrive))
        : chip(cz.chip, next ? `${next.place.name} ${asHhmm(next.plannedArriveMin)}` : null, this.homeChip(d, arrive));
    const change = this.throttle(c, { text, cause: cz.key, deltaHomeMin: delta, size, atMin: d.now }, d.now);
    let v = `${cz.voice}. `;
    if (next) v += `${next.place.name}에는 ${asHhmm(next.plannedArriveMin)}, `;
    v += `${d.endName}에는 ${arrive}쯤 도착해요.`;
    return { kind: "Retimed", course: this.bump(c, this.keep(c, made, change)), change, voice: v };
  }

  /** 한계 침범: '덜 놀기'(≤30분) → 뒤에서부터 한 곳씩 → 뒤에서 여러 곳 → 바로 귀가. */
  private breach(c: LiveCourse, d: Draft, made: LiveCourse, delta: number): Outcome {
    const over = made.arriveHomeMin - d.limit;
    const options: PlanOption[] = [];
    const cz = d.cause;
    const closed = made.warnings.find((w) => w.includes("못 가요")) ?? null;

    // 덜 놀기: 마지막 남은 곳(없으면 지금 머무는 곳)의 머무름을 넘긴 만큼 줄여 본다
    if (over >= 1 && over <= SHORTEN_MAX_MIN && closed == null) {
      const rem = remainingOf(made);
      const target = rem.length > 0 ? rem[rem.length - 1] : currentOf(made);
      if (target && target.dwellGuessMin - over >= MIN_VISIT_MIN) {
        const trial = d.stops.map((s) => (s.place.id === target.place.id && s.status === target.status ? { ...s, dwellGuessMin: s.dwellGuessMin - over } : s));
        const tt = this.retime(d, trial);
        if (tt.closedStop == null && tt.arriveHomeMin <= d.limit) {
          options.push(this.option(tt, `${target.place.name} ${over}분 덜 놀기`, [reason(`머무름 ${target.dwellGuessMin - over}분`)]));
        }
      }
    }
    // 뒤에서부터 한 곳씩 빼 보기 → 안 되면 뒤에서 여러 곳
    const rem = remainingOf(made);
    let drop: [LiveStop[], Timetable] | null = null;
    let dropped: LiveStop[] = [];
    const tries: LiveStop[][] = [];
    for (let i = rem.length - 1; i >= 0; i--) tries.push([rem[i]]);
    for (let k = 2; k < rem.length; k++) tries.push(rem.slice(rem.length - k));
    for (const group of tries) {
      const ids = new Set(group.map((s) => s.place.id));
      const trial = fixNext(d.stops.map((s) => (remainingStop(s) && ids.has(s.place.id) ? { ...s, status: "SKIPPED" as StopStatus } : s)));
      const tt = this.retime(d, trial);
      if (tt.closedStop == null && tt.arriveHomeMin <= d.limit) { drop = [trial, tt]; dropped = group; break; }
    }
    if (drop) {
      const tt = drop[1];
      const names = dropped.map((s) => s.place.name).join("·");
      options.push(this.option(tt, `${names} 빼기`, [reason(d.arriveWord(tt.arriveHomeMin))]));
    }

    if (options.length === 0) {
      // 다 안 되면 바로 귀가 (확인은 받는다 — 남은 곳은 아직 SKIPPED가 아님)
      const trial = d.stops.map((s) => (remainingStop(s) ? { ...s, status: "SKIPPED" as StopStatus } : s));
      const tt = this.retime(d, trial);
      // 아직 집 근처(지금 떠나면 5분 안에 집)면 '집으로'가 아니라 '오늘은 다음에'
      const atHome = tt.arriveHomeMin - d.now <= 5;
      const text = atHome ? chip("오늘은 다녀오기 어려워요") : chip("귀가 한계를 넘어요", `${d.endName} ${asHhmm(tt.arriveHomeMin)} 도착`);
      const change = this.throttle(c, { text, cause: "한계 침범", deltaHomeMin: delta, size: "LOUD", atMin: d.now }, d.now);
      const out = this.keep(c, made, change);
      const v = atHome ? `${cz.voice}. 오늘은 다음에 가는 게 좋겠어요.` : `${cz.voice}. 지금 ${josa(d.endName, "으로/로")} 가는 게 좋겠어요. ${asHhmm(tt.arriveHomeMin)}쯤 도착해요.`;
      return { kind: "HomeNow", course: this.bump(c, out), change, voice: v };
    }
    const first = options[0];
    const head = closed != null ? `${first.label} · ${d.arriveWord(first.arriveHomeMin)}` : `${first.label}면 ${d.arriveWord(first.arriveHomeMin)}`;
    const change = this.throttle(c, { text: chip(cz.chip, head), cause: cz.key, deltaHomeMin: delta, size: "LOUD", atMin: d.now }, d.now);
    const why = closed != null ? closed : `그대로 가면 ${josa(d.arriveWord(made.arriveHomeMin), "이라/라")} 한계를 넘어요`;
    const voice = `${cz.voice}. ${why}. ${first.label}면 ${asHhmm(first.arriveHomeMin)}에 ${d.endName}에 도착해요. 그렇게 할까요?`;
    return { kind: "Proposal", course: this.bump(c, this.keep(c, made, change)), options, change, voice };
  }

  /** 칩 끝의 도착 글: 집이면 '귀가 HH:MM', 다른 도착지면 '할머니 집 HH:MM'. */
  private homeChip(d: Draft, arrive: string): string {
    return d.end == null ? `귀가 ${arrive}` : `${d.endName} ${arrive}`;
  }

  /** 같은 원인의 LOUD는 30분에 한 번. 반복이면 QUIET으로 낮춘다 (마지막 변경은 처음 것을 유지). */
  private throttle(c: LiveCourse, change: Change, now: number): Change {
    const last = c.lastChange;
    if (!last) return change;
    if (change.size === "LOUD" && last.cause === change.cause && now - last.atMin < SAME_CAUSE_MIN) {
      return { ...change, size: "QUIET" };
    }
    return change;
  }

  /** QUIET으로 낮춰진 반복 변경은 lastChange를 바꾸지 않는다. */
  private keep(c: LiveCourse, made: LiveCourse, change: Change): LiveCourse {
    return change.size === "QUIET" && c.lastChange?.cause === change.cause && c.lastChange.size === "LOUD"
      ? { ...made, lastChange: c.lastChange }
      : { ...made, lastChange: change };
  }

  /** 바뀐 게 있으면 버전 +1. (etaPending은 셈에 안 넣는다.) */
  private bump(old: LiveCourse, nu: LiveCourse): LiveCourse {
    const base = { ...nu, version: old.version, etaPending: old.etaPending };
    return deepEqual(base, old) ? { ...nu, version: old.version } : { ...nu, version: Math.max(nu.version, old.version) + 1 };
  }

  /** 초안 + 시간표 → 코스. */
  private finish(c: LiveCourse, d: Draft, tt: Timetable): LiveCourse {
    return {
      ...c,
      version: d.version,
      chosenBy: d.chosenBy,
      stops: tt.stops,
      legs: tt.legs,
      nowMin: d.now,
      here: d.here,
      arriveHomeMin: tt.arriveHomeMin,
      limitMin: d.limit,
      napLeg: tt.napLeg,
      warnings: tt.warnings,
      rainFromMin: d.rain,
      air: d.air,
      roadFactor: d.factor,
      dwellScale: d.dwellScale,
      napTaken: d.napTaken,
      etaPending: null,
      end: d.end,
      napOff: d.napOff,
      userLimit: d.userLimit,
    };
  }

  // ------------------------------------------------------------------ 제안 카드

  /** 남은 장소 전체 순서를 담은 카드 (채택하면 adopt가 이 순서·머무름대로 바꾼다). */
  private option(tt: Timetable, label: string, reasons: Reason[]): PlanOption {
    const places = tt.stops.filter(remainingStop).map((s) => s.place);
    const first = tt.legs.find((l) => !isStayLeg(l));
    return {
      kind: places.length === 0 ? "GO_HOME" : "COURSE",
      stops: places,
      firstLegMin: first ? legMinutes(first) : 0,
      detourMin: null,
      arriveHomeMin: tt.arriveHomeMin,
      legs: tt.legs,
      reasons: reasons.length > 0 ? reasons : [reason(`${asHhmm(tt.arriveHomeMin)} 귀가`)],
      label,
    };
  }

  /** 더 머물기: 낮잠 10분 전 출발이 60분 안이고 그때 다음 구간이 낮잠 이동이 되며 한계 안이면. (카드, 더 머무는 분) */
  private stretchOption(d: Draft, made: LiveCourse): [PlanOption, number] | null {
    const next = nextOf(made);
    if (!next) return null;
    const here = d.here;
    if (!here) return null;
    const dep = this.profile.napStartMin - NAP_DEPART_BEFORE_MIN;
    if (d.now >= this.profile.napStartMin - 20 || dep - d.now > NAP_STRETCH_MAX_MIN) return null;
    const len = this.estimate(here, next.place.at, d.factor);
    if (!TimeBudget.napAligned(dep, len, this.profile)) return null;
    const tt = this.retime(d, d.stops, dep);
    if (tt.closedStop != null || tt.arriveHomeMin > d.limit || tt.napLeg == null) return null;
    const more = dep - d.now;
    return [this.option(tt, `${asHhmm(dep)}에 출발`, [reason(`낮잠 맞춤 · 차에서 ${len}분`, "NAP"), reason(d.arriveWord(tt.arriveHomeMin))]), more];
  }

  /** 비: 지금 머무는 야외면 '비 오기 전 출발', 앞으로 갈 야외면 실내 교체. (카드, 칩 머리, 음성) */
  private rainOptions(d: Draft, made: LiveCourse, tt: Timetable): [PlanOption, string, string] | null {
    const rain = d.rain;
    if (rain == null) return null;
    const wet = tt.stops.find((s) => tt.wetStops.includes(s.place.id) && (remainingStop(s) || s.status === "ARRIVED"));
    if (!wet) return null;
    if (wet.status === "ARRIVED") {
      const leaveAt = Math.max(d.now, rain);
      const start = Math.max(wet.actualArriveMin ?? d.now, wet.place.openMin);
      const trial = d.stops.map((s) => (s.place.id === wet.place.id && s.status === "ARRIVED" ? { ...s, dwellGuessMin: Math.max(0, leaveAt - start) } : s));
      const t2 = this.retime(d, trial, d.now, false);
      if (t2.closedStop != null || t2.arriveHomeMin > d.limit) return null;
      const o = this.option(t2, `비 오기 전 ${asHhmm(leaveAt)} 출발`, [reason(`비 ${asHhmm(rain)}부터`, "RAIN"), reason(d.arriveWord(t2.arriveHomeMin))]);
      return [o, `비 ${asHhmm(rain)}부터 · ${asHhmm(leaveAt)}에 먼저 나설까요`, `비가 ${asHhmm(rain)}부터 와요. ${asHhmm(leaveAt)}에 먼저 나설까요?`];
    }
    const at = indexOfFirst(d.stops, (s) => s.place.id === wet.place.id && remainingStop(s));
    const o = this.replacementOption(d, at, wet.place, true);
    if (!o) return null;
    const alt = o.stops.find((p) => !d.stops.some((s) => s.place.id === p.id))!;
    return [o, `비 ${asHhmm(rain)}부터 · ${wet.place.name} → ${alt.name}`, `비가 ${asHhmm(rain)}부터 와요. ${wet.place.name} 대신 실내 ${josa(alt.name, "으로/로")} 바꿀까요?`];
  }

  /**
   * at 자리의 장소를 다른 곳으로. 앞 장소를 떠나는 시각·위치에서 재탑승 점수로 후보를 줄 세워 처음 맞는 곳.
   * at 자리의 원래 장소는 이미 SKIPPED여도 되고 아니어도 된다(그 자리에 새 장소를 넣고 원래 것은 뺀다).
   */
  private replacementOption(d: Draft, at: number, old: Place, indoorOnly: boolean): PlanOption | null {
    const used = new Set(d.stops.map((s) => s.place.id));
    const cands = forDay(this.catalog, this.day).filter((p) => !used.has(p.id) && (!indoorOnly || p.indoor));
    if (cands.length === 0) return null;
    const ahead = d.stops.slice(0, at);
    const before =
      [...ahead].reverse().find((s) => remainingStop(s) || s.status === "ARRIVED") ??
      [...ahead].reverse().find((s) => s.status === "DONE") ?? null;
    const t0 = (before ? (remainingStop(before) || before.status === "ARRIVED" ? before.plannedDepartMin : before.actualDepartMin) : null) ?? d.now;
    const at0 = before?.place.at ?? d.here ?? this.profile.home;
    const ranked = this.rank(Math.max(t0, d.now), at0, cands, d);
    for (const p of ranked) {
      const stop = liveStop(p, "PLANNED", d.now, d.now, roundToInt(dwellFor(this.profile, p) * d.dwellScale));
      const trial = fixNext(insertAt(d.stops.map((x, i) => (i === at && x.place.id === old.id ? { ...x, status: "SKIPPED" as StopStatus } : x)), at, stop));
      const tt = this.retime(d, trial);
      if (tt.closedStop != null || tt.arriveHomeMin > d.limit) continue;
      const reasons: Reason[] = [];
      if (p.festival) reasons.push(festivalReason(p.festival));
      if (p.indoor) reasons.push(reason("실내", "RAIN"));
      reasons.push(reason(d.arriveWord(tt.arriveHomeMin)));
      if (p.stampable) reasons.push(reason("도장 +1", "STAMP"));
      return this.option(tt, `${old.name} → ${p.name}`, reasons);
    }
    return null;
  }

  /** '한 곳 더': 마지막 남은 곳을 떠나는 시각·위치에서 재탑승 점수 1위를 끝에 붙여 본다 (새 선택이니 안전 10분). */
  private extraOption(d: Draft, made: LiveCourse): PlanOption | null {
    const used = new Set(made.stops.map((s) => s.place.id));
    const cands = forDay(this.catalog, this.day).filter((p) => !used.has(p.id));
    if (cands.length === 0) return null;
    const rem = remainingOf(made);
    const last = rem.length > 0 ? rem[rem.length - 1] : currentOf(made);
    const t0 = last?.plannedDepartMin ?? d.now;
    const at0 = last?.place.at ?? d.here ?? this.profile.home;
    const ranked = this.rank(Math.max(t0, d.now), at0, cands, d);
    for (const p of ranked) {
      const stop = liveStop(p, "PLANNED", d.now, d.now, roundToInt(dwellFor(this.profile, p) * d.dwellScale));
      const trial = fixNext([...d.stops, stop]);
      const tt = this.retime(d, trial);
      if (tt.closedStop != null || tt.arriveHomeMin > d.limit - TimeBudget.SAFETY_MIN) continue;
      const reasons: Reason[] = [];
      if (p.festival) reasons.push(festivalReason(p.festival));
      const airR = p.indoor ? airReason({ sunriseMin: null, sunsetMin: null, sky: "UNKNOWN", rainFromMin: null, air: d.air }) : null;
      if (airR) reasons.push(airR);
      if (tt.napLeg && tt.napLeg.placeId === p.id) reasons.push(reason(`낮잠 맞춤 · 차에서 ${legMinutes(tt.napLeg)}분`, "NAP"));
      if (p.indoor && d.rain != null && d.rain < t0 + RAIN_SOON_MIN) reasons.push(reason("비 → 실내", "RAIN"));
      reasons.push(reason(d.arriveWord(tt.arriveHomeMin)));
      if (p.stampable) reasons.push(reason("도장 +1", "STAMP"));
      return this.option(tt, `한 곳 더 · ${p.name}`, reasons);
    }
    return null;
  }

  /** 기존 재탑승 점수식으로 후보 줄 세우기 (한계는 코스의 한계). */
  private rank(nowMin: number, here: LatLng, cands: Place[], d: Draft): Place[] {
    let prof: FamilyProfile = { ...this.profile, backBy: { at: d.limit } };
    // 오늘 도착지가 집이 아니면 그곳까지, 오늘 낮잠을 빼면 낮잠 없이
    if (d.end) prof = { ...prof, home: d.end.at };
    if (d.napOff) prof = { ...prof, napEndMin: prof.napStartMin };
    const rain = d.rain;
    const sky: SkyToday = {
      sunriseMin: null, sunsetMin: null,
      sky: rain != null && rain <= nowMin ? "RAIN" : "UNKNOWN",
      rainFromMin: rain != null && rain > nowMin ? rain : null,
      air: d.air,
    };
    const top = reboard(nowMin, here, prof, cands, sky, this.day).options.filter((o) => o.stops.length > 0).map((o) => o.stops[0]);
    return [...top, ...cands.filter((c) => !top.some((t) => t.id === c.id))];
  }

  // ------------------------------------------------------------------ 시간표

  /** 낮잠 이동을 만들려고 앞 머무름을 늘린 시간표가 한계 안이면 그쪽, 아니면 그냥. */
  private retime(d: Draft, stops: LiveStop[] = d.stops, now: number = d.now, stretch = true): Timetable {
    const plain = this.build(d, stops, now, false);
    if (!stretch || plain.napLeg != null || d.noNap) return plain;
    const s = this.build(d, stops, now, true);
    return s.napLeg != null && s.closedStop == null && s.arriveHomeMin <= d.limit ? s : plain;
  }

  private build(d: Draft, stops: LiveStop[], now: number, stretch: boolean): Timetable {
    const legs: Leg[] = [];
    const out = [...stops];
    const warnings: string[] = [];
    const wet: string[] = [];
    let closed: LiveStop | null = null;
    let t = now;
    let at: LatLng = d.here ?? this.profile.home;
    let nap: Leg | null = null;
    let firstDrive = true;
    const rain = d.rain;
    const profile = this.profile;

    const stay = (i: number, s: LiveStop, from: number, start: number, dwell: number) => {
      const p = s.place;
      let end = Math.min(start + dwell, p.closeMin);
      if (end < from) end = from;
      if (start + dwell > p.closeMin && end > start) warnings.push(`${p.name} 문 닫는 시각까지 ${end - start}분`);
      if (!p.indoor && rain != null && end > rain) {
        wet.push(p.id);
        warnings.push(start >= rain ? `${p.name} 비 오는 중 야외` : `${p.name} 머무는 중 비 (${asHhmm(rain)}부터)`);
      }
      if (end > from) legs.push({ kind: isMealPlace(p) ? "MEAL" : "STAY", fromMin: from, toMin: end, placeId: p.id });
      out[i] = { ...s, plannedDepartMin: end };
      t = end;
      at = p.at;
    };

    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      switch (s.status) {
        case "DONE":
        case "SKIPPED":
          continue;
        case "ARRIVED": {
          const arrive = s.actualArriveMin ?? t;
          const start = Math.max(arrive, s.place.openMin);
          out[i] = { ...s, plannedArriveMin: arrive };
          stay(i, out[i], t, start, s.dwellGuessMin);
          break;
        }
        case "PLANNED":
        case "NEXT": {
          const p = s.place;
          const len = firstDrive && d.eta != null ? d.eta : this.estimate(at, p.at, d.factor);
          firstDrive = false;
          let depart = t;
          // 더 머물기: 앞 칸이 머무름이고 낮잠 10분 전 출발(60분 안)이 낮잠 이동이 되면
          // (사람이 오늘 직접 정한 머무름은 늘리지 않는다)
          const lastLeg = legs[legs.length - 1];
          const prevSet = lastLeg != null && out.some((x) => x.place.id === lastLeg.placeId && x.dwellSet && (remainingStop(x) || x.status === "ARRIVED"));
          if (stretch && nap == null && !d.noNap && !prevSet && legs[legs.length - 1]?.kind === "STAY") {
            const dep = profile.napStartMin - NAP_DEPART_BEFORE_MIN;
            if (t < profile.napStartMin - 20 && dep - t <= NAP_STRETCH_MAX_MIN && TimeBudget.napAligned(dep, len, profile)) {
              const last = legs.pop()!;
              legs.push({ ...last, toMin: dep });
              const j = indexOfFirst(out, (x) => x.place.id === last.placeId && (remainingStop(x) || x.status === "ARRIVED"));
              if (j >= 0) out[j] = { ...out[j], plannedDepartMin: dep };
              depart = dep;
            }
          }
          const napping = nap == null && !d.noNap && TimeBudget.napAligned(depart, len, profile);
          const leg: Leg = { kind: napping ? "NAP_DRIVE" : "DRIVE", fromMin: depart, toMin: depart + len, placeId: p.id };
          legs.push(leg);
          if (napping) nap = leg;
          else if (len > AWAKE_DRIVE_MAX_MIN) warnings.push(`깨어 있는 이동 ${len}분 (${p.name})`);
          t = depart + len;
          at = p.at;
          const start = Math.max(t, p.openMin);
          if (start - t > MAX_WAIT_MIN) warnings.push(`${p.name} 문 열기 ${start - t}분 기다림`);
          if (start + Math.min(s.dwellGuessMin, MIN_VISIT_MIN) > p.closeMin) {
            if (closed == null) closed = s;
            warnings.push(`${p.name} 문 닫기 전에 못 가요 (${asHhmm(t)} 도착)`);
            out[i] = { ...s, plannedArriveMin: t, plannedDepartMin: t };
            continue;
          }
          out[i] = { ...s, plannedArriveMin: t };
          stay(i, out[i], t, start, s.dwellGuessMin);
          break;
        }
      }
    }
    // 마지막 구간: 오늘 도착지(있으면) 또는 집
    const len = this.estimate(at, d.end?.at ?? profile.home, d.factor);
    const napping = nap == null && !d.noNap && TimeBudget.napAligned(t, len, profile);
    const home: Leg = { kind: napping ? "NAP_DRIVE" : "HOME", fromMin: t, toMin: t + len, placeId: null };
    legs.push(home);
    if (napping) nap = home;
    // 미세먼지 나쁨 이상인데 머무는 곳·남은 곳에 야외가 있으면 (사용자가 고른 코스) 경고 칩
    const air = d.air;
    if (air != null && airIsBad(air) && out.some((s) => (remainingStop(s) || s.status === "ARRIVED") && !s.place.indoor)) warnings.push(airWarning(air));
    return { stops: out, legs, arriveHomeMin: t + len, napLeg: nap, warnings, closedStop: closed, wetStops: wet };
  }
}

// ------------------------------------------------------------------ JSON (docs/코스-고도화-계획.md 10절 모양)
// 사례 파일의 사건 = 서버 `PATCH /api/plan/course` 본문의 `event`, 사례의 expect = 서버 응답·푸시 `course_update`의 모양.

export type StopJson = {
  placeId: string; status: StopStatus; plannedArriveMin: number; plannedDepartMin: number;
  actualArriveMin?: number; actualDepartMin?: number; dwellGuessMin: number; skipReason?: string;
  /** 오늘만 사람이 정한 머무름 (SetDwell·ExtendStay). 없으면 false. */
  dwellSet?: boolean;
  /** 머무름 예상의 출처 (서버가 응답에 붙임, 저장 안 함): family = 우리 가족 기록 n번 · crowd = 같은 또래 n가족 · base = 조사값. */
  dwellSource?: { source: "family" | "crowd" | "base"; n: number; text: string };
};
/** 코스 JSON 칸. 밥 칸(MEAL)은 옛 앱 때문에 "STAY" + meal: true 로 싣는다. */
export type LegJson = { kind: Exclude<Leg["kind"], "MEAL">; fromMin: number; toMin: number; placeId?: string; meal?: true };
export type CourseJson = {
  id: string; version: number; chosenBy: string; chosenAtMin: number; nowMin: number;
  /** [위도, 경도] 또는 null. */
  here: [number, number] | null;
  arriveHomeMin: number; limitMin: number; slackMin: number; rainFromMin: number | null;
  /** 미세먼지 등급 (옛 코스엔 없을 수 있다). */
  air?: AirLevel | null;
  roadFactor: number; dwellScale: number; napTaken: boolean;
  /** 두 번 연속 확인 중인 내비 ETA (서버가 이어서 판정하려고 같이 저장). */
  etaPending: number | null;
  /** 오늘 도착지 {name, at:[위도, 경도]} (집이면 없음/null) · 오늘 낮잠 끔 · 사용자가 정한 도착 목표. 옛 코스엔 없을 수 있다. */
  end?: { name: string; at: [number, number] } | null;
  napOff?: boolean;
  userLimit?: boolean;
  stops: StopJson[]; legs: LegJson[]; napLeg?: LegJson; warnings: string[]; lastChange?: Change;
};
/** 제안 카드 — `plans.options`의 카드(OptionJson)와 같은 모양. stops = 남은 장소 전체 순서. */
export type OptionJson = {
  kind: string; label: string;
  stops: { id: string; name: string; lat: number; lng: number; indoor: boolean; stampable: boolean }[];
  firstLegMin: number; detourMin: number | null; arriveHomeMin: number; arriveHome: string;
  legs: { kind: string; fromMin: number; toMin: number; placeId: string | null; meal?: true }[];
  reasons: { text: string; tone: string }[];
};
export type OutcomeJson = {
  kind: Outcome["kind"]; course: CourseJson; change: Change | null; voice: string | null; options?: OptionJson[];
};

const legJson = (l: Leg): LegJson => {
  const kind = l.kind === "MEAL" ? "STAY" : l.kind;
  const j: LegJson = l.placeId == null ? { kind, fromMin: l.fromMin, toMin: l.toMin } : { kind, fromMin: l.fromMin, toMin: l.toMin, placeId: l.placeId };
  if (l.kind === "MEAL") j.meal = true;
  return j;
};
const legOf = (j: LegJson): Leg => legOfJson(j);

export function courseToJson(c: LiveCourse): CourseJson {
  const j: CourseJson = {
    id: c.id, version: c.version, chosenBy: c.chosenBy, chosenAtMin: c.chosenAtMin, nowMin: c.nowMin,
    here: c.here ? [c.here.lat, c.here.lng] : null,
    arriveHomeMin: c.arriveHomeMin, limitMin: c.limitMin, slackMin: slackMin(c), rainFromMin: c.rainFromMin, air: c.air,
    roadFactor: c.roadFactor, dwellScale: c.dwellScale, napTaken: c.napTaken, etaPending: c.etaPending,
    stops: c.stops.map((s) => {
      const o: StopJson = { placeId: s.place.id, status: s.status, plannedArriveMin: s.plannedArriveMin, plannedDepartMin: s.plannedDepartMin, dwellGuessMin: s.dwellGuessMin };
      if (s.actualArriveMin != null) o.actualArriveMin = s.actualArriveMin;
      if (s.actualDepartMin != null) o.actualDepartMin = s.actualDepartMin;
      if (s.skipReason != null) o.skipReason = s.skipReason;
      if (s.dwellSet) o.dwellSet = true;
      return o;
    }),
    legs: c.legs.map(legJson),
    warnings: c.warnings,
    end: c.end ? { name: c.end.name, at: [c.end.at.lat, c.end.at.lng] } : null,
    napOff: c.napOff,
    userLimit: c.userLimit,
  };
  if (c.napLeg) j.napLeg = legJson(c.napLeg);
  if (c.lastChange) j.lastChange = c.lastChange;
  return j;
}

/** 장소 찾기: id → Place. 모르는 장소면 null. */
export type PlaceLookup = (id: string) => Place | null | undefined;

function needPlace(find: PlaceLookup, id: unknown): Place {
  if (typeof id !== "string") throw new Error("장소 id가 필요해요");
  const p = find(id);
  if (!p) throw new Error(`모르는 장소예요: ${id}`);
  return p;
}

export function courseFromJson(j: CourseJson, find: PlaceLookup): LiveCourse {
  return {
    id: j.id, version: j.version, chosenBy: j.chosenBy, chosenAtMin: j.chosenAtMin,
    stops: j.stops.map((s) => ({
      ...liveStop(needPlace(find, s.placeId), s.status, s.plannedArriveMin, s.plannedDepartMin, s.dwellGuessMin, s.actualArriveMin ?? null, s.actualDepartMin ?? null, s.skipReason ?? null),
      dwellSet: s.dwellSet === true,
    })),
    legs: j.legs.map(legOf),
    nowMin: j.nowMin,
    here: j.here ? { lat: j.here[0], lng: j.here[1] } : null,
    arriveHomeMin: j.arriveHomeMin, limitMin: j.limitMin,
    napLeg: j.napLeg ? legOf(j.napLeg) : null,
    lastChange: j.lastChange ?? null,
    warnings: j.warnings ?? [],
    rainFromMin: j.rainFromMin ?? null,
    air: AIRS.includes(j.air as AirLevel) ? (j.air as AirLevel) : null,
    roadFactor: j.roadFactor ?? TravelTime.ROAD_FACTOR,
    dwellScale: j.dwellScale ?? 1.0,
    napTaken: j.napTaken ?? false,
    etaPending: j.etaPending ?? null,
    end: j.end && Array.isArray(j.end.at) ? { name: j.end.name, at: { lat: j.end.at[0], lng: j.end.at[1] } } : null,
    napOff: j.napOff ?? false,
    userLimit: j.userLimit ?? false,
  };
}

export function optionToJson(o: PlanOption): OptionJson {
  return {
    kind: o.kind, label: o.label,
    stops: o.stops.map((p) => ({ id: p.id, name: p.name, lat: p.at.lat, lng: p.at.lng, indoor: p.indoor, stampable: p.stampable })),
    firstLegMin: o.firstLegMin, detourMin: o.detourMin, arriveHomeMin: o.arriveHomeMin, arriveHome: asHhmm(o.arriveHomeMin),
    legs: o.legs.map((l) => ({ kind: l.kind === "MEAL" ? "STAY" : l.kind, fromMin: l.fromMin, toMin: l.toMin, placeId: l.placeId, ...(l.kind === "MEAL" ? { meal: true as const } : {}) })),
    reasons: o.reasons.map((r) => ({ text: r.text, tone: r.tone })),
  };
}

export function optionFromJson(j: OptionJson, find: PlaceLookup): PlanOption {
  return {
    kind: j.kind as PlanOption["kind"], label: j.label,
    stops: j.stops.map((s) => needPlace(find, s.id)),
    firstLegMin: j.firstLegMin, detourMin: j.detourMin, arriveHomeMin: j.arriveHomeMin,
    legs: j.legs.map((l) => legOfJson(l)),
    reasons: j.reasons.map((r) => ({ text: r.text, tone: r.tone as Reason["tone"] })),
  };
}

/** 설명 JSON: 서버 응답·푸시의 explain 칸. speech = 읽어 줄 글. home = 지금 집으로 가면 도착 "HH:MM". */
export type ExplanationJson = Explanation & { speech: string; home: string | null };
export function explainToJson(e: Explanation): ExplanationJson {
  return { ...e, speech: speechOf(e), home: e.homeMin != null ? asHhmm(e.homeMin) : null };
}

export function outcomeToJson(o: Outcome): OutcomeJson {
  const j: OutcomeJson = { kind: o.kind, course: courseToJson(o.course), change: o.change ?? null, voice: o.voice ?? null };
  if (o.kind === "Proposal") j.options = o.options.map(optionToJson);
  return j;
}

const SKIES: Sky[] = ["CLEAR", "RAIN", "SNOW", "UNKNOWN"];
const AIRS: AirLevel[] = ["GOOD", "NORMAL", "BAD", "VERY_BAD", "UNKNOWN"];

/**
 * 사건 JSON → 사건. 모양이 틀리면 Error(한글 이유).
 *   {"type":"Departed","now":"12:10","from":"samguk"|null} · {"type":"Arrived","now":"09:00","place":"seokgul"} · {"type":"StillParked","now":"16:30"}
 *   {"type":"NaviEta","now":"08:31","remainMin":36} · {"type":"StillDriving","now":"08:57","here":[35.93,128.6]}
 *   {"type":"ReplaceNext"|"Skip"|"Insert"|"PlaceClosed","now":…,"place":…}
 *   {"type":"Weather","now":"11:00","sky":"CLEAR","rainFrom":"12:30"|null,"air":"BAD"?} · {"type":"GoHome","now":"14:30"}
 *   {"type":"LimitChanged","now":"11:00","limit":"16:40"} · {"type":"Remote","now":"11:00","version":9,"stops":["seokgul",…],"by":"엄마 폰"}
 *   {"type":"SetEnd","now":"08:30","end":{"name":"할머니 집","at":[35.8,128.5]}|"home","limit":"19:00","napOff":true}   (end·limit·napOff 모두 선택)
 *   {"type":"SetDwell","now":"08:30","place":"dgsm","minutes":90} (15~360분, 5분 단위로 맞춤) · {"type":"ExtendStay","now":"12:00","minutes":30} (0 = 지금 나갈게요)
 * Remote는 지금 코스를 바탕으로 남은 순서만 바꾼 코스를 만든다 (차가 다녀온 곳은 차 것이 이김).
 */
export function eventFromJson(m: Record<string, unknown>, course: LiveCourse, find: PlaceLookup): CourseEvent {
  if (typeof m.now !== "string") throw new Error("now(HH:MM)가 필요해요");
  const nowMin = hhmm(m.now);
  const placeId = () => needPlace(find, m.place).id;
  switch (m.type) {
    case "Departed": {
      if (m.from != null && typeof m.from !== "string") throw new Error("from은 장소 id 또는 null");
      return { type: "Departed", nowMin, from: (m.from as string | undefined) ?? null };
    }
    case "Arrived": return { type: "Arrived", nowMin, placeId: placeId() };
    case "StillParked": return { type: "StillParked", nowMin };
    case "StillDriving": {
      const here = ctxFromJson(m).here;
      if (!here) throw new Error("StillDriving에는 here([위도, 경도])가 필요해요");
      return { type: "StillDriving", nowMin, here };
    }
    case "NaviEta": {
      if (!Number.isInteger(m.remainMin) || (m.remainMin as number) < 0) throw new Error("remainMin은 0 이상 정수");
      return { type: "NaviEta", nowMin, remainMin: m.remainMin as number };
    }
    case "ReplaceNext": return { type: "ReplaceNext", nowMin, placeId: placeId() };
    case "Skip": return { type: "Skip", nowMin, placeId: placeId() };
    case "Insert": return { type: "Insert", nowMin, placeId: placeId() };
    case "Weather": {
      const sky = m.sky as Sky;
      if (!SKIES.includes(sky)) throw new Error("sky는 CLEAR·RAIN·SNOW·UNKNOWN");
      if (m.rainFrom != null && typeof m.rainFrom !== "string") throw new Error("rainFrom은 HH:MM 또는 null");
      if (m.air != null && !AIRS.includes(m.air as AirLevel)) throw new Error("air는 GOOD·NORMAL·BAD·VERY_BAD·UNKNOWN 또는 null");
      const ev: CourseEvent = { type: "Weather", nowMin, sky, rainFromMin: m.rainFrom ? hhmm(m.rainFrom as string) : null };
      return m.air != null ? { ...ev, air: m.air as AirLevel } : ev;
    }
    case "PlaceClosed": return { type: "PlaceClosed", nowMin, placeId: placeId() };
    case "GoHome": return { type: "GoHome", nowMin };
    case "Tick": return { type: "Tick", nowMin };
    case "SetDwell": {
      if (typeof m.minutes !== "number" || !Number.isFinite(m.minutes)) throw new Error("minutes는 분(숫자)");
      return { type: "SetDwell", nowMin, placeId: needPlace(find, m.place).id, minutes: Math.round(m.minutes) };
    }
    case "ExtendStay": {
      if (typeof m.minutes !== "number" || !Number.isFinite(m.minutes) || m.minutes < 0) throw new Error("minutes는 0 이상 분(숫자)");
      return { type: "ExtendStay", nowMin, minutes: Math.round(m.minutes) };
    }
    case "LimitChanged": {
      if (typeof m.limit !== "string") throw new Error("limit(HH:MM)이 필요해요");
      return { type: "LimitChanged", nowMin, limitMin: hhmm(m.limit) };
    }
    case "SetEnd": {
      let end: CourseEnd | null = null;
      let toHome = false;
      if (m.end === "home") toHome = true;
      else if (m.end != null) {
        const o = m.end as Record<string, unknown>;
        const at = o?.at as unknown[];
        if (typeof o !== "object" || typeof o.name !== "string" || !o.name.trim() || o.name.length > 20) throw new Error("end.name은 1~20자 글자");
        if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => typeof v === "number" && Number.isFinite(v)) || Math.abs(at[0] as number) > 90 || Math.abs(at[1] as number) > 180) {
          throw new Error("end.at은 [위도, 경도]");
        }
        end = { name: o.name.trim(), at: { lat: at[0] as number, lng: at[1] as number } };
      }
      if (m.limit != null && typeof m.limit !== "string") throw new Error("limit은 HH:MM");
      if (m.napOff != null && typeof m.napOff !== "boolean") throw new Error("napOff는 true/false");
      return { type: "SetEnd", nowMin, end, toHome, limitMin: m.limit ? hhmm(m.limit as string) : null, napOff: (m.napOff as boolean | undefined) ?? null };
    }
    case "Remote": {
      if (!Number.isInteger(m.version)) throw new Error("version은 정수");
      if (!Array.isArray(m.stops)) throw new Error("stops는 장소 id 배열");
      if (m.by != null && typeof m.by !== "string") throw new Error("by는 글자");
      // 지금 코스에 이미 남아 있는 곳은 그 머무름(우리 가족 값·오늘 직접 정한 값)을 이어 간다. 새로 넣는 곳은 조사값.
      const stops = m.stops.map((id) => {
        const p = needPlace(find, id);
        const had = course.stops.find((s) => s.place.id === p.id && (s.status === "PLANNED" || s.status === "NEXT"));
        const st = liveStop(p, "PLANNED", nowMin, nowMin, had ? had.dwellGuessMin : p.dwellP80Min);
        if (had?.dwellSet) st.dwellSet = true;
        return st;
      });
      const remote: LiveCourse = { ...course, version: m.version as number, chosenBy: (m.by as string | undefined) ?? course.chosenBy, stops };
      return { type: "Remote", nowMin, version: remote.version, course: remote };
    }
    default:
      throw new Error(`모르는 사건이에요: ${String(m.type)}`);
  }
}

/** 사건 JSON의 덧붙임(driving·here) → 차 상황. */
export function ctxFromJson(m: Record<string, unknown>): CourseCtx {
  let here: LatLng | null = null;
  if (m.here != null) {
    const h = m.here as unknown[];
    if (!Array.isArray(h) || h.length !== 2 || !h.every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error("here는 [위도, 경도]");
    here = { lat: h[0] as number, lng: h[1] as number };
  }
  return { driving: m.driving === true, here };
}
