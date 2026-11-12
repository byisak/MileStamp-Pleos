package kr.milestamp.engine

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 살아 있는 코스의 판정 (docs/코스-고도화-계획.md 2절). 사건 하나를 넣으면 답([Outcome]) 하나.
 *
 * 판정 순서 (모든 사건 공통)
 * 1. retime — 남은 장소 순서 유지, 출발점 = 지금 위치·시각. 이동 = 내비 ETA(다음 구간, 두 번 연속 확인) > 어림(계수 보정).
 *    머무름 = 보정된 예상. 탐색용 규칙(깨어 있는 이동 60분 초과·문 열기 30분 기다림·비 맞는 야외)은 경고 칩으로만 두고
 *    시간표를 버리지 않는다. 문 닫는 시각으로 자르는 것(그리고 닫기 전 30분도 못 있으면 '못 감')은 그대로.
 * 2. 한계 안이고 변화가 작으면 → NoChange(5분 미만) / Retimed(5~15분 QUIET, 15분↑ LOUD).
 * 3. 한계를 넘으면 → '덜 놀기'(넘긴 만큼 마지막 곳 머무름 줄이기, 30분 이내) → 뒤에서부터 한 곳씩 빼 보기 → 다 안 되면 HomeNow.
 * 4. 여유 ≥ 45분(머무름 30 + 우회 15)이면 '한 곳 더' 1장 (기존 재탑승 점수식).
 * 5. 낮잠 이동이 깨지면(정차 중 출발 준비) '더 머물기' 안을 먼저.
 * 6. 야외 머무름에 비가 걸치면 실내 교체안 (지금 머무는 곳이면 '비 오기 전 출발').
 * 7. 마지막 남은 곳에서 다시 타면(정차 중 출발 준비) 코스를 버리지 않고 '한 곳 더'(여유 ≥ 45분일 때) + '바로 집으로' 카드.
 * 같은 원인의 LOUD는 30분에 한 번. 떠 있는 제안이 지났는지는 [proposalExpired]. 서버(TS)가 이 파일을 그대로 옮긴다 — 계산 순서·동점 처리까지 맞춘다.
 */
class LiveCourseEngine(
    var profile: FamilyProfile,
    /** 교체·들르기·'한 곳 더' 후보. */
    var catalog: List<Place>,
) {
    /** 오늘 날짜 'YYYY-MM-DD' — 교체·'한 곳 더' 후보의 축제 기간 판단([Planner.forDay]). 모르면 축제는 빠진다. */
    var day: String? = null

    companion object {
        /** 이 미만 변화는 NoChange. */
        const val QUIET_MIN = 5
        /** 이 이상 변화는 칩 + 음성. */
        const val LOUD_MIN = 15
        /** 여유가 이만큼이면 '한 곳 더' (최소 머무름 30 + 우회 15). */
        const val EXTRA_SLACK_MIN = 45
        /** 같은 원인 LOUD 반복 간격. */
        const val SAME_CAUSE_MIN = 30
        /** 내비 ETA가 어림과 이만큼(분) 또는 비율로 다르면 반영. */
        const val ETA_DIFF_MIN = 8
        const val ETA_DIFF_RATIO = 0.15
        /** 짧은 구간의 ETA는 계수 보정에 안 쓴다 (주차·유턴 잡음). */
        const val ETA_MIN_LEG_MIN = 10
        const val EMA_ALPHA = 0.3
        const val FACTOR_MIN = 0.8
        const val FACTOR_MAX = 2.5
        /** 예정의 이 비율 미만으로 머물면 오늘 패턴 ×0.9. */
        const val DWELL_SHORT_RATIO = 0.8
        const val DWELL_SCALE = 0.9
        /** 한계를 이만큼까지 넘기면 '덜 놀기'로 맞춰 본다. */
        const val SHORTEN_MAX_MIN = 30
        /** 내비 없이 늦어질 때 남은 구간 어림의 최소(분) — 거의 다 왔어도 주차까지. */
        const val STILL_DRIVING_MIN_REMAIN = 3
        /** 건너뛴 까닭: 문 닫을 시간이라 못 감 ([LiveStop.skipReason]). */
        const val CLOSED = "문 닫음"
        /** 칩 글자 수 상한. */
        const val CHIP_MAX = 40

        /** 받침에 따라 조사 고르기 ("을/를", "이/가", "은/는", "으로/로" — ㄹ 받침은 '로'). */
        fun josa(word: String, pair: String): String {
            val code = word.lastOrNull()?.code ?: return word
            val jong = if (code in 0xAC00..0xD7A3) (code - 0xAC00) % 28 else 0
            val (a, b) = pair.split("/")
            val useA = jong != 0 && !(pair == "으로/로" && jong == 8)
            return word + if (useA) a else b
        }

        /** 미세먼지 경고 칩: '미세먼지 나쁨 · 마스크 챙기세요'. */
        fun airWarning(air: AirLevel): String = "미세먼지 ${air.text} · 마스크 챙기세요"

        /** 음성: '나빠요' / '매우 나빠요'. */
        fun airVoice(air: AirLevel): String = if (air == AirLevel.VERY_BAD) "매우 나빠요" else "나빠요"

        /** 분 → "1시간 30분" / "45분". */
        fun dur(min: Int): String = when {
            min < 60 -> "${min}분"
            min % 60 == 0 -> "${min / 60}시간"
            else -> "${min / 60}시간 ${min % 60}분"
        }

        /** '앞으로 N분 더': 0~360분, 5분 단위. */
        fun extendMin(min: Int): Int = DwellLearning.round5(min.toDouble()).coerceIn(0, DwellLearning.MAX_MIN)

        /** 칩 글: 조각을 ' · '로 잇고 40자에서 자른다. */
        fun chip(vararg parts: String?): String {
            val s = parts.filterNotNull().filter { it.isNotEmpty() }.joinToString(" · ")
            return if (s.length <= CHIP_MAX) s else s.substring(0, CHIP_MAX - 1) + "…"
        }
    }

    /** 이동 시간 어림 (계수 보정 반영). */
    fun estimate(a: LatLng, b: LatLng, factor: Double): Int = (Geo.km(a, b) * factor / TravelTime.AVG_KMH * 60).roundToInt()

    // ------------------------------------------------------------------ 사건 → 답

    fun apply(course: LiveCourse, event: CourseEvent, ctx: CourseCtx = CourseCtx()): Outcome = when (event) {
        is CourseEvent.Remote -> remote(course, event, ctx)
        is CourseEvent.GoHome -> goHome(course, event.nowMin, ctx)
        is CourseEvent.NaviEta -> naviEta(course, event, ctx)
        is CourseEvent.StillDriving -> stillDriving(course, event)
        else -> mutate(course, event, ctx)?.let { judge(course, it) } ?: Outcome.NoChange(course)
    }

    /** 사용자가 제안 카드 하나를 골랐다 → 그 카드대로 코스를 바꾼다. 카드의 [PlanOption.stops]는 남은 장소 전체 순서. */
    fun adopt(course: LiveCourse, option: PlanOption, nowMin: Int, ctx: CourseCtx = CourseCtx()): Outcome {
        val ids = option.stops.map { it.id }
        val old = course.stops
        val stops = mutableListOf<LiveStop>()
        // 다녀온 곳·머무는 곳은 그대로 (머무는 곳은 카드의 머무름 칸으로 끝 시각을 바꿀 수 있다)
        for (s in old) if (!s.remaining) {
            val stay = option.legs.firstOrNull { it.isStay && it.placeId == s.id }
            stops += if (s.status == StopStatus.ARRIVED && stay != null) {
                s.copy(dwellGuessMin = max(0, stay.toMin - max(s.actualArriveMin ?: stay.fromMin, s.place.openMin)))
            } else s
        }
        // 남은 곳은 카드 순서대로 (카드에 없는 곳은 뺌)
        for (s in old) if (s.remaining && s.id !in ids) stops += s.copy(status = StopStatus.SKIPPED)
        for (p in option.stops) {
            val prev = old.firstOrNull { it.id == p.id && it.remaining }
            val stay = option.legs.firstOrNull { it.isStay && it.placeId == p.id }
            val dwell = stay?.let { it.toMin - max(it.fromMin, p.openMin) } ?: prev?.dwellGuessMin ?: profile.dwellFor(p)
            stops += (prev ?: LiveStop(p, StopStatus.PLANNED, nowMin, nowMin, dwellGuessMin = dwell)).copy(dwellGuessMin = max(0, dwell))
        }
        val d = Draft(course, max(nowMin, option.legs.firstOrNull()?.fromMin ?: nowMin), ctx.here ?: course.here)
        d.stops = fixNext(stops)
        d.cause = Cause("선택", option.label, "${option.label}로 갈게요.")
        d.forced = true
        d.noExtra = true
        d.noRain = true
        val tt = retime(d)
        val made = finish(course, d, tt)
        val change = Change(chip(option.label, homeChip(d, tt.arriveHomeMin.asHhmm())), "선택", tt.arriveHomeMin - course.arriveHomeMin, ChangeSize.SOFT, d.now)
        val out = made.copy(lastChange = change)
        return if (out.remaining.isEmpty() && out.current == null) {
            Outcome.HomeNow(bump(course, out), change, "${josa(out.endName, "으로/로")} 안내할게요. ${tt.arriveHomeMin.asHhmm()}쯤 도착해요.")
        } else {
            Outcome.Retimed(bump(course, out), change, "${option.label}. ${out.endName}에는 ${tt.arriveHomeMin.asHhmm()}쯤 도착해요.")
        }
    }

    /** '바로 집으로' 카드 (한계 침범 때 확인용): 남은 곳을 모두 빼고 지금 떠나는 시간표. */
    fun goHomeOption(course: LiveCourse, nowMin: Int, ctx: CourseCtx = CourseCtx()): PlanOption =
        goHome(course, nowMin, ctx).course.let { it.asOption("바로 ${josa(it.endName, "으로/로")}") }

    /**
     * 떠 있는(보류 중이거나 화면에 있는) 제안이 지났는지. 지났으면 이유 글, 아직 쓸 수 있으면 null.
     *  1. 제안을 낸 뒤 다른 사건이 코스를 바꿨다 (버전이 다름)
     *  2. 카드가 새로 넣는 첫 장소에 이미 도착했거나 다녀왔다 ([visited] = 차가 오늘 실제로 선 장소, 코스 밖 포함)
     *  3. 카드가 권한 출발 시각(제안 시각보다 뒤, 예: '12:50에 출발')이 지났다
     * [proposed]는 제안을 낼 때의 코스(Proposal 답의 course), [course]는 지금 코스. 카드 하나라도 지났으면 제안 전체가 지난 것.
     */
    fun proposalExpired(proposed: LiveCourse, options: List<PlanOption>, course: LiveCourse, nowMin: Int, visited: Set<String> = emptySet()): String? {
        if (course.version != proposed.version) return "코스가 바뀌었어요"
        for (o in options) {
            val fresh = o.stops.firstOrNull { p -> proposed.remaining.none { it.id == p.id } }
            if (fresh != null && (fresh.id in visited || course.stops.any { it.id == fresh.id && (it.status == StopStatus.ARRIVED || it.status == StopStatus.DONE) })) {
                return "${fresh.name}에 이미 갔어요"
            }
            val depart = o.legs.firstOrNull { !it.isStay }?.fromMin
            if (depart != null && depart > proposed.nowMin && nowMin > depart) return "${depart.asHhmm()} 출발이 지났어요"
        }
        return null
    }

    /** 사건 이름 (보류 칩 등에 쓰는 짧은 글). [course] = 지금 코스 — 장소 목록 밖의 바깥 장소('ext:…') 이름을 거기서 찾는다. */
    fun describe(event: CourseEvent, course: LiveCourse? = null): String {
        fun name(id: String) = name(id, course)
        return when (event) {
            is CourseEvent.Departed -> "출발"
            is CourseEvent.Arrived -> "${name(event.placeId)} 도착"
            is CourseEvent.StillParked -> "정차 중"
            is CourseEvent.NaviEta -> "내비 ${event.remainMin}분"
            is CourseEvent.StillDriving -> "아직 가는 중"
            is CourseEvent.ReplaceNext -> "다음은 ${name(event.placeId)}"
            is CourseEvent.Skip -> "${name(event.placeId)} 빼기"
            is CourseEvent.Insert -> "${name(event.placeId)} 들르기"
            is CourseEvent.Weather -> {
                val rain = if (event.sky == Sky.RAIN) "비" else event.rainFromMin?.let { "비 ${it.asHhmm()}부터" }
                listOfNotNull(rain ?: if (event.air == null) "비 소식 없음" else null, event.air?.let { "미세먼지 ${it.text}" }).joinToString(" · ")
            }
            is CourseEvent.PlaceClosed -> "${name(event.placeId)} 문 닫음"
            is CourseEvent.GoHome -> "집으로"
            is CourseEvent.LimitChanged -> "귀가 한계 ${event.limitMin.asHhmm()}"
            is CourseEvent.Remote -> "${event.course.chosenBy}의 코스 v${event.version}"
            is CourseEvent.Tick -> "시간 지남"
            is CourseEvent.SetDwell -> "${name(event.placeId)} ${DwellLearning.clampUser(event.minutes)}분"
            is CourseEvent.ExtendStay -> if (event.minutes <= 0) "지금 나갈게요" else "${dur(extendMin(event.minutes))} 더"
            is CourseEvent.SetEnd -> listOfNotNull(
                if (event.toHome) "도착지 집" else event.end?.let { "도착지 ${it.name}" },
                event.limitMin?.let { "${it.asHhmm()}까지 도착" },
                event.napOff?.let { if (it) "오늘 낮잠 안 자요" else "낮잠 다시 맞춤" },
            ).joinToString(" · ").ifEmpty { "도착지 그대로" }
        }
    }

    /** 장소 목록 → 코스에 실린 곳(바깥 장소) → [stopName]. */
    private fun name(id: String, course: LiveCourse?) =
        catalog.firstOrNull { it.id == id }?.name ?: stopName(id, course?.stops?.firstOrNull { it.id == id }?.place?.name)

    /** 사건의 장소: 장소 목록 → 코스에 이미 있던 곳 (목록 밖 바깥 장소도 순서 바꾸기·다시 들르기가 되게). */
    private fun placeOf(id: String, c: LiveCourse): Place? = catalog.firstOrNull { it.id == id } ?: c.stops.firstOrNull { it.id == id }?.place

    // ------------------------------------------------------------------ 시간 흐름 · 쉬운 설명

    /**
     * 시간표가 [nowMin]보다 얼마나 뒤처졌는지(분). 머무는 곳이 있으면 그 예정 출발, 없으면 다음 곳 예정 도착이 기준.
     * 주행 중 늦어짐은 차가 StillDriving으로 따로 알리니, 이 값이 크면 보통 '아직 출발 안 함'·'차가 꺼져 있음'이다.
     */
    fun behindMin(c: LiveCourse, nowMin: Int): Int {
        if (nowMin <= c.nowMin) return 0
        val due = c.current?.plannedDepartMin ?: c.next?.plannedArriveMin ?: return 0
        return max(0, nowMin - max(due, c.nowMin))
    }

    /** 남은 곳 중 문 닫기 전에 못 가는 곳이 있는지 (시간표 경고). */
    private fun hasClosed(c: LiveCourse) = c.remaining.any { s -> c.warnings.any { it.startsWith("${s.place.name} 문 닫기 전에 못 가요") } }

    /** [CourseEvent.Tick]이 무언가를 바꿀지 (5분 넘게 뒤처짐 또는 못 가는 곳이 있음). */
    fun needsTick(c: LiveCourse, nowMin: Int): Boolean = behindMin(c, nowMin) >= QUIET_MIN || hasClosed(c)

    /**
     * 코스 화면 맨 위 쉬운 설명 — 제목 한 줄 + 해요체 한두 문장, 엔진 값으로만 만든다 ('한계'·'여유' 같은 말은 안 쓴다).
     * [nowMin]은 지금 시각(벽시계). 시간표가 뒤처졌으면 [CourseEvent.Tick]을 해 본 결과로 설명한다(저장은 안 함).
     * [options]는 떠 있는 제안 카드(첫 장 = 가장 좋은 안), [sunsetMin]이 있으면 '해 지기 N분 전'.
     * 순서: 제안 → 집으로 가는 중 → 늦음(지금 집으로 / 아직 집이면 오늘은 마치기) → 계획대로.
     */
    fun explain(course: LiveCourse, nowMin: Int, options: List<PlanOption> = emptyList(), sunsetMin: Int? = null): Explanation {
        var c = course
        var opts = options
        if (needsTick(course, nowMin)) {
            val o = apply(course, CourseEvent.Tick(nowMin))
            if (o !is Outcome.NoChange) { c = o.course; opts = (o as? Outcome.Proposal)?.options.orEmpty() }
        }
        val now = max(nowMin, c.nowMin)
        val rem = c.remaining
        val cur = c.current
        val homeAt = c.arriveHomeMin.asHhmm()
        /** 도착지 이름 (집 또는 오늘만 바꾼 곳). */
        val dest = c.endName

        // 문 닫을 시간이라 못 가는 곳 (시간표 경고 + 방금 Tick이 건너뛴 곳), 집에서 아직 안 떠났는지
        val warnClosed = rem.filter { s -> c.warnings.any { it.startsWith("${s.place.name} 문 닫기 전에 못 가요") } }
        // 문 닫아 건너뛴 곳: 방금 해 본 Tick이 건너뛴 곳 + 마지막 변경이 '문 닫음'이면 그때 건너뛴 곳
        val tickSkipped = course.remaining.filter { s -> c.stops.any { it.id == s.id && it.status == StopStatus.SKIPPED } }
        val lastClosed = if (c.lastChange?.cause == CLOSED) c.stops.filter { it.status == StopStatus.SKIPPED && it.skipReason == CLOSED } else emptyList()
        val closed = (lastClosed + tickSkipped + warnClosed).map { it.place.name }.distinct()
        val others = rem.filter { s -> warnClosed.none { it.id == s.id } }.map { it.place.name }
        val home = goHome(c, now, CourseCtx()).course.arriveHomeMin
        val started = c.stops.any { it.status == StopStatus.DONE || it.status == StopStatus.ARRIVED } || home - now > 5
        val late = c.arriveHomeMin > c.limitMin || warnClosed.isNotEmpty()
        /** 아직 집(출발 전)인데 지금 떠나도 너무 늦다 → 오늘 코스는 마치기. */
        fun notStarted(): Explanation {
            val first = if (closed.isNotEmpty()) "${josa(closed.joinToString("·"), "은/는")} 벌써 문 닫을 시간이에요. " else ""
            val second = if (others.isNotEmpty() && late) "남은 곳까지 다녀오면 ${homeAt}에야 ${dest}에 와요." else "오늘은 집에서 쉬어요."
            return Explanation("오늘은 다음에 가는 게 좋겠어요", first + second, ExplainAction.END, home, warn = true)
        }

        // 1. 제안 카드 → 가장 좋은 안을 한 문장으로 (모두 빼는 안인데 아직 집이면 '오늘은 다음에')
        opts.firstOrNull()?.let { return if (it.stops.isEmpty() && !started) notStarted() else explainOption(c, it) }

        // 2. 남은 곳이 없고 머무는 곳도 없음 → 집으로 가는 길
        if (rem.isEmpty() && cur == null) {
            val n = c.stops.count { it.status == StopStatus.DONE }
            return Explanation("${josa(dest, "으로/로")} 가는 길이에요", (if (n > 0) "오늘 ${n}곳을 다녀왔어요. " else "") + "${dest}에는 ${homeAt}쯤 도착해요.")
        }


        // 3. 늦음: 집 도착이 귀가 목표를 넘거나, 문 닫기 전에 못 가는 곳이 있음
        if (late) {
            if (!started) return notStarted()
            val second = when {
                closed.isNotEmpty() && others.isEmpty() -> "남은 ${josa(closed.joinToString("·"), "은/는")} 문을 닫아서 다음에 가요."
                closed.isNotEmpty() -> "${josa(closed.joinToString("·"), "은/는")} 문을 닫았고, ${josa(others.joinToString("·"), "은/는")} 다음에 가요."
                others.isNotEmpty() -> "남은 ${josa(others.joinToString("·"), "은/는")} 다음에 가요."
                else -> "더 머물면 너무 늦어져요."
            }
            return Explanation("오늘은 여기까지가 좋겠어요", "지금 바로 출발하면 ${dest}에 ${home.asHhmm()}에 도착해요. $second", ExplainAction.GO_HOME, home, warn = true)
        }

        // 4. 계획대로
        val last = c.lastChange?.takeIf { now - it.atMin <= SAME_CAUSE_MIN }
        val headline = when {
            // 도착지·도착 목표를 바꾼 직후: 귀가 변화는 '일찍·늦게'가 아니라 바꾼 결과
            last?.cause == "도착지" -> if (c.end != null) "오늘은 ${josa(dest, "으로/로")} 가요" else "계획대로 가고 있어요"
            // 머무름을 바꾼 직후: 무엇을 바꿨는지 ('국립대구과학관을 90분으로 바꿨어요')
            // (제안 칩이었으면 글이 '과학관 90분'이라 일반 제목으로)
            last?.cause == "머무름" -> last.text.substringBefore(" · ").takeIf { it.endsWith("요") } ?: "머무는 시간을 바꿨어요"
            last != null && last.deltaHomeMin >= QUIET_MIN -> "조금 늦어졌지만 괜찮아요"
            last != null && last.deltaHomeMin <= -QUIET_MIN -> "예정보다 일찍 가고 있어요"
            else -> "계획대로 가고 있어요"
        }
        val next = c.next
        // 머무는 곳의 나설 시각이 지금(2분 안)이면 '지금 나서면'
        val leaveNow = cur != null && cur.plannedDepartMin <= now + 2
        val first = when {
            cur != null && next != null && leaveNow -> "지금 나서면 ${next.place.name}에 ${next.plannedArriveMin.asHhmm()}에 도착해요."
            cur != null && next != null -> "${cur.plannedDepartMin.asHhmm()}에 나서면 ${next.place.name}에 ${next.plannedArriveMin.asHhmm()}에 도착해요."
            cur != null && leaveNow -> "이제 ${cur.place.name}에서 나설 시간이에요."
            cur != null -> "${cur.place.name}에서 ${cur.plannedDepartMin.asHhmm()}까지 놀고 집으로 가요."
            next != null -> "다음은 ${next.place.name}, ${next.plannedArriveMin.asHhmm()}에 도착해요."
            else -> ""
        }
        if (closed.isNotEmpty()) {
            // 문 닫을 시간이라 건너뛴 곳이 있지만 나머지는 시간 안 → 그 얘기 먼저
            return Explanation("계획을 조금 바꿨어요", "${josa(closed.joinToString("·"), "은/는")} 문 닫을 시간이라 건너뛰어요. $first".trim())
        }
        val second = if (sunsetMin != null && c.arriveHomeMin < sunsetMin) "${dest}에는 ${homeAt}쯤, 해 지기 ${dur(sunsetMin - c.arriveHomeMin)} 전에 와요."
        else "${dest}에는 ${homeAt}쯤 와요."
        return Explanation(headline, "$first $second".trim())
    }

    /** 제안 카드 한 장 → 쉬운 설명. 카드 제목은 이 엔진이 만든 글이라 모양으로 종류를 가린다. */
    private fun explainOption(c: LiveCourse, o: PlanOption): Explanation {
        val arr = o.arriveHomeMin.asHhmm()
        val label = o.label
        val depart = o.legs.firstOrNull { !it.isStay }?.fromMin?.asHhmm()
        val dest = c.endName
        return when {
            label.startsWith("한 곳 더 · ") -> {
                val p = o.stops.last()
                Explanation("한 곳 더 갈 수 있어요", "${p.name}에 들렀다 가도 ${dest}에 ${arr}쯤 도착해요.")
            }
            label.startsWith("비 오기 전 ") ->
                Explanation("곧 비가 와요", "${depart}에 먼저 나서면 비를 피할 수 있어요. ${dest}에는 ${arr}쯤 도착해요.")
            label.endsWith("에 출발") ->
                Explanation("조금 더 놀다 가도 돼요", "${depart}에 출발하면 아이들이 차에서 낮잠을 잘 수 있어요. ${dest}에는 ${arr}쯤 도착해요.")
            label.endsWith(" 덜 놀기") -> {
                val parts = label.removeSuffix(" 덜 놀기")
                val name = parts.substringBeforeLast(" ")
                val less = parts.substringAfterLast(" ")
                Explanation("이대로면 조금 늦어요", "${name}에서 ${less}만 덜 놀면 ${dest}에 ${arr}에 도착해요.", warn = true)
            }
            label.endsWith(" 빼기") -> {
                val names = label.removeSuffix(" 빼기")
                Explanation("이대로면 늦어요", "${josa(names, "을/를")} 빼면 ${dest}에 ${arr}에 도착해요.", warn = true)
            }
            o.stops.isEmpty() -> Explanation("바로 ${josa(dest, "으로/로")} 갈까요", "지금 출발하면 ${dest}에 ${arr}쯤 도착해요.")
            label.contains(" → ") -> {
                val old = label.substringBefore(" → ")
                val new = label.substringAfter(" → ")
                val why = when (c.lastChange?.cause) {
                    "문 닫음" -> "${josa(old, "이/가")} 문을 닫았어요. "
                    "비" -> "비가 와서 실내로 바꾸면 좋아요. "
                    else -> ""
                }
                Explanation("$old 대신 $new 어때요", "$why${josa(new, "으로/로")} 바꾸면 ${dest}에 ${arr}쯤 도착해요.")
            }
            else -> Explanation("이렇게 바꾸면 좋겠어요", "${label}, ${dest}에는 ${arr}쯤 도착해요.")
        }
    }

    // ------------------------------------------------------------------ 작업 중인 초안

    /** 원인: [key]는 30분 반복 판정용, [chip]은 칩 머리, [voice]는 음성 첫 문장. */
    private class Cause(val key: String, val chip: String, val voice: String)

    /** 사건을 반영하는 동안의 작업 복사본. */
    private class Draft(c: LiveCourse, var now: Int, var here: LatLng?) {
        var stops: List<LiveStop> = c.stops
        var limit = c.limitMin
        var rain = c.rainFromMin
        var air = c.air
        var factor = c.roadFactor
        var dwellScale = c.dwellScale
        var napTaken = c.napTaken
        var chosenBy = c.chosenBy
        var version = c.version
        var end = c.end
        var napOff = c.napOff
        var userLimit = c.userLimit
        /** 낮잠 이동을 짜지 않음 (이미 했거나 오늘은 안 잠). */
        val noNap: Boolean get() = napTaken || napOff
        /** 시간표 끝 (도착지 또는 집). */
        val endName: String get() = end?.name ?: "집"
        /** 카드 이유 칩의 도착 글: 집이면 '16:47 귀가', 다른 도착지면 '할머니 집 16:29 도착' (도착지 이름 그대로). */
        fun arriveWord(min: Int): String = if (end == null) "${min.asHhmm()} 귀가" else "$endName ${min.asHhmm()} 도착"
        /** 다음 구간에 쓸 내비 ETA. */
        var eta: Int? = null
        var cause = Cause("", "", "")
        /** 머무름을 바꾼 한 줄 ('국립대구과학관을 90분으로 바꿨어요') — 칩·쉬운 설명 제목. */
        var note: String? = null
        /** 사용자 명령 → 변화가 작아도 칩(SOFT). */
        var forced = false
        /** '한 곳 더'를 따지지 않음. */
        var noExtra = false
        /** 비 교체안을 따지지 않음. */
        var noRain = false
        /** 정차 중 출발 준비 → 낮잠 '더 머물기' 안을 따진다. */
        var stretchCheck = false
        /** 마지막 남은 곳에서 정차 중 출발 준비 → '한 곳 더' + '바로 집으로' 카드. */
        var lastStop = false
        /** 교체안을 넣을 자리 (문 닫음). */
        var replaceAt: Int? = null
        var replaced: Place? = null
    }

    private fun fixNext(stops: List<LiveStop>): List<LiveStop> {
        var first = true
        return stops.map { s ->
            if (!s.remaining) s
            else if (first) { first = false; s.copy(status = StopStatus.NEXT) }
            else s.copy(status = StopStatus.PLANNED)
        }
    }

    /** 머무는 곳을 떠난다. [learn]이면 오늘 패턴: 예정의 80% 미만으로 머물렀으면 남은 곳 머무름 ×0.9 (명령으로 떠날 땐 안 배움). */
    private fun leave(d: Draft, cur: LiveStop, now: Int, learn: Boolean = true) {
        val start = max(cur.actualArriveMin ?: now, cur.place.openMin)
        val actual = now - start
        d.stops = d.stops.map { if (it.id == cur.id && it.status == StopStatus.ARRIVED) it.copy(status = StopStatus.DONE, actualDepartMin = now) else it }
        if (learn && cur.dwellGuessMin > 0 && actual < DWELL_SHORT_RATIO * cur.dwellGuessMin && d.dwellScale == 1.0) {
            d.dwellScale = DWELL_SCALE
            d.stops = d.stops.map { if (it.remaining && !it.dwellSet) it.copy(dwellGuessMin = (profile.dwellFor(it.place) * DWELL_SCALE).roundToInt()) else it }
        }
    }

    private fun earlyLate(diff: Int, early: String, late: String, onTime: String): Cause = when {
        diff >= 10 -> Cause(early, "${diff}분 일찍", "${diff}분 일찍 나섰어요")
        diff <= -10 -> Cause(late, "${-diff}분 늦게", "${-diff}분 늦게 나섰어요")
        else -> Cause(onTime, onTime, "${onTime}했어요")
    }

    /** 사건을 초안에 반영한다. 반영할 게 없으면 null (NoChange). */
    private fun mutate(c: LiveCourse, e: CourseEvent, ctx: CourseCtx): Draft? {
        val d = Draft(c, e.nowMin, ctx.here ?: c.here)
        val now = e.nowMin
        when (e) {
            is CourseEvent.Departed -> {
                val cur = c.current
                if (cur != null) {
                    leave(d, cur, now)
                    d.here = ctx.here ?: cur.place.at
                    d.cause = earlyLate(cur.plannedDepartMin - now, "일찍 출발", "늦게 출발", "출발")
                    d.stretchCheck = !ctx.driving
                    d.lastStop = !ctx.driving && d.stops.none { it.remaining }
                } else {
                    d.cause = Cause("출발", "출발", "출발했어요")
                }
                d.stops = fixNext(d.stops)
            }
            is CourseEvent.Arrived -> {
                val place = catalog.firstOrNull { it.id == e.placeId } ?: c.stops.firstOrNull { it.id == e.placeId }?.place ?: return null
                c.current?.let { leave(d, it, it.actualDepartMin ?: now) }
                val idx = d.stops.indexOfFirst { it.id == e.placeId && it.remaining }
                val napNow = c.legs.any { it.kind == LegKind.NAP_DRIVE && it.placeId == e.placeId }
                if (idx >= 0) {
                    val s = d.stops[idx]
                    d.stops = d.stops.mapIndexed { i, x ->
                        when {
                            i == idx -> x.copy(status = StopStatus.ARRIVED, actualArriveMin = now)
                            i < idx && x.remaining -> x.copy(status = StopStatus.SKIPPED)
                            else -> x
                        }
                    }
                    val diff = s.plannedArriveMin - now
                    d.cause = when {
                        diff >= 10 -> Cause("도착", "${place.name} ${diff}분 일찍", "${place.name}에 ${diff}분 일찍 도착했어요")
                        diff <= -10 -> Cause("도착", "${place.name} ${-diff}분 늦게", "${place.name}에 ${-diff}분 늦게 도착했어요")
                        else -> Cause("도착", "${place.name} 도착", "${place.name}에 도착했어요")
                    }
                } else {
                    // 예정에 없던 곳 — 다음 목적지 앞에 끼워 넣는다
                    val at = d.stops.indexOfFirst { it.remaining }.let { if (it < 0) d.stops.size else it }
                    val stop = LiveStop(place, StopStatus.ARRIVED, now, now, actualArriveMin = now,
                        dwellGuessMin = (profile.dwellFor(place) * d.dwellScale).roundToInt())
                    d.stops = d.stops.toMutableList().apply { add(at, stop) }
                    d.cause = Cause("도착", "${place.name} 들름", "예정에 없던 ${place.name}에 들렀어요")
                    d.forced = true
                }
                d.napTaken = d.napTaken || napNow
                d.here = place.at
                d.stops = fixNext(d.stops)
            }
            is CourseEvent.StillParked -> {
                val cur = c.current
                d.cause = if (cur != null) Cause("머무름 길어짐", "아직 ${cur.place.name}", "${cur.place.name}에 예정보다 오래 있어요")
                else Cause("예상 밖 정차", "정차 중", "길에서 쉬었어요")
            }
            is CourseEvent.ReplaceNext -> {
                val place = placeOf(e.placeId, c) ?: return null
                val next = c.next
                if (next?.id == place.id) return null
                val at = d.stops.indexOfFirst { it.remaining }.let { if (it < 0) d.stops.size else it }
                val stop = LiveStop(place, StopStatus.NEXT, now, now, dwellGuessMin = (profile.dwellFor(place) * d.dwellScale).roundToInt())
                d.stops = fixNext(d.stops.filterNot { it.id == place.id && it.remaining }.toMutableList().apply { add(at, stop) })
                d.cause = Cause("다음 바꾸기", "다음은 ${place.name}", "다음은 ${josa(place.name, "으로/로")} 안내할게요")
                d.forced = true
            }
            is CourseEvent.Skip -> {
                val s = c.stops.firstOrNull { it.id == e.placeId && (it.remaining || it.status == StopStatus.ARRIVED) } ?: return null
                if (s.status == StopStatus.ARRIVED) {
                    leave(d, s, now, learn = false)
                    d.here = ctx.here ?: s.place.at
                } else {
                    d.stops = d.stops.map { if (it.id == s.id && it.remaining) it.copy(status = StopStatus.SKIPPED) else it }
                }
                d.stops = fixNext(d.stops)
                d.cause = Cause("빼기", "${s.place.name} 뺐어요", "${josa(s.place.name, "을/를")} 뺐어요")
                d.forced = true
            }
            is CourseEvent.Insert -> {
                val place = placeOf(e.placeId, c) ?: return null
                if (c.stops.any { it.id == place.id && (it.remaining || it.status == StopStatus.ARRIVED) }) return null
                val stop = LiveStop(place, StopStatus.PLANNED, now, now, dwellGuessMin = (profile.dwellFor(place) * d.dwellScale).roundToInt())
                val slots = (d.stops.indices.filter { d.stops[it].remaining } + d.stops.size).distinct()
                var best: Pair<List<LiveStop>, Timetable>? = null
                for (at in slots) {
                    val trial = fixNext(d.stops.toMutableList().apply { add(at, stop) })
                    val tt = retime(d, trial)
                    if (tt.closedStop != null || tt.arriveHomeMin > d.limit) continue
                    if (best == null || tt.arriveHomeMin < best.second.arriveHomeMin) best = trial to tt
                }
                d.cause = Cause("들르기", "${place.name} 들러요", "${place.name}에 들렀다 갈게요")
                d.forced = true
                if (best == null) {
                    d.cause = Cause("들르기", "${place.name}는 시간이 안 맞아요", "${josa(place.name, "은/는")} 오늘 시간이 안 맞아요")
                    d.noExtra = true
                } else {
                    d.stops = best.first
                }
            }
            is CourseEvent.Weather -> {
                val rain = if (e.sky == Sky.RAIN) now else e.rainFromMin
                val air = e.air ?: c.air
                if (rain == c.rainFromMin && air == c.air) return null
                d.rain = rain
                d.air = air
                d.cause = when {
                    rain != c.rainFromMin -> when {
                        rain == null -> Cause("비", "비 소식 없음", "비 소식이 없어졌어요")
                        rain <= now -> Cause("비", "비", "비가 와요")
                        else -> Cause("비", "비 ${rain.asHhmm()}부터", "비가 ${rain.asHhmm()}부터 와요")
                    }
                    // 미세먼지만 바뀜: 나빠졌고 야외가 남아 있으면 칩으로 알린다 (시간표는 그대로)
                    air?.bad == true -> {
                        val outdoor = c.stops.any { (it.remaining || it.status == StopStatus.ARRIVED) && !it.place.indoor }
                        d.forced = outdoor
                        Cause("미세먼지", airWarning(air), if (outdoor) "미세먼지가 ${airVoice(air)}. 마스크 챙기세요" else "미세먼지가 ${airVoice(air)}")
                    }
                    else -> Cause("미세먼지", "미세먼지 ${air?.text ?: "모름"}", "미세먼지가 괜찮아졌어요")
                }
            }
            is CourseEvent.PlaceClosed -> {
                val idx = c.stops.indexOfFirst { it.id == e.placeId && it.remaining }
                if (idx < 0) return null
                val s = c.stops[idx]
                d.stops = fixNext(d.stops.mapIndexed { i, x -> if (i == idx) x.copy(status = StopStatus.SKIPPED, skipReason = CLOSED) else x })
                d.replaceAt = idx
                d.replaced = s.place
                d.cause = Cause("문 닫음", "${s.place.name} 문 닫음", "${josa(s.place.name, "이/가")} 문을 닫았어요")
                d.forced = true
            }
            is CourseEvent.LimitChanged -> {
                // 오늘 사용자가 정한 도착 목표(SetEnd)가 이긴다
                if (e.limitMin == c.limitMin || c.userLimit) return null
                d.limit = e.limitMin
                d.cause = Cause("한계", "귀가 한계 ${e.limitMin.asHhmm()}", "귀가 한계가 ${e.limitMin.asHhmm()}으로 바뀌었어요")
            }
            is CourseEvent.Tick -> {
                val lag = behindMin(c, now)
                if (lag < QUIET_MIN && !hasClosed(c)) return null
                // 문 닫을 시간이라 못 가는 곳은 건너뛴다 (앞에서부터 하나씩 — 하나를 빼면 뒤 시간표가 당겨진다)
                val gone = mutableListOf<Place>()
                while (true) {
                    val cs = retime(d).closedStop ?: break
                    d.stops = fixNext(d.stops.map { if (it.id == cs.id && it.remaining) it.copy(status = StopStatus.SKIPPED, skipReason = CLOSED) else it })
                    gone += cs.place
                }
                if (gone.isEmpty()) {
                    d.cause = Cause("늦어짐", "예정보다 ${lag}분 늦어요", "예정보다 ${lag}분 늦어졌어요")
                } else {
                    val names = gone.joinToString("·") { it.name }
                    val head = if (gone.size == 1) "$names 문 닫을 시간" else "${gone.size}곳 문 닫을 시간"
                    d.cause = Cause("문 닫음", head, "${josa(names, "은/는")} 문 닫을 시간이라 건너뛰었어요")
                    d.forced = true
                }
                d.noExtra = true
            }
            is CourseEvent.SetDwell -> {
                val idx = d.stops.indexOfFirst { it.id == e.placeId && (it.remaining || it.status == StopStatus.ARRIVED) }
                if (idx < 0) return null
                val s = d.stops[idx]
                val m = DwellLearning.clampUser(e.minutes)
                if (s.dwellGuessMin == m && s.dwellSet) return null
                d.stops = d.stops.mapIndexed { i, x -> if (i == idx) x.copy(dwellGuessMin = m, dwellSet = true) else x }
                val name = s.place.name
                d.note = "${josa(name, "을/를")} ${m}분으로 바꿨어요"
                d.cause = Cause("머무름", "$name ${m}분", d.note!!)
                d.forced = true
            }
            is CourseEvent.ExtendStay -> {
                val cur = c.current ?: return null
                val more = extendMin(e.minutes)
                val start = max(cur.actualArriveMin ?: now, cur.place.openMin)
                val dwell = max(0, now + more - start)
                if (dwell == cur.dwellGuessMin && cur.dwellSet) return null
                d.stops = d.stops.map { if (it.id == cur.id && it.status == StopStatus.ARRIVED) it.copy(dwellGuessMin = dwell, dwellSet = true) else it }
                val name = cur.place.name
                d.note = if (more == 0) "${name}에서 지금 나서요" else "${name}에서 ${dur(more)} 더 놀아요"
                d.cause = Cause("머무름", if (more == 0) "지금 출발" else "${dur(more)} 더", d.note!!)
                d.forced = true
            }
            is CourseEvent.SetEnd -> {
                val end = if (e.toHome) null else e.end ?: c.end
                val limit = e.limitMin ?: c.limitMin
                val napOff = e.napOff ?: c.napOff
                if (end == c.end && limit == c.limitMin && napOff == c.napOff) return null
                d.end = end
                d.limit = limit
                d.napOff = napOff
                if (e.limitMin != null) d.userLimit = true
                val name = end?.name ?: "집"
                val chips = mutableListOf<String>()
                val voices = mutableListOf<String>()
                if (end != c.end) { chips += "도착지 $name"; voices += "도착지를 ${josa(name, "으로/로")} 바꿨어요" }
                if (limit != c.limitMin) { chips += "${limit.asHhmm()}까지"; voices += "${limit.asHhmm()}까지 도착하게 맞출게요" }
                if (napOff != c.napOff) {
                    chips += if (napOff) "낮잠 안 자요" else "낮잠 다시 맞춤"
                    voices += if (napOff) "오늘은 낮잠 없이 짤게요" else "낮잠 시간을 다시 맞출게요"
                }
                d.cause = Cause("도착지", chips.joinToString(" · "), voices.joinToString(". "))
                d.forced = true
                d.noExtra = true
            }
            is CourseEvent.NaviEta, is CourseEvent.StillDriving, is CourseEvent.GoHome, is CourseEvent.Remote -> error("따로 처리")
        }
        return d
    }

    private fun naviEta(c: LiveCourse, e: CourseEvent.NaviEta, ctx: CourseCtx): Outcome {
        val next = c.next ?: return Outcome.NoChange(c)
        val here = ctx.here ?: c.here ?: profile.home
        val est = estimate(here, next.place.at, c.roadFactor)
        val pending = c.etaPending
        val sameWay = pending != null && (pending - est) * (e.remainMin - est) > 0
        val big = abs(e.remainMin - est) >= ETA_DIFF_MIN || abs(e.remainMin - est) >= ETA_DIFF_RATIO * est
        if (!sameWay || !big) return Outcome.NoChange(c.copy(etaPending = e.remainMin))
        val d = Draft(c, e.nowMin, here)
        d.eta = e.remainMin
        if (est >= ETA_MIN_LEG_MIN && e.remainMin >= ETA_MIN_LEG_MIN) {
            val sample = c.roadFactor * e.remainMin / est
            d.factor = ((1 - EMA_ALPHA) * c.roadFactor + EMA_ALPHA * sample).coerceIn(FACTOR_MIN, FACTOR_MAX).let { (it * 100).roundToInt() / 100.0 }
        }
        val diff = e.remainMin - est
        d.cause = Cause("내비", "내비 ${if (diff > 0) "+" else ""}${diff}분", "내비 예상이 어림보다 ${abs(diff)}분 ${if (diff > 0) "길어요" else "짧아요"}")
        d.noExtra = diff > 0
        return judge(c, d)
    }

    /**
     * 내비 없이 늦어짐: 지금 위치에서 다음 곳까지 남은 구간을 보정된 계수로 다시 어림(최소 3분)해 그 값으로 다시 짠다.
     * 계수는 배우지 않는다(어림끼리 비교라). 임계·한계 침범·30분 반복 판정은 내비 ETA와 같다. 원인 '늦어짐'.
     */
    private fun stillDriving(c: LiveCourse, e: CourseEvent.StillDriving): Outcome {
        val next = c.next ?: return Outcome.NoChange(c)
        val d = Draft(c, e.nowMin, e.here)
        d.eta = max(estimate(e.here, next.place.at, c.roadFactor), STILL_DRIVING_MIN_REMAIN)
        d.cause = Cause("늦어짐", "예정보다 늦어요", "예정보다 늦어지고 있어요")
        d.noExtra = true
        return judge(c, d)
    }

    private fun goHome(c: LiveCourse, now: Int, ctx: CourseCtx): Outcome {
        val d = Draft(c, now, ctx.here ?: c.here)
        c.current?.let { leave(d, it, now, learn = false); d.here = ctx.here ?: it.place.at }
        d.stops = d.stops.map { if (it.remaining) it.copy(status = StopStatus.SKIPPED) else it }
        val tt = retime(d)
        val to = josa(d.endName, "으로/로")
        val change = Change(chip(to, "${tt.arriveHomeMin.asHhmm()} 도착"), "집으로", tt.arriveHomeMin - c.arriveHomeMin, ChangeSize.LOUD, now)
        val out = finish(c, d, tt).copy(lastChange = change)
        return Outcome.HomeNow(bump(c, out), change, "$to 안내할게요. ${tt.arriveHomeMin.asHhmm()}쯤 도착해요.")
    }

    /** 폰·서버 코스: 버전이 높을 때만 받아들인다. 차가 실제로 다녀온 곳의 상태는 차 것을 지킨다. */
    private fun remote(c: LiveCourse, e: CourseEvent.Remote, ctx: CourseCtx): Outcome {
        if (e.version <= c.version) return Outcome.NoChange(c)
        val r = e.course
        val stops = mutableListOf<LiveStop>()
        for (s in c.stops) if (!s.remaining) stops += s
        for (s in r.stops) {
            val local = c.stops.firstOrNull { it.id == s.id }
            if (local != null && !local.remaining) continue
            stops += LiveStop(
                s.place, if (s.status == StopStatus.SKIPPED) StopStatus.SKIPPED else StopStatus.PLANNED,
                s.plannedArriveMin, s.plannedDepartMin,
                dwellGuessMin = if (s.dwellGuessMin > 0) s.dwellGuessMin else (profile.dwellFor(s.place) * c.dwellScale).roundToInt(),
                dwellSet = s.dwellSet,
            )
        }
        val d = Draft(c, e.nowMin, ctx.here ?: c.here)
        d.stops = fixNext(stops)
        d.version = e.version
        d.chosenBy = r.chosenBy
        // 폰이 정한 오늘 도착지·낮잠·도착 목표도 따라간다 (도착 목표는 사용자가 정했을 때만 — 그 밖엔 차의 해 시각이 기준)
        d.end = r.end
        d.napOff = r.napOff
        if (r.userLimit) { d.limit = r.limitMin; d.userLimit = true }
        val who = josa(r.chosenBy, "이/가")
        d.cause = Cause("폰 변경", "$who 코스를 바꿨어요", "$who 코스를 바꿨어요")
        d.forced = true
        return judge(c, d)
    }

    // ------------------------------------------------------------------ 판정

    private fun judge(c: LiveCourse, d: Draft): Outcome {
        val tt = retime(d)
        val made = finish(c, d, tt)
        val delta = tt.arriveHomeMin - c.arriveHomeMin
        val nextOld = c.next?.let { n -> c.stops.firstOrNull { it.id == n.id } }?.plannedArriveMin
        val nextNew = made.next?.plannedArriveMin
        val nextDelta = if (nextOld != null && nextNew != null && c.next?.id == made.next?.id) nextNew - nextOld else 0
        val moved = max(abs(delta), abs(nextDelta))
        // 예상 밖 정차는 잃은 시간을 알고 나서 글을 만든다
        if (d.cause.key == "예상 밖 정차") d.cause = Cause(d.cause.key, "예상 밖 정차 ${delta}분", "길에서 ${delta}분 쉬었어요")

        // 3. 한계 침범 → 덜 놀기 → 빼기 → 바로 귀가
        if (tt.arriveHomeMin > d.limit || tt.closedStop != null) return breach(c, d, made, delta)

        val size = when {
            moved >= LOUD_MIN -> ChangeSize.LOUD
            // 머무름은 사람이 직접 바꾼 것 → 변화가 작아도 칩으로 알려 준다
            d.cause.key == "머무름" -> ChangeSize.SOFT
            moved >= QUIET_MIN -> ChangeSize.QUIET
            d.forced -> ChangeSize.SOFT
            else -> ChangeSize.QUIET
        }
        val options = mutableListOf<PlanOption>()
        var head: String? = null
        var voice: String? = null

        // 5. 낮잠 이동이 깨짐 → 더 머물기 (정차 중 출발 준비일 때만)
        if (d.stretchCheck && tt.napLeg == null && !d.noNap) stretchOption(d, made)?.let { (o, more) ->
            options += o
            val len = o.legs.first { it.kind == LegKind.NAP_DRIVE }.minutes
            head = "${more}분 더 놀면 차에서 낮잠"
            voice = "${more}분만 더 놀다 가면 아이들이 차에서 ${len}분 낮잠 잘 수 있어요."
        }
        // 교체안 (문 닫음)
        d.replaceAt?.let { at -> replacementOption(d, at, d.replaced!!, indoorOnly = false)?.let { options += it } }
        // 6. 야외 머무름에 비 → 실내로
        if (!d.noRain && tt.wetStops.isNotEmpty()) rainOptions(d, made, tt)?.let { (o, h, v) ->
            options += o
            if (head == null) { head = h; voice = v }
        }
        // 4. 여유 ≥ 45분 → 한 곳 더
        val slackNew = d.limit - tt.arriveHomeMin
        if (!d.noExtra && slackNew >= EXTRA_SLACK_MIN && (moved >= QUIET_MIN || d.forced || d.lastStop || c.slackMin < EXTRA_SLACK_MIN)) {
            extraOption(d, made)?.let { o ->
                options += o
                if (head == null) {
                    head = "한 곳 더 갈 수 있어요"
                    voice = "시간이 ${dur(slackNew)} 남아요. ${o.stops.last().name}에 들렀다 갈까요?"
                }
            }
        }
        // 7. 마지막 곳에서 다시 탐 → '바로 집으로' 카드 (새 3장 대신 코스 화면에서 고른다)
        if (d.lastStop) {
            val to = josa(d.endName, "으로/로")
            options += option(tt, "바로 $to", listOf(Reason(d.arriveWord(tt.arriveHomeMin))))
            if (head == null) {
                head = "바로 $to 갈까요"
                voice = "바로 $to 가면 ${tt.arriveHomeMin.asHhmm()}쯤 도착해요."
            }
        }

        val next = made.next
        val cause = d.cause
        if (options.isNotEmpty()) {
            // 원인이 '비'면 비 제안 글이 이미 비를 말하니 겹쳐 쓰지 않는다
            val rainSaid = cause.key == "비" && tt.wetStops.isNotEmpty()
            val change = throttle(c, Change(if (rainSaid) chip(head) else chip(cause.chip, head), cause.key, delta, ChangeSize.LOUD, d.now), d.now)
            val v = if (rainSaid) voice ?: cause.voice else "${cause.voice}. ${voice ?: ""}".trim()
            return Outcome.Proposal(bump(c, keep(c, made, change)), options, change, v)
        }
        if (size == ChangeSize.QUIET && moved < QUIET_MIN && !d.forced) {
            return Outcome.NoChange(bump(c, made.copy(lastChange = c.lastChange)))
        }
        val arrive = tt.arriveHomeMin.asHhmm()
        val text = when (cause.key) {
            "머무름 길어짐" -> chip("지금 나서면 ${homeChip(d, arrive)}", if (slackNew > 0) "${(d.now + slackNew).asHhmm()}까지 출발" else null)
            "도착지" -> chip(cause.chip, "${d.endName}에 $arrive 도착")
            "머무름" -> chip(d.note ?: cause.chip, "${d.endName}에 ${arrive}쯤")
            "미세먼지" -> chip(cause.chip)
            "늦어짐" -> chip(cause.chip, next?.let { "다음 도착 ${it.plannedArriveMin.asHhmm()}" }, homeChip(d, arrive))
            else -> chip(cause.chip, next?.let { "${it.place.name} ${it.plannedArriveMin.asHhmm()}" }, homeChip(d, arrive))
        }
        val change = throttle(c, Change(text, cause.key, delta, size, d.now), d.now)
        val v = buildString {
            append(cause.voice).append(". ")
            next?.let { append("${it.place.name}에는 ${it.plannedArriveMin.asHhmm()}, ") }
            append("${d.endName}에는 ${arrive}쯤 도착해요.")
        }
        return Outcome.Retimed(bump(c, keep(c, made, change)), change, v)
    }

    /** 한계 침범: '덜 놀기'(≤30분) → 뒤에서부터 한 곳씩 → 뒤에서 여러 곳 → 바로 귀가. */
    private fun breach(c: LiveCourse, d: Draft, made: LiveCourse, delta: Int): Outcome {
        val over = made.arriveHomeMin - d.limit
        val options = mutableListOf<PlanOption>()
        val cause = d.cause
        val closed = made.warnings.firstOrNull { it.contains("못 가요") }

        // 덜 놀기: 마지막 남은 곳(없으면 지금 머무는 곳)의 머무름을 넘긴 만큼 줄여 본다
        if (over in 1..SHORTEN_MAX_MIN && closed == null) {
            val target = made.remaining.lastOrNull() ?: made.current
            if (target != null && target.dwellGuessMin - over >= Planner.MIN_VISIT_MIN) {
                val trial = d.stops.map { if (it.id == target.id && it.status == target.status) it.copy(dwellGuessMin = it.dwellGuessMin - over) else it }
                val tt = retime(d, trial)
                if (tt.closedStop == null && tt.arriveHomeMin <= d.limit) {
                    options += option(tt, "${target.place.name} ${over}분 덜 놀기", listOf(Reason("머무름 ${target.dwellGuessMin - over}분")))
                }
            }
        }
        // 뒤에서부터 한 곳씩 빼 보기 → 안 되면 뒤에서 여러 곳
        val rem = made.remaining
        var drop: Pair<List<LiveStop>, Timetable>? = null
        var dropped: List<LiveStop> = emptyList()
        val tries = rem.indices.reversed().map { listOf(rem[it]) } + (2 until rem.size).map { k -> rem.takeLast(k) }
        for (group in tries) {
            val ids = group.map { it.id }.toSet()
            val trial = fixNext(d.stops.map { if (it.remaining && it.id in ids) it.copy(status = StopStatus.SKIPPED) else it })
            val tt = retime(d, trial)
            if (tt.closedStop == null && tt.arriveHomeMin <= d.limit) { drop = trial to tt; dropped = group; break }
        }
        drop?.let { (trial, tt) ->
            val names = dropped.joinToString("·") { it.place.name }
            options += option(tt, "$names 빼기", listOf(Reason(d.arriveWord(tt.arriveHomeMin))))
        }

        if (options.isEmpty()) {
            // 다 안 되면 바로 귀가 (확인은 받는다 — 남은 곳은 아직 SKIPPED가 아님)
            val trial = d.stops.map { if (it.remaining) it.copy(status = StopStatus.SKIPPED) else it }
            val tt = retime(d, trial)
            // 아직 집 근처(지금 떠나면 5분 안에 집)면 '집으로'가 아니라 '오늘은 다음에'
            val atHome = tt.arriveHomeMin - d.now <= 5
            val text = if (atHome) chip("오늘은 다녀오기 어려워요") else chip("귀가 한계를 넘어요", "${d.endName} ${tt.arriveHomeMin.asHhmm()} 도착")
            val change = throttle(c, Change(text, "한계 침범", delta, ChangeSize.LOUD, d.now), d.now)
            val out = keep(c, made, change)
            val v = if (atHome) "${cause.voice}. 오늘은 다음에 가는 게 좋겠어요." else "${cause.voice}. 지금 ${josa(d.endName, "으로/로")} 가는 게 좋겠어요. ${tt.arriveHomeMin.asHhmm()}쯤 도착해요."
            return Outcome.HomeNow(bump(c, out), change, v)
        }
        val first = options.first()
        val head = when {
            closed != null -> "${first.label} · ${d.arriveWord(first.arriveHomeMin)}"
            else -> "${first.label}면 ${d.arriveWord(first.arriveHomeMin)}"
        }
        val change = throttle(c, Change(chip(cause.chip, head), cause.key, delta, ChangeSize.LOUD, d.now), d.now)
        val why = if (closed != null) closed else "그대로 가면 ${josa(d.arriveWord(made.arriveHomeMin), "이라/라")} 한계를 넘어요"
        val voice = "${cause.voice}. $why. ${first.label}면 ${first.arriveHomeMin.asHhmm()}에 ${d.endName}에 도착해요. 그렇게 할까요?"
        return Outcome.Proposal(bump(c, keep(c, made, change)), options, change, voice)
    }

    /** 칩 끝의 도착 글: 집이면 '귀가 HH:MM', 다른 도착지면 '할머니 집 HH:MM'. */
    private fun homeChip(d: Draft, arrive: String) = if (d.end == null) "귀가 $arrive" else "${d.endName} $arrive"

    /** 같은 원인의 LOUD는 30분에 한 번. 반복이면 QUIET으로 낮춘다 (마지막 변경은 처음 것을 유지). */
    private fun throttle(c: LiveCourse, change: Change, now: Int): Change {
        val last = c.lastChange ?: return change
        if (change.size == ChangeSize.LOUD && last.cause == change.cause && now - last.atMin < SAME_CAUSE_MIN) {
            return change.copy(size = ChangeSize.QUIET)
        }
        return change
    }

    /** QUIET으로 낮춰진 반복 변경은 lastChange를 바꾸지 않는다. */
    private fun keep(c: LiveCourse, made: LiveCourse, change: Change): LiveCourse =
        if (change.size == ChangeSize.QUIET && c.lastChange?.cause == change.cause && c.lastChange.size == ChangeSize.LOUD) made.copy(lastChange = c.lastChange)
        else made.copy(lastChange = change)

    /** 바뀐 게 있으면 버전 +1. (etaPending은 셈에 안 넣는다.) */
    private fun bump(old: LiveCourse, new: LiveCourse): LiveCourse {
        val base = new.copy(version = old.version, etaPending = old.etaPending)
        return if (base == old) new.copy(version = old.version) else new.copy(version = max(new.version, old.version) + 1)
    }

    /** 초안 + 시간표 → 코스. */
    private fun finish(c: LiveCourse, d: Draft, tt: Timetable): LiveCourse = c.copy(
        version = d.version,
        chosenBy = d.chosenBy,
        stops = tt.stops,
        legs = tt.legs,
        nowMin = d.now,
        here = d.here,
        arriveHomeMin = tt.arriveHomeMin,
        limitMin = d.limit,
        napLeg = tt.napLeg,
        warnings = tt.warnings,
        rainFromMin = d.rain,
        air = d.air,
        roadFactor = d.factor,
        dwellScale = d.dwellScale,
        napTaken = d.napTaken,
        etaPending = null,
        end = d.end,
        napOff = d.napOff,
        userLimit = d.userLimit,
    )

    // ------------------------------------------------------------------ 제안 카드

    /** 남은 장소 전체 순서를 담은 카드 (채택하면 [adopt]가 이 순서·머무름대로 바꾼다). */
    private fun option(tt: Timetable, label: String, reasons: List<Reason>): PlanOption {
        val places = tt.stops.filter { it.remaining }.map { it.place }
        return PlanOption(
            kind = if (places.isEmpty()) OptionKind.GO_HOME else OptionKind.COURSE,
            stops = places,
            firstLegMin = tt.legs.firstOrNull { !it.isStay }?.minutes ?: 0,
            detourMin = null,
            arriveHomeMin = tt.arriveHomeMin,
            legs = tt.legs,
            reasons = reasons.ifEmpty { listOf(Reason("${tt.arriveHomeMin.asHhmm()} 귀가")) },
            label = label,
        )
    }

    /** 더 머물기: 낮잠 10분 전 출발이 60분 안이고 그때 다음 구간이 낮잠 이동이 되며 한계 안이면. (카드, 더 머무는 분) */
    private fun stretchOption(d: Draft, made: LiveCourse): Pair<PlanOption, Int>? {
        val next = made.next ?: return null
        val here = d.here ?: return null
        val dep = profile.napStartMin - Planner.NAP_DEPART_BEFORE_MIN
        if (d.now >= profile.napStartMin - 20 || dep - d.now > Planner.NAP_STRETCH_MAX_MIN) return null
        val len = estimate(here, next.place.at, d.factor)
        if (!TimeBudget.napAligned(dep, len, profile)) return null
        val tt = retime(d, d.stops, now = dep)
        if (tt.closedStop != null || tt.arriveHomeMin > d.limit || tt.napLeg == null) return null
        val more = dep - d.now
        return option(tt, "${dep.asHhmm()}에 출발", listOf(Reason("낮잠 맞춤 · 차에서 ${len}분", Tone.NAP), Reason(d.arriveWord(tt.arriveHomeMin)))) to more
    }

    /** 비: 지금 머무는 야외면 '비 오기 전 출발', 앞으로 갈 야외면 실내 교체. (카드, 칩 머리, 음성) */
    private fun rainOptions(d: Draft, made: LiveCourse, tt: Timetable): Triple<PlanOption, String, String>? {
        val rain = d.rain ?: return null
        val wet = tt.stops.firstOrNull { it.id in tt.wetStops && (it.remaining || it.status == StopStatus.ARRIVED) } ?: return null
        if (wet.status == StopStatus.ARRIVED) {
            val leaveAt = max(d.now, rain)
            val start = max(wet.actualArriveMin ?: d.now, wet.place.openMin)
            val trial = d.stops.map { if (it.id == wet.id && it.status == StopStatus.ARRIVED) it.copy(dwellGuessMin = max(0, leaveAt - start)) else it }
            val t2 = retime(d, trial, stretch = false)
            if (t2.closedStop != null || t2.arriveHomeMin > d.limit) return null
            val o = option(t2, "비 오기 전 ${leaveAt.asHhmm()} 출발", listOf(Reason("비 ${rain.asHhmm()}부터", Tone.RAIN), Reason(d.arriveWord(t2.arriveHomeMin))))
            return Triple(o, "비 ${rain.asHhmm()}부터 · ${leaveAt.asHhmm()}에 먼저 나설까요", "비가 ${rain.asHhmm()}부터 와요. ${leaveAt.asHhmm()}에 먼저 나설까요?")
        }
        val at = d.stops.indexOfFirst { it.id == wet.id && it.remaining }
        val o = replacementOption(d, at, wet.place, indoorOnly = true) ?: return null
        val alt = o.stops.first { p -> d.stops.none { it.id == p.id } }
        return Triple(o, "비 ${rain.asHhmm()}부터 · ${wet.place.name} → ${alt.name}", "비가 ${rain.asHhmm()}부터 와요. ${wet.place.name} 대신 실내 ${josa(alt.name, "으로/로")} 바꿀까요?")
    }

    /**
     * [at] 자리의 장소를 다른 곳으로. 앞 장소를 떠나는 시각·위치에서 재탑승 점수로 후보를 줄 세워 처음 맞는 곳.
     * [at] 자리의 원래 장소는 이미 SKIPPED여도 되고 아니어도 된다(그 자리에 새 장소를 넣고 원래 것은 뺀다).
     */
    private fun replacementOption(d: Draft, at: Int, old: Place, indoorOnly: Boolean): PlanOption? {
        val used = d.stops.map { it.id }.toSet()
        val cands = Planner.forDay(catalog, day).filter { it.id !in used && (!indoorOnly || it.indoor) }
        if (cands.isEmpty()) return null
        val before = d.stops.take(at).lastOrNull { it.remaining || it.status == StopStatus.ARRIVED }
            ?: d.stops.take(at).lastOrNull { it.status == StopStatus.DONE }
        val t0 = before?.let { if (it.remaining || it.status == StopStatus.ARRIVED) it.plannedDepartMin else it.actualDepartMin } ?: d.now
        val at0 = before?.place?.at ?: d.here ?: profile.home
        val ranked = rank(max(t0, d.now), at0, cands, d)
        for (p in ranked) {
            val stop = LiveStop(p, StopStatus.PLANNED, d.now, d.now, dwellGuessMin = (profile.dwellFor(p) * d.dwellScale).roundToInt())
            val trial = fixNext(d.stops.mapIndexed { i, x -> if (i == at && x.id == old.id) x.copy(status = StopStatus.SKIPPED) else x }
                .toMutableList().apply { add(at, stop) })
            val tt = retime(d, trial)
            if (tt.closedStop != null || tt.arriveHomeMin > d.limit) continue
            val reasons = buildList {
                p.festival?.let { add(Planner.festivalReason(it)) }
                if (p.indoor) add(Reason("실내", Tone.RAIN))
                add(Reason(d.arriveWord(tt.arriveHomeMin)))
                if (p.stampable) add(Reason("도장 +1", Tone.STAMP))
            }
            return option(tt, "${old.name} → ${p.name}", reasons)
        }
        return null
    }

    /** '한 곳 더': 마지막 남은 곳을 떠나는 시각·위치에서 재탑승 점수 1위를 끝에 붙여 본다 (새 선택이니 안전 10분). */
    private fun extraOption(d: Draft, made: LiveCourse): PlanOption? {
        val used = made.stops.map { it.id }.toSet()
        val cands = Planner.forDay(catalog, day).filter { it.id !in used }
        if (cands.isEmpty()) return null
        val last = made.remaining.lastOrNull() ?: made.current
        val t0 = last?.plannedDepartMin ?: d.now
        val at0 = last?.place?.at ?: d.here ?: profile.home
        val ranked = rank(max(t0, d.now), at0, cands, d)
        for (p in ranked) {
            val stop = LiveStop(p, StopStatus.PLANNED, d.now, d.now, dwellGuessMin = (profile.dwellFor(p) * d.dwellScale).roundToInt())
            val trial = fixNext(d.stops + stop)
            val tt = retime(d, trial)
            if (tt.closedStop != null || tt.arriveHomeMin > d.limit - TimeBudget.SAFETY_MIN) continue
            val reasons = buildList {
                p.festival?.let { add(Planner.festivalReason(it)) }
                if (p.indoor) Planner.airReason(SkyToday(air = d.air))?.let(::add)
                tt.napLeg?.takeIf { it.placeId == p.id }?.let { add(Reason("낮잠 맞춤 · 차에서 ${it.minutes}분", Tone.NAP)) }
                if (p.indoor && d.rain != null && d.rain!! < t0 + Planner.RAIN_SOON_MIN) add(Reason("비 → 실내", Tone.RAIN))
                add(Reason(d.arriveWord(tt.arriveHomeMin)))
                if (p.stampable) add(Reason("도장 +1", Tone.STAMP))
            }
            return option(tt, "한 곳 더 · ${p.name}", reasons)
        }
        return null
    }

    /** 기존 재탑승 점수식으로 후보 줄 세우기 (한계는 코스의 한계). */
    private fun rank(nowMin: Int, here: LatLng, cands: List<Place>, d: Draft): List<Place> {
        val prof = profile.copy(backBy = BackBy.At(d.limit)).let { p ->
            // 오늘 도착지가 집이 아니면 그곳까지, 오늘 낮잠을 빼면 낮잠 없이
            val q = d.end?.let { p.copy(home = it.at) } ?: p
            if (d.napOff) q.copy(napEndMin = q.napStartMin) else q
        }
        val rain = d.rain
        val sky = SkyToday(sky = if (rain != null && rain <= nowMin) Sky.RAIN else Sky.UNKNOWN, rainFromMin = rain?.takeIf { it > nowMin }, air = d.air)
        return Planner.reboard(nowMin, here, prof, cands, sky, day).options.filter { it.stops.isNotEmpty() }.map { it.stops.first() }
            .let { top -> top + cands.filter { c -> top.none { it.id == c.id } } }
    }

    // ------------------------------------------------------------------ 시간표

    /** 다시 짠 시간표. [closedStop]은 문 닫기 전에 못 가는 첫 장소, [wetStops]는 비 걸치는 야외 장소 id. */
    internal class Timetable(
        val stops: List<LiveStop>,
        val legs: List<Leg>,
        val arriveHomeMin: Int,
        val napLeg: Leg?,
        val warnings: List<String>,
        val closedStop: LiveStop?,
        val wetStops: List<String>,
    )

    /** 낮잠 이동을 만들려고 앞 머무름을 늘린 시간표가 한계 안이면 그쪽, 아니면 그냥. */
    private fun retime(d: Draft, stops: List<LiveStop> = d.stops, now: Int = d.now, stretch: Boolean = true): Timetable {
        val plain = build(d, stops, now, false)
        if (!stretch || plain.napLeg != null || d.noNap) return plain
        val s = build(d, stops, now, true)
        return if (s.napLeg != null && s.closedStop == null && s.arriveHomeMin <= d.limit) s else plain
    }

    private fun build(d: Draft, stops: List<LiveStop>, now: Int, stretch: Boolean): Timetable {
        val legs = mutableListOf<Leg>()
        val out = stops.toMutableList()
        val warnings = mutableListOf<String>()
        val wet = mutableListOf<String>()
        var closed: LiveStop? = null
        var t = now
        var at: LatLng = d.here ?: profile.home
        var nap: Leg? = null
        var firstDrive = true
        val rain = d.rain

        fun stay(i: Int, s: LiveStop, from: Int, start: Int, dwell: Int) {
            val p = s.place
            var end = min(start + dwell, p.closeMin)
            if (end < from) end = from
            if (start + dwell > p.closeMin && end > start) warnings += "${p.name} 문 닫는 시각까지 ${end - start}분"
            if (!p.indoor && rain != null && end > rain) {
                wet += p.id
                warnings += if (start >= rain) "${p.name} 비 오는 중 야외" else "${p.name} 머무는 중 비 (${rain.asHhmm()}부터)"
            }
            if (end > from) legs += Leg(if (p.isMeal) LegKind.MEAL else LegKind.STAY, from, end, p.id)
            out[i] = s.copy(plannedDepartMin = end)
            t = end
            at = p.at
        }

        for (i in stops.indices) {
            val s = stops[i]
            when (s.status) {
                StopStatus.DONE, StopStatus.SKIPPED -> continue
                StopStatus.ARRIVED -> {
                    val arrive = s.actualArriveMin ?: t
                    val start = max(arrive, s.place.openMin)
                    out[i] = s.copy(plannedArriveMin = arrive)
                    stay(i, out[i], t, start, s.dwellGuessMin)
                }
                StopStatus.PLANNED, StopStatus.NEXT -> {
                    val p = s.place
                    val len = if (firstDrive && d.eta != null) d.eta!! else estimate(at, p.at, d.factor)
                    firstDrive = false
                    var depart = t
                    // 더 머물기: 앞 칸이 머무름이고 낮잠 10분 전 출발(60분 안)이 낮잠 이동이 되면
                    // (사람이 오늘 직접 정한 머무름은 늘리지 않는다)
                    val prevSet = legs.lastOrNull()?.let { l -> out.any { it.id == l.placeId && it.dwellSet && (it.remaining || it.status == StopStatus.ARRIVED) } } == true
                    if (stretch && nap == null && !d.noNap && !prevSet && legs.lastOrNull()?.kind == LegKind.STAY) {
                        val dep = profile.napStartMin - Planner.NAP_DEPART_BEFORE_MIN
                        if (t < profile.napStartMin - 20 && dep - t <= Planner.NAP_STRETCH_MAX_MIN && TimeBudget.napAligned(dep, len, profile)) {
                            val last = legs.removeAt(legs.lastIndex)
                            legs += last.copy(toMin = dep)
                            val j = out.indexOfFirst { it.id == last.placeId && (it.remaining || it.status == StopStatus.ARRIVED) }
                            if (j >= 0) out[j] = out[j].copy(plannedDepartMin = dep)
                            depart = dep
                        }
                    }
                    val napping = nap == null && !d.noNap && TimeBudget.napAligned(depart, len, profile)
                    val leg = Leg(if (napping) LegKind.NAP_DRIVE else LegKind.DRIVE, depart, depart + len, p.id)
                    legs += leg
                    if (napping) nap = leg else if (len > Planner.AWAKE_DRIVE_MAX_MIN) warnings += "깨어 있는 이동 ${len}분 (${p.name})"
                    t = depart + len
                    at = p.at
                    val start = max(t, p.openMin)
                    if (start - t > Planner.MAX_WAIT_MIN) warnings += "${p.name} 문 열기 ${start - t}분 기다림"
                    if (start + min(s.dwellGuessMin, Planner.MIN_VISIT_MIN) > p.closeMin) {
                        if (closed == null) closed = s
                        warnings += "${p.name} 문 닫기 전에 못 가요 (${t.asHhmm()} 도착)"
                        out[i] = s.copy(plannedArriveMin = t, plannedDepartMin = t)
                        continue
                    }
                    out[i] = s.copy(plannedArriveMin = t)
                    stay(i, out[i], t, start, s.dwellGuessMin)
                }
            }
        }
        // 마지막 구간: 오늘 도착지(있으면) 또는 집
        val len = estimate(at, d.end?.at ?: profile.home, d.factor)
        val napping = nap == null && !d.noNap && TimeBudget.napAligned(t, len, profile)
        val home = Leg(if (napping) LegKind.NAP_DRIVE else LegKind.HOME, t, t + len)
        legs += home
        if (napping) nap = home
        // 미세먼지 나쁨 이상인데 머무는 곳·남은 곳에 야외가 있으면 (사용자가 고른 코스) 경고 칩
        val air = d.air
        if (air?.bad == true && out.any { (it.remaining || it.status == StopStatus.ARRIVED) && !it.place.indoor }) warnings += airWarning(air)
        return Timetable(out, legs, t + len, nap, warnings, closed, wet)
    }
}
