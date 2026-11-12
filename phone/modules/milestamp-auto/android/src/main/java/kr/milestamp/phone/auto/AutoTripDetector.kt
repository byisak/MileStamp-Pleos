package kr.milestamp.phone.auto

import kr.milestamp.engine.Geo
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.Place
import kr.milestamp.engine.StampVerdict
import kr.milestamp.engine.StampVerifier

/**
 * 안드로이드 오토용 판정 어댑터 (안드로이드에 의존하지 않음 — JVM 단위 시험).
 *
 * Pleos 차는 기어·문·좌석·주행거리로 판정하지만 안드로이드 오토에는 그 신호가 없다. 그래서
 *  - 탑승 = 안드로이드 오토 연결(세션 생성 / CarConnection 투사), 하차 = 연결 해제
 *  - 주차 = 속도 ≈ 0이 3분 이어짐 **또는** 도착 원 안에서 연결 해제
 *  - 도장 검증 = 엔진 [StampVerifier] 그대로. 주행거리(CarHardware Mileage)가 있으면 지금 규칙,
 *    없으면 이번 구간 GPS 궤적 길이를 '늘어난 거리'로 넣는다(하한 0.9 × 직선 − 1km는 같음 → 위치만 바꾼 위조는 보류).
 *    이때 출처는 'phone'(폰 인증 — 서버는 순위 점수를 낮게).
 *
 * [places]는 도장 찍을 수 있는 장소(서버 명소 목록), [stampedToday]는 오늘 이미 찍은 곳인지.
 * 모든 입력은 단조 시계 [atMs]로 받는다. 결과는 [Out] 목록 (화면·서버 호출은 부르는 쪽이 한다).
 */
class AutoTripDetector(
    private val places: () -> List<Place>,
    private val stampedToday: (String) -> Boolean,
) {
    enum class Phase { IDLE, DRIVING, STOPPED, OUT }

    /** 도장 시도 한 번. [source] = "odometer"(차 주행거리) 또는 "phone"(GPS 궤적만) */
    data class Attempt(
        val place: Place,
        val verdict: StampVerdict,
        val source: String,
        /** 이번 구간 늘어난 주행거리(km). 주행거리 신호가 없으면 null */
        val odoKm: Double?,
        val gpsPathKm: Double,
        val straightKm: Double,
        val reason: String,
        val atMs: Long,
        /** 이번 구간을 시작한 도장 장소 (처음 구간이면 null = 집·출발지) — 서버가 직선거리를 다시 잴 때 */
        val fromPlaceId: String? = null,
    ) {
        val granted get() = verdict is StampVerdict.Granted
    }

    sealed interface Out {
        data object Boarded : Out
        data object Left : Out
        data object Moving : Out
        /** 3분 정차 (도착 원 밖이면 [place] null — 도장 없음) */
        data class Parked(val place: Place?) : Out
        data class Stamp(val attempt: Attempt) : Out
    }

    var phase = Phase.IDLE; private set
    var here: LatLng? = null; private set
    var gpsPathKm = 0.0; private set
    var legStart: LatLng? = null; private set
    private var odoNow: Double? = null
    private var odoStart: Double? = null
    private var hereAtMs = 0L
    private var lastAccepted: LatLng? = null
    private var stoppedSinceMs: Long? = null
    private var movedThisLeg = false
    /** 이번 정차에서 이미 판정함 (같은 정차에 두 번 찍지 않음) */
    private var attemptedThisStop = false
    var lastAttempt: Attempt? = null; private set
    private var legFromPlaceId: String? = null

    // ------------------------------------------------------------ 연결

    fun connected(atMs: Long): List<Out> {
        if (phase == Phase.DRIVING || phase == Phase.STOPPED) return emptyList()
        phase = Phase.STOPPED
        stoppedSinceMs = atMs
        if (legStart == null) legStart = here
        if (odoStart == null) odoStart = odoNow
        return listOf(Out.Boarded)
    }

    fun disconnected(atMs: Long): List<Out> {
        if (phase == Phase.IDLE || phase == Phase.OUT) return emptyList()
        val out = mutableListOf<Out>()
        // 도착 원 안에서 뺐으면 (3분을 못 채웠어도) 주차로 본다
        tryStamp("DISCONNECT", atMs)?.let { out += Out.Stamp(it) }
        phase = Phase.OUT
        stoppedSinceMs = null
        out += Out.Left
        return out
    }

    // ------------------------------------------------------------ 신호

    fun speed(kmh: Float, atMs: Long): List<Out> {
        if (phase == Phase.IDLE || phase == Phase.OUT) return emptyList()
        return if (kmh >= MOVE_KMH) {
            if (phase == Phase.DRIVING) return emptyList()
            // 판정한 곳에서 다시 출발 → 새 구간
            if (attemptedThisStop) startLeg()
            attemptedThisStop = false
            phase = Phase.DRIVING
            movedThisLeg = true
            stoppedSinceMs = null
            listOf(Out.Moving)
        } else if (kmh <= STOP_KMH) {
            if (phase == Phase.DRIVING) { phase = Phase.STOPPED; stoppedSinceMs = atMs }
            tick(atMs)
        } else emptyList()
    }

    fun mileage(km: Double) {
        odoNow = km
        if (odoStart == null && phase != Phase.IDLE) odoStart = km
    }

    /** GPS 한 점. 정확도가 나쁘거나 순간이동(시속 180km 넘음)이면 궤적에 넣지 않는다 (위치 위조 방지) */
    fun location(at: LatLng, accuracyM: Float, atMs: Long): List<Out> {
        val prev = lastAccepted
        if (accuracyM > MAX_ACCURACY_M) return emptyList()
        if (prev != null) {
            val km = Geo.km(prev, at)
            val hours = (atMs - hereAtMs).coerceAtLeast(1) / 3_600_000.0
            if (km / hours > MAX_JUMP_KMH && km > 0.2) {
                here = at // 지금 위치는 믿되 궤적은 늘리지 않는다
                hereAtMs = atMs
                lastAccepted = at
                return emptyList()
            }
            if (km * 1000 < maxOf(accuracyM.toDouble(), MIN_STEP_M)) { here = at; return emptyList() }
            if (phase == Phase.DRIVING || phase == Phase.STOPPED) gpsPathKm += km
        }
        lastAccepted = at
        here = at
        hereAtMs = atMs
        if (legStart == null && phase != Phase.IDLE) legStart = at
        if (gpsPathKm >= 0.3) movedThisLeg = true
        return emptyList()
    }

    /** 몇 초마다. 3분 정차를 본다 */
    fun tick(atMs: Long): List<Out> {
        val since = stoppedSinceMs ?: return emptyList()
        if (phase != Phase.STOPPED || attemptedThisStop || !movedThisLeg) return emptyList()
        if (atMs - since < PARK_HOLD_MS) return emptyList()
        val a = tryStamp("STOP_3MIN", atMs)
        attemptedThisStop = true
        return if (a != null) listOf(Out.Parked(a.place), Out.Stamp(a)) else listOf(Out.Parked(null))
    }

    // ------------------------------------------------------------ 판정

    /** 지금 도착 원 안의 도장 장소 또는 오늘 코스의 바깥 장소('ext:…', 도장 대신 '다녀옴') (가장 가까운 원) */
    fun placeHere(): Place? {
        val h = here ?: return null
        return places().filter { it.stampable || it.id.startsWith("ext:") }
            .mapNotNull { p -> p.arrivalDistanceM(h)?.let { p to it } }
            .minByOrNull { it.second }?.first
    }

    private fun tryStamp(reason: String, atMs: Long): Attempt? {
        if (attemptedThisStop || !movedThisLeg) return null
        val place = placeHere() ?: return null
        val start = legStart ?: return null
        val already = stampedToday(place.id)
        val o0 = odoStart
        val o1 = odoNow
        val hasOdo = o0 != null && o1 != null && o1 > o0
        val verdict = if (hasOdo) {
            StampVerifier.verify(start, place, o0, o1, null, already, gpsPathKm)
        } else {
            // 주행거리 신호 없음: GPS 궤적 길이를 늘어난 거리로 (폰 인증)
            StampVerifier.verify(start, place, 0.0, gpsPathKm, null, already, gpsPathKm)
        }
        val a = Attempt(
            place = place, verdict = verdict, source = if (hasOdo) "odometer" else "phone",
            odoKm = if (hasOdo) o1!! - o0!! else null, gpsPathKm = gpsPathKm,
            straightKm = Geo.km(start, place.at), reason = reason, atMs = atMs, fromPlaceId = legFromPlaceId,
        )
        attemptedThisStop = true
        lastAttempt = a
        return a
    }

    /** 판정한 곳에서 새 구간 시작 */
    private fun startLeg() {
        legFromPlaceId = lastAttempt?.place?.id
        legStart = here
        odoStart = odoNow
        gpsPathKm = 0.0
        movedThisLeg = false
    }

    companion object {
        const val MOVE_KMH = 8f
        const val STOP_KMH = 3f
        const val PARK_HOLD_MS = 3 * 60_000L
        const val MAX_ACCURACY_M = 60f
        const val MAX_JUMP_KMH = 180.0
        const val MIN_STEP_M = 15.0
    }
}
