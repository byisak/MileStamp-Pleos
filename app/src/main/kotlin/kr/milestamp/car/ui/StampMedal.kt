package kr.milestamp.car.ui

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.composables.icons.lucide.BookOpen
import com.composables.icons.lucide.Check
import com.composables.icons.lucide.Navigation
import com.composables.icons.lucide.Smartphone
import com.composables.icons.lucide.Gem
import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.PartyPopper
import kr.milestamp.car.net.FestivalMeta
import kr.milestamp.car.net.RemoteStamps
import com.composables.icons.lucide.MapPin
import com.composables.icons.lucide.Stamp
import com.composables.icons.lucide.VolumeX
import com.composables.icons.lucide.X
import kr.milestamp.car.net.StampRow
import kr.milestamp.car.trip.StampShown
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/*
 * 차 도장 획득 화면 = 폰 메달(phone/src/medal.tsx, 시안 proto/medal3.html)을 Pleos 옆 창에 맞춘 것. 이 화면만은 늘 어두운 색.
 * 배경은 같은 도장 그림을 크게·흐리게(작게 줄였다 키움) 깔고 흑백·어둡게 시작 → 동전 쾅(크게·기울어 있다가 제자리) →
 * 흔들림·쾅 고리·꽃가루 → 배경·동전 컬러로 → 금빛 후광·궤도 고리 2개·노란 알약 → 유리 카드 → 반짝 → 숫자·막대 → 버튼.
 * 모두 시계 하나(0~2초)로 그린다. 폰보다 0.9배 빠르게, 끝없이 도는 움직임은 없음.
 * 쉿 모드 도장: 소리는 TripService가 안 내고, 화면은 같다(카드에 '조용히 찍었어요').
 */

private const val TOTAL_MS = 2000f
private const val AUTO_CLOSE_MS = 15_000L
private val GOLD = Color(0xFFF2B230)
/** 축제 한정 도장 붉은 인주 (관리자·폰과 같은 #A33B2B). */
private val FEST_RED = Color(0xFFA33B2B)
private val GOLD2 = Color(0xFFFFD66E)
private val PILL_INK = Color(0xFF1D1400)
private val BASE = Color(0xFF0B0F0D)

private val OUT_CUBIC = CubicBezierEasing(0.33f, 1f, 0.68f, 1f)
private val IN_OUT = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)
private val EASE_OUT = CubicBezierEasing(0f, 0f, 0.58f, 1f)
private val SLAM = CubicBezierEasing(0.3f, 1.35f, 0.5f, 1f)   // 쾅: 살짝 지나쳤다 돌아옴
private val POP = CubicBezierEasing(0.2f, 1.5f, 0.4f, 1f)

/** [delay]부터 [dur] 동안 0→1 (ms). */
private fun seg(t: Float, delay: Float, dur: Float, e: Easing = OUT_CUBIC) = e.transform(((t - delay) / dur).coerceIn(0f, 1f))
private fun lerp(a: Float, b: Float, k: Float) = a + (b - a) * k

/** 시각표 (ms) — 폰 시각 × 0.9. */
private class Timeline(val t: Float) {
    val bg = seg(t, 0f, 225f)
    val kb = seg(t, 0f, TOTAL_MS, EASE_OUT)
    val coin = seg(t, 135f, 495f, SLAM)
    val coinLin = ((t - 135f) / 495f).coerceIn(0f, 1f)
    val ring = ((t - 576f) / 675f).coerceIn(0f, 1f)
    val shake = ((t - 594f) / 315f).coerceIn(0f, 1f)
    val confMs = t - 630f
    val sun = seg(t, 630f, 720f, IN_OUT)
    val color = seg(t, 675f, 810f, IN_OUT)
    val glow = seg(t, 900f, 900f, IN_OUT)
    val orbit1 = seg(t, 945f, 900f, IN_OUT)
    val orbit2 = seg(t, 1035f, 900f, IN_OUT)
    val pill = seg(t, 945f, 405f, POP)
    val card = seg(t, 1125f, 450f, EASE_OUT)
    val shine = seg(t, 1350f, 600f, IN_OUT)
    val bar = seg(t, 1300f, 500f, CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f))
    val bumpMs = t - 1440f
    val cta = seg(t, 1575f, 375f, EASE_OUT)
}

/**
 * 도장 획득 화면. [collected] = 도장북 기록(서버 저장본 + 차 기록) — 모은 칸 수 '전 → 후'를 센다.
 * [fixedMs]를 주면 그 순간에 멈춘 그림 (화면 캡처용).
 */
@Composable
fun StampMedalScreen(
    s: StampShown, collected: List<StampRow>, narrow: Boolean, wide: Boolean,
    onOpenBook: () -> Unit, onClose: () -> Unit, fixedMs: Float? = null,
    /** 카드 아래 '다음 · 국립대구과학관 · 오후 12:40 출발 예정' (코스가 없으면 null). */
    next: String? = null,
    /** '이야기는 폰으로 이어 듣기'를 이미 눌렀으면 '가족 폰으로 보냈어요'. */
    storySent: Boolean = false,
    onStoryToPhone: () -> Unit = {},
) {
    val id = "${s.place.id}#${s.number}"
    val clock = remember(id) { Animatable(fixedMs ?: 0f) }
    LaunchedEffect(id, fixedMs) {
        if (fixedMs == null) {
            clock.animateTo(TOTAL_MS, tween(TOTAL_MS.toInt(), easing = LinearEasing))
            // 차에서는 아무도 안 누를 수 있다 → 15초 뒤 저절로 닫고 다음 장소(코스 화면)로
            kotlinx.coroutines.delay(AUTO_CLOSE_MS)
            onClose()
        }
    }
    val tl = Timeline(fixedMs ?: clock.value)

    val rare = s.rare != null
    val key = StampAlbum.keyOf(s.place.id, s.rare)
    // 축제 한정 도장: 붉은 테·붉은 알약 '축제 도장!'·붉은/금빛 꽃가루. 그림은 축제 것 → 붙은 명소 것
    val fest = s.place.festival
    val artId = fest?.let { it.placeId ?: s.place.id } ?: s.place.id
    val item = if (fest != null) null else StampAlbum.item(key)
    // 그림: 비 오는 날 디아크만 따로 그린 그림 (밤의 ○○는 장소 그림 그대로)
    val rainArt = rare && s.rare != RARE_NIGHT
    val res = StampArt.of(artId, rainArt)
    val painter = if (fest != null) festivalPainter(fest.id, fest.placeId) else stampPainter(s.place.id, rainArt)
    val remoteFile = remember(s.place.id, rainArt) { if (fest != null) RemoteStamps.file(fest.id) ?: StampArt.remote(artId, false) else StampArt.remote(s.place.id, rainArt) }
    val total = StampAlbum.ALL.size
    // 모은 칸: 이 도장을 뺀 것 → 넣은 것. 이미 모은 칸인지는 No.가 아니라 칸(장소, 비 오는 날 디아크는 따로)으로 본다.
    // 화면이 뜬 순간의 기록으로 정해 두고 바꾸지 않는다 (서버를 다시 받아도 연출이 흔들리지 않게).
    val medal = remember(id) {
        val others = collected.filterNot { it.same(s.place.id, s.number) || (s.serverNumber != null && it.same(s.place.id, s.serverNumber)) }
        val prev = StampAlbum.byKey(others)[key]?.size ?: 0
        MedalCount(StampAlbum.gotCount(others), StampAlbum.gotCount(others + StampRow(s.place.id, s.number, s.rare, null)), prev + 1)
    }
    val again = medal.visit > 1
    val before = medal.before; val after = medal.after
    val ctx = LocalContext.current
    val blur = remember(res, remoteFile) { remoteFile?.let { blurredFile(it) } ?: res?.let { blurred(ctx.resources, it) } }
    val seed = remember(id) { id.hashCode() }

    BoxWithConstraints(Modifier.fillMaxSize().clipToBounds().background(BASE)) {
        val W = maxWidth; val H = maxHeight
        val coin: Dp = when {
            wide -> min(400f, H.value * 0.38f).dp
            else -> minOf(340f, W.value * (if (narrow) 0.55f else 0.42f), H.value * 0.3f).dp
        }
        // 흔들림: 쾅 하는 순간 (폰 ±6px × 1.4)
        val sx = keyframes(tl.shake, floatArrayOf(0f, -8f, 8f, -6f, 3f, 0f))
        val sy = keyframes(tl.shake, floatArrayOf(0f, 6f, -6f, 3f, -1.5f, 0f))
        Backdrop(blur, tl) // 바탕은 화면보다 크게 그려서 흔들어도 가장자리가 안 보이게
        Box(Modifier.fillMaxSize().offset(sx.dp, sy.dp)) {
            val stage: @Composable () -> Unit = { CoinStage(painter, s.place.name, coin, tl, rare, seed, again, festival = fest != null) }
            val pill: @Composable () -> Unit = { Pill(rare, s.rare, again, tl, festival = fest != null) }
            val section = if (fest != null) "축제 도장 · " + (FestivalMeta.get(fest.id)?.season?.ifEmpty { null } ?: "기간 한정") else StampAlbum.sectionTitle(item?.section)
            val card: @Composable (Modifier) -> Unit = { m ->
                InfoCard(item?.label ?: s.place.name, s.shownNumber, section, rare, s.silent, before, after, total, if (fest != null) 1 else medal.visit, tl, m,
                    festival = fest != null)
            }
            val buttons: @Composable (Modifier) -> Unit = { m -> Buttons(tl, next, storySent, onStoryToPhone, onOpenBook, onClose, m) }
            if (wide) {
                Row(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 40.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        stage(); Spacer(Modifier.height(64.dp)); pill()
                    }
                    Spacer(Modifier.width(40.dp))
                    Column(Modifier.weight(1.1f).widthIn(max = 760.dp)) {
                        card(Modifier.fillMaxWidth()); Spacer(Modifier.height(24.dp)); buttons(Modifier.fillMaxWidth())
                    }
                }
            } else {
                val side = if (narrow) 20.dp else 40.dp
                Column(Modifier.fillMaxSize().padding(horizontal = side), horizontalAlignment = Alignment.CenterHorizontally) {
                    Spacer(Modifier.height(max(H.value * 0.09f, coin.value * 0.3f).dp))
                    stage()
                    // 알약은 동전 아랫변과 카드 윗변의 한가운데 (시안 3)
                    Spacer(Modifier.weight(1f)); pill(); Spacer(Modifier.weight(1f))
                    card(Modifier.widthIn(max = 760.dp).fillMaxWidth())
                    Spacer(Modifier.height(20.dp))
                    buttons(Modifier.widthIn(max = 760.dp).fillMaxWidth())
                    Spacer(Modifier.height(if (narrow) 24.dp else 36.dp))
                }
            }
        }
    }
}

/** 모은 칸 수 전·후와 이 칸 몇 번째 방문인지 (1 = 처음). */
private data class MedalCount(val before: Int, val after: Int, val visit: Int)

/** 0~1 진행에 맞춘 꺾은선 값 (같은 간격 점). */
private fun keyframes(p: Float, v: FloatArray): Float {
    if (p <= 0f) return v.first(); if (p >= 1f) return v.last()
    val x = p * (v.size - 1); val i = x.toInt()
    return lerp(v[i], v[i + 1], x - i)
}

/** 배경용 흐린 그림: 아주 작게 줄였다가(20px) 조금 키워 두면, 크게 그릴 때 부드럽게 번진다 (blur는 API 31부터라 안 씀). */
private fun blurred(r: Resources, id: Int): ImageBitmap? = runCatching {
    val src = BitmapFactory.decodeResource(r, id, BitmapFactory.Options().apply { inSampleSize = 8 }) ?: return null
    val tiny = Bitmap.createScaledBitmap(src, 20, 20, true)
    Bitmap.createScaledBitmap(tiny, 64, 64, true).asImageBitmap()
}.getOrNull()

/** [blurred]와 같고 받아 둔 서버 그림 파일에서. */
private fun blurredFile(f: java.io.File): ImageBitmap? = runCatching {
    val src = BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = 8 }) ?: return null
    val tiny = Bitmap.createScaledBitmap(src, 20, 20, true)
    Bitmap.createScaledBitmap(tiny, 64, 64, true).asImageBitmap()
}.getOrNull()

private fun saturation(k: Float) = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(k) })

/** 바탕: 흐린 그림(흑백·어둡게 → 컬러) + 위아래 그늘. */
@Composable
private fun Backdrop(img: ImageBitmap?, tl: Timeline) {
    val sx = keyframes(tl.shake, floatArrayOf(0f, -8f, 8f, -6f, 3f, 0f))
    val sy = keyframes(tl.shake, floatArrayOf(0f, 6f, -6f, 3f, -1.5f, 0f))
    Canvas(Modifier.fillMaxSize()) {
        translate(sx.dp.toPx(), sy.dp.toPx()) { drawBackdrop(img, tl) }
    }
}

private fun DrawScope.drawBackdrop(img: ImageBitmap?, tl: Timeline) {
    run {
        if (img != null) {
            val side = max(size.width, size.height) * lerp(1.25f, 1.32f, tl.kb)
            val c = Offset(size.width / 2, size.height * 0.42f - 12.dp.toPx() * tl.kb)
            drawImage(
                img, srcOffset = IntOffset.Zero, srcSize = IntSize(img.width, img.height),
                dstOffset = IntOffset((c.x - side / 2).roundToInt(), (c.y - side / 2).roundToInt()), dstSize = IntSize(side.roundToInt(), side.roundToInt()),
                alpha = tl.bg, colorFilter = saturation(tl.color), filterQuality = FilterQuality.High,
            )
        }
        // 밝기 .5 → .88
        val m = 16.dp.toPx()
        drawRect(Color.Black.copy(alpha = lerp(0.5f, 0.12f, tl.color)), Offset(-m, -m), Size(size.width + 2 * m, size.height + 2 * m))
        drawRect(topLeft = Offset(-m, -m), size = Size(size.width + 2 * m, size.height + 2 * m), brush = Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.45f), 0.28f to Color.Transparent, 0.55f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.7f)))
    }
}

/** 동전 자리: 뒤(햇빛·꽃가루·후광·궤도 뒤쪽 반·쾅 고리) · 동전(흑백→컬러, 반짝) · 앞(궤도 앞쪽 반). 모두 동전 칸 밖까지 그린다. */
@Composable
private fun CoinStage(painter: Painter?, name: String, coin: Dp, tl: Timeline, rare: Boolean, seed: Int, again: Boolean, festival: Boolean = false) {
    // 다시 찍은 칸은 꽃가루를 조금만, 축제는 붉은·금빛으로 많이
    val confetti = remember(seed, rare, again, festival) { Confetti(seed, if (again) (if (rare) 30 else 22) else if (rare || festival) 90 else 64, festival) }
    val ringColor = if (festival) FEST_RED else GOLD
    Box(Modifier.size(coin), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(coin)) {
            val c = center; val r = size.minDimension / 2
            // 동전 뒤 따뜻한 빛
            if (tl.sun > 0f) drawCircle(
                Brush.radialGradient(listOf(Color(0xFFFFC86B).copy(alpha = 0.42f * tl.sun), Color(0xFFFF9F43).copy(alpha = 0.12f * tl.sun), Color.Transparent), c, r * 4.2f),
                radius = r * 4.2f, center = c,
            )
            confetti.draw(this, tl.confMs, density)
            // 금빛 후광 + 테두리 빛
            if (tl.glow > 0f) {
                drawCircle(Brush.radialGradient(listOf(GOLD2.copy(alpha = 0.6f * tl.glow), GOLD2.copy(alpha = 0.18f * tl.glow), Color.Transparent), c, r * 1.75f), r * 1.75f, c)
                drawCircle(Color(0xE6FFE6A0).copy(alpha = 0.9f * tl.glow), radius = r + 10.dp.toPx(), center = c, style = Stroke(3.dp.toPx()))
            }
            orbit(1.65f, -20f, tl.orbit1, front = false)
            orbit(1.53f, 24f, tl.orbit2, front = false)
            // 쾅 고리 (퍼지며 사라짐)
            if (tl.ring > 0f && tl.ring < 1f) drawCircle(
                ringColor.copy(alpha = 0.9f * (1f - tl.ring)), radius = (r + 6.dp.toPx()) * lerp(0.85f, 1.9f, tl.ring), center = c, style = Stroke(6.dp.toPx() * (1f - tl.ring * 0.5f)),
            )
        }
        // 동전: 크게·기울어 있다가 쾅 (흑백 → 컬러 겹쳐 바꾸기)
        Box(
            Modifier.size(coin).graphicsLayer {
                val k = tl.coin
                scaleX = lerp(3f, 1f, k); scaleY = scaleX
                rotationZ = lerp(-28f, 0f, k)
                alpha = (tl.coinLin / 0.6f).coerceIn(0f, 1f)
            },
        ) {
            if (painter != null) {
                Image(painter, null, Modifier.fillMaxSize(), colorFilter = GRAY)
                Image(painter, name, Modifier.fillMaxSize().graphicsLayer { alpha = tl.color })
            } else {
                Box(Modifier.fillMaxSize().clip(CircleShape).background(Color(0xFFF4EFE3)).border(8.dp, LightColors.accent, CircleShape), contentAlignment = Alignment.Center) {
                    Text(name, fontSize = Ms.h2, color = LightColors.accent, fontWeight = FontWeight.Bold)
                }
            }
            // 반짝임: 동그란 틀 안을 흰 띠가 지나간다
            if (tl.shine > 0f && tl.shine < 1f) Canvas(Modifier.fillMaxSize()) {
                val w = size.width; val bar = w * 0.38f
                clipPath(Path().apply { addOval(androidx.compose.ui.geometry.Rect(Offset.Zero, size)) }) {
                    val x = lerp(-bar * 1.5f, w + bar * 0.5f, tl.shine)
                    rotate(15f, pivot = center) {
                        drawRect(
                            Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.55f), Color.Transparent), startX = x, endX = x + bar),
                            topLeft = Offset(x, -w * 0.2f), size = Size(bar, w * 1.4f),
                        )
                    }
                }
            }
        }
        Canvas(Modifier.size(coin)) {
            orbit(1.65f, -20f, tl.orbit1, front = true)
            orbit(1.53f, 24f, tl.orbit2, front = true)
        }
    }
}

/**
 * 기울어진 궤도 고리 하나. 동전 폭의 [wK]배 × 0.76배 타원, [deg]만큼 기움. 진행 [p]에 따라 왼쪽부터 그려진다.
 * 위쪽 반은 동전 뒤([front]=false), 아래쪽 반은 동전 앞.
 */
private fun DrawScope.orbit(wK: Float, deg: Float, p: Float, front: Boolean) {
    if (p <= 0f) return
    val w = size.width * wK; val h = size.width * 0.76f
    val sweep = 360f * p
    rotate(deg, pivot = center) {
        val tl = Offset(center.x - w / 2, center.y - h / 2); val sz = Size(w, h)
        val (start, len) = if (!front) 180f to min(180f, sweep) else 0f to (sweep - 180f)
        if (len <= 0f) return@rotate
        // 넓고 옅은 빛 + 가는 금선
        drawArc(GOLD2.copy(alpha = 0.18f * p), start, len, false, tl, sz, style = Stroke(9.dp.toPx(), cap = StrokeCap.Round))
        drawArc(GOLD2.copy(alpha = 0.85f * p), start, len, false, tl, sz, style = Stroke(2.5f.dp.toPx(), cap = StrokeCap.Round))
    }
}

/** 꽃가루: 폰과 같은 물리(프레임마다 vx×0.985, vy+중력), 수명은 1.3초로 줄임. 시드 고정이라 캡처가 늘 같다. */
private class Confetti(seed: Int, n: Int, festival: Boolean = false) {
    private val cols = if (festival) listOf(FEST_RED, Color(0xFFD9573F), GOLD, Color(0xFFFFE08A), Color.White)
    else listOf(GOLD, Color(0xFFFFE08A), Color(0xFF7DB59C), Color.White, Color(0xFF2C4A3E))
    private val rnd = Random(seed)
    private val pcs = List(n) {
        val a = rnd.nextFloat() * 2f * PI.toFloat(); val v = 4f + rnd.nextFloat() * 9f
        floatArrayOf(cos(a) * v, sin(a) * v - 3f, rnd.nextFloat() * 6f, (rnd.nextFloat() - 0.5f) * 0.4f, 4f + rnd.nextFloat() * 6f, (it % cols.size).toFloat())
    }

    fun draw(d: DrawScope, ms: Float, density: Float) {
        if (ms <= 0f) return
        val f = (ms / 16f).toInt().coerceAtMost(FRAMES)
        val k = d.size.width / 236f // 날아가는 거리는 동전 크기 기준 (폰 동전 236px)
        val ks = 1.4f * density     // 조각 크기: 폰 px → 차 dp(1.4배) → 화면 px
        for (p in pcs) {
            var x = 0f; var y = 0f; var vx = p[0]; var vy = p[1]; var r = p[2]
            for (i in 0 until f) { vy += 0.22f; vx *= 0.985f; x += vx; y += vy; r += p[3] }
            val life = 1f - f / FRAMES.toFloat()
            if (life <= 0f) continue
            val s = p[4] * ks
            d.withTransform({ translate(d.center.x + x * k, d.center.y + y * k); rotate(r * 57.3f, Offset.Zero) }) {
                drawRect(cols[p[5].toInt()].copy(alpha = life.coerceIn(0f, 1f)), topLeft = Offset(-s / 2, -s / 4), size = Size(s, s / 2))
            }
        }
    }

    companion object { const val FRAMES = 80 }
}

/** 노란 알약 '도장 획득!' / '희귀 도장 · 비 오는 날' / 이미 모은 칸이면 '또 왔어요!': 단색 + 옅은 그림자. */
@Composable
private fun Pill(rare: Boolean, rareName: String?, again: Boolean, tl: Timeline, festival: Boolean = false) {
    Row(
        Modifier.graphicsLayer { scaleX = tl.pill; scaleY = tl.pill; alpha = if (tl.pill > 0f) 1f else 0f }
            .shadow(14.dp, RoundedCornerShape(50), ambientColor = Color.Black, spotColor = Color.Black)
            .clip(RoundedCornerShape(50)).background(if (festival) FEST_RED else GOLD).padding(start = 24.dp, end = 30.dp, top = 14.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val ink = if (festival) Color.White else PILL_INK
        MsIcon(if (festival) Lucide.PartyPopper else if (rare) Lucide.Gem else Lucide.Stamp, 24.sp, tint = ink)
        Spacer(Modifier.width(10.dp))
        Text(if (festival) "축제 도장!" else if (again) "또 왔어요!" else if (rare) "희귀 도장 · ${rareName ?: "비 오는 날"}" else "도장 획득!", fontSize = Ms.sub, fontWeight = FontWeight.ExtraBold, color = ink)
    }
}

/** 유리 카드: NEW STAMP(이미 모은 칸이면 '다시 찍었어요') · 이름 · No.·묶음 · 모은 도장 막대(다시 찍었으면 'N번째 방문', 숫자 안 오름). */
@Composable
private fun InfoCard(
    label: String, number: Int, section: String, rare: Boolean, silent: Boolean, before: Int, after: Int, total: Int, visit: Int, tl: Timeline, modifier: Modifier,
    festival: Boolean = false,
) {
    val again = visit > 1
    val bumped = tl.bumpMs >= 0f
    val shown = if (bumped) after else before
    val bp = (tl.bumpMs / 360f).coerceIn(0f, 1f)
    val bump = if (bumped && after != before) 1f + 0.7f * (1f - bp).pow(3) else 1f
    val hot = bumped && after != before && tl.bumpMs < 450f
    Column(
        modifier.graphicsLayer { alpha = tl.card; translationY = (1f - tl.card) * 24.dp.toPx() }
            .clip(RoundedCornerShape(32.dp)).background(Color(0x990E1814)).border(1.dp, Color(0x29FFFFFF), RoundedCornerShape(32.dp))
            .padding(horizontal = 30.dp, vertical = 26.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val tag = when {
                festival -> "축제 한정 도장"
                again && rare -> "희귀 도장 · 다시"
                again -> "다시 찍었어요"
                rare -> "희귀 도장"
                else -> "새 도장"
            }
            IconText(if (festival) Lucide.PartyPopper else if (rare) Lucide.Gem else Lucide.MapPin, tag, Ms.cap, color = GOLD2, weight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
            if (silent) IconText(Lucide.VolumeX, "조용히 찍었어요", Ms.cap, color = Color(0xCCFFFFFF))
        }
        Spacer(Modifier.height(8.dp))
        Text(label, fontSize = 42.sp, lineHeight = 52.sp, fontWeight = FontWeight.ExtraBold, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, letterSpacing = (-1).sp)
        Text("${stampNo(number)} · $section", fontSize = Ms.sub, color = Color(0xCCFFFFFF))
        Box(Modifier.padding(top = 20.dp, bottom = 16.dp).fillMaxWidth().height(1.dp).background(Color(0x24FFFFFF)))
        if (again) Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${visit}번째 방문", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, color = GOLD2, modifier = Modifier.weight(1f))
            Text(albumCount(after, total), fontSize = Ms.sub, color = Color(0xCCFFFFFF), fontWeight = FontWeight.Bold)
        } else Row(verticalAlignment = Alignment.CenterVertically) {
            Text("도장북", fontSize = Ms.sub, color = Color(0xCCFFFFFF), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("$shown", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, color = if (hot) GOLD2 else Color.White,
                modifier = Modifier.graphicsLayer { scaleX = bump; scaleY = bump })
            Text("/${total}칸", fontSize = Ms.sub, color = Color(0xCCFFFFFF), fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(12.dp))
        val frac = lerp(before.toFloat(), after.toFloat(), tl.bar) / total
        Box(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)).background(Color(0x24FFFFFF))) {
            if (frac > 0f) Box(Modifier.fillMaxWidth(frac).height(10.dp).clip(RoundedCornerShape(5.dp)).background(Brush.horizontalGradient(listOf(GOLD, GOLD2))))
        }
    }
}

/**
 * 메달 다음 흐름 (S3 → S4): 다음 장소 한 줄 · 큰 버튼 '다음 장소'(밤 화면의 잉크 초록) ·
 * 작은 버튼 '이야기는 폰으로 이어 듣기'(그 장소 소개를 가족 폰으로) · '도장북'.
 */
@Composable
private fun Buttons(
    tl: Timeline, next: String?, storySent: Boolean, onStory: () -> Unit, onOpenBook: () -> Unit, onClose: () -> Unit, modifier: Modifier,
) {
    val d = DarkColors
    Column(
        modifier.graphicsLayer { alpha = tl.cta; translationY = (1f - tl.cta) * 24.dp.toPx() },
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (next != null) IconText(Lucide.Navigation, clockText(next), Ms.sub, color = Color.White, weight = FontWeight.Bold, maxLines = 1)
        Button(
            onClick = onClose, modifier = Modifier.fillMaxWidth().height(Ms.actH + 8.dp), shape = RoundedCornerShape(24.dp),
            colors = ButtonDefaults.buttonColors(containerColor = d.accent, contentColor = d.onAccent),
        ) {
            MsIcon(if (next != null) Lucide.Navigation else Lucide.Check, Ms.btn, scale = 1.1f); Spacer(Modifier.width(14.dp))
            Text(if (next != null) "다음 장소" else "확인", fontSize = Ms.btn, fontWeight = FontWeight.ExtraBold)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            val ghost = ButtonDefaults.outlinedButtonColors(containerColor = Color(0x730A1410), contentColor = Color.White)
            val border = androidx.compose.foundation.BorderStroke(1.dp, Color(0x2EFFFFFF))
            OutlinedButton(onClick = onStory, enabled = !storySent, modifier = Modifier.weight(2f).height(Ms.actH), shape = RoundedCornerShape(24.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
                colors = ghost.copy(disabledContainerColor = Color(0x730A1410), disabledContentColor = d.accentInk), border = border) {
                MsIcon(if (storySent) Lucide.Check else Lucide.Smartphone, Ms.act, scale = 1.1f); Spacer(Modifier.width(10.dp))
                Text(if (storySent) GoWords.sentToPhone(LocalGoWith.current) else "이야기는 폰으로 ${W.resume}", fontSize = Ms.act, fontWeight = FontWeight.Bold, maxLines = 1)
            }
            OutlinedButton(onClick = onOpenBook, modifier = Modifier.weight(1f).height(Ms.actH), shape = RoundedCornerShape(24.dp), colors = ghost, border = border,
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp)) {
                MsIcon(Lucide.BookOpen, Ms.act, scale = 1.1f); Spacer(Modifier.width(10.dp))
                Text("도장북", fontSize = Ms.act, fontWeight = FontWeight.Bold, maxLines = 1)
            }
        }
    }
}
