package kr.milestamp.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 기간 한정 축제 (docs/축제-안드로이드오토-계획.md ①): 기간 안에만 추천·도장, 붙은 명소 대신 추천, 점수 + 가중치,
 * 기간 안 축제 원에서 주차하면 한정 도장(축제마다 한 번).
 * 추천 결과의 한 글자 비교는 plan-cases.json '축제 ·' 사례 (서버 planner.ts와 같이).
 */
class FestivalTest {
    private val S = SeedPlaces
    /** 하중도에 붙은 코스모스 축제 (도착 원 = 하중도 대표 좌표). */
    private val HAJUNGDO = S.ALL.first { it.id == "hajungdo" }
    private val cosmos = HAJUNGDO.copy(
        id = "fest-cosmos", name = "금호꽃섬 코스모스 축제", dwellP80Min = 60,
        festival = FestivalInfo("fest-cosmos", "2026-10-24", "2026-11-01", FestivalInfo.WEIGHT_STRONG, placeId = "hajungdo"),
    )

    @Test
    fun `기간 첫날·마지막 날은 열리고 다음 날·날짜 모름은 닫힘`() {
        val f = cosmos.festival!!
        assertTrue(f.runsOn("2026-10-24"))
        assertTrue(f.runsOn("2026-11-01"))
        assertFalse(f.runsOn("2026-10-23"))
        assertFalse(f.runsOn("2026-11-02"))
        assertFalse(f.runsOn(null))
        assertFalse(f.runsOn("어제"))
        assertEquals("11/1", f.endsText)
        // 쉬는 요일: 2026-10-26은 월요일
        assertFalse(f.copy(closedDays = listOf(1)).runsOn("2026-10-26"))
        assertTrue(f.copy(closedDays = listOf(1)).runsOn("2026-10-27"))
    }

    @Test
    fun `열리는 날엔 붙은 명소 대신 축제, 아닌 날엔 명소 그대로`() {
        val cands = S.ALL + cosmos
        val on = Planner.forDay(cands, "2026-10-31").map { it.id }
        assertTrue("fest-cosmos" in on)
        assertFalse("hajungdo" in on)
        val off = Planner.forDay(cands, "2026-11-02").map { it.id }
        assertFalse("fest-cosmos" in off)
        assertTrue("hajungdo" in off)
    }

    @Test
    fun `가중치만큼 점수가 올라 순위가 바뀐다`() {
        val here = S.ALL.first { it.id == "chimsan" }.at
        val cands = S.ALL.filter { it.id in setOf("hajungdo", "unamji", "samsung", "aquarium") }
        fun first(fest: Place?) = Planner.reboard(13 * 60 + 10, here, S.demoProfile(), cands + listOfNotNull(fest), null, "2026-10-31")
            .options.first().stops.first().id
        // 축제가 없으면 아쿠아리움이 1순위, 같은 자리 축제(강하게)가 붙으면 축제가 1순위
        assertEquals("aquarium", first(null))
        assertEquals("fest-cosmos", first(cosmos))
        val chip = Planner.reboard(13 * 60 + 10, here, S.demoProfile(), cands + cosmos, null, "2026-10-31").options.first().reasons.first()
        assertEquals(Reason("이번 주말만 · 11/1까지", Tone.FESTIVAL), chip)
    }

    /** 집 → (시계·날짜) → 출발 → 하중도 원 안 주차. */
    private fun parkAtHajungdo(engine: TripEngine, day: String): List<Effect> {
        val d = DayDriver(engine)
        d.at(S.DEMO_HOME); d.gear(Gear.PARK); d.speed(0); d.odoAdd(0); d.weather(Sky.CLEAR)
        engine.handle(SignalEvent.Clock(hhmm("08:29"), d.nowMs, day))
        d.wait(2)
        d.clock("08:30"); d.seats(2); d.wait(6)
        d.drive(60); d.drain()
        d.parkAt(HAJUNGDO, 4)
        return d.drain()
    }

    @Test
    fun `기간 안 축제 원에서 주차하면 명소 도장 + 한정 도장`() {
        val engine = TripEngine(S.demoProfile(), S.ALL + cosmos)
        val got = parkAtHajungdo(engine, "2026-10-31").filterIsInstance<Effect.StampGranted>()
        assertEquals(listOf("hajungdo", "fest-cosmos"), got.map { it.place.id })
        val fest = got.last()
        assertEquals("fest-cosmos", fest.place.festival?.id)
        assertNull(fest.rare)
        assertEquals(engine.profile.stampsBefore + 2, fest.number)
    }

    @Test
    fun `기간 밖이면 명소 도장만`() {
        val got = parkAtHajungdo(TripEngine(S.demoProfile(), S.ALL + cosmos), "2026-11-02").filterIsInstance<Effect.StampGranted>()
        assertEquals(listOf("hajungdo"), got.map { it.place.id })
    }

    @Test
    fun `같은 축제는 한 번만 (올해 이미 받았으면 없음)`() {
        val engine = TripEngine(S.demoProfile(), S.ALL + cosmos)
        engine.setFestivalStamps(listOf("fest-cosmos"))
        val got = parkAtHajungdo(engine, "2026-10-31").filterIsInstance<Effect.StampGranted>()
        assertEquals(listOf("hajungdo"), got.map { it.place.id })
    }

    @Test
    fun `새 위치 축제 (명소 없음)는 축제 도장만`() {
        val alone = cosmos.copy(id = "fest-alone", at = LatLng(35.95, 128.62), points = listOf(Arrival(LatLng(35.95, 128.62), 400)),
            festival = cosmos.festival!!.copy(id = "fest-alone", placeId = null))
        val engine = TripEngine(S.demoProfile(), S.ALL + alone)
        val d = DayDriver(engine)
        d.at(S.DEMO_HOME); d.gear(Gear.PARK); d.speed(0); d.odoAdd(0); d.weather(Sky.RAIN)
        engine.handle(SignalEvent.Clock(hhmm("08:29"), d.nowMs, "2026-10-25"))
        d.wait(2)
        d.clock("08:30"); d.seats(2); d.wait(6)
        d.drive(60); d.drain()
        d.odoAdd(10); d.at(LatLng(35.9505, 128.6202)); d.speed(0); d.wait(1); d.gear(Gear.PARK); d.wait(4)
        val got = d.drain().filterIsInstance<Effect.StampGranted>()
        assertEquals(listOf("fest-alone"), got.map { it.place.id })
        assertNull("축제 도장엔 '비 오는 날' 희귀를 붙이지 않는다", got.first().rare)
    }
}
