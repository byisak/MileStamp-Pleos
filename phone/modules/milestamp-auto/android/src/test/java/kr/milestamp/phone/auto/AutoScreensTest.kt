package kr.milestamp.phone.auto

import androidx.car.app.model.Action
import androidx.car.app.model.CarText
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestCarContext
import androidx.car.app.testing.TestScreenManager
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * 차 화면 시험: DHU(안드로이드 오토 앱)가 없는 에뮬레이터라 Car App Library 시험 도구(TestCarContext·ScreenController)로
 * 화면을 만들고, 나온 템플릿을 글·JSON으로 남긴다 (build/auto-shots/ → 그림은 tools 쪽 HTML 렌더).
 */
@Suppress("DEPRECATION")
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AutoScreensTest {
    private lateinit var cc: TestCarContext
    private val out = File(System.getProperty("autoShotsDir") ?: "build/auto-shots").apply { mkdirs() }

    @Before fun setUp() {
        cc = TestCarContext.createCarContext(ApplicationProvider.getApplicationContext())
        // 호스트와 악수(차 API 수준 7 = 안드로이드 오토 최근 판) — 실제로는 호스트가 정한다
        @Suppress("RestrictedApi")
        cc.updateHandshakeInfo(androidx.car.app.HandshakeInfo("com.google.android.projection.gearhead", 7))
        AutoRuntime.init(ApplicationProvider.getApplicationContext())
        AutoRuntime.setCatalog(AutoJson.catalog(JSONObject(Samples.CATALOG)))
        AutoJson.hour12 = true // 기본 시간 표시 (12시간)
    }

    private fun <S : androidx.car.app.Screen> start(s: S): Pair<S, ScreenController> =
        s to ScreenController(s).also { it.moveToState(Lifecycle.State.RESUMED) }

    private fun last(c: ScreenController, s: androidx.car.app.Screen): Template = c.templatesReturned.lastOrNull() ?: s.onGetTemplate()

    @Test fun 바깥_장소_이름은_코스에서_날_id는_안_보임() {
        val named = AutoCourseStop("ext:tour:126019", "NEXT", 600, name = "대구 동화사", lat = 35.99, lng = 128.70)
        assertEquals("대구 동화사", AutoRuntime.stopName(named))
        // 이름이 안 실려 와도: 전에 받은 코스 이름 → 그것도 없으면 '고른 곳'
        AutoRuntime.noteCourse(AutoCourse(1, listOf(named), 900, 1000, 100, "집", null, null))
        assertEquals("대구 동화사", AutoRuntime.stopName(AutoCourseStop("ext:tour:126019", "NEXT", 600)))
        assertEquals("고른 곳", AutoRuntime.stopName(AutoCourseStop("ext:tour:999", "NEXT", 600)))
        assertEquals("고른 곳", AutoRuntime.placeName("ext:kakao:1"))
    }

    @Test fun 홈_오늘_어디_갈까요() {
        val plan = AutoJson.plan(JSONObject(Samples.PLAN)).copy(chosen = null, chosenBy = null)
        val (s, c) = start(HomeScreen(cc))
        s.show(plan)
        val t = last(c, s) as PlaceListMapTemplate
        save("1-plan", t)
        assertEquals("오늘 어디 갈까요", t.title.toString())
        val rows = t.itemList!!.items.map { it as Row }
        assertEquals(3, rows.size)
        assertEquals("침산공원 → 국립대구과학관", rows[0].title.toString())
        assertTrue(rows[0].texts[0].toString().endsWith("· 귀가 오후 4:49 · 첫 이동 12분"))
        assertEquals("차에서 한숨 자고 도착", rows[0].texts[1].toString())
        assertTrue(rows[0].metadata?.place != null)
        // 누르면 코스 자세히
        rows[0].onClickDelegate!!.sendClick(noop)
        val pushed = cc.getCarService(TestScreenManager::class.java).screensPushed
        assertTrue(pushed.last() is OptionScreen)
    }

    @Test fun 코스_자세히_이_길로_출발() {
        val plan = AutoJson.plan(JSONObject(Samples.PLAN))
        val (s, c) = start(OptionScreen(cc, plan, 0))
        val t = last(c, s) as PaneTemplate
        save("2-option", t)
        assertEquals("침산공원 → 국립대구과학관", t.title.toString())
        assertEquals(listOf("이 길로 출발", "다른 코스"), t.pane.actions.map { it.title.toString() })
    }

    @Test fun 폰에서_고른_코스() {
        val plan = AutoJson.plan(JSONObject(Samples.PLAN))
        val (s, c) = start(HomeScreen(cc))
        s.show(plan)
        val t = last(c, s) as PaneTemplate
        save("3-chosen", t)
        assertEquals("아빠가 고른 코스 · 오후 4:49 귀가", t.title.toString())
        assertEquals("이 길로 출발", t.pane.actions[0].title.toString())
    }

    @Test fun 코스_진행과_제안() {
        val course = AutoJson.courseRes(JSONObject(Samples.COURSE))!!
        val o = AutoJson.outcome(JSONObject(Samples.OUTCOME))!!
        val (s, c) = start(CourseScreen(cc))
        s.show(course, o.options)
        val t = last(c, s) as ListTemplate
        save("4-course", t)
        val rows = t.singleList!!.items.map { (it as Row).title.toString() }
        assertEquals("다음 · 국립대구과학관", rows[0])
        assertEquals("집 오후 4:49 도착 예정", rows[1])
        assertTrue(rows.any { it.startsWith("제안 · 과학관 빼고") })
    }

    private fun ready(v: String): ReadyMedal {
        val m = TestMedals.all.getValue(v)
        val art = TestMedals.art(v) ?: MedalComposer.fallbackArt()
        val full = MedalComposer.compose(m, art, TestMedals.fonts())
        File(out, "medal-$v.png").outputStream().use { full.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        return ReadyMedal(m, MedalComposer.forCar(full), android.graphics.Bitmap.createScaledBitmap(art, 160, 160, true))
    }

    @Test fun 도장_쾅_다섯_가지() {
        val titles = mapOf("normal" to "도장 쾅!", "rare" to "희귀 도장!", "festival" to "축제 도장!", "again" to "또 왔어요!", "quiet" to "도장 쾅! (조용히)")
        for ((i, v) in TestMedals.all.keys.withIndex()) {
            val (s, c) = start(StampScreen(cc, ready(v)))
            val t = last(c, s) as PaneTemplate
            save("5-stamp-${i + 1}-$v", t, image = "medal-$v.png")
            assertEquals(titles[v], t.title.toString())
            assertTrue("$v 큰 그림", t.pane.image != null)
            assertEquals(listOf("도장북 보기", "닫기"), t.pane.actions.map { it.title.toString() })
            assertEquals(Action.FLAG_PRIMARY, t.pane.actions[0].flags and Action.FLAG_PRIMARY)
            val rows = t.pane.rows
            assertEquals(TestMedals.all.getValue(v).name, rows[0].title.toString())
            assertTrue(rows[1].title.toString().startsWith("도장북 "))
        }
    }

    @Test fun 도장_줄_내용() {
        val (s, c) = start(StampScreen(cc, ready("normal")))
        val rows = (last(c, s) as PaneTemplate).pane.rows.map { it.title.toString() to it.texts.map(CarText::toString) }
        assertEquals("침산공원" to listOf("15번째 도장 · 우리 동네 평일 오후"), rows[0])
        assertEquals("도장북 15/34칸" to listOf("이번 묶음 5 / 9"), rows[1])
        assertEquals("다음 · 금호강 하중도" to listOf("오후 12:10 출발 · 집에 오후 4:20쯤"), rows[2])
        // 다시 찍음: 처음 찍은 날 · 방문 횟수, 코스가 없으면 두 줄
        val (s2, c2) = start(StampScreen(cc, ready("again")))
        val r2 = (last(c2, s2) as PaneTemplate).pane.rows
        assertEquals(2, r2.size)
        assertEquals("처음 찍은 날 10/12 · 12번째 도장", r2[0].texts[0].toString())
        assertEquals("3번째 방문", r2[1].texts[0].toString())
    }

    @Test fun 옛_호스트는_메시지와_도장_아이콘() {
        @Suppress("RestrictedApi")
        cc.updateHandshakeInfo(androidx.car.app.HandshakeInfo("com.google.android.projection.gearhead", 3))
        val (s, c) = start(StampScreen(cc, ready("normal")))
        val t = last(c, s) as MessageTemplate
        save("5-stamp-0-old-host", t)
        assertTrue(t.message.toString().startsWith("도장 쾅! 침산공원 · 도장북 15/34칸"))
        assertTrue(t.icon != null)
    }

    @Test fun 도장북_격자() {
        val (s, c) = start(StampBookScreen(cc, autoLoad = false))
        s.show(setOf("hwabon"), AutoRuntime.catalog)
        val t = last(c, s) as GridTemplate
        save("6-stampbook", t)
        assertEquals("도장북 · 1/3", t.title.toString())
        assertEquals("화본역", (t.singleList!!.items[0] as GridItem).title.toString())
    }

    @Test fun 토큰_없으면_연결_안내() {
        AutoRuntime.cfg.set(null, null)
        val (s, c) = start(HomeScreen(cc))
        val t = last(c, s) as MessageTemplate
        save("0-no-token", t)
        assertTrue(t.message.toString().contains("가족 연결"))
    }

    // ------------------------------------------------------------ 템플릿 → 글·JSON

    private val noop = object : androidx.car.app.OnDoneCallback {}

    /** 글 (거리 표시가 붙어 있으면 그 자리에 "2.9km") */
    private fun txt(c: CarText?): String? {
        val cs = c?.toCharSequence() ?: return null
        val sp = (cs as? android.text.Spanned)?.getSpans(0, cs.length, androidx.car.app.model.DistanceSpan::class.java).orEmpty()
        if (sp.isEmpty()) return cs.toString()
        val d = sp[0].distance!!
        val label = if (d.displayUnit == androidx.car.app.model.Distance.UNIT_METERS) "%.0fm".format(d.displayDistance) else "%.1fkm".format(d.displayDistance)
        return (label + cs.toString().substring(1)).replace(Regex("^(\\S+)\\s+·"), "$1 ·")
    }
    private fun actions(a: List<Action>) = JSONArray(a.map { txt(it.title) ?: if (it.icon != null) "⟳" else it.type.toString() })
    private fun rows(l: ItemList?) = JSONArray(l?.items.orEmpty().map { item ->
        when (item) {
            is Row -> JSONObject().put("title", txt(item.title)).put("texts", JSONArray(item.texts.map(::txt)))
                .put("click", item.onClickDelegate != null).put("marker", item.metadata?.place?.marker?.label?.let(::txt))
            is GridItem -> JSONObject().put("title", txt(item.title)).put("texts", JSONArray(listOfNotNull(txt(item.text))))
                .put("image", if (item.image?.icon?.resId != 0 && item.image?.icon?.type == 2) "res" else "bitmap")
            else -> JSONObject().put("title", item.toString())
        }
    })

    private fun save(name: String, t: Template, image: String? = null) {
        val j = JSONObject()
        when (t) {
            is PlaceListMapTemplate -> j.put("type", "PlaceListMap").put("title", txt(t.title)).put("rows", rows(t.itemList))
                .put("strip", actions(t.actionStrip?.actions.orEmpty()))
            is PaneTemplate -> j.put("type", "Pane").put("title", txt(t.title)).put("image", image ?: JSONObject.NULL)
                .put("rows", JSONArray(t.pane.rows.map { JSONObject().put("title", txt(it.title)).put("texts", JSONArray(it.texts.map(::txt))) }))
                .put("actions", actions(t.pane.actions))
            is ListTemplate -> j.put("type", "List").put("title", txt(t.title)).put("rows", rows(t.singleList))
                .put("strip", actions(t.actionStrip?.actions.orEmpty()))
            is MessageTemplate -> j.put("type", "Message").put("title", txt(t.title)).put("message", txt(t.message))
                .put("icon", t.icon != null).put("actions", actions(t.actions))
            is GridTemplate -> j.put("type", "Grid").put("title", txt(t.title)).put("rows", rows(t.singleList))
            else -> j.put("type", t.javaClass.simpleName)
        }
        File(out, "$name.json").writeText(j.toString(2))
    }
}
