package kr.milestamp.car.net

import kr.milestamp.engine.FamilyProfile
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.LegKind
import kr.milestamp.engine.Meals
import kr.milestamp.engine.MealSetup
import kr.milestamp.engine.Planner
import kr.milestamp.engine.SeedPlaces
import kr.milestamp.engine.Sky
import kr.milestamp.engine.SkyToday
import kr.milestamp.engine.hhmm
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 밥 자리 (식당 구조 11/3): /api/car/places restaurants · 가족 mealPlan · 밥 칸 "STAY"+meal · 'ext:food:' 장소. */
class MealParseTest {
    private val places = JSONObject("""
        {"places":[],"restaurants":[
          {"id":"r1","name":"할매칼국수","lat":35.8455,"lng":128.632,"cuisine":["면"],"priceLevel":1,"kid":["high_chair","kids_menu"],
           "parking":{"has":"yes","fee":"free"},"wait":{"weekday":0,"weekend_lunch":1},"meal":[],"dwellMin":null,"fit":{"kids":0.9,"couple":0.5},
           "tags":["아이랑"],"placeId":"nmd",
           "openHours":[{"days":[0,1,2,3,4,5,6],"holiday":false,"openMin":630,"closeMin":1230,"lastEntryMin":null,
                         "breaks":[{"fromMin":900,"toMin":990}],"validFrom":null,"validTo":null,"note":null,"lastOrderMin":1200}]},
          {"id":"bad","name":"좌표 없음"}
        ]}
    """.trimIndent())

    @Test
    fun `식당 목록 읽기 - 브레이크·마지막 주문까지, 좌표 없는 줄은 버림`() {
        val rs = ServerApi.parseRestaurants(places)
        assertEquals(1, rs.size)
        val r = rs.single()
        assertEquals("할매칼국수", r.name)
        assertEquals(setOf("high_chair", "kids_menu"), r.kid)
        assertEquals("yes", r.parkingHas)
        assertEquals("free", r.parkingFee)
        assertEquals(1, r.wait["weekend_lunch"])
        assertEquals(900, r.hours.single().breaks.single().fromMin)
        assertEquals(1200, r.hours.single().lastOrderMin)
        // 옛 서버(restaurants 없음) → 빈 목록
        assertTrue(ServerApi.parseRestaurants(JSONObject("""{"places":[]}""")).isEmpty())
    }

    @Test
    fun `가족 mealPlan - 켜면 밥 설정, 옛 서버는 끔`() {
        val base = SeedPlaces.demoProfile()
        assertNull(ServerApi.parseFamily(JSONObject("""{"saved":true,"backBy":"sunset-30","kidAges":[4,4]}"""), base).meal)
        assertNotNull(ServerApi.parseFamily(JSONObject("""{"saved":true,"backBy":"sunset-30","kidAges":[4,4],"mealPlan":true}"""), base).meal)
    }

    @Test
    fun `밥 칸은 STAY + meal 로 오고 MEAL로 읽는다, 옛 MEAL 이름도`() {
        assertEquals(LegKind.MEAL, CourseJson.legKindOf(JSONObject("""{"kind":"STAY","meal":true,"fromMin":700,"toMin":750}""")))
        assertEquals(LegKind.STAY, CourseJson.legKindOf(JSONObject("""{"kind":"STAY","fromMin":700,"toMin":750}""")))
        assertEquals(LegKind.DRIVE, CourseJson.legKindOf(JSONObject("""{"kind":"WHAT","fromMin":700,"toMin":750}""")))
        val j = CourseJson.legJson(kr.milestamp.engine.Leg(LegKind.MEAL, 700, 750, "ext:food:r1"))
        assertEquals("STAY", j.getString("kind"))
        assertTrue(j.getBoolean("meal"))
    }

    @Test
    fun `밥 자리 장소 'ext food' - 실내 · 정한 머무름 · 마지막 주문`() {
        val p = CourseJson.placeFromJson("ext:food:r1", JSONObject("""
            {"placeId":"ext:food:r1","name":"할매칼국수","lat":35.8455,"lng":128.632,
             "ext":{"name":"할매칼국수","lat":35.8455,"lng":128.632,"indoor":true,"dwell":50,"open":630,"close":900,"kidFit":0.9,"lastEntry":870}}
        """.trimIndent()))!!
        assertTrue(p.isMeal)
        assertTrue(p.indoor)
        assertEquals(50, p.dwellP80Min)
        assertEquals(870, p.lastEntryMin)
        assertEquals(false, p.stampable)
    }

    @Test
    fun `차 엔진도 받은 식당으로 밥 자리를 넣는다`() {
        val rs = ServerApi.parseRestaurants(places)
        val prof = SeedPlaces.demoProfile().copy(meal = MealSetup(rs, "2026-10-31"))
        val sky = SkyToday(sunriseMin = hhmm("06:50"), sunsetMin = hhmm("17:41"), sky = Sky.CLEAR)
        val plan = Planner.firstBoarding(hhmm("08:30"), prof.home, prof, SeedPlaces.ALL, sky, "2026-10-31")
        val withMeal = plan.options.filter { it.meal != null }
        assertTrue(plan.options.map { it.label }.toString(), withMeal.isNotEmpty())
        val o = withMeal.first()
        assertTrue(o.legs.any { it.kind == LegKind.MEAL })
        assertTrue(o.stops.any { Meals.isMealId(it.id) })
        assertTrue(o.reasons.first().text.contains("할매칼국수"))
    }
}
