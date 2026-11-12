package kr.milestamp.car.net

import kr.milestamp.engine.LatLng
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.LiveStop
import kr.milestamp.engine.Place
import kr.milestamp.engine.SeedPlaces
import kr.milestamp.engine.StopStatus
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** 코스 JSON의 바깥 장소(ext:…, 차 장소 목록 밖) — 이름·좌표로 장소를 만들어 빼지 않는다 (내가 고르기 C단계). */
class CourseJsonExtTest {
    private val catalog: (String) -> Place? = { id -> SeedPlaces.byId(id) }

    private val json = """
        {"id":"lc-1","version":3,"chosenBy":"폰:아빠","nowMin":540,"arriveHomeMin":1000,"limitMin":1050,
         "stops":[
           {"placeId":"ext:tour:126081","status":"NEXT","plannedArriveMin":600,"plannedDepartMin":690,"dwellGuessMin":90,
            "name":"해운대해수욕장","lat":35.1587,"lng":129.1604,
            "ext":{"name":"해운대해수욕장","lat":35.1587,"lng":129.1604,"indoor":false,"dwell":120,"open":540,"close":1200,"kidFit":0.8}},
           {"placeId":"dgsm","status":"PLANNED","plannedArriveMin":800,"plannedDepartMin":900,"name":"국립대구과학관","lat":35.6862,"lng":128.46642},
           {"placeId":"ext:kto100:7","status":"PLANNED","plannedArriveMin":920,"plannedDepartMin":950},
           {"placeId":"newplace","status":"PLANNED","name":"새 명소","lat":35.9,"lng":128.6}
         ],"legs":[]}
    """.trimIndent()

    @Test
    fun `목록에 없는 바깥 장소는 이름·좌표·ext 칸으로 도장 없는 장소가 된다`() {
        val c = CourseJson.parseCourse(JSONObject(json), catalog)!!
        assertEquals(listOf("ext:tour:126081", "dgsm", "newplace"), c.stops.map { it.id })
        val p = c.stops[0].place
        assertEquals("해운대해수욕장", p.name)
        assertEquals(LatLng(35.1587, 129.1604), p.at)
        assertEquals(300, p.radiusM)
        assertFalse(p.stampable)
        assertEquals(120, p.dwellP80Min)
        assertEquals(540, p.openMin)
        assertEquals(0.8, p.kidFit, 1e-9)
        assertEquals(StopStatus.NEXT, c.stops[0].status)
        // 목록에 있는 곳은 목록 것 그대로 (도장 있음)
        assertEquals(SeedPlaces.SCIENCE, c.stops[1].place)
        // ext 칸이 없으면 서버 기본값
        val q = c.stops[2].place
        assertEquals("새 명소", q.name); assertFalse(q.stampable); assertEquals(90, q.dwellP80Min); assertEquals(600, q.openMin)
    }

    @Test
    fun `이름·좌표가 없으면 차 코스에 있던 장소를 쓰고, 그것도 없으면 뺀다`() {
        val known = Place("ext:kto100:7", "남해 독일마을", LatLng(34.80, 128.04), stampable = false)
        val base = LiveCourse(id = "lc-1", version = 2, chosenBy = "폰", chosenAtMin = 500,
            stops = listOf(LiveStop(known, StopStatus.PLANNED, 920, 950, dwellGuessMin = 60)), legs = emptyList(),
            nowMin = 540, here = null, arriveHomeMin = 1000, limitMin = 1050)
        val c = CourseJson.parseCourse(JSONObject(json), catalog, base)!!
        assertEquals(listOf("ext:tour:126081", "dgsm", "ext:kto100:7", "newplace"), c.stops.map { it.id })
        assertEquals("남해 독일마을", c.stops[2].place.name)

        val remote = CourseJson.parseEvent(JSONObject("""{"type":"Remote","version":5,"stops":["ext:kto100:7","dgsm","ext:tour:404"]}"""), 600, catalog, base)
        assertEquals(listOf("ext:kto100:7", "dgsm"), (remote as kr.milestamp.engine.CourseEvent.Remote).course.stops.map { it.id })
    }

    @Test
    fun `좌표가 이상하면 장소를 만들지 않는다`() {
        assertNull(CourseJson.placeFromJson("ext:tour:1", JSONObject("""{"name":"가","lat":135.0,"lng":129.0}""")))
        assertNull(CourseJson.placeFromJson("ext:tour:1", JSONObject("""{"lat":35.0,"lng":129.0}""")))
    }
}
