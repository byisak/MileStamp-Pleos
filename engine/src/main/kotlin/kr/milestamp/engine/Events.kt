package kr.milestamp.engine

/**
 * 차·내비·디버그 입력이 엔진에 넣는 신호. [atMs]는 단조 시계(SystemClock.elapsedRealtime)로,
 * '3초 유지' 같은 판정에 쓴다. 이야기 속 시각(08:30 등)은 [Clock]으로 따로 넣는다.
 */
sealed interface SignalEvent {
    val atMs: Long

    data class GearChanged(val gear: Gear, override val atMs: Long) : SignalEvent
    data class Speed(val kmh: Float, override val atMs: Long) : SignalEvent
    data class DriverDoor(val open: Boolean, override val atMs: Long) : SignalEvent
    data class RearSeats(val occupied: Int, override val atMs: Long) : SignalEvent
    data class Odometer(val km: Double, override val atMs: Long) : SignalEvent
    data class Location(val at: LatLng, override val atMs: Long) : SignalEvent
    data class UxRestricted(val on: Boolean, override val atMs: Long) : SignalEvent

    /** NaviHelper onDestinationInfo. */
    data class Eta(val remainS: Int, val remainM: Int, override val atMs: Long) : SignalEvent
    /** NaviHelper onRouteStarted 총거리(도장 검증의 경로거리). */
    data class RouteDistance(val km: Double, override val atMs: Long) : SignalEvent

    /**
     * 이야기 속 지금 시각(분). 실제 차는 1분마다 벽시계, 시연은 디버그 입력.
     * [day] = 오늘 날짜 'YYYY-MM-DD' (축제 기간 판단). null이면 앞서 받은 날짜 그대로.
     */
    data class Clock(val nowMin: Int, override val atMs: Long, val day: String? = null) : SignalEvent
    /**
     * 날씨. [rainSoon] = 3시간 안에 비 예보 (시각을 모를 때). [rainFromMin]을 알면 그 시각을 쓴다.
     * 하루 코스는 비 오는 시각부터 야외에 머물지 않는다.
     */
    data class Weather(
        val sky: Sky,
        val rainSoon: Boolean,
        override val atMs: Long,
        val rainFromMin: Int? = null,
    ) : SignalEvent
    /** 오늘 해 뜨고 지는 시각(분). 서버(천문연) 값 또는 차 안 공식([Sun]). 귀가 '해 지기 30분 전'에 쓴다. */
    data class Sun(val sunriseMin: Int, val sunsetMin: Int, override val atMs: Long) : SignalEvent

    /**
     * 서버가 계산한 오늘 계획. 계획 화면(PLANNING)일 때만 차 자기 계산을 바꿔 끼운다.
     * [chosenIdx]가 있으면 이미 고른 계획 (폰에서 골랐으면 [by] = "아빠 폰" 같은 이름).
     */
    data class ServerPlan(val plan: Plan, val chosenIdx: Int?, val by: String?, override val atMs: Long) : SignalEvent

    /** 추천 카드 탭: 이 경로로 출발. 제안 카드(CourseProposal)를 골랐을 때도 같은 신호. */
    data class RouteChosen(val option: PlanOption, override val atMs: Long) : SignalEvent
    /**
     * 살아 있는 코스에 내리는 명령 (다음 바꾸기·빼기·들르기·집으로·폰 코스). 출발·도착·정차·내비·날씨·해 시각은
     * 엔진이 기존 신호에서 저절로 만든다. [deferWhileDriving]면 주행 중엔 다음 정차 때까지 보류 (폰에서 온 변경).
     */
    data class CourseCommand(val event: CourseEvent, override val atMs: Long, val deferWhileDriving: Boolean = false) : SignalEvent
    /** 제안 카드 '그대로 갈게요' — 엔진도 그 제안을 버린다 (다음 정차 때 다시 내지 않음). */
    data class ProposalDismissed(override val atMs: Long) : SignalEvent
    /**
     * 가족 폰이 오늘 코스를 취소함 (서버에 코스가 없어짐 — 고르기 취소). 아직 아무 곳도 다녀오지 않았을 때만 차 코스도 없앤다
     * (다녀온 곳이 있으면 폰은 '오늘 코스 마치기'(GoHome)를 보내 Remote로 온다).
     */
    data class CourseCancelled(override val atMs: Long) : SignalEvent
    /** 소개 오디오가 끝까지 재생됨. */
    data class IntroFinished(val placeId: String, override val atMs: Long) : SignalEvent
    /** 1초마다. '유지' 판정을 다시 본다. */
    data class Tick(override val atMs: Long) : SignalEvent
}

/** 엔진이 앱에 시키는 일. 화면·음성·내비·서버 호출은 앱이 한다. */
sealed interface Effect {
    data class StateChanged(val from: TripState, val to: TripState) : Effect
    data class ShowPlan(val plan: Plan) : Effect
    data object CollapsePlan : Effect
    data class RequestRoute(val option: PlanOption) : Effect
    /** 카드를 골랐음 → 앱이 서버에 알림(다른 폰들도 바뀌게). [index]는 계획 안 카드 번호(모르면 null). */
    data class PlanChosen(val option: PlanOption, val index: Int?) : Effect
    data class ShowDrivingChip(val text: String) : Effect
    data class QuietMode(val on: Boolean) : Effect
    data class PlayIntro(val place: Place, val variant: IntroVariant) : Effect
    /** 쉿 모드 또는 시간이 짧을 때: 소개는 폰에 글로. */
    data class IntroToPhone(val place: Place) : Effect
    data class StampGranted(
        val place: Place,
        val number: Int,
        val rare: String?,
        val silent: Boolean,
        val verdict: StampVerdict.Granted,
    ) : Effect
    data class StampHeld(val place: Place, val verdict: StampVerdict.Held) : Effect
    /** 소개 재생 중 문이 열림 → 앱이 재생 위치를 붙여 서버 /handoff 로. */
    data class HandoffToPhone(val place: Place) : Effect
    data class PushMission(val place: Place) : Effect
    /**
     * 도장이 없는 바깥 장소(코스에만 있는 'ext:…', 장소 목록 밖)에 도착 → 도장·메달 대신 차분한 '다녀옴' 한 줄.
     * 앱이 서버에 알리면(코스 Arrived) 서버가 '다녀온 곳'에 적는다. 하루 한 곳 한 번.
     */
    data class Visited(val place: Place) : Effect
    data class DaySummary(val stamps: Int, val rare: Int, val rankedStamps: Int, val kmToday: Double?) : Effect
    data object WarnRearSeat : Effect

    /**
     * 살아 있는 코스가 바뀜 (시간표·상태). [change]가 있고 크기가 QUIET이 아니면 칩 한 줄, [quiet]이 아니면 [voice] 한 문장.
     * 주행 중·쉿 모드면 [quiet] = true (칩만). 제안이 생겼는데 주행 중이면 이 효과만 내고 카드는 다음 정차 때.
     */
    data class CourseUpdated(val course: LiveCourse, val change: Change?, val quiet: Boolean, val voice: String? = null) : Effect
    /** 정차 중 제안 카드 1~3장. 고르면 [SignalEvent.RouteChosen]으로 돌려준다. */
    data class CourseProposal(val course: LiveCourse, val options: List<PlanOption>, val change: Change) : Effect
    /** 떠 있던 제안이 지났거나(코스가 바뀜·이미 감·출발 시각 지남) '그대로 갈게요'로 버려짐 → 카드를 치운다. [reason]은 로그용. */
    data class ProposalCleared(val reason: String) : Effect
}

enum class TripState {
    /** 대기 */
    IDLE,
    /** 아침 계획 · 재탑승 계획 (카드 표시) */
    PLANNING,
    /** 주행 */
    DRIVING,
    /** 도착 전 소개 */
    ARRIVING,
    /** 주차 (도장 판정 끝) */
    PARKED,
    /** 하차 (가족이 구경 중) */
    OUT,
    /** 귀가 중 */
    HOMEWARD,
    /** 귀가 */
    HOME,
}
