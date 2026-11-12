package kr.milestamp.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RulesTest {
    private val profile = SeedPlaces.demoProfile()

    @Test
    fun `시간 여유 공식은 기획서 예시와 같다`() {
        // 16:10, 집까지 33분 → B = 17:30 − 16:10 − 33 − 10 = 37
        assertEquals(37, TimeBudget.availableMin(hhmm("16:10"), hhmm("17:30"), 33))
        // Δ = 20 + 25 − 33 = 12, 12 + 25 ≤ 37
        val d = TimeBudget.detourMin(20, 25, 33)
        assertEquals(12, d)
        assertTrue(TimeBudget.fits(d, 25, 37))
        assertFalse(TimeBudget.fits(d, 26, 37))
    }

    @Test
    fun `낮잠 맞춤과 쉿 모드`() {
        // 낮잠 13:00~14:30 (90분): 12:40~13:10 출발 + 이동 63~99분
        assertTrue(TimeBudget.napAligned(hhmm("12:50"), 80, profile))
        assertFalse(TimeBudget.napAligned(hhmm("12:50"), 40, profile))
        assertFalse(TimeBudget.napAligned(hhmm("11:30"), 80, profile))
        assertTrue(TimeBudget.quietByDefault(hhmm("12:55"), profile))
        assertFalse(TimeBudget.quietByDefault(hhmm("16:10"), profile))
    }

    @Test
    fun `도착 전 소개 길이`() {
        assertEquals(IntroVariant.FULL_60S, IntroPicker.pick(150, quiet = false))
        assertEquals(IntroVariant.KIDS_30S, IntroPicker.pick(80, quiet = false))
        assertEquals(IntroVariant.PHONE_ONLY, IntroPicker.pick(50, quiet = false))
        assertEquals(IntroVariant.PHONE_ONLY, IntroPicker.pick(150, quiet = true))
    }

    @Test
    fun `도장 검증 범위`() {
        val home = SeedPlaces.DEMO_HOME
        val p = SeedPlaces.SEOKGUL // 직선 19.2km
        fun v(delta: Double) = StampVerifier.verify(home, p, 1000.0, 1000.0 + delta, null, alreadyToday = false)
        assertTrue(v(25.0) is StampVerdict.Granted)
        assertEquals(HoldReason.ODO_TOO_SHORT, (v(5.0) as StampVerdict.Held).reason)
        assertEquals(HoldReason.ODO_TOO_LONG, (v(90.0) as StampVerdict.Held).reason)
        assertEquals(HoldReason.NO_ODOMETER,
            (StampVerifier.verify(home, p, null, 1000.0, null, false) as StampVerdict.Held).reason)
        assertEquals(HoldReason.ALREADY_TODAY,
            (StampVerifier.verify(home, p, 0.0, 25.0, null, true) as StampVerdict.Held).reason)
    }

    @Test
    fun `도장 검증 - 돌아온 길은 GPS 궤적으로 인정, 위조는 그대로 보류`() {
        val home = SeedPlaces.DEMO_HOME
        val p = SeedPlaces.SEOKGUL // 직선 19.2km, 내비 경로 30km라고 본다 → 경로 상한 65km
        fun v(odo: Double, gps: Double?) = StampVerifier.verify(home, p, 1000.0, 1000.0 + odo, 30.0, false, gpsPathKm = gps)

        // 정직하게 40km 돌아옴: 주행 70km, 궤적 68km → 상한 max(65, 81.2) → 인정. 궤적이 없으면 예전처럼 보류
        val detour = v(70.0, 68.0)
        assertTrue("$detour", detour is StampVerdict.Granted)
        assertEquals(81.2, (detour as StampVerdict.Granted).maxKm, 0.001)
        assertEquals(HoldReason.ODO_TOO_LONG, (v(70.0, null) as StampVerdict.Held).reason)

        // 순간이동: 주행 0.5km. 튀는 위치는 궤적에서 빠져 0km든, 궤적을 꾸며 25km든 하한(16.3km)에 걸림
        assertEquals(HoldReason.ODO_TOO_SHORT, (v(0.5, 0.0) as StampVerdict.Held).reason)
        assertEquals(HoldReason.ODO_TOO_SHORT, (v(0.5, 25.0) as StampVerdict.Held).reason)

        // 궤적 40km인데 주행 120km (+80km 설명 안 됨) → 상한 max(65, 49) = 65 → 보류
        assertEquals(HoldReason.ODO_TOO_LONG, (v(120.0, 40.0) as StampVerdict.Held).reason)

        // 궤적이 직선의 90% 미만(위치가 튀어 빠짐) → 궤적은 안 믿고 경로 상한만: 70km 보류
        assertEquals(HoldReason.ODO_TOO_LONG, (v(70.0, 10.0) as StampVerdict.Held).reason)
    }

    @Test
    fun `비 오는 날 재탑승 추천은 실내 우선`() {
        val plan = Planner.reboard(
            hhmm("16:10"), SeedPlaces.SCIENCE.at, profile,
            listOf(SeedPlaces.THE_ARC, SeedPlaces.HWABON), SkyToday(sky = Sky.RAIN),
        )
        assertEquals("thearc", plan.best!!.stops.single().id)
        assertTrue(plan.best!!.reasonTexts.contains("비 → 실내"))
        assertEquals(OptionKind.GO_HOME, plan.options.last().kind)
    }

    @Test
    fun `여유가 없으면 바로 귀가만 남는다`() {
        val plan = Planner.reboard(
            hhmm("17:00"), SeedPlaces.SCIENCE.at, profile, SeedPlaces.ALL, SkyToday(sky = Sky.CLEAR),
        )
        assertEquals(1, plan.options.size)
        assertEquals(OptionKind.GO_HOME, plan.best!!.kind)
    }
}
