package kr.milestamp.car.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.composables.icons.lucide.ArrowLeftRight
import com.composables.icons.lucide.Clock
import com.composables.icons.lucide.CloudRain
import com.composables.icons.lucide.Ellipsis
import com.composables.icons.lucide.Flag
import com.composables.icons.lucide.House
import com.composables.icons.lucide.LayoutList
import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.Utensils
import com.composables.icons.lucide.MapPin
import com.composables.icons.lucide.Moon
import com.composables.icons.lucide.Navigation
import com.composables.icons.lucide.Plus
import com.composables.icons.lucide.RefreshCw
import com.composables.icons.lucide.SkipForward
import com.composables.icons.lucide.Smartphone
import com.composables.icons.lucide.TriangleAlert
import com.composables.icons.lucide.Wind
import kr.milestamp.car.trip.ProposalShown
import kr.milestamp.engine.Change
import kr.milestamp.engine.ChangeSize
import kr.milestamp.engine.CourseEvent
import kr.milestamp.engine.Explanation
import kr.milestamp.engine.Geo
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.LiveCourseEngine
import kr.milestamp.engine.Place
import kr.milestamp.engine.PlanOption
import kr.milestamp.engine.SkyToday

/*
 * S4 장소에서 머무는 중 · 다시 탐(정차) — 폰 상태 B와 같은 구조 (docs/디자인-점검/3-car.md 2절 S4).
 *  (머리) 오늘 코스 · {도착지} 오후 4:47 도착 예정 · 지금 머무는 곳
 *  (몸)   쉬운 설명(한 줄) → 다음 목적지(NextHero) → 큰 버튼 하나 → 작은 버튼 줄(30분 더 · 들르기 · ···)
 *  (아래) 한 줄 타임라인 · 변경 칩            — 넓은 창(1706)은 오른쪽 둘째 단에 세로 타임라인 · 하루 막대 · 칩
 * 큰 버튼: 보통 '출발 · 길 안내'(남은 코스로 내비 다시), 늦어지면(B3) '지금 집으로 · 오후 4:30 도착'(확인 한 번),
 * 제안이 오면 주인공 자리를 제안 띠가 차지하고 큰 버튼은 '이걸로 바꾸기' (ScreenRule.coursePrimaryFor).
 * S5 휴게소 정차(남은 곳 없음)도 이 화면: 다음 = 도착지, 큰 버튼 '{도착지}으로 길 안내'.
 */

/** 코스 화면 위에 뜨는 겹창 (화면 캡처 때 처음부터 열 수 있게 이름으로). */
enum class CourseSheet { MORE, DETAILS, INSERT, REPLACE, CONFIRM_HOME }

@Composable
fun CourseScreen(
    course: LiveCourse,
    proposal: ProposalShown?,
    sky: SkyToday?,
    dinnerMin: Int?,
    nowMin: Int,
    narrow: Boolean,
    wide: Boolean,
    onCommand: (CourseEvent) -> Unit,
    onAdopt: (PlanOption) -> Unit,
    onDismissProposal: () -> Unit,
    /** 맨 위 쉬운 설명 (엔진 explain). */
    explain: Explanation? = null,
    /** '말로 듣기' — 짧은 음성 (IntroAudio.say). */
    onSpeak: (String) -> Unit = {},
    /** '출발 · 길 안내' — 남은 코스(없으면 도착지)로 내비를 다시 띄운다. */
    onNavigate: () -> Unit = {},
    /** 들르기·다음 바꾸기 후보 (엔진 추천 후보). */
    places: List<Place> = emptyList(),
    initialSheet: CourseSheet? = null,
) {
    var sheet by remember { mutableStateOf(initialSheet) }
    val primary = coursePrimaryFor(course, explain, proposal)
    val hero = heroFor(course)
    val cur = course.current

    val goHome = { sheet = null; onCommand(CourseEvent.GoHome(nowMin)) }
    val primaryAction: () -> Unit = when (primary) {
        CoursePrimary.ADOPT -> ({ proposal?.options?.firstOrNull()?.let(onAdopt) })
        CoursePrimary.GO_HOME_LATE, CoursePrimary.END_DAY -> ({ sheet = CourseSheet.CONFIRM_HOME })
        CoursePrimary.NAVIGATE, CoursePrimary.NAVIGATE_HOME -> onNavigate
    }

    val main: @Composable (Modifier) -> Unit = { m ->
        Column(m, verticalArrangement = Arrangement.spacedBy(Ms.sL)) {
            HeadRow(course)
            if (proposal != null) {
                ProposalBlock(proposal, onAdopt, onDismissProposal)
            } else if (explain != null) {
                MsExplainCard(explain, onSpeak, compact = !explain.warn && !wide)
            }
            if (cur != null) MsChip("지금 ${cur.place.name} · ${clock(cur.plannedDepartMin)}까지", Lucide.MapPin, MsTone.STAMP)
            MsNextHero(
                name = hero.name,
                kicker = if (hero.isEnd) "도착지" else if (hero.meal) "${W.next} · 밥" else W.next,
                icon = if (hero.isEnd) Lucide.House else if (hero.meal) Lucide.Utensils else Lucide.Navigation,
                arrive = "${clock(hero.arriveMin)} 도착 예정",
                sub = if (hero.isEnd) slackLine(course) else listOfNotNull(
                    "밥 먹고 가요".takeIf { hero.meal },
                    hero.dwellMin?.let { "머무름 ${LiveCourseEngine.dur(it)}" }, "도착하면 도장".takeIf { hero.stamp },
                ).joinToString(" · ").ifEmpty { null },
                warn = explain?.warn == true && hero.isEnd,
            )
            if (proposal == null) {
                MsPrimaryCTA(
                    primaryLabel(primary, course, explain), primaryAction,
                    icon = when (primary) { CoursePrimary.GO_HOME_LATE, CoursePrimary.NAVIGATE_HOME -> Lucide.House; CoursePrimary.END_DAY -> Lucide.Flag; else -> Lucide.Navigation },
                    sub = if (primary == CoursePrimary.NAVIGATE && course.remaining.size > 1) "남은 ${course.remaining.size}곳을 차례로 안내해요" else null,
                )
            }
            MsActionRow(buildList {
                // 제안·늦어짐 때는 길 안내가 큰 버튼이 아니므로 작은 버튼으로
                if (primary == CoursePrimary.ADOPT || primary == CoursePrimary.GO_HOME_LATE || primary == CoursePrimary.END_DAY) {
                    if (course.next != null) add(MsAction("길 안내", Lucide.Navigation, onClick = onNavigate))
                }
                if (cur != null && primary != CoursePrimary.GO_HOME_LATE) add(MsAction(W.more, Lucide.Plus, ActTone.ACCENT) { onCommand(CourseEvent.ExtendStay(nowMin, 30)) })
                if (primary != CoursePrimary.GO_HOME_LATE && primary != CoursePrimary.END_DAY) add(MsAction(W.insert, Lucide.MapPin) { sheet = CourseSheet.INSERT })
                add(MsAction("더 보기", Lucide.Ellipsis, iconOnly = size >= 2) { sheet = CourseSheet.MORE })
            })
            if (!wide) {
                MsStopTimeline(course, Modifier.padding(top = Ms.sXs))
                StatusChips(course, nowMin, max = if (narrow) 2 else 3, showChange = proposal == null)
                if (!narrow) MsDayBar(course.asOption(), nowMin, sky?.sunsetMin, dinnerMin, Modifier.padding(top = Ms.sXs))
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        if (wide) {
            Row(Modifier.fillMaxSize().padding(horizontal = Ms.page, vertical = Ms.sXl), horizontalArrangement = Arrangement.spacedBy(Ms.sSec)) {
                main(Modifier.weight(1.25f).verticalScroll(rememberScrollState()))
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Ms.sL)) {
                    MsCard(Modifier.fillMaxWidth()) {
                        MsStopTimeline(course, vertical = true)
                        Spacer(Modifier.height(Ms.sM))
                        MsDayBar(course.asOption(), nowMin, sky?.sunsetMin, dinnerMin, title = "하루 막대")
                    }
                    StatusChips(course, nowMin, max = 4, showChange = proposal == null)
                }
            }
        } else {
            main(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = if (narrow) Ms.sXl else Ms.page, vertical = Ms.sXl))
        }

        when (sheet) {
            CourseSheet.MORE -> MsOverlay("코스 바꾸기", { sheet = null }) {
                val next = course.next
                MsRow(if (next != null) "${W.skipNext} · ${next.place.name}" else W.skipNext, icon = Lucide.SkipForward,
                    sub = "다음 곳을 빼고 그다음으로", onClick = next?.let { { sheet = null; onCommand(CourseEvent.Skip(nowMin, it.id)) } })
                MsRow(W.replaceNext, icon = Lucide.ArrowLeftRight, sub = "다음 곳 대신 다른 곳으로", chevron = true,
                    onClick = next?.let { { sheet = CourseSheet.REPLACE } })
                MsRow("지금 ${toward(course.endName)}", icon = Lucide.House, sub = "남은 곳을 건너뛰고 ${toward(course.endName)} 안내해요", chevron = true,
                    onClick = { sheet = CourseSheet.CONFIRM_HOME })
                MsRow(W.details, icon = Lucide.LayoutList, sub = "곳마다 시각 · 하루 막대", chevron = true, onClick = { sheet = CourseSheet.DETAILS })
            }
            CourseSheet.DETAILS -> MsOverlay(W.details, { sheet = null }, maxWidth = 900.dp) {
                MsStopTimeline(course, vertical = true)
                Spacer(Modifier.height(Ms.sL))
                MsDayBar(course.asOption(), nowMin, sky?.sunsetMin, dinnerMin)
                Spacer(Modifier.height(Ms.sM))
                StatusChips(course, nowMin, max = 6)
            }
            CourseSheet.INSERT, CourseSheet.REPLACE -> {
                val replace = sheet == CourseSheet.REPLACE
                MsOverlay(if (replace) "다음 곳 대신 어디로" else "어디 들를까요", { sheet = null }) {
                    val picks = candidates(course, places)
                    if (picks.isEmpty()) MsEmpty(Lucide.MapPin, "들를 만한 곳이 없어요", Modifier.fillMaxWidth().padding(Ms.sXl))
                    picks.forEach { (p, km) ->
                        MsRow(p.name, icon = Lucide.MapPin, sub = listOfNotNull("약 ${"%.0f".format(km)}km", if (p.indoor) "실내" else "야외", "도장".takeIf { p.stampable }).joinToString(" · "),
                            onClick = {
                                sheet = null
                                onCommand(if (replace) CourseEvent.ReplaceNext(nowMin, p.id) else CourseEvent.Insert(nowMin, p.id))
                            })
                    }
                }
            }
            CourseSheet.CONFIRM_HOME -> {
                val homeMin = explain?.homeMin
                MsConfirm(
                    title = if (primary == CoursePrimary.END_DAY) "오늘 코스를 마칠까요?" else "지금 ${toward(course.endName)} 갈까요?",
                    body = if (course.remaining.isNotEmpty()) "남은 ${LiveCourseEngine.josa(course.remaining.joinToString(", ") { it.place.name }, "은/는")} 건너뛰어요." +
                        (homeMin?.let { " ${course.endName}에 ${clock(it)}쯤 도착해요." } ?: "")
                    else homeMin?.let { "${course.endName}에 ${clock(it)}쯤 도착해요." },
                    confirm = if (primary == CoursePrimary.END_DAY) "오늘 코스 마치기" else "${toward(course.endName)} 안내",
                    onConfirm = goHome, onCancel = { sheet = null },
                )
            }
            null -> Unit
        }
    }
}

/** '여유 N분' / 귀가 한계를 넘으면 '귀가 한계보다 N분 늦어요'. */
private fun slackLine(c: LiveCourse): String =
    if (c.slackMin >= 0) "${W.limit} ${clock(c.limitMin)} · 여유 ${LiveCourseEngine.dur(c.slackMin)}" else "${W.limit}보다 ${LiveCourseEngine.dur(-c.slackMin)} 늦어요"

/** 머리 줄: 오늘 코스 · {도착지} 오후 4:47 도착 예정. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HeadRow(c: LiveCourse) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Ms.sL)) {
        Text("오늘 코스", fontSize = Ms.title, fontWeight = FontWeight.ExtraBold, color = Ms.c.ink, modifier = Modifier.align(Alignment.CenterVertically))
        Text(arriveText(c.endName, clock(c.arriveHomeMin)), fontSize = Ms.sub, fontWeight = FontWeight.SemiBold, color = Ms.c.ink3, modifier = Modifier.align(Alignment.CenterVertically))
    }
}

/** 들르기·다음 바꾸기 후보: 코스에 없는 곳을 지금(다음 곳) 가까운 순으로 8곳. */
private fun candidates(c: LiveCourse, places: List<Place>): List<Pair<Place, Double>> {
    val inCourse = c.stops.map { it.id }.toSet()
    val from = c.current?.place?.at ?: c.here ?: c.next?.place?.at ?: return emptyList()
    return places.filter { it.id !in inCourse && it.festival == null }.map { it to Geo.km(from, it.at) }.sortedBy { it.second }.take(8)
}

// ---------------------------------------------------------------- 칩

/** 마지막 변경 칩의 앞 아이콘: 원인별. */
private fun changeIcon(ch: Change): ImageVector = when (ch.cause) {
    "폰 변경" -> Lucide.Smartphone
    "집으로" -> Lucide.House
    "비" -> Lucide.CloudRain
    "미세먼지" -> Lucide.Wind
    "빼기", "문 닫음" -> Lucide.SkipForward
    "보류" -> Lucide.Clock
    else -> Lucide.RefreshCw
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StatusChips(c: LiveCourse, nowMin: Int, max: Int, showChange: Boolean = true) {
    // 제안 띠가 떠 있으면 같은 글을 칩으로 또 쓰지 않는다
    val change = c.lastChange?.takeIf { it.size != ChangeSize.QUIET && showChange }
    val go = LocalGoWith.current
    val nap = GoWords.showNap(go)
    val rain = c.rainFromMin?.takeIf { it > nowMin }
    val chips = buildList<Triple<ImageVector, String, MsTone>> {
        c.warnings.mapNotNull { GoWords.warning(it, go) }.forEach { add(Triple(Lucide.TriangleAlert, clockText(it), MsTone.WARN)) }
        change?.let { add(Triple(changeIcon(it), clockText(it.text), MsTone.STAMP)) }
        c.napLeg?.takeIf { nap }?.let { add(Triple(Lucide.Moon, "차에서 낮잠 ${it.minutes}분", MsTone.NAP)) }
        rain?.let { add(Triple(Lucide.CloudRain, "${clock(it)}부터 비", MsTone.RAIN)) }
    }.take(max)
    if (chips.isEmpty()) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Ms.sS), verticalArrangement = Arrangement.spacedBy(Ms.sS)) {
        chips.forEach { (icon, text, tone) -> MsChip(text, icon, tone) }
    }
}

// ---------------------------------------------------------------- 제안

/**
 * 제안이 오면 주인공 자리: 띠(변경 글) + 첫 안 '이걸로 바꾸기'(화면의 큰 버튼) / '그대로 갈게요'.
 * 둘째 안부터는 아래 짧은 줄 + 작은 '이걸로 바꾸기'.
 */
@Composable
private fun ProposalBlock(p: ProposalShown, onAdopt: (PlanOption) -> Unit, onKeep: () -> Unit) {
    val first = p.options.first()
    Column(verticalArrangement = Arrangement.spacedBy(Ms.sM)) {
        MsProposalBanner(
            text = clockText(p.change.text),
            sub = "${clockText(first.label)} · 바꾸면 ${clock(first.arriveHomeMin)} 도착",
            // '바로 집으로'만 남은 제안(귀가 한계를 넘음)은 빨간 띠
            warn = first.kind == kr.milestamp.engine.OptionKind.GO_HOME,
            onAdopt = { onAdopt(first) }, onKeep = onKeep,
        )
        p.options.drop(1).forEach { o ->
            MsCard(Modifier.fillMaxWidth(), pad = Ms.sL) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Ms.sL)) {
                    Column(Modifier.weight(1f)) {
                        Text(clockText(o.label), fontSize = Ms.body, fontWeight = FontWeight.ExtraBold, color = Ms.c.ink, maxLines = 1)
                        Text(optionSummary(o, withLabel = false), fontSize = Ms.cap, color = Ms.c.ink3, maxLines = 2)
                    }
                    MsActionButton(W.adopt, { onAdopt(o) }, tone = ActTone.ACCENT)
                }
            }
        }
    }
}

/** 제안 한 안 요약: '한 곳 더 · 디아크 · 바꾸면 집 오후 4:49 도착'. */
private fun optionSummary(o: PlanOption, withLabel: Boolean = true): String {
    val reason = o.reasons.firstOrNull { !it.text.endsWith("귀가") && !it.text.endsWith("도착") }?.text
    return listOfNotNull(clockText(o.label).takeIf { withLabel }, reason?.let(::clockText), "바꾸면 ${clock(o.arriveHomeMin)} 도착").distinct().joinToString(" · ")
}
