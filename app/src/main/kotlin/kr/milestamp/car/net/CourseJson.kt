package kr.milestamp.car.net

import kr.milestamp.engine.AirLevel
import kr.milestamp.engine.Change
import kr.milestamp.engine.ChangeSize
import kr.milestamp.engine.CourseEnd
import kr.milestamp.engine.CourseEvent
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.Leg
import kr.milestamp.engine.LegKind
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.LiveStop
import kr.milestamp.engine.Meals
import kr.milestamp.engine.Place
import kr.milestamp.car.trip.ProposalDismissWatch
import kr.milestamp.car.trip.ServerProposal
import kr.milestamp.engine.Sky
import kr.milestamp.engine.StopStatus
import kr.milestamp.engine.asHhmm
import kr.milestamp.engine.hhmm
import org.json.JSONArray
import org.json.JSONObject

/**
 * 살아 있는 코스 ↔ JSON (docs/코스-고도화-계획.md 10절의 사건·답 모양).
 *  - 사건 JSON = 서버 `PATCH /api/plan/course` 본문의 `event` = 디버그 `COURSE_EVENT`의 `json`
 *    {"type":"Skip","now":"13:00","place":"dgsm"} … 시각은 "HH:MM", 장소는 id, 덧붙임 "driving"·"here"
 *  - 코스 JSON = 서버 응답·푸시 `course_update`의 `course` (stops의 placeId·status만 있으면 차가 받아들일 수 있다)
 */
object CourseJson {

    /** 사건 → JSON. [now]는 사건의 시각(분). 서버로 보낼 때 [driving]·[here]를 덧붙인다. */
    fun event(e: CourseEvent, driving: Boolean? = null, here: LatLng? = null): JSONObject {
        val o = JSONObject().put("now", e.nowMin.asHhmm())
        when (e) {
            is CourseEvent.Departed -> o.put("type", "Departed").put("from", e.from ?: JSONObject.NULL)
            is CourseEvent.Arrived -> o.put("type", "Arrived").put("place", e.placeId)
            is CourseEvent.StillParked -> o.put("type", "StillParked")
            is CourseEvent.NaviEta -> o.put("type", "NaviEta").put("remainMin", e.remainMin)
            is CourseEvent.StillDriving -> o.put("type", "StillDriving").put("here", JSONArray().put(e.here.lat).put(e.here.lng))
            is CourseEvent.ReplaceNext -> o.put("type", "ReplaceNext").put("place", e.placeId)
            is CourseEvent.Skip -> o.put("type", "Skip").put("place", e.placeId)
            is CourseEvent.Insert -> o.put("type", "Insert").put("place", e.placeId)
            is CourseEvent.Weather -> o.put("type", "Weather").put("sky", e.sky.name).put("rainFrom", e.rainFromMin?.asHhmm() ?: JSONObject.NULL)
                .also { j -> e.air?.let { j.put("air", it.name) } }
            is CourseEvent.PlaceClosed -> o.put("type", "PlaceClosed").put("place", e.placeId)
            is CourseEvent.GoHome -> o.put("type", "GoHome")
            is CourseEvent.LimitChanged -> o.put("type", "LimitChanged").put("limit", e.limitMin.asHhmm())
            is CourseEvent.Remote -> o.put("type", "Remote").put("version", e.version)
                .put("stops", JSONArray(e.course.remaining.map { it.id })).put("by", e.course.chosenBy)
            is CourseEvent.Tick -> o.put("type", "Tick")
            is CourseEvent.SetDwell -> o.put("type", "SetDwell").put("place", e.placeId).put("minutes", e.minutes)
            is CourseEvent.ExtendStay -> o.put("type", "ExtendStay").put("minutes", e.minutes)
            is CourseEvent.SetEnd -> {
                o.put("type", "SetEnd")
                if (e.toHome) o.put("end", "home")
                else e.end?.let { o.put("end", endJson(it)) }
                e.limitMin?.let { o.put("limit", it.asHhmm()) }
                e.napOff?.let { o.put("napOff", it) }
            }
        }
        driving?.let { o.put("driving", it) }
        if (e !is CourseEvent.StillDriving) here?.let { o.put("here", JSONArray().put(it.lat).put(it.lng)) }
        return o
    }

    /** 차 코스 전체를 Remote 사건으로 (오프라인 뒤 다시 맞추기: 남은 순서만 보낸다, by = "차"). */
    fun remoteSync(course: LiveCourse, nowMin: Int): JSONObject = JSONObject()
        .put("type", "Remote").put("now", nowMin.asHhmm()).put("version", course.version)
        .put("stops", JSONArray(course.remaining.map { it.id })).put("by", "차")

    /**
     * JSON → 사건. 시각이 없으면 [defaultNow]. 모르는 종류·장소면 null.
     * Remote는 "stops"(id 목록) 또는 "course"(코스 JSON)에서 코스를 만든다 — 차가 이미 다녀온 곳은 엔진이 차 것을 지킨다.
     */
    fun parseEvent(o: JSONObject, defaultNow: Int, catalog: (String) -> Place?, local: LiveCourse?): CourseEvent? {
        val now = o.optString("now").takeIf { it.matches(Regex("\\d{1,2}:\\d{2}")) }?.let(::hhmm) ?: defaultNow
        fun place() = o.optString("place").takeIf { it.isNotEmpty() }
        return when (o.optString("type")) {
            "Departed" -> CourseEvent.Departed(now, o.optString("from").takeIf { it.isNotEmpty() && !o.isNull("from") })
            "Arrived" -> place()?.let { CourseEvent.Arrived(now, it) }
            "StillParked" -> CourseEvent.StillParked(now)
            "NaviEta" -> CourseEvent.NaviEta(now, o.optInt("remainMin"))
            "StillDriving" -> o.optJSONArray("here")?.takeIf { it.length() == 2 }?.let { CourseEvent.StillDriving(now, LatLng(it.getDouble(0), it.getDouble(1))) }
            "ReplaceNext" -> place()?.let { CourseEvent.ReplaceNext(now, it) }
            "Skip" -> place()?.let { CourseEvent.Skip(now, it) }
            "Insert" -> place()?.let { CourseEvent.Insert(now, it) }
            "Weather" -> CourseEvent.Weather(
                now, runCatching { Sky.valueOf(o.optString("sky", "UNKNOWN")) }.getOrDefault(Sky.UNKNOWN),
                o.optString("rainFrom").takeIf { !o.isNull("rainFrom") && it.matches(Regex("\\d{1,2}:\\d{2}")) }?.let(::hhmm),
                airOf(o, "air"),
            )
            "PlaceClosed" -> place()?.let { CourseEvent.PlaceClosed(now, it) }
            "GoHome" -> CourseEvent.GoHome(now)
            "SetDwell" -> place()?.takeIf { o.has("minutes") }?.let { CourseEvent.SetDwell(now, it, o.optInt("minutes")) }
            "ExtendStay" -> if (o.has("minutes")) CourseEvent.ExtendStay(now, o.optInt("minutes").coerceAtLeast(0)) else null
            "SetEnd" -> CourseEvent.SetEnd(
                now,
                end = o.optJSONObject("end")?.let(::parseEnd),
                toHome = o.optString("end") == "home",
                limitMin = o.optString("limit").takeIf { !o.isNull("limit") && it.matches(Regex("\\d{1,2}:\\d{2}")) }?.let(::hhmm),
                napOff = if (o.has("napOff") && !o.isNull("napOff")) o.optBoolean("napOff") else null,
            )
            "LimitChanged" -> o.optString("limit").takeIf { it.matches(Regex("\\d{1,2}:\\d{2}")) }?.let { CourseEvent.LimitChanged(now, hhmm(it)) }
            "Remote" -> {
                val base = local ?: return null
                val courseJ = o.optJSONObject("course")
                val version = if (o.has("version")) o.optInt("version") else courseJ?.optInt("version") ?: return null
                val by = o.optString("by").takeIf { it.isNotEmpty() } ?: courseJ?.optString("chosenBy")?.takeIf { it.isNotEmpty() } ?: base.chosenBy
                val course = when {
                    courseJ != null -> parseCourse(courseJ, catalog, base) ?: return null
                    o.has("stops") -> {
                        val ids = o.getJSONArray("stops").let { a -> List(a.length()) { a.getString(it) } }
                        // 목록에 없는 바깥 장소(ext:…)는 차 코스에 이미 있던 곳이면 그 장소로
                        val stops = ids.mapNotNull { id ->
                            (catalog(id) ?: base.stops.firstOrNull { it.id == id }?.place)?.let { LiveStop(it, StopStatus.PLANNED, now, now, dwellGuessMin = it.dwellP80Min) }
                        }
                        base.copy(stops = stops)
                    }
                    else -> return null
                }
                CourseEvent.Remote(now, version, course.copy(version = version, chosenBy = by))
            }
            else -> null
        }
    }

    /**
     * 코스 JSON의 곳 하나 → 장소. 목록([catalog])에서 id로 → 차 코스([base])에 있던 곳 → 서버가 실은 이름·좌표로 새로.
     * 마지막은 장소 목록 밖의 바깥 장소('ext:tour:…'·'ext:kto100:…', 내가 고르기 C단계): 도장 없음 · 도착 원 300m ·
     * 머무름·운영 시각·아이 적합은 `ext` 칸(없으면 서버 기본 90분 · 10~18시 · 0.6). 이름·좌표가 없으면 null(그 곳은 뺀다).
     */
    fun stopPlace(s: JSONObject, catalog: (String) -> Place?, base: LiveCourse? = null): Place? {
        val id = s.optString("placeId").ifEmpty { s.optString("id") }.ifEmpty { return null }
        return catalog(id) ?: base?.stops?.firstOrNull { it.id == id }?.place ?: placeFromJson(id, s)
    }

    /** 이름·좌표(+ 선택 `ext` {indoor, dwell, open, close, kidFit})로 만든 도장 없는 장소. 모양이 틀리면 null. */
    fun placeFromJson(id: String, s: JSONObject): Place? {
        val e = s.optJSONObject("ext")
        fun num(k: String): Double? = listOfNotNull(s, e).firstNotNullOfOrNull { o ->
            if (o.has(k) && !o.isNull(k)) o.optDouble(k).takeIf { it.isFinite() } else null
        }
        val name = s.optString("name").trim().ifEmpty { e?.optString("name")?.trim().orEmpty() }.ifEmpty { return null }
        val lat = num("lat")?.takeIf { it in -90.0..90.0 } ?: return null
        val lng = num("lng")?.takeIf { it in -180.0..180.0 } ?: return null
        val dwell = e?.optInt("dwell", EXT_DWELL)?.takeIf { it > 0 } ?: EXT_DWELL
        val open = e?.optInt("open", EXT_OPEN) ?: EXT_OPEN
        val close = e?.optInt("close", EXT_CLOSE) ?: EXT_CLOSE
        // 밥 자리 ('ext:food:<식당 id>', 엔진 Meals): 실내 · 정한 머무름 · 마지막 주문 = lastEntry
        val meal = Meals.isMealId(id)
        return Place(
            id = id, name = name, at = LatLng(lat, lng),
            indoor = meal || (e?.optBoolean("indoor") ?: s.optBoolean("indoor")),
            radiusM = EXT_RADIUS_M,
            dwellP80Min = dwell,
            kidFit = e?.optDouble("kidFit", EXT_KID_FIT)?.takeIf { it.isFinite() } ?: EXT_KID_FIT,
            openMin = open,
            closeMin = close,
            stampable = false,
            lastEntryMin = e?.takeIf { it.has("lastEntry") && !it.isNull("lastEntry") }?.optInt("lastEntry")?.takeIf { it in (open + 1)..close },
            kind = if (meal) Meals.KIND else "spot",
            adultDwellMin = if (meal) dwell else null,
        )
    }

    /** 바깥 장소 기본값 (서버 lib/ext.ts EXT_DEFAULT와 같음). */
    const val EXT_RADIUS_M = 300
    const val EXT_DWELL = 90
    const val EXT_OPEN = 10 * 60
    const val EXT_CLOSE = 18 * 60
    const val EXT_KID_FIT = 0.6

    /** 칸 종류: 서버는 밥 칸을 "STAY" + meal: true 로 싣는다 (옛 차 호환) → MEAL. 모르는 이름은 DRIVE. */
    fun legKindOf(l: JSONObject): LegKind =
        if (l.optBoolean("meal")) LegKind.MEAL else runCatching { LegKind.valueOf(l.getString("kind")) }.getOrDefault(LegKind.DRIVE)

    /** 칸 → JSON (밥 칸은 "STAY" + meal: true). */
    fun legJson(l: Leg): JSONObject = JSONObject()
        .put("kind", if (l.kind == LegKind.MEAL) LegKind.STAY.name else l.kind.name).put("fromMin", l.fromMin).put("toMin", l.toMin)
        .put("placeId", l.placeId ?: JSONObject.NULL)
        .also { if (l.kind == LegKind.MEAL) it.put("meal", true) }

    /** 바깥 장소 id ('ext:tour:…'·'ext:kto100:…') — 도장 대신 '다녀옴'. */
    fun isExt(id: String) = id.startsWith("ext:")

    /**
     * 코스 JSON(서버 응답 `course`) → LiveCourse. 장소는 [stopPlace] (목록 → 차 코스 → 이름·좌표, 셋 다 없으면 뺀다).
     * 시간표 칸이 없으면 [base](차 코스)의 값을 쓴다 — Remote로 넣을 때 엔진은 남은 순서·상태·버전만 본다.
     */
    fun parseCourse(c: JSONObject, catalog: (String) -> Place?, base: LiveCourse? = null): LiveCourse? {
        val stopsJ = c.optJSONArray("stops") ?: return null
        val stops = List(stopsJ.length()) { i -> stopsJ.getJSONObject(i) }.mapNotNull { s ->
            val place = stopPlace(s, catalog, base) ?: return@mapNotNull null
            LiveStop(
                place = place,
                status = runCatching { StopStatus.valueOf(s.optString("status", "PLANNED")) }.getOrDefault(StopStatus.PLANNED),
                plannedArriveMin = s.optInt("plannedArriveMin", base?.nowMin ?: 0),
                plannedDepartMin = s.optInt("plannedDepartMin", base?.nowMin ?: 0),
                actualArriveMin = if (s.isNull("actualArriveMin")) null else s.optInt("actualArriveMin"),
                actualDepartMin = if (s.isNull("actualDepartMin")) null else s.optInt("actualDepartMin"),
                dwellGuessMin = s.optInt("dwellGuessMin", place.dwellP80Min),
                skipReason = if (s.isNull("skipReason")) null else s.optString("skipReason").ifEmpty { null },
                dwellSet = s.optBoolean("dwellSet", false),
            )
        }
        val legsJ = c.optJSONArray("legs") ?: JSONArray()
        val legs = List(legsJ.length()) { i ->
            val l = legsJ.getJSONObject(i)
            Leg(legKindOf(l), l.optInt("fromMin"), l.optInt("toMin"),
                l.optString("placeId").takeIf { !l.isNull("placeId") && it.isNotEmpty() })
        }
        val hereJ = c.optJSONArray("here")
        val change = c.optJSONObject("lastChange")?.let { ch ->
            Change(ch.optString("text"), ch.optString("cause"), ch.optInt("deltaHomeMin"),
                runCatching { ChangeSize.valueOf(ch.optString("size", "SOFT")) }.getOrDefault(ChangeSize.SOFT), ch.optInt("atMin"))
        }
        val warnJ = c.optJSONArray("warnings") ?: JSONArray()
        return LiveCourse(
            id = c.optString("id", base?.id ?: "lc-server"),
            version = c.optInt("version", base?.version ?: 1),
            chosenBy = c.optString("chosenBy").ifEmpty { base?.chosenBy ?: "폰" },
            chosenAtMin = c.optInt("chosenAtMin", base?.chosenAtMin ?: 0),
            stops = stops,
            legs = legs.ifEmpty { base?.legs.orEmpty() },
            nowMin = c.optInt("nowMin", base?.nowMin ?: 0),
            here = if (hereJ != null && hereJ.length() == 2) LatLng(hereJ.getDouble(0), hereJ.getDouble(1)) else base?.here,
            arriveHomeMin = c.optInt("arriveHomeMin", base?.arriveHomeMin ?: 0),
            limitMin = c.optInt("limitMin", base?.limitMin ?: 0),
            napLeg = legs.firstOrNull { it.kind == LegKind.NAP_DRIVE },
            lastChange = change ?: base?.lastChange,
            warnings = List(warnJ.length()) { warnJ.getString(it) },
            rainFromMin = if (c.isNull("rainFromMin")) base?.rainFromMin else c.optInt("rainFromMin"),
            // 옛 서버 답엔 칸이 없다 → 차 것 그대로
            air = if (c.has("air")) airOf(c, "air") else base?.air,
            roadFactor = c.optDouble("roadFactor", base?.roadFactor ?: 1.3),
            dwellScale = c.optDouble("dwellScale", base?.dwellScale ?: 1.0),
            napTaken = c.optBoolean("napTaken", base?.napTaken ?: false),
            // 옛 서버 답엔 칸이 없다 → 차 것 그대로
            end = if (c.has("end")) c.optJSONObject("end")?.let(::parseEnd) else base?.end,
            napOff = if (c.has("napOff")) c.optBoolean("napOff") else base?.napOff ?: false,
            userLimit = if (c.has("userLimit")) c.optBoolean("userLimit") else base?.userLimit ?: false,
        )
    }

    /**
     * 서버 답의 제안 카드 상태 (차 카드를 서버 거절에 맞춰 치울 때, [ProposalDismissWatch]).
     *  - GET·409 몸체: `proposal` 칸 — null이면 없음, 다른 버전의 제안(`proposal.version` ≠ `version`)도 없음으로
     *  - PATCH 답: `proposal` 칸이 없고 kind가 Proposal이면 `options`가 제안, 그 밖은 모름
     */
    fun serverProposal(o: JSONObject): ServerProposal {
        if (o.has("proposal")) {
            val p = o.optJSONObject("proposal") ?: return ServerProposal.None
            val v = o.optInt("version", -1)
            if (p.has("version") && !p.isNull("version") && v >= 0 && p.optInt("version") != v) return ServerProposal.None
            return p.optJSONArray("options")?.let { ServerProposal.Some(optionShapes(it)) } ?: ServerProposal.None
        }
        if (o.optString("kind") == "Proposal") o.optJSONArray("options")?.let { return ServerProposal.Some(optionShapes(it)) }
        return ServerProposal.Unknown
    }

    private fun optionShapes(a: JSONArray): List<String> = List(a.length()) { i ->
        val op = a.getJSONObject(i)
        val stops = op.optJSONArray("stops") ?: JSONArray()
        ProposalDismissWatch.shape(op.optString("kind"), List(stops.length()) { j ->
            stops.optJSONObject(j)?.optString("id") ?: stops.optString(j)
        })
    }

    /** 미세먼지 등급 글자 → 엔진 (없거나 모르는 글자면 null). */
    fun airOf(o: JSONObject, k: String): AirLevel? =
        if (!o.has(k) || o.isNull(k)) null else runCatching { AirLevel.valueOf(o.optString(k)) }.getOrNull()

    /** 도착지 {name, at:[위도, 경도]} ↔ 엔진. */
    fun endJson(e: CourseEnd): JSONObject = JSONObject().put("name", e.name).put("at", JSONArray().put(e.at.lat).put(e.at.lng))
    fun parseEnd(o: JSONObject): CourseEnd? {
        val at = o.optJSONArray("at")?.takeIf { it.length() == 2 } ?: return null
        val name = o.optString("name").takeIf { it.isNotBlank() } ?: return null
        return CourseEnd(name, LatLng(at.getDouble(0), at.getDouble(1)))
    }

    /** 코스 → JSON (로그·디버그용, 서버 답 모양과 같다). */
    fun course(c: LiveCourse): JSONObject = JSONObject()
        .put("id", c.id).put("version", c.version).put("chosenBy", c.chosenBy).put("chosenAtMin", c.chosenAtMin)
        .put("nowMin", c.nowMin).put("here", c.here?.let { JSONArray().put(it.lat).put(it.lng) } ?: JSONObject.NULL)
        .put("arriveHomeMin", c.arriveHomeMin).put("limitMin", c.limitMin).put("slackMin", c.slackMin)
        .put("rainFromMin", c.rainFromMin ?: JSONObject.NULL).put("air", c.air?.name ?: JSONObject.NULL).put("roadFactor", c.roadFactor).put("dwellScale", c.dwellScale).put("napTaken", c.napTaken)
        .put("end", c.end?.let(::endJson) ?: JSONObject.NULL).put("napOff", c.napOff).put("userLimit", c.userLimit)
        .put("stops", JSONArray(c.stops.map { s ->
            JSONObject().put("placeId", s.id).put("status", s.status.name)
                .put("plannedArriveMin", s.plannedArriveMin).put("plannedDepartMin", s.plannedDepartMin)
                .put("actualArriveMin", s.actualArriveMin ?: JSONObject.NULL).put("actualDepartMin", s.actualDepartMin ?: JSONObject.NULL)
                .put("dwellGuessMin", s.dwellGuessMin)
                .also { o -> s.skipReason?.let { o.put("skipReason", it) }; if (s.dwellSet) o.put("dwellSet", true) }
        }))
        .put("legs", JSONArray(c.legs.map(::legJson)))
        .put("warnings", JSONArray(c.warnings))
        .put("lastChange", c.lastChange?.let { ch -> JSONObject().put("text", ch.text).put("cause", ch.cause).put("deltaHomeMin", ch.deltaHomeMin).put("size", ch.size.name).put("atMin", ch.atMin) } ?: JSONObject.NULL)
}
