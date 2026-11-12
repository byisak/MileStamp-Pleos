package kr.milestamp.car.net

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * 찍은 도장 한 번. [atMs]는 찍은 때(epoch ms, 모르면 null). [local] = 차가 찍었지만 아직 서버에서 못 본 것.
 * [number]는 서버가 정한 No.(서버가 기준), [carNumber]는 차가 보냈던 No.가 서버 것과 달랐을 때만.
 */
data class StampRow(
    val placeId: String, val number: Int?, val rare: String?, val atMs: Long?, val local: Boolean = false, val carNumber: Int? = null,
    /** 축제 한정 도장이면 축제 id·이름·해·계절 (payload festivalId·festivalName·season). [placeId]도 축제 id. */
    val festivalId: String? = null, val festivalName: String? = null, val season: String? = null,
) {
    /** 차가 이 장소에 [n]번으로 찍은 그 도장인지 (서버가 번호를 바꿨어도 알아본다). */
    fun same(placeId: String, n: Int?): Boolean = this.placeId == placeId && (number == n || (carNumber != null && carNumber == n))

    /** 도장북 칸: 비 오는 날 디아크는 따로 (디아크 칸도 같이 채운다 — [StampAlbum.keysOf]). */
    val key: String get() = kr.milestamp.car.ui.StampAlbum.keyOf(placeId, rare)
}

/**
 * 차 도장북 자료. 서버(`GET /api/car/stamps`)에서 받은 것을 파일로 저장해 두고(인터넷이 없을 때 그대로 보여 줌),
 * 차가 찍었는데 서버에 아직 없는 도장(통신 실패 등)은 따로 적어 두었다가 합쳐 보여 준다.
 * 서버에 같은 장소·같은 No.가 보이면 차 쪽 기록은 지운다.
 */
object StampStore {
    private val _rows = MutableStateFlow<List<StampRow>>(emptyList())
    /** 서버 + 아직 안 올라간 차 기록 (오래된 순). */
    val rows: StateFlow<List<StampRow>> = _rows.asStateFlow()

    private val _offline = MutableStateFlow(false)
    /** 마지막 불러오기가 실패해 저장본을 보이는 중. */
    val offline: StateFlow<Boolean> = _offline.asStateFlow()

    private val lock = Any()
    private var dir: File? = null
    private var server: List<StampRow> = emptyList()
    private var local: List<StampRow> = emptyList()
    /** 서버 목록을 한 번이라도 받은 적이 있는지 (저장본 포함). 없으면 모은 수를 모른다. */
    @Volatile var known: Boolean = false
        private set

    fun init(context: Context) = synchronized(lock) {
        if (dir != null) return
        dir = context.filesDir
        server = read(CACHE)
        known = File(context.filesDir, CACHE).exists()
        local = read(LOCAL).map { it.copy(local = true) }
        publish()
    }

    /** 차가 방금 찍은 도장 (같은 장소·No.는 한 번만). */
    fun recordLocal(placeId: String, number: Int, rare: String?, festival: FestivalMeta.Info? = null) = synchronized(lock) {
        if ((server + local).any { it.same(placeId, number) }) return
        local = local + StampRow(placeId, number, rare, System.currentTimeMillis(), local = true,
            festivalId = festival?.id, festivalName = festival?.name, season = festival?.season)
        write(LOCAL, local)
        publish()
    }

    /** 서버에서 다시 받기. 실패하면 저장본 그대로 두고 false. */
    suspend fun refresh(api: ServerApi): Boolean {
        val arr = api.stamps()
        if (arr == null) { _offline.value = true; return false }
        val fresh = runCatching { parse(arr) }.onFailure { Log.w(TAG, "도장 목록 읽기 실패: ${it.message}") }.getOrNull()
            ?: run { _offline.value = true; return false }
        withContext(Dispatchers.IO) {
            synchronized(lock) {
                server = fresh
                local = local.filterNot { l -> fresh.any { it.same(l.placeId, l.number) } }
                write(CACHE, server); write(LOCAL, local)
                known = true
                publish()
            }
        }
        _offline.value = false
        return true
    }

    private fun publish() { _rows.value = (server + local).sortedBy { it.atMs ?: 0L } }

    private fun read(name: String): List<StampRow> =
        runCatching { parse(JSONArray(File(dir, name).readText())) }.getOrDefault(emptyList())

    private fun write(name: String, rows: List<StampRow>) {
        val arr = JSONArray()
        rows.forEach { r ->
            arr.put(JSONObject().put("place_id", r.placeId).put("created_at", r.atMs?.let { Instant.ofEpochMilli(it).toString() } ?: JSONObject.NULL)
                .put("payload", JSONObject().put("number", r.number ?: JSONObject.NULL).put("rare", r.rare ?: JSONObject.NULL)
                    .put("carNumber", r.carNumber ?: JSONObject.NULL)
                    .put("festivalId", r.festivalId ?: JSONObject.NULL).put("festivalName", r.festivalName ?: JSONObject.NULL)
                    .put("season", r.season ?: JSONObject.NULL)))
        }
        runCatching { File(dir, name).writeText(arr.toString()) }.onFailure { Log.w(TAG, "도장 저장 실패: ${it.message}") }
    }

    /**
     * 오늘 이전까지 모은 도장 수 (서버 + 아직 안 올라간 차 기록). 지금 엔진 하루([dayStartMs] 이후)에 찍은
     * [todayIds] 장소의 도장은 뺀다 — 엔진이 '오늘 순서'로 더하니까. 서비스가 하루 중간에 다시 켜졌으면 그 전 도장은 센다.
     */
    /** 올해([year]) 한정 도장을 받은 축제 id — 엔진 [kr.milestamp.engine.TripEngine.setFestivalStamps]. */
    fun festivalIdsIn(rows: List<StampRow>, year: Int): Set<String> = rows.mapNotNull { r ->
        r.festivalId?.takeIf { r.atMs == null || Instant.ofEpochMilli(r.atMs).atZone(java.time.ZoneId.of("Asia/Seoul")).year == year }
    }.toSet()

    fun countBefore(rows: List<StampRow>, dayStartMs: Long, todayIds: Collection<String>): Int =
        rows.count { r -> !(r.placeId in todayIds && (r.atMs ?: 0L) >= dayStartMs) }

    /** 서버 행 모양 그대로: { place_id, payload: { number, rare, silent, carNumber? }, created_at } */
    fun parse(arr: JSONArray): List<StampRow> = List(arr.length()) { i ->
        val o = arr.getJSONObject(i)
        val p = o.optJSONObject("payload") ?: JSONObject()
        StampRow(
            placeId = o.getString("place_id"),
            number = if (p.isNull("number")) null else p.optInt("number").takeIf { p.has("number") },
            // 차는 희귀 이름("비 오는 날"), 예전 시험 행은 true로 왔다
            rare = when (val r = p.opt("rare")) { is String -> r.takeIf { it.isNotEmpty() }; true -> "비 오는 날"; else -> null },
            carNumber = if (p.isNull("carNumber") || !p.has("carNumber")) null else p.optInt("carNumber"),
            atMs = if (o.isNull("created_at")) null else runCatching { Instant.parse(o.getString("created_at")).toEpochMilli() }.getOrNull(),
            festivalId = p.optString("festivalId").takeIf { it.isNotEmpty() && !p.isNull("festivalId") },
            festivalName = p.optString("festivalName").takeIf { it.isNotEmpty() && !p.isNull("festivalName") },
            season = p.optString("season").takeIf { it.isNotEmpty() && !p.isNull("season") },
        )
    }

    private const val TAG = "MileStampBook"
    private const val CACHE = "stamps.json"
    private const val LOCAL = "stamps_local.json"
}
