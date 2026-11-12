package kr.milestamp.car.net

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Log
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * 관리자 화면에서 올린 도장 그림 (서버 /api/car/places 의 stamp {url, version}).
 * 바뀐 것만 받아 `files/stamps/<id>_<ver>.webp`로 저장하고, 있으면 차에 넣어 둔 그림(drawable) 대신 쓴다.
 * 못 받으면 저장해 둔 것, 그것도 없으면 차에 든 그림 — 도장 화면은 그림 때문에 멈추지 않는다.
 */
object RemoteStamps {
    data class Ref(val url: String?, val version: Int)

    private var dir: File? = null
    private val files = ConcurrentHashMap<String, File>()
    private val cache = LruCache<String, ImageBitmap>(48)
    private val _version = MutableStateFlow(0)
    /** 받은 그림이 바뀔 때마다 +1 (화면이 다시 그리게). */
    val version: StateFlow<Int> = _version.asStateFlow()

    private val NAME = Regex("""^([a-z0-9_]+)_(\d+)\.webp$""")

    fun init(context: Context) {
        if (dir != null) return
        val d = File(context.filesDir, "stamps").apply { mkdirs() }
        dir = d
        // 장소마다 가장 높은 판 하나
        d.listFiles().orEmpty().mapNotNull { f -> NAME.matchEntire(f.name)?.let { Triple(it.groupValues[1], it.groupValues[2].toInt(), f) } }
            .groupBy { it.first }
            .forEach { (id, xs) -> files[id] = xs.maxBy { it.second }.third }
    }

    /** 받아 둔 서버 그림 (없으면 null → 차에 든 그림). */
    fun file(placeId: String): File? = files[placeId]?.takeIf { it.exists() }

    fun bitmap(f: File): ImageBitmap? {
        cache.get(f.path)?.let { return it }
        return runCatching { BitmapFactory.decodeFile(f.path)?.asImageBitmap() }.getOrNull()?.also { cache.put(f.path, it) }
    }

    /** 서버 목록의 도장 판과 맞춘다: 새 판은 받고, 지난 판·서버에서 지운 그림은 지운다. */
    suspend fun sync(api: ServerApi, refs: Map<String, Ref>) {
        val d = dir ?: return
        var changed = false
        for ((id, ref) in refs) {
            if (!NAME.matches("${id}_0.webp")) continue
            val have = files[id]
            if (ref.url == null || ref.version <= 0) {
                if (have != null) { files.remove(id); withContext(Dispatchers.IO) { purge(d, id, keep = null) }; changed = true }
                continue
            }
            val target = File(d, "${id}_${ref.version}.webp")
            if (have == target && target.exists()) continue
            val ok = target.exists() || api.download(ref.url, target)
            if (ok) {
                files[id] = target
                withContext(Dispatchers.IO) { purge(d, id, keep = target) }
                changed = true
                Log.i(TAG, "도장 그림 받음 $id v${ref.version}")
            }
        }
        if (changed) _version.value += 1
    }

    private fun purge(d: File, id: String, keep: File?) {
        d.listFiles().orEmpty().filter { f -> NAME.matchEntire(f.name)?.groupValues?.get(1) == id && f != keep }.forEach { it.delete() }
    }

    private const val TAG = "MileStampStamps"
}
