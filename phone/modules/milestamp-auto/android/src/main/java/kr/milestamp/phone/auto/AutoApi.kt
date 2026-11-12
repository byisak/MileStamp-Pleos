package kr.milestamp.phone.auto

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * 안드로이드 오토 쪽 저장소: 서버 주소·폰 토큰(폰 앱 JS가 SecureStore에서 꺼내 [MilestampAutoModule.setConfig]로 넘김),
 * 오늘 찍은 곳, 서버에 못 보낸 도장 시도. 앱 전용 저장소(MODE_PRIVATE)라 다른 앱은 못 읽는다.
 */
/** 오늘 날짜 "2026-10-27" (java.time은 API 26부터라 minSdk 24 앱에서는 쓰지 않는다) */
fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date())

/** 폰 시계 그날 0시부터 분 */
fun nowMinute(): Int = java.util.Calendar.getInstance().let { it.get(java.util.Calendar.HOUR_OF_DAY) * 60 + it.get(java.util.Calendar.MINUTE) }

/** 지금 시각 ISO (UTC) */
fun isoNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

class AutoConfig(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("milestamp_auto", Context.MODE_PRIVATE)

    val server: String get() = prefs.getString("server", null) ?: DEFAULT_SERVER
    val token: String? get() = prefs.getString("token", null)

    fun set(server: String?, token: String?) {
        prefs.edit().putString("server", server?.trimEnd('/')?.ifEmpty { null } ?: DEFAULT_SERVER).apply {
            if (token.isNullOrEmpty()) remove("token") else putString("token", token)
        }.apply()
    }

    /** 쉿 모드 고름 (폰 '우리 차' 탭: 자동(낮잠 시간) / 켜기 / 끄기). 기본 자동 */
    var quietMode: QuietMode
        get() = QuietMode.of(prefs.getString("quietMode", null))
        set(v) { prefs.edit().putString("quietMode", v.key).apply() }

    /** 시간 표시 (폰 '우리 차' 탭): true = 12시간(오후 9:54, 기본) · false = 24시간 */
    var hour12: Boolean
        get() = prefs.getString("timeFmt", null) != "24"
        set(v) { prefs.edit().putString("timeFmt", if (v) "12" else "24").apply(); AutoJson.hour12 = v }

    /** 가족 낮잠 (분). null = 낮잠 없음 또는 아직 모름 */
    val napStart: Int? get() = prefs.getInt("napStart", -1).takeIf { it >= 0 }
    val napLen: Int? get() = prefs.getInt("napLen", -1).takeIf { it > 0 }

    fun setNap(start: Int?, len: Int?) {
        prefs.edit().apply {
            if (start != null && len != null && start in 0 until 24 * 60 && len > 0) putInt("napStart", start).putInt("napLen", len)
            else remove("napStart").remove("napLen")
        }.apply()
    }

    /** 지금 쉿인지 — 읽을 때마다 폰 시계로 다시 계산 (도장마다·연결될 때마다 새로) */
    val quiet: Boolean get() = QuietRule.quiet(quietMode, napStart, napLen, nowMinute())

    private fun todayKey() = "stamped:" + today()

    fun stampedToday(placeId: String): Boolean = prefs.getStringSet(todayKey(), emptySet())!!.contains(placeId)
    fun markStamped(placeId: String) {
        val s = prefs.getStringSet(todayKey(), emptySet())!!.toMutableSet().apply { add(placeId) }
        prefs.edit().putStringSet(todayKey(), s).apply()
    }

    /** 서버에 아직 못 보낸 도장 시도 (POST /api/phone/arrive 가 없거나 통신 실패) */
    fun pending(): JSONArray = runCatching { JSONArray(prefs.getString("pending", "[]")) }.getOrDefault(JSONArray())
    fun addPending(body: JSONObject) {
        val a = pending().put(body)
        while (a.length() > 30) a.remove(0)
        prefs.edit().putString("pending", a.toString()).apply()
    }
    fun setPending(a: JSONArray) = prefs.edit().putString("pending", a.toString()).apply()

    companion object {
        const val DEFAULT_SERVER = "https://milestamp.vercel.app"
    }
}

/**
 * 폰 API (폰 토큰 Bearer). 폰 앱과 같은 길:
 *  GET /api/plan · POST /api/plan/choose · GET/PATCH /api/plan/course · POST /api/plan/course/adopt
 *  GET /api/phone/stamps · GET /api/catalog(공개) · POST /api/phone/arrive(아직 서버에 없음 — 보고서 참고)
 * 모두 막히는(blocking) 호출 — 부르는 쪽이 일꾼 스레드에서.
 */
class AutoApi(context: Context, private val cfg: AutoConfig = AutoConfig(context)) {
    private val catalogFile = File(context.applicationContext.filesDir, "auto-catalog.json")

    /** HTTP 답 (통신 자체가 안 되면 code 0) */
    data class Reply(val code: Int, val json: JSONObject?) {
        val ok get() = code in 200..299 && json != null
    }

    val hasToken get() = !cfg.token.isNullOrEmpty()

    fun plan(lat: Double?, lng: Double?): AutoPlan? {
        val q = if (lat != null && lng != null) "?lat=%.4f&lng=%.4f".format(java.util.Locale.ROOT, lat, lng) else ""
        val r = call("GET", "/api/plan$q")
        return if (r.ok) runCatching { AutoJson.plan(r.json!!) }.onFailure { Log.w(TAG, "계획 읽기 실패 ${it.message}") }.getOrNull() else null
    }

    fun choose(planId: String, idx: Int): Boolean =
        call("POST", "/api/plan/choose", JSONObject().put("planId", planId).put("idx", idx)).ok

    fun course(): AutoCourse? = call("GET", "/api/plan/course", timeoutMs = 5_000).let { r -> if (r.ok) AutoJson.courseRes(r.json!!) else null }

    /** 코스 사건 (폰과 같이 driving:false). 409면 null — 다음 GET에서 최신을 받는다 */
    fun courseEvent(version: Int, event: JSONObject): AutoOutcome? {
        val r = call("PATCH", "/api/plan/course", JSONObject().put("version", version).put("event", event.put("driving", false)))
        return if (r.ok) AutoJson.outcome(r.json!!) else null
    }

    fun adopt(version: Int, idx: Int): AutoOutcome? {
        val r = call("POST", "/api/plan/course/adopt", JSONObject().put("version", version).put("optionIdx", idx))
        return if (r.ok) AutoJson.outcome(r.json!!) else null
    }

    /** 가족 낮잠 (쉿 모드 자동용). 못 받으면 아무것도 안 바꿈 */
    fun refreshFamily(): Boolean {
        val r = call("GET", "/api/family", timeoutMs = 5_000)
        if (!r.ok) return false
        val j = r.json!!
        val start = if (j.isNull("napStart")) null else j.optInt("napStart")
        val len = if (j.isNull("napLen")) null else j.optInt("napLen")
        cfg.setNap(start, len)
        return true
    }

    fun stamps(): List<StampRow>? = call("GET", "/api/phone/stamps", timeoutMs = 5_000).let { if (it.ok) AutoJson.stamps(it.json!!) else null }

    /** 명소 목록: 하루 한 번 받고 파일에 둔다 (못 받으면 저장본) */
    fun catalog(): List<CatalogEntry> {
        val cached = runCatching { JSONObject(catalogFile.readText()) }.getOrNull()
        val today = today()
        if (cached != null && cached.optString("day") == today) return AutoJson.catalog(cached)
        val r = call("GET", "/api/catalog", auth = false, timeoutMs = 8_000)
        if (r.ok && r.json!!.optJSONArray("places") != null) {
            r.json.put("day", today)
            runCatching { catalogFile.writeText(r.json.toString()) }
            return AutoJson.catalog(r.json)
        }
        return cached?.let(AutoJson::catalog) ?: emptyList()
    }

    /**
     * 폰에서 확인한 도착 → 도장 (서버가 2차 검증, '폰 인증' 표시). 서버에 길이 없으면(404) 나중에 보내려고 쌓아 둔다.
     * 답: 서버 답 JSON (도장 No.는 payload.number) 또는 null.
     */
    fun arrive(a: AutoTripDetector.Attempt, quiet: Boolean = false): JSONObject? {
        val body = arriveBody(a, quiet)
        val r = call("POST", "/api/phone/arrive", body)
        if (r.ok) return r.json
        Log.w(TAG, "도장 보내기 실패 (${r.code}) — 저장해 두고 다음에")
        cfg.addPending(body)
        return null
    }

    /** 쌓아 둔 도장 시도 다시 보내기 (연결될 때) */
    fun flushPending() {
        val a = cfg.pending()
        if (a.length() == 0) return
        val left = JSONArray()
        for (i in 0 until a.length()) {
            val b = a.getJSONObject(i)
            val r = call("POST", "/api/phone/arrive", b)
            if (!r.ok && r.code != 409 && r.code != 422) left.put(b) // 409·422 = 서버가 판정함(중복·보류) → 버림
            if (r.code == 404) { for (j in i + 1 until a.length()) left.put(a.getJSONObject(j)); break }
        }
        cfg.setPending(left)
    }

    fun call(method: String, path: String, body: JSONObject? = null, auth: Boolean = true, timeoutMs: Int = 8_000): Reply {
        val token = cfg.token
        if (auth && token.isNullOrEmpty()) return Reply(401, null)
        return runCatching {
            val c = URL(cfg.server + path).openConnection() as HttpURLConnection
            if (method == "PATCH") {
                // 안드로이드 HttpURLConnection은 PATCH를 못 보냄 → 차 앱과 같이 POST + 덮어쓰기 머리말
                runCatching { c.requestMethod = "PATCH" }.onFailure {
                    c.requestMethod = "POST"
                    c.setRequestProperty("X-HTTP-Method-Override", "PATCH")
                }
            } else c.requestMethod = method
            c.connectTimeout = minOf(5_000, timeoutMs)
            c.readTimeout = timeoutMs
            c.setRequestProperty("Content-Type", "application/json")
            if (auth) c.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                c.doOutput = true
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            c.disconnect()
            Reply(code, runCatching { JSONObject(text) }.getOrNull())
        }.onFailure { Log.w(TAG, "통신 실패 $method $path ${it.message}") }.getOrDefault(Reply(0, null))
    }

    /** 그림 받기 (공개 주소). 반쯤 받은 파일은 남기지 않는다 */
    fun download(url: String, dst: File): Boolean {
        val tmp = File(dst.parentFile, dst.name + ".part")
        return runCatching {
            dst.parentFile?.mkdirs()
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 4_000; c.readTimeout = 10_000
            if (c.responseCode !in 200..299) { c.disconnect(); error("HTTP ${c.responseCode}") }
            c.inputStream.use { i -> tmp.outputStream().use { i.copyTo(it) } }
            c.disconnect()
            if (tmp.length() < 100 || !tmp.renameTo(dst)) error("파일이 이상함")
            true
        }.onFailure { tmp.delete() }.getOrDefault(false)
    }

    companion object {
        private const val TAG = "MilestampAuto"

        /** POST /api/phone/arrive 몸체 (좌표는 보내지 않는다 — 장소 ID와 숫자만, 차 앱과 같은 원칙) */
        /** [quiet] = 쉿 모드로 찍음 → 서버 payload.silent (가족 폰도 안 울림) */
        fun arriveBody(a: AutoTripDetector.Attempt, quiet: Boolean = false): JSONObject = JSONObject()
            .put("placeId", a.place.id)
            .put("odoKm", a.odoKm ?: JSONObject.NULL)
            .put("gpsPathKm", "%.2f".format(java.util.Locale.ROOT, a.gpsPathKm).toDouble())
            .put("straightKm", "%.2f".format(java.util.Locale.ROOT, a.straightKm).toDouble())
            .put("source", a.source)
            .put("reason", a.reason)
            .put("verdict", if (a.granted) "granted" else "held")
            .put("fromPlaceId", a.fromPlaceId ?: JSONObject.NULL)
            .put("at", isoNow())
            .put("silent", quiet)
    }
}
