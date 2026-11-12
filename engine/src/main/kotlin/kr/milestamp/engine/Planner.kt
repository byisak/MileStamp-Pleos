package kr.milestamp.engine

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** MORNING = 14시 전 첫 탑승(하루 코스), AFTERNOON = 14시 이후 첫 탑승(짧은 나들이), REBOARD = 내렸다 다시 탐. */
enum class PlanMode { MORNING, AFTERNOON, REBOARD }

enum class OptionKind { COURSE, NEARBY, HOMEWARD, GO_HOME }

/**
 * 하루 막대의 칸 종류. HOME = 집으로 가는 마지막 이동 (그 이동에서 낮잠을 자면 NAP_DRIVE). MEAL = 식당에서 밥 먹는 머무름 ([Meals]).
 * 서버 JSON에는 옛 앱 때문에 MEAL을 "STAY" + meal: true 로 싣는다.
 */
enum class LegKind { DRIVE, STAY, NAP_DRIVE, HOME, MEAL }

/** 하루 막대의 한 칸. [placeId]는 이동이면 도착할 곳, 머무름이면 그곳. 집으로 가는 이동은 null. */
data class Leg(val kind: LegKind, val fromMin: Int, val toMin: Int, val placeId: String? = null) {
    val minutes: Int get() = toMin - fromMin
    /** 머무는 칸 (장소 머무름 STAY 또는 식사 MEAL). 이동 칸이 아님. */
    val isStay: Boolean get() = kind == LegKind.STAY || kind == LegKind.MEAL
}

/** 이유 칩 색: 보통 · 해(맑음·해 지는 시각) · 낮잠 · 도장 · 비 · 축제(기간 한정) · 미세먼지(나쁨 이상) · 식사(밥 자리). */
enum class Tone { PLAIN, SUN, NAP, STAMP, RAIN, FESTIVAL, AIR, MEAL }

/** 카드의 이유 칩. AI 문장이 아니라 엔진 값으로 만든다. */
data class Reason(val text: String, val tone: Tone = Tone.PLAIN)

data class PlanOption(
    val kind: OptionKind,
    val stops: List<Place>,
    /** 지금 위치에서 첫 정차지(바로 귀가면 집)까지 분. */
    val firstLegMin: Int,
    /** 우회 분. 한 곳 들르기(재탑승·오후)만. */
    val detourMin: Int? = null,
    /** 예상 귀가 시각(분). */
    val arriveHomeMin: Int,
    /** 하루 막대: 이동 → 머무름 → … → 집. */
    val legs: List<Leg> = emptyList(),
    val reasons: List<Reason> = emptyList(),
    /** 카드 제목 위 작은 글 ("1순위 · 하루 코스", "집 가는 길에 잠깐" …). */
    val label: String = "",
    /** 귀가 한계(안전 여유 10분 포함)를 넘는 카드 — 앵커 코스에서 '여기만'도 넘을 때만 (폰이 '오늘만 귀가 한계 늦추기'를 묻는다). */
    val overLimit: Boolean = false,
    /** 넣은 밥 자리 (밥도 같이 짜기를 켰을 때만). [stops]·[legs]에도 들어 있다 (식당 = [Place.isMeal], 칸 = MEAL). */
    val meal: MealStop? = null,
    /** 밥 자리를 못 넣은 까닭 ('근처에 등록된 식당이 없어요' · '밥 넣을 시간이 빠듯해요') — 칩에도 붙는다. */
    val mealHint: String? = null,
) {
    /** 칩 글자만 (예전 `reasons: List<String>` 자리). */
    val reasonTexts: List<String> get() = reasons.map { it.text }
}

data class Plan(
    val mode: PlanMode,
    val nowMin: Int,
    /** 여유 = 귀가 한계 − 지금 − 집까지 − 10분. 음수면 0. */
    val budgetMin: Int,
    /** 귀가 한계 (해 지기 N분 전 또는 고정 시각, 오후 모드는 저녁 시각과 비교해 이른 쪽). */
    val backByMin: Int,
    val options: List<PlanOption>,
    val sky: SkyToday? = null,
    /** 이미 고른 카드 번호 (폰이나 차에서). null이면 아직 안 고름. */
    val chosen: Int? = null,
    /** 누가 골랐는지 (예: "아빠 폰", "차"). */
    val chosenBy: String? = null,
    /** 저녁 나들이 카드가 들어 있음 (해 진 뒤 저녁 모드, 또는 늦은 오후에 낮 카드가 없어 저녁 카드를 붙임). mode는 예전 차 앱 때문에 AFTERNOON 그대로. */
    val evening: Boolean = false,
    /** 해가 이미 졌을 때 '내일 노을 보러' 안내 (노을 명소 하나). 저녁 모드에서만. */
    val sunsetTip: SunsetTip? = null,
) {
    val best: PlanOption? get() = options.firstOrNull()
    val chosenOption: PlanOption? get() = chosen?.let { options.getOrNull(it) }
}

/** '해 질 녘 전망 · 내일 추천' — [sunsetMin] = 오늘 해 지는 시각(내일도 거의 같음), [arriveByMin] = 그 [Planner.SUNSET_BEFORE_MIN]분 전 도착. */
data class SunsetTip(val placeId: String, val placeName: String, val sunsetMin: Int, val arriveByMin: Int)

/** '왜?' 설명 한 줄. [tone]은 칩 색·아이콘 (이유 칩과 같은 색). */
data class WhyLine(val text: String, val tone: Tone = Tone.PLAIN)

/** 카드의 장소 하나에 대한 '왜?' 설명 ([Planner.explainChoice]). */
data class StopWhy(val placeId: String, val lines: List<WhyLine>)

/**
 * 앵커 코스 결과 ([Planner.anchored]). [anchorDwellMin] = 앵커에서 머무는 분(정한 값 또는 기본값),
 * [oneWayMin] = 지금 위치→앵커와 앵커→집 중 긴 쪽(분), [overnight] = 편도 3시간 넘음('1박은 아직 몰라요'),
 * [closed] = 문 닫는 시각 등으로 오늘은 못 감 (카드 없음).
 */
data class AnchorPlan(
    val plan: Plan,
    val anchorId: String,
    val anchorDwellMin: Int,
    val oneWayMin: Int,
    val overnight: Boolean,
    val closed: Boolean,
)

/**
 * 추천 계산. 규칙과 점수만 쓴다 (AI 없음). 같은 입력 → 같은 출력.
 * 서버 `web/src/lib/planner.ts`가 이 파일을 그대로 옮긴다 — 두 쪽이 같은 시험 사례
 * (`engine/src/test/resources/plan-cases.json`)로 결과가 같은지 확인하므로, 계산 순서·동점 처리까지 맞춘다.
 *
 * 공통 규칙
 * - 시간표: 이동(TravelTime) → 머무름([FamilyProfile.dwellFor] = P80 × 우리 가족 배율·기록, 문 열기 전이면 열 때까지 기다림, 기다림도 머무름 칸에 넣음) → … → 집.
 * - 버림: 귀가 한계 − 10분을 넘겨 집 도착 / 문 닫기 30분 전 이후 도착 / 문 열기를 30분 넘게 기다림 /
 *   깨어 있는 아이의 한 번 이동 > 60분.
 * - 낮잠 이동(NAP_DRIVE): [TimeBudget.napAligned] (낮잠 20분 전~10분 뒤 출발 + 이동이 낮잠 길이의 0.7~1.1배).
 *   하루 코스는 낮잠 이동이 되도록 앞 장소에서 최대 60분 더 머물 수 있다(낮잠 10분 전 출발). 하루 한 번.
 * - 동점이면 귀가가 이른 쪽, 그래도 같으면 장소 id를 쉼표로 이은 글자 순.
 */
object Planner {

    /** 이 시각 이후 첫 탑승은 짧은 나들이 (사용자 결정 10/25). */
    const val AFTERNOON_FROM_MIN = 14 * 60
    /** 우회가 이 값 이하면 '귀갓길', 넘으면 '근처'로 부른다. */
    const val HOMEWARD_DETOUR_MAX_MIN = 15
    /** 하루 코스 최대 장소 수. */
    const val MAX_STOPS = 3
    /** 깨어 있는 아이가 한 번에 차에 있는 최대 시간. */
    const val AWAKE_DRIVE_MAX_MIN = 60
    /** 문 닫기 전 최소 이만큼은 있어야 간다. */
    const val MIN_VISIT_MIN = 30
    /** 문 열기를 이보다 오래 기다려야 하면 그 순서는 버린다. */
    const val MAX_WAIT_MIN = 30
    /** 낮잠 이동을 맞추려고 앞 장소에서 더 머물 수 있는 최대 분. */
    const val NAP_STRETCH_MAX_MIN = 60
    /** 낮잠 이동 출발 = 낮잠 시작 10분 전. */
    const val NAP_DEPART_BEFORE_MIN = 10
    /** '요즘 많이 감'으로 치는 최소 팀 수. */
    const val POPULAR_MIN = 10
    /** '가깝게' 코스: 모든 장소가 집(또는 출발지)에서 이 분 안 + 어느 이동도 이 분 이하. */
    const val NEAR_MAX_MIN = 30
    /** 낮잠이 없는 가족의 '점심 전 귀가' 기준 (13시). */
    const val LUNCH_MIN = 13 * 60
    /** 귀가 여유가 이보다 적으면 감점 (해 지기 직전 귀가). */
    const val LATE_SLACK_MIN = 30
    /** 비가 이 안에 오면 재탑승·오후 추천은 실내 가점. */
    const val RAIN_SOON_MIN = 180
    /** '해 지기 N분 전 귀가' 칩은 이보다 이르게 도착하면 안 붙인다. */
    const val SUN_CHIP_MAX_MIN = 120
    /** 집에서 이 거리 안이면 '집에 있음' ('오늘은 쉬어요'). */
    const val AT_HOME_M = 300
    /** 미세먼지 나쁨: 야외 한 곳마다 감점 (비 3시간 안 야외 감점과 같은 크기). */
    const val AIR_BAD_OUTDOOR = 2.0
    /** 미세먼지 매우 나쁨: 야외 한 곳마다 감점 (더 세게). */
    const val AIR_VERY_BAD_OUTDOOR = 4.0
    /** 미세먼지 나쁨 이상: 실내 한 곳마다 가점. */
    const val AIR_INDOOR_BONUS = 1.0

    // 방문 기록 점수 (FamilyProfile.history가 있을 때만) — 매일 같은 곳이 나오지 않게
    /** 이미 도장을 받은 곳: 도장 가점(1)을 지운다. */
    const val HISTORY_STAMPED = -1.0
    /** 한 번도 안 가 본 곳 (도장도 방문도 없음). */
    const val HISTORY_NEW = 0.5
    /** 최근 [RECENT_DAYS]일 안에 다녀온 곳: 크게 낮춘다. */
    const val HISTORY_RECENT = -2.0
    const val RECENT_DAYS = 14
    /** 즐겨찾는 곳. */
    const val HISTORY_FAVORITE = 1.0

    // 앵커 코스 ('○○ 중심으로 코스 짜기')
    /** 축제를 앵커로 고르면 기본 머무름. */
    const val ANCHOR_FESTIVAL_DWELL_MIN = 120
    /** '가는 길에 한 곳': 앵커만 갈 때보다 더 운전하는 시간이 이 안. */
    const val ANCHOR_ON_WAY_MAX_MIN = 20
    /** '근처 한 곳': 앵커에서 차로 이 안. */
    const val ANCHOR_NEAR_MAX_MIN = 20
    /** 앵커는 문 열기를 이만큼까지 기다린다 (사용자가 고른 곳이라 버리지 않음). */
    const val ANCHOR_WAIT_MAX_MIN = 120
    /** 편도 이보다 멀면 '1박은 아직 몰라요'. */
    const val OVERNIGHT_MIN = 180

    // 동행 (누구랑 가요?) — 아이와가 아닐 때만
    /** 어른끼리 한 번에 운전하는 최대 시간 (아이와는 [AWAKE_DRIVE_MAX_MIN]). */
    const val ADULT_DRIVE_MAX_MIN = 90
    /** 해 시각을 모를 때 '해 진 뒤'로 치는 시각. */
    const val DARK_FALLBACK_MIN = 18 * 60
    /** 연인·부부: 해 진 뒤 야경 명소. */
    const val TAG_NIGHT_BONUS = 1.0
    /** 동행에 맞는 분위기 표시 하나 (데이트·액티비티·조용함 …). */
    const val TAG_BONUS = 0.5
    /** 친구끼리: 축제·행사. */
    const val FRIENDS_FESTIVAL_BONUS = 0.5
    /** 어른끼리: 해 진 뒤 야외(야경 아님)에 머묾. */
    const val DARK_OUTDOOR_MINUS = 0.5
    /** 분위기 표시 이름. */
    const val TAG_NIGHT = "야경"
    /** 동행마다 가점 받는 표시 (앞에 있을수록 '왜?' 글에 먼저 나온다). 야경은 연인·부부가 해 진 뒤만 따로. */
    val COMPANION_TAGS: Map<GoWith, List<String>> = mapOf(
        GoWith.COUPLE to listOf("데이트", "카페", "산책", "드라이브"),
        GoWith.FRIENDS to listOf("액티비티", "체험", "드라이브"),
        GoWith.SOLO to listOf("조용함", "전시", "산책"),
    )

    /**
     * 오늘 첫 탑승: 14시 전이면 하루 코스, 이후면 짧은 나들이, 해 진 뒤 ~ 귀가 한계 90분 전이면 저녁 나들이([evening]).
     * [day] = 오늘 날짜 'YYYY-MM-DD' (축제 기간 판단). 모르면 축제는 후보에서 빠진다.
     * [maxStops] = 코스 한 장에 넣을 곳 수 한도 1~3 (폰 '가볍게 한 곳만' = 1). 오후는 늘 한 곳.
     */
    fun firstBoarding(
        nowMin: Int, here: LatLng, profile: FamilyProfile, candidates: List<Place>, sky: SkyToday?, day: String? = null, maxStops: Int = MAX_STOPS,
    ): Plan = when {
        isEvening(nowMin, profile, sky) -> evening(nowMin, here, profile, candidates, sky, day)
        nowMin >= darkMin(sky) && nowMin > eveningEndMin(profile) -> lateNight(nowMin, here, profile, candidates, sky, day)
        nowMin < AFTERNOON_FROM_MIN -> morning(nowMin, here, profile, candidates, sky, day, maxStops)
        else -> afternoon(nowMin, here, profile, candidates, sky, day)
    }

    /** 저녁 나들이 시간도 지난 밤: '바로 집으로'(집이면 '오늘은 쉬어요') 한 장 — 폰은 '내일 미리'를 띄운다 ([isNight]). */
    fun lateNight(nowMin: Int, here: LatLng, profile: FamilyProfile, all: List<Place>, sky: SkyToday?, day: String? = null): Plan {
        val limit = profile.eveningLimitMin
        val toHome = TravelTime.minutes(here, profile.home)
        val ctx = Ctx(nowMin, here, profile, sky, rainStartMin(sky, nowMin), limit)
        val home = goHome(toHome, ctx, forDay(all, day).isEmpty(), true)
        // 여유는 0 (더 갈 곳이 없는 밤)
        return Plan(PlanMode.AFTERNOON, nowMin, 0, limit, listOf(home), sky)
    }

    /**
     * [day]의 후보: 그날 쉬는 곳(쉬는 요일·임시 휴무)은 빼고, 축제는 그날 열릴 때만(기간 안 + 쉬는 요일 아님),
     * 열리는 축제가 붙은 명소는 빼고 축제가 대신한다. 운영 시간 줄이 있는 곳은 그날 시각을 입힌다([Place.onDay]).
     * 하루 운영 시각은 시간표(문 여는·닫는 시각·마지막 입장)가 따진다.
     */
    fun forDay(all: List<Place>, day: String?): List<Place> {
        val candidates = all.map { it.onDay(day) }
        val replaced = candidates.mapNotNull { p -> p.festival?.takeIf { it.runsOn(day) }?.placeId }.toSet()
        return candidates.filter { p -> !p.closedOn(day) && (p.festival?.runsOn(day) ?: (p.id !in replaced)) }
    }

    /** 축제 칩: '이번 주말만 · 11/9까지'. */
    fun festivalReason(f: FestivalInfo): Reason = Reason("이번 주말만 · ${f.endsText}까지", Tone.FESTIVAL)

    /** 귀가 한계. 오후 모드만 저녁 시각과 비교. */
    fun limitMin(mode: PlanMode, profile: FamilyProfile, sky: SkyToday?): Int {
        val back = profile.backByMin(sky)
        val dinner = profile.dinnerMin
        return if (mode == PlanMode.AFTERNOON && dinner != null && profile.companion.kids) min(back, dinner) else back
    }

    /** 해 진 뒤로 치는 시각: 해 지는 시각, 모르면 18:00. */
    fun darkMin(sky: SkyToday?): Int = sky?.sunsetMin ?: DARK_FALLBACK_MIN

    /**
     * 동행 점수 (장소 하나). 아이와 = 아이 적합×2 (예전 그대로).
     * 어른끼리 = 동행 적합×2 + 분위기 가점: 연인·부부는 해 진 뒤 야경 +1 · 데이트 등 +0.5, 친구끼리는 액티비티·체험 +0.5 · 축제 +0.5,
     * 혼자는 조용함·전시 +0.5 (표시 하나만 — 여러 개여도 +0.5) − 해 진 뒤 야외(야경 아님) 0.5. [stay] = 그곳에 머무는 칸(모르면 null).
     */
    fun fitScore(p: Place, stay: Leg?, profile: FamilyProfile, sky: SkyToday?): Double {
        val c = profile.companion
        if (c.kids) return 2.0 * p.kidFit
        var s = 2.0 * p.fitFor(c)
        val dark = stay != null && stay.toMin > darkMin(sky)
        val night = TAG_NIGHT in p.tags
        if (c == GoWith.COUPLE && night && dark) s += TAG_NIGHT_BONUS
        if (COMPANION_TAGS[c].orEmpty().any { it in p.tags }) s += TAG_BONUS
        if (c == GoWith.FRIENDS && p.festival != null) s += FRIENDS_FESTIVAL_BONUS
        if (dark && !p.indoor && !night) s -= DARK_OUTDOOR_MINUS
        return s
    }

    /**
     * 밤이라 오늘은 더 갈 곳이 없음 → 폰이 '내일 계획 짜기'를 보여 준다. 저녁 나들이 시간([isEvening])이 끝난 뒤:
     * 아이와 = (귀가 한계나 해 진 뒤) + 잠자는 시간 90분 전 지남, 어른끼리 = 늦어도 몇 시 귀가 90분 전 지남.
     */
    fun isNight(nowMin: Int, profile: FamilyProfile, sky: SkyToday?): Boolean {
        val over = nowMin > eveningEndMin(profile)
        return if (profile.companion.kids) over && (nowMin >= profile.backByMin(sky) || sky?.sunsetMin?.let { nowMin >= it } == true)
        else over
    }

    /** 저녁 나들이를 권하는 마지막 시각: 귀가 한계(잠자는 시간 · 늦어도 몇 시) − 90분. */
    fun eveningEndMin(profile: FamilyProfile): Int = profile.eveningLimitMin - EVENING_PREP_MIN

    /** 저녁 모드: 해 진 뒤(모르면 18:00) ~ 귀가 한계 90분 전. */
    fun isEvening(nowMin: Int, profile: FamilyProfile, sky: SkyToday?): Boolean =
        nowMin >= darkMin(sky) && nowMin <= eveningEndMin(profile)

    /**
     * 카드 성격 (폰 대화의 답과 맞추기): short 가볍게 · full 두세 곳 알차게 · nap 낮잠 맞춰서 · indoor 실내 · popular 요즘 많이 가요 ·
     * near 가까운 곳 · home 바로 집으로 · evening 저녁에 잠깐(야경·노을·늦게 여는 실내) · drive 야경 드라이브.
     * 이름 붙은 카드(짧게·가깝게·요즘 많이 가요·실내 대안·저녁 ·…·노을 전망)는 그 이름대로,
     * 나머지는 낮잠 이동이 있으면 nap, 장소 2곳 이상이면 full, 한 곳이면 short(근처 한 곳은 near).
     */
    fun pickOf(o: PlanOption): String = when {
        o.kind == OptionKind.GO_HOME -> "home"
        o.label.startsWith(LABEL_DRIVE) -> "drive"
        o.label.startsWith(EVENING_PREFIX) || o.label.startsWith(LABEL_SUNSET) -> "evening"
        o.label.startsWith("짧게") || o.label.startsWith("가볍게") -> "short"
        o.label.startsWith("가깝게") -> "near"
        o.label.startsWith("요즘 많이") -> "popular"
        o.label.startsWith("실내") -> "indoor"
        o.legs.any { it.kind == LegKind.NAP_DRIVE } -> "nap"
        o.stops.count { !it.isMeal } >= 2 -> "full"
        o.kind == OptionKind.NEARBY -> "near"
        else -> "short"
    }

    /** 미세먼지 점수: 나쁨 이상이면 실내 +1, 야외 −2(나쁨)·−4(매우 나쁨). 좋음·보통·모름은 0. */
    fun airScore(p: Place, air: AirLevel?): Double = when (air) {
        AirLevel.BAD -> if (p.indoor) AIR_INDOOR_BONUS else -AIR_BAD_OUTDOOR
        AirLevel.VERY_BAD -> if (p.indoor) AIR_INDOOR_BONUS else -AIR_VERY_BAD_OUTDOOR
        else -> 0.0
    }

    /**
     * 방문 기록 점수: 이미 도장 −1(도장 가점 지움) · 안 가 본 곳 +0.5 · 최근 14일 안에 다녀옴 −2 · 즐겨찾기 +1.
     * 기록을 모르면(null) 0 — 예전 사례와 같은 결과.
     */
    fun historyScore(p: Place, h: VisitHistory?): Double {
        if (h == null) return 0.0
        var s = 0.0
        val stamped = p.id in h.stamped
        val days = h.lastVisitDays[p.id]
        if (stamped && p.stampable) s += HISTORY_STAMPED
        if (!stamped && days == null) s += HISTORY_NEW
        if (days != null && days < RECENT_DAYS) s += HISTORY_RECENT
        if (p.id in h.favorites) s += HISTORY_FAVORITE
        return s
    }

    /** 이 장소에서 새 도장을 받나: 도장 그림이 있고, 기록을 알면 아직 안 받은 곳만. */
    fun newStamp(p: Place, h: VisitHistory?): Boolean = p.stampable && (h == null || p.id !in h.stamped)

    /** 미세먼지 칩: '미세먼지 나쁨 → 실내' (나쁨 이상일 때만, 아니면 null). */
    fun airReason(sky: SkyToday?): Reason? =
        sky?.air?.takeIf { it.bad }?.let { Reason("미세먼지 ${it.text} → 실내", Tone.AIR) }

    /** 비가 시작되는 시각. 지금 오고 있으면 지금. 비 소식이 없으면 null. */
    fun rainStartMin(sky: SkyToday?, nowMin: Int): Int? = when {
        sky == null -> null
        sky.sky == Sky.RAIN -> nowMin
        else -> sky.rainFromMin
    }

    // 저녁 나들이 (docs/장소-데이터-구조-계획.md §7, proto/evening-plan.html)
    /** 귀가 한계 이만큼 전까지만 저녁 나들이를 권한다 (그 뒤는 '내일 미리'). */
    const val EVENING_PREP_MIN = 90
    /** 쇼·조명·노을에 맞추느라 또는 문 열기를 이보다 오래 기다려야 하면 그곳은 뺀다. */
    const val EVENING_WAIT_MAX_MIN = 40
    /** 저녁 나들이 전체(출발 → 집) 최대: 아이와 2시간 · 어른끼리 3시간. */
    const val EVENING_KIDS_OUTING_MAX_MIN = 120
    const val EVENING_ADULT_OUTING_MAX_MIN = 180
    /** 한 곳 머무름: 30분 ~ 아이와 60분 · 어른끼리 90분. 쌀쌀하면 야외는 40분까지. */
    const val EVENING_DWELL_MIN = 30
    const val EVENING_KIDS_DWELL_MAX = 60
    const val EVENING_ADULT_DWELL_MAX = 90
    const val EVENING_COLD_OUTDOOR_MAX = 40
    /** 저녁 한 번 이동 최대: 아이와 40분 · 어른끼리 60분. */
    const val EVENING_KIDS_DRIVE_MAX = 40
    const val EVENING_ADULT_DRIVE_MAX = 60
    /** 이 기온(℃) 이하면 쌀쌀함 → 야외는 짧게, 실내 가점. */
    const val COLD_C = 5
    /** 쇼 시작 이만큼 전에 도착. */
    const val SHOW_BEFORE_MIN = 10
    /** 노을: 해 지기 이만큼 전에 도착. */
    const val SUNSET_BEFORE_MIN = 20
    /** 늦은 오후(해 지기 이만큼 전부터)에 낮 카드가 없으면 저녁 카드를 붙인다. */
    const val EVENING_APPEND_FROM_MIN = 120
    /** 저녁 어울림이 없고 밤 명소도 아니면 낮 어울림 × 이 값. */
    const val EVENING_FIT_GUESS = 0.6

    // ------------------------------------------------------------------ 하루 코스

    /**
     * 아침 하루 코스: 후보에서 1~3곳을 순서대로 고르는 모든 경우를 따져(시간 넘으면 가지치기)
     * 서로 다른 3장을 고른다 — 1순위 / 가깝게([isNear]: 모든 장소가 집·출발지에서 30분 안, 어느 이동도 30분 이하.
     * 그런 코스가 없으면 다음으로 좋은 다른 코스를 '2순위 · 하루 코스'로) / 요즘 많이 가요
     * (자료 없으면: 비 소식(또는 미세먼지 나쁨 이상)이 있고 1순위에 야외가 있으면 '실내 대안', 아니면 낮잠 전에 집에 오는 '짧게').
     * 비 오는 시간에는 야외에 머물지 않는다. 맞는 코스가 없으면 '오늘은 쉬어요'(집) 또는 '바로 집으로' 1장.
     *
     * 점수 = Σ(아이 적합×2 + 도장 1 + 요즘 많이 감 0.5 + 축제 가중치(보통 1 · 강하게 2.5) + 미세먼지([airScore])) − (깨어 있는 이동 분 + 문 열기 기다린 분)/60
     *        + 낮잠 맞춤(최대 3) − 귀가 여유 30분 미만 감점(최대 1)
     */
    fun morning(
        nowMin: Int, here: LatLng, profile: FamilyProfile, all: List<Place>, sky: SkyToday?, day: String? = null, maxStops: Int = MAX_STOPS,
    ): Plan {
        val candidates = forDay(all, day)
        val depth = maxStops.coerceIn(1, MAX_STOPS)
        val limit = limitMin(PlanMode.MORNING, profile, sky)
        val toHome = TravelTime.minutes(here, profile.home)
        val budget = TimeBudget.availableMin(nowMin, limit, toHome)
        val safe = limit - TimeBudget.SAFETY_MIN
        val rain = rainStartMin(sky, nowMin)

        val courses = mutableListOf<Scored>()
        fun search(seq: List<Place>) {
            if (seq.isNotEmpty()) {
                // 가지치기: 가장 이른 시간표로도 마지막 장소에서 집까지 한계를 넘으면 더 붙여도 소용없다
                val reach = walk(nowMin, here, seq, profile, rain, rainHard = true, stretchNap = false) ?: return
                if (reach.t + TravelTime.minutes(reach.at, profile.home) > safe) return
                val plain = finish(reach, profile)
                val stretched = walk(nowMin, here, seq, profile, rain, rainHard = true, stretchNap = true)?.let { finish(it, profile) }
                listOfNotNull(plain, stretched)
                    .filter { it.arriveHome <= safe }
                    .map { Scored(seq, it, courseScore(seq, it, safe, sky, profile)) }
                    .sortedWith(ORDER)
                    .firstOrNull()?.let(courses::add)
            }
            if (seq.size == depth) return
            for (p in candidates) if (seq.none { it.id == p.id }) search(seq + p)
        }
        search(emptyList())
        courses.sortWith(ORDER)

        val ctx = Ctx(nowMin, here, profile, sky, rain, limit)
        if (courses.isEmpty()) {
            return Plan(PlanMode.MORNING, nowMin, max(0, budget), limit, listOf(goHome(toHome, ctx, candidates.isEmpty(), true)), sky)
        }

        val picked = mutableListOf<Pair<Scored, String>>()
        val best = courses.first()
        picked += best to "1순위 · 하루 코스"

        val near = diverse(courses, picked.map { it.first }) { isNear(it, ctx) }
        if (near != null) {
            val dry = rain != null && near.stops.all { it.indoor }
            picked += near to (if (dry) "가깝게 · 비 걱정 없이" else "가깝게")
        } else {
            // 가까운 코스가 없으면 '가깝게'라고 부르지 않고 다음으로 좋은 다른 코스
            diverse(courses, picked.map { it.first }) { true }?.let { picked += it to "2순위 · 하루 코스" }
        }

        val maxPop = courses.flatMap { it.stops }.maxOfOrNull { it.popular } ?: 0
        val popular = if (maxPop >= POPULAR_MIN) {
            diverse(courses, picked.map { it.first }) { c -> c.stops.any { it.popular == maxPop } }?.let { it to "요즘 많이 가요" }
        } else {
            null
        }
        val indoorAlt = if (popular == null && (rain != null || sky?.airBad == true) && best.stops.any { !it.indoor }) {
            diverse(courses, picked.map { it.first }) { c -> c.stops.all { it.indoor } }?.let { it to "실내 대안" }
        } else {
            null
        }
        // 짧게: 낮잠 전(낮잠 없으면 13시 전)에 집에 오는 코스 중 최고, 없으면 가장 일찍 오는 코스.
        // 어른끼리 '가볍게'는 한 곳짜리만 (폰 '가볍게 한 곳만'과 같은 뜻) — 한 곳짜리가 없으면 '일찍 귀가'로 부른다
        val kids = profile.companion.kids
        val light = { c: Scored -> kids || c.stops.size == 1 }
        val shortBy = if (profile.hasNap) profile.napStartMin else LUNCH_MIN
        val short = diverse(courses, picked.map { it.first }) { it.built.arriveHome <= shortBy && light(it) }
            ?.let { it to (if (!kids) "가볍게 · 반나절" else if (profile.hasNap) "짧게 · 낮잠은 집에서" else "짧게 · 점심 전 귀가") }
        val early = courses.sortedWith(EARLY_ORDER)
        val third = popular ?: indoorAlt ?: short
            ?: diverse(early, picked.map { it.first }, light)?.let { it to (if (kids) "짧게 · 일찍 귀가" else "가볍게 · 일찍 귀가") }
            ?: diverse(early, picked.map { it.first }) { true }?.let { it to "일찍 귀가" }
        third?.let { picked += it }

        val options = picked.map { (c, label) ->
            val m = mealize(c.stops, c.built, ctx)
            PlanOption(
                OptionKind.COURSE, m.stops, m.built.firstLeg, null, m.built.arriveHome, m.built.legs,
                withMeal(courseReasons(Scored(c.stops, m.built, c.score), ctx), m), label, meal = m.meal, mealHint = m.hint,
            )
        }
        return Plan(PlanMode.MORNING, nowMin, max(0, budget), limit, options, sky)
    }

    /**
     * 이미 정한 순서(폰에서 고른 코스·시연 코스)의 시간표와 이유 칩. 규칙에 안 맞으면(문 닫음·시간 넘김 등) null.
     * 낮잠 맞추려고 더 머무는 시간표가 되면 그쪽을 쓴다.
     */
    fun course(
        nowMin: Int, here: LatLng, profile: FamilyProfile, stops: List<Place>, sky: SkyToday?, label: String = "고른 코스",
        mode: PlanMode = PlanMode.MORNING,
        /** 귀가 한계를 넘어도 시간표는 돌려준다 (넘는지는 부르는 쪽이 본다 — 미리 보기·앵커 코스). */
        lenient: Boolean = false,
        /** 앵커 코스: 이 장소는 긴 이동·긴 문 열기 기다림·비를 봐준다. */
        anchorId: String? = null,
    ): PlanOption? {
        if (stops.isEmpty()) return null
        val limit = limitMin(mode, profile, sky)
        val safe = limit - TimeBudget.SAFETY_MIN
        val rain = rainStartMin(sky, nowMin)
        val opts = anchorId?.let { id -> stops.firstOrNull { it.id == id } }?.let { anchorOpts(it, here, profile) } ?: WalkOpts()
        // 앵커 코스는 낮잠에 맞춰 머무름을 늘리지 않는다 (앵커 머무름은 사람이 정한 값 — [anchored]와 같은 시간표)
        val built = (if (opts.freeId != null) listOf(false) else listOf(false, true)).mapNotNull { stretch ->
            walk(nowMin, here, stops, profile, rain, rainHard = true, stretchNap = stretch, opts = opts)?.let { finish(it, profile, opts) }
        }
        val fit = built.filter { it.arriveHome <= safe }
        val best = (if (fit.isNotEmpty() || !lenient) fit else built)
            .map { Scored(stops, it, courseScore(stops, it, safe, sky, profile)) }
            .sortedWith(ORDER).firstOrNull() ?: return null
        val ctx = Ctx(nowMin, here, profile, sky, rain, limit)
        val m = mealize(stops, best.built, ctx)
        val b = m.built
        return PlanOption(OptionKind.COURSE, m.stops, b.firstLeg, null, b.arriveHome, b.legs,
            withMeal(courseReasons(Scored(stops, b, best.score), ctx), m), label, overLimit = b.arriveHome > safe, meal = m.meal, mealHint = m.hint)
    }

    /** 가까운 코스: 모든 장소가 집 또는 출발지에서 30분 안 + 어느 이동(집으로 가는 것까지)도 30분 이하. */
    private fun isNear(c: Scored, ctx: Ctx): Boolean =
        c.built.legs.all { it.isStay || it.minutes <= NEAR_MAX_MIN } &&
            c.stops.all { p ->
                min(TravelTime.minutes(ctx.profile.home, p.at), TravelTime.minutes(ctx.here, p.at)) <= NEAR_MAX_MIN
            }

    private fun courseScore(stops: List<Place>, b: Built, safe: Int, sky: SkyToday?, profile: FamilyProfile): Double {
        val air = sky?.air
        val hist = profile.history
        var s = 0.0
        for (p in stops) {
            s += fitScore(p, b.legs.firstOrNull { it.kind == LegKind.STAY && it.placeId == p.id }, profile, sky)
            if (p.stampable) s += 1.0
            if (p.popular >= POPULAR_MIN) s += 0.5
            p.festival?.let { s += it.weight }
            s += airScore(p, air)
            s += historyScore(p, hist)
        }
        s -= (b.awakeDriveMin + b.waitMin) / 60.0
        b.napLeg?.let { s += b.napScore }
        val slack = safe - b.arriveHome
        if (slack < LATE_SLACK_MIN) s -= (LATE_SLACK_MIN - slack).toDouble() / LATE_SLACK_MIN
        return s
    }

    /**
     * 앞에서 고른 카드와 다른 코스 중 [ok]를 만족하는 첫 코스.
     * 1단계: 장소가 하나도 안 겹침 → 2단계: 첫 장소가 다르고 장소 묶음도 다름 → 3단계: 순서까지 같은 것만 아니면.
     */
    private fun diverse(pool: List<Scored>, picked: List<Scored>, ok: (Scored) -> Boolean): Scored? {
        val ids = picked.map { c -> c.stops.map { it.id } }
        val tiers = listOf<(List<String>) -> Boolean>(
            { s -> ids.all { p -> s.none { it in p } } },
            { s -> ids.all { p -> s.first() != p.firstOrNull() && s.toSet() != p.toSet() } },
            { s -> ids.all { p -> s != p } },
        )
        for (tier in tiers) pool.firstOrNull { c -> ok(c) && tier(c.stops.map { it.id }) }?.let { return it }
        return null
    }

    // ------------------------------------------------------------------ 한 곳 들르기 (오후·재탑승)

    /**
     * 오후 짧은 나들이 (14시 이후 첫 탑승): 재탑승과 같은 틀, 귀가 한계 = min(귀가 규칙, 저녁 시각).
     * 3장: 귀갓길(우회 ≤ 15분) 최고 · 그 밖의 근처 최고 (둘은 점수순) + 바로 집으로.
     * 낮잠은 출발 시각이 낮잠 창(시작 20분 전~10분 뒤)을 지나면 저절로 빠진다.
     */
    fun afternoon(nowMin: Int, here: LatLng, profile: FamilyProfile, all: List<Place>, sky: SkyToday?, day: String? = null): Plan {
        val candidates = forDay(all, day)
        val r = rankSingles(PlanMode.AFTERNOON, nowMin, here, profile, candidates, sky)
        val homeward = r.ranked.firstOrNull { it.detour <= HOMEWARD_DETOUR_MAX_MIN }
        // 해 지기 전: 노을 명소에서 해 지는 때를 보는 곳이 있으면 그 카드는 '노을 전망' (귀갓길이 아니면 '근처' 자리에)
        val sunsetPick = r.ranked.firstOrNull { sunsetCover(it.p, it.built.legs, sky) }
        val nearby = sunsetPick?.takeIf { it !== homeward } ?: r.ranked.firstOrNull { it !== homeward }
        val picks = r.ranked.filter { it === homeward || it === nearby }
        val options = picks.map { c ->
            single(c, r.ctx, if (c === sunsetPick) LABEL_SUNSET else if (c === homeward) "집 가는 길에 잠깐" else "근처에서 놀다 가요")
        }
        // 늦은 오후에 낮 카드가 하나도 없으면 저녁 카드를 붙인다 (저녁 귀가 한계 기준)
        val ev = if (r.ranked.isEmpty() && nowMin >= darkMin(sky) - EVENING_APPEND_FROM_MIN && nowMin <= eveningEndMin(profile)) {
            evening(nowMin, here, profile, all, sky, day).takeIf { it.evening }
        } else null
        if (ev != null) return ev
        return Plan(PlanMode.AFTERNOON, nowMin, max(0, r.budget), r.limit, options + goHome(r.toHome, r.ctx, candidates.isEmpty(), r.ranked.isEmpty()), sky)
    }

    /** 노을 명소에서 해 지는 때를 본다: 해 지기 10분 전까지 도착하고 해 진 뒤까지 머묾. */
    private fun sunsetCover(p: Place, legs: List<Leg>, sky: SkyToday?): Boolean {
        val sunset = sky?.sunsetMin ?: return false
        if (!p.sunsetBest) return false
        val stay = legs.firstOrNull { it.kind == LegKind.STAY && it.placeId == p.id } ?: return false
        return stay.fromMin <= sunset - 10 && stay.toMin >= sunset
    }

    /**
     * 재탑승: 귀가 한계 안에 들어오는 후보를 점수로 줄 세워 상위 2개 + '바로 집으로'.
     * 점수 = 아이 적합×2 − 우회/30 + (낮잠 이동이면 낮잠 맞춤, 아니면 − 첫 이동/60) ± 비(3시간 안) 실내 2 + 미세먼지([airScore]) + 축제 가중치
     */
    fun reboard(nowMin: Int, here: LatLng, profile: FamilyProfile, all: List<Place>, sky: SkyToday?, day: String? = null): Plan {
        val candidates = forDay(all, day)
        val r = rankSingles(PlanMode.REBOARD, nowMin, here, profile, candidates, sky)
        val options = r.ranked.take(2).map { c ->
            single(c, r.ctx, if (c.detour <= HOMEWARD_DETOUR_MAX_MIN) "집 가는 길에 잠깐" else "한 곳 더")
        } + goHome(r.toHome, r.ctx, candidates.isEmpty(), r.ranked.isEmpty())
        return Plan(PlanMode.REBOARD, nowMin, max(0, r.budget), r.limit, options, sky)
    }

    private class Singles(val ranked: List<Cand>, val ctx: Ctx, val toHome: Int, val budget: Int, val limit: Int)

    private class Cand(val p: Place, val built: Built, val detour: Int, val score: Double, val wet: Boolean)

    private fun rankSingles(
        mode: PlanMode, nowMin: Int, here: LatLng, profile: FamilyProfile, candidates: List<Place>, sky: SkyToday?,
    ): Singles {
        val limit = limitMin(mode, profile, sky)
        val toHome = TravelTime.minutes(here, profile.home)
        val budget = TimeBudget.availableMin(nowMin, limit, toHome)
        val safe = limit - TimeBudget.SAFETY_MIN
        val rain = rainStartMin(sky, nowMin)
        val wet = rain != null && rain < nowMin + RAIN_SOON_MIN

        val ranked = candidates.mapNotNull { p ->
            val toC = TravelTime.minutes(here, p.at)
            val cToH = TravelTime.minutes(p.at, profile.home)
            val detour = TimeBudget.detourMin(toC, cToH, toHome)
            if (!TimeBudget.fits(detour, profile.dwellFor(p), budget)) return@mapNotNull null
            val b = walk(nowMin, here, listOf(p), profile, rain, rainHard = false, stretchNap = false)
                ?.let { finish(it, profile) } ?: return@mapNotNull null
            if (b.arriveHome > safe) return@mapNotNull null // 문 열 때까지 기다리느라 늦어지는 경우
            var score = fitScore(p, b.legs.firstOrNull { it.kind == LegKind.STAY }, profile, sky) - detour / 30.0
            // 가는 길이 낮잠 이동이면 이동 시간 감점 없음 (집으로 가는 길의 낮잠은 점수에 안 넣음)
            score += if (b.legs.first().kind == LegKind.NAP_DRIVE) b.napScore else -toC / 60.0
            if (wet) score += if (p.indoor) 2.0 else -2.0
            score += airScore(p, sky?.air)
            p.festival?.let { score += it.weight }
            score += historyScore(p, profile.history)
            Cand(p, b, detour, score, wet)
        }.sortedWith(compareByDescending<Cand> { it.score }.thenBy { it.built.arriveHome }.thenBy { it.p.id })

        return Singles(ranked, Ctx(nowMin, here, profile, sky, rain, limit), toHome, budget, limit)
    }

    private fun single(c: Cand, ctx: Ctx, label: String): PlanOption {
        val m = mealize(listOf(c.p), c.built, ctx)
        val b = m.built
        val reasons = buildList {
            c.p.festival?.let { add(festivalReason(it)) }
            if (sunsetCover(c.p, b.legs, ctx.sky)) add(Reason("노을 ${ctx.sky!!.sunsetMin!!.asHhmm()}", Tone.SUN))
            if (c.p.indoor) airReason(ctx.sky)?.let(::add)
            b.napLeg?.let { add(Reason("낮잠 맞춤 · 차에서 ${it.minutes}분", Tone.NAP)) }
            nightReason(listOf(c.p), b.legs, ctx)?.let(::add)
            if (c.wet && c.p.indoor) add(Reason(rainText(ctx), Tone.RAIN))
            sunReason(b.arriveHome, ctx)?.let(::add)
            if (c.p.popular >= POPULAR_MIN) add(Reason("요즘 많이 감 · ${c.p.popular}팀"))
            add(Reason("우회 +${c.detour}분"))
            if (newStamp(c.p, ctx.profile.history)) add(Reason("도장 +1", Tone.STAMP))
            ctx.profile.dwellChip?.let { add(Reason(it)) }
        }
        val kind = if (c.detour <= HOMEWARD_DETOUR_MAX_MIN) OptionKind.HOMEWARD else OptionKind.NEARBY
        return PlanOption(kind, m.stops, b.firstLeg, c.detour, b.arriveHome, b.legs, withMeal(reasons, m), label, meal = m.meal, mealHint = m.hint)
    }

    // ------------------------------------------------------------------ 앵커 코스 ('○○ 중심으로 코스 짜기')

    /**
     * 한 곳(앵커: 우리 명소·축제·바깥 관광지)을 먼저 고르면 그 곳을 꼭 넣고 앞뒤로 0~2곳을 붙여 최대 3장:
     *  ① '가는 길에 한 곳 더' — 앵커 앞이나 뒤에 한 곳, 앵커만 갈 때보다 더 운전하는 시간 [ANCHOR_ON_WAY_MAX_MIN]분 안
     *  ② '근처 한 곳 더'(두 곳이면 '근처 두 곳 더') — 앵커에서 차로 [ANCHOR_NEAR_MAX_MIN]분 안의 곳, ①과 다른 곳
     *  ③ '여기만 · 여유 있게' — 앵커만. 이것도 귀가 한계를 넘으면 버리지 않고 [PlanOption.overLimit] 카드 하나만
     *    (폰이 '오늘만 귀가 한계 늦추기'를 묻는다). 문 닫는 시각 때문에 아예 못 가면 [AnchorPlan.closed] + 카드 없음.
     * 앵커 머무름 = [anchorDwellMin](사용자가 정함) → 없으면 축제 [ANCHOR_FESTIVAL_DWELL_MIN]분 → 우리 가족 머무름.
     * 앵커는 긴 이동(앵커까지·집까지)·문 열기 기다림(최대 2시간)·비를 봐준다. 붙이는 곳은 지금 규칙 그대로(낮잠·비·미세먼지·문 시각).
     * 낮잠에 맞춰 머무름을 늘리지는 않는다(앵커 머무름은 사용자가 정한 값). 편도 3시간이 넘으면 [AnchorPlan.overnight].
     * 점수·동점 처리·이유 칩은 하루 코스와 같다 (+ 넘으면 첫 칩 '귀가 한계를 넘어요 · 집 HH:MM 도착').
     */
    fun anchored(
        nowMin: Int, here: LatLng, profile: FamilyProfile, all: List<Place>, anchorPlace: Place, anchorDwellMin: Int?,
        sky: SkyToday?, day: String? = null,
    ): AnchorPlan {
        // 앵커도 그날 운영 시각으로 (운영 시간 줄이 있을 때)
        val anchor = anchorPlace.onDay(day)
        val mode = if (nowMin < AFTERNOON_FROM_MIN) PlanMode.MORNING else PlanMode.AFTERNOON
        val dwell = DwellLearning.clampUser(anchorDwellMin ?: if (anchor.festival != null) ANCHOR_FESTIVAL_DWELL_MIN else profile.dwellFor(anchor))
        val prof = profile.copy(dwellSet = profile.dwellSet + (anchor.id to dwell))
        val limit = limitMin(mode, prof, sky)
        val toHome = TravelTime.minutes(here, prof.home)
        val budget = TimeBudget.availableMin(nowMin, limit, toHome)
        val safe = limit - TimeBudget.SAFETY_MIN
        val rain = rainStartMin(sky, nowMin)
        val oneWay = max(TravelTime.minutes(here, anchor.at), TravelTime.minutes(anchor.at, prof.home))
        val opts = anchorOpts(anchor, here, prof)
        val ctx = Ctx(nowMin, here, prof, sky, rain, limit)
        // 붙일 곳: 그날 후보에서 앵커·앵커에 붙은 명소·앵커에 붙은 축제를 뺀다
        val extras = forDay(all, day).filter { p ->
            p.id != anchor.id && p.id != anchor.festival?.placeId && p.festival?.placeId != anchor.id
        }

        fun build(seq: List<Place>, strict: Boolean): Scored? {
            val b = walk(nowMin, here, seq, prof, rain, rainHard = true, stretchNap = false, opts = opts)?.let { finish(it, prof, opts) } ?: return null
            if (strict && b.arriveHome > safe) return null
            return Scored(seq, b, courseScore(seq, b, safe, sky, prof))
        }
        fun driveMin(c: Scored) = c.built.legs.filter { it.kind != LegKind.STAY }.sumOf { it.minutes }
        fun extrasOf(c: Scored) = c.stops.filter { it.id != anchor.id }.map { it.id }.toSet()

        // 앵커가 그날 쉬면(쉬는 요일·임시 휴무) 카드 없이 closed
        val alone = (if (anchor.closedOn(day)) null else build(listOf(anchor), strict = false))
            ?: return AnchorPlan(Plan(mode, nowMin, max(0, budget), limit, emptyList(), sky), anchor.id, dwell, oneWay, oneWay > OVERNIGHT_MIN, closed = true)
        val aloneOver = alone.built.arriveHome > safe

        val picked = mutableListOf<Pair<Scored, String>>()
        if (!aloneOver) {
            val base = driveMin(alone)
            val onWay = extras.flatMap { x -> listOf(listOf(x, anchor), listOf(anchor, x)) }
                .mapNotNull { build(it, strict = true) }
                .filter { driveMin(it) - base <= ANCHOR_ON_WAY_MAX_MIN }
                .sortedWith(ORDER).firstOrNull()
            onWay?.let { picked += it to "가는 길에 한 곳 더" }
            val near = extras.filter { TravelTime.minutes(anchor.at, it.at) <= ANCHOR_NEAR_MAX_MIN }
            val nearSeqs = buildList {
                for (x in near) { add(listOf(x, anchor)); add(listOf(anchor, x)) }
                for (x in near) for (y in near) if (x.id != y.id) {
                    add(listOf(x, y, anchor)); add(listOf(x, anchor, y)); add(listOf(anchor, x, y))
                }
            }.mapNotNull { build(it, strict = true) }.sortedWith(ORDER)
            val taken = onWay?.let(::extrasOf).orEmpty()
            val nearPick = nearSeqs.firstOrNull { c -> extrasOf(c).none { it in taken } }
                ?: nearSeqs.firstOrNull { c -> extrasOf(c) != taken }
            nearPick?.let { picked += it to (if (extrasOf(it).size >= 2) "근처 두 곳 더" else "근처 한 곳 더") }
        }
        picked += alone to "여기만 · 여유 있게"

        val options = picked.map { (c, label) ->
            val m = mealize(c.stops, c.built, ctx)
            val b = m.built
            val over = b.arriveHome > safe
            val reasons = withMeal(courseReasons(Scored(c.stops, b, c.score), ctx), m).let { r ->
                if (over) listOf(Reason("귀가 한계를 넘어요 · 집 ${b.arriveHome.asHhmm()} 도착")) + r else r
            }
            PlanOption(OptionKind.COURSE, m.stops, b.firstLeg, null, b.arriveHome, b.legs, reasons, label, overLimit = over, meal = m.meal, mealHint = m.hint)
        }
        return AnchorPlan(Plan(mode, nowMin, max(0, budget), limit, options, sky), anchor.id, dwell, oneWay, oneWay > OVERNIGHT_MIN, closed = false)
    }

    // ------------------------------------------------------------------ 저녁 나들이

    /** 저녁 카드 제목 머리. 폰·차는 pick(evening·drive)으로 고른다. */
    const val EVENING_PREFIX = "저녁 · "
    const val LABEL_DRIVE = "저녁 · 야경 드라이브"
    const val LABEL_SUNSET = "노을 전망"

    /** 저녁 어울림: fit.evening[동행] → 없으면 낮 어울림 × (밤 명소·드라이브 1.0 / 그 밖 0.6). */
    fun eveningFit(p: Place, c: GoWith): Double =
        p.fitEvening[c] ?: (p.fitFor(c) * (if (p.nightBest || p.isDrive) 1.0 else EVENING_FIT_GUESS))

    /** 저녁 후보: 밤·노을 명소 또는 저녁 어울림이 적힌 곳(늦게 여는 실내 등). 드라이브 길은 어른끼리만. */
    fun eveningCandidate(p: Place, c: GoWith): Boolean =
        if (p.isDrive) !c.kids else p.nightBest || p.sunsetBest || c in p.fitEvening

    /** 쌀쌀함: 기온을 알고 [COLD_C]℃ 이하. */
    fun isCold(sky: SkyToday?): Boolean = sky?.tempC?.let { it <= COLD_C } == true

    /** '7시' · '7시 반' · '7시 15분' (12시간, 오전·오후 없이). */
    fun hourText(min: Int): String {
        val m = Math.floorMod(min, 24 * 60)
        val h = (m / 60).let { if (it % 12 == 0) 12 else it % 12 }
        return when (val mm = m % 60) {
            0 -> "${h}시"
            30 -> "${h}시 반"
            else -> "${h}시 ${mm}분"
        }
    }

    /** 저녁 한 곳에서 머무는 분: 드라이브 = 지나가는 시간 · 그 밖 = 우리 가족 머무름을 30~60(아이)·90(어른)분으로, 쌀쌀하면 야외 40분까지. */
    fun eveningDwell(p: Place, profile: FamilyProfile, cold: Boolean): Int {
        p.route?.takeIf { p.isDrive }?.let { return it.passMin }
        val cap = if (profile.companion.kids) EVENING_KIDS_DWELL_MAX else EVENING_ADULT_DWELL_MAX
        val d = profile.dwellFor(p).coerceIn(EVENING_DWELL_MIN, cap)
        return if (cold && !p.indoor) min(d, EVENING_COLD_OUTDOOR_MAX) else d
    }

    /** 도착 시각 맞추기: 그곳을 즐기기 시작할 시각과 칩. [kind] = SHOW · SUNSET · LIGHT · NONE. */
    private class Ready(val min: Int, val kind: String, val reason: Reason?)

    /**
     * [arrive]에 도착하면 언제부터 즐기나 (null = 너무 일러 못 맞춤 → 그곳 뺌):
     *  ① 그날 쇼 중 (쇼 − 10분)이 도착 뒤이고 40분 안인 가장 이른 것 → '7시 음악분수 보러'
     *  ② 노을 명소 + 해 지기 10분 전보다 일찍 도착 → 해 지기 20분 전부터 ('노을 17:41')
     *  ③ 밤 명소 + 조명 켜지기(없으면 해 지는 시각) 전 도착 → 켜질 때부터 ('조명 켜질 때 도착'), 40분 넘게 남으면 null
     *  ④ 그 밖 = 도착하자마자
     */
    private fun eveningReady(p: Place, arrive: Int, sky: SkyToday?, day: String?): Ready? {
        val sunset = sky?.sunsetMin
        var show: Pair<Int, String>? = null
        for (sh in p.moments?.shows.orEmpty()) {
            if (!sh.runsOn(day)) continue
            for (t in sh.times.sorted()) {
                val at = t - SHOW_BEFORE_MIN
                if (at >= arrive && at - arrive <= EVENING_WAIT_MAX_MIN && (show == null || t < show.first)) show = t to sh.name
            }
        }
        if (show != null) return Ready(show.first - SHOW_BEFORE_MIN, "SHOW", Reason("${hourText(show.first)} ${show.second} 보러", Tone.SUN))
        if (p.sunsetBest && sunset != null && arrive <= sunset - 10) {
            val at = max(arrive, sunset - SUNSET_BEFORE_MIN)
            if (at - arrive > EVENING_WAIT_MAX_MIN) return null
            return Ready(at, "SUNSET", Reason("노을 ${sunset.asHhmm()}", Tone.SUN))
        }
        if (p.nightBest && !p.isDrive) {
            val on = p.moments?.lightOnMin(sunset) ?: darkMin(sky)
            if (arrive < on) {
                if (on - arrive > EVENING_WAIT_MAX_MIN) return null
                return Ready(on, "LIGHT", Reason("조명 켜질 때 도착", Tone.SUN))
            }
        }
        return Ready(arrive, "NONE", null)
    }

    /** 저녁 시간표 한 장 (집 도착까지). [ready] = 장소마다 맞춘 시각. */
    private class EvBuilt(val built: Built, val ready: List<Ready>, val driveMin: Int, val openWait: Int)

    private fun eveningWalk(
        nowMin: Int, here: LatLng, seq: List<Place>, profile: FamilyProfile, sky: SkyToday?, day: String?, rain: Int?, cold: Boolean,
    ): EvBuilt? {
        val kids = profile.companion.kids
        val cap = if (kids) EVENING_KIDS_DRIVE_MAX else EVENING_ADULT_DRIVE_MAX
        val legs = mutableListOf<Leg>()
        val ready = mutableListOf<Ready>()
        var t = nowMin
        var at = here
        var first: Int? = null
        var drive = 0
        var wait = 0
        var openWait = 0
        for (p in seq) {
            val len = TravelTime.minutes(at, p.at)
            if (len > cap) return null
            legs += Leg(LegKind.DRIVE, t, t + len, p.id)
            if (first == null) first = len
            drive += len
            t += len
            val r = eveningReady(p, t, sky, day) ?: return null
            val start = max(max(t, p.openMin), r.min)
            if (start - t > EVENING_WAIT_MAX_MIN) return null
            val dwell = eveningDwell(p, profile, cold)
            if (start + min(dwell, MIN_VISIT_MIN) > p.closeMin) return null
            if (p.lastEntryMin != null && start > p.lastEntryMin) return null
            val end = min(start + dwell, p.closeMin)
            if (!p.indoor && !p.isDrive && rain != null && end > rain) return null
            legs += Leg(if (p.isMeal) LegKind.MEAL else LegKind.STAY, t, end, p.id)
            ready += r
            wait += start - t
            // 쇼·조명·노을을 기다리는 건 둘러보는 시간 — 점수 감점은 문 열기 기다림만
            openWait += max(t, p.openMin) - t
            t = end
            at = if (p.isDrive) p.route!!.points.last() else p.at
        }
        val home = TravelTime.minutes(at, profile.home)
        if (home > max(cap, TravelTime.minutes(here, profile.home))) return null
        legs += Leg(LegKind.HOME, t, t + home, null)
        drive += home
        return EvBuilt(Built(legs, first ?: home, t + home, drive, null, 0.0, wait), ready, drive, openWait)
    }

    /** 저녁 카드 종류: drive · indoor(모두 실내) · sunset(노을에 맞춤) · night. */
    private fun eveningType(c: Scored, ready: List<Ready>): String = when {
        c.stops.any { it.isDrive } -> "drive"
        c.stops.all { it.indoor } -> "indoor"
        ready.firstOrNull()?.kind == "SUNSET" -> "sunset"
        else -> "night"
    }

    private fun eveningLabel(type: String, comp: GoWith): String = when (type) {
        "drive" -> LABEL_DRIVE
        "indoor" -> if (comp.kids) "${EVENING_PREFIX}따뜻한 실내" else "${EVENING_PREFIX}늦게 여는 실내"
        "sunset" -> "${EVENING_PREFIX}노을 전망"
        else -> EVENING_PREFIX + when (comp) {
            GoWith.KIDS -> "야경 산책"
            GoWith.COUPLE -> "야경 데이트"
            GoWith.FRIENDS -> "야경 명소"
            GoWith.SOLO -> "야경 산책"
        }
    }

    /**
     * 저녁 나들이 (해 진 뒤 ~ 귀가 한계 90분 전, 또는 늦은 오후에 낮 카드가 없을 때): 저녁 후보([eveningCandidate])에서
     * 코스를 모두 따져(시간표 [eveningWalk] — 아이와 한 곳, 어른끼리 1~2곳) 서로 다른 종류로 최대 3장 + 바로 집으로.
     * 귀가 한계 = 아이와 잠자는 시간 · 어른끼리 늦어도 몇 시 귀가 (안전 10분), 전체 2시간(아이)·3시간(어른) 안.
     * 비: 야외는 비 전에 끝날 때만(드라이브·실내는 괜찮음). 쌀쌀함: 야외 짧게 + 실내·드라이브 가점.
     * 점수 = Σ(저녁 어울림×2 + 새 도장 0.5 + 미세먼지 + 방문 기록 + 동행 분위기 0.5 + 쇼·노을 맞춤 0.5 + 쌀쌀하면 실내 ±0.5
     *          + 어른 드라이브 0.5(친구끼리 빼고) + 아이와 실내 0.25) − (운전 + 문 열기 기다림)/60 − 두 곳이면 0.5 − 귀가 여유 30분 미만 감점.
     * 카드: 1순위 → 종류가 다른 것(장소 안 겹침 우선) → 어른끼리는 드라이브가 아직 없으면 드라이브, 아니면 또 다른 종류.
     * 해가 이미 졌으면 노을 명소 하나를 [Plan.sunsetTip]('내일 노을 보러')으로.
     */
    fun evening(nowMin: Int, here: LatLng, profile: FamilyProfile, all: List<Place>, sky: SkyToday?, day: String? = null): Plan {
        val comp = profile.companion
        val dayList = forDay(all, day)
        val candidates = dayList.filter { eveningCandidate(it, comp) }
        val limit = profile.eveningLimitMin
        val toHome = TravelTime.minutes(here, profile.home)
        val budget = TimeBudget.availableMin(nowMin, limit, toHome)
        val safe = limit - TimeBudget.SAFETY_MIN
        val rain = rainStartMin(sky, nowMin)
        val cold = isCold(sky)
        val outing = if (comp.kids) EVENING_KIDS_OUTING_MAX_MIN else EVENING_ADULT_OUTING_MAX_MIN
        val ctx = Ctx(nowMin, here, profile, sky, rain, limit)

        val ready = HashMap<String, List<Ready>>()
        val courses = mutableListOf<Scored>()
        fun tryCourse(seq: List<Place>) {
            val ev = eveningWalk(nowMin, here, seq, profile, sky, day, rain, cold) ?: return
            if (ev.built.arriveHome > safe || ev.built.arriveHome - nowMin > outing) return
            val sc = Scored(seq, ev.built, eveningScore(seq, ev, safe, sky, profile, cold))
            ready[sc.key] = ev.ready
            courses += sc
        }
        for (p in candidates) tryCourse(listOf(p))
        // 두 곳 코스는 어른끼리만 (아이와는 짧게 한 곳)
        if (!comp.kids) for (p in candidates) for (q in candidates) if (p.id != q.id && !(p.isDrive && q.isDrive)) tryCourse(listOf(p, q))
        courses.sortWith(ORDER)

        val tip = sky?.sunsetMin?.takeIf { nowMin >= it }?.let { sunset ->
            dayList.filter { it.sunsetBest && !it.isDrive }
                .sortedWith(compareByDescending<Place> { eveningFit(it, comp) }.thenBy { TravelTime.minutes(profile.home, it.at) }.thenBy { it.id })
                .firstOrNull()?.let { SunsetTip(it.id, it.name, sunset, sunset - SUNSET_BEFORE_MIN) }
        }
        val home = goHome(toHome, ctx, dayList.isEmpty(), courses.isEmpty())
        if (courses.isEmpty()) {
            return Plan(PlanMode.AFTERNOON, nowMin, max(0, budget), limit, listOf(home), sky, evening = false, sunsetTip = tip)
        }
        val types = { c: Scored -> eveningType(c, ready.getValue(c.key)) }
        val picked = mutableListOf<Scored>()
        picked += courses.first()
        fun pickedTypes() = picked.map(types).toSet()
        (diverse(courses, picked) { types(it) !in pickedTypes() } ?: diverse(courses, picked) { true })?.let { picked += it }
        if (!comp.kids && "drive" !in pickedTypes()) {
            diverse(courses, picked) { types(it) == "drive" }?.let { picked += it }
        }
        if (picked.size < 3) diverse(courses, picked) { types(it) !in pickedTypes() }?.let { picked += it }

        val options = picked.map { c ->
            // 저녁 카드는 쇼·조명·노을 시각에 맞춰 둔 시간표라 밥은 마지막 곳 뒤(집 가는 길)에만
            val m = mealize(c.stops, c.built, ctx, lastOnly = true)
            PlanOption(OptionKind.COURSE, m.stops, m.built.firstLeg, null, m.built.arriveHome, m.built.legs,
                withMeal(eveningReasons(Scored(c.stops, m.built, c.score), ready.getValue(c.key), ctx, cold), m), eveningLabel(types(c), comp),
                meal = m.meal, mealHint = m.hint)
        } + home
        return Plan(PlanMode.AFTERNOON, nowMin, max(0, budget), limit, options, sky, evening = true, sunsetTip = tip)
    }

    private fun eveningScore(stops: List<Place>, ev: EvBuilt, safe: Int, sky: SkyToday?, profile: FamilyProfile, cold: Boolean): Double {
        val c = profile.companion
        var s = 0.0
        stops.forEachIndexed { i, p ->
            s += 2.0 * eveningFit(p, c)
            if (newStamp(p, profile.history)) s += 0.5
            if (!p.isDrive) s += airScore(p, sky?.air)
            s += historyScore(p, profile.history)
            if (COMPANION_TAGS[c].orEmpty().any { it in p.tags }) s += TAG_BONUS
            val k = ev.ready[i].kind
            if (k == "SHOW" || k == "SUNSET") s += 0.5
            if (cold) s += if (p.indoor || p.isDrive) 0.5 else -0.5
            if (p.isDrive && (c == GoWith.COUPLE || c == GoWith.SOLO)) s += 0.5
            if (c.kids && p.indoor) s += 0.25
        }
        s -= (ev.driveMin + ev.openWait) / 60.0
        s -= 0.5 * (stops.size - 1)
        val slack = safe - ev.built.arriveHome
        if (slack < LATE_SLACK_MIN) s -= (LATE_SLACK_MIN - slack).toDouble() / LATE_SLACK_MIN
        return s
    }

    /**
     * 저녁 카드 칩 (앞 3개가 차 화면에 보임): 축제 → 시각 맞춤(쇼·노을·조명) → 드라이브 N분 → 'N시까지 열어요'(모두 실내)
     * → 비·쌀쌀함 → 미세먼지(모두 실내) → 귀가(아이와 '잠자기 전 귀가 · HH:MM' · 어른 'HH:MM 귀가') → 밤 도장 / 도장.
     */
    private fun eveningReasons(c: Scored, ready: List<Ready>, ctx: Ctx, cold: Boolean): List<Reason> = buildList {
        val p = ctx.profile
        c.stops.mapNotNull { it.festival }.minByOrNull { it.ends }?.let { add(festivalReason(it)) }
        ready.firstNotNullOfOrNull { it.reason }?.let(::add)
        c.stops.firstOrNull { it.isDrive }?.let { add(Reason("야경 드라이브 · ${it.route!!.passMin}분", Tone.SUN)) }
        val allIndoor = c.stops.all { it.indoor }
        val close = c.stops.minOf { it.closeMin }
        if (allIndoor && close < 24 * 60) add(Reason("${hourText(close)}까지 열어요"))
        val outdoor = c.stops.any { !it.indoor && !it.isDrive }
        if (ctx.rain != null && !outdoor) add(Reason(if (allIndoor) "비 와도 실내" else "비 와도 차 안에서", Tone.RAIN))
        if (cold) add(Reason(if (outdoor) "쌀쌀해요 · 짧게 둘러봐요" else "쌀쌀한 밤 · 따뜻하게"))
        if (allIndoor) airReason(ctx.sky)?.let(::add)
        val arrive = c.built.arriveHome
        add(Reason(if (p.companion.kids) "잠자기 전 귀가 · ${arrive.asHhmm()}" else "${arrive.asHhmm()} 귀가"))
        val sunset = ctx.sky?.sunsetMin
        val nights = c.stops.count { s ->
            s.stampable && s.nightBest && s.festival == null && sunset != null && ctx.rain == null &&
                c.built.legs.any { it.kind == LegKind.STAY && it.placeId == s.id && it.fromMin >= sunset }
        }
        val stamps = c.stops.count { newStamp(it, p.history) }
        if (nights > 0) add(Reason("밤 도장 +$nights", Tone.STAMP))
        else if (stamps > 0) add(Reason("${c.stops.count { !it.isMeal }}곳 · 도장 $stamps", Tone.STAMP))
    }

    // ------------------------------------------------------------------ '왜?' 설명

    /**
     * 카드의 장소마다 '왜 여기?'를 쉬운 말 몇 줄로 — AI 문장이 아니라 점수에 실제로 들어간 항목을 그대로 말로 바꾼다.
     * 줄 순서: 축제 → 거리(낮잠 이동이면 낮잠) → 아이 → 도장·방문 기록 → 날씨·미세먼지 → 문 열기 기다림 → 머무름 → 요즘 많이 감
     * → (마지막 곳) 집 가는 길 낮잠. 시각은 'HH:MM'(화면이 12시간으로 바꿔 보여 준다).
     * [option]은 이 엔진이 만든 카드(하루 막대 legs가 있어야 함). 장소가 없는 '바로 집으로'는 빈 목록.
     */
    fun explainChoice(option: PlanOption, nowMin: Int, here: LatLng, profile: FamilyProfile, sky: SkyToday?): List<StopWhy> {
        val h = profile.history
        val rain = rainStartMin(sky, nowMin)
        val airBad = sky?.airBad == true
        val age = profile.kidAges.minOrNull() ?: 4
        val comp = profile.companion
        val fromHome = Geo.km(here, profile.home) * 1000 <= AT_HOME_M
        val ev = option.label.startsWith(EVENING_PREFIX)
        // 식사 자리는 설명하지 않는다 (밥 칩이 따로 있음). 집 가는 길 낮잠 줄은 마지막 장소에
        val lastPlace = option.stops.indexOfLast { !it.isMeal }
        return option.stops.mapIndexedNotNull { i, p ->
            if (p.isMeal) return@mapIndexedNotNull null
            val lines = mutableListOf<WhyLine>()
            p.festival?.let { lines += WhyLine("축제 기간이에요 · ${it.endsText}까지", Tone.FESTIVAL) }
            val arrive = option.legs.firstOrNull { it.kind != LegKind.STAY && it.placeId == p.id }
            val stay = option.legs.firstOrNull { it.kind == LegKind.STAY && it.placeId == p.id }
            if (arrive != null) {
                val m = arrive.minutes
                if (arrive.kind == LegKind.NAP_DRIVE) {
                    lines += WhyLine("낮잠 시간에 차에서 ${m}분 재울 수 있어요", Tone.NAP)
                } else {
                    val from = if (i > 0) "${option.stops[i - 1].name}에서" else if (fromHome) "집에서" else "지금 있는 곳에서"
                    val tail = when {
                        m <= NEAR_MAX_MIN -> " · 가까워요"
                        m > AWAKE_DRIVE_MAX_MIN -> " · 멀어요"
                        else -> ""
                    }
                    lines += WhyLine("$from ${m}분$tail")
                }
            }
            lines += if (comp.kids) WhyLine(when {
                p.kidFit >= 0.8 -> "${age}살 아이가 놀기 좋아요"
                p.kidFit >= 0.6 -> "${age}살 아이도 즐길 만해요"
                else -> "${age}살 아이에겐 조금 어려울 수 있어요"
            }) else companionLine(p, comp)
            when {
                !p.stampable -> lines += WhyLine("도장 대신 '다녀옴'으로 남아요")
                h == null -> lines += WhyLine("도장을 찍을 수 있어요 · 도장 +1", Tone.STAMP)
                p.id in h.stamped -> lines += WhyLine("이미 도장을 받은 곳이에요")
                else -> lines += WhyLine("아직 도장이 없어요 · 도장 +1", Tone.STAMP)
            }
            if (h != null) {
                val days = h.lastVisitDays[p.id]
                when {
                    days == null && p.id !in h.stamped -> lines += WhyLine("처음 가 보는 곳이에요")
                    days != null && days == 0 -> lines += WhyLine("오늘 이미 다녀온 곳이에요")
                    days != null && days < RECENT_DAYS -> lines += WhyLine("${days}일 전에 다녀온 곳이에요")
                }
                if (p.id in h.favorites) lines += WhyLine("즐겨찾는 곳이에요")
            }
            if (stay != null) {
                val air = sky?.air
                when {
                    airBad && air != null -> lines += WhyLine(
                        if (p.indoor) "미세먼지 ${air.text} · 실내라 괜찮아요" else "미세먼지 ${air.text} · 마스크 챙기세요", Tone.AIR,
                    )
                    rain != null && rain <= stay.fromMin -> lines += WhyLine(
                        if (p.indoor) "비가 와도 실내라 괜찮아요" else "비 소식이 있어요 · 우산 챙기세요", Tone.RAIN,
                    )
                    rain != null && rain < stay.toMin -> lines += WhyLine(
                        if (p.indoor) "${rain.asHhmm()}부터 비 · 실내라 괜찮아요" else "${rain.asHhmm()}부터 비 · 우산 챙기세요", Tone.RAIN,
                    )
                    rain != null && !p.indoor -> lines += WhyLine("비 오기 전(${rain.asHhmm()})에 나와요", Tone.SUN)
                    rain == null && sky?.sky == Sky.CLEAR && !p.indoor && ((comp.kids && !ev) || stay.toMin <= darkMin(sky)) ->
                        lines += WhyLine("오늘 맑음 · 야외 괜찮아요", Tone.SUN)
                }
                if ((!comp.kids || ev) && stay.toMin > darkMin(sky) && !p.isDrive) {
                    when {
                        TAG_NIGHT in p.tags || p.nightBest -> lines += WhyLine("해 진 뒤 야경이 예뻐요", Tone.SUN)
                        !p.indoor -> lines += WhyLine("해 진 뒤엔 어두워요 · 일찍 둘러보세요", Tone.SUN)
                    }
                }
                val wait = max(0, p.openMin - stay.fromMin)
                if (wait > 0) lines += WhyLine("문 여는 ${p.openMin.asHhmm()}까지 ${wait}분 기다려요")
                val dwell = profile.dwellEstimate(p)
                val extra = stay.minutes - wait - dwell.minutes
                if (ev) {
                    // 저녁 카드: 머무름은 저녁 기준(짧게) — 실제 칸 길이 그대로, 드라이브는 지나가는 시간
                    lines += WhyLine(if (p.isDrive) "차로 ${stay.minutes - wait}분 지나가요 · 내리지 않아도 돼요" else "저녁엔 ${stay.minutes - wait}분쯤 둘러봐요")
                } else {
                    lines += WhyLine("여기서 ${dwell.minutes}분 ${if (comp.kids) "놀아요" else "머물러요"} · ${dwell.sourceText}")
                    if (extra > 0) lines += WhyLine("낮잠 시간에 맞춰 ${extra}분 더 놀아요", Tone.NAP)
                }
            }
            if (p.popular >= POPULAR_MIN) lines += WhyLine("요즘 ${p.popular}${if (comp.kids) "가족이" else "팀이"} 갔어요")
            if (i == lastPlace) {
                val home = option.legs.lastOrNull()
                if (home != null && home.kind == LegKind.NAP_DRIVE && home.placeId == null) {
                    lines += WhyLine("집에 가는 길에 차에서 ${home.minutes}분 재울 수 있어요", Tone.NAP)
                }
            }
            StopWhy(p.id, lines)
        }
    }

    /**
     * 어른끼리 '왜?'의 동행 줄: 적합도 0.8 이상 '연인과 가기 좋아요' · 0.6 이상 '…가 볼 만해요' · 그 밖 '…조금 심심할 수 있어요',
     * 좋은 곳이면 맞는 분위기 표시 하나를 붙인다 ('연인과 가기 좋아요 · 야경').
     */
    private fun companionLine(p: Place, c: GoWith): WhyLine {
        val f = p.fitFor(c)
        val tag = (listOf(TAG_NIGHT).takeIf { c == GoWith.COUPLE }.orEmpty() + COMPANION_TAGS[c].orEmpty()).firstOrNull { it in p.tags }
        val good = when (c) {
            GoWith.COUPLE -> "연인과 가기 좋아요"
            GoWith.FRIENDS -> "친구들과 놀기 좋아요"
            else -> "혼자 조용히 둘러보기 좋아요"
        }
        return WhyLine(when {
            f >= 0.8 -> if (tag != null) "$good · $tag" else good
            f >= 0.6 -> when (c) {
                GoWith.COUPLE -> "둘이 가 볼 만해요"
                GoWith.FRIENDS -> "친구들과 가 볼 만해요"
                else -> "혼자 가 볼 만해요"
            }
            else -> when (c) {
                GoWith.COUPLE -> "둘이 가기엔 조금 심심할 수 있어요"
                GoWith.FRIENDS -> "친구끼리는 조금 심심할 수 있어요"
                else -> "혼자 가기엔 조금 어색할 수 있어요"
            }
        })
    }

    // ------------------------------------------------------------------ 밥 자리 넣기 (docs/장소-데이터-구조-계획.md §4)

    /** 밥 자리를 넣은 결과. 넣지 않았으면 [stops]·[built]가 그대로. */
    private class Mealed(val stops: List<Place>, val built: Built, val meal: MealStop?, val hint: String?)

    /**
     * 코스(고른 순서·시간표는 그대로)에 밥 자리 하나를 넣는다 — 가족 프로필에 [FamilyProfile.meal]이 있을 때만 ([Meals.plan]).
     * 카드 고르기·점수는 밥을 모른 채 끝난 뒤라, 밥을 켜도 고르는 코스는 같고 시간표·칩만 바뀐다.
     * [lastOnly] = 마지막 곳 뒤(집 가는 길)에만 (저녁 카드).
     */
    private fun mealize(stops: List<Place>, b: Built, ctx: Ctx, lastOnly: Boolean = false): Mealed {
        val o = Meals.plan(stops, b.legs, ctx.here, ctx.profile, ctx.limit - TimeBudget.SAFETY_MIN, ctx.rain, lastOnly)
            ?: return Mealed(stops, b, null, null)
        val s = o.spliced ?: return Mealed(stops, b, null, o.hint)
        val nap = s.legs.firstOrNull { it.kind == LegKind.NAP_DRIVE }
        return Mealed(s.stops, Built(s.legs, s.firstLeg, s.arriveHome, b.awakeDriveMin, nap, b.napScore, b.waitMin), s.meal, null)
    }

    /** 밥 칩: 넣었으면 축제 칩 다음(없으면 맨 앞)에 '12:10 점심 · ○○ (아이 의자·주차 무료)', 못 넣었으면 맨 끝에 까닭. */
    private fun withMeal(rs: List<Reason>, m: Mealed): List<Reason> = when {
        m.meal != null -> {
            val i = if (rs.firstOrNull()?.tone == Tone.FESTIVAL) 1 else 0
            rs.take(i) + Reason(m.meal.text, Tone.MEAL) + rs.drop(i)
        }
        m.hint != null -> rs + Reason(m.hint, Tone.MEAL)
        else -> rs
    }

    // ------------------------------------------------------------------ 바로 집으로

    /**
     * '바로 집으로' / '오늘은 쉬어요'. 칩은 늘 1개 이상: 왜 집인지(장소 없음·해 짐·귀가 시각·맞는 곳 없음) +
     * 집 밖이면 도착 시각·해 지기 전, 집 안이면서 이유가 없으면 '낮잠은 집에서' 또는 '집에서 쉬어요'.
     * [noneFit] = 시간에 맞는 추천이 하나도 없음.
     */
    private fun goHome(toHome: Int, ctx: Ctx, noCandidates: Boolean, noneFit: Boolean): PlanOption {
        val atHome = Geo.km(ctx.here, ctx.profile.home) * 1000 <= AT_HOME_M
        val arrive = ctx.now + toHome
        val sunset = ctx.sky?.sunsetMin
        val p = ctx.profile
        val reasons = buildList {
            when {
                noCandidates -> add(Reason("가까운 추천 장소가 없어요"))
                sunset != null && ctx.now >= sunset -> add(Reason("해가 졌어요", Tone.SUN))
                arrive + TimeBudget.SAFETY_MIN >= ctx.limit -> add(Reason("귀가 시각이 다 됐어요"))
                noneFit -> add(Reason("시간 맞는 곳이 없어요"))
            }
            if (!atHome) {
                add(Reason("${arrive.asHhmm()} 도착"))
                sunReason(arrive, ctx)?.let(::add)
            } else if (isEmpty()) {
                if (p.hasNap && ctx.now < p.napStartMin) add(Reason("낮잠은 집에서 · ${p.napStartMin.asHhmm()}", Tone.NAP))
                else add(Reason("집에서 쉬어요"))
            }
        }
        return PlanOption(
            OptionKind.GO_HOME, emptyList(), toHome, null, arrive,
            listOf(Leg(LegKind.HOME, ctx.now, arrive)), reasons,
            if (atHome) "오늘은 쉬어요" else "바로 집으로",
        )
    }

    // ------------------------------------------------------------------ 시간표

    /**
     * 시간표 규칙 늦추기 (앵커 코스만): [awakeMax] = 깨어 있는 한 번 이동 최대(앵커까지·앵커에서 집까지 거리만큼 늘림),
     * [freeId] = 비 오는 야외·긴 문 열기 기다림(최대 [ANCHOR_WAIT_MAX_MIN])을 봐주는 장소(앵커).
     */
    class WalkOpts(val awakeMax: Int = AWAKE_DRIVE_MAX_MIN, val freeId: String? = null)

    /** 앵커 코스의 규칙 늦추기: 앵커까지·앵커에서 집까지 이동만큼 깨어 있는 이동을 허락. */
    private fun anchorOpts(anchor: Place, here: LatLng, profile: FamilyProfile) = WalkOpts(
        max(AWAKE_DRIVE_MAX_MIN, max(TravelTime.minutes(here, anchor.at), TravelTime.minutes(anchor.at, profile.home))), anchor.id,
    )

    /** 장소들을 차례로 돌아본 상태 (집으로 가는 이동 전). */
    private class Walk(
        val legs: List<Leg>, val t: Int, val at: LatLng, val firstLeg: Int?,
        val awake: Int, val napLeg: Leg?, val wait: Int,
    )

    /** 집 도착까지 끝난 시간표. */
    private class Built(
        val legs: List<Leg>, val firstLeg: Int, val arriveHome: Int, val awakeDriveMin: Int,
        val napLeg: Leg?, val napScore: Double, val waitMin: Int,
    )

    private class Scored(val stops: List<Place>, val built: Built, val score: Double) {
        val key: String = stops.joinToString(",") { it.id }
    }

    private val ORDER: Comparator<Scored> =
        compareByDescending<Scored> { it.score }.thenBy { it.built.arriveHome }.thenBy { it.key }
    private val EARLY_ORDER: Comparator<Scored> =
        compareBy<Scored> { it.built.arriveHome }.thenByDescending { it.score }.thenBy { it.key }

    /**
     * 장소를 차례로 도는 시간표. 문 닫기 30분 전 이후 도착 · 문 열기 30분 넘게 기다림 ·
     * (rainHard면) 야외에 머무는 중 비 · 깨어 있는 이동 60분 초과면 null.
     */
    private fun walk(
        nowMin: Int, here: LatLng, stops: List<Place>, profile: FamilyProfile,
        rain: Int?, rainHard: Boolean, stretchNap: Boolean, opts: WalkOpts = WalkOpts(),
    ): Walk? {
        val legs = mutableListOf<Leg>()
        var t = nowMin
        var at = here
        var first: Int? = null
        var awake = 0
        var nap: Leg? = null
        var wait = 0
        for (p in stops) {
            val leg = drive(legs, t, at, p.at, p.id, false, profile, stretchNap, nap, opts) ?: return null
            if (first == null) first = leg.minutes
            if (leg.kind == LegKind.NAP_DRIVE) nap = leg else awake += leg.minutes
            t = leg.toMin
            at = p.at
            val start = max(t, p.openMin)
            val free = p.id == opts.freeId
            if (start - t > (if (free) ANCHOR_WAIT_MAX_MIN else MAX_WAIT_MIN)) return null
            wait += start - t
            val dwell = profile.dwellFor(p)
            if (start + min(dwell, MIN_VISIT_MIN) > p.closeMin) return null
            if (p.lastEntryMin != null && start > p.lastEntryMin) return null
            val end = min(start + dwell, p.closeMin)
            if (rainHard && !free && !p.indoor && rain != null && end > rain) return null
            legs += Leg(if (p.isMeal) LegKind.MEAL else LegKind.STAY, t, end, p.id)
            t = end
        }
        return Walk(legs, t, at, first, awake, nap, wait)
    }

    /** 집으로 가는 마지막 이동을 붙인다. 집 도착을 늦추면서까지 낮잠을 맞추지는 않는다(늘려 머물기 없음). */
    private fun finish(w: Walk, profile: FamilyProfile, opts: WalkOpts = WalkOpts()): Built? {
        val legs = w.legs.toMutableList()
        val leg = drive(legs, w.t, w.at, profile.home, null, true, profile, false, w.napLeg, opts) ?: return null
        val napping = leg.kind == LegKind.NAP_DRIVE
        val napLeg = if (napping) leg else w.napLeg
        val awake = w.awake + if (napping) 0 else leg.minutes
        val nap = napLeg?.let { napScore(it.minutes, profile) } ?: 0.0
        return Built(legs, w.firstLeg ?: leg.minutes, leg.toMin, awake, napLeg, nap, w.wait)
    }

    /**
     * 이동 한 칸을 [legs]에 붙이고 돌려준다. [stretch]면 앞 머무름을 늘려 낮잠 10분 전에 출발하게 맞출 수 있다.
     * 낮잠 이동은 하루 한 번. 깨어 있는 이동이 60분을 넘으면 null.
     */
    private fun drive(
        legs: MutableList<Leg>, from: Int, at: LatLng, to: LatLng, placeId: String?, last: Boolean,
        profile: FamilyProfile, stretch: Boolean, napSoFar: Leg?, opts: WalkOpts = WalkOpts(),
    ): Leg? {
        val len = TravelTime.minutes(at, to)
        var t = from
        if (stretch && napSoFar == null && legs.lastOrNull()?.kind == LegKind.STAY) {
            val depart = profile.napStartMin - NAP_DEPART_BEFORE_MIN
            val windowOpen = profile.napStartMin - 20
            if (t < windowOpen && depart - t <= NAP_STRETCH_MAX_MIN && TimeBudget.napAligned(depart, len, profile)) {
                val stay = legs.removeAt(legs.lastIndex)
                legs += stay.copy(toMin = depart)
                t = depart
            }
        }
        val napping = napSoFar == null && TimeBudget.napAligned(t, len, profile)
        // 어른끼리는 한 번 운전 90분까지 (앵커 코스는 그보다 길어도 봐준 값 그대로)
        val cap = if (profile.companion.kids) opts.awakeMax else max(opts.awakeMax, ADULT_DRIVE_MAX_MIN)
        if (!napping && len > cap) return null
        val kind = when {
            napping -> LegKind.NAP_DRIVE
            last -> LegKind.HOME
            else -> LegKind.DRIVE
        }
        return Leg(kind, t, t + len, placeId).also { legs += it }
    }

    /** 낮잠 길이의 0.9배에 가까운 이동일수록 좋다 (최대 3점). */
    private fun napScore(travelMin: Int, profile: FamilyProfile): Double {
        val len = profile.napLengthMin
        val target = 0.9 * len
        return 3.0 * (1 - abs(travelMin - target) / (0.4 * len)).coerceAtLeast(0.0)
    }

    // ------------------------------------------------------------------ 이유 칩

    private class Ctx(
        val now: Int, val here: LatLng, val profile: FamilyProfile, val sky: SkyToday?, val rain: Int?, val limit: Int,
    )

    /**
     * 하루 코스 칩 (차 화면은 앞 3개만 보이므로 순서 = 중요한 순서). 늘 1개 이상.
     * 축제(이번 주말만) → 미세먼지 나쁨 → 실내(모두 실내일 때) → 낮잠 맞춤 → 낮잠(점심) 전 귀가 → 가까워요 → 날씨 → 해 지기 전 귀가 → 요즘 많이 감 → N곳 · 도장 N
     * → (아무것도 없으면) N곳 · 귀가 시각.
     */
    private fun courseReasons(c: Scored, ctx: Ctx): List<Reason> = buildList {
        val arrive = c.built.arriveHome
        val p = ctx.profile
        // 축제가 둘 이상이면 먼저 끝나는 쪽
        c.stops.mapNotNull { it.festival }.minByOrNull { it.ends }?.let { add(festivalReason(it)) }
        val rain = ctx.rain
        val outdoor = c.stops.any { !it.indoor }
        val allIndoor = !outdoor
        // 미세먼지 나쁨 이상: 모두 실내면 칩을 앞쪽에 (안드로이드 오토 목록은 첫 칩만 보인다), 야외가 있으면 '맑음 → 야외'를 붙이지 않는다
        val airBad = ctx.sky?.airBad == true
        if (allIndoor) airReason(ctx.sky)?.let(::add)
        c.built.napLeg?.let { add(Reason("낮잠 맞춤 · 차에서 ${it.minutes}분", Tone.NAP)) }
        nightReason(c.stops, c.built.legs, ctx)?.let(::add)
        when {
            p.hasNap && arrive <= p.napStartMin -> add(Reason("낮잠 전 귀가 · ${arrive.asHhmm()}", Tone.NAP))
            !p.hasNap && p.companion.kids && arrive <= LUNCH_MIN -> add(Reason("점심 전 귀가 · ${arrive.asHhmm()}"))
        }
        if (isNear(c, ctx)) add(Reason("가까워요 · 첫 이동 ${c.built.firstLeg}분"))
        when {
            rain == null -> if (ctx.sky?.sky == Sky.CLEAR && outdoor && !airBad) add(Reason("맑음 → 야외", Tone.SUN))
            rain <= ctx.now -> if (allIndoor) add(Reason("비 → 실내", Tone.RAIN))
            else -> {
                if (outdoor && rain >= 12 * 60 && !airBad) add(Reason("오전 맑음 → 야외", Tone.SUN))
                val wetStay = c.built.legs.any { s ->
                    s.kind == LegKind.STAY && s.toMin > rain && c.stops.first { it.id == s.placeId }.indoor
                }
                if (wetStay) add(Reason(rainText(ctx), Tone.RAIN))
                else if (allIndoor) add(Reason("비 와도 실내", Tone.RAIN))
            }
        }
        sunReason(arrive, ctx)?.let(::add)
        c.stops.filter { it.popular >= POPULAR_MIN }.maxByOrNull { it.popular }?.let {
            add(Reason("요즘 많이 감 · ${it.popular}팀"))
        }
        val stamps = c.stops.count { newStamp(it, p.history) }
        val places = c.stops.count { !it.isMeal }
        if (stamps > 0) add(Reason("${places}곳 · 도장 $stamps", Tone.STAMP))
        if (isEmpty()) add(Reason("${places}곳 · ${arrive.asHhmm()} 귀가"))
        // 우리 가족 머무름 배율 (2번 넘게 배웠을 때만)
        p.dwellChip?.let { add(Reason(it)) }
    }

    /** 어른끼리 해 진 뒤 야경 명소에 머물면 '야경 · 해 진 뒤' (아이와는 없음). */
    private fun nightReason(stops: List<Place>, legs: List<Leg>, ctx: Ctx): Reason? {
        if (ctx.profile.companion.kids) return null
        val dark = darkMin(ctx.sky)
        val lit = stops.any { p -> TAG_NIGHT in p.tags && legs.any { it.kind == LegKind.STAY && it.placeId == p.id && it.toMin > dark } }
        return if (lit) Reason("야경 · 해 진 뒤", Tone.SUN) else null
    }

    private fun rainText(ctx: Ctx): String {
        val rain = ctx.rain ?: return "비 → 실내"
        return when {
            rain <= ctx.now -> "비 → 실내"
            rain >= 12 * 60 -> "오후 비 → 실내"
            else -> "곧 비 → 실내"
        }
    }

    /** "해 지기 51분 전 귀가" (아이와만. 해 시각을 알고, 해 지기 2시간 안쪽에 도착할 때만 — 너무 이르면 뜻이 없다). */
    private fun sunReason(arriveMin: Int, ctx: Ctx): Reason? {
        // 어른끼리는 해 지기 전 귀가를 따지지 않는다
        if (!ctx.profile.companion.kids) return null
        val sunset = ctx.sky?.sunsetMin ?: return null
        val left = sunset - arriveMin
        if (left < 0 || left >= SUN_CHIP_MAX_MIN) return null
        val text = when {
            left < 60 -> "${left}분"
            left % 60 == 0 -> "${left / 60}시간"
            else -> "${left / 60}시간 ${left % 60}분"
        }
        return Reason("해 지기 $text 전 귀가", Tone.SUN)
    }
}
