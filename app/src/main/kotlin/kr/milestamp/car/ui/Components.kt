package kr.milestamp.car.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.composables.icons.lucide.ArrowLeftRight
import com.composables.icons.lucide.Baby
import com.composables.icons.lucide.Heart
import com.composables.icons.lucide.User
import com.composables.icons.lucide.Users
import com.composables.icons.lucide.Check
import com.composables.icons.lucide.ChevronRight
import com.composables.icons.lucide.CircleCheck
import com.composables.icons.lucide.CircleX
import com.composables.icons.lucide.House
import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.Utensils
import com.composables.icons.lucide.MapPin
import com.composables.icons.lucide.Navigation
import com.composables.icons.lucide.TriangleAlert
import com.composables.icons.lucide.Volume2
import com.composables.icons.lucide.X
import kr.milestamp.engine.Explanation
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.LiveStop
import kr.milestamp.engine.PlanOption
import kr.milestamp.engine.StopStatus

/*
 * 차 공용 부품 `Ms*` — 폰 phone/src/parts/와 같은 이름·같은 뜻 (docs/디자인-부품.md). 크기만 차 단계(Theme.kt Ms).
 * 규칙: 색 값은 받지 않고 tone·kind 이름만. 누르는 칸 76dp 이상, 정보 글씨 24sp 이상. 큰 버튼(MsPrimaryCTA)은 화면에 하나.
 */

// ---------------------------------------------------------------- 큰 버튼 · 작은 버튼

enum class CtaKind { ACCENT, SOFT, DANGER }

/** 화면에 하나뿐인 큰 버튼 (잉크 초록). [sub]는 버튼 안 둘째 줄. */
@Composable
fun MsPrimaryCTA(
    text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, sub: String? = null,
    enabled: Boolean = true, kind: CtaKind = CtaKind.ACCENT, height: Dp = Ms.ctaH,
) {
    val c = Ms.c
    val (bg, fg) = when (kind) { CtaKind.ACCENT -> c.accent to c.onAccent; CtaKind.SOFT -> c.fill to c.ink; CtaKind.DANGER -> c.redText to c.surface }
    Row(
        modifier.fillMaxWidth().heightIn(min = height).clip(RoundedCornerShape(Ms.rLg)).background(bg)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).alpha(if (enabled) 1f else 0.45f)
            .padding(horizontal = Ms.sXl, vertical = Ms.sM),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) { MsIcon(icon, Ms.btn, tint = fg, scale = 1.1f); Spacer(Modifier.width(Ms.sL)) }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(text, fontSize = Ms.btn, fontWeight = FontWeight.ExtraBold, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub != null) Text(sub, fontSize = Ms.cap, fontWeight = FontWeight.SemiBold, color = fg.copy(alpha = 0.85f), maxLines = 1)
        }
    }
}

enum class ActTone { PLAIN, ACCENT, GHOST, SURFACE, DANGER }

/** 작은 버튼 (높이 88dp, 최소 76dp). 아이콘만이면 [label]은 화면 읽기 이름. */
@Composable
fun MsActionButton(
    label: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, tone: ActTone = ActTone.PLAIN,
    enabled: Boolean = true, iconOnly: Boolean = false, height: Dp = Ms.actH,
) {
    val c = Ms.c
    val (bg, fg) = when (tone) {
        ActTone.PLAIN -> c.fill to c.ink
        ActTone.ACCENT -> c.accentSoft to c.accentInk
        ActTone.GHOST -> Color.Transparent to c.ink
        ActTone.SURFACE -> c.surface to c.ink
        ActTone.DANGER -> c.redSoft to c.redText
    }
    val shape = RoundedCornerShape(Ms.rMd)
    Row(
        modifier.heightIn(min = maxOf(height, Ms.touch)).clip(shape).background(bg)
            .then(if (tone == ActTone.GHOST) Modifier.border(2.dp, c.line, shape) else Modifier)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label }
            .alpha(if (enabled) 1f else 0.45f).padding(horizontal = if (iconOnly) Ms.sL else Ms.sXl),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) MsIcon(icon, Ms.act, tint = fg, scale = 1.1f)
        if (!iconOnly) {
            if (icon != null) Spacer(Modifier.width(Ms.sM))
            Text(label, fontSize = Ms.act, fontWeight = FontWeight.Bold, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

data class MsAction(val label: String, val icon: ImageVector?, val tone: ActTone = ActTone.PLAIN, val enabled: Boolean = true, val iconOnly: Boolean = false, val onClick: () -> Unit)

/** 작은 버튼 줄 (같은 폭 나눔, 아이콘만인 것은 제 폭). */
@Composable
fun MsActionRow(items: List<MsAction>, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Ms.sM)) {
        items.forEach { a ->
            MsActionButton(a.label, a.onClick, if (a.iconOnly) Modifier else Modifier.weight(1f), a.icon, a.tone, a.enabled, a.iconOnly)
        }
    }
}

// ---------------------------------------------------------------- 동그란 아이콘 · 칩

enum class BadgeTone { ACCENT, MUTE, WARN, SURFACE }

@Composable
fun MsIconBadge(icon: ImageVector, tone: BadgeTone = BadgeTone.ACCENT, size: Dp = 64.dp) {
    val c = Ms.c
    val (bg, fg) = when (tone) {
        BadgeTone.ACCENT -> c.accentSoft to c.accentInk
        BadgeTone.MUTE -> c.fill to c.ink3
        BadgeTone.WARN -> c.redSoft to c.redText
        BadgeTone.SURFACE -> c.surface to c.ink
    }
    Box(Modifier.size(size).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        Icon(icon, fg, size * 0.5f)
    }
}

@Composable
private fun Icon(icon: ImageVector, tint: Color, size: Dp) =
    androidx.compose.material3.Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size))

/** 칩 조각 (아이콘 + 글). 해 뜸·해 짐 칩만 조각 2개. */
data class ChipPart(val icon: ImageVector?, val text: String)

/** 보여 주기만 하는 칩. 옛 Chip·ColorChip·FestPill·RarePill을 하나로. [solid]면 진한 바탕(축제 진행 중처럼 강조). */
@Composable
fun MsChip(parts: List<ChipPart>, tone: MsTone = MsTone.PLAIN, modifier: Modifier = Modifier, size: TextUnit = Ms.chip, solid: Boolean = false) {
    val (soft, ink) = Ms.c.tone(tone)
    val bg = if (solid) ink else soft
    val fg = if (solid) Ms.c.surface else ink
    val partGap = (size.value * 0.6f).dp
    Row(
        modifier.width(IntrinsicSize.Max).clip(RoundedCornerShape(50)).background(bg)
            .padding(start = (size.value * 0.6f).dp, end = (size.value * 0.75f).dp, top = (size.value * 0.32f).dp, bottom = (size.value * 0.32f).dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(partGap),
    ) {
        parts.forEach { (icon, text) -> IconText(icon, text, size, color = fg, weight = FontWeight.Bold, maxLines = 1, lineHeight = size * 1.3f) }
    }
}

@Composable
fun MsChip(text: String, icon: ImageVector? = null, tone: MsTone = MsTone.PLAIN, modifier: Modifier = Modifier, size: TextUnit = Ms.chip, solid: Boolean = false) =
    MsChip(listOf(ChipPart(icon, text)), tone, modifier, size, solid)

// ---------------------------------------------------------------- 줄 · 카드

/** 줄 하나 (높이 88dp 이상). 누르면 바탕이 바뀌고, 끝에 › 또는 글. */
@Composable
fun MsRow(
    title: String, modifier: Modifier = Modifier, icon: ImageVector? = null, sub: String? = null, trailing: String? = null,
    chevron: Boolean = false, danger: Boolean = false, onClick: (() -> Unit)? = null,
) {
    val c = Ms.c
    Row(
        modifier.fillMaxWidth().heightIn(min = Ms.actH).clip(RoundedCornerShape(Ms.rMd))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = Ms.sL, vertical = Ms.sM),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Ms.sL),
    ) {
        if (icon != null) MsIconBadge(icon, if (danger) BadgeTone.WARN else BadgeTone.ACCENT, 56.dp)
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = Ms.body, fontWeight = FontWeight.Bold, color = if (danger) c.redText else c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub != null) Text(sub, fontSize = Ms.cap, color = c.ink3, maxLines = 2)
        }
        if (trailing != null) Text(trailing, fontSize = Ms.sub, fontWeight = FontWeight.SemiBold, color = c.ink2, maxLines = 1)
        if (chevron) MsIcon(Lucide.ChevronRight, Ms.body, tint = c.ink3)
    }
}

/** 면 카드 (그림자 없이 바탕색 + 1dp 선). */
@Composable
fun MsCard(modifier: Modifier = Modifier, tint: Boolean = false, pad: Dp = Ms.sXxl, content: @Composable ColumnScope.() -> Unit) {
    val c = Ms.c
    val shape = RoundedCornerShape(Ms.rLg)
    Column(
        modifier.clip(shape).background(if (tint) c.accentSoft else c.surface).border(1.dp, if (tint) c.accentSoft else c.line, shape).padding(pad),
        content = content,
    )
}

// ---------------------------------------------------------------- 다음 목적지

/**
 * 다음 목적지 — 2초 안에 읽히게: 머리말(작게, 초록) · 이름(50sp 굵게) · 도착 줄(굵게) · 보조 줄(늦으면 빨강 글자).
 * [big]이면 주행 화면용으로 더 크게.
 */
@Composable
fun MsNextHero(
    name: String, modifier: Modifier = Modifier, kicker: String = W.next, icon: ImageVector = Lucide.Navigation,
    arrive: String? = null, sub: String? = null, warn: Boolean = false, big: Boolean = false,
) {
    val c = Ms.c
    Row(modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Ms.sXl)) {
        MsIconBadge(icon, BadgeTone.ACCENT, if (big) 104.dp else 84.dp)
        Column(Modifier.weight(1f)) {
            Text(kicker, fontSize = if (big) Ms.title else Ms.sub, fontWeight = FontWeight.Bold, color = c.accent)
            Text(name, fontSize = if (big) 62.sp else Ms.hero, lineHeight = (if (big) 62.sp else Ms.hero) * 1.18f, fontWeight = FontWeight.ExtraBold, color = c.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (arrive != null) Text(arrive, fontSize = if (big) 36.sp else Ms.title, lineHeight = (if (big) 36.sp else Ms.title) * 1.3f, fontWeight = FontWeight.Bold, color = c.ink, maxLines = 2)
            if (sub != null) Row(Modifier.padding(top = Ms.sXs), verticalAlignment = Alignment.CenterVertically) {
                if (warn) { MsIcon(Lucide.TriangleAlert, Ms.sub, tint = c.red); Spacer(Modifier.width(Ms.sS)) }
                Text(sub, fontSize = if (big) Ms.title else Ms.sub, fontWeight = FontWeight.SemiBold, color = if (warn) c.redText else c.ink3, maxLines = 2)
            }
        }
    }
}

// ---------------------------------------------------------------- 설명 카드 · 제안 띠

/** 쉬운 설명: 제목(늦으면 빨강 글자) + 한두 문장 + '말로 듣기'. 시각은 12시간으로. */
@Composable
fun MsExplainCard(ex: Explanation, onSpeak: (String) -> Unit, modifier: Modifier = Modifier, compact: Boolean = false) {
    val c = Ms.c
    val shape = RoundedCornerShape(Ms.rLg)
    Row(
        modifier.fillMaxWidth().clip(shape).background(if (ex.warn) c.redSoft else c.fill).padding(horizontal = Ms.sXl, vertical = Ms.sL),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Ms.sL),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Ms.sXs)) {
            Text(clockText(ex.headline), fontSize = Ms.title, lineHeight = Ms.title * 1.25f, fontWeight = FontWeight.ExtraBold, color = if (ex.warn) c.redText else c.ink)
            Text(clockText(ex.body), fontSize = Ms.sub, color = c.ink2, lineHeight = Ms.sub * 1.35f, maxLines = if (compact) 2 else 4, overflow = TextOverflow.Ellipsis)
        }
        MsActionButton(W.listen, { onSpeak(ex.speech) }, icon = Lucide.Volume2, tone = ActTone.SURFACE, iconOnly = compact)
    }
}

/**
 * 제안 띠 — '바꾸자는 제안이 있어요' + 첫 안 요약 + (버튼) '이걸로 바꾸기'(화면의 큰 버튼일 때는 accent 채움) / '그대로 갈게요'.
 */
@Composable
fun MsProposalBanner(
    text: String, modifier: Modifier = Modifier, sub: String? = null, warn: Boolean = false,
    onAdopt: (() -> Unit)? = null, onKeep: (() -> Unit)? = null, adoptIsPrimary: Boolean = true,
) {
    val c = Ms.c
    val (bg, fg) = if (warn) c.redSoft to c.redText else c.accentSoft to c.accentInk
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(Ms.rLg)).background(bg).padding(Ms.sXl), verticalArrangement = Arrangement.spacedBy(Ms.sL)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MsIcon(Lucide.ArrowLeftRight, Ms.title, tint = fg, scale = 1.05f)
            Spacer(Modifier.width(Ms.sM))
            Column(Modifier.weight(1f)) {
                Text(text, fontSize = Ms.title, lineHeight = Ms.title * 1.25f, fontWeight = FontWeight.ExtraBold, color = fg)
                if (sub != null) Text(sub, fontSize = Ms.sub, color = c.ink2, maxLines = 2)
            }
        }
        if (onAdopt != null || onKeep != null) androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth()) {
            // 좁으면(두 버튼 글이 잘리면) 위아래로
            val stacked = maxWidth < 640.dp
            val adopt: @Composable (Modifier) -> Unit = { m ->
                if (adoptIsPrimary) MsPrimaryCTA(W.adopt, onAdopt!!, m, icon = Lucide.Check, height = Ms.actH + 8.dp)
                else MsActionButton(W.adopt, onAdopt!!, m, Lucide.Check, ActTone.SURFACE)
            }
            val keep: @Composable (Modifier) -> Unit = { m -> MsActionButton(W.keep, onKeep!!, m, Lucide.X, ActTone.GHOST, height = Ms.actH) }
            if (stacked) Column(verticalArrangement = Arrangement.spacedBy(Ms.sS)) {
                if (onAdopt != null) adopt(Modifier.fillMaxWidth())
                if (onKeep != null) keep(Modifier.fillMaxWidth())
            } else Row(horizontalArrangement = Arrangement.spacedBy(Ms.sM)) {
                if (onAdopt != null) adopt(Modifier.weight(1.4f))
                if (onKeep != null) keep(Modifier.weight(1f))
            }
        }
    }
}

// ---------------------------------------------------------------- 타임라인

private fun stopState(s: LiveStop): Pair<ImageVector, String> = when {
    // 밥 자리(식당)는 숟가락 표시 — 도장 없음
    s.place.isMeal && s.status in setOf(StopStatus.ARRIVED, StopStatus.NEXT, StopStatus.PLANNED) -> Lucide.Utensils to "밥"
    else -> stopStateOf(s)
}

private fun stopStateOf(s: LiveStop): Pair<ImageVector, String> = when (s.status) {
    StopStatus.DONE -> Lucide.CircleCheck to W.done
    StopStatus.ARRIVED -> Lucide.MapPin to W.here
    StopStatus.NEXT -> Lucide.Navigation to W.next
    StopStatus.PLANNED -> Lucide.ChevronRight to W.todo
    StopStatus.SKIPPED -> Lucide.CircleX to if (s.skipReason != null) W.skipped else W.removed
}

/** 장소 시각 줄: 다녀온 곳 실제, 머무는 곳 '~까지', 남은 곳 예정. */
fun stopTime(s: LiveStop): String = when (s.status) {
    StopStatus.DONE -> clockRange(s.actualArriveMin ?: s.plannedArriveMin, s.actualDepartMin ?: s.plannedDepartMin)
    StopStatus.ARRIVED -> "${clock(s.plannedDepartMin)}까지"
    StopStatus.SKIPPED -> if (s.skipReason != null) "${s.skipReason} · 오늘은 못 가요" else "오늘은 안 가요"
    else -> "${clock(s.plannedArriveMin)} 도착"
}

/**
 * 오늘 코스 타임라인. 가로 한 줄(기본 창): ✓석굴 › ●테마파크 › ○과학관 › ⌂집 오후 4:47.
 * 세로(넓은 창 둘째 단·코스 자세히): 줄마다 상태 · 이름 · 시각, 끝에 도착지 줄.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MsStopTimeline(course: LiveCourse, modifier: Modifier = Modifier, vertical: Boolean = false) {
    val c = Ms.c
    if (!vertical) {
        FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(Ms.sS), verticalArrangement = Arrangement.spacedBy(Ms.sS)) {
            course.stops.forEach { s ->
                val (icon, _) = stopState(s)
                val on = s.status == StopStatus.NEXT || s.status == StopStatus.ARRIVED
                val dim = s.status == StopStatus.DONE || s.status == StopStatus.SKIPPED
                Row(Modifier.width(IntrinsicSize.Max), verticalAlignment = Alignment.CenterVertically) {
                    MsIcon(icon, Ms.sub, tint = if (on) c.accent else c.ink3)
                    Spacer(Modifier.width(Ms.sXs))
                    Text(s.place.name, fontSize = Ms.sub, fontWeight = if (on) FontWeight.ExtraBold else FontWeight.SemiBold,
                        color = if (on) c.ink else if (dim) c.ink3 else c.ink2, maxLines = 1,
                        textDecoration = if (s.status == StopStatus.SKIPPED) TextDecoration.LineThrough else null)
                    Spacer(Modifier.width(Ms.sS))
                    MsIcon(Lucide.ChevronRight, Ms.sub, tint = c.ink4, scale = 0.8f)
                }
            }
            Row(Modifier.width(IntrinsicSize.Max), verticalAlignment = Alignment.CenterVertically) {
                MsIcon(Lucide.House, Ms.sub, tint = c.ink2)
                Spacer(Modifier.width(Ms.sXs))
                Text("${course.endName} ${clock(course.arriveHomeMin)}", fontSize = Ms.sub, fontWeight = FontWeight.Bold, color = c.ink2, maxLines = 1)
            }
        }
        return
    }
    Column(modifier) {
        course.stops.forEach { s -> TimelineLine(s.status, stopState(s), s.place.name, stopTime(s), s.status == StopStatus.SKIPPED) }
        TimelineLine(null, Lucide.House to "도착", course.endName, "${clock(course.arriveHomeMin)} 도착 예정", false, last = true)
    }
}

@Composable
private fun TimelineLine(status: StopStatus?, mark: Pair<ImageVector, String>, name: String, time: String, strike: Boolean, last: Boolean = false) {
    val c = Ms.c
    val on = status == StopStatus.NEXT || status == StopStatus.ARRIVED
    val dim = status == StopStatus.DONE || status == StopStatus.SKIPPED
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Column(Modifier.width(52.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(if (on) c.accent else c.fill), contentAlignment = Alignment.Center) {
                MsIcon(mark.first, Ms.cap, tint = if (on) c.onAccent else c.ink3)
            }
            if (!last) Box(Modifier.width(3.dp).weight(1f).background(c.line))
        }
        Spacer(Modifier.width(Ms.sL))
        Column(Modifier.weight(1f).padding(bottom = if (last) 0.dp else Ms.sL)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, fontSize = Ms.body, fontWeight = if (on) FontWeight.ExtraBold else FontWeight.Bold, color = if (dim) c.ink3 else c.ink,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                    textDecoration = if (strike) TextDecoration.LineThrough else null)
                Spacer(Modifier.width(Ms.sM))
                Text(mark.second, fontSize = Ms.cap, fontWeight = FontWeight.Bold, color = if (on) c.accent else c.ink3, maxLines = 1)
            }
            Text(time, fontSize = Ms.cap, color = c.ink3, maxLines = 1)
        }
    }
}

// ---------------------------------------------------------------- 하루 막대 · 숫자 카드 · 빈 화면

/** 하루 막대 덩어리 (PlanScreen DayBar를 감쌈): 이름 + 막대. */
@Composable
fun MsDayBar(o: PlanOption, nowMin: Int, sunsetMin: Int?, dinnerMin: Int?, modifier: Modifier = Modifier, title: String? = null) {
    Column(modifier) {
        if (title != null) Text(title, fontSize = Ms.cap, fontWeight = FontWeight.Bold, color = Ms.c.ink3)
        DayBar(o, nowMin, sunsetMin, dinnerMin, Modifier.fillMaxWidth())
    }
}

data class Stat(val value: String, val label: String, val icon: ImageVector? = null, val unit: String? = null)

/** 숫자 카드 한 장 (칸 사이 세로 선). */
@Composable
fun MsStatStrip(items: List<Stat>, modifier: Modifier = Modifier) {
    val c = Ms.c
    Row(modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(Ms.rLg)).background(c.surface).border(1.dp, c.line, RoundedCornerShape(Ms.rLg))) {
        items.forEachIndexed { i, s ->
            if (i > 0) Box(Modifier.width(1.dp).fillMaxHeight().padding(vertical = Ms.sL).background(c.line))
            Column(Modifier.weight(1f).padding(vertical = Ms.sXl, horizontal = Ms.sM), horizontalAlignment = Alignment.CenterHorizontally) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(s.value, fontSize = 48.sp, fontWeight = FontWeight.ExtraBold, color = c.ink, maxLines = 1)
                    if (s.unit != null) Text(s.unit, fontSize = Ms.sub, fontWeight = FontWeight.Bold, color = c.ink2, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
                }
                IconText(s.icon, s.label, Ms.cap, color = c.ink3, weight = FontWeight.SemiBold, maxLines = 1)
            }
        }
    }
}

@Composable
fun MsEmpty(icon: ImageVector, title: String, modifier: Modifier = Modifier, sub: String? = null) {
    val c = Ms.c
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Ms.sM)) {
        MsIconBadge(icon, BadgeTone.MUTE, 96.dp)
        Text(title, fontSize = Ms.title, fontWeight = FontWeight.Bold, color = c.ink)
        if (sub != null) Text(sub, fontSize = Ms.sub, color = c.ink3)
    }
}

// ---------------------------------------------------------------- 겹창 (폰의 시트 대신 — 정차 중에만)

/** 화면을 덮는 판: 바깥·뒤로 = 닫기, 제목 줄에 닫기 버튼. 내용이 길면 판 안에서만 넘김. */
@Composable
fun MsOverlay(title: String, onClose: () -> Unit, modifier: Modifier = Modifier, maxWidth: Dp = 760.dp, content: @Composable ColumnScope.() -> Unit) {
    BackHandler(onBack = onClose)
    val c = Ms.c
    Box(
        Modifier.fillMaxSize().background(c.dim).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier.padding(Ms.sXl).widthIn(max = maxWidth).fillMaxWidth().clip(RoundedCornerShape(Ms.rXl)).background(c.surface)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .padding(horizontal = Ms.sXxl, vertical = Ms.sXl),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = Ms.h2, fontWeight = FontWeight.ExtraBold, color = c.ink, modifier = Modifier.weight(1f))
                MsActionButton("닫기", onClose, icon = Lucide.X, tone = ActTone.PLAIN, iconOnly = true)
            }
            Spacer(Modifier.height(Ms.sL))
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), content = content)
        }
    }
}

/** 한 번 확인 ('지금 집으로 갈까요?'). 확인 버튼이 이 겹창의 큰 버튼. */
@Composable
fun MsConfirm(title: String, body: String?, confirm: String, onConfirm: () -> Unit, onCancel: () -> Unit, icon: ImageVector = Lucide.House) {
    MsOverlay(title, onCancel, maxWidth = 680.dp) {
        if (body != null) { Text(body, fontSize = Ms.body, color = Ms.c.ink2, lineHeight = Ms.body * 1.35f); Spacer(Modifier.height(Ms.sXl)) }
        MsPrimaryCTA(confirm, onConfirm, icon = icon)
        Spacer(Modifier.height(Ms.sM))
        MsActionButton("취소", onCancel, Modifier.fillMaxWidth(), tone = ActTone.GHOST)
    }
}

/** 누구랑 가요? 작은 칩 (S0 대기 · S1 계획 머리): 아이와 · 연인·부부 · 친구끼리 · 혼자. */
@Composable
fun GoWithChip(g: kr.milestamp.engine.GoWith, modifier: Modifier = Modifier) = MsChip(
    GoWords.chip(g),
    when (g) {
        kr.milestamp.engine.GoWith.KIDS -> Lucide.Baby
        kr.milestamp.engine.GoWith.COUPLE -> Lucide.Heart
        kr.milestamp.engine.GoWith.FRIENDS -> Lucide.Users
        kr.milestamp.engine.GoWith.SOLO -> Lucide.User
    },
    MsTone.PLAIN, modifier,
)
