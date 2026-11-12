package kr.milestamp.phone.auto

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONObject
import java.io.File

/** 차로 보낼 준비가 끝난 메달: 정보 + 합성 그림(차 크기) + 작은 도장 그림(알림·옛 호스트 메시지용) */
class ReadyMedal(val info: MedalInfo, val image: Bitmap?, val icon: Bitmap?)

/** 서버 답·도장 목록·명소 목록·코스 → [MedalInfo] (안드로이드 그림과 무관 — 시험하기 쉽게) */
object MedalFacts {
    /**
     * [reply]는 POST /api/phone/arrive 답 (못 받았으면 null — 그러면 [stamps]에 이번 도장이 아직 없다).
     * [stamps]는 GET /api/phone/stamps (찍은 뒤), [course]는 '도착'을 알린 뒤의 살아 있는 코스.
     */
    fun build(
        placeId: String,
        name: String,
        catalog: List<CatalogEntry>,
        reply: JSONObject?,
        stamps: List<StampRow>?,
        course: AutoCourse?,
        quiet: Boolean,
        source: String,
        total: Int,
    ): MedalInfo {
        val p = reply?.optJSONObject("payload")
        val entry = catalog.firstOrNull { it.id == placeId }
        val rows = stamps.orEmpty()
        val includesNew = reply != null && stamps != null
        val mine = rows.filter { it.placeId == placeId }
        // 몇 번째 방문: 서버 답(payload.visit — 이번 도장 포함)이 있으면 그것, 없으면 도장 목록으로 어림
        val visit = (p?.optIntOrNull("visit") ?: (mine.size + if (includesNew) 0 else 1)).coerceAtLeast(1)
        val placesGot = rows.map { it.placeId }.toSet().let { if (includesNew) it else it + placeId }
        val inAlbum = catalog.filter { it.inAlbum }.associateBy { it.id }
        val got = (if (stamps == null) p?.optIntOrNull("number") ?: 1 else placesGot.count { it in inAlbum || it.startsWith("fest-") || inAlbum.isEmpty() })
            .coerceAtLeast(1)
        val first = mine.minByOrNull { it.createdAt }
        val rare = p?.optStr("rare")
        val festival = entry?.festival != null || p?.optStr("festivalId") != null || placeId.startsWith("fest-")
        val grp = entry?.grp
        val groupTotal = if (grp != null && !festival) catalog.count { it.inAlbum && it.grp == grp }.takeIf { it > 0 } else null
        val groupGot = if (groupTotal != null) placesGot.count { inAlbum[it]?.grp == grp } else null
        val next = course?.next
        return MedalInfo(
            key = if (rare != null && placeId == "thearc") "thearc_rain" else placeId,
            placeId = placeId,
            name = p?.optStr("festivalName") ?: name,
            number = p?.optIntOrNull("number") ?: (if (visit > 1) first?.number else null),
            got = got,
            total = total,
            rare = rare,
            festival = festival,
            festivalSeason = p?.optStr("season") ?: entry?.festival?.season,
            festivalUntil = entry?.festival?.until,
            visit = visit,
            firstDay = first?.createdAt?.let(::monthDay),
            groupTitle = entry?.grpTitle,
            groupGot = groupGot,
            groupTotal = groupTotal,
            quiet = quiet || p?.optBoolean("silent") == true,
            phoneVerified = source == "phone",
            nextName = next?.let { n -> catalog.firstOrNull { it.id == n.placeId }?.name ?: n.placeId },
            departMin = if (next != null) course?.here?.plannedDepartMin else null,
            homeMin = course?.arriveHomeMin,
            homeName = course?.endName ?: "집",
        )
    }

    /** '2026-10-12T03:00:00Z' → '10/12' */
    fun monthDay(iso: String): String? = Regex("^\\d{4}-(\\d{2})-(\\d{2})").find(iso)?.let { "${it.groupValues[1].toInt()}/${it.groupValues[2].toInt()}" }

    private fun JSONObject.optStr(k: String): String? = if (isNull(k)) null else optString(k).takeIf { it.isNotEmpty() }
    private fun JSONObject.optIntOrNull(k: String): Int? = if (has(k) && !isNull(k)) optInt(k) else null
}

/**
 * 메달 동전에 넣을 도장 그림 (모듈 안에는 앱 그림 묶음이 없어 서버에서 받아 filesDir에 둔다):
 *  ① 명소 목록의 R2 주소 → ② 서버 정적 그림 {server}/stamps/{key}.webp (축제면 붙은 명소 그림) → ③ 없으면 null(기본 그림)
 */
object MedalArt {
    fun load(dir: File, server: String, key: String, entry: CatalogEntry?, download: (String, File) -> Boolean, maxPx: Int = 512): Bitmap? {
        val cands = buildList {
            entry?.takeIf { it.id == key && it.stampUrl != null }?.let { e -> add("${key}_v${e.stampVersion}" to e.stampUrl!!) }
            add(key to "$server/stamps/$key.webp")
            entry?.festival?.placeId?.let { add(it to "$server/stamps/$it.webp") }
        }
        for ((name, url) in cands) {
            val f = File(dir, "$name.webp")
            if (!f.exists() && !download(url, f)) continue
            decode(f, maxPx)?.let { return it }
            f.delete()
        }
        return null
    }

    fun decode(f: File, maxPx: Int): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, o)
        var sample = 1
        while (o.outWidth / (sample * 2) >= maxPx) sample *= 2
        return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}
