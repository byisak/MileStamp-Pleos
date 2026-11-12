package kr.milestamp.car.audio

import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * 소개 음성을 시스템 미디어로 노출 → 운전석 화면 음악 칸·운전대 버튼(재생/멈춤)과 연결.
 * 자동 재생 금지 규정: 사용자가 연결만 해도 저절로 재생되지 않는다(재생은 엔진의 도착 판정 때만).
 */
class IntroPlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        session = MediaSession.Builder(this, IntroPlayerHolder.get(this)).setId("milestamp-intro").build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: android.content.Intent?) {
        IntroPlayerHolder.peek()?.stop()
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        session?.release()
        session = null
        super.onDestroy()
    }
}
