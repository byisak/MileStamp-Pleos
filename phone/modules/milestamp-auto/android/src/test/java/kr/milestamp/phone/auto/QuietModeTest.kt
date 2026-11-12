package kr.milestamp.phone.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 쉿 모드: 자동이면 낮잠 20분 전 ~ 낮잠 끝 (엔진 TimeBudget.quietByDefault와 같음) */
class QuietModeTest {
    private fun m(h: Int, mm: Int) = h * 60 + mm

    @Test fun 자동_낮잠_창() {
        // 13:00부터 90분 → 12:40 ~ 14:30
        val q = { now: Int -> QuietRule.quiet(QuietMode.AUTO, m(13, 0), 90, now) }
        assertFalse(q(m(12, 39)))
        assertTrue(q(m(12, 40)))
        assertTrue(q(m(13, 45)))
        assertTrue(q(m(14, 30)))
        assertFalse(q(m(14, 31)))
        assertFalse(q(m(9, 0)))
    }

    @Test fun 낮잠_없는_가족은_자동이면_늘_꺼짐() {
        for (now in listOf(m(0, 0), m(12, 50), m(13, 30), m(23, 59))) {
            assertFalse(QuietRule.quiet(QuietMode.AUTO, null, null, now))
            assertFalse(QuietRule.quiet(QuietMode.AUTO, m(13, 0), null, now))
            assertFalse(QuietRule.quiet(QuietMode.AUTO, m(13, 0), 0, now))
        }
    }

    @Test fun 켜기_끄기는_시각과_상관없음() {
        assertTrue(QuietRule.quiet(QuietMode.ON, null, null, m(9, 0)))
        assertTrue(QuietRule.quiet(QuietMode.ON, m(13, 0), 90, m(9, 0)))
        assertFalse(QuietRule.quiet(QuietMode.OFF, m(13, 0), 90, m(13, 30)))
    }

    @Test fun 고름_글자() {
        assertEquals(QuietMode.AUTO, QuietMode.of(null))
        assertEquals(QuietMode.AUTO, QuietMode.of("이상함"))
        assertEquals(QuietMode.ON, QuietMode.of("on"))
        assertEquals(QuietMode.OFF, QuietMode.of("off"))
    }
}
