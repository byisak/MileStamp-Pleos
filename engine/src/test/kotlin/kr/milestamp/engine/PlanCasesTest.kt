package kr.milestamp.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 추천 시험 사례 — `src/test/resources/plan-cases.json`.
 * 서버(`web/src/lib/planner.ts`)도 같은 파일을 읽어 결과가 같은지 본다. 그래서 파일 모양을 단순하게 둔다.
 *
 * ── plan-cases.json 모양 ─────────────────────────────────────────────
 * {
 *   "places": [ 장소 … ],          // 사례가 id로 부르는 장소표 (SeedPlaces.ALL 과 같아야 함 — 이 테스트가 확인)
 *   "festivals": [ 장소 + "festival" … ],  // 기간 한정 축제 (사례가 "festivals"로 부를 때만 후보에 들어감)
 *   "cases":  [ 사례 … ]
 * }
 * 장소 = { "id", "name", "lat", "lng", "indoor": bool, "dwell": 머무는 분(P80), "kidFit": 0~1,
 *          "open": "HH:MM", "close": "HH:MM"(상시 개방은 "00:00"~"24:00"), "popular": 요즘 다녀간 팀 수, "stampable": bool,
 *          "closedDays": [0=일…]?(쉬는 요일), "closedDates": ["YYYY-MM-DD" …]?(임시 휴무) — 그날(day) 추천에서 빠진다,
 *          "hours": [{ "days": [0=일…], "holiday": bool?, "open": "HH:MM", "close": "HH:MM", "lastEntry": "HH:MM"?,
 *                      "validFrom": "MM-DD"?, "validTo": "MM-DD"? } …]? (운영 시간 줄 — 그날 맞는 줄의 시각, 없으면 그날 쉼),
 *          저녁 나들이 칸 (선택): "kind": "spot"|"view"|"market"|"drive", "route": { "points": [[위도, 경도] …], "passMin": 분 }?,
 *          "moments": { "best": ["day"|"sunset"|"night" …], "lightOn": "sunset+15"|"HH:MM"?, "shows": [{ "name", "times": ["HH:MM" …], "days"?, "months"? }]? }?,
 *          "fitEvening": { "kids"|"couple"|"friends"|"solo": 0~1 }? }
 * 사례 = {
 *   "name":  설명,
 *   "call":  "first"(오늘 첫 탑승: 14시 전 MORNING, 이후 AFTERNOON) | "reboard"(내렸다 다시 탐),
 *   "now":   "HH:MM",
 *   "here":  [위도, 경도],
 *   "profile": { "home": [위도, 경도], "nap": ["13:00","14:30"] 또는 null(낮잠 없음),
 *                "backBy": "sunset-30"(해 지기 30분 전) | "at:17:30"(고정), "dinner": "18:30" 또는 null, "kidAges": [4,4],
 *                "bedtime": "21:00"?(아이 잠자는 시간), "lateReturn": "23:00"?(어른끼리 늦어도 몇 시 귀가) },
 *   "sky":   { "sunrise": "HH:MM"?, "sunset": "HH:MM"?, "sky": "CLEAR"|"RAIN"|"SNOW"|"UNKNOWN", "rainFrom": "HH:MM" 또는 null,
 *              "air": "GOOD"|"NORMAL"|"BAD"|"VERY_BAD"|"UNKNOWN"?, "pm10": ㎍/㎥?, "pm25": ㎍/㎥?, "temp": ℃? } 또는 null,
 *   "candidates": "all" | [장소 id …],
 *   "placeOverrides": { 장소 id: { 바꿀 칸: 값 } }?   // 이 사례에서만 장소 값을 바꿈 (예: popular)
 *   "day": "YYYY-MM-DD" 또는 null?  // 오늘 날짜 (축제 기간 판단, 없으면 null = 축제 빠짐)
 *   "festivals": [축제 id …]?        // 후보에 더할 축제 (festivals 표에서)
 *   "festivalOverrides": { 축제 id: { festival 칸: 값 } }?  // 이 사례에서만 축제 값을 바꿈 (예: weight, closedDays)
 * 축제 = 장소 칸 + "festival": { "starts", "ends": "YYYY-MM-DD", "weight": 보통 1.0 · 강하게 2.5, "placeId": 붙은 명소 id 또는 null, "closedDays": [0=일…] }
 *   "expect": {                    // 모두 선택. 있는 것만 확인
 *     "mode": "MORNING"|"AFTERNOON"|"REBOARD",
 *     "options": 카드 수,
 *     "limit": "HH:MM",            // 귀가 한계 (plan.backByMin)
 *     "budget": 분,                // 여유 (음수는 0)
 *     "labels": [카드 제목 …],     // 순서대로
 *     "stops": [[장소 id …] …],     // 카드마다 들르는 곳 순서 ('바로 집으로'는 [])
 *     "arriveHome": ["HH:MM" …],   // 카드마다 집 도착
 *     "bestReasons": [칩 글자 …],  // 1순위 카드의 이유 칩 전부, 순서대로
 *     "reasons": [[칩 글자 …] …],  // 카드마다 이유 칩 전부, 순서대로
 *     "homeByLimit": true,         // 장소가 있는 카드는 모두 귀가 한계 안에 집 도착
 *     "homeBy": "HH:MM",           // 모든 카드가 이 시각까지 집 도착
 *     "bestHasNapDrive": true,     // 1순위 하루 막대에 NAP_DRIVE 칸
 *     "allIndoor": true,           // 장소가 있는 카드의 장소가 모두 실내
 *     "noOutdoorInRain": true,     // 야외 머무름이 비 시작 뒤로 넘어가지 않음
 *     "hasGoHome": true,           // '바로 집으로'(GO_HOME) 카드가 있음
 *     "onlyGoHome": true,          // 카드가 GO_HOME 하나뿐
 *     "hasStop": 장소 id,          // 어느 카드엔가 이 장소가 있음
 *     "noStop": 장소 id,           // 어느 카드에도 이 장소가 없음
 *     "evening": bool,             // 저녁 나들이 카드가 들어 있는 계획 (Plan.evening)
 *     "sunsetTip": "장소 id@HH:MM" 또는 null  // '내일 노을 보러' 안내 (장소 @ 도착 시각)
 *   }
 * }
 * 시각은 모두 그날 0시부터 분으로 바꿔 계산한다.
 * 어느 사례든 모든 카드에 이유 칩이 1개 이상 있어야 하고, '가깝게' 카드는 코스 전체가 가까워야 한다.
 * labels·stops·arriveHome·bestReasons·reasons는 Kotlin 엔진이 낸 결과를 그대로 박아 둔 것 — 서버 이식이 한 글자까지 같아야 한다.
 * 계산 규칙을 일부러 바꿨다면 이 값들도 같이 고친다(테스트 출력에 실제 결과가 찍힘).
 */
class PlanCasesTest {

    private val root = Json.parse(javaClass.getResource("/plan-cases.json")!!.readText()) as Map<*, *>
    /** 동행별 적합도·분위기 표시 (plan-cases.json "placeFit": {장소 id: {fit: {couple, friends, solo}, tags: […], adultDwell?}}) — 모든 사례에 붙는다(아이와는 안 씀). */
    private val placeFit: Map<*, *> = (root["placeFit"] as Map<*, *>?).orEmpty()
    private val places: Map<String, Place> = (root["places"] as List<*>).associate { m ->
        val j = m as Map<*, *>
        val p = place(j + (placeFit[j["id"]] as Map<*, *>?).orEmpty())
        p.id to p
    }

    @Test
    fun `장소표는 SeedPlaces와 같다`() {
        assertEquals(SeedPlaces.ALL.map { it.id }.toSet(), places.keys)
        for (seed in SeedPlaces.ALL) {
            val p = places.getValue(seed.id)
            assertEquals(seed.id, seed.copy(radiusM = p.radiusM, fit = p.fit, tags = p.tags, adultDwellMin = p.adultDwellMin), p)
        }
    }

    @Test
    fun `시험 사례`() {
        val cases = root["cases"] as List<*>
        assertTrue(cases.size >= 5)
        for (c in cases) check(c as Map<*, *>)
    }

    /**
     * 머무름 층 (plan-cases.json "dwellEstimate"): 조사값 → 또래 → 우리 가족. 사례 = { name, place, profile: {dwellFactor·placeDwell·crowdDwell},
     * expect: { minutes, source: "FAMILY"|"CROWD"|"BASE", text } }
     */
    @Test
    fun `머무름 층 - 조사값 또래 우리 가족`() {
        val cases = (root["dwellEstimate"] as List<*>)
        assertTrue(cases.size >= 5)
        for (c in cases) {
            val m = c as Map<*, *>
            val prof = profile(mapOf("home" to listOf(35.8858, 128.5828)) + (m["profile"] as Map<*, *>).entries.associate { it.key to it.value })
            val est = prof.dwellEstimate(places.getValue(m["place"] as String))
            val e = m["expect"] as Map<*, *>
            val msg = "[${m["name"]}] ${est.minutes}분 ${est.source} ${est.sourceText}"
            println(msg)
            assertEquals(msg, (e["minutes"] as Double).toInt(), est.minutes)
            assertEquals(msg, e["source"], est.source.name)
            assertEquals(msg, e["text"], est.sourceText)
        }
    }

    /**
     * 머무름 배우기 (plan-cases.json "dwellLearn"): 사례 = { name, start: {factor, n, places: {id: {avg, n}}}, samples: [{place, base, actual}],
     * expect: {factor, n, places} } — 다녀온 곳을 차례로 [DwellLearning.update].
     */
    @Test
    fun `머무름 배우기 EMA`() {
        val cases = (root["dwellLearn"] as List<*>)
        assertTrue(cases.size >= 3)
        fun stats(m: Map<*, *>) = DwellStats(
            (m["factor"] as Double), (m["n"] as Double).toInt(),
            (m["places"] as Map<*, *>?).orEmpty().entries.associate { (k, v) ->
                val x = v as Map<*, *>
                (k as String) to PlaceDwell((x["avg"] as Double).toInt(), (x["n"] as Double).toInt())
            },
        )
        for (c in cases) {
            val m = c as Map<*, *>
            var st = stats(m["start"] as Map<*, *>)
            for (x in m["samples"] as List<*>) {
                val sm = x as Map<*, *>
                st = DwellLearning.update(st, sm["place"] as String, (sm["base"] as Double).toInt(), (sm["actual"] as Double).toInt())
            }
            println("[${m["name"]}] $st")
            assertEquals("[${m["name"]}]", stats(m["expect"] as Map<*, *>), st)
        }
    }

    private fun check(c: Map<*, *>) {
        val name = c["name"] as String
        val now = hhmm(c["now"] as String)
        val here = latLng(c["here"])
        val profile = profile(c["profile"] as Map<*, *>)
        val sky = (c["sky"] as Map<*, *>?)?.let { s ->
            SkyToday(
                (s["sunrise"] as String?)?.let(::hhmm),
                (s["sunset"] as String?)?.let(::hhmm),
                Sky.valueOf((s["sky"] as String?) ?: "UNKNOWN"),
                (s["rainFrom"] as String?)?.let(::hhmm),
                (s["air"] as String?)?.let(AirLevel::valueOf),
                (s["pm10"] as Double?)?.toInt(),
                (s["pm25"] as Double?)?.toInt(),
                (s["temp"] as Double?)?.toInt(),
            )
        }
        val overrides = (c["placeOverrides"] as Map<*, *>?).orEmpty()
        val table = places.mapValues { (id, p) -> (overrides[id] as Map<*, *>?)?.let { o -> place(placeJson(p) + o.entries.associate { it.key to it.value }) } ?: p }
        val base = when (val cs = c["candidates"]) {
            "all" -> table.values.toList()
            else -> (cs as List<*>).map { table.getValue(it as String) }
        }
        val festOver = (c["festivalOverrides"] as Map<*, *>?).orEmpty()
        val candidates = base + (c["festivals"] as List<*>?).orEmpty().map { id ->
            val m = festivals.getValue(id as String)
            val f = (m["festival"] as Map<*, *>) + (festOver[id] as Map<*, *>?).orEmpty()
            place(m).copy(festival = festival(id, f))
        }
        val day = c["day"] as String?
        val plan = when (c["call"]) {
            "first" -> Planner.firstBoarding(now, here, profile, candidates, sky, day, (c["maxStops"] as Double?)?.toInt() ?: Planner.MAX_STOPS)
            "reboard" -> Planner.reboard(now, here, profile, candidates, sky, day)
            else -> error("call: ${c["call"]}")
        }
        println(describe(name, plan))
        println("   EXPECT {\"labels\": ${arr(plan.options.map { q(it.label) })}, \"stops\": ${arr(plan.options.map { arr(it.stops.map { s -> q(s.id) }) })}, " +
            "\"arriveHome\": ${arr(plan.options.map { q(it.arriveHomeMin.asHhmm()) })}, \"reasons\": ${arr(plan.options.map { arr(it.reasonTexts.map(::q)) })}, " +
            "\"picks\": ${arr(plan.options.map { q(Planner.pickOf(it)) })}, \"night\": ${Planner.isNight(now, profile, sky)}, \"limit\": ${q(plan.backByMin.asHhmm())}, " +
            "\"evening\": ${plan.evening}, \"sunsetTip\": ${plan.sunsetTip?.let { q("${it.placeId}@${it.arriveByMin.asHhmm()}") } ?: "null"}}")

        val e = c["expect"] as Map<*, *>
        val msg = "[$name]\n${describe(name, plan)}"
        val withStops = plan.options.filter { it.stops.isNotEmpty() }
        e["mode"]?.let { assertEquals(msg, it, plan.mode.name) }
        e["options"]?.let { assertEquals(msg, (it as Double).toInt(), plan.options.size) }
        e["limit"]?.let { assertEquals(msg, hhmm(it as String), plan.backByMin) }
        e["budget"]?.let { assertEquals(msg, (it as Double).toInt(), plan.budgetMin) }
        e["labels"]?.let { assertEquals(msg, it, plan.options.map { o -> o.label }) }
        e["stops"]?.let { assertEquals(msg, it, plan.options.map { o -> o.stops.map(Place::id) }) }
        e["bestReasons"]?.let { assertEquals(msg, it, plan.best!!.reasonTexts) }
        e["reasons"]?.let { assertEquals(msg, it, plan.options.map { o -> o.reasonTexts }) }
        e["arriveHome"]?.let { assertEquals(msg, it, plan.options.map { o -> o.arriveHomeMin.asHhmm() }) }
        if (e["homeByLimit"] == true) {
            withStops.forEach { assertTrue(msg, it.arriveHomeMin <= plan.backByMin) }
        }
        e["homeBy"]?.let { t -> plan.options.forEach { assertTrue(msg, it.arriveHomeMin <= hhmm(t as String)) } }
        if (e["bestHasNapDrive"] == true) assertTrue(msg, plan.best!!.legs.any { it.kind == LegKind.NAP_DRIVE })
        if (e["allIndoor"] == true) {
            assertTrue(msg, withStops.isNotEmpty())
            withStops.forEach { o -> assertTrue(msg, o.stops.all { it.indoor }) }
        }
        if (e["noOutdoorInRain"] == true) {
            val rain = Planner.rainStartMin(sky, now)!!
            for (o in withStops) for (leg in o.legs.filter { it.kind == LegKind.STAY }) {
                if (!table.getValue(leg.placeId!!).indoor) assertTrue(msg, leg.toMin <= rain)
            }
        }
        if (e["hasGoHome"] == true) assertTrue(msg, plan.options.any { it.kind == OptionKind.GO_HOME })
        if (e["onlyGoHome"] == true) assertEquals(msg, listOf(OptionKind.GO_HOME), plan.options.map { it.kind })
        e["hasStop"]?.let { id -> assertTrue(msg, plan.options.any { o -> o.stops.any { it.id == id } }) }
        e["noStop"]?.let { id -> assertTrue(msg, plan.options.none { o -> o.stops.any { it.id == id } }) }
        e["picks"]?.let { assertEquals(msg, it, plan.options.map { o -> Planner.pickOf(o) }) }
        e["night"]?.let { assertEquals(msg, it, Planner.isNight(now, profile, sky)) }
        e["evening"]?.let { assertEquals(msg, it, plan.evening) }
        if (e.containsKey("sunsetTip")) assertEquals(msg, e["sunsetTip"], plan.sunsetTip?.let { "${it.placeId}@${it.arriveByMin.asHhmm()}" })

        // 어느 사례든: 하루 막대는 지금부터 귀가까지 빈틈없이 이어지고, 카드마다 이유 칩이 있다
        for (o in plan.options) {
            assertTrue("$msg\n칩 없는 카드: ${o.label}", o.reasons.isNotEmpty())
            assertEquals(msg, now, o.legs.first().fromMin)
            assertEquals(msg, o.arriveHomeMin, o.legs.last().toMin)
            o.legs.zipWithNext().forEach { (a, b) -> assertEquals(msg, a.toMin, b.fromMin) }
        }
        // '가깝게' 카드는 코스 전체가 가깝다: 모든 장소가 집·출발지에서 30분 안, 어느 이동도 30분 이하
        for (o in plan.options.filter { it.label.startsWith("가깝게") }) {
            o.legs.filter { it.kind != LegKind.STAY }.forEach { assertTrue(msg, it.minutes <= Planner.NEAR_MAX_MIN) }
            o.stops.forEach { p ->
                assertTrue(msg, minOf(TravelTime.minutes(profile.home, p.at), TravelTime.minutes(here, p.at)) <= Planner.NEAR_MAX_MIN)
            }
        }
    }

    private fun describe(name: String, p: Plan) = buildString {
        append("── $name: ${p.mode} 한계 ${p.backByMin.asHhmm()} 여유 ${p.budgetMin}분\n")
        p.options.forEach { o ->
            append("   [${o.label}] ${o.stops.joinToString(" → ") { it.name }.ifEmpty { "집" }} · 귀가 ${o.arriveHomeMin.asHhmm()}\n")
            append("      ").append(o.legs.joinToString(" ") { "${it.kind}${it.placeId?.let { id -> ":$id" } ?: ""} ${it.fromMin.asHhmm()}-${it.toMin.asHhmm()}" }).append('\n')
            append("      ").append(o.reasonTexts.joinToString(" | ")).append('\n')
        }
    }

    // ---- JSON → 엔진 값 ----

    private val festivals: Map<String, Map<*, *>> =
        (root["festivals"] as List<*>?).orEmpty().associate { m -> ((m as Map<*, *>)["id"] as String) to m }

    private fun festival(id: String, f: Map<*, *>) = FestivalInfo(
        id = id,
        starts = f["starts"] as String,
        ends = f["ends"] as String,
        weight = f["weight"] as Double,
        placeId = f["placeId"] as String?,
        closedDays = (f["closedDays"] as List<*>?).orEmpty().map { (it as Double).toInt() },
    )

    private fun latLng(v: Any?): LatLng = (v as List<*>).let { LatLng(it[0] as Double, it[1] as Double) }

    private fun place(m: Map<*, *>) = Place(
        id = m["id"] as String,
        name = m["name"] as String,
        at = LatLng(m["lat"] as Double, m["lng"] as Double),
        indoor = m["indoor"] as Boolean,
        dwellP80Min = (m["dwell"] as Double).toInt(),
        kidFit = m["kidFit"] as Double,
        openMin = clock(m["open"] as String),
        closeMin = clock(m["close"] as String),
        popular = (m["popular"] as Double).toInt(),
        stampable = m["stampable"] as Boolean,
        fit = (m["fit"] as Map<*, *>?).orEmpty().entries.associate { (k, v) -> GoWith.of(k as String) to (v as Double) },
        tags = (m["tags"] as List<*>?).orEmpty().map { it as String }.toSet(),
        adultDwellMin = (m["adultDwell"] as Double?)?.toInt(),
        closedDays = (m["closedDays"] as List<*>?).orEmpty().map { (it as Double).toInt() }.toSet(),
        closedDates = (m["closedDates"] as List<*>?).orEmpty().map { it as String }.toSet(),
        hours = (m["hours"] as List<*>?).orEmpty().map { h ->
            val o = h as Map<*, *>
            OpenHours(
                days = (o["days"] as List<*>?).orEmpty().map { (it as Double).toInt() }.toSet(),
                holiday = o["holiday"] as Boolean? ?: false,
                openMin = clock(o["open"] as String),
                closeMin = clock(o["close"] as String),
                lastEntryMin = (o["lastEntry"] as String?)?.let(::clock),
                validFrom = o["validFrom"] as String?, validTo = o["validTo"] as String?,
            )
        },
        kind = (m["kind"] as String?) ?: "spot",
        route = (m["route"] as Map<*, *>?)?.let { r ->
            DriveRoute((r["points"] as List<*>).map { latLng(it) }, (r["passMin"] as Double).toInt())
        },
        moments = (m["moments"] as Map<*, *>?)?.let { mo ->
            Moments(
                best = (mo["best"] as List<*>?).orEmpty().map { it as String }.toSet(),
                lightOn = mo["lightOn"] as String?,
                shows = (mo["shows"] as List<*>?).orEmpty().map { x ->
                    val so = x as Map<*, *>
                    Show(so["name"] as String, (so["times"] as List<*>).map { hhmm(it as String) }.sorted(),
                        (so["days"] as List<*>?).orEmpty().map { (it as Double).toInt() }.toSet(),
                        (so["months"] as List<*>?).orEmpty().map { (it as Double).toInt() }.toSet())
                },
            )
        },
        fitEvening = (m["fitEvening"] as Map<*, *>?).orEmpty().entries.associate { (k, v) -> GoWith.of(k as String) to (v as Double) },
    )

    private fun placeJson(p: Place): Map<Any?, Any?> = mapOf(
        "id" to p.id, "name" to p.name, "lat" to p.at.lat, "lng" to p.at.lng, "indoor" to p.indoor,
        "dwell" to p.dwellP80Min.toDouble(), "kidFit" to p.kidFit, "open" to clockText(p.openMin), "close" to clockText(p.closeMin),
        "popular" to p.popular.toDouble(), "stampable" to p.stampable,
        "fit" to p.fit.entries.associate { (k, v) -> k.key to v }, "tags" to p.tags.toList(), "adultDwell" to p.adultDwellMin?.toDouble(),
        "closedDays" to p.closedDays.map { it.toDouble() }, "closedDates" to p.closedDates.toList(),
        "hours" to p.hours.map { h ->
            mapOf("days" to h.days.map { it.toDouble() }, "holiday" to h.holiday, "open" to clockText(h.openMin), "close" to clockText(h.closeMin),
                "lastEntry" to h.lastEntryMin?.let(::clockText), "validFrom" to h.validFrom, "validTo" to h.validTo)
        },
        "kind" to p.kind,
        "route" to p.route?.let { r -> mapOf("points" to r.points.map { listOf(it.lat, it.lng) }, "passMin" to r.passMin.toDouble()) },
        "moments" to p.moments?.let { mo ->
            mapOf("best" to mo.best.toList(), "lightOn" to mo.lightOn, "shows" to mo.shows.map { sh ->
                mapOf("name" to sh.name, "times" to sh.times.map { it.asHhmm() }, "days" to sh.days.map { it.toDouble() }, "months" to sh.months.map { it.toDouble() })
            })
        },
        "fitEvening" to p.fitEvening.entries.associate { (k, v) -> k.key to v },
    )

    /** 장소 시각: "24:00" = 자정(상시 개방의 닫는 시각)도 받는다. */
    private fun clock(t: String): Int = if (t == "24:00") 24 * 60 else hhmm(t)
    private fun clockText(min: Int): String = if (min == 24 * 60) "24:00" else min.asHhmm()

    private fun profile(m: Map<*, *>): FamilyProfile {
        val nap = (m["nap"] as List<*>?)?.map { hhmm(it as String) } ?: listOf(0, 0)
        val back = (m["backBy"] as String?) ?: "sunset-30"
        return FamilyProfile(
            home = latLng(m["home"]),
            napStartMin = nap[0],
            napEndMin = nap[1],
            backBy = when {
                back.startsWith("sunset-") -> BackBy.SunsetMinus(back.removePrefix("sunset-").toInt())
                back.startsWith("at:") -> BackBy.At(hhmm(back.removePrefix("at:")))
                else -> error("backBy: $back")
            },
            dinnerMin = if (m.containsKey("dinner")) (m["dinner"] as String?)?.let(::hhmm) else 18 * 60 + 30,
            kidAges = (m["kidAges"] as List<*>?)?.map { (it as Double).toInt() } ?: listOf(4, 4),
            dwellFactor = (m["dwellFactor"] as Double?) ?: 1.0,
            dwellN = (m["dwellN"] as Double?)?.toInt() ?: 0,
            placeDwell = (m["placeDwell"] as Map<*, *>?).orEmpty().entries.associate { (k, v) ->
                val x = v as Map<*, *>
                (k as String) to PlaceDwell((x["avg"] as Double).toInt(), (x["n"] as Double).toInt())
            },
            crowdDwell = (m["crowdDwell"] as Map<*, *>?).orEmpty().entries.associate { (k, v) ->
                val x = v as Map<*, *>
                (k as String) to CrowdDwell((x["p75"] as Double).toInt(), (x["n"] as Double).toInt())
            },
            history = (m["history"] as Map<*, *>?)?.let { h ->
                VisitHistory(
                    stamped = (h["stamped"] as List<*>?).orEmpty().map { it as String }.toSet(),
                    lastVisitDays = (h["lastVisitDays"] as Map<*, *>?).orEmpty().entries.associate { (k, v) -> (k as String) to (v as Double).toInt() },
                    favorites = (h["favorites"] as List<*>?).orEmpty().map { it as String }.toSet(),
                )
            },
            companion = GoWith.of(m["companion"] as String?),
            bedtimeMin = (m["bedtime"] as String?)?.let(::hhmm) ?: FamilyProfile.DEFAULT_BEDTIME_MIN,
            lateReturnMin = (m["lateReturn"] as String?)?.let(::hhmm) ?: FamilyProfile.DEFAULT_LATE_RETURN_MIN,
        )
    }

    // ---- 사례 공통 입력 (cases·anchor·explain) ----

    private class Input(val now: Int, val here: LatLng, val profile: FamilyProfile, val sky: SkyToday?, val table: Map<String, Place>, val candidates: List<Place>, val day: String?)

    private fun input(c: Map<*, *>): Input {
        val now = hhmm(c["now"] as String)
        val here = latLng(c["here"])
        val profile = profile(c["profile"] as Map<*, *>)
        val sky = (c["sky"] as Map<*, *>?)?.let { s ->
            SkyToday(
                (s["sunrise"] as String?)?.let(::hhmm), (s["sunset"] as String?)?.let(::hhmm),
                Sky.valueOf((s["sky"] as String?) ?: "UNKNOWN"), (s["rainFrom"] as String?)?.let(::hhmm),
                (s["air"] as String?)?.let(AirLevel::valueOf), (s["pm10"] as Double?)?.toInt(), (s["pm25"] as Double?)?.toInt(),
                (s["temp"] as Double?)?.toInt(),
            )
        }
        val overrides = (c["placeOverrides"] as Map<*, *>?).orEmpty()
        val table = places.mapValues { (id, p) -> (overrides[id] as Map<*, *>?)?.let { o -> place(placeJson(p) + o.entries.associate { it.key to it.value }) } ?: p }
        val base = when (val cs = c["candidates"]) {
            "all" -> table.values.toList()
            else -> (cs as List<*>).map { table.getValue(it as String) }
        }
        val candidates = base + (c["festivals"] as List<*>?).orEmpty().map { festivalPlace(it as String) }
        return Input(now, here, profile, sky, table, candidates, c["day"] as String?)
    }

    private fun festivalPlace(id: String): Place {
        val m = festivals.getValue(id)
        return place(m).copy(festival = festival(id, m["festival"] as Map<*, *>))
    }

    /** 결과를 사례 파일 expect 모양 JSON으로 (사례를 새로 쓸 때 출력에서 옮겨 붙인다). */
    private fun q(x: String) = "\"" + x.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
    private fun arr(xs: List<String>) = xs.joinToString(", ", "[", "]")

    /**
     * 앵커 코스 사례 (plan-cases.json "anchor"): 사례 = 공통 입력 + "anchor": {"place": id} | {"festival": id} | {"inline": 장소 JSON},
     * "dwell": 분?, expect: { labels, stops, arriveHome, reasons, overLimit: [bool …], overnight, closed, oneWay, anchorDwell }
     */
    @Test
    fun `앵커 코스`() {
        val cases = (root["anchor"] as List<*>?).orEmpty()
        assertTrue(cases.size >= 5)
        for (c in cases) {
            val m = c as Map<*, *>
            val inp = input(m)
            val a = m["anchor"] as Map<*, *>
            val anchor = when {
                a["place"] != null -> inp.table.getValue(a["place"] as String)
                a["festival"] != null -> festivalPlace(a["festival"] as String)
                else -> place(a["inline"] as Map<*, *>)
            }
            val r = Planner.anchored(inp.now, inp.here, inp.profile, inp.candidates, anchor, (m["dwell"] as Double?)?.toInt(), inp.sky, inp.day)
            val o = r.plan.options
            val actual = "{\"labels\": ${arr(o.map { q(it.label) })}, \"stops\": ${arr(o.map { arr(it.stops.map { s -> q(s.id) }) })}, " +
                "\"arriveHome\": ${arr(o.map { q(it.arriveHomeMin.asHhmm()) })}, \"reasons\": ${arr(o.map { arr(it.reasonTexts.map(::q)) })}, " +
                "\"overLimit\": ${arr(o.map { it.overLimit.toString() })}, \"overnight\": ${r.overnight}, \"closed\": ${r.closed}, " +
                "\"oneWay\": ${r.oneWayMin}, \"anchorDwell\": ${r.anchorDwellMin}}"
            val name = m["name"] as String
            println("── 앵커 $name\n${describe(name, r.plan)}   EXPECT $actual")
            val msg = "[$name]\n${describe(name, r.plan)}"
            val e = m["expect"] as Map<*, *>
            e["labels"]?.let { assertEquals(msg, it, o.map { x -> x.label }) }
            e["stops"]?.let { assertEquals(msg, it, o.map { x -> x.stops.map(Place::id) }) }
            e["arriveHome"]?.let { assertEquals(msg, it, o.map { x -> x.arriveHomeMin.asHhmm() }) }
            e["reasons"]?.let { assertEquals(msg, it, o.map { x -> x.reasonTexts }) }
            e["overLimit"]?.let { assertEquals(msg, it, o.map { x -> x.overLimit }) }
            e["overnight"]?.let { assertEquals(msg, it, r.overnight) }
            e["closed"]?.let { assertEquals(msg, it, r.closed) }
            e["oneWay"]?.let { assertEquals(msg, (it as Double).toInt(), r.oneWayMin) }
            e["anchorDwell"]?.let { assertEquals(msg, (it as Double).toInt(), r.anchorDwellMin) }
            assertTrue(msg, e.isNotEmpty())
            // 어느 앵커 카드든: 앵커가 들어 있고, 하루 막대가 지금부터 귀가까지 이어지고, 앵커에서 정한 만큼 머문다(문 닫는 시각 전까지)
            val prof = inp.profile.copy(dwellSet = mapOf(anchor.id to r.anchorDwellMin))
            for (x in o) {
                // 고르면(choose stops + anchor) 같은 시간표: Planner.course(anchorId, lenient)
                val again = Planner.course(inp.now, inp.here, prof, x.stops, inp.sky, "고른 코스", r.plan.mode, lenient = true, anchorId = anchor.id)
                assertEquals(msg, x.legs, again?.legs)
                assertEquals(msg, x.overLimit, again?.overLimit)
                assertTrue(msg, x.stops.any { it.id == anchor.id })
                assertEquals(msg, inp.now, x.legs.first().fromMin)
                x.legs.zipWithNext().forEach { (p1, p2) -> assertEquals(msg, p1.toMin, p2.fromMin) }
                assertTrue(msg, x.reasons.isNotEmpty())
            }
            assertEquals(msg, o.map { it.stops.map(Place::id) }.distinct().size, o.size)
        }
    }

    /**
     * 밥 넣기 사례 (plan-cases.json "meals"): 사례 = 공통 입력 + "call": "first"|"reboard" + "restaurants": "all" | [식당 id …],
     * "restaurantOverrides": {식당 id: {칸: 값}}?. 식당표는 plan-cases.json "restaurants" (식당 JSON = [restaurant] 참고).
     * 가족 프로필에 밥 설정(MealSetup)을 켜고 계획을 짠다. expect: { labels, stops, arriveHome, reasons,
     *   meals: ["식당 id@시작-끝#자리" 또는 null …], alts: [[식당 id …] …], hints: [까닭 또는 null …], legs: [["칸:장소 시작-끝" …] …]? }
     * 어느 사례든: 밥을 빼면(식사 자리 빼고) 밥 끔과 같은 곳·같은 카드 제목이고, 하루 막대가 이어지고, 밥 칸(MEAL)은 끼니 창 안에서 시작한다.
     */
    @Test
    fun `밥 넣기`() {
        val cases = (root["meals"] as List<*>?).orEmpty()
        assertTrue(cases.size >= 5)
        for (c in cases) {
            val m = c as Map<*, *>
            val inp = input(m)
            val over = (m["restaurantOverrides"] as Map<*, *>?).orEmpty()
            val table = restaurants.mapValues { (id, r) -> (over[id] as Map<*, *>?)?.let { o -> restaurant(r + o.entries.associate { it.key to it.value }) } ?: restaurant(r) }
            val rs = when (val x = m["restaurants"]) {
                "all" -> table.values.toList()
                else -> (x as List<*>).map { table.getValue(it as String) }
            }
            val prof = inp.profile.copy(meal = MealSetup(rs, inp.day))
            fun run(p: FamilyProfile) = when (m["call"]) {
                "first" -> Planner.firstBoarding(inp.now, inp.here, p, inp.candidates, inp.sky, inp.day)
                "reboard" -> Planner.reboard(inp.now, inp.here, p, inp.candidates, inp.sky, inp.day)
                else -> error("call: ${m["call"]}")
            }
            val plan = run(prof)
            val plain = run(inp.profile)
            val o = plan.options
            val name = m["name"] as String
            val mealText = { x: PlanOption -> x.meal?.let { q("${it.restaurantId}@${it.startMin.asHhmm()}-${it.endMin.asHhmm()}#${it.index}") } ?: "null" }
            val actual = "{\"labels\": ${arr(o.map { q(it.label) })}, \"stops\": ${arr(o.map { arr(it.stops.map { s -> q(s.id) }) })}, " +
                "\"arriveHome\": ${arr(o.map { q(it.arriveHomeMin.asHhmm()) })}, \"reasons\": ${arr(o.map { arr(it.reasonTexts.map(::q)) })}, " +
                "\"meals\": ${arr(o.map(mealText))}, \"alts\": ${arr(o.map { x -> arr(x.meal?.alternatives.orEmpty().map { q(it.restaurantId) }) })}, " +
                "\"hints\": ${arr(o.map { x -> x.mealHint?.let(::q) ?: "null" })}, " +
                "\"legs\": ${arr(o.map { x -> arr(x.legs.map { l -> q("${l.kind}:${l.placeId ?: ""} ${l.fromMin.asHhmm()}-${l.toMin.asHhmm()}") }) })}}"
            println("── 밥 $name\n${describe(name, plan)}   EXPECT $actual")
            val msg = "[$name]\n${describe(name, plan)}"
            val e = m["expect"] as Map<*, *>
            e["labels"]?.let { assertEquals(msg, it, o.map { x -> x.label }) }
            e["stops"]?.let { assertEquals(msg, it, o.map { x -> x.stops.map(Place::id) }) }
            e["arriveHome"]?.let { assertEquals(msg, it, o.map { x -> x.arriveHomeMin.asHhmm() }) }
            e["reasons"]?.let { assertEquals(msg, it, o.map { x -> x.reasonTexts }) }
            e["meals"]?.let { assertEquals(msg, it, o.map { x -> x.meal?.let { mm -> "${mm.restaurantId}@${mm.startMin.asHhmm()}-${mm.endMin.asHhmm()}#${mm.index}" } }) }
            e["alts"]?.let { assertEquals(msg, it, o.map { x -> x.meal?.alternatives.orEmpty().map { a -> a.restaurantId } }) }
            e["hints"]?.let { assertEquals(msg, it, o.map { x -> x.mealHint }) }
            e["legs"]?.let { assertEquals(msg, it, o.map { x -> x.legs.map { l -> "${l.kind}:${l.placeId ?: ""} ${l.fromMin.asHhmm()}-${l.toMin.asHhmm()}" } }) }
            assertTrue(msg, e.isNotEmpty())
            assertEquals(msg, plain.options.map { it.label }, o.map { it.label })
            assertEquals(msg, plain.options.map { x -> x.stops.map(Place::id) }, o.map { x -> x.stops.filter { !it.isMeal }.map(Place::id) })
            for (x in o) {
                assertEquals(msg, x.arriveHomeMin, x.legs.last().toMin)
                x.legs.zipWithNext().forEach { (a, b) -> assertEquals(msg, a.toMin, b.fromMin) }
                val meal = x.meal
                if (meal == null) {
                    assertTrue(msg, x.legs.none { it.kind == LegKind.MEAL })
                    continue
                }
                assertTrue(msg, x.arriveHomeMin <= plan.backByMin - TimeBudget.SAFETY_MIN)
                val leg = x.legs.single { it.kind == LegKind.MEAL }
                assertEquals(msg, meal.endMin, leg.toMin)
                val w = if (meal.kind == "lunch") Meals.LUNCH else Meals.DINNER
                assertTrue(msg, meal.startMin in w.fromMin..w.toMin)
                assertEquals(msg, meal.placeId, x.stops[meal.index].id)
                assertTrue(msg, x.reasons.any { it.tone == Tone.MEAL && it.text == meal.text })
            }
        }
    }

    private val restaurants: Map<String, Map<*, *>> =
        (root["restaurants"] as List<*>?).orEmpty().associate { m -> ((m as Map<*, *>)["id"] as String) to m }

    /**
     * 식당 JSON = { "id", "name", "lat", "lng", "cuisine": [..]?, "kid": [kids_menu…]?, "parking": {"has", "fee"}?,
     *   "wait": {"weekday"|"weekend_lunch"|"weekend_dinner": 0~2}?, "meal": [lunch|dinner|snack]?, "dwell": 분?,
     *   "fit": {kids|couple|friends|solo: 0~1}?, "tags": [..]?,
     *   "hours": [{ "days", "holiday"?, "open", "close", "breaks": [["HH:MM","HH:MM"]]?, "lastOrder": "HH:MM"? }]? }
     */
    private fun restaurant(m: Map<*, *>) = Restaurant(
        id = m["id"] as String,
        name = m["name"] as String,
        at = LatLng(m["lat"] as Double, m["lng"] as Double),
        cuisine = (m["cuisine"] as List<*>?).orEmpty().map { it as String },
        kid = (m["kid"] as List<*>?).orEmpty().map { it as String }.toSet(),
        parkingHas = (m["parking"] as Map<*, *>?)?.get("has") as String?,
        parkingFee = (m["parking"] as Map<*, *>?)?.get("fee") as String?,
        wait = (m["wait"] as Map<*, *>?).orEmpty().entries.associate { (k, v) -> (k as String) to (v as Double).toInt() },
        meal = (m["meal"] as List<*>?).orEmpty().map { it as String }.toSet(),
        dwellMin = (m["dwell"] as Double?)?.toInt(),
        fit = (m["fit"] as Map<*, *>?).orEmpty().entries.associate { (k, v) -> GoWith.of(k as String) to (v as Double) },
        tags = (m["tags"] as List<*>?).orEmpty().map { it as String }.toSet(),
        hours = (m["hours"] as List<*>?).orEmpty().map { h ->
            val o = h as Map<*, *>
            OpenHours(
                days = (o["days"] as List<*>?).orEmpty().map { (it as Double).toInt() }.toSet(),
                holiday = o["holiday"] as Boolean? ?: false,
                openMin = clock(o["open"] as String),
                closeMin = clock(o["close"] as String),
                breaks = (o["breaks"] as List<*>?).orEmpty().map { b -> (b as List<*>).let { BreakRange(hhmm(it[0] as String), hhmm(it[1] as String)) } },
                lastOrderMin = (o["lastOrder"] as String?)?.let(::hhmm),
            )
        },
    )

    /**
     * '왜?' 설명 사례 (plan-cases.json "explain"): 사례 = 공통 입력 + "call" + "option": 카드 번호,
     * expect: { stops: [장소 id …], why: [[줄 …] …] } — 카드 장소마다 줄 글자, 순서대로.
     */
    @Test
    fun `왜 설명`() {
        val cases = (root["explain"] as List<*>?).orEmpty()
        assertTrue(cases.size >= 3)
        for (c in cases) {
            val m = c as Map<*, *>
            val inp = input(m)
            val plan = when (m["call"]) {
                "first" -> Planner.firstBoarding(inp.now, inp.here, inp.profile, inp.candidates, inp.sky, inp.day)
                "reboard" -> Planner.reboard(inp.now, inp.here, inp.profile, inp.candidates, inp.sky, inp.day)
                else -> error("call: ${m["call"]}")
            }
            val opt = plan.options[(m["option"] as Double).toInt()]
            val why = Planner.explainChoice(opt, inp.now, inp.here, inp.profile, inp.sky)
            val actual = "{\"stops\": ${arr(why.map { q(it.placeId) })}, \"why\": ${arr(why.map { w -> arr(w.lines.map { q(it.text) }) })}, " +
                "\"tones\": ${arr(why.map { w -> arr(w.lines.map { q(it.tone.name) }) })}}"
            val name = m["name"] as String
            println("── 왜 $name\n   EXPECT $actual")
            val e = m["expect"] as Map<*, *>
            e["stops"]?.let { assertEquals(name, it, why.map { w -> w.placeId }) }
            e["why"]?.let { assertEquals(name, it, why.map { w -> w.lines.map { l -> l.text } }) }
            e["tones"]?.let { assertEquals(name, it, why.map { w -> w.lines.map { l -> l.tone.name } }) }
            assertTrue(name, e.isNotEmpty())
            why.forEach { assertTrue(name, it.lines.size >= 2) }
        }
    }
}

/** 시험용 아주 작은 JSON 읽개 (의존성 없이). 객체 → Map, 배열 → List, 숫자 → Double. */
object Json {
    fun parse(text: String): Any? = Reader(text).run { val v = value(); ws(); require(i == s.length) { "끝에 남은 글자" }; v }

    private class Reader(val s: String) {
        var i = 0
        fun ws() { while (i < s.length && s[i].isWhitespace()) i++ }
        fun value(): Any? {
            ws()
            return when (val ch = s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> lit("true", true)
                'f' -> lit("false", false)
                'n' -> lit("null", null)
                else -> if (ch == '-' || ch.isDigit()) num() else error("JSON $i: '$ch'")
            }
        }
        fun lit(w: String, v: Any?): Any? { require(s.startsWith(w, i)); i += w.length; return v }
        fun num(): Double {
            val st = i
            while (i < s.length && (s[i].isDigit() || s[i] in "+-.eE")) i++
            return s.substring(st, i).toDouble()
        }
        fun str(): String {
            val b = StringBuilder(); i++
            while (s[i] != '"') {
                if (s[i] == '\\') {
                    i++
                    when (val e = s[i]) {
                        'n' -> b.append('\n'); 't' -> b.append('\t'); 'r' -> b.append('\r'); 'b' -> b.append('\b'); 'f' -> b.append('\u000c')
                        'u' -> { b.append(s.substring(i + 1, i + 5).toInt(16).toChar()); i += 4 }
                        else -> b.append(e)
                    }
                } else {
                    b.append(s[i])
                }
                i++
            }
            i++
            return b.toString()
        }
        fun arr(): List<Any?> {
            val out = mutableListOf<Any?>(); i++; ws()
            if (s[i] == ']') { i++; return out }
            while (true) {
                out += value(); ws()
                if (s[i++] == ']') return out
            }
        }
        fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>(); i++; ws()
            if (s[i] == '}') { i++; return out }
            while (true) {
                ws(); val k = str(); ws(); require(s[i++] == ':'); out[k] = value(); ws()
                if (s[i++] == '}') return out
            }
        }
    }
}
