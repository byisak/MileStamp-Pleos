package kr.milestamp.car.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.composables.icons.lucide.BookOpen
import com.composables.icons.lucide.CarFront
import com.composables.icons.lucide.Check
import com.composables.icons.lucide.CircleAlert
import com.composables.icons.lucide.CircleCheck
import com.composables.icons.lucide.Clock
import com.composables.icons.lucide.Flag
import com.composables.icons.lucide.Gauge
import com.composables.icons.lucide.House
import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.MapPin
import com.composables.icons.lucide.MapPinCheck
import com.composables.icons.lucide.Minimize2
import com.composables.icons.lucide.Navigation
import com.composables.icons.lucide.QrCode
import com.composables.icons.lucide.Smartphone
import androidx.compose.runtime.CompositionLocalProvider
import com.composables.icons.lucide.Stamp
import com.composables.icons.lucide.TriangleAlert
import com.composables.icons.lucide.Volume2
import com.composables.icons.lucide.X
import kr.milestamp.car.BuildConfig
import kr.milestamp.car.net.StampRow
import kr.milestamp.car.net.StampStore
import kr.milestamp.car.trip.DaySummaryShown
import kr.milestamp.car.trip.PairShown
import kr.milestamp.car.trip.TripHub
import kr.milestamp.car.trip.UiState
import kr.milestamp.car.trip.VisitShown
import kr.milestamp.engine.CourseEvent
import kr.milestamp.engine.Gear
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.PlanOption
import kr.milestamp.engine.StopStatus
import kr.milestamp.engine.TripState

/**
 * 마일스탬프 옆 창. 화면 고르기는 [carScreenFor] (버튼 화면은 정차 = P단 · 주행 제한 없음일 때만).
 * 창 폭: 600dp 미만 = 좁게 / 600~1200 = 기본(841, 세로 한 단) / 1200 이상 = 넓게(1706, 오른쪽 둘째 단).
 * 상태별 화면 (docs/디자인-점검/3-car.md 2절): S0 대기 · S1 추천(PlanScreen) · S2/S5 주행 · S3 도장(StampMedal) ·
 * S4 코스(CourseScreen) · S6 집 도착 요약 → 오늘 나들이 끝.
 */
@Composable
fun MileStampScreen(
    ui: UiState,
    onChoose: (PlanOption) -> Unit,
    onDismissStamp: () -> Unit,
    onHide: () -> Unit,
    onPair: () -> Unit = {},
    onClosePair: () -> Unit = {},
    onCourseCommand: (CourseEvent) -> Unit = {},
    onDismissProposal: () -> Unit = {},
    onOpenBook: () -> Unit = {},
    onCloseBook: () -> Unit = {},
    onNavigate: () -> Unit = {},
    onStoryToPhone: (String) -> Unit = {},
    /** 도장북 기록 (null = StampStore 저장본). 화면 캡처 때만 직접 준다. */
    stamps: List<StampRow>? = null,
    /** 도장 화면을 이 순간(ms)에 멈춰 그림 (화면 캡처용). */
    medalMs: Float? = null,
    /** 도장북에서 처음부터 크게 볼 칸 (화면 캡처용). */
    bookDetail: String? = null,
    /** 코스 화면 겹창을 처음부터 열기 (화면 캡처용). */
    courseSheet: CourseSheet? = null,
) {
    val screen = carScreenFor(ui)
    val driving = screen == CarScreen.DRIVING
    val rows = stamps ?: StampStore.rows.collectAsState().value
    val offline = if (stamps != null) false else StampStore.offline.collectAsState().value
    // 달리기 시작하면 도장북은 닫는다 (다시 서도 저절로 뜨지 않게)
    LaunchedEffect(driving) { if (driving && ui.book) onCloseBook() }
    CompositionLocalProvider(LocalGoWith provides ui.companion) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Ms.c.bg)) {
        val narrow = maxWidth < 600.dp
        val wide = maxWidth >= 1200.dp
        Column(Modifier.fillMaxSize()) {
            Header(
                onHide, compact = narrow,
                onPair = onPair.takeUnless { driving || ui.pair != null },
                onBook = onOpenBook.takeUnless { driving || ui.book || ui.pair != null },
                // 개발자 상태판은 디버그 빌드에서 로고 길게 누르기로만
                onLogoLongPress = if (BuildConfig.DEBUG) ({ TripHub.toggleDevBoard() }) else null,
            )
            Box(Modifier.fillMaxSize()) {
                when (screen) {
                    CarScreen.DRIVING -> DrivingScreen(ui, wide)
                    CarScreen.PAIR -> PairScreen(ui.pair!!, onClosePair)
                    CarScreen.DEV_BOARD -> StatusScreen(ui, wide)
                    CarScreen.STAMP -> {
                        val s = ui.stamp!!
                        StampMedalScreen(
                            s, rows, narrow, wide, onOpenBook = onOpenBook, onClose = onDismissStamp, fixedMs = medalMs,
                            next = ui.course?.let { medalNextLine(it, s.place.id) },
                            storySent = ui.storySent == s.place.id,
                            onStoryToPhone = { onStoryToPhone(s.place.id) },
                        )
                    }
                    CarScreen.VISIT -> VisitScreen(ui.visit!!, ui.course, onDismissStamp)
                    CarScreen.BOOK -> StampBookScreen(rows, offline, narrow, wide, onClose = onCloseBook, initialOpen = bookDetail)
                    CarScreen.HELD -> HeldScreen(ui.held!!, onDismissStamp)
                    CarScreen.SUMMARY -> SummaryScreen(ui.summary!!, ui.snapshot?.stampsToday.orEmpty(), ui.course, narrow, wide, onDismissStamp)
                    CarScreen.PLAN -> PlanScreen(ui.plan!!, ui.planNote, ui.dinnerMin, narrow, wide, onChoose, ui.outOfAreaKm)
                    CarScreen.COURSE -> CourseScreen(
                        ui.course!!, ui.proposal, ui.sky, ui.dinnerMin, ui.snapshot?.nowMin ?: ui.course.nowMin, narrow, wide,
                        onCommand = onCourseCommand, onAdopt = onChoose, onDismissProposal = onDismissProposal,
                        explain = ui.explain, onSpeak = TripHub::speak, onNavigate = onNavigate,
                        places = TripHub.catalog, initialSheet = courseSheet,
                    )
                    CarScreen.DAY_END -> DayEndScreen(ui.lastSummary, ui.snapshot?.stampsToday.orEmpty(), ui.course, rows, narrow, wide)
                    CarScreen.WAITING -> WaitingScreen(waitKindFor(ui), greetingFor(ui.snapshot?.nowMin), rows, narrow, wide)
                }
            }
        }
    }
    }
}

/** 도장 화면 아래 '다음' 한 줄: 다음 · 국립대구과학관 · 오후 12:40 출발 예정 (남은 곳이 없으면 도착지). */
fun medalNextLine(c: LiveCourse, placeId: String): String {
    val here = c.stops.firstOrNull { it.id == placeId && it.status == StopStatus.ARRIVED } ?: c.current
    val depart = here?.plannedDepartMin
    val dest = c.next?.place?.name ?: c.endName
    return listOfNotNull("${W.next} · $dest", depart?.let { "${clock(it)} 출발 예정" }).joinToString(" · ")
}

/** 머리줄: 로고 · 이름 · (도장북) · (폰 연결) · 숨기기. 버튼 76dp, 좁은 창은 아이콘만. */
@Composable
private fun Header(onHide: () -> Unit, compact: Boolean, onPair: (() -> Unit)?, onBook: (() -> Unit)?, onLogoLongPress: (() -> Unit)? = null) {
    val c = Ms.c
    Row(
        Modifier.fillMaxWidth().height(Ms.headerH).background(c.surface).padding(horizontal = if (compact) 20.dp else Ms.page),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val logo = Modifier.size(62.dp).clip(RoundedCornerShape(16.dp)).background(c.ink)
        Box(
            if (onLogoLongPress == null) logo else logo.pointerInput(Unit) { detectTapGestures(onLongPress = { onLogoLongPress() }) },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(30.dp).border(3.dp, c.surface, CircleShape))
            Box(Modifier.size(9.dp).align(Alignment.TopEnd).clip(CircleShape).background(c.point))
        }
        Spacer(Modifier.width(if (compact) 14.dp else 20.dp))
        Text("마일스탬프", fontSize = Ms.title, fontWeight = FontWeight.ExtraBold, color = c.ink, maxLines = 1, modifier = Modifier.weight(1f))
        if (onBook != null) { MsActionButton("도장북", onBook, icon = Lucide.BookOpen, tone = ActTone.PLAIN, iconOnly = compact, height = Ms.touch); Spacer(Modifier.width(Ms.sM)) }
        if (onPair != null) { MsActionButton("폰 연결", onPair, icon = Lucide.QrCode, tone = ActTone.PLAIN, iconOnly = compact, height = Ms.touch); Spacer(Modifier.width(Ms.sM)) }
        MsActionButton("숨기기", onHide, icon = Lucide.Minimize2, tone = ActTone.GHOST, iconOnly = true, height = Ms.touch)
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
}

// ---------------------------------------------------------------- S2 · S5 주행 중 (신호 대기 포함) — 버튼 없이 2초 안에 읽히는 것만

@Composable
private fun DrivingScreen(ui: UiState, wide: Boolean) {
    val v = drivingViewFor(ui)
    val c = Ms.c
    val left: @Composable (Modifier) -> Unit = { m ->
        Column(m, verticalArrangement = Arrangement.Center) {
            if (v.name != null) {
                MsNextHero(v.name, kicker = v.kicker, icon = if (v.kicker == "도착지") Lucide.House else Lucide.Navigation, arrive = v.arrive, sub = v.sub, big = true)
            } else {
                Text("주행 중이에요", fontSize = 62.sp, fontWeight = FontWeight.ExtraBold, color = c.ink)
            }
            if (v.chip != null) {
                Spacer(Modifier.height(Ms.sSec))
                Text(
                    v.chip, fontSize = Ms.title, fontWeight = FontWeight.Bold, color = c.accentInk, maxLines = 2,
                    modifier = Modifier.clip(RoundedCornerShape(Ms.rLg)).background(c.accentSoft).padding(horizontal = Ms.sXxl, vertical = Ms.sL),
                )
            }
            Spacer(Modifier.height(Ms.sSec))
            IconText(Lucide.Volume2, "주행 중에는 소리로 안내해요", Ms.title, color = c.ink3, weight = FontWeight.SemiBold)
        }
    }
    val course = ui.course
    if (wide && course != null) {
        Row(Modifier.fillMaxSize().padding(horizontal = 72.dp, vertical = Ms.sSec), horizontalArrangement = Arrangement.spacedBy(72.dp), verticalAlignment = Alignment.CenterVertically) {
            left(Modifier.weight(1.3f))
            MsCard(Modifier.weight(1f)) { MsStopTimeline(course, vertical = true) }
        }
    } else {
        left(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 48.dp))
    }
}

// ---------------------------------------------------------------- 보류 (위조 의심) — 아이에게 실망 없는 말로

/**
 * 도장 없는 바깥 장소(ext:…) 도착: 메달·꽃가루·소리 없이 차분하게 — 체크 · '해운대해수욕장 다녀옴 · 기록했어요' ·
 * '도장북 다녀온 곳에 남겨요' · 다음 한 줄 · '확인'. 서비스가 잠시 뒤 저절로 닫는다.
 */
@Composable
private fun VisitScreen(v: VisitShown, course: LiveCourse?, onDone: () -> Unit) {
    val c = Ms.c
    Column(Modifier.fillMaxSize().padding(Ms.page), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        MsIconBadge(Lucide.MapPinCheck, BadgeTone.ACCENT, 104.dp)
        Spacer(Modifier.height(Ms.sXl))
        Text(visitLine(v.place.name, v.recorded), fontSize = Ms.h2, fontWeight = FontWeight.ExtraBold, color = c.ink, textAlign = TextAlign.Center)
        Spacer(Modifier.height(Ms.sM))
        Text(
            if (v.recorded) "도장이 없는 곳이라 ${GoWords.book(LocalGoWith.current)} '다녀온 곳'에 남겨요" else "도장이 없는 곳이에요",
            fontSize = Ms.body, color = c.ink2, textAlign = TextAlign.Center,
        )
        course?.let { Text(medalNextLine(it, v.place.id), fontSize = Ms.sub, color = c.ink3, textAlign = TextAlign.Center) }
        Spacer(Modifier.height(Ms.sSec))
        MsPrimaryCTA("확인", onDone, Modifier.widthIn(max = 520.dp), kind = CtaKind.SOFT, height = Ms.actH, icon = Lucide.Check)
    }
}

@Composable
private fun HeldScreen(text: String, onDone: () -> Unit) {
    val c = Ms.c
    Column(Modifier.fillMaxSize().padding(Ms.page), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        MsIconBadge(Lucide.Clock, BadgeTone.MUTE, 104.dp)
        Spacer(Modifier.height(Ms.sXl))
        Text("도장은 조금 뒤에 들어와요", fontSize = Ms.h2, fontWeight = FontWeight.ExtraBold, color = c.ink)
        Spacer(Modifier.height(Ms.sM))
        Text(text, fontSize = Ms.body, color = c.ink2, textAlign = TextAlign.Center)
        Text("주행 기록을 한 번 더 확인하고 있어요", fontSize = Ms.sub, color = c.ink3)
        Spacer(Modifier.height(Ms.sSec))
        MsPrimaryCTA("알겠어요", onDone, Modifier.widthIn(max = 520.dp), kind = CtaKind.SOFT, height = Ms.actH)
    }
}

// ---------------------------------------------------------------- 폰 연결 (정차 중에만)

@Composable
private fun PairScreen(p: PairShown, onClose: () -> Unit) {
    val c = Ms.c
    Column(Modifier.fillMaxSize().padding(Ms.page), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("가족 폰 연결", fontSize = Ms.h2, fontWeight = FontWeight.ExtraBold, color = c.ink)
        Spacer(Modifier.height(Ms.sS))
        Text("휴대폰 카메라로 찍으면 바로 연결돼요 (10분 동안)", fontSize = Ms.body, color = c.ink2)
        Spacer(Modifier.height(Ms.sXl))
        when {
            p.url != null -> {
                val qr = remember(p.url) { qrBitmap(p.url, 600) }
                // QR은 밤 화면에서도 흰 바탕 (카메라가 읽게)
                Box(Modifier.clip(RoundedCornerShape(Ms.rLg)).background(LightColors.surface).padding(24.dp)) {
                    Image(qr, contentDescription = "연결 QR", modifier = Modifier.size(300.dp))
                }
                Spacer(Modifier.height(Ms.sL))
                Text("코드 ${p.code}", fontSize = Ms.title, fontWeight = FontWeight.Bold, color = c.ink, letterSpacing = 4.sp)
            }
            p.error != null -> Text(p.error, fontSize = Ms.body, color = c.redText)
            else -> Text("준비 중…", fontSize = Ms.body, color = c.ink3)
        }
        Spacer(Modifier.height(Ms.sXl))
        IconText(
            if (p.phones.isEmpty()) Lucide.Smartphone else Lucide.CircleCheck,
            if (p.phones.isEmpty()) "아직 연결된 폰이 없어요" else "연결됨: ${p.phones.joinToString(" · ")}",
            Ms.body, color = if (p.phones.isEmpty()) c.ink3 else c.okText, weight = FontWeight.Bold,
        )
        Spacer(Modifier.height(Ms.sXl))
        MsActionButton("닫기", onClose, Modifier.widthIn(min = 320.dp), icon = Lucide.X, tone = ActTone.PLAIN)
    }
}

private fun qrBitmap(text: String, px: Int): ImageBitmap {
    val m = com.google.zxing.qrcode.QRCodeWriter().encode(text, com.google.zxing.BarcodeFormat.QR_CODE, px, px, mapOf(com.google.zxing.EncodeHintType.MARGIN to 1))
    val pixels = IntArray(px * px) { i -> if (m.get(i % px, i / px)) android.graphics.Color.BLACK else android.graphics.Color.WHITE }
    return android.graphics.Bitmap.createBitmap(pixels, px, px, android.graphics.Bitmap.Config.ARGB_8888).asImageBitmap()
}

// ---------------------------------------------------------------- S6 집 도착 (뒷좌석 경고 → 오늘 하루 요약 → 오늘 나들이 끝)

/** 오늘 찍은 곳 이름 → 장소 id (도장 그림). 모르는 이름은 뺀다. */
private fun stampIds(names: List<String>): List<String> =
    names.mapNotNull { name -> TripHub.catalog.firstOrNull { it.name == name }?.id ?: TripHub.findPlace(name)?.id }.distinct()

/** 다녀온 곳 수: 코스에서 다녀옴, 없으면 도장 찍은 곳. */
private fun visitedCount(course: LiveCourse?, stampsToday: List<String>): Int =
    course?.stops?.count { it.status == StopStatus.DONE }?.takeIf { it > 0 } ?: stampsToday.distinct().size

@Composable
private fun SummaryScreen(s: DaySummaryShown, stampsToday: List<String>, course: LiveCourse?, narrow: Boolean, wide: Boolean, onDone: () -> Unit) {
    var rearAck by remember(s) { mutableStateOf(false) }
    val go = LocalGoWith.current
    // 뒷좌석 아이 확인은 아이와만 (서비스도 어른끼리면 켜지 않는다)
    if (s.rearWarning && GoWords.rearSeatCheck(go) && !rearAck) { RearWarning { rearAck = true }; return }
    DayBody(
        title = "오늘 하루", s = s, stampsToday = stampsToday, course = course, narrow = narrow, wide = wide,
        note = GoWords.storySent(go),
    ) { MsPrimaryCTA(W.dayEnd, onDone, icon = Lucide.Flag) }
}

/** 뒷좌석 경고: 화면 전체, 빨강, '확인했어요'. */
@Composable
private fun RearWarning(onAck: () -> Unit) {
    val c = Ms.c
    Column(
        Modifier.fillMaxSize().background(c.redSoft).padding(Ms.page),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        MsIconBadge(Lucide.TriangleAlert, BadgeTone.WARN, 128.dp)
        Spacer(Modifier.height(Ms.sXl))
        Text("뒷좌석에 아이가 있어요", fontSize = Ms.display, fontWeight = FontWeight.ExtraBold, color = c.redText, textAlign = TextAlign.Center)
        Spacer(Modifier.height(Ms.sM))
        Text("내리기 전에 먼저 확인해 주세요", fontSize = Ms.title, color = c.redText, textAlign = TextAlign.Center)
        Spacer(Modifier.height(Ms.sSec))
        MsPrimaryCTA("확인했어요", onAck, Modifier.widthIn(max = 640.dp), icon = Lucide.CircleCheck, kind = CtaKind.DANGER)
    }
}

/** 오늘 하루 몸통: 제목 · 도장 동전 줄 · 숫자 카드(도장 · 다녀온 곳 · km) · 한 줄 · 버튼 자리. 넓은 창은 두 단. */
@Composable
private fun DayBody(
    title: String, s: DaySummaryShown?, stampsToday: List<String>, course: LiveCourse?, narrow: Boolean, wide: Boolean,
    note: String?, footer: @Composable () -> Unit,
) {
    val c = Ms.c
    val ids = stampIds(stampsToday)
    val stampsN = s?.stamps ?: stampsToday.size
    val stats = listOfNotNull(
        Stat("$stampsN", "도장", Lucide.Stamp, "개"),
        Stat("${visitedCount(course, stampsToday)}", "다녀온 곳", Lucide.MapPin, "곳"),
        s?.km?.let { Stat("%.0f".format(it), "달린 길", Lucide.Gauge, "km") },
    )
    val coins: @Composable () -> Unit = {
        if (ids.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(Ms.sL)) {
            ids.take(if (narrow) 3 else 4).forEach { id ->
                stampPainter(id, rare = false)?.let { Image(it, contentDescription = null, modifier = Modifier.size(if (narrow) 104.dp else if (wide && ids.size > 3) 120.dp else 140.dp)) }
            }
        } else MsIconBadge(Lucide.House, BadgeTone.ACCENT, 120.dp)
    }
    val head: @Composable () -> Unit = {
        Text(title, fontSize = Ms.display, fontWeight = FontWeight.ExtraBold, color = c.ink)
        if (stampsToday.isNotEmpty()) Text(
            stampsToday.distinct().joinToString(" · ") + ((s?.rare ?: 0).takeIf { it > 0 }?.let { " · 희귀 도장 ${it}개" } ?: ""),
            fontSize = Ms.body, lineHeight = Ms.body * 1.35f, color = c.ink2, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        else Text("오늘은 도장 없이 다녀왔어요", fontSize = Ms.body, color = c.ink2)
    }
    if (wide) {
        Row(Modifier.fillMaxSize().padding(horizontal = 72.dp, vertical = Ms.sSec), horizontalArrangement = Arrangement.spacedBy(72.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Ms.sL)) { head(); Spacer(Modifier.height(Ms.sM)); coins() }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Ms.sXl)) {
                MsStatStrip(stats)
                note?.let { IconText(Lucide.Smartphone, it, Ms.sub, color = c.ink3, weight = FontWeight.SemiBold) }
                footer()
            }
        }
    } else {
        Column(
            Modifier.fillMaxSize().padding(horizontal = if (narrow) Ms.sXl else 56.dp, vertical = Ms.sSec),
            verticalArrangement = Arrangement.spacedBy(Ms.sXl, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Ms.sS)) { head() }
            coins()
            MsStatStrip(stats)
            note?.let { IconText(Lucide.Smartphone, it, Ms.sub, color = c.ink3, weight = FontWeight.SemiBold) }
            Box(Modifier.fillMaxWidth()) { footer() }
        }
    }
}

// ---------------------------------------------------------------- S0 대기 화면 (시동 직후 · 계획 받는 중 / 고른 코스 없음)

@Composable
private fun WaitingScreen(kind: WaitKind, greeting: String, rows: List<StampRow>, narrow: Boolean, wide: Boolean) {
    val c = Ms.c
    val go = LocalGoWith.current
    val status: @Composable () -> Unit = {
        GoWithChip(go)
        Spacer(Modifier.height(Ms.sM))
        Text(if (kind == WaitKind.TOMORROW) GoWords.TOMORROW_TITLE else greeting, fontSize = Ms.display, fontWeight = FontWeight.ExtraBold, color = c.ink, lineHeight = Ms.display * 1.2f)
        Spacer(Modifier.height(Ms.sL))
        when (kind) {
            WaitKind.BEFORE_BOARD -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MsIcon(Lucide.CarFront, Ms.title, tint = c.accent, scale = 1.1f)
                    Spacer(Modifier.width(Ms.sL))
                    Text(GoWords.BOARD_TITLE, fontSize = Ms.title, fontWeight = FontWeight.Bold, color = c.accent)
                }
                Spacer(Modifier.height(Ms.sM))
                Text(GoWords.boardLine(go), fontSize = Ms.body, color = c.ink2)
            }
            WaitKind.LOADING -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // 빙글 도는 표시는 시동 전·대기 중 내내 화면을 매 프레임 다시 그려 CPU를 한 코어의 17%쯤 썼다
                    // (Pleos 심사: 정차 25%·주행 5% 미만) → 멈춘 시계 아이콘으로
                    MsIcon(Lucide.Clock, Ms.title, tint = c.accent, scale = 1.1f)
                    Spacer(Modifier.width(Ms.sL))
                    Text("오늘 코스를 불러오는 중이에요", fontSize = Ms.title, fontWeight = FontWeight.Bold, color = c.accent)
                }
                Spacer(Modifier.height(Ms.sM))
                Text(GoWords.loadingLine(go), fontSize = Ms.body, color = c.ink2)
            }
            WaitKind.NO_COURSE -> {
                Text(GoWords.pickLine(go), fontSize = Ms.title, fontWeight = FontWeight.Bold, color = c.accent)
                Spacer(Modifier.height(Ms.sM))
                Text("고르면 여기에 바로 떠요. 폰을 아직 연결하지 않았다면 위의 '폰 연결'을 눌러 주세요", fontSize = Ms.body, color = c.ink2, lineHeight = Ms.body * 1.35f)
            }
            WaitKind.TOMORROW -> {
                Text(GoWords.tomorrowLine(go), fontSize = Ms.title, fontWeight = FontWeight.Bold, color = c.accent, lineHeight = Ms.title * 1.3f)
                Spacer(Modifier.height(Ms.sM))
                Text("오늘은 조심히 들어가세요", fontSize = Ms.body, color = c.ink2)
            }
        }
    }
    if (wide) {
        Row(Modifier.fillMaxSize().padding(horizontal = 72.dp, vertical = Ms.sSec), horizontalArrangement = Arrangement.spacedBy(72.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1.1f)) { status() }
            Column(Modifier.weight(1f)) { StampProgressCard(rows, recent = 4) }
        }
    } else {
        Box(Modifier.fillMaxSize().padding(horizontal = if (narrow) 28.dp else 56.dp, vertical = 40.dp), contentAlignment = Alignment.Center) {
            Column(Modifier.widthIn(max = 960.dp).fillMaxWidth()) {
                status()
                Spacer(Modifier.height(44.dp))
                StampProgressCard(rows, recent = if (narrow) 0 else 4)
            }
        }
    }
}

/** 도장북 N/34칸 + 막대 (+ 최근 찍은 도장 [recent]개). */
@Composable
private fun StampProgressCard(rows: List<StampRow>, recent: Int = 0) {
    val c = Ms.c
    val got = StampAlbum.gotCount(rows)
    val total = StampAlbum.ALL.size
    MsCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconText(Lucide.Stamp, "도장북", Ms.body, color = c.ink2, weight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("$got/${total}칸", fontSize = Ms.title, fontWeight = FontWeight.ExtraBold, color = c.ink)
        }
        Spacer(Modifier.height(Ms.sL))
        Box(Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(50)).background(c.fill)) {
            if (got > 0) Box(Modifier.fillMaxWidth(got.toFloat() / total).height(14.dp).clip(RoundedCornerShape(50)).background(c.accent))
        }
        val last = rows.sortedByDescending { it.atMs ?: 0L }.map { it.placeId }.distinct().take(recent)
        if (last.isNotEmpty()) {
            Spacer(Modifier.height(Ms.sL))
            Text("최근 찍은 도장", fontSize = Ms.cap, fontWeight = FontWeight.Bold, color = c.ink3)
            Spacer(Modifier.height(Ms.sS))
            Row(horizontalArrangement = Arrangement.spacedBy(Ms.sM)) {
                last.forEach { id -> stampPainter(id, rare = false)?.let { Image(it, contentDescription = null, modifier = Modifier.size(96.dp)) } }
            }
        }
    }
}

// ---------------------------------------------------------------- 오늘 나들이 끝 (집 도착 요약을 닫은 뒤)

@Composable
private fun DayEndScreen(s: DaySummaryShown?, stampsToday: List<String>, course: LiveCourse?, rows: List<StampRow>, narrow: Boolean, wide: Boolean) {
    DayBody(title = W.dayEnd, s = s, stampsToday = stampsToday, course = course, narrow = narrow, wide = wide, note = null) {
        Column(verticalArrangement = Arrangement.spacedBy(Ms.sL)) {
            Text("내일 또 만나요", fontSize = Ms.title, fontWeight = FontWeight.Bold, color = Ms.c.accent)
            StampProgressCard(rows)
        }
    }
}

// ---------------------------------------------------------------- 개발자 상태판 (디버그 빌드에서 로고 길게 누르기 · 디버그 입력 DEV_BOARD)
@Composable
private fun StatusScreen(ui: UiState, wide: Boolean) {
    val c = Ms.c
    val s = ui.snapshot
    val rows = listOf(
        "상태" to (s?.state?.label() ?: "연결 중"),
        "기어 · 속도" to (s?.let { "${it.gear.label()} · %.0f km/h".format(it.speedKmh) } ?: "-"),
        "누적 주행거리" to (s?.odoKm?.let { "%.1f km".format(it) } ?: "-"),
        "2열 탑승 · 운전석 문" to (s?.let { "${it.rearOccupied}명 · ${if (it.driverDoorOpen) "열림" else "닫힘"}" } ?: "-"),
        "현재 위치" to (s?.location?.let { "%.4f, %.4f".format(it.lat, it.lng) } ?: "-"),
        "시각 · 날씨" to (s?.let { "${clock(it.nowMin)} · ${it.sky}" + if (it.quiet) " · 쉿 모드" else "" } ?: "-"),
        "다음 정차지" to (s?.nextStop ?: "-"),
        "오늘 도장" to (s?.stampsToday?.takeIf { it.isNotEmpty() }?.joinToString(", ") ?: "아직 없음"),
    )
    val content: @Composable (Modifier) -> Unit = { m ->
        Column(m.clip(RoundedCornerShape(Ms.rLg)).background(c.surface).padding(28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("지금 차 상태", fontSize = Ms.title, fontWeight = FontWeight.Bold, color = c.ink)
            rows.forEach { (k, v) ->
                Row { Text(k, fontSize = Ms.cap, color = c.ink3, modifier = Modifier.width(260.dp)); Text(v, fontSize = Ms.cap, color = c.ink) }
            }
            ui.introPlaying?.let { IconText(Lucide.Volume2, "$it 소개 재생 중", Ms.cap, color = c.accent) }
            Spacer(Modifier.height(6.dp))
            Text("연결", fontSize = Ms.body, fontWeight = FontWeight.Bold, color = c.ink)
            ui.sources.values.forEach { src ->
                IconText(if (src.ok) Lucide.CircleCheck else Lucide.CircleAlert, "${src.name} — ${src.detail}", 20.sp, color = if (src.ok) c.ink else c.redText)
            }
        }
    }
    val log: @Composable (Modifier) -> Unit = { m ->
        Column(m.clip(RoundedCornerShape(Ms.rLg)).background(c.surface).padding(28.dp)) {
            Text("기록", fontSize = Ms.title, fontWeight = FontWeight.Bold, color = c.ink)
            Spacer(Modifier.height(10.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(ui.log) { Text(it, fontSize = 20.sp, color = c.ink3) }
            }
        }
    }
    if (wide) {
        Row(Modifier.fillMaxSize().padding(32.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            content(Modifier.weight(1f)); log(Modifier.weight(1f).fillMaxSize())
        }
    } else {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            content(Modifier.fillMaxWidth()); log(Modifier.fillMaxWidth().weight(1f))
        }
    }
}

private fun TripState.label() = when (this) {
    TripState.IDLE -> "대기"; TripState.PLANNING -> "계획"; TripState.DRIVING -> "주행"; TripState.ARRIVING -> "도착 전 소개"
    TripState.PARKED -> "주차"; TripState.OUT -> "하차 · 구경 중"; TripState.HOMEWARD -> "귀가 중"; TripState.HOME -> "귀가"
}

private fun Gear.label() = when (this) {
    Gear.PARK -> "P"; Gear.REVERSE -> "R"; Gear.NEUTRAL -> "N"; Gear.DRIVE -> "D"; Gear.UNKNOWN -> "?"
}
