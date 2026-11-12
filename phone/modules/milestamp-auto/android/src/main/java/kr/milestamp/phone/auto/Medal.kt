package kr.milestamp.phone.auto

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import java.io.File

/*
 * 안드로이드 오토 도장 메달 (시안 proto/auto-medal.html, 승인본).
 * 안드로이드 오토는 정해진 틀(템플릿)만 쓸 수 있어 움직이는 연출 대신, 폰이 메달 '완성 장면'을 그림 한 장(720×720)으로
 * 합성해 안내 문단(Pane) 틀의 큰 그림 칸에 띄운다. 그림은 시안 compose()와 같은 순서·좌표로 그린다.
 * 다섯 가지: 새 도장 · 희귀 · 축제 · 다시 찍음 · 쉿 모드(같은 그림 + '조용히 찍었어요', 소리 없음)
 */

/** 메달 종류 (쉿 모드는 종류가 아니라 [MedalInfo.quiet] — 어느 종류에도 붙을 수 있다) */
enum class MedalKind { NORMAL, RARE, FESTIVAL, AGAIN }

/** 메달 한 장에 필요한 것 전부 (서버 답·도장 목록·명소 목록·코스에서 모은다) */
data class MedalInfo(
    /** 도장 칸 (축제는 fest-…, 비 오는 날 디아크는 thearc_rain) — 그림을 고를 때 */
    val key: String,
    val placeId: String,
    val name: String,
    /** 도장 번호 No. (모르면 null) */
    val number: Int?,
    /** 모은 도장 수 (찍은 뒤) */
    val got: Int,
    val total: Int = 34,
    /** 희귀 이유 ('비 오는 날'), 아니면 null */
    val rare: String? = null,
    /** 축제 한정 도장이면 계절 글씨 ('2026 가을') — 빈 글씨면 '기간 한정' */
    val festivalSeason: String? = null,
    /** 축제 마지막 날 'M/D' (예: 11/9) */
    val festivalUntil: String? = null,
    val festival: Boolean = false,
    /** 이 칸 몇 번째 방문 (1 = 처음) */
    val visit: Int = 1,
    /** 처음 찍은 날 'M/D' (다시 찍음에서) */
    val firstDay: String? = null,
    /** 묶음 이름·진행 ('우리 동네 평일 오후', 5, 9) */
    val groupTitle: String? = null,
    val groupGot: Int? = null,
    val groupTotal: Int? = null,
    /** 쉿 모드 (아이가 자는 중) — 소리 없음, 그림에 '조용히 찍었어요' */
    val quiet: Boolean = false,
    /** 폰 인증 도장 (GPS 궤적만으로 확인) */
    val phoneVerified: Boolean = false,
    /** 살아 있는 코스: 다음 갈 곳 · 출발 · 귀가 (없으면 null) */
    val nextName: String? = null,
    val departMin: Int? = null,
    val homeMin: Int? = null,
    val homeName: String = "집",
) {
    val kind: MedalKind
        get() = when {
            festival -> MedalKind.FESTIVAL
            visit > 1 -> MedalKind.AGAIN
            rare != null -> MedalKind.RARE
            else -> MedalKind.NORMAL
        }

    /** 화면 제목 */
    val title: String
        get() = when (kind) {
            MedalKind.NORMAL -> "도장 쾅!"
            MedalKind.RARE -> "희귀 도장!"
            MedalKind.FESTIVAL -> "축제 도장!"
            MedalKind.AGAIN -> "또 왔어요!"
        } + if (quiet) " (조용히)" else ""

    /** 배지(알약) 글씨 */
    val pill: String
        get() = when (kind) {
            MedalKind.NORMAL -> "도장 획득!"
            MedalKind.RARE -> "희귀 · $rare"
            MedalKind.FESTIVAL -> "축제 도장!"
            MedalKind.AGAIN -> "또 왔어요! · ${visit}번째"
        }

    val style: MedalStyle get() = MedalStyle.of(kind)

    private val noPrefix get() = number?.let { "${it}번째 도장 · " } ?: ""

    /** 메달 그림 이름 아래 한 줄 */
    val imageSub: String
        get() = when (kind) {
            MedalKind.AGAIN -> "${visit}번째 방문 · 도장북 $got/${total}칸"
            MedalKind.RARE -> "${noPrefix}희귀 · $rare"
            MedalKind.FESTIVAL -> "${noPrefix}축제 도장${festivalSeason?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: " · 기간 한정"}"
            MedalKind.NORMAL -> "$noPrefix${groupTitle ?: "대구·경북 시즌 1"}"
        }

    /** 화면 첫 줄 아래 글 */
    val row1Sub: String
        get() = if (kind == MedalKind.AGAIN) listOfNotNull(firstDay?.let { "처음 찍은 날 $it" }, number?.let { "${it}번째 도장" }).joinToString(" · ").ifEmpty { "다시 찍었어요" }
        else imageSub + if (phoneVerified) " · 폰 인증" else ""

    /** 화면 둘째 줄 아래 글 (묶음 진행·축제 기간·방문 횟수·쉿) */
    val row2Sub: String
        get() = when {
            quiet -> "조용히 찍었어요 · 깨면 같이 봐요"
            kind == MedalKind.AGAIN -> "${visit}번째 방문"
            kind == MedalKind.FESTIVAL -> festivalUntil?.let { "${it}까지만 찍을 수 있어요" } ?: "기간 한정 도장이에요"
            kind == MedalKind.RARE -> "희귀 도장 · 날씨가 맞을 때만"
            groupGot != null && groupTotal != null -> "이번 묶음 $groupGot / $groupTotal"
            else -> "도장북에 넣었어요"
        }

    /** 주행 중 알림 한 줄 */
    val alertLine: String get() = "${title.removeSuffix(" (조용히)")} $name · 도장북 $got/${total}칸"
    val alertSub: String get() = (if (quiet) "조용히 찍었어요 · " else "") + "멈추면 크게 보여 드려요"

    /** 음성 한 문장 (쉿 모드면 null) */
    val voice: String?
        get() = if (quiet) null else when (kind) {
            MedalKind.NORMAL -> "도장 쾅! $name, ${number?.let { KoreanWords.ordinal(it) + " 도장이에요." } ?: "도장북에 넣었어요."}"
            MedalKind.RARE -> "희귀 도장이에요! $name${KoreanWords.eulReul(name)} 모았어요."
            MedalKind.FESTIVAL -> "축제 도장 쾅! $name, " +
                (festivalSeason?.trim()?.split(' ')?.lastOrNull()?.takeIf { it in SEASONS }?.let { "이번 ${it}에만 찍을 수 있는 도장이에요." } ?: "기간 한정 도장이에요.")
            MedalKind.AGAIN -> "또 왔어요! $name ${KoreanWords.ordinal(visit)} 방문이에요."
        }

    companion object {
        private val SEASONS = setOf("봄", "여름", "가을", "겨울")
    }
}

/** 종류별 색 (시안 K 표) */
data class MedalStyle(val pillBg: Int, val pillFg: Int, val ring: Int) {
    companion object {
        fun of(k: MedalKind) = when (k) {
            MedalKind.NORMAL -> MedalStyle(0xFFF2B230.toInt(), 0xFF1D1400.toInt(), 0xFFF2B230.toInt())
            MedalKind.RARE -> MedalStyle(0xFFE9C46A.toInt(), 0xFF2A1D00.toInt(), 0xFFFFE08A.toInt())
            MedalKind.FESTIVAL -> MedalStyle(0xFFA33B2B.toInt(), Color.WHITE, 0xFFE07A5F.toInt())
            MedalKind.AGAIN -> MedalStyle(0xFF5F6368.toInt(), Color.WHITE, 0xFFBDC1C6.toInt())
        }
    }
}

/** 우리말 수·조사 (음성 문장용) */
object KoreanWords {
    private val ONES = listOf("", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉")
    private val TENS = listOf("", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔")

    /** 15 → '열다섯 번째', 1 → '첫 번째', 20 → '스무 번째' (100 이상은 숫자) */
    fun ordinal(n: Int): String = when {
        n == 1 -> "첫 번째"
        n in 2..99 -> {
            val t = n / 10
            val o = n % 10
            val tens = if (t == 2 && o == 0) "스무" else TENS[t]
            "$tens${ONES[o]} 번째"
        }
        else -> "${n}번째"
    }

    private fun hasBatchim(word: String): Boolean {
        val c = word.trim().lastOrNull()?.code ?: return false
        return c in 0xAC00..0xD7A3 && (c - 0xAC00) % 28 != 0
    }

    fun eulReul(word: String) = if (hasBatchim(word)) "을" else "를"
}

/** 메달에 쓰는 글꼴 (Pretendard — 폰 앱이 expo-font로 APK의 assets/fonts/에 넣어 둔다. 없으면 기본 굵은 글꼴) */
class MedalFonts(val xb: Typeface, val b: Typeface, val sb: Typeface) {
    companion object {
        private const val XB = "Pretendard-ExtraBold.otf"
        private const val B = "Pretendard-Bold.otf"
        private const val SB = "Pretendard-SemiBold.otf"
        @Volatile private var cached: MedalFonts? = null

        fun load(ctx: Context): MedalFonts = cached ?: run {
            fun f(name: String, fallback: Int) = runCatching { Typeface.createFromAsset(ctx.assets, "fonts/$name") }
                .getOrElse { Typeface.create(Typeface.DEFAULT, fallback) }
            MedalFonts(f(XB, Typeface.BOLD), f(B, Typeface.BOLD), f(SB, Typeface.BOLD)).also { cached = it }
        }

        /** 폴더에서 (시험: phone/assets/fonts) */
        fun fromDir(dir: File): MedalFonts {
            fun f(name: String) = File(dir, name).takeIf { it.exists() }?.let { runCatching { Typeface.createFromFile(it) }.getOrNull() }
                ?: Typeface.DEFAULT_BOLD
            return MedalFonts(f(XB), f(B), f(SB))
        }

        fun fallback() = MedalFonts(Typeface.DEFAULT_BOLD, Typeface.DEFAULT_BOLD, Typeface.DEFAULT_BOLD)
    }
}

/**
 * 720×720 메달 그림 (시안 compose()와 같은 순서·좌표).
 * 배경 흐림은 RenderScript 없이: 도장 그림을 64px로 줄여 상자 흐림 3번 → 필터를 켜고 크게 늘린다.
 */
object MedalComposer {
    const val SIZE = 720
    private const val CX = 360f
    private const val CY = 300f
    private const val COIN_R = 190f

    fun compose(info: MedalInfo, art: Bitmap?, fonts: MedalFonts): Bitmap {
        val bmp = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val s = info.style
        val W = SIZE.toFloat()
        val H = SIZE.toFloat()
        c.drawColor(Color.BLACK)

        // 배경: 도장 그림 크게·흐리게 (blur 18px · 채도 1.2 · 밝기 .55)
        if (art != null) {
            val small = blurSmall(art)
            val cm = ColorMatrix().apply { setSaturation(1.2f) }
            cm.postConcat(ColorMatrix().apply { setScale(0.55f, 0.55f, 0.55f, 1f) })
            val p = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG).apply { colorFilter = ColorMatrixColorFilter(cm) }
            // 도장 그림은 둥근 그림(모서리 투명)이라 크게 깔면 네 모서리가 어둡게 남는다 (시안과 같음)
            c.drawBitmap(small, null, RectF(-120f, -120f, W + 120f, H + 120f), p)
        }
        Paint().apply {
            shader = LinearGradient(0f, 0f, 0f, H, intArrayOf(argb(.35f, 0, 0, 0), argb(0f, 0, 0, 0), argb(.85f, 8, 14, 11)), floatArrayOf(0f, .55f, 1f), Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, W, H, this)
        }
        // 빛 (안쪽 반지름 40 → 바깥 330)
        Paint().apply {
            val inner = argb(.45f, 255, 226, 140)
            shader = RadialGradient(CX, CY, 330f, intArrayOf(inner, inner, argb(0f, 255, 226, 140)), floatArrayOf(0f, 40f / 330f, 1f), Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, W, H, this)
        }
        // 궤도 고리 뒤쪽 반
        orbit(c, s.ring, -0.42f, 250f, front = false)
        orbit(c, s.ring, 0.49f, 228f, front = false)

        // 동전: 금빛 빛무리 + 검은 바탕
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            setShadowLayer(34f, 0f, 0f, argb(.7f, 255, 214, 110))
            c.drawCircle(CX, CY, COIN_R, this)
        }
        val coin = Path().apply { addCircle(CX, CY, COIN_R, Path.Direction.CW) }
        c.save()
        c.clipPath(coin)
        if (art != null) c.drawBitmap(art, null, RectF(170f, 110f, 550f, 490f), Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        if (info.kind == MedalKind.AGAIN) c.drawRect(170f, 110f, 550f, 490f, Paint().apply { color = argb(.08f, 0, 0, 0) })
        c.restore()
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 4f; color = argb(.9f, 255, 236, 170)
            c.drawCircle(CX, CY, 192f, this)
        }
        orbit(c, s.ring, -0.42f, 250f, front = true)
        orbit(c, s.ring, 0.49f, 228f, front = true)

        // 반짝임 (대각선 빛줄기)
        c.save()
        c.clipPath(coin)
        Paint().apply {
            val clear = argb(0f, 255, 255, 255)
            shader = LinearGradient(220f, 150f, 500f, 450f, intArrayOf(clear, clear, argb(.35f, 255, 255, 255), clear, clear), floatArrayOf(0f, .35f, .5f, .65f, 1f), Shader.TileMode.CLAMP)
            c.drawRect(160f, 100f, 560f, 500f, this)
        }
        c.restore()

        // 배지
        val pillText = text(fonts.xb, 30f, s.pillFg)
        val pw = pillText.measureText(info.pill) + 56f
        val py = 516f
        c.drawRoundRect(RectF(CX - pw / 2, py, CX + pw / 2, py + 56f), 28f, 28f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = s.pillBg })
        drawMid(c, info.pill, CX, py + 29f, pillText)

        // 이름 + 한 줄 + 진행 막대
        drawMid(c, ellipsize(info.name, text(fonts.xb, 34f, Color.WHITE), 640f), CX, 618f, text(fonts.xb, 34f, Color.WHITE))
        val subP = text(fonts.sb, 22f, argb(.75f, 255, 255, 255))
        drawMid(c, ellipsize(info.imageSub, subP, 660f), CX, 656f, subP)
        val bw = 420f
        val bx = 150f
        val by = 684f
        c.drawRoundRect(RectF(bx, by, bx + bw, by + 10f), 5f, 5f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = argb(.18f, 255, 255, 255) })
        val frac = if (info.total > 0) (info.got.toFloat() / info.total).coerceIn(0f, 1f) else 0f
        if (frac > 0f) Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(bx, 0f, bx + bw, 0f, 0xFF7DB59C.toInt(), 0xFFFFD66E.toInt(), Shader.TileMode.CLAMP)
            c.drawRoundRect(RectF(bx, by, bx + bw * frac, by + 10f), 5f, 5f, this)
        }

        // 축제 깃발 + 계절 (글씨가 깃발보다 길면 깃발을 늘린다)
        if (info.kind == MedalKind.FESTIVAL) {
            val label = info.festivalSeason?.takeIf { it.isNotBlank() } ?: "기간 한정"
            val tp = text(fonts.b, 15f, Color.WHITE)
            val fw = maxOf(50f, tp.measureText(label) + 26f)
            val x0 = 560f
            val flag = Path().apply {
                moveTo(x0, 110f); lineTo(x0 + fw, 110f); lineTo(x0 + fw - 14f, 128f); lineTo(x0 + fw, 146f); lineTo(x0, 146f); close()
            }
            c.drawPath(flag, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFA33B2B.toInt() })
            drawMid(c, label, x0 + (fw - 10f) / 2, 128f, tp)
        }
        // 쉿 모드: 위쪽 가운데 '🌙 조용히 찍었어요' (그림 글꼴에 이모지가 없어 달은 직접 그린다)
        if (info.quiet) {
            c.drawRoundRect(RectF(250f, 30f, 470f, 74f), 22f, 22f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = argb(.55f, 0, 0, 0) })
            val tp = text(fonts.b, 20f, Color.WHITE)
            val label = "조용히 찍었어요"
            val tw = tp.measureText(label)
            val moonW = 20f
            val gap = 8f
            val x0 = CX - (moonW + gap + tw) / 2
            moon(c, x0 + moonW / 2, 52f, 9f)
            drawMid(c, label, x0 + moonW + gap + tw / 2, 53f, tp)
        }
        return bmp
    }

    /** 차로 보낼 크기 (720 그대로는 차 연결 통로에 무겁다 — 호스트가 어차피 칸에 맞춰 줄인다) */
    fun forCar(full: Bitmap, size: Int = CAR_SIZE): Bitmap = Bitmap.createScaledBitmap(full, size, size, true)
    const val CAR_SIZE = 400

    // ------------------------------------------------------------ 그리기 도구

    private fun argb(a: Float, r: Int, g: Int, b: Int) = Color.argb((a * 255).toInt().coerceIn(0, 255), r, g, b)

    private fun text(tf: Typeface, size: Float, color: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = tf; textSize = size; this.color = color; textAlign = Paint.Align.CENTER
    }

    /** 캔버스 textBaseline='middle'처럼 [cy]를 글자 가운데로 */
    private fun drawMid(c: Canvas, s: String, cx: Float, cy: Float, p: Paint) {
        val fm = p.fontMetrics
        c.drawText(s, cx, cy - (fm.ascent + fm.descent) / 2, p)
    }

    private fun ellipsize(s: String, p: Paint, max: Float): String {
        if (p.measureText(s) <= max) return s
        var t = s
        while (t.length > 1 && p.measureText("$t…") > max) t = t.dropLast(1)
        return "$t…"
    }

    /** 기울어진 타원 고리의 뒤쪽(위) 반 또는 앞쪽(아래) 반 — 동전 앞뒤로 나눠 그려 동전을 감싸 도는 것처럼 */
    private fun orbit(c: Canvas, color: Int, rot: Float, rx: Float, front: Boolean) {
        val ry = rx * .36f
        c.save()
        c.translate(CX, CY)
        c.rotate(Math.toDegrees(rot.toDouble()).toFloat())
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 4f; this.color = color
            setShadowLayer(11f, 0f, 0f, color)
        }
        c.drawArc(RectF(-rx, -ry, rx, ry), if (front) 0f else 180f, 180f, false, p)
        c.restore()
    }

    private fun moon(c: Canvas, cx: Float, cy: Float, r: Float) {
        val outer = Path().apply { addCircle(cx, cy, r, Path.Direction.CW) }
        val cut = Path().apply { addCircle(cx + r * .55f, cy - r * .35f, r * .85f, Path.Direction.CW) }
        outer.op(cut, Path.Op.DIFFERENCE)
        c.drawPath(outer, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFD66E.toInt() })
    }

    /** 흐린 배경용: 64px로 줄이고 상자 흐림(반지름 1) 3번 ≈ 가우스 흐림 (720 그림에서 약 18px) */
    internal fun blurSmall(src: Bitmap, n: Int = 64): Bitmap {
        val small = Bitmap.createScaledBitmap(src.copy(Bitmap.Config.ARGB_8888, false), n, n, true)
        val px = IntArray(n * n)
        small.getPixels(px, 0, n, 0, 0, n, n)
        // 투명한 둘레가 검게 번지지 않게 미리 곱한 색(premultiplied)으로 흐린 뒤 되돌린다
        var a = IntArray(px.size) { i -> premul(px[i], true) }
        repeat(3) { a = boxBlur(boxBlur(a, n, horizontal = true), n, horizontal = false) }
        return Bitmap.createBitmap(IntArray(a.size) { i -> premul(a[i], false) }, n, n, Bitmap.Config.ARGB_8888)
    }

    private fun premul(p: Int, on: Boolean): Int {
        val al = p ushr 24
        if (al == 0) return 0
        fun ch(v: Int) = if (on) v * al / 255 else minOf(255, v * 255 / al)
        return (al shl 24) or (ch((p shr 16) and 255) shl 16) or (ch((p shr 8) and 255) shl 8) or ch(p and 255)
    }

    private fun boxBlur(src: IntArray, n: Int, horizontal: Boolean): IntArray {
        val out = IntArray(src.size)
        for (y in 0 until n) for (x in 0 until n) {
            var a = 0; var r = 0; var g = 0; var b = 0; var k = 0
            for (d in -1..1) {
                val xx = if (horizontal) (x + d).coerceIn(0, n - 1) else x
                val yy = if (horizontal) y else (y + d).coerceIn(0, n - 1)
                val p = src[yy * n + xx]
                a += p ushr 24; r += (p shr 16) and 255; g += (p shr 8) and 255; b += p and 255; k++
            }
            out[y * n + x] = ((a / k) shl 24) or ((r / k) shl 16) or ((g / k) shl 8) or (b / k)
        }
        return out
    }

    /** 도장 그림을 못 받았을 때 동전 안에 넣을 기본 그림 (잉크 초록 원 + 금빛 별) */
    fun fallbackArt(size: Int = 512): Bitmap {
        val b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        val k = size / 96f
        c.scale(k, k)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        c.drawColor(0xFF2C4A3E.toInt())
        p.color = 0xFFF4F1EA.toInt(); c.drawCircle(48f, 48f, 40f, p)
        p.color = 0xFF2C4A3E.toInt(); c.drawCircle(48f, 48f, 35f, p)
        p.color = 0xFFF2B230.toInt()
        val star = Path()
        for (i in 0 until 10) {
            val ang = Math.toRadians((-90 + i * 36).toDouble())
            val r = if (i % 2 == 0) 22.0 else 9.5
            val x = 48 + r * Math.cos(ang)
            val y = 50 + r * Math.sin(ang)
            if (i == 0) star.moveTo(x.toFloat(), y.toFloat()) else star.lineTo(x.toFloat(), y.toFloat())
        }
        star.close()
        c.drawPath(star, p)
        return b
    }

}
