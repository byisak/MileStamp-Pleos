package kr.milestamp.engine

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** 위도·경도 (도). */
data class LatLng(val lat: Double, val lng: Double)

object Geo {
    private const val EARTH_KM = 6371.0088

    /** 두 점 사이 직선거리(km, haversine). */
    fun km(a: LatLng, b: LatLng): Double {
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLng = Math.toRadians(b.lng - a.lng)
        val h = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLng / 2).pow(2)
        return 2 * EARTH_KM * asin(sqrt(h))
    }
}

enum class Gear { PARK, REVERSE, NEUTRAL, DRIVE, UNKNOWN }

enum class Sky { CLEAR, RAIN, SNOW, UNKNOWN }

/** 도착 지점(원) 하나 — 정문·후문·주차장마다 따로 그린다 (관리자 화면). */
data class Arrival(val at: LatLng, val radiusM: Int, val name: String = "")

/** 스탬프를 찍을 수 있는 장소. 좌표는 TourAPI mapx/mapy. */
data class Place(
    val id: String,
    val name: String,
    val at: LatLng,
    val indoor: Boolean = false,
    /** 도장 판정 반경(m). */
    val radiusM: Int = 300,
    /** 4살 기준 예상 체류(분, 상위 80%). 실제 기록이 쌓이면 서버가 보정. */
    val dwellP80Min: Int = 60,
    /** 아이 적합도 0~1 (연령 태그·편의시설에서 계산). */
    val kidFit: Double = 0.7,
    /** 문 여는·닫는 시각(분). 늦게 도착하면 문 열 때까지 기다린다. */
    val openMin: Int = 9 * 60,
    val closeMin: Int = 18 * 60,
    /** 요즘 다녀간 팀 수 (서버 방문 기록). 10팀 미만이면 '요즘 많이 감'으로 치지 않는다. */
    val popular: Int = 0,
    /** 도장 그림이 있어 도장을 찍을 수 있는 곳. 아니면 추천만 하고 도장 판정은 안 한다. */
    val stampable: Boolean = true,
    /** 도착 지점 여러 개 (서버 points). 비어 있으면 [at] + [radiusM] 원 하나. 어느 원 안에서든 도착. */
    val points: List<Arrival> = emptyList(),
    /** 기간 한정 축제·행사면 그 정보 (관리자 '축제·행사'). 기간 밖이면 추천·도장에서 빠진다. */
    val festival: FestivalInfo? = null,
    /** 동행별 적합도 0~1 (아이와는 [kidFit]을 쓴다). 칸이 없으면 [GoWith.DEFAULT_FIT]. */
    val fit: Map<GoWith, Double> = emptyMap(),
    /** 분위기 표시 (야경·카페·데이트·체험·산책·전시·드라이브·액티비티·조용함 …). 동행별 가점·'왜?' 글에 쓴다. */
    val tags: Set<String> = emptySet(),
    /** 어른 기준 머무는 시간(분). 없으면 [dwellP80Min] × 0.8. */
    val adultDwellMin: Int? = null,
    /** 쉬는 요일 (0=일 … 6=토, 관리자 closed_days + 쉬는 날 글 '매주 ○요일'). 그날 추천에서 빠진다. */
    val closedDays: Set<Int> = emptySet(),
    /** 임시 휴무 날짜 'YYYY-MM-DD' (관리자 temp_closed). */
    val closedDates: Set<String> = emptySet(),
    /**
     * 운영 시간 줄 (요일·공휴일·계절별, 서버 entity_hours → openHours). 있으면 그날 맞는 줄의 시각을 쓰고([onDay]),
     * 맞는 줄이 없으면 그날 쉰다. 비어 있으면 예전처럼 [openMin]·[closeMin] 하나.
     */
    val hours: List<OpenHours> = emptyList(),
    /** 마지막 입장(분). 도착이 이보다 늦으면 못 들어간다. null이면 따지지 않음. */
    val lastEntryMin: Int? = null,
    /** 종류: spot(일반) · view(전망대) · market(시장·야시장) · drive(야경 드라이브 길, [route]와 같이). 서버 places.kind. */
    val kind: String = "spot",
    /** 야경 드라이브 길 (kind = drive일 때만). 내리지 않고 지나가는 시간이 머무름. */
    val route: DriveRoute? = null,
    /** 언제 가면 좋은지 · 조명 켜지는 시각 · 쇼 시간표 (서버 moments). 저녁 나들이가 쓴다. */
    val moments: Moments? = null,
    /** 저녁(해 진 뒤) 어울림 0~1 — 동행별 (서버 fit.evening, 아이와 포함). 없으면 낮 어울림으로 어림 ([Planner.eveningFit]). */
    val fitEvening: Map<GoWith, Double> = emptyMap(),
) {
    /** 식사 자리(식당, kind = meal · id 'ext:food:<식당 id>') — 도장 없음, 머무름은 정한 값 그대로 ([Meals]). */
    val isMeal: Boolean get() = kind == Meals.KIND

    /** 야경 드라이브 길인가 (지나갈 점이 2개 이상 있을 때만). */
    val isDrive: Boolean get() = kind == KIND_DRIVE && route != null && route.points.size >= 2

    /** 밤에 좋은 곳: 시간 특성 best에 night, 또는 분위기 표시 '야경' (예전 자료). '밤의 ○○' 도장도 이런 곳만. */
    val nightBest: Boolean get() = moments?.best?.contains(BEST_NIGHT) == true || "야경" in tags

    /** 노을에 좋은 곳: best에 sunset, 또는 표시 '노을'. */
    val sunsetBest: Boolean get() = moments?.best?.contains(BEST_SUNSET) == true || "노을" in tags

    /** [day]에 쉬나: 쉬는 요일이거나 임시 휴무이거나 운영 시간 줄 중 그날 맞는 게 없음. 날짜를 모르면 쉬지 않는 것으로 (예전과 같음). */
    fun closedOn(day: String?): Boolean =
        day != null && DAY.matches(day) &&
            (day in closedDates || FestivalInfo.weekday(day) in closedDays || (hours.isNotEmpty() && OpenHours.pick(hours, day) == null))

    /** [day]의 운영 시각을 입힌 장소 (서버 placeOnDay와 같음). 줄이 없거나 날짜를 모르거나 맞는 줄이 없으면 그대로. */
    fun onDay(day: String?): Place {
        if (hours.isEmpty() || day == null || !DAY.matches(day)) return this
        val r = OpenHours.pick(hours, day) ?: return this
        if (r.openMin == openMin && r.closeMin == closeMin && r.lastEntryMin == lastEntryMin) return this
        return copy(openMin = r.openMin, closeMin = r.closeMin, lastEntryMin = r.lastEntryMin)
    }

    /** 이 동행에게 맞는 정도 0~1. 아이와 = [kidFit] (예전과 같음). */
    fun fitFor(c: GoWith): Double = if (c.kids) kidFit else fit[c] ?: GoWith.DEFAULT_FIT

    /** 도장 판정에 쓰는 원들. */
    val arrivals: List<Arrival> get() = points.ifEmpty { listOf(Arrival(at, radiusM)) }

    /** [h]에서 가장 가까운 도착 원 가장자리 안쪽이면 거리(m, 그 원 중심까지), 어느 원에도 없으면 null. */
    fun arrivalDistanceM(h: LatLng): Double? =
        arrivals.mapNotNull { a -> (Geo.km(h, a.at) * 1000).takeIf { it <= a.radiusM } }.minOrNull()

    fun contains(h: LatLng): Boolean = arrivalDistanceM(h) != null

    companion object {
        private val DAY = Regex("""\d{4}-\d{2}-\d{2}""")
        const val KIND_DRIVE = "drive"
        const val BEST_NIGHT = "night"
        const val BEST_SUNSET = "sunset"
    }
}

/**
 * 시간 특성 (서버 place-attrs-shape.ts Moments). [best] = day·sunset·night, [lightOn] = 'sunset' · 'sunset+15' · 'sunset-10' · 'HH:MM',
 * [shows] = 쇼 시간표 (분수쇼 등). 저녁 나들이가 도착 시각을 여기에 맞춘다.
 */
data class Moments(
    val best: Set<String> = emptySet(),
    val lightOn: String? = null,
    val shows: List<Show> = emptyList(),
) {
    /** 조명 켜지는 시각(분). 'sunset+N'은 [sunsetMin](모르면 null → [Planner.darkMin] 대신 쓰지 않고 null). 형식이 이상하면 null. */
    fun lightOnMin(sunsetMin: Int?): Int? {
        val on = lightOn?.replace(" ", "") ?: return null
        LIGHT_SUNSET.matchEntire(on)?.let { m ->
            val base = sunsetMin ?: return null
            return base + (m.groupValues[1].ifEmpty { "0" }.toInt())
        }
        return runCatching { hhmm(on) }.getOrNull()
    }

    private companion object {
        val LIGHT_SUNSET = Regex("""sunset([+-]\d{1,3})?""")
    }
}

/** 쇼 하나: 이름 · 시각들(분, 오름차순) · 요일(0=일, 비면 매일) · 달(1~12, 비면 늘). */
data class Show(val name: String, val times: List<Int>, val days: Set<Int> = emptySet(), val months: Set<Int> = emptySet()) {
    /** [day]에 하나: 요일·달이 맞음. 날짜를 모르면 요일·달 제한이 없는 쇼만. */
    fun runsOn(day: String?): Boolean {
        if (day == null || day.length != 10) return days.isEmpty() && months.isEmpty()
        val month = day.substring(5, 7).toInt()
        return (days.isEmpty() || FestivalInfo.weekday(day) in days) && (months.isEmpty() || month in months)
    }
}

/** 야경 드라이브 길: 지나갈 점들(첫 점 = 들어가는 곳, 끝 점 = 나오는 곳) · 지나가는 데 걸리는 분 (서버 route.pass_min). */
data class DriveRoute(val points: List<LatLng>, val passMin: Int)

/**
 * 조건 도장 (희귀): 주차한 때의 조건으로 붙는 이름. 차(TripEngine.grant)·서버(lib/arrive.ts rareFor)가 같은 규칙.
 *  - 비 오는 날: 하늘이 비 (모든 명소). 축제 도장은 그 자체로 한정이라 붙이지 않는다.
 *  - 밤: 해 진 뒤 도착 + 밤에 좋은 곳([Place.nightBest]) — '밤의 수성못'. 비가 먼저.
 */
object RareStamp {
    const val RAIN = "비 오는 날"
    const val NIGHT = "밤"

    fun of(place: Place, sky: Sky, nowMin: Int, sunsetMin: Int?): String? = when {
        place.festival != null -> null
        sky == Sky.RAIN -> RAIN
        sunsetMin != null && nowMin >= sunsetMin && place.nightBest -> NIGHT
        else -> null
    }
}

/**
 * 운영 시간 한 줄 (서버 place-attrs-shape.ts HoursRow와 같은 규칙). 시각은 0시부터 분, 자정을 넘기면 1440 이상.
 * [days] 요일(0=일 … 6=토), [holiday] 공휴일에 쓰는 줄, [validFrom]·[validTo] 'MM-DD' 해마다 되풀이되는 기간(해를 넘겨도 됨).
 */
data class OpenHours(
    val days: Set<Int> = emptySet(),
    val holiday: Boolean = false,
    val openMin: Int,
    val closeMin: Int,
    val lastEntryMin: Int? = null,
    val validFrom: String? = null,
    val validTo: String? = null,
    /** 쉬는 시간(식당 브레이크타임) — 영업 시간 안, 겹치지 않음. 식사 넣기([Meals.sessions])만 쓴다. */
    val breaks: List<BreakRange> = emptyList(),
    /** 마지막 주문(분, 식당). null이면 따지지 않음. */
    val lastOrderMin: Int? = null,
) {
    fun inSeason(day: String): Boolean {
        val from = validFrom ?: return true
        val to = validTo ?: return true
        val md = day.substring(5)
        return if (from <= to) md >= from && md <= to else md >= from || md <= to
    }

    companion object {
        /**
         * 그날 쓰는 줄: 공휴일이면 그 기간의 공휴일 줄 → 없으면 요일 줄. 같은 무리 안에서는 기간 있는 줄이 먼저, 그다음 목록 순서.
         * 없으면 null (그날 쉼).
         */
        fun pick(rows: List<OpenHours>, day: String): OpenHours? {
            fun first(xs: List<OpenHours>) = xs.firstOrNull { it.validFrom != null } ?: xs.firstOrNull()
            if (day in Holidays.KR) {
                val h = rows.filter { it.holiday && it.inSeason(day) }
                if (h.isNotEmpty()) return first(h)
            }
            val wd = FestivalInfo.weekday(day)
            return first(rows.filter { wd in it.days && it.inSeason(day) })
        }
    }
}

/** 쉬는 시간 한 칸 (분). */
data class BreakRange(val fromMin: Int, val toMin: Int)

/** 공휴일 (한국 날짜, 대체공휴일 포함). 서버 place-attrs-shape.ts KR_HOLIDAYS와 같은 목록 — 바꾸면 둘 다. */
object Holidays {
    val KR: Set<String> = setOf(
        "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02", "2026-05-05", "2026-05-24", "2026-05-25",
        "2026-06-03", "2026-06-06", "2026-08-15", "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05",
        "2026-10-09", "2026-12-25",
        "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-05", "2027-05-13", "2027-06-06",
        "2027-08-15", "2027-08-16", "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-03", "2027-10-04", "2027-10-09", "2027-10-11",
        "2027-12-25", "2027-12-27",
    )
}

/**
 * 기간 한정 축제·행사 (관리자 '축제·행사' 탭, docs/축제-안드로이드오토-계획.md ①).
 * 날짜는 한국 날짜 'YYYY-MM-DD'. 하루 운영 시각은 [Place.openMin]·[Place.closeMin]을 그대로 쓴다.
 * [placeId]는 붙은 명소 — 축제가 열리는 날엔 그 명소 대신 축제를 추천한다 (도착 원도 처음엔 그 명소 것).
 * [closedDays]는 쉬는 요일 (0=일 … 6=토).
 */
data class FestivalInfo(
    val id: String,
    val starts: String,
    val ends: String,
    val weight: Double = WEIGHT_NORMAL,
    val placeId: String? = null,
    val closedDays: List<Int> = emptyList(),
) {
    /** [day]에 열리나: 기간 안 + 쉬는 요일 아님. 날짜를 모르면 열리지 않는 것으로 (조심). */
    fun runsOn(day: String?): Boolean =
        day != null && DATE.matches(day) && day >= starts && day <= ends && weekday(day) !in closedDays

    /** 칩 글: '11/9' (끝나는 날). */
    val endsText: String get() = ends.split("-").let { "${it[1].toInt()}/${it[2].toInt()}" }

    companion object {
        /** 추천 가중치: 보통 · 강하게(주말 1순위 후보). 점수에 그대로 더한다. */
        const val WEIGHT_NORMAL = 1.0
        const val WEIGHT_STRONG = 2.5
        private val DATE = Regex("""\d{4}-\d{2}-\d{2}""")

        /** 'YYYY-MM-DD' → 요일 (0=일 … 6=토). */
        fun weekday(day: String): Int = java.time.LocalDate.parse(day).dayOfWeek.value % 7
    }
}

/**
 * 누구랑 가요? — 아이와 · 연인·부부 · 친구끼리 · 혼자. JSON·DB 값은 [key].
 * 아이와(KIDS)는 예전 규칙 그대로(낮잠·해 지기 전 귀가·4살 기준 머무름·아이 적합도).
 * 어른끼리는 낮잠 없음 · 귀가 한계 '늦어도 몇 시 귀가'([FamilyProfile.lateReturnMin], 기본 23:00) · 머무름 어른 기준 · 동행 적합도 + 분위기 가점.
 */
enum class GoWith(val key: String, val text: String) {
    KIDS("kids", "아이와"), COUPLE("couple", "연인·부부"), FRIENDS("friends", "친구끼리"), SOLO("solo", "혼자");

    val kids: Boolean get() = this == KIDS

    companion object {
        /** 장소에 동행 적합도가 없을 때 어른 기본값. */
        const val DEFAULT_FIT = 0.6

        /** 'kids'·'couple'·'friends'·'solo' → 값. 모르면 KIDS. */
        fun of(key: String?): GoWith = entries.firstOrNull { it.key == key } ?: KIDS
    }
}

/** 귀가 규칙: 정해진 시각 또는 '해 지기 N분 전'. */
sealed interface BackBy {
    data class At(val min: Int) : BackBy
    data class SunsetMinus(val min: Int) : BackBy
}

/**
 * 오늘 하늘. 시각은 모두 '그날 0시부터 분'.
 * 해 시각을 모르면 null (그때 '해 지기 N분 전' 귀가는 [FamilyProfile.FALLBACK_BACK_BY_MIN]으로 대신).
 * [sky]는 지금 날씨, [rainFromMin]은 비가 시작되는 시각(이미 오고 있으면 [sky] = RAIN). 비는 그칠 때를 따지지 않는다.
 */
data class SkyToday(
    val sunriseMin: Int? = null,
    val sunsetMin: Int? = null,
    val sky: Sky = Sky.UNKNOWN,
    val rainFromMin: Int? = null,
    /** 지금 미세먼지 등급 (에어코리아 가까운 측정소, 1시간). 모르면 null 또는 UNKNOWN — 둘 다 추천에 영향 없음. */
    val air: AirLevel? = null,
    /** 미세먼지(PM10)·초미세먼지(PM2.5) 농도 ㎍/㎥. 모르면 null. 화면 표시용 (추천은 [air]만 본다). */
    val pm10: Int? = null,
    val pm25: Int? = null,
    /** 지금 기온(℃, 기상청). 모르면 null. 저녁 나들이가 쌀쌀한지([Planner.COLD_C] 이하) 본다. */
    val tempC: Int? = null,
) {
    /** 미세먼지 나쁨 이상 → 야외 감점·실내 가점 ([Planner.airScore]). */
    val airBad: Boolean get() = air?.bad == true
}

/**
 * 미세먼지 등급 — 에어코리아 1시간 등급(pm10Grade1h·pm25Grade1h: 1 좋음 2 보통 3 나쁨 4 매우나쁨) 중 나쁜 쪽.
 * [text]는 칩 글 ('미세먼지 나쁨').
 */
enum class AirLevel(val text: String) {
    GOOD("좋음"), NORMAL("보통"), BAD("나쁨"), VERY_BAD("매우 나쁨"), UNKNOWN("모름");

    val bad: Boolean get() = this == BAD || this == VERY_BAD
}

/** 차에 미리 저장된 우리 가족 정보. 시각은 모두 '그날 0시부터 분'. */
data class FamilyProfile(
    val home: LatLng,
    val kids: Int = 2,
    /** 낮잠 시작·끝. 낮잠이 없으면 둘을 같게(길이 0). */
    val napStartMin: Int = 13 * 60,
    val napEndMin: Int = 14 * 60 + 30,
    /** 귀가 규칙. 기본은 해 지기 30분 전 (사용자 결정 10/25). */
    val backBy: BackBy = BackBy.SunsetMinus(30),
    /** 저녁 시각. 오후 짧은 나들이(AFTERNOON)에서만 귀가 한계로 쓴다. null이면 따지지 않음. */
    val dinnerMin: Int? = 18 * 60 + 30,
    val kidAges: List<Int> = listOf(4, 4),
    /** 오늘 이전까지 모은 도장 수. 오늘 첫 도장 번호 = 이 값 + 1. */
    val stampsBefore: Int = 0,
    /**
     * 우리 가족 머무름 배율 f (실제 머문 시간 ÷ 조사값의 EMA, 0.6~1.6). 서버가 다녀온 곳마다 [DwellLearning.update]로 갱신해 넣어 준다.
     * 1.0이고 기록·또래 자료가 없으면 조사값 그대로 (예전 사례와 같은 결과).
     */
    val dwellFactor: Double = 1.0,
    /** 배율을 배운 횟수. 2번 이상이면 카드에 '우리 가족은 보통 1.2배 머물러요' 칩. */
    val dwellN: Int = 0,
    /** 장소마다 우리 가족이 실제로 머문 평균(분)과 횟수. */
    val placeDwell: Map<String, PlaceDwell> = emptyMap(),
    /** 장소마다 같은 또래(아이 나이대) 가족들의 실제 머무름 P75와 가족 수 (서버 집계, 10가족 미만은 안 넣음). */
    val crowdDwell: Map<String, CrowdDwell> = emptyMap(),
    /** 오늘만 사람이 정한 머무름(분) — 앵커 코스·코스 편집 미리 보기. 15~360분·5분 단위로 맞춰 [dwellFor]가 이긴다. */
    val dwellSet: Map<String, Int> = emptyMap(),
    /**
     * 우리 가족 방문 기록 (서버가 도장·방문 소식에서 넣어 줌). null = 모름 → 점수·칩·설명에 영향 없음
     * (차 자기 계산처럼 기록이 없는 곳은 예전과 같은 결과).
     */
    val history: VisitHistory? = null,
    /** 누구랑 가요? 아이와가 아니면 낮잠·아이 규칙을 쓰지 않는다. */
    val companion: GoWith = GoWith.KIDS,
    /** 아이 잠자는 시간 (가족 설정, 기본 21:00). 아이와 저녁 나들이는 이 시각 전에 집 도착. */
    val bedtimeMin: Int = DEFAULT_BEDTIME_MIN,
    /** 어른끼리 '늦어도 몇 시 귀가' (가족 설정, 기본 23:00). 어른끼리는 낮·저녁 모두 이 시각이 귀가 한계. */
    val lateReturnMin: Int = DEFAULT_LATE_RETURN_MIN,
    /**
     * 밥도 같이 짜기 (가족 설정 '밥도 같이 짜기' 또는 이 계획만 '점심도 넣어 줘요'). null = 끔 (기본 — 예전과 한 글자도 같음).
     * 켜면 코스가 점심·저녁 창을 지날 때 식당 한 곳을 넣는다 ([Meals]).
     */
    val meal: MealSetup? = null,
) {
    /** 밥 설정에 그날 날짜를 넣은 프로필 (브레이크·쉬는 요일·주말 붐빔). 밥이 꺼져 있으면 그대로. */
    fun mealDay(day: String?): FamilyProfile = meal?.let { copy(meal = it.copy(day = day ?: it.day)) } ?: this

    /** 저녁 나들이 귀가 한계: 아이와 = 잠자는 시간 · 어른끼리 = 늦어도 몇 시 귀가. */
    val eveningLimitMin: Int get() = if (companion.kids) bedtimeMin else lateReturnMin

    /** 낮잠 길이. 어른끼리 가면 늘 0 (낮잠 없음). */
    val napLengthMin: Int get() = if (companion.kids) napEndMin - napStartMin else 0
    val hasNap: Boolean get() = napLengthMin > 0

    /**
     * 우리 가족 기준 머무는 시간(분) — 층층이 줄여 맞추기(shrinkage), 엔진 값만으로 설명할 수 있게.
     *  1. 사전값 prior = 조사값(P80). 같은 또래 가족이 10곳 이상이면 (n_c·또래 P75 + 10·조사값) ÷ (n_c + 10)
     *  2. 우리 가족: 그곳 기록이 n_p번 있으면 (n_p·우리 평균 + 3·prior·f) ÷ (n_p + 3), 없으면 prior·f
     *  3. 5분 단위 반올림, 15~360분. (오늘만 직접 정한 값은 살아 있는 코스의 SetDwell이 이긴다)
     * 배율 1.0 + 기록 없음 + 또래 자료 없음이면 조사값 그대로.
     */
    fun dwellFor(p: Place): Int = dwellEstimate(p).minutes

    /** [dwellFor] + 어디서 왔는지 (화면 글 '우리 가족 기록 3번' 등). */
    fun dwellEstimate(p: Place): DwellEstimate {
        // 식사 자리는 정한 머무름 그대로 (기본 50분 · 카페 30분 — 우리 가족 배율·기록을 안 씀)
        if (p.isMeal) return DwellEstimate(dwellSet[p.id]?.let(DwellLearning::clampUser) ?: p.dwellP80Min, DwellSource.BASE, 0, !companion.kids)
        dwellSet[p.id]?.let { set -> return copy(dwellSet = emptyMap()).dwellEstimate(p).copy(minutes = DwellLearning.clampUser(set)) }
        val adult = !companion.kids
        val base = if (adult) adultDwell(p) else p.dwellP80Min
        val own = placeDwell[p.id]?.takeIf { it.n >= 1 }
        // 또래(아이 나이대) 값은 아이와 갈 때만
        val crowd = crowdDwell[p.id]?.takeIf { it.n >= DwellLearning.CROWD_MIN_N && !adult }
        if (own == null && crowd == null && dwellFactor == 1.0) return DwellEstimate(base, DwellSource.BASE, 0, adult)
        val k = DwellLearning.CROWD_K
        val prior = if (crowd != null) (crowd.n * crowd.p75.toDouble() + k * base) / (crowd.n + k) else base.toDouble()
        val raw = if (own != null) {
            val w = DwellLearning.FAMILY_K
            (own.n * own.avg.toDouble() + w * prior * dwellFactor) / (own.n + w)
        } else prior * dwellFactor
        val min = DwellLearning.round5(raw).coerceIn(DwellLearning.MIN_MIN, DwellLearning.MAX_MIN)
        return when {
            own != null -> DwellEstimate(min, DwellSource.FAMILY, own.n, adult)
            crowd != null -> DwellEstimate(min, DwellSource.CROWD, crowd.n, adult)
            else -> DwellEstimate(min, DwellSource.BASE, 0, adult)
        }
    }

    /** 카드 칩 '우리 가족은 보통 1.2배 머물러요' — 2번 넘게 배웠고 배율이 1.0(소수 첫째 자리)이 아닐 때만. */
    val dwellChip: String?
        get() {
            if (dwellN < DwellLearning.CHIP_MIN_N) return null
            val t = Math.round(dwellFactor * 10).toInt()
            if (t == 10) return null
            return "우리 가족은 보통 ${t / 10}.${t % 10}배 머물러요"
        }

    /** 귀가 규칙을 오늘 시각으로. 해 시각을 모르면 고정 시각 또는 17:30. 어른끼리는 늘 '늦어도 몇 시 귀가'([lateReturnMin]). */
    fun backByMin(sky: SkyToday?): Int = if (!companion.kids) lateReturnMin else when (val b = backBy) {
        is BackBy.At -> b.min
        is BackBy.SunsetMinus -> sky?.sunsetMin?.let { it - b.min } ?: FALLBACK_BACK_BY_MIN
    }

    companion object {
        const val FALLBACK_BACK_BY_MIN = 17 * 60 + 30
        /** 어른끼리 '늦어도 몇 시 귀가' 기본값 (23:00 — 11/3 사용자 결정, 예전 22:00 고정을 대신함). */
        const val DEFAULT_LATE_RETURN_MIN = 23 * 60
        /** 아이 잠자는 시간 기본값 (21:00). */
        const val DEFAULT_BEDTIME_MIN = 21 * 60
        /** 어른 머무름 = 4살 기준 조사값 × 이 값 (장소에 어른 값이 없을 때). */
        const val ADULT_DWELL_RATIO = 0.8

        /** 어른 기준 머무름: 장소의 어른 값 → 조사값 × 0.8 (5분 단위, 15~360분). */
        fun adultDwell(p: Place): Int = (p.adultDwellMin ?: DwellLearning.round5(p.dwellP80Min * ADULT_DWELL_RATIO))
            .coerceIn(DwellLearning.MIN_MIN, DwellLearning.MAX_MIN)
    }
}

/**
 * 우리 가족 방문 기록 — 추천 점수 보완(같은 곳만 계속 나오지 않게)과 '왜?' 설명에 쓴다.
 * [stamped] = 도장을 이미 받은 장소 id, [lastVisitDays] = 장소 id → 마지막으로 다녀온 지 며칠(0 = 오늘),
 * [favorites] = 즐겨찾는 장소 id.
 */
data class VisitHistory(
    val stamped: Set<String> = emptySet(),
    val lastVisitDays: Map<String, Int> = emptyMap(),
    val favorites: Set<String> = emptySet(),
)

/** 장소 하나의 우리 가족 머무름 기록: 평균(분)·횟수. */
data class PlaceDwell(val avg: Int, val n: Int)

/** 같은 또래 가족들의 머무름: P75(분)와 가족 수. */
data class CrowdDwell(val p75: Int, val n: Int)

/** 머무름 출처: FAMILY = 우리 가족 기록 n번 · CROWD = 같은 또래 n가족 · BASE = 조사값(4살 기준). */
enum class DwellSource { FAMILY, CROWD, BASE }

/** 머무름 예상과 출처. [n] = 우리 기록 횟수(FAMILY) 또는 가족 수(CROWD). [adult] = 어른끼리(조사값이 어른 기준). */
data class DwellEstimate(val minutes: Int, val source: DwellSource, val n: Int, val adult: Boolean = false) {
    /** 화면 글: '우리 가족 기록 3번' · '같은 또래 가족 23곳 기준' · '조사값(4살 기준)' · 어른끼리 '우리 기록 3번' · '조사값(어른 기준)'. */
    val sourceText: String get() = when (source) {
        DwellSource.FAMILY -> if (adult) "우리 기록 ${n}번" else "우리 가족 기록 ${n}번"
        DwellSource.CROWD -> "같은 또래 가족 ${n}곳 기준"
        DwellSource.BASE -> if (adult) "조사값(어른 기준)" else "조사값(4살 기준)"
    }
}

/** 가족 머무름 배율·장소 기록 (서버 families.dwell_factor·dwell_n·place_dwell). */
data class DwellStats(val factor: Double = 1.0, val n: Int = 0, val places: Map<String, PlaceDwell> = emptyMap())

/**
 * 머무는 시간 배우기 — 다녀온 곳마다 (실제 머문 분 ÷ 조사값) 비율을 EMA(α 0.3)로 가족 배율에 섞는다 (0.6~1.6, 소수 둘째 자리).
 * 장소마다 실제 평균도 따로 쌓는다. 10분 미만 머무름(잠깐 섬)은 배우지 않고, 비율은 0.3~3으로 묶어 튀는 값을 줄인다.
 * 서버(`web/src/lib/planner.ts`)가 같은 식을 쓴다 — 같은 사례(plan-cases.json "dwellLearn")로 확인.
 */
object DwellLearning {
    const val ALPHA = 0.3
    const val FACTOR_MIN = 0.6
    const val FACTOR_MAX = 1.6
    /** 이보다 짧게 머문 건 배우지 않는다. */
    const val SAMPLE_MIN = 10
    const val RATIO_MIN = 0.3
    const val RATIO_MAX = 3.0
    /** 머무름 범위·단위 (사용자 조절·가족 맞춤 모두). */
    const val MIN_MIN = 15
    const val MAX_MIN = 360
    const val STEP_MIN = 5
    /** 이만큼 배운 뒤부터 카드 칩. */
    const val CHIP_MIN_N = 2
    /** 또래 자료는 이 가족 수 이상일 때만 (개인 값이 드러나지 않게). */
    const val CROWD_MIN_N = 10
    /** 또래 P75를 조사값 쪽으로 당기는 무게 (가족 10곳 = 반반). */
    const val CROWD_K = 10
    /** 우리 기록을 사전값 쪽으로 당기는 무게 (3번 = 반반). */
    const val FAMILY_K = 3

    /** 아이 나이대: 0–3 · 4–6 · 7–9 · 10+ (또래 묶음). 아이가 여럿이면 막내 기준. */
    fun ageBand(ages: List<Int>): String {
        val a = ages.minOrNull() ?: 4
        return when {
            a <= 3 -> "0-3"
            a <= 6 -> "4-6"
            a <= 9 -> "7-9"
            else -> "10+"
        }
    }

    /** 가족 설정 '머무는 편' → 배율 씨앗. quick 0.8 · normal 1.0 · long 1.25. */
    fun prefFactor(pref: String?): Double = when (pref) {
        "quick" -> 0.8
        "long" -> 1.25
        else -> 1.0
    }

    /** 5분 단위 반올림. */
    fun round5(x: Double): Int = Math.round(x / STEP_MIN).toInt() * STEP_MIN

    /** 사용자가 정한 머무름: 5분 단위, 15~360분. */
    fun clampUser(min: Int): Int = round5(min.toDouble()).coerceIn(MIN_MIN, MAX_MIN)

    /** 다녀온 곳 하나를 배운다. [baseMin] = 그곳 조사값(P80), [actualMin] = 실제 머문 분. 배울 게 아니면 그대로. */
    fun update(s: DwellStats, placeId: String, baseMin: Int, actualMin: Int): DwellStats {
        if (baseMin <= 0 || actualMin < SAMPLE_MIN) return s
        val ratio = (actualMin.toDouble() / baseMin).coerceIn(RATIO_MIN, RATIO_MAX)
        val f = ((1 - ALPHA) * s.factor + ALPHA * ratio).coerceIn(FACTOR_MIN, FACTOR_MAX)
        val factor = Math.round(f * 100) / 100.0
        val old = s.places[placeId]
        val pd = if (old == null) PlaceDwell(actualMin, 1)
        else PlaceDwell(Math.round((old.avg.toDouble() * old.n + actualMin) / (old.n + 1)).toInt(), old.n + 1)
        return DwellStats(factor, s.n + 1, s.places + (placeId to pd))
    }
}

/** "08:30" → 510. */
fun hhmm(text: String): Int {
    val (h, m) = text.trim().split(":").map { it.toInt() }
    require(h in 0..23 && m in 0..59) { "시각 형식은 HH:MM: $text" }
    return h * 60 + m
}

/** 분 → "HH:MM". 자정을 넘기면 다음 날 시각으로 (예: 30:26 → 06:26). */
fun Int.asHhmm(): String = Math.floorMod(this, 24 * 60).let { "%02d:%02d".format(it / 60, it % 60) }
