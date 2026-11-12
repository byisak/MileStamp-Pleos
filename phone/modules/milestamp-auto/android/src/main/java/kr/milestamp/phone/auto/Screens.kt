@file:Suppress("DEPRECATION") // PlaceListMapTemplate·setTitle: 오래된 호스트(차 API 1~6)까지 되는 쪽을 쓴다

package kr.milestamp.phone.auto

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.CarLocation
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Metadata
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.TravelTime
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import androidx.car.app.model.Place as CarPlace

/*
 * 안드로이드 오토 화면 (정해진 템플릿만). 주행 중 제한(목록 길이·누르기)은 호스트가 알아서 건다.
 * 단계 제한(한 흐름에 템플릿 5개)을 넘지 않게: 홈(1) → 코스 자세히(2) → 출발하면 홈으로 되감기,
 * 홈 → 코스 진행(2) → 도장(3) → 도장북은 도장 화면을 빼고 넣는다(3). 도장 화면은 쌓인 게 3개 넘으면 홈까지 되감고 넣는다.
 */

private val mainHandler = Handler(Looper.getMainLooper())

/** 일꾼 스레드에서 [work], 끝나면 메인에서 [done] */
internal fun <T> Screen.load(work: () -> T, done: (T?) -> Unit) {
    AutoRuntime.io.execute {
        val r = runCatching(work).getOrNull()
        mainHandler.post { done(r) }
    }
}

/** 호스트가 알려 준 차 API 수준 (아직 모르면 1 — 가장 보수적으로) */
internal fun apiLevel(cc: CarContext): Int = runCatching { cc.carAppApiLevel }.getOrDefault(1)

internal fun textAction(title: String, primary: Boolean = false, cc: CarContext, onClick: () -> Unit): Action =
    Action.Builder().setTitle(title).setOnClickListener(onClick).apply {
        if (primary) {
            setBackgroundColor(CarColor.createCustom(0xFF2C4A3E.toInt(), 0xFF3E6A58.toInt()))
            if (apiLevel(cc) >= 4) setFlags(Action.FLAG_PRIMARY)
        }
    }.build()

/** 내비 앱으로 길 안내 (구글 지도·티맵 등 사용자가 고른 내비) */
internal fun navigateTo(cc: CarContext, name: String, lat: Double, lng: Double) {
    val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(name)})")
    runCatching { cc.startCarApp(Intent(CarContext.ACTION_NAVIGATE, uri)) }
        .onFailure { CarToast.makeText(cc, "내비를 열지 못했어요", CarToast.LENGTH_LONG).show() }
}

/**
 * 코스 전체 길 안내 — 안드로이드 오토의 표준 길 안내(ACTION_NAVIGATE)는 목적지 하나만 받는다.
 * 네이버 지도가 깔려 있으면 경유지(최대 5곳)까지 한 번에 넘긴다 (nmap://navigation, 차 화면 네이버 지도에서 그대로 이어짐).
 * 장소가 하나뿐이거나 네이버 지도가 없거나 실행이 막히면 첫 장소만 표준 길 안내로.
 */
private const val NMAP_PKG = "com.nhn.android.nmap"

internal fun navigateCourse(cc: CarContext, stops: List<AutoStop>) {
    val first = stops.firstOrNull() ?: return
    if (stops.size >= 2 && launchNaverRoute(cc, stops)) {
        CarToast.makeText(cc, "네이버 지도에 경유지까지 넣었어요 · 네이버 지도를 눌러 주세요", CarToast.LENGTH_LONG).show()
        return
    }
    navigateTo(cc, first.name, first.lat, first.lng)
}

private fun launchNaverRoute(cc: CarContext, stops: List<AutoStop>): Boolean {
    // 설치 여부는 실행해 보고 판단 (패키지 조회는 안드로이드 11+에서 <queries>가 필요해서)
    val via = stops.dropLast(1).take(5)
    val dest = stops.last()
    val b = Uri.Builder().scheme("nmap").authority("navigation")
        .appendQueryParameter("dlat", dest.lat.toString()).appendQueryParameter("dlng", dest.lng.toString())
        .appendQueryParameter("dname", dest.name)
    via.forEachIndexed { i, st ->
        val n = i + 1
        b.appendQueryParameter("v${n}lat", st.lat.toString()).appendQueryParameter("v${n}lng", st.lng.toString())
            .appendQueryParameter("v${n}name", st.name)
    }
    b.appendQueryParameter("appname", cc.packageName)
    val intent = Intent(Intent.ACTION_VIEW, b.build()).setPackage(NMAP_PKG).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return runCatching { cc.applicationContext.startActivity(intent) }
        .onFailure { android.util.Log.i("MilestampAuto", "네이버 지도 경유지 안내 실패: $it") }.isSuccess
}

internal fun limit(cc: CarContext, type: Int, fallback: Int): Int =
    if (apiLevel(cc) >= 2) runCatching { cc.getCarService(ConstraintManager::class.java).getContentLimit(type) }.getOrDefault(fallback) else fallback

// ================================================================ 1. 홈: 오늘 어디 갈까요 / 고른 코스

class HomeScreen(cc: CarContext) : Screen(cc) {
    private sealed interface State {
        data object Loading : State
        data object NoToken : State
        data class Failed(val msg: String) : State
        data class Ready(val plan: AutoPlan) : State
    }

    private var state: State = State.Loading
    /** 고른 코스가 있어도 '다른 코스'를 누르면 목록 */
    private var showList = false

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = refresh()
        })
    }

    fun refresh() {
        if (!AutoRuntime.api.hasToken) { state = State.NoToken; invalidate(); return }
        load({
            val loc = AutoRuntime.lastKnown()
            AutoRuntime.api.plan(loc?.latitude, loc?.longitude)
        }) { p -> show(p) }
    }

    /** 받은 계획을 그린다 (시험에서도 직접 부른다) */
    internal fun show(p: AutoPlan?) {
        state = if (p != null) State.Ready(p) else State.Failed("추천을 받지 못했어요. 인터넷을 확인해 주세요")
        invalidate()
    }

    override fun onGetTemplate(): Template = when (val s = state) {
        State.Loading -> PlaceListMapTemplate.Builder().setTitle("오늘 어디 갈까요").setHeaderAction(Action.APP_ICON).setLoading(true).build()
        State.NoToken -> MessageTemplate.Builder("폰의 마일스탬프 앱에서 차 QR로 가족 연결을 먼저 해 주세요")
            .setTitle("마일스탬프").setHeaderAction(Action.APP_ICON)
            .addAction(textAction("다시 확인", cc = carContext) { refresh() }).build()
        is State.Failed -> MessageTemplate.Builder(s.msg).setTitle("마일스탬프").setHeaderAction(Action.APP_ICON)
            .addAction(textAction("다시", cc = carContext) { state = State.Loading; invalidate(); refresh() }).build()
        is State.Ready -> {
            val chosen = s.plan.chosenOption
            if (chosen != null && !showList) chosenTemplate(s.plan, chosen) else planTemplate(s.plan)
        }
    }

    /** 오늘 어디 갈까요 — 코스 3장 + 지도 */
    private fun planTemplate(plan: AutoPlan): Template {
        val list = ItemList.Builder()
        val max = limit(carContext, ConstraintManager.CONTENT_LIMIT_TYPE_PLACE_LIST, 6)
        plan.options.take(max).forEachIndexed { i, o -> list.addItem(planRow(plan, o, i)) }
        if (plan.options.isEmpty()) list.setNoItemsMessage("오늘은 추천할 곳이 없어요")
        val b = PlaceListMapTemplate.Builder()
        // 장소 표시가 하나도 없으면(밤 '바로 집으로'만 있을 때) 지도가 위도 0·경도 0(아프리카 앞바다)에 머문다 → 지금 위치를 기준점으로
        if (plan.options.none { it.stops.isNotEmpty() }) AutoRuntime.lastKnown()?.let { here ->
            b.setAnchor(CarPlace.Builder(CarLocation.create(here.latitude, here.longitude)).build())
        }
        return b
            .setTitle("오늘 어디 갈까요")
            .setHeaderAction(Action.APP_ICON)
            .setItemList(list.build())
            .setCurrentLocationEnabled(locationGranted())
            .setActionStrip(ActionStrip.Builder()
                .addAction(textAction("도장북", cc = carContext) { screenManager.push(StampBookScreen(carContext)) })
                .build())
            .build()
    }

    private fun planRow(plan: AutoPlan, o: AutoOption, i: Int): Row {
        // 장소 목록 템플릿은 줄마다 거리 표시(DistanceSpan)가 있어야 한다: 지금 위치 → 첫 장소 도로 거리(엔진 TravelTime),
        // 위치를 모르면 첫 이동 시간 × 평균 속도로
        val here = AutoRuntime.lastKnown()
        val first = o.stops.firstOrNull()
        val km = if (here != null && first != null) TravelTime.roadKm(LatLng(here.latitude, here.longitude), LatLng(first.lat, first.lng))
        else o.firstLegMin * TravelTime.AVG_KMH / 60.0
        val line = SpannableString("  · 귀가 ${AutoJson.clock(o.arriveHomeMin)} · 첫 이동 ${o.firstLegMin}분")
        val dist = if (km < 1) Distance.create(km * 1000, Distance.UNIT_METERS) else Distance.create(km, Distance.UNIT_KILOMETERS)
        line.setSpan(DistanceSpan.create(dist), 0, 1, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
        val r = Row.Builder().setTitle(o.title).addText(line)
        o.firstReason?.let { r.addText(AutoJson.clockText(it)) }
        o.stops.firstOrNull()?.let { st ->
            r.setMetadata(Metadata.Builder().setPlace(
                CarPlace.Builder(CarLocation.create(st.lat, st.lng)).setMarker(PlaceMarker.Builder().setLabel("${i + 1}").build()).build(),
            ).build())
        }
        r.setOnClickListener { screenManager.push(OptionScreen(carContext, plan, i)) }
        return r.build()
    }

    /** 폰(또는 차)에서 이미 고른 코스: "아빠가 고른 코스 · 16:49 귀가" + 시작 */
    private fun chosenTemplate(plan: AutoPlan, o: AutoOption): Template {
        val pane = Pane.Builder()
            .addRow(Row.Builder().setTitle(o.title).addText("첫 이동 ${o.firstLegMin}분").build())
        o.reasons.take(2).forEach { pane.addRow(Row.Builder().setTitle(AutoJson.clockText(it.text)).build()) }
        pane.addAction(textAction("이 길로 출발", primary = true, cc = carContext) {
            navigateCourse(carContext, o.stops)
            screenManager.push(CourseScreen(carContext))
        })
        pane.addAction(textAction("다른 코스", cc = carContext) { showList = true; invalidate() })
        return PaneTemplate.Builder(pane.build())
            .setTitle("${AutoJson.chooserText(plan.chosenBy)} · ${AutoJson.clock(o.arriveHomeMin)} 귀가")
            .setHeaderAction(Action.APP_ICON)
            .build()
    }

    /** 출발을 고른 뒤 돌아왔을 때 고른 코스로 */
    fun chosenNow() { showList = false; state = State.Loading; invalidate(); refresh() }

    private fun locationGranted() =
        ContextCompat.checkSelfPermission(carContext, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
}

// ================================================================ 2. 코스 자세히 (안내 문단)

class OptionScreen(cc: CarContext, private val plan: AutoPlan, private val idx: Int) : Screen(cc) {
    private var busy = false

    override fun onGetTemplate(): Template {
        val o = plan.options[idx]
        val pane = Pane.Builder().setLoading(busy)
        if (!busy) {
            pane.addRow(Row.Builder().setTitle("귀가 ${AutoJson.clock(o.arriveHomeMin)}").addText("첫 이동 ${o.firstLegMin}분 · 장소 ${o.stops.size}곳").build())
            o.reasons.take(3).forEach { pane.addRow(Row.Builder().setTitle(AutoJson.clockText(it.text)).build()) }
            pane.addAction(textAction("이 길로 출발", primary = true, cc = carContext) { go(o) })
            pane.addAction(textAction("다른 코스", cc = carContext) { screenManager.pop() })
        }
        return PaneTemplate.Builder(pane.build()).setTitle(o.title).setHeaderAction(Action.BACK).build()
    }

    private fun go(o: AutoOption) {
        busy = true
        invalidate()
        load({ AutoRuntime.api.choose(plan.planId, idx) }) { ok ->
            if (ok != true) CarToast.makeText(carContext, "서버에 못 알렸어요 · 길 안내는 시작해요", CarToast.LENGTH_LONG).show()
            navigateCourse(carContext, o.stops)
            screenManager.popToRoot()
            (screenManager.top as? HomeScreen)?.chosenNow()
        }
    }
}

// ================================================================ 3. 코스 진행 (목록)

class CourseScreen(cc: CarContext) : Screen(cc) {
    private var course: AutoCourse? = null
    private var proposals: List<AutoOption> = emptyList()
    private var loaded = false
    private var missing = false

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = refresh()
        })
    }

    fun refresh() {
        load({
            val c = AutoRuntime.api.course()
            // 머무는 중이면 서버에 '아직 주차 중'을 알려 제안(덜 놀기·다음 바꾸기)을 받는다
            val o = if (c?.here != null && AutoRuntime.detector.phase != AutoTripDetector.Phase.DRIVING)
                AutoRuntime.api.courseEvent(c.version, JSONObject().put("type", "StillParked").put("now", AutoRuntime.nowHhmm())) else null
            Triple(o?.course ?: c, o?.options.orEmpty(), c == null)
        }) { r -> if (r != null) show(r.first, r.second, r.third) else { loaded = true; invalidate() } }
    }

    internal fun show(c: AutoCourse?, options: List<AutoOption>, noCourse: Boolean = c == null) {
        loaded = true; course = c; proposals = options; missing = noCourse
        AutoRuntime.noteCourse(c)
        invalidate()
    }

    override fun onGetTemplate(): Template {
        val b = ListTemplate.Builder().setTitle("오늘 코스").setHeaderAction(Action.BACK)
        if (!loaded) return b.setLoading(true).build()
        val list = ItemList.Builder()
        val c = course
        if (c == null) {
            list.setNoItemsMessage(if (missing) "고른 코스가 없어요. 홈에서 코스를 골라 주세요" else "코스를 불러오지 못했어요")
        } else {
            val next = c.next
            if (next != null) {
                val name = AutoRuntime.stopName(next)
                // 바깥 장소(목록 밖)는 코스에 실린 좌표로 길 안내, 도착하면 도장 대신 '다녀옴'
                val tail = if (next.isExt) " · 도착하면 다녀옴" else ""
                list.addItem(Row.Builder().setTitle("다음 · $name").addText("도착 예정 ${AutoJson.clock(next.plannedArriveMin)} · 누르면 길 안내$tail")
                    .setOnClickListener {
                        val e = AutoRuntime.catalogEntry(next.placeId)
                        val lat = e?.lat ?: next.lat
                        val lng = e?.lng ?: next.lng
                        if (lat != null && lng != null) navigateTo(carContext, e?.name ?: name, lat, lng)
                    }.build())
            } else c.here?.let { list.addItem(Row.Builder().setTitle("지금 · ${AutoRuntime.stopName(it)}").addText("머무는 중").build()) }
            val slack = c.slackMin
            list.addItem(Row.Builder().setTitle("${c.endName} ${AutoJson.clock(c.arriveHomeMin)} 도착 예정")
                .addText(if (slack >= 0) "여유 ${slack}분" else "귀가 한계 ${-slack}분 넘어요").build())
            c.headline?.let { h -> list.addItem(Row.Builder().setTitle(AutoJson.clockText(h)).apply { c.body?.let { addText(AutoJson.clockText(it)) } }.build()) }
            proposals.take(2).forEachIndexed { i, o ->
                list.addItem(Row.Builder().setTitle("제안 · ${AutoJson.clockText(o.label.ifEmpty { o.title })}")
                    .addText("${c.endName} ${AutoJson.clock(o.arriveHomeMin)} 도착 · 누르면 이걸로 바꾸기")
                    .setOnClickListener { adopt(c.version, i) }.build())
            }
        }
        return b.setSingleList(list.build())
            // 목록 템플릿의 동작 줄은 글 버튼 1개까지 → 새로고침은 아이콘
            .setActionStrip(ActionStrip.Builder()
                .addAction(Action.Builder().setIcon(CarIcon.Builder(IconCompat.createWithResource(carContext, R.drawable.ic_auto_refresh)).build())
                    .setOnClickListener { refresh() }.build())
                .addAction(textAction("도장북", cc = carContext) { screenManager.push(StampBookScreen(carContext)) })
                .build())
            .build()
    }

    private fun adopt(version: Int, idx: Int) {
        load({ AutoRuntime.api.adopt(version, idx) }) { o ->
            if (o != null) {
                course = o.course; proposals = emptyList()
                AutoSession.notify(carContext, o.changeText?.let(AutoJson::clockText) ?: "코스를 바꿨어요 · ${o.course.endName} ${AutoJson.clock(o.course.arriveHomeMin)} 도착")
                invalidate()
            } else {
                CarToast.makeText(carContext, "바꾸지 못했어요 · 다시 불러올게요", CarToast.LENGTH_LONG).show()
                refresh()
            }
        }
    }
}

// ================================================================ 4. 도장 (안내 문단 + 메달 그림)

/**
 * 도장 쾅! 정차 중에만 뜬다 (주행 중에는 알림 한 줄 → 멈추면 이 화면, [MedalPresenter]).
 * 왼쪽 글 줄: 이름·No. / 모은 도장·묶음 / 다음 갈 곳·귀가(살아 있는 코스가 있으면), 버튼 '도장북 보기'·'닫기'
 * 오른쪽 큰 그림: 폰이 합성한 메달(720 → 차 크기). 안내 문단 그림은 차 API 4부터 — 그 전 호스트는 메시지 + 도장 아이콘.
 */
class StampScreen(cc: CarContext, private val medal: ReadyMedal) : Screen(cc) {
    private val m get() = medal.info

    /** 글 줄 (시험에서도 본다) */
    internal fun rows(): List<Row> {
        val out = mutableListOf(
            Row.Builder().setTitle(m.name).addText(m.row1Sub).build(),
            Row.Builder().setTitle("도장북 ${m.got}/${m.total}칸").addText(m.row2Sub).build(),
        )
        val home = m.homeMin?.let { "${m.homeName}에 ${AutoJson.clock(it)}쯤" }
        if (m.nextName != null) {
            val sub = listOfNotNull(m.departMin?.let { "${AutoJson.clock(it)} 출발" }, home).joinToString(" · ").ifEmpty { "누르면 코스" }
            out += Row.Builder().setTitle("다음 · ${m.nextName}").addText(sub).build()
        } else if (m.homeMin != null) {
            out += Row.Builder().setTitle("${m.homeName} ${AutoJson.clock(m.homeMin!!)} 도착 예정").addText("다음 갈 곳 없음").build()
        }
        return out.take(limit(carContext, ConstraintManager.CONTENT_LIMIT_TYPE_PANE, 4))
    }

    private fun book() {
        screenManager.pop()
        screenManager.push(StampBookScreen(carContext))
    }

    override fun onGetTemplate(): Template {
        val img = medal.image
        if (apiLevel(carContext) >= 4 && img != null) {
            val pane = Pane.Builder()
            rows().forEach { pane.addRow(it) }
            pane.setImage(CarIcon.Builder(IconCompat.createWithBitmap(img)).build())
            pane.addAction(textAction("도장북 보기", primary = true, cc = carContext) { book() })
            pane.addAction(textAction("닫기", cc = carContext) { screenManager.pop() })
            return PaneTemplate.Builder(pane.build()).setTitle(m.title).setHeaderAction(Action.BACK).build()
        }
        // 옛 호스트: 메시지 + 도장 아이콘
        val msg = "${m.title.removeSuffix(" (조용히)")} ${m.name} · 도장북 ${m.got}/${m.total}칸\n${m.row1Sub}"
        return MessageTemplate.Builder(msg)
            .setTitle(m.title)
            .setHeaderAction(Action.BACK)
            .setIcon(medal.icon?.let { CarIcon.Builder(IconCompat.createWithBitmap(it)).build() } ?: StampIcons.fallback(carContext))
            .addAction(textAction("도장북 보기", primary = true, cc = carContext) { book() })
            .addAction(textAction("닫기", cc = carContext) { screenManager.pop() })
            .build()
    }
}

// ================================================================ 5. 도장북 (격자)

class StampBookScreen(cc: CarContext, autoLoad: Boolean = true) : Screen(cc) {
    private var entries: List<CatalogEntry>? = null
    private var mine: Set<String> = emptySet()
    private val icons = ConcurrentHashMap<String, CarIcon>()

    init {
        if (autoLoad) load({
            if (AutoRuntime.catalog.isEmpty()) AutoRuntime.loadCatalog()
            val got = AutoRuntime.api.stamps()?.map { it.placeId }?.toSet().orEmpty()
            got to AutoRuntime.catalog.filter { it.inAlbum }
        }) { r ->
            show(r?.first.orEmpty(), r?.second.orEmpty())
            loadIcons()
        }
    }

    internal fun show(got: Set<String>, all: List<CatalogEntry>) {
        mine = got
        entries = all.sortedByDescending { it.id in got }
        invalidate()
    }

    private fun loadIcons() {
        val list = entries?.take(limit(carContext, ConstraintManager.CONTENT_LIMIT_TYPE_GRID, 12)) ?: return
        load({
            list.forEach { e ->
                StampIcons.bitmap(e, bw = e.id !in mine)?.let { icons[e.id] = CarIcon.Builder(IconCompat.createWithBitmap(it)).build() }
            }
        }) { invalidate() }
    }

    override fun onGetTemplate(): Template {
        val all = entries
        val b = GridTemplate.Builder().setHeaderAction(Action.BACK)
        if (all == null) return b.setTitle("도장북").setLoading(true).build()
        val n = all.count { it.id in mine }
        val list = ItemList.Builder()
        all.take(limit(carContext, ConstraintManager.CONTENT_LIMIT_TYPE_GRID, 12)).forEach { e ->
            val got = e.id in mine
            list.addItem(GridItem.Builder()
                .setTitle(e.name)
                .setText(if (got) "모았어요" else "아직")
                .setImage(icons[e.id] ?: StampIcons.fallback(carContext, empty = !got), GridItem.IMAGE_TYPE_LARGE)
                .build())
        }
        if (all.isEmpty()) list.setNoItemsMessage("명소 목록을 받지 못했어요")
        return b.setTitle("도장북 · $n/${all.size}").setSingleList(list.build()).build()
    }
}

// ================================================================ 도장 그림

/** 도장 그림: 서버 명소 목록의 R2 주소에서 받아 캐시에 둔다 (모듈 안에는 앱 그림 묶음이 없다). 못 받으면 기본 도장 아이콘 */
object StampIcons {
    private val mem = ConcurrentHashMap<String, Bitmap>()

    fun bitmap(e: CatalogEntry, bw: Boolean): Bitmap? {
        val url = (if (bw) e.stampBwUrl else e.stampUrl) ?: return null
        val key = "${e.id}_${e.stampVersion}${if (bw) "_bw" else ""}"
        mem[key]?.let { return it }
        val dir = File(AutoRuntimeFiles.cacheDir ?: return null, "auto-stamps")
        val f = File(dir, "$key.webp")
        if (!f.exists() && !AutoRuntime.api.download(url, f)) return null
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, opts)
        var sample = 1
        while (opts.outWidth / (sample * 2) >= 256) sample *= 2
        val bmp = BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        mem[key] = bmp
        return bmp
    }

    fun fallback(cc: CarContext, empty: Boolean = false): CarIcon =
        CarIcon.Builder(IconCompat.createWithResource(cc, if (empty) R.drawable.ic_auto_stamp_empty else R.drawable.ic_auto_stamp)).build()
}

/** 캐시 폴더 (AutoRuntime.init 때 정함) */
object AutoRuntimeFiles {
    @Volatile var cacheDir: File? = null
}
