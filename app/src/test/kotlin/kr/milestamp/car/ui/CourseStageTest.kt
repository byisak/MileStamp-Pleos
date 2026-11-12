package kr.milestamp.car.ui

import kr.milestamp.car.trip.ProposalShown
import kr.milestamp.car.trip.UiState
import kr.milestamp.engine.Change
import kr.milestamp.engine.ChangeSize
import kr.milestamp.engine.CourseCtx
import kr.milestamp.engine.CourseEvent
import kr.milestamp.engine.ExplainAction
import kr.milestamp.engine.Explanation
import kr.milestamp.engine.Gear
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.LiveCourseEngine
import kr.milestamp.engine.Plan
import kr.milestamp.engine.PlanMode
import kr.milestamp.engine.Planner
import kr.milestamp.engine.SeedPlaces
import kr.milestamp.engine.Sky
import kr.milestamp.engine.SkyToday
import kr.milestamp.engine.TripEngine
import kr.milestamp.engine.TripState
import kr.milestamp.engine.hhmm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 상태 → 화면 주인공·큰 버튼 (docs/디자인-점검/3-car.md 2절 S2·S4·S5, 큰 버튼은 화면에 하나). */
class CourseStageTest {
    private val S = SeedPlaces
    private val profile = S.demoProfile()
    private val sky = SkyToday(hhmm("06:46"), hhmm("17:32"), Sky.CLEAR, hhmm("15:00"))
    private val engine = LiveCourseEngine(profile, S.ALL)

    private fun base(): LiveCourse {
        val now = hhmm("08:30")
        val option = Planner.course(now, S.DEMO_HOME, profile, listOf(S.SEOKGUL, S.THEME_PARK, S.SCIENCE), sky)!!
        val plan = Plan(PlanMode.MORNING, now, 0, Planner.limitMin(PlanMode.MORNING, profile, sky), listOf(option), sky)
        return LiveCourse.from(option, plan, "아빠 폰", now, S.DEMO_HOME)
    }

    private fun atThemePark(): LiveCourse {
        var c = base()
        c = engine.apply(c, CourseEvent.Departed(hhmm("08:30"), null), CourseCtx(true)).course
        c = engine.apply(c, CourseEvent.Arrived(hhmm("09:00"), "seokgul")).course
        c = engine.apply(c, CourseEvent.Departed(hhmm("09:30"), "seokgul"), CourseCtx(true)).course
        return engine.apply(c, CourseEvent.Arrived(hhmm("10:00"), "samguk")).course
    }

    private val calm = Explanation("오늘 코스대로 가고 있어요", "집에는 16:47쯤 도착해요.")
    private val late = Explanation("오늘은 여기까지가 좋겠어요", "지금 출발하면 16:30에 도착해요.", ExplainAction.GO_HOME, homeMin = hhmm("16:30"), warn = true)

    @Test fun 다음_목적지가_있으면_큰_버튼은_출발_길안내() {
        val c = atThemePark()
        assertEquals(CoursePrimary.NAVIGATE, coursePrimaryFor(c, calm, null))
        assertEquals("출발 · 길 안내", primaryLabel(CoursePrimary.NAVIGATE, c, calm))
        val h = heroFor(c)
        assertEquals("국립대구과학관", h.name)
        assertFalse(h.isEnd)
    }

    @Test fun 여유가_있으면_지금_집으로는_큰_버튼이_아님() {
        val c = atThemePark()
        assertTrue(coursePrimaryFor(c, calm, null) != CoursePrimary.GO_HOME_LATE)
        assertTrue(coursePrimaryFor(c, null, null) != CoursePrimary.GO_HOME_LATE)
    }

    @Test fun 늦어지면_큰_버튼이_지금_집으로_도착_시각까지() {
        val c = atThemePark()
        assertEquals(CoursePrimary.GO_HOME_LATE, coursePrimaryFor(c, late, null))
        assertEquals("지금 집으로 · 오후 4:30 도착", primaryLabel(CoursePrimary.GO_HOME_LATE, c, late))
    }

    @Test fun 제안이_오면_큰_버튼은_이걸로_바꾸기() {
        val c = atThemePark()
        val p = ProposalShown(listOf(c.asOption("12:50에 출발")), Change("12:50에 출발하면 맞아요", "머무름 길어짐", 0, ChangeSize.SOFT, 730), c.version)
        // 늦어짐보다 제안이 먼저 (제안 띠가 주인공 자리)
        assertEquals(CoursePrimary.ADOPT, coursePrimaryFor(c, late, p))
        assertEquals("이걸로 바꾸기", primaryLabel(CoursePrimary.ADOPT, c, late))
    }

    @Test fun 아직_집에서_늦으면_오늘_코스_마치기() {
        val ex = Explanation("오늘은 쉬어요", "…", ExplainAction.END)
        assertEquals(CoursePrimary.END_DAY, coursePrimaryFor(base(), ex, null))
    }

    @Test fun 남은_곳이_없으면_도착지로_길안내_도착지_이름_그대로() {
        val c = engine.apply(atThemePark(), CourseEvent.GoHome(hhmm("12:00"))).course
        assertNull(c.next)
        assertEquals(CoursePrimary.NAVIGATE_HOME, coursePrimaryFor(c, calm, null))
        assertEquals("집으로 길 안내", primaryLabel(CoursePrimary.NAVIGATE_HOME, c, calm))
        assertTrue(heroFor(c).isEnd)
        val grandma = c.copy(end = kr.milestamp.engine.CourseEnd("할머니 집", S.DEMO_HOME))
        assertEquals("할머니 집으로 길 안내", primaryLabel(CoursePrimary.NAVIGATE_HOME, grandma, calm))
        assertEquals("할머니 집", heroFor(grandma).name)
    }

    private fun snap(state: TripState, gear: Gear, now: String) =
        TripEngine.Snapshot(state, gear, 0f, false, 2, null, null, false, hhmm(now), Sky.CLEAR, false, "국립대구과학관", emptyList())

    @Test fun 주행_화면은_다음_목적지_도착_시각_한_줄() {
        val c = atThemePark()
        val v = drivingViewFor(UiState(snapshot = snap(TripState.DRIVING, Gear.DRIVE, "12:41"), course = c, chip = "30분 일찍 · 낮잠은 차에서"))
        assertEquals("다음", v.kicker)
        assertEquals("국립대구과학관", v.name)
        assertTrue(v.arrive!!.startsWith("오후 ") || v.arrive!!.startsWith("오전 "))
        assertEquals("도착하면 도장", v.sub)
        assertEquals("30분 일찍 · 낮잠은 차에서", v.chip)
    }

    @Test fun 집으로_가는_길은_다음이_도착지() {
        val c = engine.apply(atThemePark(), CourseEvent.GoHome(hhmm("12:00"))).course
        val v = drivingViewFor(UiState(snapshot = snap(TripState.HOMEWARD, Gear.DRIVE, "12:10"), course = c))
        assertEquals("도착지", v.kicker)
        assertEquals("집", v.name)
        assertTrue(v.arrive!!.endsWith("도착 예정"))
    }

    @Test fun 주행_칩이_다음_안내와_같으면_두번_안_말함() {
        val c = atThemePark()
        val v = drivingViewFor(UiState(snapshot = snap(TripState.DRIVING, Gear.DRIVE, "12:41"), course = c, chip = "다음 · 국립대구과학관 13:10 도착"))
        assertNull(v.chip)
    }

    @Test fun 코스가_없으면_엔진의_다음_정차지만() {
        val v = drivingViewFor(UiState(snapshot = snap(TripState.DRIVING, Gear.DRIVE, "09:00"), chip = "다음 · 화본역 10:00 도착"))
        assertEquals("국립대구과학관", v.name)
        assertEquals("다음 · 화본역 오전 10:00 도착", v.chip)
    }

    @Test fun 메달_다음_줄() {
        val c = atThemePark()
        val line = medalNextLine(c, "samguk")
        assertTrue(line, line.startsWith("다음 · 국립대구과학관 · 오후 "))
        assertTrue(line.endsWith("출발 예정"))
    }
}
