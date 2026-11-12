package kr.milestamp.phone.auto

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 서버 JSON(폰 앱과 같은 모양) 읽기 — org.json이 안드로이드 것이라 Robolectric 위에서 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AutoJsonTest {
    @Test fun 시간_표시() {
        try {
            AutoJson.hour12 = true
            assertEquals("오후 9:54", AutoJson.clock(21 * 60 + 54))
            assertEquals("오전 12:05", AutoJson.clock(5))
            assertEquals("오후 12:30", AutoJson.clock(12 * 60 + 30))
            assertEquals("집에는 오후 9:54쯤 도착해요.", AutoJson.clockText("집에는 21:54쯤 도착해요."))
            assertEquals("1시간 33분 · 오전 9:05 출발", AutoJson.clockText("1시간 33분 · 9:05 출발"))
            assertEquals("오후 9:54 그대로", AutoJson.clockText("오후 9:54 그대로"))
            AutoJson.hour12 = false
            assertEquals("21:54", AutoJson.clock(21 * 60 + 54))
            assertEquals("집에는 21:54쯤", AutoJson.clockText("집에는 21:54쯤"))
        } finally { AutoJson.hour12 = true }
    }

    @Test fun 계획() {
        val p = AutoJson.plan(JSONObject(Samples.PLAN))
        assertEquals(3, p.options.size)
        assertEquals("침산공원 → 국립대구과학관", p.options[0].title)
        assertEquals("16:49", AutoJson.hhmm(p.options[0].arriveHomeMin))
        assertEquals("차에서 한숨 자고 도착", p.options[0].firstReason)
        assertEquals("바로 집으로", p.options[2].title)
        assertEquals(0, p.chosen)
        assertEquals("아빠가 고른 코스", AutoJson.chooserText(p.chosenBy))
        assertEquals("엄마가 고른 코스", AutoJson.chooserText("폰:엄마"))
        assertEquals("삼촌이 고른 코스", AutoJson.chooserText("폰:삼촌"))
        assertEquals("차에서 고른 코스", AutoJson.chooserText("차"))
    }

    @Test fun 미세먼지_나쁨_첫_칩() {
        // 서버 sky.air가 붙은 새 답 — 미세먼지 나쁨 날 실내 코스의 첫 칩이 목록 한 줄에 그대로 보인다
        val json = Samples.PLAN
            .replace("\"rainFrom\":null}", "\"rainFrom\":null,\"air\":{\"level\":\"BAD\",\"pm10\":95,\"pm25\":40,\"station\":\"수창동\",\"source\":\"airkorea\"}}")
            .replace("{\"text\":\"차에서 한숨 자고 도착\",\"tone\":\"NAP\"}", "{\"text\":\"미세먼지 나쁨 → 실내\",\"tone\":\"AIR\"},{\"text\":\"차에서 한숨 자고 도착\",\"tone\":\"NAP\"}")
        val p = AutoJson.plan(JSONObject(json))
        assertEquals("미세먼지 나쁨 → 실내", p.options[0].firstReason)
        assertEquals("AIR", p.options[0].reasons[0].tone)
    }

    @Test fun 코스와_제안() {
        val c = AutoJson.courseRes(JSONObject(Samples.COURSE))
        assertNotNull(c)
        assertEquals("chimsan", c!!.here!!.placeId)
        assertEquals("science", c.next!!.placeId)
        assertEquals(15, c.slackMin)
        assertEquals("계획대로 가고 있어요", c.headline)
        val o = AutoJson.outcome(JSONObject(Samples.OUTCOME))!!
        assertEquals("Proposal", o.kind)
        assertEquals(2, o.options.size)
        assertEquals(4, o.course.version)
    }

    @Test fun 명소_목록() {
        val cat = AutoJson.catalog(JSONObject(Samples.CATALOG))
        assertEquals(3, cat.size)
        assertEquals(2, cat[0].points.size)
        val place = cat[0].toPlace()
        assertNotNull(place.arrivalDistanceM(kr.milestamp.engine.LatLng(35.9101, 128.5901)))
        assertEquals("https://r2.example/stamps/chimsan.webp", cat[0].stampUrl)
    }

    @Test fun 코스의_바깥장소_이름좌표() {
        val c = AutoJson.course(JSONObject("""{"version":2,"arriveHomeMin":1000,"limitMin":1050,"stops":[
            {"placeId":"ext:tour:126081","status":"NEXT","plannedArriveMin":600,"name":"해운대해수욕장","lat":35.1587,"lng":129.1604},
            {"placeId":"ext:kto100:7","status":"PLANNED","plannedArriveMin":700,"ext":{"name":"독일마을","lat":34.8,"lng":128.04}},
            {"placeId":"chimsan","status":"PLANNED","plannedArriveMin":800}],"legs":[]}"""))
        val s0 = c.stops[0]
        assertEquals("해운대해수욕장", s0.name)
        assertEquals(true, s0.isExt)
        val p = s0.toExtPlace()!!
        assertEquals(300, p.radiusM); assertEquals(false, p.stampable); assertEquals(35.1587, p.at.lat, 1e-9)
        assertEquals("독일마을", c.stops[1].name); assertEquals(34.8, c.stops[1].lat!!, 1e-9)
        assertEquals(null, c.stops[2].name); assertEquals(null, c.stops[2].toExtPlace())
    }
}

