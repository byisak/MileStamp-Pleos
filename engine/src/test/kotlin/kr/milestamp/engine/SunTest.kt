package kr.milestamp.engine

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SunTest {
    private val daegu = LatLng(35.8714, 128.6014)

    @Test
    fun `대구 2026-10-31 해 뜨고 지는 시각`() {
        // 다른 공식(미 해군천문대 USNO 간이식)으로 따로 계산한 값: 해 뜸 06:46, 해 짐 17:32 (±3분).
        // 대구(동경 128.6도)의 이날 남중은 약 12:09 (균시차 +16분) → 해 뜸·짐의 가운데가 12:09 근처여야 한다.
        // (처음 받은 기준값 06:54 / 17:41은 가운데가 12:17이라 대구 값이 아닌 듯 — 천문연 API로 다시 확인할 것)
        val rs = Sun.riseSet(daegu, LocalDate.of(2026, 10, 31))!!
        assertEquals(hhmm("06:46").toDouble(), rs.sunriseMin.toDouble(), 3.0)
        assertEquals(hhmm("17:32").toDouble(), rs.sunsetMin.toDouble(), 3.0)
        assertEquals(hhmm("12:09").toDouble(), (rs.sunriseMin + rs.sunsetMin) / 2.0, 2.0)
    }

    @Test
    fun `여름이 겨울보다 해가 길다`() {
        val june = Sun.riseSet(daegu, LocalDate.of(2026, 6, 21))!!
        val dec = Sun.riseSet(daegu, LocalDate.of(2026, 12, 21))!!
        // USNO 간이식: 하지 05:09 / 19:45, 동지 07:32 / 17:15
        assertEquals(hhmm("05:09").toDouble(), june.sunriseMin.toDouble(), 3.0)
        assertEquals(hhmm("19:45").toDouble(), june.sunsetMin.toDouble(), 3.0)
        assertEquals(hhmm("07:32").toDouble(), dec.sunriseMin.toDouble(), 3.0)
        assertEquals(hhmm("17:15").toDouble(), dec.sunsetMin.toDouble(), 3.0)
    }

    @Test
    fun `극지방 백야는 null`() {
        assertNull(Sun.riseSet(LatLng(78.2, 15.6), LocalDate.of(2026, 6, 21)))
    }

    @Test
    fun `귀가 한계 - 해 지기 30분 전, 해를 모르면 17시30분`() {
        val fam = FamilyProfile(home = daegu)
        assertEquals(hhmm("17:11"), fam.backByMin(SkyToday(hhmm("06:54"), hhmm("17:41"))))
        assertEquals(hhmm("17:30"), fam.backByMin(null))
        assertEquals(hhmm("17:30"), fam.backByMin(SkyToday(sky = Sky.RAIN)))
        assertEquals(hhmm("16:00"), fam.copy(backBy = BackBy.At(hhmm("16:00"))).backByMin(SkyToday(hhmm("06:54"), hhmm("17:41"))))
        // 오후 모드만 저녁 시각과 비교
        val sky = SkyToday(hhmm("06:54"), hhmm("19:41"))
        assertEquals(hhmm("18:30"), Planner.limitMin(PlanMode.AFTERNOON, fam, sky))
        assertEquals(hhmm("19:11"), Planner.limitMin(PlanMode.MORNING, fam, sky))
    }
}
