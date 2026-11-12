package kr.milestamp.car.ui

import kr.milestamp.car.net.ServerApi
import kr.milestamp.engine.FamilyProfile
import kr.milestamp.engine.GoWith
import kr.milestamp.engine.LatLng
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 저녁 나들이 — 차 글 · '밤의 ○○' 칸 · 서버 저녁 칸 읽기. */
class EveningWordsTest {
    @Test
    fun `저녁 머리 글은 동행마다`() {
        assertEquals("저녁 산책 어때요?", GoWords.eveningTitle(GoWith.KIDS))
        assertEquals("둘이 야경 보러 갈까요?", GoWords.eveningTitle(GoWith.COUPLE))
        assertEquals("잠자기 전", GoWords.eveningLimit(GoWith.KIDS))
        assertEquals("늦어도", GoWords.eveningLimit(GoWith.SOLO))
    }

    @Test
    fun `도장 칸 - 비 오는 날 디아크 · 밤의 수성못 · 밤 칸이 없는 곳은 장소 칸`() {
        assertEquals("thearc_rain", StampAlbum.keyOf("thearc", "비 오는 날"))
        assertEquals("suseongmot_night", StampAlbum.keyOf("suseongmot", "밤"))
        assertEquals("unamji", StampAlbum.keyOf("unamji", "밤"))
        assertEquals("aquarium", StampAlbum.keyOf("aquarium", "비 오는 날"))
        assertEquals("eworld", StampAlbum.keyOf("eworld", null))
    }

    @Test
    fun `서버 저녁 칸 읽기 - 시간 특성 · 드라이브 길 · 귀가 기준`() {
        val m = ServerApi.parseMoments(JSONObject("""{"best":["night","x"],"light":{"on":"sunset+10"},"shows":[{"name":"음악분수","times":["20:00","19:00","bad"],"days":[5,6,9]}]}"""))!!
        assertEquals(setOf("night"), m.best)
        assertEquals("sunset+10", m.lightOn)
        assertEquals(listOf(19 * 60, 20 * 60), m.shows.single().times)
        assertEquals(setOf(5, 6), m.shows.single().days)
        assertNull(ServerApi.parseMoments(JSONObject("""{"best":[]}""")))
        val r = ServerApi.parseRoute(JSONObject("""{"points":[{"lat":35.83,"lng":128.55},{"lat":35.82,"lng":128.61}],"pass_min":25}"""))!!
        assertEquals(25, r.passMin)
        assertEquals(LatLng(35.82, 128.61), r.points.last())
        assertNull(ServerApi.parseRoute(JSONObject("""{"points":[{"lat":35.83,"lng":128.55}],"pass_min":25}""")))
        val base = FamilyProfile(home = LatLng(35.88, 128.58))
        val f = ServerApi.parseFamily(JSONObject("""{"kidAges":[4],"backBy":"sunset-30","bedtime":1230,"lateReturn":1410}"""), base)
        assertEquals(1230, f.bedtimeMin)
        assertEquals(1410, f.lateReturnMin)
        val old = ServerApi.parseFamily(JSONObject("""{"kidAges":[4],"backBy":"sunset-30"}"""), base)
        assertEquals(FamilyProfile.DEFAULT_BEDTIME_MIN, old.bedtimeMin)
        assertEquals(FamilyProfile.DEFAULT_LATE_RETURN_MIN, old.lateReturnMin)
    }
}
