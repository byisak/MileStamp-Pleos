package kr.milestamp.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 바깥 장소(코스에만 있는 'ext:tour:…' — 장소 목록 밖, 도장 없음)가 낀 코스 (docs/직접-고르기-계획.md 6절·C단계).
 * 도착 원(300m) 안에 서면 코스에는 도착으로 반영되고, 도장·메달 대신 [Effect.Visited] 한 번.
 */
class ExtStopTripTest {
    private val ext = Place(
        id = "ext:tour:126508", name = "동화사", at = LatLng(35.9934, 128.6997),
        radiusM = 300, dwellP80Min = 90, kidFit = 0.6, openMin = 9 * 60, closeMin = 18 * 60, stampable = false,
    )

    private fun boarded(): DayDriver {
        val d = DayDriver()
        val S = SeedPlaces
        d.at(S.DEMO_HOME); d.gear(Gear.PARK); d.speed(0); d.odoAdd(0); d.weather(Sky.CLEAR); d.clock("08:30"); d.seats(2); d.wait(6)
        val morning = d.drain().filterIsInstance<Effect.ShowPlan>().single().plan
        val anchored = Planner.course(hhmm("08:30"), S.DEMO_HOME, S.demoProfile(), listOf(ext, S.WEATHER), morning.sky, label = "동화사 중심으로", lenient = true, anchorId = ext.id)!!
        d.engine.handle(SignalEvent.ServerPlan(morning.copy(options = listOf(anchored) + morning.options.take(2)), 0, "아빠 폰", d.nowMs))
        d.tapBest(); d.drain()
        return d
    }

    @Test
    fun `바깥 장소에 서면 도장 없이 다녀옴 한 번, 코스는 도착`() {
        val d = boarded()
        assertEquals(listOf(ext.id, "weather"), d.engine.liveCourse!!.remaining.map { it.id })
        d.drive(60); d.clock("09:10"); d.parkAt(ext, odoKm = 22)
        val fx = d.drain()
        assertTrue("도장 없음: $fx", fx.none { it is Effect.StampGranted || it is Effect.StampHeld })
        assertEquals(listOf(ext.id), fx.filterIsInstance<Effect.Visited>().map { it.place.id })
        val c = fx.filterIsInstance<Effect.CourseUpdated>().last().course
        assertEquals(StopStatus.ARRIVED, c.stops.first { it.id == ext.id }.status)
        assertEquals("weather", c.next!!.id)

        // 같은 곳에서 다시 서도 '다녀옴'은 하루 한 번
        d.drive(10); d.parkAt(ext, odoKm = 0)
        assertTrue(d.drain().none { it is Effect.Visited })
    }

    @Test
    fun `바깥 장소 밖(코스에 없는 곳)에 서면 다녀옴 없음`() {
        val d = boarded()
        d.drive(60); d.clock("09:10")
        val far = Place("x", "길가", LatLng(35.95, 128.65))
        d.parkAt(far, odoKm = 15)
        assertTrue(d.drain().none { it is Effect.Visited })
    }

    @Test
    fun `바깥 장소 이름은 코스에서 — 날 id를 보이지 않는다`() {
        val d = boarded()
        val c = d.engine.liveCourse!!
        val eng = LiveCourseEngine(SeedPlaces.demoProfile(), SeedPlaces.ALL)
        // 보류 칩 등 사건 이름: 장소 목록 밖이어도 코스에 실린 이름
        assertEquals("동화사 들르기", eng.describe(CourseEvent.Insert(600, ext.id), c))
        assertEquals("다음은 동화사", eng.describe(CourseEvent.ReplaceNext(600, ext.id), c))
        // 코스에도 없으면 id 대신 '고른 곳'
        assertEquals("고른 곳 빼기", eng.describe(CourseEvent.Skip(600, "ext:tour:126019")))
        assertEquals("고른 곳", stopName("ext:tour:126019"))
        assertEquals("경주월드", stopName("ext:tour:1", " 경주월드 "))
        assertEquals("weather", stopName("weather"))

        // 코스에 있던 바깥 장소는 빼고 다시 들르기·다음으로 바꾸기가 된다 (장소 목록 밖이어도)
        val skipped = eng.apply(c, CourseEvent.Skip(hhmm("08:40"), ext.id)).course
        assertEquals(StopStatus.SKIPPED, skipped.stops.first { it.id == ext.id }.status)
        val back = eng.apply(skipped, CourseEvent.ReplaceNext(hhmm("08:41"), ext.id))
        assertEquals(ext.id, back.course.next!!.id)
        assertEquals("동화사", back.course.next!!.place.name)
        assertTrue(back.change!!.text, back.change!!.text.contains("동화사"))
    }

    @Test
    fun `폰이 코스를 취소하면 아직 다녀온 곳이 없을 때만 차 코스도 없앤다`() {
        val d = boarded()
        assertTrue(d.engine.liveCourse != null)
        val fx = d.engine.handle(SignalEvent.CourseCancelled(d.nowMs))
        assertEquals(null, d.engine.liveCourse)
        assertTrue(fx.any { it is Effect.ShowDrivingChip })

        // 다녀온 곳이 있으면 그대로 (폰은 '오늘 코스 마치기'를 보낸다)
        val e = boarded()
        e.drive(60); e.clock("09:10"); e.parkAt(ext, odoKm = 22); e.drain()
        e.engine.handle(SignalEvent.CourseCancelled(e.nowMs))
        assertTrue(e.engine.liveCourse != null)
    }
}
