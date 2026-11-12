package kr.milestamp.car.net

import java.util.concurrent.ConcurrentHashMap

/**
 * 축제 이름·해·계절·붙은 명소 (서버 장소 목록의 축제 칸에서). 엔진 FestivalInfo엔 없는, 화면용 글만.
 * 지난 축제는 도장 행 payload(festivalName·season)로 그린다.
 */
object FestivalMeta {
    data class Info(val id: String, val name: String, val season: String, val placeId: String?, val starts: String, val ends: String)

    private val map = ConcurrentHashMap<String, Info>()

    fun put(id: String, name: String, season: String, placeId: String?, starts: String, ends: String) {
        map[id] = Info(id, name, season, placeId, starts, ends)
    }

    fun get(id: String): Info? = map[id]

    fun all(): List<Info> = map.values.sortedBy { it.starts }

    /** '11/9' */
    fun md(day: String): String = day.split("-").let { if (it.size == 3) "${it[1].toInt()}/${it[2].toInt()}" else day }
}
