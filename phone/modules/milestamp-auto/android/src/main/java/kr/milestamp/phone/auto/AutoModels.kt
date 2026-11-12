package kr.milestamp.phone.auto

import kr.milestamp.engine.Arrival
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.Place
import org.json.JSONArray
import org.json.JSONObject

/*
 * 안드로이드 오토 화면이 쓰는 모양. 서버 JSON은 폰 앱(phone/src/plan.ts·course.ts·catalog.ts)과 같은 것을 읽는다.
 * 계산은 전부 서버 — 여기는 받아서 보여 주고 고르기만 한다. 장소(도장 판정용)만 엔진 Place로 바꾼다.
 */

data class AutoStop(val id: String, val name: String, val lat: Double, val lng: Double, val stampable: Boolean)
data class AutoReason(val text: String, val tone: String)

data class AutoOption(
    val kind: String,
    val label: String,
    val stops: List<AutoStop>,
    val firstLegMin: Int,
    val arriveHomeMin: Int,
    val reasons: List<AutoReason>,
) {
    /** 카드 제목: 장소들을 화살표로 (폰 optionTitle과 같음) */
    val title: String get() = if (stops.isEmpty()) "바로 집으로" else stops.joinToString(" → ") { it.name }
    val firstReason: String? get() = reasons.firstOrNull()?.text
}

data class AutoPlan(
    val planId: String,
    val options: List<AutoOption>,
    val chosen: Int?,
    /** '차' 또는 '폰:엄마' */
    val chosenBy: String?,
) {
    val chosenOption: AutoOption? get() = chosen?.let { options.getOrNull(it) }
}

/**
 * 코스의 곳 하나. 서버가 곳마다 이름·좌표를 실어 보낸다 — 명소 목록에 없는 바깥 장소('ext:tour:…', 도장 없음)도
 * 이름으로 보이고 길 안내·'다녀옴' 판정을 할 수 있게 (내가 고르기 C단계). 옛 서버 답엔 없을 수 있다.
 */
data class AutoCourseStop(
    val placeId: String, val status: String, val plannedArriveMin: Int, val plannedDepartMin: Int? = null,
    val name: String? = null, val lat: Double? = null, val lng: Double? = null,
) {
    /** 바깥 장소 ('ext:…') — 도장 대신 '다녀옴' */
    val isExt get() = placeId.startsWith("ext:")

    /** 도착 판정용 도장 없는 장소 (이름·좌표가 있을 때만, 반경 300m — 차 앱·서버 바깥 장소 기본값과 같음) */
    fun toExtPlace(): Place? {
        val n = name?.takeIf { it.isNotBlank() } ?: return null
        val la = lat ?: return null
        val ln = lng ?: return null
        return Place(id = placeId, name = n, at = LatLng(la, ln), radiusM = 300, stampable = false)
    }
}

data class AutoCourse(
    val version: Int,
    val stops: List<AutoCourseStop>,
    val arriveHomeMin: Int,
    val limitMin: Int,
    val slackMin: Int,
    val endName: String,
    val headline: String?,
    val body: String?,
) {
    val next: AutoCourseStop? get() = stops.firstOrNull { it.status == "NEXT" } ?: stops.firstOrNull { it.status == "PLANNED" }
    val here: AutoCourseStop? get() = stops.firstOrNull { it.status == "ARRIVED" }
}

/** PATCH·adopt 답 (폰 normOutcome과 같음). 제안이면 options 1~3장 */
data class AutoOutcome(val kind: String, val course: AutoCourse, val options: List<AutoOption>, val voice: String?, val changeText: String?)

/** 서버 명소 목록(/api/catalog) 한 칸 */
data class CatalogEntry(
    val id: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val radiusM: Int,
    val points: List<Arrival>,
    val indoor: Boolean,
    val stampable: Boolean,
    val stampUrl: String?,
    val stampBwUrl: String?,
    val stampVersion: Int,
    /** 도장북 묶음 (season1·town …)과 그 이름 */
    val grp: String? = null,
    val grpTitle: String? = null,
    /** 축제·행사면 기간·계절 (명소는 null) */
    val festival: FestivalInfo? = null,
) {
    /** 도장북 34칸에 드는 명소 (축제 제외) */
    val inAlbum get() = stampable && festival == null

    /** 도장 판정용 엔진 Place (도착 원 여러 개 포함) */
    fun toPlace() = Place(id = id, name = name, at = LatLng(lat, lng), indoor = indoor, radiusM = radiusM, stampable = stampable, points = points)
}

/** 축제 기간 'YYYY-MM-DD' · 계절 글씨 · 붙은 명소 */
data class FestivalInfo(val starts: String, val ends: String, val season: String?, val placeId: String?) {
    fun runsOn(day: String) = day >= starts && day <= ends
    /** 마지막 날 'M/D' */
    val until: String? get() = ends.split('-').takeIf { it.size == 3 }?.let { "${it[1].toInt()}/${it[2].toInt()}" }
}

data class StampRow(val placeId: String, val number: Int?, val createdAt: String)

object AutoJson {
    /** 분 → "HH:MM" (자정 넘김 처리) — 서버로 보내는 값(데이터)용. 화면 글은 [clock] */
    fun hhmm(min: Int): String = Math.floorMod(min, 24 * 60).let { "%02d:%02d".format(it / 60, it % 60) }

    /** 시간 표시: true = 12시간('오후 9:54', 기본) · false = 24시간('21:54'). 폰 '우리 차' 탭에서 고른 값 ([AutoConfig.hour12]) */
    @Volatile var hour12: Boolean = true

    /** 시·분 → 화면 글 */
    fun clockHM(h: Int, m: Int): String =
        if (!hour12) "%02d:%02d".format(h, m) else "${if (h < 12) "오전" else "오후"} ${if (h % 12 == 0) 12 else h % 12}:" + "%02d".format(m)

    /** 분 → 화면 글 ('오후 9:54' / '21:54') */
    fun clock(min: Int): String = Math.floorMod(min, 24 * 60).let { clockHM(it / 60, it % 60) }

    // 글 속 시각 'H:MM'·'HH:MM' (앞뒤가 숫자·콜론이면 아님, 이미 오전/오후가 붙었으면 그대로). '1시간 33분'은 안 건드림
    private val CLOCK_RE = Regex("(오[전후]\\s?)?(?<![\\d:.])(\\d{1,2}):([0-5]\\d)(?![\\d:])")

    /** 서버·엔진 글 속 'HH:MM'을 고른 표시 방식으로 ('집에는 21:54쯤' → '집에는 오후 9:54쯤'). 24시간이면 그대로 */
    fun clockText(s: String): String {
        if (!hour12) return s
        return CLOCK_RE.replace(s) { m ->
            val h = m.groupValues[2].toInt()
            if (m.groupValues[1].isNotEmpty() || h > 23) m.value else clockHM(h, m.groupValues[3].toInt())
        }
    }

    /** 받침이 있으면 '이', 없으면 '가' (엄마가 · 삼촌이) */
    fun iGa(word: String): String {
        val c = word.lastOrNull()?.code ?: return "가"
        return if (c in 0xAC00..0xD7A3 && (c - 0xAC00) % 28 != 0) "이" else "가"
    }

    /** '폰:아빠' → '아빠가 고른 코스', '차' → '차에서 고른 코스' */
    fun chooserText(by: String?): String = when {
        by.isNullOrBlank() -> "고른 코스"
        by == "차" -> "차에서 고른 코스"
        else -> by.removePrefix("폰:").let { "$it${iGa(it)} 고른 코스" }
    }

    private fun str(o: JSONObject, k: String): String? = if (o.isNull(k)) null else o.optString(k).takeIf { it.isNotEmpty() }

    fun option(j: JSONObject): AutoOption {
        val st = j.optJSONArray("stops") ?: JSONArray()
        val stops = List(st.length()) { k ->
            val s = st.getJSONObject(k)
            AutoStop(s.getString("id"), s.optString("name"), s.optDouble("lat"), s.optDouble("lng"), s.optBoolean("stampable"))
        }
        val rs = j.optJSONArray("reasons") ?: JSONArray()
        val reasons = List(rs.length()) { k -> rs.getJSONObject(k).let { AutoReason(it.optString("text"), it.optString("tone", "PLAIN")) } }
        return AutoOption(
            kind = j.optString("kind"), label = j.optString("label"), stops = stops,
            firstLegMin = j.optInt("firstLegMin"), arriveHomeMin = j.optInt("arriveHomeMin"), reasons = reasons,
        )
    }

    /** GET /api/plan 답 */
    fun plan(o: JSONObject): AutoPlan {
        val opts = o.getJSONObject("plan").getJSONArray("options")
        return AutoPlan(
            planId = o.getString("planId"),
            options = List(opts.length()) { option(opts.getJSONObject(it)) },
            chosen = if (o.isNull("chosen") || !o.has("chosen")) null else o.optInt("chosen"),
            chosenBy = str(o, "chosenBy"),
        )
    }

    private fun isCourse(x: JSONObject?) = x != null && x.optJSONArray("stops") != null && x.has("arriveHomeMin")

    /** 코스 JSON → AutoCourse. [explain]은 응답 몸체의 explain·courseExplain */
    fun course(c: JSONObject, explain: JSONObject? = null): AutoCourse {
        val st = c.getJSONArray("stops")
        val stops = List(st.length()) { k ->
            val s = st.getJSONObject(k)
            val ext = s.optJSONObject("ext")
            fun num(k: String): Double? = listOfNotNull(s, ext).firstNotNullOfOrNull { o ->
                if (o.has(k) && !o.isNull(k)) o.optDouble(k).takeIf { it.isFinite() } else null
            }
            AutoCourseStop(
                s.optString("placeId").ifEmpty { s.optString("id") }, s.optString("status", "PLANNED"), s.optInt("plannedArriveMin"),
                if (s.has("plannedDepartMin") && !s.isNull("plannedDepartMin")) s.optInt("plannedDepartMin") else null,
                name = str(s, "name") ?: ext?.let { str(it, "name") }, lat = num("lat"), lng = num("lng"),
            )
        }
        val home = c.getInt("arriveHomeMin")
        val limit = c.optInt("limitMin", home)
        val ex = explain ?: c.optJSONObject("explain")
        return AutoCourse(
            version = c.optInt("version"), stops = stops, arriveHomeMin = home, limitMin = limit,
            slackMin = if (c.has("slackMin")) c.optInt("slackMin") else limit - home,
            endName = c.optJSONObject("end")?.optString("name")?.takeIf { it.isNotEmpty() } ?: "집",
            headline = ex?.let { str(it, "headline") }, body = ex?.let { str(it, "body") },
        )
    }

    /** GET /api/plan/course 답: {course, version} · 코스 자체 · {course: null} 모두 받아 준다 */
    fun courseRes(o: JSONObject): AutoCourse? {
        if (isCourse(o)) return course(o)
        val c = o.optJSONObject("course")
        if (!isCourse(c)) return null
        val ex = o.optJSONObject("explain") ?: o.optJSONObject("courseExplain")
        return course(c!!, ex).let { if (it.version == 0 && o.has("version")) it.copy(version = o.optInt("version")) else it }
    }

    fun outcome(o: JSONObject): AutoOutcome? {
        val c = o.optJSONObject("course")
        if (!isCourse(c)) return null
        val opts = o.optJSONArray("options") ?: JSONArray()
        val options = List(opts.length()) { option(opts.getJSONObject(it)) }
        val kind = o.optString("kind").ifEmpty { if (options.isNotEmpty()) "Proposal" else "Retimed" }
        return AutoOutcome(kind, course(c!!, o.optJSONObject("explain")), options, str(o, "voice"), o.optJSONObject("change")?.let { str(it, "text") })
    }

    /** 도착 지점 [{lat, lng, r, name}] → 엔진 Arrival (차 앱 ServerApi.parsePoints와 같은 규칙) */
    fun points(arr: JSONArray?): List<Arrival> {
        if (arr == null) return emptyList()
        return List(arr.length()) { arr.optJSONObject(it) }.mapNotNull { o ->
            if (o == null || !o.has("lat") || !o.has("lng")) return@mapNotNull null
            Arrival(LatLng(o.getDouble("lat"), o.getDouble("lng")), o.optInt("r", 300).coerceIn(50, 1500), o.optString("name"))
        }
    }

    /** GET /api/catalog 답 → 명소 목록 (+ 축제·행사는 뒤에, [CatalogEntry.festival]이 있는 칸) */
    fun catalog(o: JSONObject): List<CatalogEntry> {
        val arr = o.optJSONArray("places") ?: return emptyList()
        val gs = o.optJSONArray("groups") ?: JSONArray()
        val groups = (0 until gs.length()).mapNotNull { gs.optJSONObject(it) }.associate { it.optString("key") to it.optString("title") }
        val places = List(arr.length()) { i ->
            val p = arr.getJSONObject(i)
            val s = p.optJSONObject("stamp")
            val grp = str(p, "grp")
            CatalogEntry(
                id = p.getString("id"), name = p.optString("name"), lat = p.optDouble("lat"), lng = p.optDouble("lng"),
                radiusM = p.optInt("radiusM", 300), points = points(p.optJSONArray("points")), indoor = p.optBoolean("indoor"),
                stampable = p.optBoolean("stampable", true),
                stampUrl = s?.let { str(it, "url") }, stampBwUrl = s?.let { str(it, "bwUrl") }, stampVersion = s?.optInt("version") ?: 0,
                grp = grp, grpTitle = grp?.let { groups[it] },
            )
        }
        val fs = o.optJSONArray("festivals") ?: JSONArray()
        val fests = (0 until fs.length()).mapNotNull { fs.optJSONObject(it) }.filter { it.has("id") && it.has("lat") }.map { f ->
            val s = f.optJSONObject("stamp")
            val pts = points(f.optJSONArray("points"))
            CatalogEntry(
                id = f.getString("id"), name = f.optString("name"), lat = f.optDouble("lat"), lng = f.optDouble("lng"),
                radiusM = pts.maxOfOrNull { it.radiusM } ?: 300, points = pts, indoor = f.optBoolean("indoor"), stampable = true,
                stampUrl = s?.let { str(it, "url") }, stampBwUrl = s?.let { str(it, "bwUrl") }, stampVersion = s?.optInt("version") ?: 0,
                grp = "festival", grpTitle = "축제 도장",
                festival = FestivalInfo(f.optString("starts"), f.optString("ends"), str(f, "season"), str(f, "placeId")),
            )
        }
        return places + fests
    }

    /** GET /api/phone/stamps 답 */
    fun stamps(o: JSONObject): List<StampRow> {
        val arr = o.optJSONArray("stamps") ?: return emptyList()
        return List(arr.length()) { i ->
            val s = arr.getJSONObject(i)
            val p = s.optJSONObject("payload")
            StampRow(s.optString("place_id"), p?.takeIf { it.has("number") && !it.isNull("number") }?.optInt("number"), s.optString("created_at"))
        }
    }
}
