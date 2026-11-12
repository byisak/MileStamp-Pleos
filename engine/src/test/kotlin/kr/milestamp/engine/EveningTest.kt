package kr.milestamp.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 저녁 나들이 도우미 · 조건 도장 '밤' (서버 web/src/lib/arrive.test.ts와 같은 값). 계획 자체는 plan-cases.json '저녁 ·' 사례. */
class EveningTest {
    private val p = Place("x", "x", LatLng(35.9, 128.6), dwellP80Min = 40, openMin = 0, closeMin = 24 * 60)

    @Test
    fun `희귀 밤 - 해 진 뒤 밤 명소만, 비가 먼저`() {
        val night = p.copy(moments = Moments(best = setOf("night")))
        assertEquals(RareStamp.NIGHT, RareStamp.of(night, Sky.CLEAR, 1100, 1045))
        assertEquals(RareStamp.NIGHT, RareStamp.of(p.copy(tags = setOf("야경")), Sky.UNKNOWN, 1100, 1045))
        assertEquals(RareStamp.RAIN, RareStamp.of(night, Sky.RAIN, 1100, 1045))
        assertNull(RareStamp.of(night, Sky.CLEAR, 1000, 1045))
        assertNull(RareStamp.of(night, Sky.CLEAR, 1100, null))
        assertNull(RareStamp.of(p, Sky.CLEAR, 1100, 1045))
        assertNull(RareStamp.of(night.copy(festival = FestivalInfo("f", "2026-01-01", "2026-12-31")), Sky.RAIN, 1100, 1045))
    }

    @Test
    fun `시각 글 조명 시각 저녁 모드 경계`() {
        assertEquals("7시", Planner.hourText(19 * 60))
        assertEquals("7시 반", Planner.hourText(19 * 60 + 30))
        assertEquals("12시 5분", Planner.hourText(12 * 60 + 5))
        assertEquals(1060, Moments(lightOn = "sunset+15").lightOnMin(1045))
        assertEquals(1035, Moments(lightOn = "sunset-10").lightOnMin(1045))
        assertEquals(1110, Moments(lightOn = "18:30").lightOnMin(null))
        assertNull(Moments(lightOn = "sunset").lightOnMin(null))
        val kids = FamilyProfile(home = LatLng(35.88, 128.58))
        val sky = SkyToday(420, 17 * 60 + 25, Sky.CLEAR)
        assertFalse(Planner.isEvening(17 * 60 + 24, kids, sky))
        assertTrue(Planner.isEvening(17 * 60 + 25, kids, sky))
        assertTrue(Planner.isEvening(19 * 60 + 30, kids, sky))
        assertFalse(Planner.isEvening(19 * 60 + 31, kids, sky))
        assertTrue(Planner.isNight(19 * 60 + 31, kids, sky))
        val couple = kids.copy(companion = GoWith.COUPLE)
        assertFalse(Planner.isNight(21 * 60 + 30, couple, sky))
        assertTrue(Planner.isNight(21 * 60 + 31, couple, sky))
        assertFalse(Planner.isNight(21 * 60 + 31, couple.copy(lateReturnMin = 24 * 60 - 1), sky))
    }

    @Test
    fun `드라이브 길은 어른끼리만 저녁 후보`() {
        val drive = p.copy(kind = "drive", route = DriveRoute(listOf(LatLng(35.83, 128.58), LatLng(35.82, 128.61)), 30))
        assertTrue(drive.isDrive)
        assertFalse(Planner.eveningCandidate(drive, GoWith.KIDS))
        assertTrue(Planner.eveningCandidate(drive, GoWith.COUPLE))
        assertEquals(30, Planner.eveningDwell(drive, FamilyProfile(home = LatLng(35.88, 128.58)), cold = false))
    }
}
