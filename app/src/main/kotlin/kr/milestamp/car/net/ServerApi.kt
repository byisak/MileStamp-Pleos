package kr.milestamp.car.net

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kr.milestamp.car.BuildConfig
import kr.milestamp.engine.Arrival
import kr.milestamp.engine.BackBy
import kr.milestamp.engine.BreakRange
import kr.milestamp.engine.MealSetup
import kr.milestamp.engine.Restaurant
import kr.milestamp.engine.CrowdDwell
import kr.milestamp.engine.FamilyProfile
import kr.milestamp.engine.PlaceDwell
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.Leg
import kr.milestamp.engine.LegKind
import kr.milestamp.engine.OptionKind
import kr.milestamp.engine.OpenHours
import kr.milestamp.engine.Planner
import kr.milestamp.engine.DriveRoute
import kr.milestamp.engine.Moments
import kr.milestamp.engine.Show
import kr.milestamp.engine.FestivalInfo
import kr.milestamp.engine.GoWith
import kr.milestamp.engine.Place
import kr.milestamp.engine.Plan
import kr.milestamp.engine.PlanMode
import kr.milestamp.engine.PlanOption
import kr.milestamp.engine.Reason
import kr.milestamp.engine.Sky
import kr.milestamp.engine.SkyToday
import kr.milestamp.engine.Tone
import kr.milestamp.engine.hhmm
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.LocalDate

/**
 * 마일스탬프 서버(web/)와의 통신. 차는 좌표를 보내지 않는다 — 장소 ID와 숫자만.
 *  - 처음 한 번 /api/car/register 로 차 토큰을 받아 이 기기에만 보관
 *  - 폰 연결 QR: /api/car/pair, 연결된 폰: /api/car/status
 *  - 차에서 생긴 일: /api/car/events (handoff · mission · intro · stamp · summary)
 *  - 오늘 어디 갈까요?: /api/plan (지금 위치는 서버가 1km 칸으로 깎아 칸만 저장) · /api/plan/choose · /api/car/places
 * 모든 호출은 IO 스레드에서. 실패해도 차 기능은 멈추지 않는다(로그만).
 */
class ServerApi(context: Context, private val base: String = BuildConfig.SERVER_URL) {
    private val prefs = context.getSharedPreferences("server", Context.MODE_PRIVATE)
    private val placesFile = File(context.filesDir, "places.json")

    data class Pair(val code: String, val url: String)

    suspend fun pair(): Pair? = call("POST", "/api/car/pair")?.let { Pair(it.getString("code"), it.getString("url")) }

    suspend fun phones(): List<String>? = call("GET", "/api/car/status")?.getJSONArray("phones")?.let { arr ->
        List(arr.length()) { arr.getJSONObject(it).getString("nickname") }
    }

    /** 이벤트 보내기. 통신이 잠깐 끊겼을 때를 위해 3번까지 다시 시도. */
    suspend fun event(kind: String, placeId: String?, payload: JSONObject = JSONObject()): Boolean =
        eventReply(kind, placeId, payload) != null

    /** [event]와 같고 서버 답을 돌려준다 ({ id, pushed, payload } — 도장은 payload.number가 서버가 정한 No.). 못 보냈으면 null. */
    suspend fun eventReply(kind: String, placeId: String?, payload: JSONObject = JSONObject()): JSONObject? {
        val body = JSONObject().put("kind", kind).put("payload", payload)
        if (placeId != null) body.put("placeId", placeId)
        repeat(3) { attempt ->
            val res = call("POST", "/api/car/events", body)
            if (res != null) {
                Log.i(TAG, "event $kind $placeId → 폰 ${res.optInt("pushed")}대 알림")
                return res
            }
            delay(1_000L shl attempt)
        }
        return null
    }

    /** 도장북: 이 차가 찍은 도장 전부 (`GET /api/car/stamps`, 폰 도장북과 같은 행). 통신이 안 되면 null. */
    suspend fun stamps(): JSONArray? = call("GET", "/api/car/stamps", timeoutMs = 5_000)?.optJSONArray("stamps")

    // ------------------------------------------------------------ 우리 가족

    /**
     * 우리 가족 설정 (`GET /api/car/family`, 폰 '우리 가족'에서 정한 값). 저장된 적이 없으면(saved=false) 또는 통신이 안 되면 null.
     * 집은 폰에서 정했을 때만 바꾸고(없으면 [base]의 집 — 데모 차는 북구청), 낮잠·귀가 기준·저녁·아이 나이는 서버 값.
     */
    suspend fun family(base: FamilyProfile): FamilyProfile? {
        val o = call("GET", "/api/car/family", timeoutMs = 5_000) ?: return null
        if (!o.optBoolean("saved")) return null
        return runCatching { parseFamily(o, base) }.onFailure { Log.w(TAG, "가족 설정 읽기 실패: ${it.message}") }.getOrNull()
    }

    // ------------------------------------------------------------ 오늘 어디 갈까요?

    /** 서버의 오늘 계획. [chosenBy]는 서버 글자 그대로 ("폰:아빠" · "차"). */
    data class TodayPlan(
        val planId: String, val plan: Plan, val chosen: Int?, val chosenBy: String?,
        /** 이 계획의 동행 (예전 서버 답엔 없음 → null). */
        val companion: GoWith? = null,
        /** 밤이라 오늘은 더 갈 곳이 없음 → 차는 '내일 코스' 안내. */
        val tomorrowHint: Boolean = false,
    )

    /**
     * 오늘 계획 받기. 장소는 [catalog]에서 id로 찾아 엔진 Place로 (없으면 응답 값으로 만든다).
     * [at]은 시연용 시각 지정('2026-10-31T08:30', 데모 차만 서버가 받아 줌). [timeoutMs]를 넘기면 null.
     */
    suspend fun plan(
        here: LatLng, home: LatLng?, catalog: (String) -> Place?, at: String? = null, timeoutMs: Int = 6_000,
    ): TodayPlan? {
        val q = buildString {
            append("/api/plan?lat=%.4f&lng=%.4f".format(java.util.Locale.ROOT, here.lat, here.lng))
            home?.let { append("&home=" + "%.4f,%.4f".format(java.util.Locale.ROOT, it.lat, it.lng)) }
            at?.let { append("&at=" + URLEncoder.encode(it, "UTF-8")) }
        }
        val res = call("GET", q, timeoutMs = timeoutMs) ?: return null
        return runCatching { parsePlan(res, catalog) }
            .onFailure { Log.w(TAG, "계획 읽기 실패: ${it.message}") }.getOrNull()
    }

    /** 카드 고르기를 서버에 알림 → 가족 폰에도 '차에서 골랐어요'. [idx] null = 취소. */
    suspend fun choose(planId: String, idx: Int?): Boolean =
        call("POST", "/api/plan/choose", JSONObject().put("planId", planId).put("idx", idx ?: JSONObject.NULL)) != null

    /**
     * 추천 후보 장소. 하루 한 번만 서버에 묻고 파일에 저장해 둔다 (인터넷이 안 되면 저장본, 그것도 없으면 null).
     */
    suspend fun places(): List<Place>? {
        val cached = withContext(Dispatchers.IO) {
            runCatching { JSONObject(placesFile.readText()) }.getOrNull()
        }
        val today = LocalDate.now().toString()
        if (cached != null && cached.optString("day") == today) return parsePlaces(cached)
        val fresh = call("GET", "/api/car/places")
        if (fresh != null) {
            fresh.put("day", today)
            withContext(Dispatchers.IO) { runCatching { placesFile.writeText(fresh.toString()) } }
            return parsePlaces(fresh)
        }
        return cached?.let(::parsePlaces)
    }

    /** 저장해 둔 장소 목록의 식당 (밥 자리 후보). [places] 다음에 부른다. 없거나 못 읽으면 빈 목록. */
    suspend fun restaurants(): List<Restaurant> = withContext(Dispatchers.IO) {
        runCatching { parseRestaurants(JSONObject(placesFile.readText())) }.getOrDefault(emptyList())
    }

    /** 저장해 둔 장소 목록의 도장 그림 판 (관리자에서 올린 것). [places] 다음에 부른다. */
    suspend fun stampRefs(): Map<String, RemoteStamps.Ref> = withContext(Dispatchers.IO) {
        runCatching { parseStampRefs(JSONObject(placesFile.readText())) }.getOrDefault(emptyMap())
    }

    /** 공개 주소(도장 그림)를 [dst]에 받기. 반쯤 받은 파일은 남기지 않는다. */
    suspend fun download(url: String, dst: File): Boolean = withContext(Dispatchers.IO) {
        val tmp = File(dst.parentFile, dst.name + ".part")
        runCatching {
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 4_000; c.readTimeout = 10_000
            val code = c.responseCode
            if (code !in 200..299) { c.disconnect(); error("HTTP $code") }
            c.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
            c.disconnect()
            if (tmp.length() < 100 || !tmp.renameTo(dst)) error("파일이 이상함")
            true
        }.onFailure { tmp.delete(); Log.w(TAG, "그림 받기 실패: ${it.message}") }.getOrDefault(false)
    }

    // ------------------------------------------------------------ 살아 있는 코스 (B 서버와 동시에 만듦 — 없으면 조용히 실패)

    /** 코스 호출의 답. [json]은 2xx·409의 본문. 404 = 서버에 오늘 코스가 없음, 405 = 서버가 아직 그 방법을 모름. */
    sealed interface CourseReply {
        data class Ok(val json: JSONObject) : CourseReply
        /** 버전이 낮음 → 본문 {course, version}: 서버의 최신 코스를 Remote로 넣는다. */
        data class Conflict(val json: JSONObject) : CourseReply
        data class Rejected(val code: Int) : CourseReply
        /** 통신 실패 (인터넷 없음·시간 초과). */
        data object Offline : CourseReply
    }

    /** 서버의 오늘 코스 (`GET /api/plan/course`). 정차 중 15초마다 — 폰이 바꾼 코스는 이 길로만 온다(차엔 FCM 없음). */
    suspend fun course(timeoutMs: Int = 4_000): CourseReply = courseCall("GET", "/api/plan/course", null, timeoutMs)

    /**
     * 차가 코스를 바꿨다 → 같은 사건을 서버에 (`PATCH /api/plan/course {version, event}`). 2초 제한, 한 번 더 시도.
     * 안드로이드 HttpURLConnection은 PATCH를 못 보내서 `POST + X-HTTP-Method-Override: PATCH`로 보낸다 (서버가 받아 주어야 함).
     */
    suspend fun courseEvent(version: Int, event: JSONObject): CourseReply {
        val body = JSONObject().put("version", version).put("event", event)
        var reply = courseCall("PATCH", "/api/plan/course", body, COURSE_TIMEOUT_MS)
        if (reply == CourseReply.Offline) reply = courseCall("PATCH", "/api/plan/course", body, COURSE_TIMEOUT_MS)
        return reply
    }

    /** 제안 카드를 골랐다 (`POST /api/plan/course/adopt {version, optionIdx}`). */
    suspend fun adoptCourse(version: Int, optionIdx: Int, nowMin: Int? = null): CourseReply {
        val body = JSONObject().put("version", version).put("optionIdx", optionIdx)
        if (nowMin != null) body.put("now", "%02d:%02d".format(nowMin / 60, nowMin % 60))
        var reply = courseCall("POST", "/api/plan/course/adopt", body, COURSE_TIMEOUT_MS)
        if (reply == CourseReply.Offline) reply = courseCall("POST", "/api/plan/course/adopt", body, COURSE_TIMEOUT_MS)
        return reply
    }

    /** 제안 카드 거절 '그대로 갈게요' (`POST /api/plan/course/dismiss {version}`) — 폰·차 공용 API, 차 토큰으로. */
    suspend fun dismissProposal(version: Int): CourseReply {
        val body = JSONObject().put("version", version)
        var reply = courseCall("POST", "/api/plan/course/dismiss", body, COURSE_TIMEOUT_MS)
        if (reply == CourseReply.Offline) reply = courseCall("POST", "/api/plan/course/dismiss", body, COURSE_TIMEOUT_MS)
        return reply
    }

    private suspend fun courseCall(method: String, path: String, body: JSONObject?, timeoutMs: Int): CourseReply {
        val t = token() ?: return CourseReply.Offline
        val (code, text) = raw(method, path, body, t, timeoutMs) ?: return CourseReply.Offline
        val json = runCatching { JSONObject(text) }.getOrNull()
        return when {
            code in 200..299 && json != null -> CourseReply.Ok(json)
            code == 409 && json != null -> CourseReply.Conflict(json)
            else -> { Log.w(TAG, "코스 $method $path → $code ${text.take(200)}"); CourseReply.Rejected(code) }
        }
    }

    private suspend fun token(): String? {
        prefs.getString(KEY_TOKEN, null)?.let { return it }
        val res = request("POST", "/api/car/register", null, null) ?: return null
        val token = res.getString("token")
        prefs.edit().putString(KEY_TOKEN, token).apply()
        return token
    }

    private suspend fun call(method: String, path: String, body: JSONObject? = null, timeoutMs: Int = 6_000): JSONObject? {
        val t = token() ?: return null
        return request(method, path, body, t, timeoutMs)
    }

    private suspend fun request(method: String, path: String, body: JSONObject?, token: String?, timeoutMs: Int = 6_000): JSONObject? {
        val (code, text) = raw(method, path, body, token, timeoutMs) ?: return null
        if (code !in 200..299) { Log.w(TAG, "서버 호출 실패: $method $path → $code $text"); return null }
        return runCatching { JSONObject(text) }.onFailure { Log.w(TAG, "서버 답 읽기 실패: ${it.message}") }.getOrNull()
    }

    /** HTTP 한 번. 통신 자체가 안 되면 null, 됐으면 (응답 코드, 본문). PATCH는 안드로이드가 막아서 POST + 덮어쓰기 머리말로. */
    private suspend fun raw(method: String, path: String, body: JSONObject?, token: String?, timeoutMs: Int): kotlin.Pair<Int, String>? =
        withContext(Dispatchers.IO) {
            runCatching {
                val c = URL(base + path).openConnection() as HttpURLConnection
                if (method == "PATCH") {
                    runCatching { c.requestMethod = "PATCH" }.onFailure {
                        c.requestMethod = "POST"
                        c.setRequestProperty("X-HTTP-Method-Override", "PATCH")
                    }
                } else c.requestMethod = method
                c.connectTimeout = minOf(4_000, timeoutMs)
                c.readTimeout = timeoutMs
                c.setRequestProperty("Content-Type", "application/json")
                token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
                if (body != null) {
                    c.doOutput = true
                    c.outputStream.use { it.write(body.toString().toByteArray()) }
                }
                val code = c.responseCode
                val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
                c.disconnect()
                if (code == 401) prefs.edit().remove(KEY_TOKEN).apply() // 서버 DB가 바뀌었으면 다음에 다시 등록
                code to text
            }.onFailure { Log.w(TAG, "서버 통신 실패: $method $path ${it.message}") }.getOrNull()
        }

    companion object {
        private const val TAG = "MileStampServer"
        private const val KEY_TOKEN = "car_token"
        /** 코스 호출 제한 (차 판정은 기다리지 않고 먼저 끝나 있음). */
        private const val COURSE_TIMEOUT_MS = 2_000
        fun jsonList(items: List<String>) = JSONArray(items)

        /** 서버 장소 목록(/api/car/places) → 엔진 Place. 칸 이름이 엔진과 같다. */
        /** 서버 가족 설정 JSON → 엔진 FamilyProfile (모은 도장 수 등 나머지는 [base] 그대로). */
        fun parseFamily(o: JSONObject, base: FamilyProfile): FamilyProfile {
            val homeJ = o.optJSONArray("home")
            val home = if (homeJ != null && homeJ.length() == 2) LatLng(homeJ.getDouble(0), homeJ.getDouble(1)) else base.home
            val napStart = if (o.isNull("napStart")) null else o.optInt("napStart")
            val napLen = if (o.isNull("napLen")) null else o.optInt("napLen")
            val back = o.optString("backBy")
            val backBy = when {
                back.startsWith("sunset-") -> back.removePrefix("sunset-").toIntOrNull()?.let { BackBy.SunsetMinus(it) }
                back.startsWith("at:") -> runCatching { BackBy.At(hhmm(back.removePrefix("at:"))) }.getOrNull()
                else -> null
            } ?: base.backBy
            val ages = o.optJSONArray("kidAges")?.let { a -> List(a.length()) { a.getInt(it) } }?.takeIf { it.isNotEmpty() } ?: base.kidAges
            return base.copy(
                home = home,
                kids = ages.size,
                kidAges = ages,
                napStartMin = napStart ?: 0,
                napEndMin = if (napStart != null && napLen != null) napStart + napLen else 0,
                backBy = backBy,
                dinnerMin = if (o.isNull("dinner")) null else o.optInt("dinner"),
                // 머무는 시간 맞춤 (옛 서버엔 칸이 없다 → 조사값 그대로): 우리 가족 배율·장소 기록 + 같은 또래 P75
                dwellFactor = o.optDouble("dwellFactor", 1.0).takeIf { !it.isNaN() } ?: 1.0,
                dwellN = o.optInt("dwellN", 0),
                placeDwell = o.optJSONObject("placeDwell")?.let { m ->
                    m.keys().asSequence().mapNotNull { k ->
                        m.optJSONObject(k)?.let { x -> k to PlaceDwell(x.optInt("avg"), x.optInt("n")) }?.takeIf { it.second.n > 0 }
                    }.toMap()
                }.orEmpty(),
                crowdDwell = o.optJSONObject("crowdDwell")?.let { m ->
                    m.keys().asSequence().mapNotNull { k ->
                        m.optJSONObject(k)?.let { x -> k to CrowdDwell(x.optInt("p75"), x.optInt("n")) }?.takeIf { it.second.n > 0 }
                    }.toMap()
                }.orEmpty(),
                // 누구랑 가요? (폰에서 마지막으로 고른 동행, 옛 서버엔 없음 → 아이와). 어른끼리면 엔진이 낮잠·아이 규칙을 안 쓴다
                companion = GoWith.of(o.optString("companion").takeIf { it.isNotEmpty() }),
                // 저녁 나들이 귀가 기준 (옛 서버엔 없음 → 기본 21:00 · 23:00)
                bedtimeMin = o.optInt("bedtime", FamilyProfile.DEFAULT_BEDTIME_MIN).takeIf { it in 18 * 60..23 * 60 } ?: FamilyProfile.DEFAULT_BEDTIME_MIN,
                lateReturnMin = o.optInt("lateReturn", FamilyProfile.DEFAULT_LATE_RETURN_MIN).takeIf { it in 19 * 60..24 * 60 - 1 } ?: FamilyProfile.DEFAULT_LATE_RETURN_MIN,
                // 밥도 같이 짜기 (옛 서버엔 없음 → 끔). 식당 목록은 부르는 쪽이 장소 목록에서 채운다 ([withRestaurants])
                meal = if (o.optBoolean("mealPlan", false)) MealSetup(emptyList()) else null,
            )
        }

        /**
         * 식당 (/api/car/places의 restaurants, 옛 서버엔 없음 → 빈 목록) → 엔진 Restaurant. 좌표가 없거나 이상한 줄은 버린다.
         * 가족 '밥도 같이 짜기'를 켜면 차 엔진(Meals)이 인터넷 없이도 이 목록으로 밥 자리를 넣는다.
         */
        fun parseRestaurants(o: JSONObject): List<Restaurant> {
            val arr = o.optJSONArray("restaurants") ?: return emptyList()
            fun strs(a: JSONArray?) = a?.let { x -> List(x.length()) { x.optString(it) }.filter { it.isNotEmpty() } }.orEmpty()
            return List(arr.length()) { arr.optJSONObject(it) }.mapNotNull { r ->
                if (r == null || !r.has("lat") || !r.has("lng")) return@mapNotNull null
                val lat = r.optDouble("lat"); val lng = r.optDouble("lng")
                if (!lat.isFinite() || !lng.isFinite()) return@mapNotNull null
                val pk = r.optJSONObject("parking")
                val wait = r.optJSONObject("wait")
                val fit = r.optJSONObject("fit")
                Restaurant(
                    id = r.optString("id").ifEmpty { return@mapNotNull null }, name = r.optString("name").ifEmpty { return@mapNotNull null },
                    at = LatLng(lat, lng), cuisine = strs(r.optJSONArray("cuisine")),
                    priceLevel = if (r.isNull("priceLevel") || !r.has("priceLevel")) null else r.optInt("priceLevel"),
                    kid = strs(r.optJSONArray("kid")).toSet(),
                    parkingHas = pk?.optString("has")?.takeIf { it.isNotEmpty() && !pk.isNull("has") },
                    parkingFee = pk?.optString("fee")?.takeIf { it.isNotEmpty() && !pk.isNull("fee") },
                    wait = wait?.keys()?.asSequence()?.associateWith { wait.optInt(it, 0).coerceIn(0, 2) }.orEmpty(),
                    meal = strs(r.optJSONArray("meal")).toSet(),
                    dwellMin = if (r.isNull("dwellMin") || !r.has("dwellMin")) null else r.optInt("dwellMin").takeIf { it in 15..120 },
                    fit = fit?.let { f -> GoWith.entries.filter { f.has(it.key) }.associateWith { f.optDouble(it.key) }.filterValues { it.isFinite() && it in 0.0..1.0 } }.orEmpty(),
                    tags = strs(r.optJSONArray("tags")).toSet(),
                    hours = parseOpenHours(r.optJSONArray("openHours")),
                    placeId = r.optString("placeId").takeIf { it.isNotEmpty() && !r.isNull("placeId") },
                )
            }
        }

        fun parsePlaces(o: JSONObject): List<Place> {
            val arr = o.getJSONArray("places")
            return List(arr.length()) { i ->
                val p = arr.getJSONObject(i)
                Place(
                    id = p.getString("id"), name = p.getString("name"), at = LatLng(p.getDouble("lat"), p.getDouble("lng")),
                    indoor = p.optBoolean("indoor"), dwellP80Min = p.optInt("dwellP80Min", 60), kidFit = p.optDouble("kidFit", 0.7),
                    openMin = p.optInt("openMin", 9 * 60), closeMin = p.optInt("closeMin", 18 * 60),
                    popular = p.optInt("popular"), stampable = p.optBoolean("stampable"),
                    radiusM = p.optInt("radiusM", 300),
                    points = parsePoints(p.optJSONArray("points")),
                    festival = parseFestival(p),
                    // 동행별 적합도·분위기 표시·어른 머무름 (옛 서버엔 없음 → 기본값)
                    fit = p.optJSONObject("fit")?.let { f ->
                        GoWith.entries.filter { !it.kids && f.has(it.key) }.associate { it to f.optDouble(it.key) }.filterValues { !it.isNaN() }
                    }.orEmpty(),
                    tags = p.optJSONArray("tags")?.let { a -> List(a.length()) { a.optString(it) }.filter { it.isNotEmpty() }.toSet() }.orEmpty(),
                    adultDwellMin = if (p.isNull("adultDwellMin")) null else p.optInt("adultDwellMin", 0).takeIf { it > 0 },
                    // 쉬는 요일(0=일)·임시 휴무 날짜 (옛 서버엔 없음 → 쉬는 날 모름). 엔진 forDay가 그날 쉬는 곳을 뺀다
                    closedDays = p.optJSONArray("closedDays")?.let { a -> List(a.length()) { a.optInt(it, -1) }.filter { it in 0..6 }.toSet() }.orEmpty(),
                    closedDates = p.optJSONArray("closedDates")?.let { a -> List(a.length()) { a.optString(it) }.filter { it.length == 10 }.toSet() }.orEmpty(),
                    // 운영 시간 줄 (요일·공휴일·계절별, 옛 서버엔 없음 → openMin·closeMin 하나). 엔진 forDay가 그날 맞는 줄의 시각을 쓴다
                    hours = parseOpenHours(p.optJSONArray("openHours")),
                    // 저녁 나들이 칸 (옛 서버엔 없음 → 예전 태그 '야경'만으로 밤 명소)
                    kind = p.optString("kind").takeIf { it.isNotEmpty() && !p.isNull("kind") } ?: "spot",
                    route = parseRoute(p.optJSONObject("route")),
                    moments = parseMoments(p.optJSONObject("moments")),
                    fitEvening = p.optJSONObject("fitEvening")?.let { f ->
                        GoWith.entries.filter { f.has(it.key) }.associate { it to f.optDouble(it.key) }.filterValues { !it.isNaN() && it in 0.0..1.0 }
                    }.orEmpty(),
                )
            }
        }

        /** 시간 특성 {best, light: {on, off}, shows: [{name, times: ['HH:MM'], days, months}]} → 엔진 Moments (이상한 쇼는 버림). */
        fun parseMoments(o: JSONObject?): Moments? {
            if (o == null) return null
            val best = o.optJSONArray("best")?.let { a -> List(a.length()) { a.optString(it) }.filter { it in setOf("day", "sunset", "night") }.toSet() }.orEmpty()
            val on = o.optJSONObject("light")?.let { l -> l.optString("on").takeIf { !l.isNull("on") && it.isNotEmpty() } }
            val hm = Regex("""\d{1,2}:\d{2}""")
            val shows = o.optJSONArray("shows")?.let { a ->
                List(a.length()) { a.optJSONObject(it) }.mapNotNull { sh ->
                    if (sh == null) return@mapNotNull null
                    val times = sh.optJSONArray("times")?.let { t -> List(t.length()) { t.optString(it) }.filter { hm.matches(it) }.map(::hhmm).sorted() }.orEmpty()
                    if (times.isEmpty()) return@mapNotNull null
                    Show(
                        sh.optString("name"), times,
                        sh.optJSONArray("days")?.let { d -> List(d.length()) { d.optInt(it, -1) }.filter { it in 0..6 }.toSet() }.orEmpty(),
                        sh.optJSONArray("months")?.let { d -> List(d.length()) { d.optInt(it, -1) }.filter { it in 1..12 }.toSet() }.orEmpty(),
                    )
                }
            }.orEmpty()
            if (best.isEmpty() && on == null && shows.isEmpty()) return null
            return Moments(best, on, shows)
        }

        /** 드라이브 길 {points: [{lat, lng, name}], pass_min} → 엔진 DriveRoute (점 2개 미만이면 null). */
        fun parseRoute(o: JSONObject?): DriveRoute? {
            val arr = o?.optJSONArray("points") ?: return null
            val pts = List(arr.length()) { arr.optJSONObject(it) }.mapNotNull { pt ->
                if (pt == null || !pt.has("lat") || !pt.has("lng")) null else LatLng(pt.getDouble("lat"), pt.getDouble("lng"))
            }
            val pass = o.optInt("pass_min", 0)
            return if (pts.size >= 2 && pass in 5..240) DriveRoute(pts, pass) else null
        }

        /** 운영 시간 줄 [{days, holiday, openMin, closeMin, lastEntryMin, validFrom, validTo, …}] → 엔진 OpenHours (이상한 줄은 버림). */
        fun parseOpenHours(arr: JSONArray?): List<OpenHours> {
            if (arr == null) return emptyList()
            val md = Regex("""\d{2}-\d{2}""")
            return List(arr.length()) { arr.optJSONObject(it) }.mapNotNull { o ->
                if (o == null || !o.has("openMin") || !o.has("closeMin")) return@mapNotNull null
                val open = o.optInt("openMin", -1); val close = o.optInt("closeMin", -1)
                if (open < 0 || close <= open || close > 2160) return@mapNotNull null
                val days = o.optJSONArray("days")?.let { a -> List(a.length()) { a.optInt(it, -1) }.filter { it in 0..6 }.toSet() }.orEmpty()
                val from = o.optString("validFrom").takeIf { !o.isNull("validFrom") && md.matches(it) }
                val to = o.optString("validTo").takeIf { !o.isNull("validTo") && md.matches(it) }
                OpenHours(
                    days = days, holiday = o.optBoolean("holiday"), openMin = open, closeMin = close,
                    lastEntryMin = if (o.isNull("lastEntryMin")) null else o.optInt("lastEntryMin", -1).takeIf { it in (open + 1)..close },
                    validFrom = from?.takeIf { to != null }, validTo = to?.takeIf { from != null },
                    // 식당 브레이크·마지막 주문 (옛 서버엔 없음)
                    breaks = o.optJSONArray("breaks")?.let { a ->
                        List(a.length()) { a.optJSONObject(it) }.mapNotNull { b ->
                            val f = b?.optInt("fromMin", -1) ?: -1; val t = b?.optInt("toMin", -1) ?: -1
                            if (f >= open && t > f && t <= close) BreakRange(f, t) else null
                        }
                    }.orEmpty(),
                    lastOrderMin = if (!o.has("lastOrderMin") || o.isNull("lastOrderMin")) null else o.optInt("lastOrderMin", -1).takeIf { it in (open + 1)..close },
                )
            }
        }

        /**
         * 축제 칸 (서버 /api/car/places의 festivalId·startDate·endDate·weight·attachedPlaceId·closedDays·season) → 엔진 FestivalInfo.
         * 이름·해·계절은 도장북·메달용으로 [FestivalMeta]에 적어 둔다.
         */
        fun parseFestival(p: JSONObject): FestivalInfo? {
            val id = p.optString("festivalId").takeIf { it.isNotEmpty() } ?: return null
            val starts = p.optString("startDate"); val ends = p.optString("endDate")
            if (starts.isEmpty() || ends.isEmpty()) return null
            val days = p.optJSONArray("closedDays")
            FestivalMeta.put(id, p.optString("name"), p.optString("season"), p.optString("attachedPlaceId").takeIf { it.isNotEmpty() && !p.isNull("attachedPlaceId") }, starts, ends)
            return FestivalInfo(
                id = id, starts = starts, ends = ends, weight = p.optDouble("weight", FestivalInfo.WEIGHT_NORMAL),
                placeId = if (p.isNull("attachedPlaceId")) null else p.optString("attachedPlaceId").takeIf { it.isNotEmpty() },
                closedDays = if (days == null) emptyList() else List(days.length()) { days.optInt(it) },
            )
        }

        /** 도착 지점 [{lat, lng, r, name}] → 엔진 Arrival (없거나 이상하면 빈 목록 = 대표 좌표 + 반경). */
        fun parsePoints(arr: JSONArray?): List<Arrival> {
            if (arr == null) return emptyList()
            return List(arr.length()) { arr.optJSONObject(it) }.mapNotNull { o ->
                if (o == null || !o.has("lat") || !o.has("lng")) return@mapNotNull null
                Arrival(LatLng(o.getDouble("lat"), o.getDouble("lng")), o.optInt("r", 300).coerceIn(50, 1500), o.optString("name"))
            }
        }

        /** 장소 목록의 stamp {url, bwUrl, version} → id별 판. */
        fun parseStampRefs(o: JSONObject): Map<String, RemoteStamps.Ref> {
            val arr = o.optJSONArray("places") ?: return emptyMap()
            return List(arr.length()) { arr.getJSONObject(it) }.associate { p ->
                val s = p.optJSONObject("stamp")
                p.getString("id") to RemoteStamps.Ref(s?.takeUnless { it.isNull("url") }?.optString("url"), s?.optInt("version") ?: 0)
            }
        }

        /** /api/plan 응답 → 엔진 Plan. 하늘 시각은 "HH:MM" 글자로 온다. */
        fun parsePlan(o: JSONObject, catalog: (String) -> Place?): TodayPlan {
            val p = o.getJSONObject("plan")
            val skyJ = o.optJSONObject("sky")
            fun t(j: JSONObject, k: String): Int? = j.optString(k).takeIf { !j.isNull(k) && it.matches(Regex("\\d{1,2}:\\d{2}")) }?.let(::hhmm)
            val sky = skyJ?.let {
                SkyToday(
                    sunriseMin = t(it, "sunrise"), sunsetMin = t(it, "sunset"),
                    sky = runCatching { Sky.valueOf(it.optString("sky", "UNKNOWN")) }.getOrDefault(Sky.UNKNOWN),
                    rainFromMin = t(it, "rainFrom"),
                    // 미세먼지 {level, pm10, pm25, station, source} (예전 서버 답엔 없음)
                    air = it.optJSONObject("air")?.let { a -> CourseJson.airOf(a, "level") },
                    pm10 = it.optJSONObject("air")?.let { a -> if (a.isNull("pm10") || !a.has("pm10")) null else a.optInt("pm10") },
                    pm25 = it.optJSONObject("air")?.let { a -> if (a.isNull("pm25") || !a.has("pm25")) null else a.optInt("pm25") },
                    tempC = if (!it.has("temp") || it.isNull("temp")) null else it.optInt("temp"),
                )
            }
            val opts = p.getJSONArray("options")
            val options = List(opts.length()) { i ->
                val j = opts.getJSONObject(i)
                val stopsJ = j.getJSONArray("stops")
                val stops = List(stopsJ.length()) { k ->
                    val s = stopsJ.getJSONObject(k)
                    val id = s.getString("id")
                    // 목록에 없는 곳: 바깥 장소(ext:…)는 머무름·운영 시각까지 실린 ext 칸으로, 그 밖은 이름·좌표만
                    catalog(id) ?: (if (CourseJson.isExt(id)) CourseJson.placeFromJson(id, s) else null)
                        ?: Place(id, s.getString("name"), LatLng(s.getDouble("lat"), s.getDouble("lng")),
                            indoor = s.optBoolean("indoor"), stampable = s.optBoolean("stampable"))
                }
                val legsJ = j.optJSONArray("legs") ?: JSONArray()
                val legs = List(legsJ.length()) { k ->
                    val l = legsJ.getJSONObject(k)
                    Leg(CourseJson.legKindOf(l), l.getInt("fromMin"), l.getInt("toMin"),
                        l.optString("placeId").takeIf { !l.isNull("placeId") && it.isNotEmpty() })
                }
                val rJ = j.optJSONArray("reasons") ?: JSONArray()
                val reasons = List(rJ.length()) { k ->
                    val r = rJ.getJSONObject(k)
                    Reason(r.getString("text"), runCatching { Tone.valueOf(r.optString("tone")) }.getOrDefault(Tone.PLAIN))
                }
                PlanOption(
                    kind = OptionKind.valueOf(j.getString("kind")), stops = stops, firstLegMin = j.getInt("firstLegMin"),
                    detourMin = if (j.isNull("detourMin")) null else j.optInt("detourMin"),
                    arriveHomeMin = j.getInt("arriveHomeMin"), legs = legs, reasons = reasons, label = j.optString("label"),
                )
            }
            val chosen = if (o.isNull("chosen")) null else o.optInt("chosen")
            val chosenBy = if (o.isNull("chosenBy")) null else o.optString("chosenBy")
            val plan = Plan(
                mode = PlanMode.valueOf(p.getString("mode")), nowMin = p.getInt("nowMin"), budgetMin = p.getInt("budgetMin"),
                backByMin = p.getInt("backByMin"), options = options, sky = sky, chosen = chosen, chosenBy = chosenBy,
                // 저녁 나들이 계획 (옛 서버엔 없음 → 카드 제목으로 어림)
                evening = o.optBoolean("evening", options.any { it.label.startsWith(Planner.EVENING_PREFIX) }),
            )
            val companion = o.optString("companion").takeIf { !o.isNull("companion") && it.isNotEmpty() }?.let { GoWith.of(it) }
            return TodayPlan(o.getString("planId"), plan, chosen, chosenBy, companion, o.optBoolean("tomorrowHint", false))
        }
    }
}
