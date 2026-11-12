package kr.milestamp.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 살아 있는 코스가 여행 상태머신(TripEngine)에 붙은 모양: 카드를 고르면 코스가 생기고, 출발·도착은 저절로 반영되며,
 * 주행 중 폰 명령·제안은 다음 정차 때 적용·카드로, 제안 카드를 고르면 코스가 바뀌고 길 안내를 다시 요청한다.
 */
class LiveCourseTripTest {

    /** 08:30 집에서 이야기 코스(석굴 → 테마파크 → 과학관)를 아빠 폰이 고른 상태 (출발 전). */
    private fun boarded(): DayDriver {
        val d = DayDriver()
        val S = SeedPlaces
        d.at(S.DEMO_HOME); d.gear(Gear.PARK); d.speed(0); d.odoAdd(0); d.weather(Sky.CLEAR); d.clock("08:30"); d.seats(2); d.wait(6)
        val morning = d.drain().filterIsInstance<Effect.ShowPlan>().single().plan
        val story = Planner.course(hhmm("08:30"), S.DEMO_HOME, S.demoProfile(), listOf(S.SEOKGUL, S.THEME_PARK, S.SCIENCE), morning.sky)!!
        d.engine.handle(SignalEvent.ServerPlan(morning.copy(options = listOf(story) + morning.options.take(2)), 0, "아빠 폰", d.nowMs))
        d.tapBest(); d.drain()
        return d
    }

    @Test
    fun `카드를 고르면 살아 있는 코스가 생기고 출발·도착이 코스에 반영된다`() {
        val d = boarded()
        val lc = d.engine.liveCourse!!
        assertEquals(listOf("seokgul", "samguk", "dgsm"), lc.remaining.map { it.id })
        assertEquals("아빠 폰", lc.chosenBy)
        assertEquals(hhmm("17:30"), lc.limitMin)
        d.drive(60); d.clock("09:00"); d.parkAt(SeedPlaces.SEOKGUL, odoKm = 34)
        val c = d.drain().filterIsInstance<Effect.CourseUpdated>().last().course
        assertEquals(StopStatus.ARRIVED, c.stops[0].status)
        assertEquals(hhmm("09:00"), c.stops[0].actualArriveMin)
        assertEquals("samguk", c.next!!.id)
    }

    @Test
    fun `주행 중 폰의 빼기 명령은 보류했다가 정차 때 적용하고 길 안내를 다시 요청한다`() {
        val d = boarded()
        d.drive(60); d.drain()
        val fx = d.engine.handle(SignalEvent.CourseCommand(CourseEvent.Skip(hhmm("08:40"), "samguk"), d.nowMs, deferWhileDriving = true))
        val held = fx.filterIsInstance<Effect.CourseUpdated>().single()
        assertEquals("보류", held.change!!.cause)
        assertTrue(held.quiet)
        assertEquals("아직 그대로", listOf("seokgul", "samguk", "dgsm"), d.engine.liveCourse!!.remaining.map { it.id })

        d.clock("09:00"); d.parkAt(SeedPlaces.SEOKGUL, odoKm = 34)
        val fx2 = d.drain()
        assertEquals(StopStatus.SKIPPED, d.engine.liveCourse!!.stops[1].status)
        assertEquals(listOf("dgsm"), fx2.filterIsInstance<Effect.RequestRoute>().last().option.stops.map { it.id })
    }

    @Test
    fun `주행 중 제안은 칩만, 정차하면 카드로, 카드를 고르면 코스가 바뀐다`() {
        val d = boarded()
        d.drive(60); d.drain(); d.clock("08:40")
        // 비가 12:30부터 → 테마파크(야외) 머무름에 걸림 → 실내 교체 제안. 주행 중이라 카드 없음
        val fx = d.engine.handle(SignalEvent.Weather(Sky.CLEAR, false, d.nowMs, rainFromMin = hhmm("12:30")))
        assertTrue(fx.none { it is Effect.CourseProposal })
        val up = fx.filterIsInstance<Effect.CourseUpdated>().single()
        assertTrue("주행 중엔 칩만: ${up.change}", up.quiet && up.change != null)

        d.clock("09:00"); d.parkAt(SeedPlaces.SEOKGUL, odoKm = 34)
        val p = d.drain().filterIsInstance<Effect.CourseProposal>().last()
        val option = p.options.first()
        assertTrue(option.label, option.label.startsWith("삼국유사테마파크 → "))
        assertTrue(option.stops.first().indoor)

        val fx3 = d.engine.handle(SignalEvent.RouteChosen(option, d.nowMs))
        assertEquals(option.stops.map { it.id }, d.engine.liveCourse!!.remaining.map { it.id })
        assertEquals(option.stops.map { it.id }, fx3.filterIsInstance<Effect.RequestRoute>().single().option.stops.map { it.id })
        assertTrue("제안 카드는 서버 계획 고름이 아님", fx3.none { it is Effect.PlanChosen })
    }

    @Test
    fun `집으로 명령 → 남은 곳은 건너뛰고 집으로 길 안내, 출발하면 귀가 중`() {
        val d = boarded()
        d.drive(60); d.drain(); d.clock("09:00"); d.parkAt(SeedPlaces.SEOKGUL, odoKm = 34); d.drain()
        val fx = d.engine.handle(SignalEvent.CourseCommand(CourseEvent.GoHome(hhmm("09:20")), d.nowMs))
        assertEquals(OptionKind.GO_HOME, fx.filterIsInstance<Effect.RequestRoute>().single().option.kind)
        val c = d.engine.liveCourse!!
        assertTrue(c.remaining.isEmpty())
        assertEquals(listOf(StopStatus.DONE, StopStatus.SKIPPED, StopStatus.SKIPPED), c.stops.map { it.status })
        d.clock("09:21"); d.drive(60)
        assertEquals(TripState.HOMEWARD, d.engine.state)
    }

    @Test
    fun `예정 출발이 지나면 5분마다 StillParked, 해 시각이 바뀌면 한계가 바뀐다`() {
        val fam = SeedPlaces.demoProfile().copy(backBy = BackBy.SunsetMinus(30))
        val d = DayDriver(TripEngine(fam, SeedPlaces.ALL))
        d.engine.handle(SignalEvent.Sun(hhmm("06:46"), hhmm("17:32"), 0))
        d.at(SeedPlaces.DEMO_HOME); d.gear(Gear.PARK); d.clock("08:30"); d.seats(2); d.wait(6)
        d.tapBest(); d.drain()
        assertEquals(hhmm("17:02"), d.engine.liveCourse!!.limitMin)
        d.engine.handle(SignalEvent.Sun(hhmm("06:46"), hhmm("17:20"), d.nowMs))
        assertEquals(hhmm("16:50"), d.engine.liveCourse!!.limitMin)

        // 첫 장소에 도착해 예정 출발을 넘기면 StillParked → 시간표가 밀린다
        val first = d.engine.liveCourse!!.next!!.place
        d.drive(60); d.clock("09:30"); d.parkAt(first, odoKm = 30); d.drain()
        val depart = d.engine.liveCourse!!.current!!.plannedDepartMin
        d.clock((depart + 12).asHhmm()); d.wait(1)
        val fx = d.drain()
        assertTrue("정차 중 갱신: $fx", fx.any { it is Effect.CourseUpdated })
        assertEquals(depart + 12, d.engine.liveCourse!!.current!!.plannedDepartMin)
    }

    /** 내렸다가 [at]에 다시 탐 (문 열고 2열 비움 → 닫고 앉음 11초). */
    private fun reboard(d: DayDriver, at: String) {
        d.door(true); d.wait(2); d.seats(0)
        d.clock(at); d.seats(2); d.door(false); d.wait(11)
    }

    /** 석굴 → 테마파크까지 와서 12:10에 다시 탐 (예정보다 30분 일찍) → 제안 카드가 뜬 상태. */
    private fun reboardedEarlyAtThemePark(): Pair<DayDriver, Effect.CourseProposal> {
        val d = boarded()
        d.drive(60); d.clock("09:00"); d.parkAt(SeedPlaces.SEOKGUL, odoKm = 34)
        reboard(d, "09:30"); d.drive(60)
        d.clock("10:00"); d.parkAt(SeedPlaces.THEME_PARK, odoKm = 16)
        d.drain()
        reboard(d, "12:10")
        val p = d.drain().filterIsInstance<Effect.CourseProposal>().last()
        assertEquals(d.engine.liveCourse!!.version, p.course.version)
        return d to p
    }

    @Test
    fun `마지막 곳에서 다시 타면 새 3장 대신 코스 화면 제안 - 한 곳 더 + 바로 집으로, 바로 집으로를 고르면 귀가 중`() {
        val d = boarded()
        d.drive(60); d.clock("09:00"); d.parkAt(SeedPlaces.SEOKGUL, odoKm = 34)
        // 석굴만 남기고 나머지는 뺌 → 석굴이 마지막 곳
        d.engine.handle(SignalEvent.CourseCommand(CourseEvent.Skip(hhmm("09:05"), "samguk"), d.nowMs))
        d.engine.handle(SignalEvent.CourseCommand(CourseEvent.Skip(hhmm("09:05"), "dgsm"), d.nowMs))
        assertTrue(d.engine.liveCourse!!.remaining.isEmpty())
        d.drain()

        reboard(d, "10:00")
        val fx = d.drain()
        assertTrue("새 3장 없음: $fx", fx.none { it is Effect.ShowPlan })
        assertEquals(TripState.PLANNING, d.engine.state)
        val p = fx.filterIsInstance<Effect.CourseProposal>().last()
        assertEquals(2, p.options.size)
        assertTrue(p.options[0].label, p.options[0].label.startsWith("한 곳 더 · "))
        assertEquals("바로 집으로", p.options[1].label)
        assertEquals(OptionKind.GO_HOME, p.options[1].kind)
        assertTrue("코스는 그대로", d.engine.liveCourse != null)

        val fx2 = d.engine.handle(SignalEvent.RouteChosen(p.options[1], d.nowMs))
        assertEquals(OptionKind.GO_HOME, fx2.filterIsInstance<Effect.RequestRoute>().single().option.kind)
        assertTrue(fx2.none { it is Effect.PlanChosen })
        d.drive(60)
        assertEquals(TripState.HOMEWARD, d.engine.state)
    }

    @Test
    fun `마지막 곳에서 다시 타 '한 곳 더'를 고르면 그곳으로 길 안내`() {
        val d = boarded()
        d.drive(60); d.clock("09:00"); d.parkAt(SeedPlaces.SEOKGUL, odoKm = 34)
        d.engine.handle(SignalEvent.CourseCommand(CourseEvent.Skip(hhmm("09:05"), "samguk"), d.nowMs))
        d.engine.handle(SignalEvent.CourseCommand(CourseEvent.Skip(hhmm("09:05"), "dgsm"), d.nowMs))
        d.drain()
        reboard(d, "10:00")
        val p = d.drain().filterIsInstance<Effect.CourseProposal>().last()
        val extra = p.options[0]
        val fx = d.engine.handle(SignalEvent.RouteChosen(extra, d.nowMs))
        assertEquals(extra.stops.map { it.id }, fx.filterIsInstance<Effect.RequestRoute>().single().option.stops.map { it.id })
        assertEquals(extra.stops.map { it.id }, d.engine.liveCourse!!.remaining.map { it.id })
    }

    @Test
    fun `고르지 않고 떠난 제안은 다음 장소에 도착해도 다시 뜨지 않는다`() {
        val (d, p) = reboardedEarlyAtThemePark()
        d.drive(60)
        assertTrue("주행 중엔 카드 없음", d.drain().none { it is Effect.CourseProposal })
        d.clock("13:40"); d.parkAt(SeedPlaces.SCIENCE, odoKm = 78)
        val fx = d.drain()
        val now = d.engine.liveCourse!!.version
        val shown = fx.filterIsInstance<Effect.CourseProposal>()
        assertTrue("지난 제안(v${p.course.version})이 다시 뜸: ${shown.map { it.course.version to it.options.map { o -> o.label } }}",
            shown.all { it.course.version == now })
        assertTrue(fx.any { it is Effect.ProposalCleared })
    }

    @Test
    fun `권한 출발 시각이 지나면 제안을 치우고, 그 카드를 눌러도 코스는 그대로`() {
        val (d, p) = reboardedEarlyAtThemePark()
        val stretch = p.options.first { it.label.endsWith("에 출발") }
        val depart = stretch.legs.first { it.kind != LegKind.STAY }.fromMin
        val before = d.engine.liveCourse!!
        d.clock(depart.asHhmm()); d.wait(1)
        assertTrue("출발 시각까지는 그대로", d.drain().none { it is Effect.ProposalCleared })
        d.clock((depart + 1).asHhmm()); d.wait(1)
        val cleared = d.drain().filterIsInstance<Effect.ProposalCleared>().single()
        assertEquals("${depart.asHhmm()} 출발이 지났어요", cleared.reason)
        val fx = d.engine.handle(SignalEvent.RouteChosen(stretch, d.nowMs))
        assertTrue("지난 카드: $fx", fx.none { it is Effect.RequestRoute || it is Effect.CourseUpdated })
        assertEquals(before, d.engine.liveCourse)
    }

    @Test
    fun `그대로 갈게요는 엔진의 제안도 버린다 - 휴게소에 서도 다시 안 뜸`() {
        val (d, _) = reboardedEarlyAtThemePark()
        val fx = d.engine.handle(SignalEvent.ProposalDismissed(d.nowMs))
        assertTrue(fx.single() is Effect.ProposalCleared)
        // 같은 분에 출발(코스 버전 그대로) → 장소 아닌 곳에 P → 보류한 제안이 없으니 카드 없음
        d.drive(60); d.speed(0); d.at(LatLng(36.0, 128.66)); d.wait(1); d.gear(Gear.PARK); d.wait(4)
        assertTrue(d.drain().none { it is Effect.CourseProposal })
    }
    @Test
    fun `내비 없이 예정 도착이 지나도 달리는 중이면 StillDriving - 내비 ETA가 오면 그쪽이 맡고, 5분 간격`() {
        val d = boarded()
        d.drive(60); d.drain()
        fun next() = d.engine.liveCourse!!.next!!.plannedArriveMin
        fun late() = d.drain().filterIsInstance<Effect.CourseUpdated>().filter { it.change?.cause == "늦어짐" }
        val planned = next() // 석굴 08:59
        // 집과 석굴 사이 1/4 지점. 예정 도착 2분 전까지는 그대로, 지나면 남은 구간을 다시 어림
        d.at(LatLng(35.9266, 128.5973)); d.clock((planned - 2).asHhmm()); d.wait(1)
        assertTrue(late().isEmpty())
        d.clock((planned - 1).asHhmm()); d.wait(1)
        val up = late().single()
        assertTrue(up.change!!.text, up.change!!.text.startsWith("예정보다 늦어요 · 다음 도착 "))
        assertTrue("주행 중엔 음성 없이 칩만", up.quiet)
        val p1 = next()
        assertTrue("다시 짠 도착 ${p1.asHhmm()}", p1 > planned)
        // 새 예정 도착(−2분)이 지나기 전엔 다시 안 냄
        d.clock((p1 - 2).asHhmm()); d.wait(1)
        assertTrue(late().isEmpty())
        // 내비 ETA가 오면(10분 안) StillDriving 대신 NaviEta가 맡는다
        d.eta(900, 9_000)
        d.clock((p1 - 1).asHhmm()); d.wait(1)
        d.clock((p1 + 7).asHhmm()); d.wait(1)
        assertTrue(late().isEmpty())
        // 내비가 10분 넘게 조용하면 다시. 석굴 바로 앞이라 남은 구간은 최소 3분
        d.at(SeedPlaces.SEOKGUL); d.clock((p1 + 9).asHhmm()); d.wait(1)
        assertEquals(1, late().size)
        assertEquals(p1 + 12, next())
        // 곧 다시 예정(−2분)이 지나도 5분 간격
        d.clock((p1 + 11).asHhmm()); d.wait(1)
        assertTrue(late().isEmpty())
        d.clock((p1 + 14).asHhmm()); d.wait(1)
        assertEquals(1, late().size)
    }

    @Test
    fun `돌아서 간 길은 GPS 궤적으로 도장 인정 - 궤적 없는 같은 주행거리는 보류`() {
        fun run(withPath: Boolean): Effect {
            val d = boarded()
            d.drive(60); d.drain()
            if (withPath) {
                // 집 → 북쪽으로 크게 돌아(36.25, 128.58) → 석굴: 약 63km를 1.5km씩 1분 간격(시속 90km)으로
                val home = SeedPlaces.DEMO_HOME
                val via = LatLng(36.25, 128.58)
                val end = SeedPlaces.SEOKGUL.at
                for ((a, b) in listOf(home to via, via to end)) {
                    val n = kotlin.math.ceil(Geo.km(a, b) / 1.5).toInt()
                    for (i in 1..n) {
                        d.wait(60)
                        d.at(LatLng(a.lat + (b.lat - a.lat) * i / n, a.lng + (b.lng - a.lng) * i / n))
                    }
                }
            }
            // 경로 어림 상한 = 1.5 × (19.2 × 1.3) + 20 ≈ 57km < 주행 70km
            d.parkAt(SeedPlaces.SEOKGUL, odoKm = 70)
            return d.drain().first { it is Effect.StampGranted || it is Effect.StampHeld }
        }
        val ok = run(withPath = true)
        assertTrue("$ok", ok is Effect.StampGranted)
        val held = run(withPath = false)
        assertEquals(HoldReason.ODO_TOO_LONG, (held as Effect.StampHeld).verdict.reason)
    }
}
