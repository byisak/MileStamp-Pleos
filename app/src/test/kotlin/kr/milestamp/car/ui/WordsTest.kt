package kr.milestamp.car.ui

import kr.milestamp.engine.hhmm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 말·시각 표시 (폰 words.ts · timefmt.ts 12시간과 같은 글). */
class WordsTest {
    @Test fun 시각은_12시간() {
        assertEquals("오후 4:49", clock(hhmm("16:49")))
        assertEquals("오전 9:05", clock(hhmm("09:05")))
        assertEquals("오후 12:00", clock(hhmm("12:00")))
        assertEquals("오전 12:30", clock(30))
        assertEquals("오전 12:10", clock(24 * 60 + 10)) // 자정 넘김
        assertEquals("오후5:32", clock(hhmm("17:32"), compact = true))
    }

    @Test fun 범위는_오전오후가_같으면_한번만() {
        assertEquals("오후 2:10–3:30", clockRange(hhmm("14:10"), hhmm("15:30")))
        assertEquals("오전 11:40–오후 1:00", clockRange(hhmm("11:40"), hhmm("13:00")))
    }

    @Test fun 엔진_글_속_시각을_바꿈() {
        assertEquals("집에는 오후 4:47쯤 도착해요", clockText("집에는 16:47쯤 도착해요"))
        assertEquals("오후 12:50에 출발 · 1시간 30분", clockText("12:50에 출발 · 1시간 30분"))
        // 이미 오전/오후가 붙었거나 시각이 아닌 숫자는 그대로
        assertEquals("오후 4:47 도착", clockText("오후 4:47 도착"))
        assertEquals("v1.12:30", clockText("v1.12:30"))
        assertEquals("30:26", clockText("30:26"))
    }

    @Test fun 말_맞추기() {
        assertEquals("집 오후 4:17 도착 예정", arriveText("집", "오후 4:17"))
        assertEquals("할머니 집 오후 4:17 도착 예정", arriveText("할머니 집", "오후 4:17"))
        assertEquals("29번째 도장", stampNo(29))
        assertEquals("도장북 5/34칸", albumCount(5, 34))
        assertEquals("집으로", toward("집"))
        assertEquals("과학관으로", toward("과학관"))
        assertEquals("말로 듣기", W.listen)
        assertEquals("이걸로 바꾸기", W.adopt)
    }

    @Test fun 밤_화면_판단() {
        val rise = hhmm("06:46"); val set = hhmm("17:32")
        assertFalse(isNight(DayNight.AUTO, false, hhmm("08:30"), rise, set))
        assertTrue(isNight(DayNight.AUTO, false, hhmm("17:40"), rise, set))
        assertTrue(isNight(DayNight.AUTO, false, hhmm("05:00"), rise, set))
        // 차가 밤이라고 하면 (터널·조도) 낮에도 밤 화면
        assertTrue(isNight(DayNight.AUTO, true, hhmm("12:00"), rise, set))
        // 해 시각을 모르면 시스템만
        assertFalse(isNight(DayNight.AUTO, false, hhmm("23:00"), null, null))
        assertTrue(isNight(DayNight.NIGHT, false, hhmm("12:00"), rise, set))
        assertFalse(isNight(DayNight.DAY, true, hhmm("23:00"), rise, set))
    }

    @Test fun 밝게_어둡게_토큰이_폰과_같음() {
        assertEquals(0xFF6E6A62.toInt(), LightColors.ink3.toArgbInt())
        assertEquals(0xFF908C84.toInt(), DarkColors.ink3.toArgbInt())
        assertEquals(0xFF2C4A3E.toInt(), LightColors.accent.toArgbInt())
        assertEquals(0xFF7DB59C.toInt(), DarkColors.accent.toArgbInt())
        assertEquals(0xFF0F1A15.toInt(), DarkColors.onAccent.toArgbInt())
        assertEquals(0xFFF6F5F2.toInt(), LightColors.bg.toArgbInt())
        assertEquals(MsTone.entries.toSet(), LightColors.tones.keys)
        assertEquals(MsTone.entries.toSet(), DarkColors.tones.keys)
    }

    private fun androidx.compose.ui.graphics.Color.toArgbInt(): Int {
        fun c(f: Float) = (f * 255f + 0.5f).toInt()
        return (c(alpha) shl 24) or (c(red) shl 16) or (c(green) shl 8) or c(blue)
    }
}
