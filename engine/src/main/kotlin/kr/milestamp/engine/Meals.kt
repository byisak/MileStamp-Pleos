package kr.milestamp.engine

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * 식당 (서버 restaurants 표 → /api/car/places의 restaurants). 시각은 0시부터 분.
 * [kid] = kids_menu · high_chair · play_room · floor_seat · stroller_ok · spicy_free_menu (있는 것만)
 * [parkingHas] = yes · no · limited, [parkingFee] = free · paid · partial (장소 주차와 같은 모양)
 * [wait] = weekday · weekend_lunch · weekend_dinner → 0(바로) ~ 2(오래 기다림)
 * [meal] = lunch · dinner · snack (비면 카페·베이커리는 snack, 그 밖은 lunch·dinner)
 * [hours] = 운영 시간 줄 (브레이크·마지막 주문 포함, 비면 11:00~21:00로 어림)
 */
data class Restaurant(
    val id: String,
    val name: String,
    val at: LatLng,
    val cuisine: List<String> = emptyList(),
    val priceLevel: Int? = null,
    val kid: Set<String> = emptySet(),
    val parkingHas: String? = null,
    val parkingFee: String? = null,
    val wait: Map<String, Int> = emptyMap(),
    val meal: Set<String> = emptySet(),
    val dwellMin: Int? = null,
    val fit: Map<GoWith, Double> = emptyMap(),
    val tags: Set<String> = emptySet(),
    val hours: List<OpenHours> = emptyList(),
    /** 곁에 있는 장소 id (관리자가 붙임, 표시용). */
    val placeId: String? = null,
) {
    /** 카페·베이커리만 (머무름 30분, 밥 자리엔 meal을 정했을 때만). */
    val isCafe: Boolean get() = cuisine.isNotEmpty() && cuisine.all { it in Meals.CAFE }
}

/** 밥도 같이 짜기 켬: 후보 식당과 그날 날짜(브레이크·쉬는 요일·주말 붐빔). */
data class MealSetup(val restaurants: List<Restaurant>, val day: String? = null)

/** 다른 식당 후보 (폰 '다른 식당'). [index] = 코스의 몇 번째 자리에 넣는지 (식당을 뺀 장소 목록 기준). */
data class MealAlt(
    val restaurantId: String,
    val name: String,
    val at: LatLng,
    val index: Int,
    val startMin: Int,
    val endMin: Int,
    val detourMin: Int,
    val features: List<String>,
    val cuisine: List<String>,
    /** 그 식당의 그 끼니 영업 구간 (식사 자리 Place의 openMin·closeMin·lastEntryMin). */
    val openMin: Int,
    val closeMin: Int,
    val lastOrderMin: Int?,
    val dwellMin: Int,
)

/**
 * 코스에 넣은 밥 자리. [placeId] = 'ext:food:<식당 id>' (stops 안 식사 자리), [index] = stops에서의 자리,
 * [kind] = lunch · dinner, [text] = 칩 글 '12:10 점심 · 할매칼국수 (아이 의자·주차 무료)'.
 */
data class MealStop(
    val restaurantId: String,
    val placeId: String,
    val name: String,
    val kind: String,
    val startMin: Int,
    val endMin: Int,
    val index: Int,
    val detourMin: Int,
    val features: List<String>,
    val cuisine: List<String>,
    val text: String,
    val alternatives: List<MealAlt>,
)

/**
 * 중간에 밥 넣기 (docs/장소-데이터-구조-계획.md §4). 서버 planner.ts의 meals 부분이 이 파일을 줄 단위로 옮긴다 — plan-cases.json "meals".
 *
 * 규칙
 * 1. 코스(지금 → 집)가 점심 창 11:30~13:30 또는 저녁 창 17:30~19:30과 60분 넘게 겹치면 그 끼니 하나 (점심 먼저).
 * 2. 자리 = 장소 사이 틈 (출발 → 첫 곳 · 곳과 곳 사이 · 마지막 곳 → 집). 낮잠 이동 틈은 안 씀. 저녁 카드는 마지막 곳 뒤만.
 * 3. 후보 = 그 끼니를 하는 식당 + 그 틈에서 돌아가는 시간 10분 안 + 그 시각에 열림(브레이크·마지막 주문을 피해,
 *    문 열기는 30분까지 기다림) + 밥 시작이 끼니 창 안 + 머무름(기본 50분 · 카페 30분)이 그 영업 구간 안.
 * 4. 뒤 시간표는 늘어난 만큼 민다 — 뒤 곳의 닫는 시각·마지막 입장·비(야외), 뒤 낮잠 이동, 귀가 한계 −10분을 넘으면 그 후보는 버림.
 * 5. 점수 = 동행 어울림×2 + 아이와 아이 시설 0.25씩(4개까지) + 주차(있음 0.5 · 무료 0.75 · 없음 −0.5) − 붐빔×0.5
 *          + 동행 표시(아이랑·뷰 맛집·노포·혼밥) 0.5 − 돌아가는 분/10 − |시작 − 12:00(18:00)|/60 − 문 열기 기다림/60.
 *    같으면 집 도착 이른 쪽 → 식당 id → 앞 틈.
 * 6. '다른 식당' 3곳: 고른 곳과 음식 종류가 다른 곳 먼저, 모자라면 점수순.
 * 7. 못 넣으면: 틈 가까이 식당이 없으면 '근처에 등록된 식당이 없어요', 가깝지만 그때 문을 안 열면 '점심 때 문 연 식당이 없어요',
 *    시간표가 넘쳐서면 '밥 넣을 시간이 빠듯해요'.
 */
object Meals {
    const val KIND = "meal"
    const val ID_PREFIX = "ext:food:"
    const val DWELL_MIN = 50
    const val CAFE_DWELL_MIN = 30
    const val DETOUR_MAX_MIN = 10
    const val SPAN_MIN = 60
    const val WAIT_MAX_MIN = 30
    const val ALT_MAX = 3
    const val DEFAULT_OPEN_MIN = 11 * 60
    const val DEFAULT_CLOSE_MIN = 21 * 60
    const val RADIUS_M = 300
    const val HINT_NONE = "근처에 등록된 식당이 없어요"
    const val HINT_TIGHT = "밥 넣을 시간이 빠듯해요"
    /** 가까운 식당은 있는데 그 끼니 때 문을 안 엶 (브레이크·마지막 주문·쉬는 날 포함). */
    fun hintClosed(w: Window) = "${w.text} 때 문 연 식당이 없어요"
    val CAFE = setOf("카페", "베이커리")

    /** 끼니 창: 이름 · 칩 글 · 창 · 좋은 시각. */
    data class Window(val key: String, val text: String, val fromMin: Int, val toMin: Int, val idealMin: Int)

    val LUNCH = Window("lunch", "점심", 11 * 60 + 30, 13 * 60 + 30, 12 * 60)
    val DINNER = Window("dinner", "저녁", 17 * 60 + 30, 19 * 60 + 30, 18 * 60)
    val WINDOWS = listOf(LUNCH, DINNER)

    /** 아이 시설 글 (칩·화면, 이 순서로). */
    val KID_TEXT: List<Pair<String, String>> = listOf(
        "high_chair" to "아이 의자", "kids_menu" to "아이 메뉴", "play_room" to "놀이방",
        "floor_seat" to "좌식", "stroller_ok" to "유모차 OK", "spicy_free_menu" to "안 매운 메뉴",
    )
    private val KID_KEYS = KID_TEXT.map { it.first }.toSet()

    /** 동행마다 가점 받는 식당 표시. */
    val COMPANION_TAG: Map<GoWith, String> = mapOf(
        GoWith.KIDS to "아이랑", GoWith.COUPLE to "뷰 맛집", GoWith.FRIENDS to "노포", GoWith.SOLO to "혼밥",
    )

    private val DAY = Regex("""\d{4}-\d{2}-\d{2}""")

    fun isMealId(id: String) = id.startsWith(ID_PREFIX)

    /** 머무름: 정한 값 → 카페 30분 · 그 밖 50분. */
    fun dwellOf(r: Restaurant): Int = r.dwellMin ?: if (r.isCafe) CAFE_DWELL_MIN else DWELL_MIN

    /** 이 끼니를 하나: meal을 정했으면 그대로, 아니면 카페가 아닌 곳만. */
    fun serves(r: Restaurant, w: Window): Boolean = if (r.meal.isNotEmpty()) w.key in r.meal else !r.isCafe

    /** 주말(토·일·공휴일). 날짜를 모르면 평일. */
    fun weekend(day: String?): Boolean =
        day != null && DAY.matches(day) && (FestivalInfo.weekday(day).let { it == 0 || it == 6 } || day in Holidays.KR)

    /** 영업 구간 하나 (브레이크로 나뉜 조각). [lastOrderMin]은 이 구간에 걸린 마지막 주문. */
    data class Session(val fromMin: Int, val toMin: Int, val lastOrderMin: Int?)

    /**
     * 그날 영업 구간 (브레이크로 나눔, 마지막 주문 뒤 구간은 없앰). 줄이 없으면 11:00~21:00 하나, 날짜를 모르면 첫 줄.
     * 그날 맞는 줄이 없으면 null (쉼).
     */
    fun sessions(r: Restaurant, day: String?): List<Session>? {
        if (r.hours.isEmpty()) return listOf(Session(DEFAULT_OPEN_MIN, DEFAULT_CLOSE_MIN, null))
        val row = (if (day != null && DAY.matches(day)) OpenHours.pick(r.hours, day) else r.hours.first()) ?: return null
        val out = mutableListOf<Session>()
        var from = row.openMin
        for (b in row.breaks.sortedBy { it.fromMin }) {
            if (b.fromMin > from) out += Session(from, b.fromMin, null)
            from = max(from, b.toMin)
        }
        if (row.closeMin > from) out += Session(from, row.closeMin, null)
        val lo = row.lastOrderMin ?: return out
        return out.filter { it.fromMin <= lo }.map { if (lo <= it.toMin) it.copy(lastOrderMin = lo) else it }
    }

    /** [arrive]에 닿으면 언제 먹기 시작하나: 문 열기 30분까지 기다림, 머무름이 구간 안, 마지막 주문 전. 안 되면 null. */
    fun startIn(sessions: List<Session>, arrive: Int, dwell: Int): Pair<Session, Int>? {
        for (s in sessions) {
            val start = max(arrive, s.fromMin)
            if (start - arrive > WAIT_MAX_MIN) return null
            if (start + dwell > s.toMin) continue
            if (s.lastOrderMin != null && start > s.lastOrderMin) continue
            return s to start
        }
        return null
    }

    /** 붐빔 0~2 (모르면 0): 평일 · 주말 점심 · 주말 저녁. */
    fun waitLevel(r: Restaurant, w: Window, weekend: Boolean): Int =
        (r.wait[if (!weekend) "weekday" else if (w == LUNCH) "weekend_lunch" else "weekend_dinner"] ?: 0).coerceIn(0, 2)

    /** 식당 점수 (자리·시각 빼고). */
    fun score(r: Restaurant, c: GoWith, w: Window, weekend: Boolean): Double {
        var s = 2.0 * (r.fit[c] ?: GoWith.DEFAULT_FIT)
        if (c.kids) s += 0.25 * min(4, r.kid.count { it in KID_KEYS })
        when (r.parkingHas) {
            "yes" -> s += if (r.parkingFee == "free") 0.75 else 0.5
            "no" -> s -= 0.5
        }
        s -= 0.5 * waitLevel(r, w, weekend)
        COMPANION_TAG[c]?.let { if (it in r.tags) s += 0.5 }
        return s
    }

    /** 칩 괄호 안 특징 (최대 3): 아이와 아이 시설 하나 · 주차 · 주말에도 덜 붐빔. */
    fun features(r: Restaurant, c: GoWith, w: Window, weekend: Boolean): List<String> = buildList {
        if (c.kids) KID_TEXT.firstOrNull { it.first in r.kid }?.let { add(it.second) }
        when {
            r.parkingHas == "yes" && r.parkingFee == "free" -> add("주차 무료")
            r.parkingHas == "yes" -> add("주차 쉬움")
        }
        val key = if (w == LUNCH) "weekend_lunch" else "weekend_dinner"
        if (weekend && r.wait[key] == 0) add("주말에도 덜 붐벼요")
    }

    /** 칩 글: '12:10 점심 · 할매칼국수 (아이 의자·주차 무료)'. */
    fun chipText(startMin: Int, w: Window, name: String, features: List<String>): String =
        "${startMin.asHhmm()} ${w.text} · $name" + (if (features.isEmpty()) "" else " (${features.joinToString("·")})")

    /** 식당 → 코스에 넣는 식사 자리 (실내 · 도장 없음 · 그 영업 구간 · 정한 머무름). */
    fun placeOf(r: Restaurant, s: Session, dwell: Int): Place = Place(
        id = ID_PREFIX + r.id, name = r.name, at = r.at, indoor = true, radiusM = RADIUS_M, dwellP80Min = dwell,
        kidFit = r.fit[GoWith.KIDS] ?: GoWith.DEFAULT_FIT, openMin = s.fromMin, closeMin = s.toMin, stampable = false,
        adultDwellMin = dwell, lastEntryMin = s.lastOrderMin, kind = KIND, tags = r.tags,
        fit = r.fit.filterKeys { !it.kids },
    )

    /** 장소에서 나오는 점 (드라이브 길은 끝 점). */
    private fun exitOf(p: Place): LatLng = if (p.isDrive) p.route!!.points.last() else p.at

    /** 밥 자리를 넣은 시간표. */
    class Spliced(val stops: List<Place>, val legs: List<Leg>, val arriveHome: Int, val firstLeg: Int, val meal: MealStop)

    /** 넣은 결과 또는 못 넣은 까닭. */
    class Outcome(val spliced: Spliced?, val hint: String?)

    private class Cand(
        val r: Restaurant, val gap: Int, val session: Session, val start: Int, val dwell: Int, val detour: Int,
        val legs: List<Leg>, val arriveHome: Int, val firstLeg: Int, val score: Double,
    )

    /**
     * 코스 [stops]·시간표 [legs](지금 → 집)에 밥 자리를 넣는다. 밥 설정이 없거나 끼니 창을 안 지나면 null (그대로).
     * [safe] = 귀가 한계 − 10분, [rain] = 비 시작(없으면 null), [lastOnly] = 마지막 곳 뒤에만.
     */
    fun plan(stops: List<Place>, legs: List<Leg>, here: LatLng, profile: FamilyProfile, safe: Int, rain: Int?, lastOnly: Boolean): Outcome? {
        val setup = profile.meal ?: return null
        if (stops.isEmpty() || legs.isEmpty() || stops.any { it.isMeal }) return null
        val begin = legs.first().fromMin
        val end = legs.last().toMin
        val w = WINDOWS.firstOrNull { min(end, it.toMin) - max(begin, it.fromMin) >= SPAN_MIN } ?: return null
        val day = setup.day
        val weekend = weekend(day)
        val comp = profile.companion
        val cap = if (comp.kids) Planner.AWAKE_DRIVE_MAX_MIN else Planner.ADULT_DRIVE_MAX_MIN
        val n = stops.size
        var near = false
        var open = false
        var tight = false
        val cands = mutableListOf<Cand>()
        for (g in (if (lastOnly) listOf(n) else (0..n).toList())) {
            val moveIdx = if (g < n) legs.indexOfFirst { !it.isStay && it.placeId == stops[g].id } else legs.lastIndex
            if (moveIdx < 0) continue
            val move = legs[moveIdx]
            if (move.isStay || move.kind == LegKind.NAP_DRIVE) continue
            val a = if (g == 0) here else exitOf(stops[g - 1])
            val b = if (g < n) stops[g].at else profile.home
            val depart = move.fromMin
            for (r in setup.restaurants.sortedBy { it.id }) {
                if (!serves(r, w)) continue
                val toR = TravelTime.minutes(a, r.at)
                val fromR = TravelTime.minutes(r.at, b)
                val detour = toR + fromR - move.minutes
                if (detour > DETOUR_MAX_MIN || toR > cap || fromR > cap) continue
                near = true
                val ses = sessions(r, day) ?: continue
                val dwell = dwellOf(r)
                val arrive = depart + toR
                val (s, start) = startIn(ses, arrive, dwell) ?: continue
                if (start < w.fromMin || start > w.toMin) continue
                open = true
                val out = shift(stops, legs, moveIdx, r, depart, toR, fromR, start, dwell, g < n, profile, safe, rain)
                if (out == null) { tight = true; continue }
                val first = if (g == 0) toR else legs.first { !it.isStay }.minutes
                val sc = score(r, comp, w, weekend) - detour / 10.0 - abs(start - w.idealMin) / 60.0 - (start - arrive) / 60.0
                cands += Cand(r, g, s, start, dwell, detour, out, out.last().toMin, first, sc)
            }
        }
        if (cands.isEmpty()) return Outcome(null, if (tight) HINT_TIGHT else if (open || near) hintClosed(w) else HINT_NONE)
        cands.sortWith(compareByDescending<Cand> { it.score }.thenBy { it.arriveHome }.thenBy { it.r.id }.thenBy { it.gap })
        val best = cands.first()
        // 식당마다 가장 좋은 자리 하나 → 다른 식당 3곳 (음식 종류가 다른 곳 먼저)
        val perR = LinkedHashMap<String, Cand>()
        for (c in cands) if (c.r.id != best.r.id && c.r.id !in perR) perR[c.r.id] = c
        val alts = mutableListOf<Cand>()
        val used = mutableSetOf(best.r.cuisine.firstOrNull() ?: "")
        for (c in perR.values) {
            if (alts.size >= ALT_MAX) break
            val k = c.r.cuisine.firstOrNull() ?: ""
            if (k !in used) { alts += c; used += k }
        }
        for (c in perR.values) {
            if (alts.size >= ALT_MAX) break
            if (c !in alts) alts += c
        }
        val feats = features(best.r, comp, w, weekend)
        val place = placeOf(best.r, best.session, best.dwell)
        val meal = MealStop(
            best.r.id, place.id, best.r.name, w.key, best.start, best.start + best.dwell, best.gap, best.detour, feats, best.r.cuisine,
            chipText(best.start, w, best.r.name, feats),
            alts.map { c ->
                MealAlt(c.r.id, c.r.name, c.r.at, c.gap, c.start, c.start + c.dwell, c.detour, features(c.r, comp, w, weekend), c.r.cuisine,
                    c.session.fromMin, c.session.toMin, c.session.lastOrderMin, c.dwell)
            },
        )
        val newStops = stops.take(best.gap) + place + stops.drop(best.gap)
        return Outcome(Spliced(newStops, best.legs, best.arriveHome, best.firstLeg, meal), null)
    }

    /**
     * [moveIdx] 이동(A → B)을 A → 식당 → 밥 → B로 바꾸고 뒤 칸을 늘어난 만큼 민다. 뒤 곳·낮잠·귀가 한계를 어기면 null.
     */
    private fun shift(
        stops: List<Place>, legs: List<Leg>, moveIdx: Int, r: Restaurant, depart: Int, toR: Int, fromR: Int, start: Int, dwell: Int,
        toPlace: Boolean, profile: FamilyProfile, safe: Int, rain: Int?,
    ): List<Leg>? {
        val move = legs[moveIdx]
        val id = ID_PREFIX + r.id
        val leave = start + dwell
        val moveEnd = leave + fromR
        val delta = moveEnd - move.toMin
        val out = legs.subList(0, moveIdx).toMutableList()
        out += Leg(LegKind.DRIVE, depart, depart + toR, id)
        out += Leg(LegKind.MEAL, depart + toR, leave, id)
        out += Leg(if (toPlace) LegKind.DRIVE else LegKind.HOME, leave, moveEnd, move.placeId)
        for (l in legs.subList(moveIdx + 1, legs.size)) {
            val nl = l.copy(fromMin = l.fromMin + delta, toMin = l.toMin + delta)
            if (l.kind == LegKind.NAP_DRIVE && !TimeBudget.napAligned(nl.fromMin, nl.minutes, profile)) return null
            if (l.isStay) {
                val p = stops.firstOrNull { it.id == l.placeId }
                if (p != null && !p.isDrive) {
                    if (nl.toMin > p.closeMin) return null
                    if (p.lastEntryMin != null && max(nl.fromMin, p.openMin) > p.lastEntryMin) return null
                    if (!p.indoor && rain != null && nl.toMin > rain && l.toMin <= rain) return null
                }
            }
            out += nl
        }
        if (out.last().toMin > safe) return null
        return out
    }
}
