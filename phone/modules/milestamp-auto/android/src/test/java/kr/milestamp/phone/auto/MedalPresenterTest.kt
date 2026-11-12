package kr.milestamp.phone.auto

import kr.milestamp.phone.auto.MedalPresenter.Action
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 주행 중 → 알림 한 줄만 → 멈추고 5초 → 메달 화면 */
class MedalPresenterTest {
    private val m = TestMedals.normal

    @Test fun 정차_중이면_바로_큰_화면() {
        val p = MedalPresenter<MedalInfo>()
        p.speed(0f, 0)
        assertEquals(Action.Show(m), p.stamp(m, 1_000))
        assertNull(p.pending)
    }

    @Test fun 주행_중이면_알림만_멈추고_5초_뒤_큰_화면() {
        val p = MedalPresenter<MedalInfo>()
        p.speed(40f, 0)
        assertEquals(Action.Alert(m), p.stamp(m, 1_000))
        assertEquals(m, p.pending)
        assertNull(p.tick(3_000)) // 아직 달리는 중
        assertNull(p.speed(20f, 4_000))
        assertNull(p.speed(0.5f, 10_000)) // 멈춤 시작
        assertNull(p.tick(13_000)) // 3초 — 아직
        assertNull(p.speed(5f, 13_500)) // 천천히 (3~8 km/h: 그대로)
        assertEquals(Action.Show(m), p.tick(15_100)) // 5초 넘음
        assertNull(p.pending)
        assertNull(p.tick(20_000)) // 한 번만
    }

    @Test fun 신호에서_잠깐_멈췄다_출발하면_계속_미룸() {
        val p = MedalPresenter<MedalInfo>()
        p.speed(50f, 0)
        p.stamp(m, 100)
        p.speed(0f, 1_000)
        assertNull(p.tick(4_000))
        p.speed(30f, 4_500) // 다시 출발
        assertNull(p.tick(9_000))
        assertEquals(m, p.pending)
    }

    @Test fun 차_화면이_다시_보이면() {
        val p = MedalPresenter<MedalInfo>()
        p.speed(50f, 0)
        p.stamp(m, 100)
        assertNull(p.resumed(2_000)) // 달리는 중에는 안 띄움
        p.disconnected() // 내렸다가
        assertEquals(Action.Show(m), p.resumed(60_000)) // 다시 타면 (세션 재개)
    }

    @Test fun 차_화면_없을_때_쥐고_있다가_다음_연결에서_오래되면_버림() {
        val p = MedalPresenter<MedalInfo>()
        p.hold(m, 0)
        assertEquals(Action.Show(m), p.resumed(1_000))
        p.hold(m, 0)
        assertNull(p.resumed(MedalPresenter.MAX_HOLD_MS + 1))
    }
}
