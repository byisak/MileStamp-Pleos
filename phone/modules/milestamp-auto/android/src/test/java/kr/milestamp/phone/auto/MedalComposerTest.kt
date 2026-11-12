package kr.milestamp.phone.auto

import android.graphics.Bitmap
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * 메달 그림 합성 시험 (Robolectric 실제 그리기 모드). 다섯 가지를 그려 build/auto-shots/medal-*.png로 남기고
 * 정해진 자리의 색(배지·고리·막대·깃발·쉿 배지)이 시안 K 표와 같은지 본다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MedalComposerTest {
    private val out = File(System.getProperty("autoShotsDir") ?: "build/auto-shots").apply { mkdirs() }
    private val fonts = TestMedals.fonts()

    private fun compose(v: String): Bitmap {
        val art = TestMedals.art(v)
        val b = MedalComposer.compose(TestMedals.all.getValue(v), art ?: MedalComposer.fallbackArt(), fonts)
        File(out, "medal-$v.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return b
    }

    private fun near(actual: Int, expected: Int, tol: Int = 24): Boolean =
        abs(Color.red(actual) - Color.red(expected)) <= tol && abs(Color.green(actual) - Color.green(expected)) <= tol &&
            abs(Color.blue(actual) - Color.blue(expected)) <= tol

    private fun hex(c: Int) = "#%06X".format(c and 0xFFFFFF)

    /** 고리(앞쪽 반) 위의 한 점 — 동전 밖 오른쪽 */
    private fun orbitPoint(rot: Double, rx: Double, deg: Double): Pair<Int, Int> {
        val a = Math.toRadians(deg)
        val lx = rx * cos(a)
        val ly = rx * .36 * sin(a)
        return (360 + lx * cos(rot) - ly * sin(rot)).toInt() to (300 + lx * sin(rot) + ly * cos(rot)).toInt()
    }

    @Test fun 크기와_종류별_색() {
        for ((v, m) in TestMedals.all) {
            val b = compose(v)
            assertEquals(720, b.width)
            assertEquals(720, b.height)
            val s = m.style
            // 배지: 위 가장자리 바로 아래 가운데 (글씨보다 위)
            val pill = b.getPixel(360, 521)
            assertTrue("$v 배지 ${hex(pill)} ≠ ${hex(s.pillBg)}", near(pill, s.pillBg, 6))
            // 고리: 동전 밖 앞쪽 반 위의 점 근처에서 고리 색에 가장 가까운 화소
            val (ox, oy) = orbitPoint(-0.42, 250.0, 25.0)
            val best = (-3..3).flatMap { dx -> (-3..3).map { dy -> b.getPixel(ox + dx, oy + dy) } }
                .minByOrNull { abs(Color.red(it) - Color.red(s.ring)) + abs(Color.green(it) - Color.green(s.ring)) + abs(Color.blue(it) - Color.blue(s.ring)) }!!
            assertTrue("$v 고리 ${hex(best)} ≠ ${hex(s.ring)}", near(best, s.ring, 30))
            // 진행 막대 왼쪽 끝 = #7DB59C
            val bar = b.getPixel(156, 689)
            assertTrue("$v 막대 ${hex(bar)}", near(bar, 0xFF7DB59C.toInt(), 12))
            // 막대 끝 (got/34) 너머는 비어 있음 (흰 18%)
            val end = (150 + 420f * m.got / m.total).toInt()
            val empty = b.getPixel(end + 8, 689)
            assertTrue("$v 막대 빈 칸 ${hex(empty)}", !near(empty, 0xFF7DB59C.toInt(), 30) && !near(empty, 0xFFFFD66E.toInt(), 30))
        }
    }

    @Test fun 축제_깃발과_쉿_배지() {
        val f = compose("festival")
        assertTrue("축제 깃발 ${hex(f.getPixel(564, 113))}", near(f.getPixel(564, 113), 0xFFA33B2B.toInt(), 6))
        val n = compose("normal")
        assertTrue("새 도장에는 깃발 없음", !near(n.getPixel(564, 113), 0xFFA33B2B.toInt(), 20))
        // 쉿: 위쪽 가운데 어두운 배지 + 노란 달
        val q = compose("quiet")
        val badge = q.getPixel(256, 52)
        assertTrue("쉿 배지 ${hex(badge)}", Color.red(badge) < 60 && Color.green(badge) < 60)
        val moonHit = (250..330).any { x -> (40..64).any { y -> near(q.getPixel(x, y), 0xFFFFD66E.toInt(), 30) } }
        assertTrue("쉿 달", moonHit)
        assertTrue("새 도장에는 쉿 배지 없음", !near(n.getPixel(256, 52), badge, 4) || Color.red(n.getPixel(256, 52)) > 60)
    }

    @Test fun 도장_그림이_없으면_기본_그림() {
        val b = MedalComposer.compose(TestMedals.normal, null, fonts)
        assertEquals(720, b.width)
        val withFallback = MedalComposer.compose(TestMedals.normal, MedalComposer.fallbackArt(), fonts)
        // 동전 가운데 = 기본 그림의 금빛 별 (반짝임 띠가 지나가 조금 밝다)
        val c = withFallback.getPixel(360, 300)
        assertTrue("별 ${hex(c)}", Color.red(c) > 200 && Color.green(c) > 150 && Color.blue(c) < 190)
        assertEquals(MedalComposer.CAR_SIZE, MedalComposer.forCar(withFallback).width)
    }
}
