package kr.milestamp.phone.auto

import kr.milestamp.engine.HoldReason
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.Place
import kr.milestamp.engine.StampVerdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 안드로이드 오토 판정 어댑터: 연결·속도·GPS → 엔진 StampVerifier */
class AutoTripDetectorTest {
    private val home = LatLng(35.8858, 128.5828) // 북구청
    private val park = Place("chimsan", "침산공원", LatLng(35.9100, 128.5900), radiusM = 300)
    private val stamped = mutableSetOf<String>()
    private val d = AutoTripDetector({ listOf(park) }, { it in stamped })
    private var t = 1_000L

    private fun stamps(outs: List<AutoTripDetector.Out>) = outs.filterIsInstance<AutoTripDetector.Out.Stamp>().map { it.attempt }

    /** 집 → 공원까지 2초마다 GPS (시속 약 50km), 달리는 동안 속도 50 */
    private fun drive(from: LatLng, to: LatLng, steps: Int = 120, speed: Boolean = true): List<AutoTripDetector.Out> {
        val out = mutableListOf<AutoTripDetector.Out>()
        for (i in 1..steps) {
            t += 2_000
            val f = i.toDouble() / steps
            out += d.location(LatLng(from.lat + (to.lat - from.lat) * f, from.lng + (to.lng - from.lng) * f), 8f, t)
            if (speed) out += d.speed(50f, t)
        }
        return out
    }

    private fun stop(minutes: Int): List<AutoTripDetector.Out> {
        val out = mutableListOf<AutoTripDetector.Out>()
        out += d.speed(0f, t)
        repeat(minutes * 12) { t += 5_000; out += d.tick(t) }
        return out
    }

    @Test fun 연결_주행_3분정차_도장_폰인증() {
        d.location(home, 8f, t)
        assertTrue(d.connected(t).contains(AutoTripDetector.Out.Boarded))
        drive(home, park.at)
        val a = stamps(stop(3)).single()
        assertTrue(a.verdict is StampVerdict.Granted)
        assertEquals("phone", a.source)
        assertEquals("STOP_3MIN", a.reason)
        assertNull(a.odoKm)
        assertTrue("궤적 ${a.gpsPathKm}", a.gpsPathKm > 2.5 && a.gpsPathKm < 3.2)
    }

    @Test fun 차_주행거리가_있으면_그걸로() {
        d.location(home, 8f, t)
        d.mileage(12_000.0)
        d.connected(t)
        drive(home, park.at)
        d.mileage(12_003.4)
        val a = stamps(stop(3)).single()
        assertEquals("odometer", a.source)
        assertEquals(3.4, a.odoKm!!, 1e-6)
        assertTrue(a.granted)
    }

    @Test fun 위치만_순간이동하면_보류() {
        d.location(home, 8f, t)
        d.connected(t)
        d.speed(30f, t)
        t += 2_000
        d.location(park.at, 8f, t) // 2초 만에 2.8km → 궤적에 안 넣음
        val a = stamps(stop(3)).single()
        assertTrue(a.verdict is StampVerdict.Held)
        assertEquals(HoldReason.ODO_TOO_SHORT, (a.verdict as StampVerdict.Held).reason)
    }

    @Test fun 도착_원_안에서_연결_해제하면_바로_판정() {
        d.location(home, 8f, t)
        d.connected(t)
        drive(home, park.at)
        d.speed(0f, t)
        t += 30_000
        val outs = d.disconnected(t)
        val a = stamps(outs).single()
        assertEquals("DISCONNECT", a.reason)
        assertTrue(a.granted)
        assertTrue(outs.last() == AutoTripDetector.Out.Left)
        assertEquals(AutoTripDetector.Phase.OUT, d.phase)
    }

    @Test fun 오늘_이미_찍은_곳은_보류() {
        stamped += park.id
        d.location(home, 8f, t)
        d.connected(t)
        drive(home, park.at)
        val a = stamps(stop(3)).single()
        assertEquals(HoldReason.ALREADY_TODAY, (a.verdict as StampVerdict.Held).reason)
    }

    @Test fun 원_밖_3분_정차는_도장_없음() {
        d.location(home, 8f, t)
        d.connected(t)
        val mid = LatLng((home.lat + park.at.lat) / 2, (home.lng + park.at.lng) / 2)
        drive(home, mid, steps = 60)
        val outs = stop(3)
        assertTrue(stamps(outs).isEmpty())
        assertTrue(outs.contains(AutoTripDetector.Out.Parked(null)))
    }

    @Test fun 같은_정차에서_두번_찍지_않고_다시_출발하면_새_구간() {
        d.location(home, 8f, t)
        d.connected(t)
        drive(home, park.at)
        assertEquals(1, stamps(stop(5)).size)
        assertTrue(stamps(d.disconnected(t)).isEmpty())
        d.connected(t)
        d.speed(40f, t)
        assertEquals(0.0, d.gpsPathKm, 1e-9)
        assertEquals(park.at, d.legStart)
    }

    @Test fun 속도_신호가_없어도_GPS_속도로() {
        d.location(home, 8f, t)
        d.connected(t)
        // 차 속도 없이 GPS만: 런타임이 GPS 속도를 speed()로 넣는다 — 여기서는 GPS 점만 + 마지막에 0
        drive(home, park.at, speed = false)
        d.speed(40f, t) // GPS 속도 한 번
        val a = stamps(stop(3)).firstOrNull()
        assertNotNull(a)
        assertTrue(a!!.granted)
    }

    @Test fun 코스의_바깥장소_도착원_안이면_시도_도장없는곳도() {
        // 명소 목록 밖 바깥 장소(ext:…, 도장 없음)도 오늘 코스에 있으면 도착 판정 대상 → 부르는 쪽이 '다녀옴'으로
        val ext = Place("ext:tour:126508", "동화사", LatLng(35.9934, 128.6997), radiusM = 300, stampable = false)
        val plain = Place("x", "도장 없는 길가", LatLng(35.9934, 128.6997), radiusM = 300, stampable = false)
        val d2 = AutoTripDetector({ listOf(park, ext, plain) }, { false })
        d2.location(home, 8f, t); d2.connected(t)
        d2.location(ext.at, 8f, t + 1)
        assertEquals("ext:tour:126508", d2.placeHere()?.id)
        val d3 = AutoTripDetector({ listOf(plain) }, { false })
        d3.location(plain.at, 8f, t)
        assertNull("ext가 아닌 도장 없는 곳은 판정 안 함", d3.placeHere())
    }
}

