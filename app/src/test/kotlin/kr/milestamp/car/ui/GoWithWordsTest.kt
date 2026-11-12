package kr.milestamp.car.ui

import kr.milestamp.car.net.ServerApi
import kr.milestamp.car.trip.UiState
import kr.milestamp.engine.GoWith
import kr.milestamp.engine.OptionKind
import kr.milestamp.engine.Plan
import kr.milestamp.engine.PlanMode
import kr.milestamp.engine.PlanOption
import kr.milestamp.engine.Reason
import kr.milestamp.engine.Tone
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 누구랑 가요? — 차가 만드는 글·뒷좌석 확인·낮잠 표시·밤 '내일 코스'. 아이와는 예전 글 그대로. */
class GoWithWordsTest {
    private val adults = listOf(GoWith.COUPLE, GoWith.FRIENDS, GoWith.SOLO)

    @Test fun 아이와는_예전_글_그대로() {
        val k = GoWith.KIDS
        assertEquals("가족 폰에서 코스를 고르면 여기에 바로 떠요", GoWords.loadingLine(k))
        assertEquals("가족 폰에서 오늘 코스를 골라 주세요", GoWords.pickLine(k))
        assertEquals("오늘 이야기를 가족 폰으로 보냈어요", GoWords.storySent(k))
        assertEquals("가족 폰으로 보냈어요", GoWords.sentToPhone(k))
        assertEquals("가족 도장북", GoWords.book(k))
        assertTrue(GoWords.rearSeatCheck(k))
        assertTrue(GoWords.showNap(k))
    }

    @Test fun 어른끼리는_가족_아이_낮잠_말이_없다() {
        for (g in adults) {
            val lines = listOf(
                GoWords.loadingLine(g), GoWords.pickLine(g), GoWords.storySent(g), GoWords.sentToPhone(g),
                GoWords.book(g), GoWords.tomorrowLine(g), GoWords.chip(g),
            )
            lines.forEach { l -> listOf("가족", "아이", "낮잠", "4살").forEach { w -> assertFalse("$g: $l", w in l) } }
            assertFalse(GoWords.rearSeatCheck(g))
            assertFalse(GoWords.showNap(g))
        }
        assertEquals("폰에서 오늘 코스를 골라 주세요", GoWords.pickLine(GoWith.COUPLE))
        assertEquals("오늘 이야기를 폰으로 보냈어요", GoWords.storySent(GoWith.SOLO))
    }

    @Test fun 머리_칩() {
        assertEquals(listOf("아이와", "연인·부부", "친구끼리", "혼자"), GoWith.entries.map(GoWords::chip))
    }

    @Test fun 낮잠_이유칩은_아이와만() {
        val rs = listOf(Reason("낮잠 맞춤 · 차에서 40분", Tone.NAP), Reason("도장 2개", Tone.STAMP), Reason("오후 4:30 귀가"))
        assertEquals(3, reasonsFor(rs, GoWith.KIDS).size)
        adults.forEach { assertEquals(listOf("도장 2개", "오후 4:30 귀가"), reasonsFor(rs, it).map(Reason::text)) }
    }

    private fun plan(mode: PlanMode = PlanMode.AFTERNOON, chosen: Int? = null) = Plan(
        mode, 22 * 60 + 10, 0, 22 * 60,
        listOf(PlanOption(OptionKind.GO_HOME, emptyList(), firstLegMin = 20, arriveHomeMin = 22 * 60 + 30, label = "바로 집으로")),
        chosen = chosen,
    )

    @Test fun 밤_계획이면_집으로_카드_대신_내일_코스_대기화면() {
        val ui = UiState(plan = plan(), tomorrowHint = true, companion = GoWith.COUPLE)
        assertEquals(CarScreen.WAITING, carScreenFor(ui))
        assertEquals(WaitKind.TOMORROW, waitKindFor(ui))
        // 이미 고른 코스·재탑승 계획·밤 아님은 예전 그대로
        assertEquals(CarScreen.PLAN, carScreenFor(ui.copy(plan = plan(chosen = 0))))
        assertEquals(CarScreen.PLAN, carScreenFor(ui.copy(plan = plan(PlanMode.REBOARD))))
        assertEquals(CarScreen.PLAN, carScreenFor(ui.copy(tomorrowHint = false)))
        assertEquals(WaitKind.LOADING, waitKindFor(UiState()))
    }

    @Test fun 서버_계획의_동행과_내일_표시를_읽는다() {
        val body = JSONObject(
            """{"planId":"p1","companion":"friends","tomorrowHint":true,"chosen":null,"chosenBy":null,
               "plan":{"mode":"AFTERNOON","nowMin":1330,"budgetMin":0,"backByMin":1320,"options":[]},"sky":null}""",
        )
        val p = ServerApi.parsePlan(body, { null })
        assertEquals(GoWith.FRIENDS, p.companion)
        assertTrue(p.tomorrowHint)
        // 예전 서버 답 (칸 없음)
        body.remove("companion"); body.remove("tomorrowHint")
        val old = ServerApi.parsePlan(body, { null })
        assertEquals(null, old.companion)
        assertFalse(old.tomorrowHint)
    }
}

class GoWithWarningTest {
    @Test fun 깨어있는_이동_경고는_아이와만() {
        val w = "깨어 있는 이동 89분 (국립대구과학관)"
        assertEquals(w, GoWords.warning(w, GoWith.KIDS))
        assertEquals(null, GoWords.warning(w, GoWith.COUPLE))
        assertEquals("긴 이동 120분 (안동 하회마을)", GoWords.warning("깨어 있는 이동 120분 (안동 하회마을)", GoWith.SOLO))
        assertEquals("디아크 문 열기 40분 기다림", GoWords.warning("디아크 문 열기 40분 기다림", GoWith.FRIENDS))
    }
}
