package kr.milestamp.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 도착 지점 여러 개 (관리자 화면의 원들): 어느 원 안에서든 P단이면 그 장소 도장. */
class ArrivalPointsTest {
    private val S = SeedPlaces
    /** 석굴 정문에서 북동쪽 약 1.1km — 정문 원(300m) 밖. */
    private val rear = LatLng(S.SEOKGUL.at.lat + 0.008, S.SEOKGUL.at.lng + 0.008)

    @Test
    fun `원이 없으면 대표 좌표와 반경 하나`() {
        val p = S.SEOKGUL
        assertEquals(listOf(Arrival(p.at, p.radiusM)), p.arrivals)
        assertTrue(p.contains(p.at))
        assertFalse(p.contains(rear))
    }

    @Test
    fun `여러 원 중 하나에만 들어도 도착`() {
        val p = S.SEOKGUL.copy(points = listOf(Arrival(S.SEOKGUL.at, 300, "정문"), Arrival(rear, 200, "후문 주차장")))
        assertTrue(p.contains(S.SEOKGUL.at))
        assertTrue(p.contains(rear))
        assertTrue(p.contains(LatLng(rear.lat + 0.001, rear.lng))) // 약 110m
        assertFalse(p.contains(LatLng(rear.lat + 0.003, rear.lng))) // 약 330m
        assertNull(p.arrivalDistanceM(LatLng(S.SEOKGUL.at.lat + 0.004, S.SEOKGUL.at.lng + 0.004))) // 두 원 사이
    }

    private fun parkAtRear(catalog: List<Place>): List<Effect> {
        val d = DayDriver(TripEngine(S.demoProfile(), catalog))
        d.at(S.DEMO_HOME); d.gear(Gear.PARK); d.speed(0); d.odoAdd(0); d.weather(Sky.CLEAR); d.clock("08:29")
        d.wait(2)
        d.clock("08:30"); d.seats(2); d.wait(6)
        d.drive(60); d.drain()
        d.odoAdd(35)
        d.at(rear); d.speed(0); d.wait(1); d.gear(Gear.PARK); d.wait(4)
        return d.drain()
    }

    @Test
    fun `후문 주차장 원에서 주차하면 석굴 도장`() {
        val multi = S.SEOKGUL.copy(points = listOf(Arrival(S.SEOKGUL.at, 300, "정문"), Arrival(rear, 250, "후문 주차장")))
        val got = parkAtRear(S.ALL.map { if (it.id == multi.id) multi else it }).filterIsInstance<Effect.StampGranted>()
        assertEquals(1, got.size)
        assertEquals("seokgul", got.first().place.id)
        // 원이 하나뿐이면 같은 자리에서 도장이 없다
        assertTrue(parkAtRear(S.ALL).none { it is Effect.StampGranted })
    }
}
