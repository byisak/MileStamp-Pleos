package kr.milestamp.car.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.composables.icons.lucide.ArrowRight
import com.composables.icons.lucide.CarFront
import com.composables.icons.lucide.CloudRain
import com.composables.icons.lucide.House
import com.composables.icons.lucide.LayoutList
import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.Utensils
import com.composables.icons.lucide.MapPin
import com.composables.icons.lucide.Moon
import com.composables.icons.lucide.Navigation
import com.composables.icons.lucide.PartyPopper
import com.composables.icons.lucide.Route
import com.composables.icons.lucide.Smartphone
import com.composables.icons.lucide.Snowflake
import com.composables.icons.lucide.Stamp
import com.composables.icons.lucide.Sun
import com.composables.icons.lucide.Sunrise
import com.composables.icons.lucide.Sunset
import com.composables.icons.lucide.Users
import com.composables.icons.lucide.Utensils
import com.composables.icons.lucide.Wind
import kr.milestamp.engine.AirLevel
import kr.milestamp.engine.LegKind
import kr.milestamp.engine.OptionKind
import kr.milestamp.engine.Plan
import kr.milestamp.engine.PlanMode
import kr.milestamp.engine.PlanOption
import kr.milestamp.engine.Reason
import kr.milestamp.engine.Sky
import kr.milestamp.engine.Tone

/*
 * S1 출발 전 — 추천 '오늘 어디 갈까요' (정차 중에만, docs/디자인-점검/3-car.md 2절 S1 · 폰 상태 A와 같은 구조).
 * 1순위 = 주인공 카드(코스 이름 크게 · 하루 막대 · 이유 칩 3개 · 큰 버튼 '이 길로 출발'), 2·3순위는 짧게 접은 카드(작은 버튼).
 * 기본 창(841)은 세로 한 줄 — 스크롤 없이 들어가게, 넓은 창(1706)은 오른쪽 둘째 단에 2·3순위.
 * 폰(또는 차)에서 이미 고른 코스면 '아빠가 폰에서 고른 코스' 카드 하나 + 큰 버튼 '이 길로 출발' + '다른 코스 보기'.
 * 시각은 12시간('오후 4:49').
 */

/** 엔진 이유 칩 → 앞 아이콘: 낮잠 달 · 해(맑음 해 / 그 밖 해 짐) · 비 · 도장, 보통 칩은 뜻이 분명할 때만. */
private fun reasonIcon(r: Reason): ImageVector? = when (r.tone) {
    Tone.NAP -> Lucide.Moon
    Tone.SUN -> if ("맑음" in r.text) Lucide.Sun else Lucide.Sunset
    Tone.RAIN -> Lucide.CloudRain
    Tone.STAMP -> Lucide.Stamp
    Tone.FESTIVAL -> Lucide.PartyPopper
    Tone.AIR -> Lucide.Wind
    Tone.MEAL -> Lucide.Utensils
    Tone.PLAIN -> when {
        "없어요" in r.text -> null
        "가까워요" in r.text -> Lucide.MapPin
        "많이 감" in r.text -> Lucide.Users
        "우회" in r.text -> Lucide.Route
        "귀가" in r.text || "도착" in r.text || "집" in r.text -> Lucide.House
        else -> null
    }
}

/** 보일 이유 칩: 아이와가 아니면 낮잠 칩은 뺀다 (엔진이 이미 안 만들지만 예전 계획·서버 대비). */
internal fun reasonsFor(reasons: List<Reason>, g: kr.milestamp.engine.GoWith): List<Reason> =
    if (GoWords.showNap(g)) reasons else reasons.filter { it.tone != Tone.NAP && "낮잠" !in it.text }

@Composable
private fun ReasonChip(r: Reason, size: TextUnit = Ms.chip) = MsChip(clockText(r.text), reasonIcon(r), r.tone.ms(), size = size)

/** 140 → "2시간 20분", 45 → "45분". */
internal fun dur(min: Int): String = when {
    min < 60 -> "${min}분"
    min % 60 == 0 -> "${min / 60}시간"
    else -> "${min / 60}시간 ${min % 60}분"
}

/** 받침이 있으면 '이', 없으면 '가' (아빠가 · 지민이). */
private fun iGa(word: String): String {
    val c = word.lastOrNull() ?: return "가"
    return if (c in '가'..'힣' && (c - '가') % 28 != 0) "이" else "가"
}

/** 고른 사람: 서버 글자 "폰:아빠"·디버그 "아빠 폰" → "아빠". 차에서 골랐으면 null. */
internal fun phoneChooser(by: String?): String? = when {
    by == null -> null
    by.startsWith("폰:") -> by.removePrefix("폰:").ifBlank { "가족" }
    by.endsWith(" 폰") -> by.removeSuffix(" 폰")
    else -> null
}

/** 카드 제목: 장소 이름이 글자 중간에서 끊기지 않게 '이름 [화살표]' 덩어리로 줄을 바꾼다. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CourseTitle(o: PlanOption, size: TextUnit, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    val names = if (o.kind == OptionKind.GO_HOME) listOf(o.label.takeIf { it.startsWith("바로") } ?: "바로 집으로") else o.stops.map { it.name }
    val gap = with(LocalDensity.current) { (size * 0.3f).toDp() }
    val c = Ms.c
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(gap), maxLines = maxLines) {
        names.forEachIndexed { i, n ->
            // width(IntrinsicSize.Max): 덩어리의 최소 폭 = 실제 폭 → 카드 높이 맞추기의 FlowRow 계산이 줄 수를 덜 세지 않게
            Row(Modifier.width(IntrinsicSize.Max), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(gap)) {
                Text(n, Modifier.weight(1f, fill = false), fontSize = size, fontWeight = FontWeight.ExtraBold, color = c.ink, lineHeight = size * 1.25f, maxLines = 1)
                if (i < names.lastIndex) MsIcon(Lucide.ArrowRight, size, tint = c.ink3, scale = 0.8f)
            }
        }
    }
}

private fun optionLabel(o: PlanOption) = when {
    o.kind == OptionKind.GO_HOME && o.label != "오늘은 쉬어요" -> "곧장 귀가"
    else -> o.label
}

internal fun optionMeta(o: PlanOption): String {
    val home = clock(o.arriveHomeMin)
    return when (o.kind) {
        OptionKind.GO_HOME -> "${o.firstLegMin}분 · $home 도착"
        OptionKind.COURSE -> {
            val stamps = o.stops.count { it.stampable }
            listOfNotNull("첫 이동 ${o.firstLegMin}분", "도장 $stamps".takeIf { stamps > 0 }, "$home 귀가").joinToString(" · ")
        }
        else -> listOfNotNull("${o.firstLegMin}분", o.detourMin?.let { "돌아가는 길 +${it}분" }, "$home 귀가").joinToString(" · ")
    }
}

@Composable
fun PlanScreen(plan: Plan, note: String?, dinnerMin: Int?, narrow: Boolean, wide: Boolean, onChoose: (PlanOption) -> Unit, outOfAreaKm: Int? = null) {
    // 폰에서 고른 코스가 있으면 그 카드 하나. '다른 코스 보기'를 누르면 3장으로 (계획이 바뀌면 다시 고른 코스)
    var showAll by remember(plan) { mutableStateOf(false) }
    val chosen = plan.chosenOption
    // 저녁 나들이 계획엔 저녁 시각을 따지지 않는다 (귀가 한계 = 잠자는 시간 · 늦어도 몇 시)
    val dinner = dinnerMin.takeIf { plan.mode == PlanMode.AFTERNOON && !plan.evening }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = if (narrow) Ms.sXl else Ms.page, vertical = Ms.sXl),
        verticalArrangement = Arrangement.spacedBy(Ms.sL),
    ) {
        TitleRow(plan, dinner, note)
        outOfAreaKm?.let { OutOfAreaCard(it) }
        if (chosen != null && !showAll) {
            ReadyCard(plan, chosen, dinner, wide, onStart = { onChoose(chosen) }, onOthers = { showAll = true })
        } else {
            Cards(plan, dinner, narrow, wide, onChoose)
        }
    }
}

/** 시범 지역 밖: 가까운 명소가 없어서 추천이 '바로 집으로'뿐일 수 있다는 안내. */
@Composable
private fun OutOfAreaCard(km: Int) {
    val c = Ms.c
    MsCard(Modifier.fillMaxWidth(), tint = true, pad = Ms.sXl) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Ms.sL)) {
            MsIcon(Lucide.MapPin, Ms.body, tint = c.accent)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("지금은 대구·경북 시범 지역에서 추천해요", fontSize = Ms.body, fontWeight = FontWeight.Bold, color = c.ink)
                Text("가장 가까운 명소까지 약 ${km}km라 가까운 코스가 없어요", fontSize = Ms.sub, color = c.ink2)
            }
        }
    }
}

@Composable
private fun Cards(plan: Plan, dinner: Int?, narrow: Boolean, wide: Boolean, onChoose: (PlanOption) -> Unit) {
    val first = plan.options.firstOrNull() ?: run {
        MsEmpty(Lucide.Route, "지금은 추천할 곳이 없어요", Modifier.fillMaxWidth().padding(top = 80.dp), GoWords.pickLine(LocalGoWith.current).replace("오늘 ", ""))
        return
    }
    val rest = plan.options.drop(1)
    if (wide && rest.isNotEmpty()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Ms.sXl)) {
            HeroCard(plan, first, plan.chosen == 0, dinner, Modifier.weight(1.45f), onChoose)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Ms.sL)) {
                Text("다른 코스", fontSize = Ms.sub, fontWeight = FontWeight.Bold, color = Ms.c.ink3)
                rest.forEachIndexed { i, o -> CompactCard(o, plan.chosen == i + 1, stacked = true, onChoose = onChoose) }
            }
        }
    } else {
        HeroCard(plan, first, plan.chosen == 0, dinner, Modifier.fillMaxWidth(), onChoose)
        if (rest.isNotEmpty()) {
            rest.forEachIndexed { i, o -> CompactCard(o, plan.chosen == i + 1, stacked = narrow, onChoose = onChoose) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TitleRow(plan: Plan, dinner: Int?, note: String?) {
    val c = Ms.c
    val go = LocalGoWith.current
    val title = when {
        plan.evening -> GoWords.eveningTitle(go)
        plan.mode == PlanMode.MORNING -> "오늘 어디 갈까요"
        plan.mode == PlanMode.AFTERNOON -> "어디 들렀다 갈까요"
        else -> "다음은 어디로 갈까요"
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Ms.sL), verticalArrangement = Arrangement.spacedBy(Ms.sS)) {
        GoWithChip(LocalGoWith.current, Modifier.align(Alignment.CenterVertically))
        Text(title, fontSize = Ms.h2, fontWeight = FontWeight.ExtraBold, color = c.ink, modifier = Modifier.align(Alignment.CenterVertically))
        Text(listOfNotNull(clock(plan.nowMin), (if (plan.evening) "${GoWords.eveningLimit(go)} ${clock(plan.backByMin)}" else "${W.limit} ${clock(plan.backByMin)}").takeIf { plan.mode != PlanMode.AFTERNOON || plan.evening }, "여유 ${plan.budgetMin}분".takeIf { plan.mode == PlanMode.REBOARD }).joinToString(" · "), fontSize = Ms.sub, fontWeight = FontWeight.SemiBold, color = c.ink3, modifier = Modifier.align(Alignment.CenterVertically))
    }
    SkyChips(plan, dinner, note)
}

/** 하늘 칩 한 줄: 날씨(비 시각) · 미세먼지 · 해 · 저녁 · 귀가 한계. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SkyChips(plan: Plan, dinner: Int?, note: String?) {
    val sky = plan.sky
    data class SkyChip(val tone: MsTone, val parts: List<ChipPart>)
    val chips = buildList {
        val rain = sky?.rainFromMin?.takeIf { it > plan.nowMin }
        when (sky?.sky) {
            Sky.CLEAR -> add(SkyChip(MsTone.PLAIN, listOf(ChipPart(Lucide.Sun, if (rain != null) "맑음 · ${clock(rain)}부터 비" else "맑음"))))
            Sky.RAIN -> add(SkyChip(MsTone.RAIN, listOf(ChipPart(Lucide.CloudRain, "비"))))
            Sky.SNOW -> add(SkyChip(MsTone.PLAIN, listOf(ChipPart(Lucide.Snowflake, "눈"))))
            else -> if (rain != null) add(SkyChip(MsTone.RAIN, listOf(ChipPart(Lucide.CloudRain, "${clock(rain)}부터 비"))))
        }
        sky?.air?.takeIf { it != AirLevel.UNKNOWN }?.let { a -> add(SkyChip(if (a.bad) MsTone.AIR else MsTone.PLAIN, listOf(ChipPart(Lucide.Wind, "미세먼지 ${a.text}")))) }
        val set = sky?.sunsetMin
        if (set != null) {
            val left = set - plan.nowMin
            add(SkyChip(MsTone.SUN, listOf(ChipPart(Lucide.Sunset, "해 짐 ${clock(set)}" + if (left in 1..180) " · ${dur(left)} 남음" else ""))))
        }
        if (dinner != null) add(SkyChip(MsTone.PLAIN, listOf(ChipPart(Lucide.Utensils, "저녁 ${clock(dinner)}"))))
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Ms.sM), verticalArrangement = Arrangement.spacedBy(Ms.sS)) {
        chips.forEach { MsChip(it.parts, it.tone) }
        note?.let { Text(it, fontSize = Ms.cap, color = Ms.c.ink3, modifier = Modifier.align(Alignment.CenterVertically)) }
    }
}

/** 1순위 주인공 카드: 이름표 · 코스 이름 크게 · 한 줄 · 하루 막대 · 이유 칩 3개 · 큰 버튼. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HeroCard(plan: Plan, o: PlanOption, picked: Boolean, dinner: Int?, modifier: Modifier, onChoose: (PlanOption) -> Unit) {
    val c = Ms.c
    val shape = RoundedCornerShape(Ms.rXl)
    Column(
        modifier.clip(shape).background(c.surface).border(if (picked) 3.dp else 1.dp, if (picked) c.accent else c.line, shape)
            .padding(horizontal = Ms.sXxl, vertical = Ms.sXl),
        verticalArrangement = Arrangement.spacedBy(Ms.sM),
    ) {
        Text(optionLabel(o).let { if (it.startsWith("1순위")) it else "1순위 · $it" } + if (picked) " · 고른 코스" else "", fontSize = Ms.sub, fontWeight = FontWeight.Bold, color = c.accent)
        CourseTitle(o, 44.sp)
        Text(optionMeta(o), fontSize = Ms.body, fontWeight = FontWeight.SemiBold, color = c.ink2)
        DayBar(o, plan.nowMin, plan.sky?.sunsetMin, dinner, Modifier.fillMaxWidth())
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Ms.sS), verticalArrangement = Arrangement.spacedBy(Ms.sS), maxLines = 1) {
            reasonsFor(o.reasons, LocalGoWith.current).take(3).forEach { ReasonChip(it) }
        }
        Spacer(Modifier.height(Ms.sXs))
        MsPrimaryCTA(W.start, { onChoose(o) }, icon = Lucide.Navigation)
    }
}

/** 2·3순위: 짧게 — 이름표 · 코스 이름(한 줄) · 한 줄, 오른쪽에 작은 버튼. [stacked]면 버튼을 아래로. */
@Composable
private fun CompactCard(o: PlanOption, picked: Boolean, stacked: Boolean, onChoose: (PlanOption) -> Unit) {
    val c = Ms.c
    val shape = RoundedCornerShape(Ms.rLg)
    val body: @Composable (Modifier) -> Unit = { m ->
        Column(m, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(optionLabel(o) + if (picked) " · 고른 코스" else "", fontSize = Ms.cap, fontWeight = FontWeight.Bold, color = c.accent, maxLines = 1)
            if (stacked) CourseTitle(o, 30.sp)
            else Text(
                if (o.kind == OptionKind.GO_HOME) o.label else o.stops.joinToString(" → ") { it.name },
                fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(optionMeta(o), fontSize = Ms.cap, color = c.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    val m = Modifier.fillMaxWidth().clip(shape).background(c.surface).border(if (picked) 3.dp else 1.dp, if (picked) c.accent else c.line, shape)
        .clickable(role = Role.Button) { onChoose(o) }.padding(horizontal = Ms.sXl, vertical = Ms.sM)
    if (stacked) {
        Column(m, verticalArrangement = Arrangement.spacedBy(Ms.sM)) {
            body(Modifier.fillMaxWidth())
            MsActionButton(W.start, { onChoose(o) }, Modifier.fillMaxWidth(), Lucide.Navigation)
        }
    } else {
        Row(m, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Ms.sL)) {
            body(Modifier.weight(1f))
            MsActionButton("이 길로", { onChoose(o) }, icon = Lucide.Navigation)
        }
    }
}

/** 폰(또는 차)에서 이미 고른 코스: 누가 골랐는지 + 큰 출발 버튼 + 다른 코스 보기. 넓은 창은 오른쪽 단에 막대·칩. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ReadyCard(plan: Plan, o: PlanOption, dinner: Int?, wide: Boolean, onStart: () -> Unit, onOthers: () -> Unit) {
    val c = Ms.c
    val who = phoneChooser(plan.chosenBy)
    val head: @Composable () -> Unit = {
        MsChip(if (who != null) "$who${iGa(who)} 폰에서 고른 코스" else "차에서 고른 코스", if (who != null) Lucide.Smartphone else Lucide.CarFront, MsTone.STAMP, size = Ms.body)
        CourseTitle(o, 50.sp, Modifier.padding(top = Ms.sXs))
        Text(optionMeta(o), fontSize = Ms.body, fontWeight = FontWeight.SemiBold, color = c.ink2)
    }
    val detail: @Composable () -> Unit = {
        DayBar(o, plan.nowMin, plan.sky?.sunsetMin, dinner, Modifier.fillMaxWidth())
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Ms.sS), verticalArrangement = Arrangement.spacedBy(Ms.sS)) {
            reasonsFor(o.reasons, LocalGoWith.current).take(4).forEach { ReasonChip(it) }
        }
    }
    val buttons: @Composable () -> Unit = {
        MsPrimaryCTA(W.start, onStart, icon = Lucide.Navigation, sub = "내비가 길을 안내해요")
        MsActionButton("다른 코스 보기", onOthers, Modifier.fillMaxWidth(), Lucide.LayoutList, ActTone.GHOST)
    }
    val shape = RoundedCornerShape(Ms.rXl)
    val card = Modifier.fillMaxWidth().clip(shape).background(c.surface).border(3.dp, c.accent, shape).padding(horizontal = Ms.sSec, vertical = Ms.sXxl)
    if (wide) {
        Row(card, horizontalArrangement = Arrangement.spacedBy(Ms.sSec)) {
            Column(Modifier.weight(1.2f), verticalArrangement = Arrangement.spacedBy(Ms.sM)) { head(); Spacer(Modifier.height(Ms.sL)); buttons() }
            Column(Modifier.weight(1f).padding(top = Ms.sXl), verticalArrangement = Arrangement.spacedBy(Ms.sL)) { detail() }
        }
    } else {
        Column(card, verticalArrangement = Arrangement.spacedBy(Ms.sM)) { head(); detail(); Spacer(Modifier.height(Ms.sS)); buttons() }
    }
}

// ---------------------------------------------------------------- 하루 막대

/**
 * 하루 막대: 이동(회색) · 머무름(잉크) · 차에서 낮잠(파란 줄무늬) · 집으로(노랑) + 표시선 지금 · 해 짐(주황) · 저녁.
 * 가로 범위 = 지금 10분 전 ~ 귀가·해 짐·저녁 중 늦은 것 + 20분. 색은 토큰 bar (낮/밤).
 * 표시 글이 서로 겹치면 아래 줄로 내린다.
 */
@Composable
fun DayBar(o: PlanOption, nowMin: Int, sunsetMin: Int?, dinnerMin: Int?, modifier: Modifier = Modifier) {
    val tm = rememberTextMeasurer()
    val bar = Ms.c.bar
    // 아이와가 아니면 낮잠 칸(파란 줄무늬)은 보통 이동으로 그린다
    val nap = GoWords.showNap(LocalGoWith.current)
    val label = TextStyle(fontSize = Ms.mark, fontWeight = FontWeight.Bold)
    val first = o.legs.firstOrNull()?.fromMin ?: nowMin
    val start = (minOf(nowMin, first) - 10).let { it - Math.floorMod(it, 10) }
    val end = maxOf(o.arriveHomeMin, sunsetMin ?: 0, dinnerMin ?: 0, start + 60) + 20
    val marks = buildList {
        add(Triple(nowMin, "지금", bar.markNow to bar.markNow))
        sunsetMin?.let { add(Triple(it, "해 짐 ${clock(it, compact = true)}", bar.markSun to bar.markSunText)) }
        dinnerMin?.let { add(Triple(it, "저녁 ${clock(it, compact = true)}", bar.markDinner to bar.markDinner)) }
    }.sortedBy { it.first }
    Canvas(modifier.height(112.dp)) {
        val w = size.width
        fun x(m: Int) = ((m - start).toFloat() / (end - start)).coerceIn(0f, 1f) * w
        val top = 14.dp.toPx()
        val h = 30.dp.toPx()
        val track = Path().apply { addRoundRect(RoundRect(0f, top, w, top + h, CornerRadius(h / 2))) }
        clipPath(track) {
            drawRect(bar.track, Offset(0f, top), Size(w, h))
            for (leg in o.legs) {
                val l = x(leg.fromMin)
                val r = x(leg.toMin)
                if (r <= l) continue
                when (leg.kind) {
                    LegKind.NAP_DRIVE -> if (nap) clipRect(l, top, r, top + h) {
                        drawRect(bar.nap, Offset(l, top), Size(r - l, h))
                        val step = 9.dp.toPx()
                        var k = l - h
                        while (k < r) {
                            drawLine(bar.napStripe, Offset(k, top + h), Offset(k + h, top), strokeWidth = 4.5.dp.toPx())
                            k += step
                        }
                    } else drawRect(bar.drive, Offset(l, top), Size(r - l, h))
                    LegKind.DRIVE -> drawRect(bar.drive, Offset(l, top), Size(r - l, h))
                    LegKind.STAY, LegKind.MEAL -> drawRect(bar.stay, Offset(l, top), Size(r - l, h))
                    LegKind.HOME -> drawRect(bar.home, Offset(l, top), Size(r - l, h))
                }
            }
        }
        // 표시 글: 막대 안으로 당기고, 앞 글과 겹치면 둘째 줄
        var lastRight = -1f
        var lastRow = 1
        for ((m, text, colors) in marks) {
            val mx = x(m)
            val layout = tm.measure(text, label.copy(color = colors.second))
            val lx = (mx - layout.size.width / 2f).coerceIn(0f, (w - layout.size.width).coerceAtLeast(0f))
            val row = if (lx < lastRight + 8.dp.toPx() && lastRow == 0) 1 else 0
            val ty = (54 + row * 28).dp.toPx()
            drawRect(colors.first, Offset(mx - 1.5.dp.toPx(), 2.dp.toPx()), Size(3.dp.toPx(), ty - 4.dp.toPx()))
            drawText(layout, topLeft = Offset(lx, ty))
            lastRight = lx + layout.size.width; lastRow = row
        }
    }
}
