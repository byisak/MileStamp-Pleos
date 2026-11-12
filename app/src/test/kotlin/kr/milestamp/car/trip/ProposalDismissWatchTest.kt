package kr.milestamp.car.trip

import kr.milestamp.car.net.CourseJson
import kr.milestamp.engine.Change
import kr.milestamp.engine.ChangeSize
import kr.milestamp.engine.OptionKind
import kr.milestamp.engine.PlanOption
import kr.milestamp.engine.SeedPlaces
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 가족 폰이 서버에서 거절한 제안을 차 카드에서도 치우는 판단 (같은 버전에서 서버 제안이 사라졌을 때만). */
class ProposalDismissWatchTest {
    private val retime = PlanOption(OptionKind.COURSE, listOf(SeedPlaces.SCIENCE), firstLegMin = 20, arriveHomeMin = 1000, label = "12:50에 출발")
    private val oneMore = PlanOption(OptionKind.COURSE, listOf(SeedPlaces.SCIENCE, SeedPlaces.THEME_PARK), firstLegMin = 20, arriveHomeMin = 1040, label = "한 곳 더")
    private val card = ProposalShown(listOf(retime, oneMore), Change("12:50에 출발하면 맞아요", "머무름 길어짐", 0, ChangeSize.SOFT, 730), version = 9)
    private val shapes = ProposalDismissWatch.shapes(card)!!

    @Test fun 같은_버전에서_서버_제안이_사라지면_치움() {
        val w = ProposalDismissWatch()
        assertFalse(w.onServer(shapes, 5, ServerProposal.Some(shapes)))
        assertTrue(w.onServer(shapes, 5, ServerProposal.None))
    }

    @Test fun 서버에서_본_적_없는_차_제안은_안_치움() {
        // 차가 막 만들고 아직 서버에 안 보낸 제안: 서버 답엔 제안이 없다
        val w = ProposalDismissWatch()
        assertFalse(w.onServer(shapes, 5, ServerProposal.None))
        assertFalse(w.onServer(shapes, 5, ServerProposal.None))
    }

    @Test fun 버전이_바뀌어_사라진_건_거절이_아님() {
        val w = ProposalDismissWatch()
        w.onServer(shapes, 5, ServerProposal.Some(shapes))
        assertFalse(w.onServer(shapes, 6, ServerProposal.None))
    }

    @Test fun 다른_모양의_서버_제안은_짝으로_안_봄() {
        val w = ProposalDismissWatch()
        w.onServer(shapes, 5, ServerProposal.Some(listOf(ProposalDismissWatch.shape(oneMore))))
        assertFalse(w.onServer(shapes, 5, ServerProposal.None))
    }

    @Test fun 차_카드가_바뀌면_전에_본_짝은_잊음() {
        val w = ProposalDismissWatch()
        w.onServer(shapes, 5, ServerProposal.Some(shapes))
        val newer = listOf(ProposalDismissWatch.shape(oneMore))
        // 새 카드가 떴는데 서버엔 아직 옛 버전(제안 없음) — 새 카드는 서버에서 본 적 없으니 그대로
        assertFalse(w.onServer(newer, 5, ServerProposal.None))
    }

    @Test fun 모르는_답이나_카드가_없으면_아무것도_안_함() {
        val w = ProposalDismissWatch()
        w.onServer(shapes, 5, ServerProposal.Some(shapes))
        assertFalse(w.onServer(shapes, 5, ServerProposal.Unknown))
        assertTrue(w.onServer(shapes, 5, ServerProposal.None))
        // 이미 치웠으니 같은 답이 또 와도 다시 치우지 않음
        assertFalse(w.onServer(null, 5, ServerProposal.None))
    }

    @Test fun 하루_초기화() {
        val w = ProposalDismissWatch()
        w.onServer(shapes, 5, ServerProposal.Some(shapes))
        w.reset()
        assertFalse(w.onServer(shapes, 5, ServerProposal.None))
    }

    // ---- 서버 JSON 읽기 ----

    private fun optionJson(kind: String, vararg ids: String) =
        JSONObject().put("kind", kind).put("label", "x").put("stops", org.json.JSONArray(ids.map { JSONObject().put("id", it).put("name", it) }))

    @Test fun GET_답의_proposal을_읽음() {
        val p = JSONObject().put("options", org.json.JSONArray(listOf(optionJson("COURSE", "dgsm"), optionJson("COURSE", "dgsm", "samguk"))))
            .put("atMin", 730).put("version", 5)
        val got = CourseJson.serverProposal(JSONObject().put("kind", "NoChange").put("version", 5).put("proposal", p))
        assertEquals(ServerProposal.Some(shapes), got)
    }

    @Test fun GET_답의_proposal이_null이면_없음() {
        val o = JSONObject().put("kind", "NoChange").put("version", 5).put("proposal", JSONObject.NULL)
        assertEquals(ServerProposal.None, CourseJson.serverProposal(o))
    }

    @Test fun 지난_버전의_제안은_없는_것() {
        val p = JSONObject().put("options", org.json.JSONArray(listOf(optionJson("COURSE", "dgsm")))).put("version", 4)
        assertEquals(ServerProposal.None, CourseJson.serverProposal(JSONObject().put("version", 5).put("proposal", p)))
    }

    @Test fun PATCH_답은_Proposal일_때만_제안_그_밖은_모름() {
        val prop = JSONObject().put("kind", "Proposal").put("version", 5).put("options", org.json.JSONArray(listOf(optionJson("COURSE", "dgsm"))))
        assertEquals(ServerProposal.Some(listOf("COURSE:dgsm")), CourseJson.serverProposal(prop))
        assertEquals(ServerProposal.Unknown, CourseJson.serverProposal(JSONObject().put("kind", "Retimed").put("version", 6)))
    }

    @Test fun 차_그대로_갈게요는_서버에서_같은_제안을_본_버전으로_보냄() {
        val w = ProposalDismissWatch()
        assertEquals(null, w.serverVersionOf(shapes))
        w.onServer(shapes, 7, ServerProposal.Some(shapes))
        assertEquals(7, w.serverVersionOf(shapes))
        // 다른 모양의 카드면 모름 (서버의 다른 제안을 지우지 않게)
        assertEquals(null, w.serverVersionOf(listOf("COURSE:dgsm")))
        assertEquals(null, w.serverVersionOf(null))
    }
}
