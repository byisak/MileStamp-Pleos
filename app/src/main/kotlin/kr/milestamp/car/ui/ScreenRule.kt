package kr.milestamp.car.ui

import kr.milestamp.car.trip.DriveGate
import kr.milestamp.car.trip.ProposalShown
import kr.milestamp.car.trip.UiState
import kr.milestamp.engine.ExplainAction
import kr.milestamp.engine.Explanation
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.TripState

/** 옆 창에 지금 그릴 화면 (위에서부터 먼저 맞는 것). */
enum class CarScreen { DRIVING, PAIR, DEV_BOARD, STAMP, VISIT, BOOK, HELD, SUMMARY, PLAN, COURSE, DAY_END, WAITING }

/** 대기 화면의 갈래: 아직 안 탐 / 코스를 불러오는 중 / 탔는데 고른 코스가 없음 / 밤이라 내일 코스(서버 tomorrowHint). */
enum class WaitKind { BEFORE_BOARD, LOADING, NO_COURSE, TOMORROW }

/** 시범 지역(대구·경북) 밖으로 보는 거리. 가장 가까운 명소가 이보다 멀면 추천 화면 위에 안내를 띄운다. */
const val OUT_OF_AREA_KM = 100.0

/**
 * 지금 위치가 명소들에서 멀면(가장 가까운 곳까지 [limitKm] 초과) 그 거리(km, 반올림), 아니면 null.
 * 위치를 모르거나 명소 목록이 비면 null (안내를 띄우지 않음).
 */
fun outOfAreaKm(here: kr.milestamp.engine.LatLng?, places: List<kr.milestamp.engine.Place>, limitKm: Double = OUT_OF_AREA_KM): Int? {
    if (here == null || places.isEmpty()) return null
    val nearest = places.minOf { kr.milestamp.engine.Geo.km(here, it.at) }
    return if (nearest > limitKm) Math.round(nearest).toInt() else null
}

/** 밤 계획(tomorrowHint)인데 아직 고른 코스가 없으면 '바로 집으로' 카드 하나 대신 대기 화면 '내일 코스' 안내. 재탑승 계획은 해당 없음. */
fun tomorrowWait(ui: UiState): Boolean {
    val p = ui.plan
    return ui.tomorrowHint && ui.course == null && (p == null || (p.chosen == null && p.mode != kr.milestamp.engine.PlanMode.REBOARD))
}

/**
 * 화면 고르기 (화면 코드와 떼어 단위 시험으로 확인).
 * 버튼이 있는 화면은 정차([DriveGate.parked] = P단 · 주행 제한 없음)일 때만 — 신호 대기(D · 0km/h)는 주행 화면.
 */
fun carScreenFor(ui: UiState): CarScreen {
    val state = ui.snapshot?.state
    return when {
        !DriveGate.parked(ui.snapshot) -> CarScreen.DRIVING
        ui.pair != null -> CarScreen.PAIR
        ui.devBoard -> CarScreen.DEV_BOARD
        ui.stamp != null -> CarScreen.STAMP
        // 도장 없는 바깥 장소 도착: 메달 대신 차분한 '다녀옴'
        ui.visit != null -> CarScreen.VISIT
        // 도장북은 보류·요약 화면 위에 뜬다 (머리줄 '도장북'을 누르면 바로 보이게, 닫으면 보류·요약이 다시)
        ui.book -> CarScreen.BOOK
        ui.held != null -> CarScreen.HELD
        ui.summary != null -> CarScreen.SUMMARY
        ui.plan != null && !tomorrowWait(ui) -> CarScreen.PLAN
        // 살아 있는 코스: 고른 뒤 집에 올 때까지 '오늘 코스'
        ui.course != null && state != TripState.HOME -> CarScreen.COURSE
        // 집 도착 요약을 닫은 뒤 = 오늘 나들이 끝
        state == TripState.HOME -> CarScreen.DAY_END
        else -> CarScreen.WAITING
    }
}

/** 대기 화면 갈래 (밤 계획이면 '내일 코스'). */
fun waitKindFor(ui: UiState): WaitKind = if (tomorrowWait(ui)) WaitKind.TOMORROW else waitKindFor(ui.snapshot?.state)

/**
 * 아직 안 탔으면(대기) '타면 추천' — 추천은 탑승(2열 착좌·주행)으로 계획 단계가 될 때 받으므로 그 전엔 불러오는 것이 없다.
 * 시동 직후(상태 모름)·계획 화면이 막 열리려는 참이면 '불러오는 중', 이미 움직였는데 코스가 없으면 '골라 주세요'.
 */
fun waitKindFor(state: TripState?): WaitKind = when (state) {
    TripState.IDLE -> WaitKind.BEFORE_BOARD
    null, TripState.PLANNING -> WaitKind.LOADING
    else -> WaitKind.NO_COURSE
}

/** 시각(하루 분)에 맞춘 인사. */
fun greetingFor(nowMin: Int?): String = when (nowMin?.let { (it / 60) % 24 }) {
    null -> "안녕하세요"
    in 5..10 -> "좋은 아침이에요"
    in 11..16 -> "좋은 오후예요"
    in 17..21 -> "좋은 저녁이에요"
    else -> "안녕하세요"
}

// ---------------------------------------------------------------- 코스 화면(S4) · 주행 화면(S2·S5)의 주인공과 큰 버튼

/**
 * 코스 화면의 큰 버튼 (화면에 하나, 잉크 초록).
 *  - [ADOPT] 제안이 떠 있으면 '이걸로 바꾸기' (첫 안)
 *  - [GO_HOME_LATE] 늦어짐(설명이 집으로를 권함, B3) → '지금 {도착지}으로 · 오후 4:30 도착' (확인 한 번)
 *  - [END_DAY] 아직 집인데 늦음 → '오늘 코스 마치기' (확인 한 번)
 *  - [NAVIGATE] 다음 목적지가 있으면 '출발 · 길 안내' (남은 코스로 내비 다시)
 *  - [NAVIGATE_HOME] 남은 곳이 없으면 '{도착지}으로 길 안내'
 */
enum class CoursePrimary { ADOPT, GO_HOME_LATE, END_DAY, NAVIGATE, NAVIGATE_HOME }

/**
 * 다음 목적지(주인공). [isEnd]면 장소가 아니라 오늘 도착지(집·할머니 집). [stamp]면 도착하면 도장,
 * [visit]이면 도장 없는 바깥 장소(ext:…) — 도착하면 '다녀옴'으로 기록.
 */
data class Hero(val name: String, val arriveMin: Int, val isEnd: Boolean, val stamp: Boolean, val dwellMin: Int? = null, val visit: Boolean = false, val meal: Boolean = false)

fun heroFor(course: LiveCourse): Hero {
    val next = course.next
    return if (next != null) Hero(next.place.name, next.plannedArriveMin, false, next.place.stampable, next.dwellGuessMin,
        visit = !next.place.stampable && next.id.startsWith("ext:") && !next.place.isMeal, meal = next.place.isMeal)
    else Hero(course.endName, course.arriveHomeMin, true, false)
}

fun coursePrimaryFor(course: LiveCourse, explain: Explanation?, proposal: ProposalShown?): CoursePrimary = when {
    proposal != null && proposal.options.isNotEmpty() -> CoursePrimary.ADOPT
    explain?.action == ExplainAction.GO_HOME -> CoursePrimary.GO_HOME_LATE
    explain?.action == ExplainAction.END -> CoursePrimary.END_DAY
    course.next != null -> CoursePrimary.NAVIGATE
    else -> CoursePrimary.NAVIGATE_HOME
}

/** 큰 버튼 글 (12시간 시각). */
fun primaryLabel(p: CoursePrimary, course: LiveCourse, explain: Explanation?): String = when (p) {
    CoursePrimary.ADOPT -> W.adopt
    CoursePrimary.GO_HOME_LATE -> "지금 ${toward(course.endName)}" + (explain?.homeMin?.let { " · ${clock(it)} 도착" } ?: "")
    CoursePrimary.END_DAY -> "오늘 코스 마치기"
    CoursePrimary.NAVIGATE -> W.go
    CoursePrimary.NAVIGATE_HOME -> "${toward(course.endName)} 길 안내"
}

/** 주행 화면 한 덩어리: 머리말('다음' / '도착지') · 이름 · 도착 줄 · 변경 칩. 코스가 없으면 엔진의 다음 정차지 이름만. */
data class DrivingView(val kicker: String, val name: String?, val arrive: String?, val chip: String?, val sub: String? = null)

fun drivingViewFor(ui: UiState): DrivingView {
    val c = ui.course
    val chip = ui.chip?.let(::clockText)
    if (c == null) return DrivingView(W.next, ui.snapshot?.nextStop, null, chip)
    val h = heroFor(c)
    val arrive = if (h.isEnd) "${clock(h.arriveMin)} 도착 예정" else "${clock(h.arriveMin)} 도착"
    // 칩이 다음 목적지 안내('다음 · 이름 …')와 같은 말이면 두 번 말하지 않는다
    val shownChip = chip?.takeUnless { it.startsWith("다음") && h.name in it }
    val sub = when { h.stamp -> "도착하면 도장"; h.visit -> W.arriveVisit; else -> null }
    return DrivingView(if (h.isEnd) "도착지" else W.next, h.name, arrive, shownChip, sub)
}
