package kr.milestamp.engine

/**
 * 여행 상태머신 (기획서 6장): 대기 → 아침 계획 → 주행 → 도착 전 소개 → 주차 → 하차 → 재탑승 계획 → 귀가 중 → 귀가.
 *
 * 안드로이드에 의존하지 않는 순수 Kotlin. 신호를 [handle]에 넣으면 앱이 할 일([Effect])을 돌려준다.
 * 같은 신호 순서 → 같은 결과라서, 하루 시나리오 전체를 단위 테스트로 재현한다.
 */
class TripEngine(
    profile: FamilyProfile,
    /** 추천 후보이자 도장 판정 대상 (도장은 [Place.stampable]인 곳만). 서버 목록을 받으면 [replaceCatalog]로 바꾼다. */
    catalog: List<Place>,
    val config: Config = Config(),
) {
    data class Config(
        /** 기어 P + 2열 착좌가 이만큼 유지되면 '탑승'. */
        val boardHoldMs: Long = 5_000,
        /** 기어 P + 속도 0이 이만큼 유지되면 '주차'. */
        val parkHoldMs: Long = 3_000,
        /** 운전석 문이 이만큼 열려 있으면 '하차'. */
        val doorHoldMs: Long = 1_000,
        /** 문 닫힘 + 2열 착좌가 이만큼 유지되면 '재탑승'. */
        val reboardHoldMs: Long = 10_000,
        /** 이보다 짧게 내렸다 타면 재탑승 계획 없이 주차 상태로 돌아감. */
        val minDwellMin: Int = 5,
        val homeRadiusM: Int = 300,
        /** 랭킹 점수에 들어가는 하루 최대 도장 수 (기록은 모두 남김). */
        val maxRankedPerDay: Int = 3,
        /** 남은 시간 ≤ 150초가 이만큼 연속으로 와야 소개 시작 (튀는 값 방지). */
        val etaConsecutive: Int = 2,
    )

    var profile: FamilyProfile = profile
        private set
    var catalog: List<Place> = catalog
        private set
    var state: TripState = TripState.IDLE
        private set
    var lastPlan: Plan? = null
        private set

    // ---- 최신 신호 ----
    private var gear = Gear.UNKNOWN
    private var gearSinceMs = 0L
    private var speedKmh = 0f
    private var doorOpen = false
    private var doorSinceMs = 0L
    private var rear = 0
    private var rearSinceMs: Long? = null
    private var odo: Double? = null
    private var loc: LatLng? = null
    private var ux = false
    private var nowMin = 0
    /** 오늘 날짜 'YYYY-MM-DD' ([SignalEvent.Clock.day]). 축제 기간 판단에 쓴다. 모르면 축제는 추천·도장에서 빠진다. */
    var today: String? = null
        private set
    /** 이미 한정 도장을 받은 축제 id (올해, 차·서버 기록). 같은 축제는 한 번만. */
    private val festivalStamped = mutableSetOf<String>()
    private var sky = Sky.UNKNOWN
    private var rainFromMin: Int? = null
    private var sunriseMin: Int? = null
    private var sunsetMin: Int? = null
    private var lastEtaS: Int? = null
    private var etaLowCount = 0

    // ---- 오늘의 여행 ----
    private var boardedToday = false
    private var tripStarted = false
    private var dayStartOdo: Double? = null
    private var legStartAt: LatLng? = null
    private var legStartOdo: Double? = null
    /** 이번 구간 내비 경로거리: 처음 받은 값과 마지막 값(재탐색). 검증엔 둘 중 큰 값. */
    private var routeKmFirst: Double? = null
    private var routeKmLast: Double? = null
    /** 이번 구간 GPS 궤적 길이(km)와 마지막 위치 (튀는 위치는 뺀다). */
    private var legPathKm = 0.0
    private var lastFix: LatLng? = null
    private var lastFixMs = 0L
    private val route = mutableListOf<Place>()
    private var homewardTrip = false
    private var quiet = false
    private var introPlace: Place? = null
    private val introduced = mutableSetOf<String>()
    private val visited = mutableSetOf<String>()
    private val stampedToday = mutableListOf<Place>()
    private var rareToday = 0
    private var herePlace: Place? = null
    private var outSinceMin = 0
    private var warnedRear = false

    // ---- 살아 있는 코스 ----
    private val courseEngine = LiveCourseEngine(profile, catalog)
    /** 고른 코스의 살아 있는 시간표. 카드를 고르면 생기고, 집에 올 때까지 사건마다 갱신. */
    var liveCourse: LiveCourse? = null
        private set
    /**
     * 떠 있는 제안 (화면의 카드 또는 주행 중에 생겨 다음 정차 때 낼 카드). 코스가 다른 사건으로 바뀌거나, 카드가 넣는 곳에
     * 이미 갔거나, 권한 출발 시각이 지나면 버린다 ([LiveCourseEngine.proposalExpired]). '그대로 갈게요'도 버린다.
     */
    private var pendingProposal: Effect.CourseProposal? = null
    /** 주행 중 들어온 폰 명령 — 다음 정차 때 적용. */
    private val heldCommands = mutableListOf<CourseEvent>()

    /** 코스 화면 맨 위 쉬운 설명 (떠 있는 제안이 같은 코스 버전의 것이면 그 첫 카드로). 코스가 없으면 null. */
    fun explainCourse(nowMin: Int): Explanation? {
        val lc = liveCourse ?: return null
        val opts = pendingProposal?.takeIf { it.course.version == lc.version }?.options.orEmpty()
        return courseEngine.explain(lc, nowMin, opts, sunsetMin)
    }
    /** 장소 아닌 곳에 선 시각 (휴게소 등). */
    private var parkedSinceMin: Int? = null
    private var lastStillParkedMin: Int? = null
    private var lastEtaMinSent: Int? = null
    /** 마지막으로 내비 ETA를 받은 시각(분). 10분 넘게 없으면 내비 없이 늦어짐을 본다. */
    private var lastNaviEtaMin: Int? = null
    private var lastStillDrivingMin: Int? = null

    /** 추천 후보를 바꾼다 (서버 장소 목록). 오늘 다녀간 곳 기록은 장소 id로 남아 있어 그대로 쓴다. */
    fun replaceCatalog(places: List<Place>) {
        if (places.isNotEmpty()) { catalog = places; courseEngine.catalog = places }
    }

    /**
     * 오늘 이전까지 모은 도장 수를 바꾼다 (차가 서버·차 기록에서 센 실제 수). 오늘 찍은 도장 번호 = 이 값 + 오늘 순서.
     * 여행 기록은 그대로 둔다.
     */
    fun setStampsBefore(n: Int) {
        if (n < 0 || n == profile.stampsBefore) return
        profile = profile.copy(stampsBefore = n)
        courseEngine.profile = profile
    }

    /**
     * 가족 설정을 바꾼다 (서버 '우리 가족': 집·낮잠·귀가 기준·저녁·아이 나이). 여행 기록과 모은 도장 수는 그대로.
     * 이미 돌고 있는 코스는 다음 사건부터 새 집·낮잠으로 짠다.
     */
    fun updateProfile(p: FamilyProfile) {
        val next = p.copy(stampsBefore = profile.stampsBefore)
        if (next == profile) return
        profile = next
        courseEngine.profile = next
    }

    /**
     * 이미 한정 도장을 받은 축제들 (차가 서버 도장 목록에서 올해 것을 센다). 엔진도 찍을 때마다 더한다.
     * 하루 초기화([resetDay])로 지우지 않는다 — 같은 축제는 해마다 한 번.
     */
    fun setFestivalStamps(ids: Collection<String>) {
        festivalStamped.clear(); festivalStamped += ids
    }

    /** 새 하루. 신호값(기어·위치 등)은 그대로 두고 여행 기록만 지운다. */
    fun resetDay(newProfile: FamilyProfile = profile) {
        profile = newProfile
        state = TripState.IDLE
        lastPlan = null
        boardedToday = false; tripStarted = false
        dayStartOdo = odo; legStartAt = null; legStartOdo = null; routeKmFirst = null; routeKmLast = null
        legPathKm = 0.0; lastFix = null
        route.clear(); homewardTrip = false; quiet = false
        introPlace = null; introduced.clear(); visited.clear()
        stampedToday.clear(); rareToday = 0
        herePlace = null; outSinceMin = 0; warnedRear = false
        etaLowCount = 0; lastEtaS = null
        courseEngine.profile = newProfile
        liveCourse = null; pendingProposal = null; heldCommands.clear()
        parkedSinceMin = null; lastStillParkedMin = null; lastEtaMinSent = null
        lastNaviEtaMin = null; lastStillDrivingMin = null
    }

    fun handle(e: SignalEvent): List<Effect> {
        val out = mutableListOf<Effect>()
        when (e) {
            is SignalEvent.GearChanged -> if (e.gear != gear) { gear = e.gear; gearSinceMs = e.atMs }
            is SignalEvent.Speed -> speedKmh = e.kmh
            is SignalEvent.DriverDoor -> if (e.open != doorOpen) { doorOpen = e.open; doorSinceMs = e.atMs }
            is SignalEvent.RearSeats -> {
                if (e.occupied >= 1 && rear == 0) rearSinceMs = e.atMs
                if (e.occupied == 0) rearSinceMs = null
                rear = e.occupied
            }
            is SignalEvent.Odometer -> { odo = e.km; if (dayStartOdo == null) dayStartOdo = e.km }
            is SignalEvent.Location -> { trackPath(e.at, e.atMs); loc = e.at }
            is SignalEvent.UxRestricted -> ux = e.on
            is SignalEvent.Eta -> {
                etaLowCount = if (e.remainS <= IntroPicker.TRIGGER_REMAIN_S) etaLowCount + 1 else 0
                lastEtaS = e.remainS
                if (driving) lastNaviEtaMin = nowMin
                // 코스: 다음 구간 남은 시간(분). 같은 분이 거듭 오면 한 번만
                val remainMin = (e.remainS + 30) / 60
                if (liveCourse != null && driving && remainMin != lastEtaMinSent) {
                    lastEtaMinSent = remainMin
                    course(CourseEvent.NaviEta(nowMin, remainMin), out)
                }
            }
            is SignalEvent.RouteDistance -> { if (routeKmFirst == null) routeKmFirst = e.km; routeKmLast = e.km }
            is SignalEvent.Clock -> {
                nowMin = e.nowMin
                e.day?.let { today = it; courseEngine.day = it }
                prunePending(out)
            }
            is SignalEvent.Weather -> {
                sky = e.sky
                // 시각 없는 '3시간 안 비'는 한 시간 뒤부터 온다고 본다
                rainFromMin = e.rainFromMin ?: if (e.rainSoon) nowMin + RAIN_SOON_GUESS_MIN else null
                course(CourseEvent.Weather(nowMin, sky, rainFromMin), out)
            }
            is SignalEvent.Sun -> {
                sunriseMin = e.sunriseMin; sunsetMin = e.sunsetMin
                liveCourse?.let { lc ->
                    val limit = Planner.limitMin(lastPlan?.mode ?: PlanMode.MORNING, profile, skyToday())
                    if (limit != lc.limitMin) course(CourseEvent.LimitChanged(nowMin, limit), out)
                }
            }
            is SignalEvent.ServerPlan -> if (state == TripState.PLANNING) {
                showPlan(e.plan.copy(chosen = e.chosenIdx, chosenBy = e.by), out)
            }
            is SignalEvent.RouteChosen -> {
                val lc = liveCourse
                val wasPending = pendingProposal?.let { e.option in it.options } == true
                prunePending(out)
                val pending = pendingProposal
                if (lc != null && (pending == null || e.option !in pending.options) && (wasPending || lastPlan?.options?.contains(e.option) != true)) {
                    // 지났거나 치운 제안 카드를 눌렀다 → 코스는 그대로 (카드는 prunePending이 치움)
                } else if (lc != null && pending != null && e.option in pending.options) {
                    // 제안 카드를 고름 → 코스를 그대로 바꾸고 길 안내 다시
                    pendingProposal = null
                    emit(lc, courseEngine.adopt(lc, e.option, nowMin, CourseCtx(driving, loc)), out, force = true, reroute = true)
                } else {
                    route.clear(); route += e.option.stops
                    homewardTrip = e.option.kind == OptionKind.HOMEWARD || e.option.kind == OptionKind.GO_HOME
                    out += Effect.PlanChosen(e.option, lastPlan?.options?.indexOf(e.option)?.takeIf { it >= 0 })
                    out += Effect.RequestRoute(e.option)
                    // 새 코스를 골랐다 → 살아 있는 코스로 (바로 집으로면 없음)
                    val plan = lastPlan
                    pendingProposal = null; heldCommands.clear()
                    liveCourse = if (plan != null && e.option.stops.isNotEmpty()) {
                        LiveCourse.from(e.option, plan, plan.chosenBy ?: "차", nowMin, loc, profile)
                    } else null
                }
            }
            is SignalEvent.CourseCommand -> if (liveCourse != null) {
                if (e.deferWhileDriving && driving) {
                    heldCommands += e.event
                    val text = LiveCourseEngine.chip(courseEngine.describe(e.event, liveCourse), "다음 정차 때 적용")
                    out += Effect.CourseUpdated(liveCourse!!, Change(text, "보류", 0, ChangeSize.SOFT, nowMin), quiet = true)
                } else {
                    course(e.event, out, reroute = true)
                }
            }
            is SignalEvent.CourseCancelled -> liveCourse?.let { lc ->
                if (lc.stops.none { it.status == StopStatus.ARRIVED || it.status == StopStatus.DONE }) {
                    liveCourse = null; heldCommands.clear(); route.clear(); homewardTrip = false
                    if (pendingProposal != null) { pendingProposal = null; out += Effect.ProposalCleared("코스 취소") }
                    out += Effect.ShowDrivingChip("가족 폰에서 오늘 코스를 취소했어요")
                }
            }
            is SignalEvent.ProposalDismissed -> if (pendingProposal != null) {
                pendingProposal = null
                out += Effect.ProposalCleared("그대로 갈게요")
            }
            is SignalEvent.IntroFinished -> if (introPlace?.id == e.placeId) introPlace = null
            is SignalEvent.Tick -> Unit
        }
        evaluate(e.atMs, out)
        return out
    }

    // ---- 살아 있는 코스 ----

    /** 주행 중 = 카드를 띄우지 않는다 (주행 상태이거나 주행 제한). */
    private val driving: Boolean
        get() = ux || state == TripState.DRIVING || state == TripState.ARRIVING || state == TripState.HOMEWARD

    /** 코스에 사건 하나를 넣고 결과를 효과로. */
    private fun course(event: CourseEvent, out: MutableList<Effect>, force: Boolean = false, reroute: Boolean = false) {
        val lc = liveCourse ?: return
        emit(lc, courseEngine.apply(lc, event, CourseCtx(driving, loc)), out, force, reroute)
    }

    /**
     * 답을 효과로 바꾼다. 주행 중엔 CourseUpdated(칩·음성)만 내고 제안 카드는 다음 정차까지 보류.
     * [force]면 반복으로 낮춰진(QUIET) 제안도 카드로. [reroute]면 남은 순서가 바뀌었을 때 길 안내를 다시 요청.
     */
    private fun emit(before: LiveCourse, outcome: Outcome, out: MutableList<Effect>, force: Boolean, reroute: Boolean) {
        val c = outcome.course
        liveCourse = c
        route.clear(); route += c.remainingPlaces
        val change = outcome.change
        val hush = quiet || driving || change == null || change.size != ChangeSize.LOUD
        when (outcome) {
            is Outcome.NoChange -> if (force) out += Effect.CourseUpdated(c, null, quiet = true)
            is Outcome.Retimed -> out += Effect.CourseUpdated(c, change, hush, outcome.voice)
            is Outcome.Proposal -> {
                out += Effect.CourseUpdated(c, change, hush, outcome.voice)
                val p = Effect.CourseProposal(c, outcome.options, outcome.change)
                if (driving) pendingProposal = p
                else if (force || outcome.change.size != ChangeSize.QUIET) { pendingProposal = p; out += p }
            }
            is Outcome.HomeNow -> {
                out += Effect.CourseUpdated(c, change, hush, outcome.voice)
                if (c.remaining.isEmpty() && c.current == null) {
                    // 결정됨 (집으로 명령·채택) → 집으로 안내
                    pendingProposal = null; heldCommands.clear()
                    homewardTrip = true
                    out += Effect.RequestRoute(c.asOption())
                    return
                }
                // 확인 필요 → '바로 집으로' 카드 1장
                val p = Effect.CourseProposal(c, listOf(courseEngine.goHomeOption(c, nowMin, CourseCtx(driving, loc))), outcome.change)
                if (driving) pendingProposal = p
                else if (force || outcome.change.size != ChangeSize.QUIET) { pendingProposal = p; out += p }
            }
        }
        if (reroute && c.remaining.isNotEmpty() && before.remaining.map { it.id } != c.remaining.map { it.id }) {
            out += Effect.RequestRoute(c.asOption())
        }
        // 이 답이 새 제안이 아니면, 앞서 떠 있던 제안은 코스가 바뀌었을 때 버린다
        prunePending(out)
    }

    /** 떠 있는 제안이 지났으면 버리고 화면에서도 치운다. */
    private fun prunePending(out: MutableList<Effect>) {
        val p = pendingProposal ?: return
        val lc = liveCourse
        val why = if (lc == null) "코스 없음" else courseEngine.proposalExpired(p.course, p.options, lc, nowMin, visited)
        if (why != null) {
            pendingProposal = null
            out += Effect.ProposalCleared(why)
        }
    }

    /** 정차했다 → 보류한 폰 명령 적용, 보류한 제안은 (아직 지나지 않았으면) 카드로. */
    private fun releaseHeld(out: MutableList<Effect>) {
        val held = heldCommands.toList(); heldCommands.clear()
        val had = out.size
        for (ev in held) course(ev, out, force = true, reroute = true)
        val shown = out.drop(had).any { it is Effect.CourseProposal }
        prunePending(out)
        pendingProposal?.takeIf { !shown }?.let { out += it }
    }

    /**
     * 내비 없이 늦어짐: 주행 중 다음 곳 예정 도착 2분 전이 지났고 최근 10분 동안 내비 ETA가 없으면 5분마다 StillDriving.
     * 내비 ETA가 오고 있으면 그쪽(NaviEta)이 시간표를 맡는다.
     */
    private fun stillDrivingTick(out: MutableList<Effect>) {
        val lc = liveCourse ?: return
        val here = loc ?: return
        val next = lc.next ?: return
        if (lc.current != null || nowMin <= next.plannedArriveMin - STILL_DRIVING_EARLY_MIN) return
        lastNaviEtaMin?.let { if (nowMin - it < NAVI_FRESH_MIN) return }
        lastStillDrivingMin?.let { if (nowMin - it < STILL_DRIVING_EVERY_MIN) return }
        lastStillDrivingMin = nowMin
        course(CourseEvent.StillDriving(nowMin, here), out)
    }

    /** 주행 중 GPS 궤적 길이를 쌓는다. 2km 넘게 한 번에 뛰거나 시속 200km를 넘는 움직임은 튀는 위치(또는 위치 조작)로 보고 뺀다. */
    private fun trackPath(at: LatLng, atMs: Long) {
        val prev = lastFix
        lastFix = at
        val prevMs = lastFixMs
        lastFixMs = atMs
        if (prev == null || !(state == TripState.DRIVING || state == TripState.ARRIVING || state == TripState.HOMEWARD)) return
        val seg = Geo.km(prev, at)
        if (seg > PATH_JUMP_KM) return
        val hours = (atMs - prevMs) / 3_600_000.0
        if (seg > PATH_JITTER_KM && (hours <= 0.0 || seg / hours > PATH_MAX_KMH)) return
        legPathKm += seg
    }

    /** 예정 출발이 지났거나(5분마다) 장소 아닌 곳에 10분 넘게 서 있으면 StillParked. */
    private fun stillParkedTick(out: MutableList<Effect>) {
        val lc = liveCourse ?: return
        val cur = lc.current
        val due = if (cur != null) nowMin > cur.plannedDepartMin else parkedSinceMin?.let { nowMin - it >= STILL_PARKED_ROAD_MIN } ?: false
        if (!due) return
        val last = lastStillParkedMin
        if (last != null && nowMin - last < STILL_PARKED_EVERY_MIN) return
        lastStillParkedMin = nowMin
        course(CourseEvent.StillParked(nowMin), out)
    }

    // ---- 판정 ----

    private fun evaluate(now: Long, out: MutableList<Effect>) {
        if (state == TripState.PARKED || state == TripState.OUT || state == TripState.PLANNING) stillParkedTick(out)
        if (state == TripState.DRIVING || state == TripState.ARRIVING) stillDrivingTick(out)
        when (state) {
            TripState.IDLE -> when {
                gear == Gear.PARK && rearHeld(now, config.boardHoldMs) && !boardedToday -> {
                    boardedToday = true
                    // 14시 전이면 하루 코스, 이후면 짧은 나들이
                    val candidates = catalog.filter { it.id !in visited }
                    showPlan(Planner.firstBoarding(nowMin, loc ?: profile.home, profile.mealDay(today), candidates, skyToday(), today), out)
                    go(TripState.PLANNING, out)
                }
                gear.moving -> depart(out)
            }

            TripState.PLANNING -> if (gear.moving) {
                if (route.isEmpty()) out += Effect.CollapsePlan
                depart(out)
            }

            TripState.DRIVING, TripState.HOMEWARD, TripState.ARRIVING -> {
                if (state != TripState.ARRIVING) maybeIntro(out)
                if (parkedHeld(now)) onParked(out)
            }

            TripState.PARKED -> when {
                doorHeldOpen(now) -> {
                    outSinceMin = nowMin
                    introPlace?.let { out += Effect.HandoffToPhone(it) }
                    introPlace = null
                    herePlace?.takeIf { p -> stampedToday.any { it.id == p.id } }?.let { out += Effect.PushMission(it) }
                    go(TripState.OUT, out)
                }
                gear.moving -> depart(out)
            }

            TripState.OUT -> when {
                reboarded(now) -> {
                    val lc = liveCourse
                    if (nowMin - outSinceMin < config.minDwellMin) {
                        go(TripState.PARKED, out)
                    } else if (lc != null && (lc.remaining.isNotEmpty() || lc.current != null)) {
                        // 살아 있는 코스가 남아 있으면 새 3장 대신 코스 기준으로 (출발 준비 = 낮잠 '더 머물기'·한 곳 더 제안).
                        // 마지막 곳에서 다시 타도 코스를 버리지 않는다 → '한 곳 더'(여유 ≥ 45분) + '바로 집으로' 카드
                        releaseHeld(out)
                        course(CourseEvent.Departed(nowMin, herePlace?.id), out, force = true)
                        liveCourse?.takeIf { it.remaining.isNotEmpty() }?.let { out += Effect.RequestRoute(it.asOption()) }
                        go(TripState.PLANNING, out)
                    } else {
                        val candidates = catalog.filter { it.id !in visited }
                        showPlan(Planner.reboard(nowMin, loc ?: profile.home, profile.mealDay(today), candidates, skyToday(), today), out)
                        route.clear()
                        go(TripState.PLANNING, out)
                    }
                }
                gear.moving -> depart(out)
            }

            TripState.HOME -> {
                if (doorOpen && rear > 0 && !warnedRear) { warnedRear = true; out += Effect.WarnRearSeat }
                if (gear.moving) depart(out)
            }
        }
    }

    private fun depart(out: MutableList<Effect>) {
        tripStarted = true
        legStartAt = loc
        legStartOdo = odo
        // 경로거리는 지우지 않는다: 길 안내는 보통 출발 전(카드 고름·재탑승)에 요청돼 그때 온다. 도착 판정 뒤에 지운다
        legPathKm = 0.0; lastFix = loc
        etaLowCount = 0; lastEtaS = null; lastEtaMinSent = null
        lastNaviEtaMin = null; lastStillDrivingMin = null
        introPlace = null
        val from = herePlace
        herePlace = null
        warnedRear = false
        parkedSinceMin = null; lastStillParkedMin = null
        // 코스: 출발 (주행 중이라 카드는 없음). 상태를 먼저 바꿔야 '주행 중'으로 판정된다
        if (liveCourse != null) {
            go(if (homewardTrip) TripState.HOMEWARD else TripState.DRIVING, out)
            course(CourseEvent.Departed(nowMin, from?.id), out)
        }
        val q = TimeBudget.quietByDefault(nowMin, profile)
        if (q != quiet) { quiet = q; out += Effect.QuietMode(q) }
        val next = nextStop()
        out += Effect.ShowDrivingChip(
            when {
                next != null -> next.name + (if (quiet) " · 쉿 모드" else "")
                homewardTrip -> "집으로"
                else -> "마일스탬프"
            },
        )
        go(if (homewardTrip) TripState.HOMEWARD else TripState.DRIVING, out)
    }

    private fun maybeIntro(out: MutableList<Effect>) {
        val next = nextStop() ?: return
        if (next.id in introduced) return
        val near = loc?.let { Geo.km(it, next.at) <= IntroPicker.TRIGGER_SOFT_KM } ?: false
        if (etaLowCount < config.etaConsecutive && !near) return
        introduced += next.id
        etaLowCount = 0
        when (val v = IntroPicker.pick(lastEtaS, quiet)) {
            IntroVariant.PHONE_ONLY -> out += Effect.IntroToPhone(next)
            else -> { introPlace = next; out += Effect.PlayIntro(next, v) }
        }
        go(TripState.ARRIVING, out)
    }

    private fun onParked(out: MutableList<Effect>) {
        val here = loc
        // 집 또는 오늘 코스의 도착지(할머니 집 등)에 서면 하루 끝
        val ends = listOfNotNull(profile.home, liveCourse?.end?.at)
        if (here != null && tripStarted && ends.any { Geo.km(here, it) * 1000 <= config.homeRadiusM }) {
            go(TripState.HOME, out)
            out += Effect.DaySummary(
                stamps = stampedToday.size,
                rare = rareToday,
                rankedStamps = minOf(stampedToday.size, config.maxRankedPerDay),
                kmToday = odo?.let { o -> dayStartOdo?.let { o - it } },
            )
            return
        }
        // 어느 도착 원 안이든 그 장소. 여러 곳이 겹치면 가장 가까운 원 중심 쪽 (축제는 따로 본다)
        fun nearest(ps: List<Place>): Place? = here?.let { h ->
            ps.mapNotNull { p -> p.arrivalDistanceM(h)?.let { p to it } }.minByOrNull { it.second }?.first
        }
        // 코스에만 있는 바깥 장소(서버가 이름·좌표로 보낸 'ext:…' — 장소 목록 밖)도 도착 원으로 본다 (도장 없음 → '다녀옴')
        val courseOnly = liveCourse?.stops.orEmpty().map { it.place }
            .filter { p -> p.festival == null && catalog.none { it.id == p.id } }.distinctBy { it.id }
        val base = nearest(catalog.filter { it.festival == null } + courseOnly)
        // 오늘 열리는 축제의 도착 원 안이면 기간 한정 도장도 (기간 밖·쉬는 요일은 없음)
        val fest = nearest(catalog.filter { it.festival?.runsOn(today) == true })
        // 코스가 축제를 가리키면 도착도 축제로
        val place = listOfNotNull(fest, base).firstOrNull { p -> liveCourse?.stops?.any { it.id == p.id } == true } ?: base ?: fest
        herePlace = place
        if (base != null && !base.stampable) {
            if (base in courseOnly && base.id !in visited) out += Effect.Visited(base)
            visited += base.id
        }
        if (base != null && base.stampable) {
            grant(base, verify(base), out)
            visited += base.id
        }
        if (fest != null) {
            visited += fest.id
            val f = fest.festival!!
            if (f.id !in festivalStamped && fest.stampable) {
                // 같은 구간 주행거리로 따로 검증 (명소 도장이 '오늘 이미 찍음'이어도 축제 도장은 받을 수 있게)
                val v = verify(fest)
                if (v is StampVerdict.Granted) festivalStamped += f.id
                grant(fest, v, out)
            }
        }
        routeKmFirst = null; routeKmLast = null
        go(TripState.PARKED, out)
        // 코스: 장소면 도착, 아니면 예상 밖 정차 시작. 보류한 폰 명령·제안은 이제 적용
        if (liveCourse != null) {
            if (place != null) course(CourseEvent.Arrived(nowMin, place.id), out, force = true)
            else parkedSinceMin = nowMin
            releaseHeld(out)
        }
    }

    private fun verify(place: Place): StampVerdict = StampVerifier.verify(
        legStart = legStartAt ?: place.at,
        place = place,
        odoStartKm = legStartOdo,
        odoNowKm = odo,
        routeKmHint = listOfNotNull(routeKmFirst, routeKmLast).maxOrNull(),
        alreadyToday = stampedToday.any { it.id == place.id },
        gpsPathKm = legPathKm.takeIf { lastFix != null && legStartAt != null },
    )

    private fun grant(place: Place, verdict: StampVerdict, out: MutableList<Effect>) {
        when (verdict) {
            is StampVerdict.Granted -> {
                stampedToday += place
                // 희귀(조건) 도장은 주차한 때로만 판정 (빗길 운전 자체엔 보상 없음): 비 오는 날 · 해 진 뒤 밤 명소('밤의 ○○').
                // 축제 도장은 그 자체로 한정이라 희귀를 붙이지 않는다 (RareStamp)
                val rare = RareStamp.of(place, sky, nowMin, sunsetMin)
                if (rare != null) rareToday++
                out += Effect.StampGranted(place, profile.stampsBefore + stampedToday.size, rare, quiet, verdict)
            }
            is StampVerdict.Held -> out += Effect.StampHeld(place, verdict)
        }
    }

    /** 지금 아는 하늘 정보. 해 시각을 모르면 그 칸만 null. */
    fun skyToday(): SkyToday = SkyToday(sunriseMin, sunsetMin, sky, rainFromMin)

    private fun showPlan(plan: Plan, out: MutableList<Effect>) {
        lastPlan = plan
        out += Effect.ShowPlan(plan)
    }

    private fun nextStop(): Place? = route.firstOrNull { it.id !in visited }

    private fun go(to: TripState, out: MutableList<Effect>) {
        if (to == state) return
        out += Effect.StateChanged(state, to)
        state = to
    }

    private fun rearHeld(now: Long, hold: Long): Boolean =
        rear >= 1 && rearSinceMs?.let { now - it >= hold } == true

    private fun parkedHeld(now: Long): Boolean =
        gear == Gear.PARK && now - gearSinceMs >= config.parkHoldMs && speedKmh < 1f

    private fun doorHeldOpen(now: Long): Boolean = doorOpen && now - doorSinceMs >= config.doorHoldMs

    /** 문 닫힘과 2열 착좌가 둘 다 [Config.reboardHoldMs] 이상 유지. */
    private fun reboarded(now: Long): Boolean =
        !doorOpen && now - doorSinceMs >= config.reboardHoldMs && rearHeld(now, config.reboardHoldMs)

    private val Gear.moving: Boolean get() = this == Gear.DRIVE || this == Gear.REVERSE

    /** 화면·로그용 현재값. */
    data class Snapshot(
        val state: TripState,
        val gear: Gear,
        val speedKmh: Float,
        val driverDoorOpen: Boolean,
        val rearOccupied: Int,
        val odoKm: Double?,
        val location: LatLng?,
        val uxRestricted: Boolean,
        val nowMin: Int,
        val sky: Sky,
        val quiet: Boolean,
        val nextStop: String?,
        val stampsToday: List<String>,
    )

    companion object {
        /** Weather.rainSoon만 오고 시각을 모를 때 비 시작 어림 (지금 + 60분). */
        const val RAIN_SOON_GUESS_MIN = 60
        /** 예정 출발이 지난 뒤 StillParked 간격. */
        const val STILL_PARKED_EVERY_MIN = 5
        /** 장소 아닌 곳에 이만큼 서 있으면 예상 밖 정차. */
        const val STILL_PARKED_ROAD_MIN = 10
        /** 다음 곳 예정 도착 이만큼 전부터 '아직 가는 중'을 본다. */
        const val STILL_DRIVING_EARLY_MIN = 2
        /** StillDriving 간격. */
        const val STILL_DRIVING_EVERY_MIN = 5
        /** 이 시간 안에 내비 ETA가 왔으면 StillDriving을 내지 않는다. */
        const val NAVI_FRESH_MIN = 10
        /** GPS 궤적: 한 번에 이보다 멀리 뛰면 뺀다. */
        const val PATH_JUMP_KM = 2.0
        /** GPS 궤적: 이 거리 이하는 속도 검사 없이 (같은 시각에 온 작은 흔들림). */
        const val PATH_JITTER_KM = 0.05
        /** GPS 궤적: 이 속도를 넘는 움직임은 뺀다. */
        const val PATH_MAX_KMH = 200.0
    }

    fun snapshot() = Snapshot(
        state, gear, speedKmh, doorOpen, rear, odo, loc, ux, nowMin, sky, quiet,
        nextStop()?.name, stampedToday.map { it.name },
    )
}
