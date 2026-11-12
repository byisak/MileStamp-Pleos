package kr.milestamp.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 기획서 3-2 '가족의 하루'를 scripts/day_story.sh 와 같은 순서로 재현한다.
 * 이 테스트가 통과하면 시연 영상의 상태 흐름은 엔진 쪽에서 보장된다.
 */
class DayStoryTest {

    private inline fun <reified T : Effect> List<Effect>.one(): T {
        val found = filterIsInstance<T>()
        assertEquals("${T::class.simpleName} 가 정확히 1번 나와야 함: $this", 1, found.size)
        return found.first()
    }

    @Test
    fun `모은 도장 수를 실제 수로 맞추면 첫 도장 번호가 이어진다`() {
        val d = DayDriver()
        val S = SeedPlaces
        d.at(S.DEMO_HOME); d.gear(Gear.PARK); d.speed(0); d.odoAdd(0); d.weather(Sky.CLEAR); d.clock("08:29")
        d.wait(2); d.drain()
        d.engine.setStampsBefore(41) // 차가 서버 목록에서 센 수 (어제까지 41개)
        assertEquals(41, d.engine.profile.stampsBefore)
        d.clock("08:30"); d.seats(2); d.wait(6)
        val morning = d.drain().one<Effect.ShowPlan>().plan
        val story = Planner.course(hhmm("08:30"), S.DEMO_HOME, S.demoProfile(), listOf(S.SEOKGUL, S.THEME_PARK, S.SCIENCE), morning.sky)!!
        d.engine.handle(SignalEvent.ServerPlan(morning.copy(options = listOf(story) + morning.options.take(2)), 0, "아빠 폰", d.nowMs))
        d.tapBest(); d.drain()
        d.drive(60); d.drain()
        d.clock("09:19"); d.eta(150, 1_800); d.drain()
        d.parkAt(S.SEOKGUL, odoKm = 34)
        assertEquals(42, d.drain().one<Effect.StampGranted>().number)
    }

    @Test
    fun `토요일 하루 전체`() {
        val d = DayDriver()
        val S = SeedPlaces

        // 준비: 집, P, 빈 좌석, 맑음(오후 비 예보는 아직 3시간 밖)
        d.at(S.DEMO_HOME); d.gear(Gear.PARK); d.speed(0); d.odoAdd(0); d.weather(Sky.CLEAR); d.clock("08:29")
        d.wait(2); d.drain()

        // 1. 08:30 탑승 → 오늘 어디
        d.clock("08:30"); d.seats(2); d.wait(6)
        var fx = d.drain()
        val morning = fx.one<Effect.ShowPlan>().plan
        assertEquals(PlanMode.MORNING, morning.mode)
        // 차는 후보에서 코스를 찾아 3장 (1순위는 엔진 점수대로 — 지금 장소 값이면 화본역 → 테마파크 → 과학관)
        assertEquals(3, morning.options.size)
        assertTrue("낮잠 이동 칸", morning.best!!.legs.any { it.kind == LegKind.NAP_DRIVE })
        assertTrue("귀가 목표 안", morning.options.all { it.arriveHomeMin <= hhmm("17:30") })
        assertEquals(TripState.PLANNING, d.engine.state)

        // 2. 아빠가 폰에서 고른 이 이야기의 코스(석굴 → 테마파크 → 낮잠 이동 → 과학관)가 서버 계획으로 들어옴 → 차에서 출발
        val story = Planner.course(hhmm("08:30"), S.DEMO_HOME, S.demoProfile(), listOf(S.SEOKGUL, S.THEME_PARK, S.SCIENCE), morning.sky)!!
        assertTrue("석굴 코스도 낮잠 이동", story.legs.any { it.kind == LegKind.NAP_DRIVE && it.placeId == "dgsm" })
        assertTrue(story.arriveHomeMin <= hhmm("17:30"))
        d.engine.handle(SignalEvent.ServerPlan(morning.copy(options = listOf(story) + morning.options.take(2)), 0, "아빠 폰", d.nowMs))
        assertEquals("아빠 폰", d.engine.lastPlan!!.chosenBy)
        d.tapBest()
        assertTrue(d.drain().any { it is Effect.RequestRoute })

        // 3. 주행
        d.drive(60)
        fx = d.drain()
        assertEquals(TripState.DRIVING, d.engine.state)
        assertTrue(fx.any { it is Effect.ShowDrivingChip })

        // 4. 09:20 석굴: 도착 전 소개 → 쾅 #23
        d.clock("09:19"); d.eta(150, 1_800)
        fx = d.drain()
        assertEquals(IntroVariant.FULL_60S, fx.one<Effect.PlayIntro>().variant)
        assertEquals(TripState.ARRIVING, d.engine.state)
        d.parkAt(S.SEOKGUL, odoKm = 34)
        fx = d.drain()
        val s1 = fx.one<Effect.StampGranted>()
        assertEquals("seokgul", s1.place.id); assertEquals(23, s1.number)

        // 5. 테마파크 도착 전 소개
        d.clock("10:07"); d.drive(50); d.eta(150)
        fx = d.drain()
        assertEquals("samguk", fx.one<Effect.PlayIntro>().place.id)

        // 6. 10:10 쾅 #24 → 소개 중 문 열림 → 폰 이어듣기 + 미션
        d.clock("10:10"); d.parkAt(S.THEME_PARK, odoKm = 16)
        assertEquals(24, d.drain().one<Effect.StampGranted>().number)
        d.wait(8); d.door(true); d.wait(2)
        fx = d.drain()
        assertEquals("samguk", fx.one<Effect.HandoffToPhone>().place.id)
        assertEquals("samguk", fx.one<Effect.PushMission>().place.id)
        assertEquals(TripState.OUT, d.engine.state)

        // 8. 12:50 재탑승 → 고른 코스가 살아 있으니(과학관이 남음) 새 3장 대신 코스 그대로: 길 안내는 과학관, 낮잠 이동 (오후 비 예보)
        //    (10/26 바뀜: 예전엔 재탑승 때마다 새 3장을 만들어 '낮잠 맞춤 과학관 1순위'를 골랐다)
        d.clock("12:50"); d.weather(Sky.CLEAR, rainSoon = true)
        d.seats(0); d.wait(1); d.door(false); d.seats(2); d.wait(11)
        fx = d.drain()
        assertTrue("코스가 살아 있으면 새 3장 없음", fx.none { it is Effect.ShowPlan })
        val noon = fx.filterIsInstance<Effect.CourseUpdated>().last().course
        assertEquals("dgsm", noon.next!!.id)
        assertTrue("낮잠 이동 칸: ${noon.legs}", noon.legs.any { it.kind == LegKind.NAP_DRIVE && it.placeId == "dgsm" })
        assertEquals(listOf("dgsm"), fx.one<Effect.RequestRoute>().option.stops.map { it.id })
        assertEquals(TripState.PLANNING, d.engine.state)

        // 9. 12:55 출발 → 쉿 모드 → 소개는 폰으로, 무음 도장 #25
        d.clock("12:55"); d.drive(80)
        fx = d.drain()
        assertTrue(fx.one<Effect.QuietMode>().on)
        d.clock("14:04"); d.eta(150, 2_200)
        fx = d.drain()
        assertEquals("dgsm", fx.one<Effect.IntroToPhone>().place.id)
        assertTrue(fx.none { it is Effect.PlayIntro })
        d.parkAt(S.SCIENCE, odoKm = 78)
        val s3 = d.drain().one<Effect.StampGranted>()
        assertEquals(25, s3.number); assertTrue("쉿 모드 무음", s3.silent)
        d.door(true); d.wait(2); d.seats(0)
        fx = d.drain()
        assertTrue("소개 재생 중이 아니었으니 이어듣기 없음", fx.none { it is Effect.HandoffToPhone })

        // 10. 15:30 비 · 과학관(코스의 마지막 곳)에서 다시 탐 → 코스를 버리지 않고 코스 화면 제안: '한 곳 더 · …' + '바로 집으로'
        //     (10/26 바뀜: 예전엔 16:10에 귀갓길 새 3장(ShowPlan, 1순위 디아크)을 띄웠다. 시각은 day_story.sh 장면 10과 같은 15:30)
        d.clock("15:30"); d.weather(Sky.RAIN)
        d.seats(2); d.door(false); d.wait(11)
        fx = d.drain()
        assertTrue("마지막 곳에서도 새 3장 없음", fx.none { it is Effect.ShowPlan })
        val late = fx.filterIsInstance<Effect.CourseProposal>().last()
        assertEquals(2, late.options.size)
        assertTrue(late.options[0].label, late.options[0].label.startsWith("한 곳 더 · "))
        assertEquals("바로 집으로", late.options[1].label)
        assertTrue(late.options.all { it.arriveHomeMin <= hhmm("17:30") })
        assertEquals(TripState.PLANNING, d.engine.state)

        // 고르지 않고 출발 (주행 중엔 카드 없음). 주행 중 폰이 '디아크 들르기' → 다음 정차 때
        d.drive(60)
        fx = d.drain()
        assertEquals(false, fx.one<Effect.QuietMode>().on)
        assertEquals(TripState.DRIVING, d.engine.state)
        assertTrue("주행 중엔 카드 없음", fx.none { it is Effect.CourseProposal })
        d.engine.handle(SignalEvent.CourseCommand(CourseEvent.Insert(hhmm("15:31"), "thearc"), d.nowMs, deferWhileDriving = true))

        // 11. 디아크: 비 오는 날 희귀 도장 #26 (주차 후 판정). 15:30의 지난 제안 카드는 다시 뜨지 않는다
        d.clock("16:30"); d.parkAt(S.THE_ARC, odoKm = 19)
        val atArc = d.effects.filterIsInstance<Effect.CourseProposal>()
        assertTrue("지난 제안이 다시 뜸: $atArc", atArc.none { p -> p.options.map { it.label } == late.options.map { it.label } })
        assertEquals(StopStatus.ARRIVED, d.engine.liveCourse!!.current?.status)
        assertEquals("thearc", d.engine.liveCourse!!.current?.id)
        val s4 = d.drain().one<Effect.StampGranted>()
        assertEquals(26, s4.number); assertEquals("비 오는 날", s4.rare)

        // 12. 17:22 귀가 → 요약 + 뒷좌석 확인
        d.drive(50); d.clock("17:22"); d.parkAt(SeedPlaces.HAHOE.copy(id = "home", at = S.DEMO_HOME, radiusM = 0), odoKm = 22)
        fx = d.drain()
        val sum = fx.one<Effect.DaySummary>()
        assertEquals(4, sum.stamps); assertEquals(1, sum.rare); assertEquals(3, sum.rankedStamps)
        assertEquals(169.0, sum.kmToday!!, 0.01)
        assertEquals(TripState.HOME, d.engine.state)
        d.door(true); d.wait(1)
        fx = d.drain()
        fx.one<Effect.WarnRearSeat>()

        // 13. 위조 시도: 주행거리는 그대로, 위치만 70km 밖
        d.door(false); d.drive(0); d.parkAt(S.HAHOE, odoKm = 0)
        fx = d.drain()
        val held = fx.one<Effect.StampHeld>()
        assertEquals(HoldReason.ODO_TOO_SHORT, held.verdict.reason)
        assertTrue(fx.none { it is Effect.StampGranted })
        assertNotNull(d.engine.snapshot())
    }

    @Test
    fun `잠깐 내렸다 타면 재탑승 추천 없이 주차로 돌아감`() {
        val d = DayDriver()
        d.at(SeedPlaces.DEMO_HOME); d.gear(Gear.PARK); d.odoAdd(0); d.clock("09:00"); d.seats(2); d.wait(6)
        d.tapBest(); d.drive()
        d.clock("09:30"); d.parkAt(SeedPlaces.SEOKGUL, odoKm = 30)
        d.door(true); d.wait(2)
        assertEquals(TripState.OUT, d.engine.state)
        d.clock("09:32"); d.door(false); d.wait(11)
        assertEquals(TripState.PARKED, d.engine.state)
        assertTrue(d.take<Effect.ShowPlan>().size == 1) // 아침 카드만
    }

    @Test
    fun `내비 남은 시간이 한 번 튀는 것으로는 소개를 시작하지 않음`() {
        val d = DayDriver()
        d.at(SeedPlaces.DEMO_HOME); d.gear(Gear.PARK); d.odoAdd(0); d.clock("09:00"); d.seats(2); d.wait(6)
        d.tapBest(); d.drive(); d.drain()
        d.engine.handle(SignalEvent.Eta(120, 1_500, d.nowMs))
        d.engine.handle(SignalEvent.Eta(600, 9_000, d.nowMs))
        d.wait(2)
        assertTrue(d.take<Effect.PlayIntro>().isEmpty())
        assertEquals(TripState.DRIVING, d.engine.state)
    }

    @Test
    fun `카드를 안 고르고 출발하면 카드를 접고 주행으로`() {
        val d = DayDriver()
        d.at(SeedPlaces.DEMO_HOME); d.gear(Gear.PARK); d.clock("09:00"); d.seats(2); d.wait(6); d.drain()
        d.drive()
        val fx = d.drain()
        assertTrue(fx.any { it is Effect.CollapsePlan })
        assertEquals(TripState.DRIVING, d.engine.state)
    }

    @Test
    fun `14시 이후 첫 탑승은 짧은 나들이, 저녁 전 귀가`() {
        val d = DayDriver()
        val daycare = LatLng(35.8890, 128.5900)
        d.at(daycare); d.gear(Gear.PARK); d.clock("16:10")
        d.engine.handle(SignalEvent.Sun(hhmm("06:51"), hhmm("17:43"), d.nowMs))
        d.seats(2); d.wait(6)
        val plan = d.drain().filterIsInstance<Effect.ShowPlan>().single().plan
        assertEquals(PlanMode.AFTERNOON, plan.mode)
        assertEquals(OptionKind.GO_HOME, plan.options.last().kind)
        assertTrue(plan.options.all { it.arriveHomeMin <= hhmm("17:30") })
    }

    @Test
    fun `밤 20시40분 탑승은 바로 집으로만`() {
        val d = DayDriver()
        d.at(SeedPlaces.SCIENCE); d.gear(Gear.PARK); d.clock("20:40"); d.seats(2); d.wait(6)
        val plan = d.drain().filterIsInstance<Effect.ShowPlan>().single().plan
        assertEquals(listOf(OptionKind.GO_HOME), plan.options.map { it.kind })
        assertEquals("바로 집으로", plan.best!!.label)
        assertEquals(0, plan.budgetMin)
    }

    @Test
    fun `서버 계획은 계획 화면에서만 바꿔 끼우고, 고른 표시를 남긴다`() {
        val d = DayDriver()
        d.at(SeedPlaces.DEMO_HOME); d.gear(Gear.PARK); d.clock("08:30"); d.seats(2); d.wait(6)
        val own = d.drain().filterIsInstance<Effect.ShowPlan>().single().plan
        val server = own.copy(options = own.options.reversed())
        val fx = d.engine.handle(SignalEvent.ServerPlan(server, chosenIdx = 0, by = "아빠 폰", atMs = d.nowMs))
        val shown = fx.filterIsInstance<Effect.ShowPlan>().single().plan
        assertEquals(0, shown.chosen); assertEquals("아빠 폰", shown.chosenBy)
        assertEquals(server.options.first(), shown.chosenOption)
        assertEquals(shown, d.engine.lastPlan)

        // 고르면 서버에 알릴 PlanChosen
        val picked = d.engine.handle(SignalEvent.RouteChosen(shown.options[0], d.nowMs))
        assertEquals(0, picked.filterIsInstance<Effect.PlanChosen>().single().index)

        // 주행 중에는 무시
        d.drive()
        assertTrue(d.engine.handle(SignalEvent.ServerPlan(own, null, null, d.nowMs)).none { it is Effect.ShowPlan })
    }

    @Test
    fun `해 시각을 받으면 해 지기 30분 전이 귀가 한계`() {
        val fam = SeedPlaces.demoProfile().copy(backBy = BackBy.SunsetMinus(30))
        val d = DayDriver(TripEngine(fam, SeedPlaces.ALL))
        d.engine.handle(SignalEvent.Sun(hhmm("06:54"), hhmm("17:41"), 0))
        d.at(SeedPlaces.DEMO_HOME); d.gear(Gear.PARK); d.clock("08:30"); d.seats(2); d.wait(6)
        val plan = d.drain().filterIsInstance<Effect.ShowPlan>().single().plan
        assertEquals(hhmm("17:11"), plan.backByMin)
        assertTrue(plan.options.all { it.arriveHomeMin <= hhmm("17:11") })
    }
}
