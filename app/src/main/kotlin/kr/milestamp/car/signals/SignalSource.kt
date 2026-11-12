package kr.milestamp.car.signals

import android.os.SystemClock
import kr.milestamp.engine.SignalEvent

/**
 * 차량·내비·위치 신호를 엔진 신호로 바꿔 넘기는 공통 틀.
 * 모든 입력은 '변할 때만' 들어온다(계속 묻는 방식 금지: 주행 중 CPU 5% 미만 기준).
 */
interface SignalSource {
    val name: String
    fun start(emit: (SignalEvent) -> Unit)
    fun stop()
}

internal fun now(): Long = SystemClock.elapsedRealtime()

/** 연결 상태를 화면·로그에 보여주기 위한 값. */
data class SourceStatus(val name: String, val ok: Boolean, val detail: String)
