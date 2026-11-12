package kr.milestamp.car.ui

import android.app.UiModeManager
import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kr.milestamp.engine.Tone

/*
 * 차 화면 토큰 = 폰 phone/src/theme.ts와 **같은 값** (밝게·어둡게 두 벌, docs/디자인-점검/4-system.md 6절 표).
 * 글자·크기는 폰 × 약 1.4 (차 기준: 정보 글씨 24sp 이상, 누르는 칸 76dp 이상).
 * 큰 버튼(화면에 하나)은 잉크 초록 accent, 그 위 글자는 onAccent. 노랑(point)은 로고 점에만, 빨강 글자는 redText.
 * 색은 이름(tone)으로만 고른다 — 화면 코드에 Color(0x…)를 직접 쓰지 않는다 (도장 메달 연출만 예외: 늘 어두운 연출 화면).
 */

/** 칩 색 이름 (폰 ToneName과 같음). */
enum class MsTone { PLAIN, STAMP, NAP, SUN, RAIN, FESTIVAL, AIR, WARN, OK }

/** 하루 막대 색 (폰 theme.bar). */
@Immutable
data class MsBar(
    val drive: Color, val stay: Color, val nap: Color, val napStripe: Color, val home: Color,
    val track: Color, val markSun: Color, val markSunText: Color, val markNow: Color, val markDinner: Color,
)

@Immutable
data class MsColors(
    val bg: Color, val surface: Color, val fill: Color, val fill2: Color,
    val ink: Color, val ink2: Color,
    /** 보조 글씨 (bg 4.9 · surface 5.4 · fill 4.6 : 1). */
    val ink3: Color,
    /** 장식·꺼진 것만 (글자 금지). */
    val ink4: Color,
    val line: Color,
    val accent: Color, val accentSoft: Color, val accentInk: Color, val onAccent: Color,
    val point: Color,
    val red: Color, val redSoft: Color, val redText: Color,
    val ok: Color, val okSoft: Color, val okText: Color,
    /** 화면을 덮는 겹창 뒤 어둡게 */
    val dim: Color,
    val tones: Map<MsTone, Pair<Color, Color>>,
    val bar: MsBar,
    val dark: Boolean,
) {
    /** 칩 [바탕, 글자]. */
    fun tone(t: MsTone): Pair<Color, Color> = tones.getValue(t)
}

val LightColors = MsColors(
    bg = Color(0xFFF6F5F2), surface = Color(0xFFFFFFFF), fill = Color(0xFFEFEDE8), fill2 = Color(0xFFE4E1DA),
    ink = Color(0xFF111110), ink2 = Color(0xFF55534E), ink3 = Color(0xFF6E6A62), ink4 = Color(0xFF9A968D), line = Color(0xFFE7E4DD),
    accent = Color(0xFF2C4A3E), accentSoft = Color(0xFFE5EEE9), accentInk = Color(0xFF22392F), onAccent = Color(0xFFFFFFFF),
    point = Color(0xFFF2B230),
    red = Color(0xFFE5484D), redSoft = Color(0xFFFDECEC), redText = Color(0xFFCA2A2F),
    ok = Color(0xFF1F9D55), okSoft = Color(0xFFE7F6EC), okText = Color(0xFF18794E),
    dim = Color(0x61111110),
    tones = mapOf(
        MsTone.PLAIN to (Color(0xFFEFEDE8) to Color(0xFF55534E)),
        MsTone.STAMP to (Color(0xFFE5EEE9) to Color(0xFF22392F)),
        MsTone.NAP to (Color(0xFFEDF2FE) to Color(0xFF3E63DD)),
        MsTone.SUN to (Color(0xFFFFF4DB) to Color(0xFF8F5D00)),
        MsTone.RAIN to (Color(0xFFE9EFF5) to Color(0xFF466488)),
        MsTone.FESTIVAL to (Color(0xFFF8E9E5) to Color(0xFFA33B2B)),
        MsTone.AIR to (Color(0xFFFDEBE3) to Color(0xFFB4441F)),
        MsTone.WARN to (Color(0xFFFDECEC) to Color(0xFFCA2A2F)),
        MsTone.OK to (Color(0xFFE7F6EC) to Color(0xFF18794E)),
    ),
    bar = MsBar(
        drive = Color(0xFFB9B6AE), stay = Color(0xFF2C4A3E), nap = Color(0xFF7E95C9), napStripe = Color(0xFF9DB0DA), home = Color(0xFFE3B04B),
        track = Color(0xFFEFEDE8), markSun = Color(0xFFE8902A), markSunText = Color(0xFFA65A00), markNow = Color(0xFF111110), markDinner = Color(0xFF6E6A62),
    ),
    dark = false,
)

val DarkColors = MsColors(
    bg = Color(0xFF0F0F0E), surface = Color(0xFF1A1A19), fill = Color(0xFF242422), fill2 = Color(0xFF30302D),
    ink = Color(0xFFF2F1EE), ink2 = Color(0xFFB5B2AB), ink3 = Color(0xFF908C84), ink4 = Color(0xFF7D7A73), line = Color(0xFF2A2A28),
    accent = Color(0xFF7DB59C), accentSoft = Color(0xFF1A2A23), accentInk = Color(0xFFA9D6C2), onAccent = Color(0xFF0F1A15),
    point = Color(0xFFF2B230),
    red = Color(0xFFFF6369), redSoft = Color(0xFF3A1A1B), redText = Color(0xFFFF6369),
    ok = Color(0xFF3DD68C), okSoft = Color(0xFF16301F), okText = Color(0xFF3DD68C),
    dim = Color(0x99000000),
    tones = mapOf(
        MsTone.PLAIN to (Color(0xFF242422) to Color(0xFFB5B2AB)),
        MsTone.STAMP to (Color(0xFF1A2A23) to Color(0xFFA9D6C2)),
        MsTone.NAP to (Color(0xFF1B2340) to Color(0xFF7B9BFF)),
        MsTone.SUN to (Color(0xFF3A2E14) to Color(0xFFF2C66B)),
        MsTone.RAIN to (Color(0xFF1E2833) to Color(0xFF9BB7D6)),
        MsTone.FESTIVAL to (Color(0xFF3A1E19) to Color(0xFFF0A08F)),
        MsTone.AIR to (Color(0xFF3A2219) to Color(0xFFF2A27E)),
        MsTone.WARN to (Color(0xFF3A1A1B) to Color(0xFFFF6369)),
        MsTone.OK to (Color(0xFF16301F) to Color(0xFF3DD68C)),
    ),
    bar = MsBar(
        drive = Color(0xFF5E5B55), stay = Color(0xFF7DB59C), nap = Color(0xFF5A6FA8), napStripe = Color(0xFF7A8DC4), home = Color(0xFFC99A3E),
        track = Color(0xFF242422), markSun = Color(0xFFE8902A), markSunText = Color(0xFFF0A54A), markNow = Color(0xFFF2F1EE), markDinner = Color(0xFF908C84),
    ),
    dark = true,
)

/** 엔진 이유 칩 색 이름 → 차 칩 색 이름. */
fun Tone.ms(): MsTone = when (this) {
    Tone.PLAIN -> MsTone.PLAIN
    Tone.SUN -> MsTone.SUN
    Tone.STAMP -> MsTone.STAMP
    Tone.NAP -> MsTone.NAP
    Tone.RAIN -> MsTone.RAIN
    Tone.FESTIVAL -> MsTone.FESTIVAL
    Tone.AIR -> MsTone.AIR
    // 밥 칩은 보통 색 (아이콘 숟가락으로 구별)
    Tone.MEAL -> MsTone.PLAIN
}

val LocalMsColors = staticCompositionLocalOf { LightColors }

/** 꿀앱 그래파이트 체계 × 차량 1.4배. 색은 [c](지금 낮/밤 한 벌), 크기·간격·모서리는 고정 값. */
object Ms {
    /** 지금 색 한 벌 (낮/밤). */
    val c: MsColors @Composable get() = LocalMsColors.current

    // 글자 (폰 TYPE × 1.4 · 차 최소 24sp — 정보 글씨는 cap 아래로 내리지 않는다)
    /** 첫 화면 인사·요약 제목 */
    val display = 54.sp
    /** 다음 목적지 이름 (NextHero) */
    val hero = 50.sp
    val h2 = 38.sp
    val title = 30.sp
    /** 큰 버튼 글 */
    val btn = 30.sp
    /** 작은 버튼 줄 글 */
    val act = 26.sp
    val body = 26.sp
    val sub = 24.sp
    /** 칩 */
    val chip = 24.sp
    /** 시각·보조 (차 최소) */
    val cap = 24.sp
    /** 하루 막대 눈금처럼 그림 위 짧은 표시만 */
    val mark = 22.sp

    // 크기 (누르는 칸은 touch 76dp 아래로 내리지 않는다)
    val touch = 76.dp
    /** 작은 버튼 줄 */
    val actH = 88.dp
    /** 화면에 하나뿐인 큰 버튼 */
    val ctaH = 108.dp
    val headerH = 101.dp

    // 모서리 (폰 R과 같은 이름)
    val rSm = 10.dp
    val rMd = 16.dp
    val rLg = 22.dp
    val rXl = 28.dp

    // 간격 (폰 S × 1.5)
    val sXs = 6.dp
    val sS = 9.dp
    val sM = 12.dp
    val sL = 18.dp
    val sXl = 24.dp
    val sXxl = 30.dp
    val sSec = 36.dp
    /** 화면 가장자리 */
    val page = 36.dp
}

/** 낮/밤을 고르는 방식. AUTO = 차의 밤 모드(시스템) 또는 해 시각. 디버그 입력 THEME으로 고정할 수 있다. */
enum class DayNight { AUTO, DAY, NIGHT }

/**
 * 밤 화면인지. AAOS는 차의 낮/밤 신호(조도·전조등 NIGHT_MODE)를 시스템 밤 모드(UiModeManager → Configuration)로
 * 내려 준다 → [systemNight]. 그 신호가 없거나 낮이라고 해도, 해가 졌거나(해 짐 뒤) 아직 안 떴으면(해 뜨기 전) 밤.
 * 해 시각을 모르면 시스템만 따른다.
 */
fun isNight(mode: DayNight, systemNight: Boolean, nowMin: Int?, sunriseMin: Int?, sunsetMin: Int?): Boolean = when (mode) {
    DayNight.DAY -> false
    DayNight.NIGHT -> true
    DayNight.AUTO -> systemNight || (nowMin != null && sunriseMin != null && sunsetMin != null && (nowMin >= sunsetMin || nowMin < sunriseMin))
}

/** 시스템(차) 밤 모드: Configuration의 밤 표시 또는 UiModeManager가 밤으로 정해 둔 것. */
@Composable
private fun systemNight(): Boolean {
    val ctx = LocalContext.current
    val um = runCatching { ctx.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager }.getOrNull()
    return isSystemInDarkTheme() || um?.nightMode == UiModeManager.MODE_NIGHT_YES
}

/**
 * 앱 테마. [night]를 주면 그대로(화면 캡처·시험), 안 주면 [mode]·시스템 밤 모드·해 시각으로 고른다.
 */
@Composable
fun MileStampTheme(
    night: Boolean? = null,
    mode: DayNight = DayNight.AUTO,
    nowMin: Int? = null,
    sunriseMin: Int? = null,
    sunsetMin: Int? = null,
    content: @Composable () -> Unit,
) {
    val dark = night ?: isNight(mode, systemNight(), nowMin, sunriseMin, sunsetMin)
    val c = if (dark) DarkColors else LightColors
    val scheme = if (dark) darkColorScheme(
        primary = c.accent, onPrimary = c.onAccent, background = c.bg, surface = c.surface,
        onSurface = c.ink, onBackground = c.ink, error = c.redText, outline = c.line,
    ) else lightColorScheme(
        primary = c.accent, onPrimary = c.onAccent, background = c.bg, surface = c.surface,
        onSurface = c.ink, onBackground = c.ink, error = c.redText, outline = c.line,
    )
    CompositionLocalProvider(LocalMsColors provides c) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
