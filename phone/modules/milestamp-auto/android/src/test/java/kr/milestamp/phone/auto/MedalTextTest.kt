package kr.milestamp.phone.auto

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 메달 글 (시안 K 표 · 폰 medal.tsx와 같은 말). org.json이 안드로이드 것이라 Robolectric으로 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MedalTextTest {
    @Test fun 종류별_제목과_배지() {
        val t = TestMedals.all.mapValues { it.value.title to it.value.pill }
        assertEquals("도장 쾅!" to "도장 획득!", t["normal"])
        assertEquals("희귀 도장!" to "희귀 · 비 오는 날", t["rare"])
        assertEquals("축제 도장!" to "축제 도장!", t["festival"])
        assertEquals("또 왔어요!" to "또 왔어요! · 3번째", t["again"])
        assertEquals("도장 쾅! (조용히)" to "도장 획득!", t["quiet"])
    }

    @Test fun 그림_아래_한_줄() {
        assertEquals("15번째 도장 · 우리 동네 평일 오후", TestMedals.normal.imageSub)
        assertEquals("16번째 도장 · 희귀 · 비 오는 날", TestMedals.rare.imageSub)
        assertEquals("17번째 도장 · 축제 도장 · 2026 가을", TestMedals.festival.imageSub)
        assertEquals("3번째 방문 · 도장북 15/34칸", TestMedals.again.imageSub)
        assertEquals("처음 찍은 날 10/12 · 12번째 도장", TestMedals.again.row1Sub)
        assertEquals("이번 묶음 5 / 9", TestMedals.normal.row2Sub)
        assertEquals("11/9까지만 찍을 수 있어요", TestMedals.festival.row2Sub)
        assertEquals("조용히 찍었어요 · 깨면 같이 봐요", TestMedals.quiet.row2Sub)
    }

    @Test fun 주행_중_알림_한_줄() {
        assertEquals("도장 쾅! 침산공원 · 도장북 15/34칸", TestMedals.normal.alertLine)
        assertEquals("도장 쾅! 국립대구과학관 · 도장북 15/34칸", TestMedals.quiet.alertLine)
        assertEquals("조용히 찍었어요 · 멈추면 크게 보여 드려요", TestMedals.quiet.alertSub)
    }

    @Test fun 음성_한_문장() {
        assertEquals("도장 쾅! 침산공원, 열다섯 번째 도장이에요.", TestMedals.normal.voice)
        assertEquals("희귀 도장이에요! 비 오는 날 디아크를 모았어요.", TestMedals.rare.voice)
        assertEquals("축제 도장 쾅! 팔공산 단풍축제, 이번 가을에만 찍을 수 있는 도장이에요.", TestMedals.festival.voice)
        assertEquals("또 왔어요! 화본역 세 번째 방문이에요.", TestMedals.again.voice)
        assertNull(TestMedals.quiet.voice)
    }

    @Test fun 우리말_서수() {
        assertEquals("첫 번째", KoreanWords.ordinal(1))
        assertEquals("스무 번째", KoreanWords.ordinal(20))
        assertEquals("스물한 번째", KoreanWords.ordinal(21))
        assertEquals("서른네 번째", KoreanWords.ordinal(34))
        assertEquals("120번째", KoreanWords.ordinal(120))
        assertEquals("을", KoreanWords.eulReul("침산공원"))
    }

    @Test fun 서버_답에서_메달_정보() {
        val catalog = AutoJson.catalog(JSONObject(Samples.CATALOG_FULL))
        val stamps = listOf(
            StampRow("hwabon", 3, "2026-10-12T02:00:00Z"), StampRow("hwabon", 3, "2026-10-19T02:00:00Z"),
            StampRow("hwabon", 3, "2026-10-27T02:00:00Z"), StampRow("chimsan", 1, "2026-10-05T02:00:00Z"),
        )
        val reply = JSONObject("""{"id":"e1","payload":{"number":null}}""")
        val m = MedalFacts.build("hwabon", "화본역", catalog, reply, stamps, null, false, "phone", 3)
        assertEquals(MedalKind.AGAIN, m.kind)
        assertEquals(3, m.visit)
        assertEquals(2, m.got)
        assertEquals("10/12", m.firstDay)
        assertEquals(3, m.number)

        val n = MedalFacts.build("chimsan", "침산공원", catalog, JSONObject("""{"payload":{"number":2}}"""),
            listOf(StampRow("chimsan", 2, "2026-10-27T02:00:00Z"), StampRow("hwabon", 1, "2026-10-12T02:00:00Z")),
            AutoJson.courseRes(JSONObject(Samples.COURSE)), quiet = true, source = "phone", total = 3)
        assertEquals(MedalKind.NORMAL, n.kind)
        assertEquals(true, n.quiet)
        assertEquals("town", catalog.first { it.id == "chimsan" }.grp)
        assertEquals("우리 동네 평일 오후", n.groupTitle)
        assertEquals(1 to 1, n.groupGot to n.groupTotal)
        assertEquals("국립대구과학관", n.nextName)
        assertEquals(11 * 60, n.departMin)

        val f = MedalFacts.build("fest-palgong", "팔공산 단풍축제", catalog, JSONObject("""{"payload":{"number":17}}"""), null, null, false, "phone", 34)
        assertEquals(MedalKind.FESTIVAL, f.kind)
        assertEquals("2026 가을", f.festivalSeason)
        assertEquals("11/9", f.festivalUntil)

        val r = MedalFacts.build("thearc", "디아크", catalog, JSONObject("""{"payload":{"number":5,"rare":"비 오는 날"}}"""), null, null, false, "phone", 34)
        assertEquals(MedalKind.RARE, r.kind)
        assertEquals("thearc_rain", r.key)

        // 서버 답의 몇 번째 방문(payload.visit)이 도장 목록보다 먼저 — 목록을 못 받아도 '또 왔어요'
        val v = MedalFacts.build("hwabon", "화본역", catalog, JSONObject("""{"payload":{"number":9,"visit":2,"silent":true}}"""), null, null, false, "phone", 34)
        assertEquals(MedalKind.AGAIN, v.kind)
        assertEquals(2, v.visit)
        assertEquals(true, v.quiet) // 서버 silent도 쉿
        val w = MedalFacts.build("hwabon", "화본역", catalog, JSONObject("""{"payload":{"number":9,"visit":1}}"""),
            listOf(StampRow("hwabon", 3, "2026-10-12T02:00:00Z"), StampRow("hwabon", 9, "2026-10-27T02:00:00Z")), null, false, "phone", 34)
        assertEquals(1, w.visit)
    }
}
