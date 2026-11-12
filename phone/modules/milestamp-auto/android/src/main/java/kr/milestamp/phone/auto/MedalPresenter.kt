package kr.milestamp.phone.auto

/**
 * 도장 메달을 언제 크게 보여 줄지 (안드로이드에 의존하지 않음 — JVM 단위 시험).
 *  - 주행 중이면 알림 한 줄만([Action.Alert]) 띄우고 메달은 쥐고 있다가
 *  - 멈춘 지 5초(속도 ≈ 0)가 지나거나 차 화면이 다시 보이면(세션 재개) 큰 화면([Action.Show])
 *  - 정차 중이면 바로 큰 화면
 * 오래된 메달(6시간 넘음 — 다음 나들이)은 버린다. 같은 시점에 둘 이상이면 마지막 것만 (화면 단계 제한).
 */
class MedalPresenter<T> {
    sealed interface Action<T> {
        data class Alert<T>(val medal: T) : Action<T>
        data class Show<T>(val medal: T) : Action<T>
    }

    var pending: T? = null; private set
    private var pendingAtMs = 0L
    private var driving = false
    private var stoppedSinceMs: Long? = null

    /** 판정 어댑터가 본 주행 상태 + 속도 (km/h) */
    fun speed(kmh: Float, atMs: Long): Action<T>? {
        if (kmh >= AutoTripDetector.MOVE_KMH) { driving = true; stoppedSinceMs = null; return null }
        if (kmh <= AutoTripDetector.STOP_KMH) {
            if (stoppedSinceMs == null) stoppedSinceMs = atMs
            return tick(atMs)
        }
        return null
    }

    /** 주행 상태를 바로 알려 줄 때 (판정 어댑터 단계: DRIVING 이면 true) */
    fun setDriving(on: Boolean, atMs: Long) {
        if (on) { driving = true; stoppedSinceMs = null } else if (stoppedSinceMs == null) stoppedSinceMs = atMs
    }

    /** 차 연결이 끊김 (내림) — 다음 연결은 멈춘 상태로 시작 */
    fun disconnected() { driving = false; stoppedSinceMs = null }

    /** 새 도장 */
    fun stamp(m: T, atMs: Long): Action<T> {
        if (driving) {
            pending = m
            pendingAtMs = atMs
            return Action.Alert(m)
        }
        pending = null
        return Action.Show(m)
    }

    /** 보여 줄 곳(차 화면)이 없을 때: 쥐고 있다가 다음 연결(세션)에서 */
    fun hold(m: T, atMs: Long) { pending = m; pendingAtMs = atMs }

    /** 몇 초마다: 멈춘 지 5초가 지났으면 쥐고 있던 메달을 보여 준다 */
    fun tick(atMs: Long): Action<T>? {
        expire(atMs)
        val since = stoppedSinceMs ?: return null
        if (atMs - since < PARKED_MS) return null
        driving = false
        return take()
    }

    /** 차 화면이 다시 보임 (세션 재개·새 연결). 주행 중이 아니면 쥐고 있던 메달 */
    fun resumed(atMs: Long): Action<T>? {
        expire(atMs)
        if (driving && (stoppedSinceMs == null || atMs - stoppedSinceMs!! < PARKED_MS)) return null
        return take()
    }

    private fun take(): Action<T>? {
        val m = pending ?: return null
        pending = null
        return Action.Show(m)
    }

    private fun expire(atMs: Long) {
        if (pending != null && atMs - pendingAtMs > MAX_HOLD_MS) pending = null
    }

    companion object {
        const val PARKED_MS = 5_000L
        const val MAX_HOLD_MS = 6 * 3_600_000L
    }
}
