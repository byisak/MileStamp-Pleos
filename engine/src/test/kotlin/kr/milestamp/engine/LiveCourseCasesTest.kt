package kr.milestamp.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 살아 있는 코스 시험 사례 — `src/test/resources/plan-live-cases.json`.
 * 서버(`web/src/lib/planner-live.ts`)도 같은 파일을 읽어 결과가 한 글자까지 같은지 본다. 그래서 모양을 단순하게 둔다.
 *
 * ── plan-live-cases.json 모양 ───────────────────────────────────────────
 * {
 *   "placesFrom": "plan-cases.json",   // 장소표는 plan-cases.json의 "places"(= SeedPlaces.ALL)를 그대로 쓴다
 *   "base": {                          // 기준 하루: 모든 사례가 이 코스에서 시작
 *     "now": "08:30", "here": [위도, 경도],
 *     "profile": { plan-cases.json 과 같은 모양 },
 *     "sky":     { plan-cases.json 과 같은 모양 },
 *     "course":  [장소 id …],          // Planner.course 로 시간표를 짠 고른 코스
 *     "chosenBy": "아빠 폰"
 *   },
 *   "cases": [ 사례 … ],
 *   "perf": { "morningSearchMaxMs": 100, "eventMaxMs": 20, "events": [사건 …] }   // 성능: 아침 완전탐색·사건 연속 처리
 * }
 * 사례 = { "name": 설명, "events": [사건 …], "check": {…}?, "expect": {…} }   // 사건을 차례로 넣고 마지막 답을 본다
 *   check = { "at": "HH:MM"?, "visited": [장소 id …]? }   // 제안이 지났는지 볼 시각(없으면 마지막 사건 시각)·차가 실제로 선 곳
 * 사건 = { "type": 종류, "now": "HH:MM", "driving": bool?, "here": [위도, 경도]?, 종류별 칸 }
 *   Departed{from: 장소 id|null} · Arrived{place} · StillParked · NaviEta{remainMin} · StillDriving{here 필수} · ReplaceNext{place} · Skip{place}
 *   Insert{place} · Weather{sky, rainFrom: "HH:MM"|null, air: "BAD"…?} · PlaceClosed{place} · GoHome · LimitChanged{limit: "HH:MM"}
 *   Remote{version, stops: [장소 id …], by}   // 폰 코스: 남은 순서만 (차가 다녀온 곳은 차 것이 이김)
 *   SetEnd{end: {name, at: [위도, 경도]} | "home"?, limit: "HH:MM"?, napOff: bool?}   // 오늘만 도착지·도착 목표·낮잠 끄기
 *   SetDwell{place, minutes}   // 오늘만 그곳 머무름 (15~360분, 5분 단위) · ExtendStay{minutes}   // 지금 머무는 곳에서 앞으로 N분 더 (0 = 지금 나갈게요)
 * 사례의 "sky": {…}? = 기준 하늘 위에 덮어씀 (예: "air": "BAD" — 기준 코스도 이 하늘로 짠다)
 * 사례의 "profile": {…}? = 기준 가족 값 위에 덮어씀 (dwellFactor·dwellN·placeDwell·crowdDwell 등, 기준 코스도 이 값으로 짠다)
 *   driving = 주행 중(카드 없이 칩·음성만), here = 지금 위치(없으면 코스가 아는 마지막 위치)
 * expect = {                          // 모두 선택. 있는 것만 확인
 *   "kind": "NoChange"|"Retimed"|"Proposal"|"HomeNow",
 *   "remaining": [장소 id …],         // 아직 갈 곳 순서
 *   "status": { 장소 id: "PLANNED"|"NEXT"|"ARRIVED"|"DONE"|"SKIPPED" },
 *   "arriveHome": "HH:MM", "slack": 분, "version": n,
 *   "chip": 칩 글(change.text), "voice": 음성 한 문장, "size": "QUIET"|"SOFT"|"LOUD", "cause": 원인, "deltaHome": 분,
 *   "labels": [제안 카드 제목 …], "optionStops": [[장소 id …] …], "optionArriveHome": ["HH:MM" …],
 *   "end": 도착지 이름("집"·"할머니 집"), "limit": "HH:MM",
 *   "napDrive": bool, "roadFactor": 1.4, "dwellScale": 0.9, "dwell": { 장소 id: 분 }, "dwellSet": [직접 정한 장소 id …], "warnings": [경고 글 …],
 *   "proposalExpired": 이유 글|null,  // 사건들 중 마지막 Proposal 답이 check 시각에 지났는지 (LiveCourseEngine.proposalExpired)
 *   "explain": { "headline", "body", "action": "GO_HOME"|"END"|null, "home": "HH:MM"? }   // 화면 맨 위 쉬운 설명 (LiveCourseEngine.explain)
 * }
 * explain은 check.explainAt(없으면 마지막 사건 시각)에, 마지막 답이 Proposal이면 그 카드들과, 기준 하루의 해 짐(sky.sunset)으로 만든다.
 * 사건 Tick{now} = 시간이 흐름(5분 넘게 뒤처졌거나 문 닫아 못 가는 곳이 있으면 지금으로 다시 짬).
 * 시각은 모두 그날 0시부터 분. chip·voice·labels 는 Kotlin 엔진이 낸 결과를 그대로 박아 둔 것 — 서버 이식이 한 글자까지 같아야 한다.
 * 규칙을 일부러 바꿨다면 이 값들도 같이 고친다(테스트 출력에 실제 결과가 찍힘).
 */
class LiveCourseCasesTest {

    private val root = Json.parse(javaClass.getResource("/plan-live-cases.json")!!.readText()) as Map<*, *>
    private val base = root["base"] as Map<*, *>
    private val profile = profile(base["profile"] as Map<*, *>)
    private val sky = sky(base["sky"] as Map<*, *>?)
    private val places = SeedPlaces.ALL

    private fun place(id: String) = places.first { it.id == id }

    /** 기준 하루의 코스: Planner.course 로 짠 카드 → 살아 있는 코스. */
    /** 사례마다 가족 값 덮어쓰기 ("profile": {dwellFactor·placeDwell·crowdDwell …}). */
    private fun caseProfile(c: Map<*, *>?): FamilyProfile =
        (c?.get("profile") as Map<*, *>?)?.let { o -> profile((base["profile"] as Map<*, *>) + o.entries.associate { it.key to it.value }) } ?: profile

    /** 사례마다 하늘 덮어쓰기 ("sky": {air …}). */
    private fun caseSky(c: Map<*, *>?): SkyToday? =
        (c?.get("sky") as Map<*, *>?)?.let { o -> sky((base["sky"] as Map<*, *>) + o.entries.associate { it.key to it.value }) } ?: sky

    private fun baseCourse(profile: FamilyProfile = this.profile, sky: SkyToday? = this.sky): LiveCourse {
        val now = hhmm(base["now"] as String)
        val here = latLng(base["here"])
        val stops = (base["course"] as List<*>).map { place(it as String) }
        val option = requireNotNull(Planner.course(now, here, profile, stops, sky)) { "기준 코스가 규칙에 안 맞음" }
        val plan = Plan(PlanMode.MORNING, now, 0, Planner.limitMin(PlanMode.MORNING, profile, sky), listOf(option), sky)
        return LiveCourse.from(option, plan, base["chosenBy"] as String, now, here, profile)
    }

    @Test
    fun `기준 코스`() {
        val c = baseCourse()
        println(describe("기준", null, c))
        assertEquals(listOf("seokgul", "samguk", "dgsm"), c.remaining.map { it.id })
        assertEquals(hhmm("16:47"), c.arriveHomeMin)
        assertEquals(hhmm("17:02"), c.limitMin)
        assertEquals(1, c.version)
        assertTrue(c.legs.any { it.kind == LegKind.NAP_DRIVE && it.placeId == "dgsm" })
    }

    @Test
    fun `시험 사례`() {
        val cases = root["cases"] as List<*>
        assertTrue(cases.size >= 12)
        val failures = mutableListOf<String>()
        for (c in cases) {
            try { check(c as Map<*, *>) } catch (e: AssertionError) { failures += e.message ?: e.toString() }
        }
        assertTrue(failures.joinToString("\n\n"), failures.isEmpty())
    }

    @Test
    fun `성능 - 아침 완전탐색 100ms, 사건 하나 20ms`() {
        val perf = root["perf"] as Map<*, *>
        val searchMax = (perf["morningSearchMaxMs"] as Double).toLong()
        val eventMax = (perf["eventMaxMs"] as Double).toLong()
        val now = hhmm(base["now"] as String)
        val here = latLng(base["here"])

        // 예열 뒤 5번 재서 중앙값
        repeat(3) { Planner.morning(now, here, profile, places, sky) }
        val search = (1..5).map { ms { Planner.morning(now, here, profile, places, sky) } }.sorted()[2]
        println("아침 완전탐색 ${places.size}곳: 중앙값 ${search}ms")
        assertTrue("아침 완전탐색 ${search}ms > ${searchMax}ms", search <= searchMax)

        val events = (perf["events"] as List<*>).map { it as Map<*, *> }
        fun run(): List<Long> {
            val engine = LiveCourseEngine(profile, places)
            var course = baseCourse()
            return events.map { e ->
                var out: Outcome? = null
                val t = ms { out = engine.apply(course, event(e, course), ctx(e)) }
                course = out!!.course
                t
            }
        }
        repeat(3) { run() }
        val runs = (1..5).map { run() }
        val worstMedian = events.indices.maxOf { i -> runs.map { it[i] }.sorted()[2] }
        println("사건 ${events.size}개 연속: 사건마다 중앙값 최대 ${worstMedian}ms (${runs.last().joinToString()})")
        assertTrue("사건 처리 ${worstMedian}ms > ${eventMax}ms", worstMedian <= eventMax)
    }

    private inline fun ms(block: () -> Unit): Long {
        val t0 = System.nanoTime(); block(); return (System.nanoTime() - t0) / 1_000_000
    }

    private fun check(c: Map<*, *>) {
        val name = c["name"] as String
        val prof = caseProfile(c)
        val engine = LiveCourseEngine(prof, places)
        var course = baseCourse(prof, caseSky(c))
        var outcome: Outcome? = null
        var proposal: Outcome.Proposal? = null
        var lastNow = 0
        for (e in c["events"] as List<*>) {
            val m = e as Map<*, *>
            outcome = engine.apply(course, event(m, course), ctx(m))
            course = outcome.course
            lastNow = hhmm(m["now"] as String)
            if (outcome is Outcome.Proposal) proposal = outcome
        }
        val o = requireNotNull(outcome) { "$name: 사건이 없음" }
        val text = describe(name, o, course)
        println(text)
        val e = c["expect"] as Map<*, *>
        val msg = "[$name]\n$text"
        e["kind"]?.let { assertEquals(msg, it, o::class.simpleName) }
        e["remaining"]?.let { assertEquals(msg, it, course.remaining.map { s -> s.id }) }
        (e["status"] as Map<*, *>?)?.forEach { (id, st) -> assertEquals("$msg\n$id 상태", st, course.stops.last { it.id == id }.status.name) }
        e["arriveHome"]?.let { assertEquals(msg, it, course.arriveHomeMin.asHhmm()) }
        e["slack"]?.let { assertEquals(msg, (it as Double).toInt(), course.slackMin) }
        e["version"]?.let { assertEquals(msg, (it as Double).toInt(), course.version) }
        e["chip"]?.let { assertEquals(msg, it, o.change?.text) }
        e["voice"]?.let { assertEquals(msg, it, o.voice) }
        e["size"]?.let { assertEquals(msg, it, o.change?.size?.name) }
        e["cause"]?.let { assertEquals(msg, it, o.change?.cause) }
        e["deltaHome"]?.let { assertEquals(msg, (it as Double).toInt(), o.change?.deltaHomeMin) }
        val options = (o as? Outcome.Proposal)?.options.orEmpty()
        e["labels"]?.let { assertEquals(msg, it, options.map { x -> x.label }) }
        e["optionStops"]?.let { assertEquals(msg, it, options.map { x -> x.stops.map(Place::id) }) }
        e["optionArriveHome"]?.let { assertEquals(msg, it, options.map { x -> x.arriveHomeMin.asHhmm() }) }
        e["napDrive"]?.let { assertEquals(msg, it, course.napLeg != null) }
        e["roadFactor"]?.let { assertEquals(msg, it as Double, course.roadFactor, 0.001) }
        e["dwellScale"]?.let { assertEquals(msg, it as Double, course.dwellScale, 0.001) }
        (e["dwellSet"] as List<*>?)?.let { ids -> assertEquals(msg, ids, course.stops.filter { it.dwellSet }.map { it.id }) }
        (e["dwell"] as Map<*, *>?)?.forEach { (id, d) -> assertEquals("$msg\n$id 머무름", (d as Double).toInt(), course.stops.last { it.id == id }.dwellGuessMin) }
        e["warnings"]?.let { assertEquals(msg, it, course.warnings) }
        e["end"]?.let { assertEquals(msg, it, course.endName) }
        e["limit"]?.let { assertEquals(msg, it, course.limitMin.asHhmm()) }
        if (e.containsKey("proposalExpired")) {
            val p = requireNotNull(proposal) { "$msg\n제안이 없음" }
            val chk = c["check"] as Map<*, *>?
            val at = (chk?.get("at") as String?)?.let(::hhmm) ?: lastNow
            val visited = (chk?.get("visited") as List<*>?)?.map { it as String }?.toSet() ?: emptySet()
            assertEquals("$msg\n제안 지남 (${at.asHhmm()})", e["proposalExpired"], engine.proposalExpired(p.course, p.options, course, at, visited))
        }
        (e["explain"] as Map<*, *>?)?.let { x ->
            val chk = c["check"] as Map<*, *>?
            val at = (chk?.get("explainAt") as String?)?.let(::hhmm) ?: lastNow
            val ex = engine.explain(course, at, options, sky?.sunsetMin)
            println("   설명(${at.asHhmm()}) ${ex.headline} / ${ex.body} / ${ex.action} ${ex.homeMin?.asHhmm() ?: ""}")
            assertEquals("$msg\n설명 제목", x["headline"], ex.headline)
            assertEquals("$msg\n설명 본문", x["body"], ex.body)
            assertEquals("$msg\n설명 할 일", x["action"], ex.action?.name)
            x["home"]?.let { assertEquals("$msg\n설명 귀가", it, ex.homeMin?.asHhmm()) }
        }
        if (o.change != null) assertTrue("$msg\n칩 40자 초과", o.change!!.text.length <= LiveCourseEngine.CHIP_MAX)
        // 어느 사례든: 시간표는 지금부터 귀가까지 이어지고, 제안 카드는 모두 한계 안
        assertEquals(msg, course.arriveHomeMin, course.legs.last().toMin)
        course.legs.zipWithNext().forEach { (a, b) -> assertEquals(msg, a.toMin, b.fromMin) }
        for (x in options) assertTrue("$msg\n카드 ${x.label} 한계 넘음", x.arriveHomeMin <= course.limitMin)
    }

    private fun describe(name: String, o: Outcome?, c: LiveCourse) = buildString {
        append("── $name: ${o?.let { it::class.simpleName } ?: "-"} v${c.version} 귀가 ${c.arriveHomeMin.asHhmm()} 한계 ${c.limitMin.asHhmm()} 여유 ${c.slackMin}분")
        append(" 계수 ${c.roadFactor} 머무름×${c.dwellScale}${if (c.napTaken) " 낮잠끝" else ""}${if (c.napOff) " 낮잠끔" else ""} 끝 ${c.endName}\n")
        append("   장소 ").append(c.stops.joinToString(" → ") { "${it.place.name}[${it.status} ${it.plannedArriveMin.asHhmm()}-${it.plannedDepartMin.asHhmm()} ${it.dwellGuessMin}분]" }).append('\n')
        append("   막대 ").append(c.legs.joinToString(" ") { "${it.kind}${it.placeId?.let { id -> ":$id" } ?: ""} ${it.fromMin.asHhmm()}-${it.toMin.asHhmm()}" }).append('\n')
        if (c.warnings.isNotEmpty()) append("   경고 ").append(c.warnings.joinToString(" | ")).append('\n')
        o?.change?.let { append("   칩(${it.size} ${it.cause} ${it.deltaHomeMin}분) ${it.text}\n") }
        o?.voice?.let { append("   음성 $it\n") }
        (o as? Outcome.Proposal)?.options?.forEach { x ->
            append("   [${x.label}] ${x.stops.joinToString(" → ") { it.name }.ifEmpty { "집" }} · 귀가 ${x.arriveHomeMin.asHhmm()} · ${x.reasonTexts.joinToString(" | ")}\n")
        }
    }

    // ---- JSON → 엔진 값 ----

    private fun ctx(m: Map<*, *>) = CourseCtx(driving = m["driving"] == true, here = m["here"]?.let(::latLng))

    private fun event(m: Map<*, *>, course: LiveCourse): CourseEvent {
        val now = hhmm(m["now"] as String)
        return when (val t = m["type"] as String) {
            "Departed" -> CourseEvent.Departed(now, m["from"] as String?)
            "Arrived" -> CourseEvent.Arrived(now, m["place"] as String)
            "StillParked" -> CourseEvent.StillParked(now)
            "NaviEta" -> CourseEvent.NaviEta(now, (m["remainMin"] as Double).toInt())
            "StillDriving" -> CourseEvent.StillDriving(now, latLng(m["here"]))
            "ReplaceNext" -> CourseEvent.ReplaceNext(now, m["place"] as String)
            "Skip" -> CourseEvent.Skip(now, m["place"] as String)
            "Insert" -> CourseEvent.Insert(now, m["place"] as String)
            "Weather" -> CourseEvent.Weather(now, Sky.valueOf(m["sky"] as String), (m["rainFrom"] as String?)?.let(::hhmm), (m["air"] as String?)?.let(AirLevel::valueOf))
            "PlaceClosed" -> CourseEvent.PlaceClosed(now, m["place"] as String)
            "GoHome" -> CourseEvent.GoHome(now)
            "LimitChanged" -> CourseEvent.LimitChanged(now, hhmm(m["limit"] as String))
            "Tick" -> CourseEvent.Tick(now)
            "SetDwell" -> CourseEvent.SetDwell(now, m["place"] as String, (m["minutes"] as Double).toInt())
            "ExtendStay" -> CourseEvent.ExtendStay(now, (m["minutes"] as Double).toInt())
            "SetEnd" -> {
                val end = m["end"]
                CourseEvent.SetEnd(
                    now,
                    end = (end as? Map<*, *>)?.let { CourseEnd(it["name"] as String, latLng(it["at"])) },
                    toHome = end == "home",
                    limitMin = (m["limit"] as String?)?.let(::hhmm),
                    napOff = m["napOff"] as Boolean?,
                )
            }
            "Remote" -> {
                val ids = (m["stops"] as List<*>).map { it as String }
                val remote = course.copy(
                    version = (m["version"] as Double).toInt(),
                    chosenBy = m["by"] as String? ?: course.chosenBy,
                    stops = ids.map { id -> LiveStop(place(id), StopStatus.PLANNED, now, now, dwellGuessMin = place(id).dwellP80Min) },
                )
                CourseEvent.Remote(now, remote.version, remote)
            }
            else -> error("사건 종류: $t")
        }
    }

    private fun latLng(v: Any?): LatLng = (v as List<*>).let { LatLng(it[0] as Double, it[1] as Double) }

    private fun sky(s: Map<*, *>?): SkyToday? = s?.let {
        SkyToday(
            (it["sunrise"] as String?)?.let(::hhmm), (it["sunset"] as String?)?.let(::hhmm),
            Sky.valueOf((it["sky"] as String?) ?: "UNKNOWN"), (it["rainFrom"] as String?)?.let(::hhmm),
            (it["air"] as String?)?.let(AirLevel::valueOf),
        )
    }

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
        )
    }
}
