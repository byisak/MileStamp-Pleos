package kr.milestamp.car.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.composables.icons.lucide.CircleAlert
import com.composables.icons.lucide.Gem
import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.PartyPopper
import com.composables.icons.lucide.X
import androidx.compose.foundation.border
import kr.milestamp.car.net.FestivalMeta
import kr.milestamp.car.net.StampRow
import kr.milestamp.car.trip.TripHub
import java.time.LocalDate
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** 조건 도장 '밤' (엔진 RareStamp.NIGHT) — '밤의 ○○' 칸. */
const val RARE_NIGHT = kr.milestamp.engine.RareStamp.NIGHT

/** 도장북 칸 (폰 phone/src/places.ts ALBUM과 같은 칸 · 같은 5묶음 — 밤의 ○○ 3칸 포함). */
data class AlbumItem(val key: String, val placeId: String, val label: String, val section: String, val rare: String? = null) {
    val art: Int? get() = StampArt.of(placeId, rare != null && rare != RARE_NIGHT)
}

object StampAlbum {
    val SECTIONS = listOf(
        "season1" to "대구·경북 시즌 1",
        "town" to "우리 동네 평일 오후",
        "home" to "귀갓길 잠깐",
        "rain" to "비 오는 날",
        "weekend" to "주말 나들이",
    )

    val ALL = listOf(
        AlbumItem("seokgul", "seokgul", "군위 삼존석굴", "season1"),
        AlbumItem("samguk", "samguk", "삼국유사테마파크", "season1"),
        AlbumItem("dgsm", "dgsm", "국립대구과학관", "season1"),
        AlbumItem("thearc", "thearc", "디아크", "season1"),
        AlbumItem("hwabon", "hwabon", "화본역", "season1"),
        AlbumItem("hahoe", "hahoe", "안동 하회마을", "season1"),
        AlbumItem("thearc_rain", "thearc", "비 오는 날 디아크", "season1", rare = "비 오는 날"),
        AlbumItem("weather", "weather", "기상과학관", "town"),
        AlbumItem("eduseum", "eduseum", "교육역사관", "town"),
        AlbumItem("unamji", "unamji", "운암지", "town"),
        AlbumItem("hajungdo", "hajungdo", "금호꽃섬", "town"),
        AlbumItem("chimsan", "chimsan", "침산공원", "town"),
        AlbumItem("chimsan_night", "chimsan", "밤의 침산공원", "town", rare = RARE_NIGHT),
        AlbumItem("dalseong", "dalseong", "달성공원", "town"),
        AlbumItem("aayang", "aayang", "아양기찻길", "town"),
        AlbumItem("duryu", "duryu", "두류공원", "town"),
        AlbumItem("samsung", "samsung", "삼성창조캠퍼스", "town"),
        AlbumItem("hanbam", "hanbam", "한밤마을 돌담길", "home"),
        AlbumItem("bullo", "bullo", "불로동 고분군", "home"),
        AlbumItem("samunjin", "samunjin", "사문진나루터", "home"),
        AlbumItem("suseongmot", "suseongmot", "수성못", "home"),
        AlbumItem("suseongmot_night", "suseongmot", "밤의 수성못", "home", rare = RARE_NIGHT),
        AlbumItem("aquarium", "aquarium", "대구아쿠아리움", "rain"),
        AlbumItem("kidsworld", "kidsworld", "어린이세상", "rain"),
        AlbumItem("nmd", "nmd", "국립대구박물관", "rain"),
        AlbumItem("safety", "safety", "시민안전테마파크", "rain"),
        AlbumItem("bangjja", "bangjja", "방짜유기박물관", "rain"),
        AlbumItem("gumisci", "gumisci", "구미과학관", "rain"),
        AlbumItem("daegaya", "daegaya", "대가야박물관", "rain"),
        AlbumItem("naturepark", "naturepark", "네이처파크", "weekend"),
        AlbumItem("eworld", "eworld", "이월드", "weekend"),
        AlbumItem("eworld_night", "eworld", "밤의 이월드", "weekend", rare = RARE_NIGHT),
        AlbumItem("suppia", "suppia", "가산수피아", "weekend"),
        AlbumItem("songhae", "songhae", "송해공원", "weekend"),
        AlbumItem("arboretum", "arboretum", "대구수목원", "weekend"),
        AlbumItem("honeybee", "honeybee", "꿀벌나라", "weekend"),
        AlbumItem("cablecar", "cablecar", "팔공산 케이블카", "weekend"),
    )

    fun item(key: String) = ALL.firstOrNull { it.key == key }

    /**
     * 도장 기록 → 칸: 비 오는 날 디아크 = 'thearc_rain', 해 진 뒤 밤 명소(엔진 RareStamp.NIGHT) = '<id>_night' 칸이 있으면 그 칸,
     * 그 밖은 장소 칸 (폰 phone/src/places.ts albumKeyOf와 같음).
     */
    fun keyOf(placeId: String, rare: String?): String = when {
        rare == null -> placeId
        rare == RARE_NIGHT -> "${placeId}_night".takeIf { k -> ALL.any { it.key == k } } ?: placeId
        placeId == "thearc" -> "thearc_rain"
        else -> placeId
    }
    fun sectionTitle(key: String?) = SECTIONS.firstOrNull { it.first == key }?.second ?: SECTIONS.first().second

    /** 칸마다 찍은 기록 (비 오는 날 디아크·밤의 ○○는 장소 칸도 채운다 — 폰 stampsByKey와 같음). */
    fun byKey(rows: List<StampRow>): Map<String, List<StampRow>> {
        val m = mutableMapOf<String, MutableList<StampRow>>()
        for (r in rows) {
            m.getOrPut(r.key) { mutableListOf() } += r
            if (r.key != r.placeId) m.getOrPut(r.placeId) { mutableListOf() } += r
        }
        return m
    }

    /** 모은 칸 수 (34칸 중). */
    fun gotCount(rows: List<StampRow>): Int { val m = byKey(rows); return ALL.count { !m[it.key].isNullOrEmpty() } }
}

/** 안 찍은 칸: 흑백 (흑백 그림이 따로 없어 채도 0으로). */
val GRAY: ColorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) })

private val dateFmt = DateTimeFormatter.ofPattern("M월 d일 (E) HH:mm", Locale.KOREAN)
fun stampDate(ms: Long?): String? = ms?.let { Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).format(dateFmt) }

/**
 * 도장북 (정차 중에만). 넓게 = 왼쪽 요약 · 오른쪽 칸 / 그 밖 = 위 요약 · 아래 칸.
 * 칸을 누르면 크게(그림·이름·No.·날짜).
 */
@Composable
fun StampBookScreen(rows: List<StampRow>, offline: Boolean, narrow: Boolean, wide: Boolean, onClose: () -> Unit, initialOpen: String? = null) {
    val byKey = remember(rows) { StampAlbum.byKey(rows) }
    val got = StampAlbum.ALL.count { !byKey[it.key].isNullOrEmpty() }
    val sections = StampAlbum.SECTIONS.map { (k, title) ->
        val items = StampAlbum.ALL.filter { it.section == k }
        Triple(title, items.count { !byKey[it.key].isNullOrEmpty() }, items.size)
    }
    var open by rememberSaveable { mutableStateOf(initialOpen) }
    val fests = remember(rows) { festivalShelf(rows) }

    Box(Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val pad = if (narrow) 20.dp else 32.dp
            if (wide) {
                Row(Modifier.fillMaxSize().padding(pad), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    Summary(got, rows.size, offline, vertical = true, sections = sections, onClose = onClose, modifier = Modifier.width(400.dp).fillMaxHeight())
                    Grid(byKey, fests, cols = 6, onOpen = { open = it }, modifier = Modifier.weight(1f))
                }
            } else {
                Column(Modifier.fillMaxSize().padding(pad), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    Summary(got, rows.size, offline, vertical = false, sections = sections, onClose = onClose, modifier = Modifier.fillMaxWidth())
                    Grid(byKey, fests, cols = if (narrow) 3 else 4, onOpen = { open = it }, modifier = Modifier.weight(1f))
                }
            }
        }
        open?.let { key ->
            fests.firstOrNull { it.id == key }?.let { FestivalDetail(it, narrow, onClose = { open = null }) }
            StampAlbum.item(key)?.let { StampDetail(it, byKey[key].orEmpty(), narrow, onClose = { open = null }) }
        }
    }
}

@Composable
private fun Summary(got: Int, times: Int, offline: Boolean, vertical: Boolean, sections: List<Triple<String, Int, Int>>, onClose: () -> Unit, modifier: Modifier) {
    val total = StampAlbum.ALL.size
    Column(modifier.clip(RoundedCornerShape(Ms.rLg)).background(Ms.c.surface).padding(28.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("도장북", fontSize = Ms.title, fontWeight = FontWeight.Bold, color = Ms.c.ink, modifier = Modifier.weight(1f))
            MsActionButton("닫기", onClose, icon = Lucide.X, height = Ms.touch)
        }
        Spacer(Modifier.height(if (vertical) 28.dp else 16.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text("모은 칸", fontSize = Ms.sub, color = Ms.c.ink3)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("$got", fontSize = Ms.display, fontWeight = FontWeight.Bold, color = Ms.c.ink)
                    Text("/${total}칸", fontSize = Ms.title, color = Ms.c.ink3, modifier = Modifier.padding(bottom = 8.dp))
                }
            }
            if (!vertical) Note(times, offline, TextAlign.End)
        }
        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)).background(Ms.c.fill)) {
            Box(Modifier.fillMaxWidth(got / total.toFloat()).height(10.dp).clip(RoundedCornerShape(5.dp)).background(Ms.c.accent))
        }
        if (vertical) {
            Spacer(Modifier.height(16.dp))
            Note(times, offline, TextAlign.Start)
            Spacer(Modifier.height(28.dp))
            Box(Modifier.fillMaxWidth().height(1.dp).background(Ms.c.fill))
            Spacer(Modifier.height(16.dp))
            sections.forEach { (title, n, of) ->
                Row(Modifier.fillMaxWidth().padding(vertical = 7.dp)) {
                    Text(title, fontSize = Ms.sub, color = Ms.c.ink, modifier = Modifier.weight(1f))
                    Text("$n / $of", fontSize = Ms.sub, color = if (n == of) Ms.c.accent else Ms.c.ink3, fontWeight = if (n == of) FontWeight.Bold else null)
                }
            }
        }
    }
}

@Composable
private fun Note(times: Int, offline: Boolean, align: TextAlign) {
    Column(horizontalAlignment = if (align == TextAlign.End) Alignment.End else Alignment.Start) {
        Text(if (times == 0) "차를 세우고 P에 두면 찍혀요" else "지금까지 ${times}번 찍었어요", fontSize = Ms.sub, color = Ms.c.ink3, textAlign = align)
        if (offline) IconText(Lucide.CircleAlert, "인터넷이 안 돼 저장해 둔 기록이에요", Ms.cap, color = Ms.c.ink3)
    }
}

@Composable
private fun Grid(byKey: Map<String, List<StampRow>>, fests: List<FestCell>, cols: Int, onOpen: (String) -> Unit, modifier: Modifier) {
    Column(modifier.verticalScroll(rememberScrollState())) {
        // 진행 중 축제는 맨 위 '축제 도장'
        FestivalSection("축제 도장", fests.filter { it.running }, cols, running = true, onOpen)
        StampAlbum.SECTIONS.forEach { (sec, title) ->
            val items = StampAlbum.ALL.filter { it.section == sec }
            val n = items.count { !byKey[it.key].isNullOrEmpty() }
            Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = Ms.body, fontWeight = FontWeight.Bold, color = Ms.c.ink, modifier = Modifier.weight(1f))
                Text("$n / ${items.size}", fontSize = Ms.sub, color = if (n == items.size) Ms.c.accent else Ms.c.ink3, fontWeight = if (n == items.size) FontWeight.Bold else null)
            }
            items.chunked(cols).forEach { line ->
                Row(Modifier.fillMaxWidth().padding(bottom = 22.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    line.forEach { a -> Cell(a, !byKey[a.key].isNullOrEmpty(), Modifier.weight(1f)) { onOpen(a.key) } }
                    repeat(cols - line.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        // 끝난 축제는 맨 아래 '지난 축제' (해·계절 칸)
        FestivalSection("지난 축제", fests.filter { !it.running }, cols, running = false, onOpen)
    }
}

// ---------- 축제 한정 도장 ----------

private val FEST_RED = Color(0xFFA33B2B)

/** 도장북 축제 칸 하나: 진행 중(오늘 장소 목록에 있음) 또는 지난 축제(찍은 기록). */
internal data class FestCell(
    val id: String, val name: String, val season: String, val placeId: String?, val running: Boolean, val rows: List<StampRow>, val ends: String?,
)

/** 진행 중 축제(장소 목록·FestivalMeta) + 찍은 축제 기록(지난 것)으로 칸 목록. */
internal fun festivalShelf(rows: List<StampRow>, today: String = LocalDate.now().toString()): List<FestCell> {
    val byFest = rows.filter { it.festivalId != null }.groupBy { it.festivalId!! }
    val running = TripHub.catalog.mapNotNull { p ->
        val f = p.festival ?: return@mapNotNull null
        if (today < f.starts || today > f.ends) return@mapNotNull null
        val meta = FestivalMeta.get(f.id)
        FestCell(f.id, p.name, meta?.season.orEmpty(), f.placeId, true, byFest[f.id].orEmpty(), f.ends)
    }
    val past = byFest.filterKeys { id -> running.none { it.id == id } }.map { (id, rs) ->
        val meta = FestivalMeta.get(id)
        val r = rs.first()
        FestCell(id, r.festivalName ?: meta?.name ?: "축제", r.season ?: meta?.season.orEmpty(), meta?.placeId, false, rs, meta?.ends)
    }.sortedByDescending { it.rows.firstOrNull()?.atMs ?: 0L }
    return running + past
}

@Composable
private fun FestivalSection(title: String, items: List<FestCell>, cols: Int, running: Boolean, onOpen: (String) -> Unit) {
    if (items.isEmpty()) return
    Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = Ms.body, fontWeight = FontWeight.Bold, color = Ms.c.ink, modifier = Modifier.weight(1f))
        if (running) FestPill("진행 중", true)
        else Text("${items.count { it.rows.isNotEmpty() }} / ${items.size}", fontSize = Ms.sub, color = Ms.c.ink3)
    }
    items.chunked(cols).forEach { line ->
        Row(Modifier.fillMaxWidth().padding(bottom = 22.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            line.forEach { f ->
                Column(Modifier.weight(1f).clip(RoundedCornerShape(Ms.rMd)).clickable { onOpen(f.id) }.padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    FestArt(f, Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    Text(f.name, fontSize = Ms.cap, color = if (f.rows.isNotEmpty()) Ms.c.ink else Ms.c.ink3, fontWeight = if (f.rows.isNotEmpty()) FontWeight.Bold else null,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(4.dp))
                    FestPill(if (f.running) "진행 중" else f.season.ifEmpty { "지난 축제" }, f.running)
                }
            }
            repeat(cols - line.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

@Composable
private fun FestArt(f: FestCell, modifier: Modifier) {
    val has = f.rows.isNotEmpty()
    val painter = festivalPainter(f.id, f.placeId)
    Box(modifier.aspectRatio(1f).clip(CircleShape).border(5.dp, if (has) FEST_RED else Ms.c.fill, CircleShape).padding(7.dp), contentAlignment = Alignment.Center) {
        if (painter != null) Image(painter, f.name, Modifier.fillMaxSize().clip(CircleShape).alpha(if (has) 1f else 0.45f), colorFilter = if (has) null else GRAY)
        else MsIcon(Lucide.PartyPopper, Ms.title, tint = FEST_RED)
    }
}

@Composable
private fun FestPill(text: String, on: Boolean) = MsChip(text, Lucide.PartyPopper, if (on) MsTone.FESTIVAL else MsTone.PLAIN, size = Ms.cap, solid = on)

/** 축제 칸 크게: 그림 · 이름 · 기간 / 받은 날. */
@Composable
private fun FestivalDetail(f: FestCell, narrow: Boolean, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    val first = f.rows.firstOrNull()
    Box(
        Modifier.fillMaxSize().background(Ms.c.dim)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.padding(24.dp).widthIn(max = 640.dp).clip(RoundedCornerShape(28.dp)).background(Ms.c.surface)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .padding(horizontal = 36.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            FestArt(f, Modifier.size(if (narrow) 300.dp else 420.dp))
            Spacer(Modifier.height(18.dp))
            Text(f.name, fontSize = Ms.h2, fontWeight = FontWeight.Bold, color = Ms.c.ink, textAlign = TextAlign.Center)
            Spacer(Modifier.height(6.dp))
            if (first != null) {
                Text(listOfNotNull(first.number?.let(::stampNo), stampDate(first.atMs)).joinToString(" · ").ifEmpty { "찍었어요" }, fontSize = Ms.body, color = Ms.c.ink3)
            } else {
                Text("축제 기간에 여기 주차하면 한정 도장" + (f.ends?.let { " · ${FestivalMeta.md(it)}까지" } ?: ""), fontSize = Ms.body, color = Ms.c.ink3, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(12.dp))
            FestPill(if (f.running) "진행 중 · 기간 한정" else f.season.ifEmpty { "지난 축제" }, f.running)
            Spacer(Modifier.height(26.dp))
            MsActionButton("닫기", onClose, Modifier.widthIn(min = 320.dp), icon = Lucide.X)
        }
    }
}

@Composable
private fun Cell(a: AlbumItem, has: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.clip(RoundedCornerShape(Ms.rMd)).clickable(onClick = onClick).padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Art(a, has, Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Text(a.label, fontSize = Ms.cap, color = if (has) Ms.c.ink else Ms.c.ink3, fontWeight = if (has) FontWeight.Bold else null,
            maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        if (a.rare != null) {
            Spacer(Modifier.height(4.dp))
            RarePill("희귀", has)
        }
    }
}

@Composable
private fun Art(a: AlbumItem, has: Boolean, modifier: Modifier) {
    val painter = stampPainter(a.placeId, a.rare != null && a.rare != RARE_NIGHT)
    if (painter != null) {
        Image(painter, a.label, modifier.alpha(if (has) 1f else 0.45f), colorFilter = if (has) null else GRAY)
    } else {
        Box(modifier.aspectRatio(1f).clip(CircleShape).background(Ms.c.fill), contentAlignment = Alignment.Center) {
            Text(a.label, fontSize = Ms.cap, color = Ms.c.ink3)
        }
    }
}

@Composable
private fun RarePill(text: String, on: Boolean) = MsChip(text, Lucide.Gem, if (on) MsTone.STAMP else MsTone.PLAIN, size = Ms.cap)

/** 칸 크게: 그림 · 이름 · No.·날짜 (안 찍었으면 찍는 법). 바깥을 누르거나 뒤로 가기 = 닫기. */
@Composable
private fun StampDetail(a: AlbumItem, rows: List<StampRow>, narrow: Boolean, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    val has = rows.isNotEmpty()
    val first = rows.firstOrNull()
    Box(
        Modifier.fillMaxSize().background(Ms.c.dim)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.padding(24.dp).widthIn(max = 640.dp).clip(RoundedCornerShape(28.dp)).background(Ms.c.surface)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .padding(horizontal = 36.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Art(a, has, Modifier.size(if (narrow) 300.dp else 420.dp))
            Spacer(Modifier.height(18.dp))
            Text(a.label, fontSize = Ms.h2, fontWeight = FontWeight.Bold, color = Ms.c.ink, textAlign = TextAlign.Center)
            Spacer(Modifier.height(6.dp))
            if (has) {
                Text(listOfNotNull(first?.number?.let(::stampNo), stampDate(first?.atMs)).joinToString(" · ").ifEmpty { "찍었어요" },
                    fontSize = Ms.body, color = Ms.c.ink3)
                if (rows.size > 1) Text("모두 ${rows.size}번 찍었어요", fontSize = Ms.sub, color = Ms.c.ink3)
            } else {
                Text(when (a.rare) {
                    null -> "여기에 주차하면 차가 도장을 찍어 줘요"
                    RARE_NIGHT -> "해가 진 뒤 여기에 주차하면 찍혀요"
                    else -> "비 오는 날 디아크에 주차하면 찍혀요"
                },
                    fontSize = Ms.body, color = Ms.c.ink3, textAlign = TextAlign.Center)
            }
            Text(StampAlbum.sectionTitle(a.section), fontSize = Ms.sub, color = Ms.c.ink3, modifier = Modifier.padding(top = 4.dp))
            if (a.rare != null) { Spacer(Modifier.height(12.dp)); RarePill("희귀 도장 · ${a.rare}", has) }
            Spacer(Modifier.height(26.dp))
            MsActionButton("닫기", onClose, Modifier.widthIn(min = 320.dp), icon = Lucide.X)
        }
    }
}
