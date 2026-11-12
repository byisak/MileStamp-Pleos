package kr.milestamp.car.trip

import android.Manifest
import android.app.Notification
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import java.time.LocalDate
import java.time.LocalTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import kr.milestamp.car.BuildConfig
import kr.milestamp.car.MileStampApp
import kr.milestamp.car.R
import kr.milestamp.car.audio.IntroAudio
import kr.milestamp.car.net.CourseJson
import kr.milestamp.car.net.ServerApi
import kr.milestamp.car.net.RemoteStamps
import kr.milestamp.car.net.StampStore
import kr.milestamp.car.net.ServerApi.CourseReply
import kr.milestamp.car.signals.CarSignals
import kr.milestamp.car.signals.LocationFallback
import kr.milestamp.car.signals.NaviSignals
import kr.milestamp.car.signals.PleosVehicleSignals
import kr.milestamp.car.signals.SignalSource
import kr.milestamp.car.ui.MainActivity
import kr.milestamp.engine.Change
import kr.milestamp.engine.ChangeSize
import kr.milestamp.engine.CourseEvent
import kr.milestamp.engine.Effect
import kr.milestamp.engine.FamilyProfile
import kr.milestamp.engine.MealSetup
import kr.milestamp.car.ui.GoWords
import kr.milestamp.engine.IntroVariant
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.OptionKind
import kr.milestamp.engine.Place
import kr.milestamp.engine.PlanMode
import kr.milestamp.engine.SeedPlaces
import kr.milestamp.engine.SignalEvent
import kr.milestamp.engine.Sky
import kr.milestamp.engine.StopStatus
import kr.milestamp.engine.Sun
import kr.milestamp.engine.TripEngine
import kr.milestamp.engine.TripState
import org.json.JSONArray
import org.json.JSONObject

/**
 * 차량 신호 → 판정 엔진 → 할 일(Effect).
 * 신호는 한 줄(Channel)로 모아 한 스레드에서만 엔진을 부른다. 화면이 없어도 돈다.
 */
class TripService : LifecycleService() {

    private lateinit var engine: TripEngine
    private lateinit var navi: NaviSignals
    private lateinit var sources: List<SignalSource>
    private lateinit var intro: IntroAudio
    private val inbox = Channel<SignalEvent>(capacity = Channel.UNLIMITED)

    /** 디버그 시계(시연용). null이면 벽시계. */
    @Volatile private var debugClockMin: Int? = null
    /** 디버그 날짜('2026-10-31', 시연용) — 서버 계획 at= 의 날짜. null이면 오늘. 폰(curl)이 같은 날 계획을 보게 맞춘다. */
    @Volatile private var debugDay: String? = null
    @Volatile private var resetRequested = false

    /** 서버(가족 폰)로 보내기. 차 판정 스레드를 막지 않게 따로 띄운다. */
    private val server by lazy { ServerApi(applicationContext) }
    private var introVariant = IntroVariant.FULL_60S
    private val stampedIds = mutableListOf<String>()
    /** 지금 엔진 하루가 시작된 벽시계(ms) — 이 뒤에 찍힌 [stampedIds] 도장은 엔진이 '오늘 순서'로 센다. 엔진 스레드에서만. */
    private var dayStartMs = System.currentTimeMillis()
    /** 도장 기록(StampStore)이 바뀜 → 소비 스레드에서 '오늘 이전 도장 수'를 다시 세어 엔진에 넣는다. */
    @Volatile private var stampCountDirty = true

    // ---- 오늘 어디 갈까요? (서버 계획) ----
    /** 서버 장소 목록을 받으면 소비 스레드에서 엔진 후보를 바꾼다. */
    @Volatile private var pendingCatalog: List<Place>? = null
    /** 서버에서 받은 우리 가족 설정 (소비 스레드에서 엔진에 넣는다). */
    @Volatile private var pendingProfile: FamilyProfile? = null
    /** 서버 오늘 계획의 동행 (가족 설정의 마지막 동행보다 앞선다). 하루 초기화 때 지움. */
    @Volatile private var planGoWith: kr.milestamp.engine.GoWith? = null
    /** 계획을 계속 받아 오는 일 (첫 탑승 PLANNING 동안만). */
    @Volatile private var planJob: Job? = null
    /** 마지막으로 엔진에 넣은 서버 계획 (planId|고른 번호|고른 사람) — 바뀌었을 때만 다시 넣어 화면이 깜빡이지 않게. */
    @Volatile private var lastServerKey: String? = null
    /** 서버 계획 신호 → 그 계획의 id. 엔진이 그 신호로 계획을 보여 주면 [shownPlanId]가 된다. */
    private data class Incoming(val planId: String, val chosen: Int?, val late: Boolean)
    private val incoming = ConcurrentHashMap<SignalEvent.ServerPlan, Incoming>()
    private var handlingIncoming: Incoming? = null
    /** 지금 화면 계획이 서버 것이면 그 id와 서버에서 이미 고른 번호 (차 자기 계산이면 null). */
    private var shownPlanId: String? = null
    private var shownChosen: Int? = null

    // ---- 살아 있는 코스 (서버와 맞추기, docs/코스-고도화-계획.md 5절·10절) ----
    /** 마지막으로 화면에 낸 코스 — 코스 변경이 어떤 사건에서 왔는지 어림잡는 '전' 코스. 엔진 스레드에서만 만진다. */
    private var lastCourse: LiveCourse? = null
    /** 지금 엔진에 넣고 있는 신호 (CourseUpdated가 글레오·버튼 명령인지, 채택인지 알기 위해). */
    private var handlingSignal: SignalEvent? = null
    /** 서버에 오늘 코스가 있다고 보는지. 404면 끄고(보내 봐야 소용없음), GET이 코스를 주면 다시 켠다. */
    @Volatile private var serverHasCourse = true
    /** 서버에서 이 코스를 한 번이라도 받았음 — 그 뒤 404면 가족 폰이 코스를 취소한 것 ([serverCourseGone]). */
    @Volatile private var serverCourseSeen = false
    /** 서버가 PATCH(POST + 덮어쓰기 머리말)를 405로 거절하면 이번 실행 동안은 안 보낸다. */
    @Volatile private var serverPatchOk = true
    /** 못 보낸 차 변경이 있음 → 다시 연결되면 차 코스의 남은 순서 전체를 Remote(by=차)로 맞춘다. */
    @Volatile private var syncDirty = false
    /** 마지막으로 본 서버 버전 — 같은 코스를 거듭 넣지 않게 (우리가 보낸 변경의 메아리 포함). */
    @Volatile private var seenServerVersion = -1
    /** 서버 호출을 순서대로 한 줄로 (도착 → 빼기 순서가 뒤바뀌지 않게). */
    private val syncQueue = Channel<suspend () -> Unit>(capacity = Channel.UNLIMITED)
    /** 가족 폰이 서버에서 거절('그대로 갈게요')한 제안을 차 카드에서도 치우기 위한 판단. */
    private val proposalWatch = ProposalDismissWatch()

    private fun send(kind: String, placeId: String?, payload: JSONObject = JSONObject()) {
        // 바깥 장소(ext:…)는 서버 장소표에 없어 소개·미션·이어 듣기 소식을 받지 않는다 ('다녀옴'은 코스 도착 사건으로 남는다)
        if (placeId != null && CourseJson.isExt(placeId)) { TripHub.log("바깥 장소 소식은 안 보냄: $kind $placeId"); return }
        lifecycleScope.launch { server.event(kind, placeId, payload) }
    }

    /**
     * 도장 보내기. 서버가 No.의 기준이라 서버가 다른 번호를 정했으면 떠 있는 도장 화면도 그 번호로 바꾸고,
     * 도장 목록을 다시 받아 엔진의 모은 수를 맞춘다.
     */
    private fun sendStamp(place: Place, carNumber: Int, payload: JSONObject) {
        lifecycleScope.launch {
            val res = server.eventReply("stamp", place.id, payload)
            val n = res?.optJSONObject("payload")?.optInt("number", -1) ?: -1
            if (n > 0 && n != carNumber) {
                TripHub.log("도장 No.$carNumber → 서버 No.$n")
                TripHub.update { ui ->
                    val s = ui.stamp
                    if (s != null && s.place.id == place.id && s.number == carNumber) ui.copy(stamp = s.copy(serverNumber = n)) else ui
                }
            }
            if (res != null) StampStore.refresh(server)
        }
    }

    override fun onCreate() {
        super.onCreate()
        startAsForeground()

        engine = TripEngine(SeedPlaces.demoProfile(), SeedPlaces.ALL)
        intro = IntroAudio(this) { placeId -> inbox.trySend(SignalEvent.IntroFinished(placeId, SystemClock.elapsedRealtime())) }
        TripHub.speaker = { text -> intro.say(text) }

        val status = TripHub::status
        navi = NaviSignals(this, status)
        sources = listOf(CarSignals(this, status), PleosVehicleSignals(this, status), navi, LocationFallback(this, status))

        TripHub.sink = { inbox.trySend(it) }
        TripHub.navigator = { navigateRemaining() }
        TripHub.keepHook = { p -> keepOnServer(p) }
        TripHub.storyHook = { placeId -> send("intro", placeId, JSONObject().put("variant", IntroVariant.FULL_60S.name).put("byButton", true)) }
        TripHub.update { it.copy(dinnerMin = engine.profile.dinnerMin) }
        sources.forEach { it.start { e -> inbox.trySend(e) } }

        consume()
        tickLoop()
        loadPlaces()
        loadFamily()
        watchStampCount()
        syncWorker()
        courseLoop()
    }

    /** 서버 추천 후보(하루 한 번 받아 파일에 저장)를 엔진 후보로. 못 받으면 차 안 목록(SeedPlaces) 그대로. */
    private fun loadPlaces() = lifecycleScope.launch {
        val places = server.places() ?: return@launch
        // 서버에 없는 시연 장소(위조 시연용 하회마을 등)는 남겨 둔다
        val ids = places.map { it.id }.toSet()
        pendingCatalog = places + SeedPlaces.ALL.filter { it.id !in ids }
        inbox.trySend(SignalEvent.Tick(SystemClock.elapsedRealtime()))
        // 관리자에서 바꾼 도장 그림 (바뀐 것만 받음, 실패해도 차에 든 그림으로)
        RemoteStamps.sync(server, server.stampRefs())
    }

    /**
     * 우리 가족 설정(폰 '우리 가족': 집·낮잠·귀가 기준·저녁·아이)을 서버에서 받아 엔진 가족 정보로. 켤 때·하루 초기화 때.
     * 저장된 적이 없거나 못 받으면 지금 것 그대로(데모 차는 시연 프로필 — 집 북구청). 집 좌표는 로그에 남기지 않는다.
     */
    private fun loadFamily() = lifecycleScope.launch {
        val p0 = server.family(SeedPlaces.demoProfile()) ?: return@launch
        // 밥도 같이 짜기를 켰으면 장소 목록(하루 한 번 저장)에 실린 식당을 엔진에 — 인터넷이 안 돼도 밥 자리를 넣는다
        val p = if (p0.meal != null) {
            server.places()
            p0.copy(meal = MealSetup(server.restaurants()))
        } else p0
        pendingProfile = p
        inbox.trySend(SignalEvent.Tick(SystemClock.elapsedRealtime()))
    }

    private fun placeById(id: String): Place? = TripHub.placeById(id)

    /**
     * 도장 No.가 날마다 23부터 되풀이되지 않게: 켤 때 서버 도장 목록을 받고, 도장 기록이 바뀔 때마다(서버 받기·차 기록)
     * 엔진의 '오늘 이전 도장 수'를 실제 수로 맞춘다. 서버 목록을 한 번도 못 받았으면 엔진 기본값(시연 프로필) 그대로.
     */
    private fun watchStampCount() {
        lifecycleScope.launch { StampStore.refresh(server) }
        lifecycleScope.launch {
            StampStore.rows.collect {
                stampCountDirty = true
                inbox.trySend(SignalEvent.Tick(SystemClock.elapsedRealtime()))
            }
        }
    }

    /** 소비 스레드에서만. */
    private fun applyStampCount() {
        if (!StampStore.known) return
        // 올해 이미 받은 축제 한정 도장 (같은 축제는 해마다 한 번)
        engine.setFestivalStamps(StampStore.festivalIdsIn(StampStore.rows.value, LocalDate.now().year))
        val n = StampStore.countBefore(StampStore.rows.value, dayStartMs, stampedIds.toSet())
        if (n != engine.profile.stampsBefore) {
            engine.setStampsBefore(n)
            TripHub.log("모은 도장 ${n}개 (오늘 첫 도장 No.${n + 1 + stampedIds.size})")
        }
    }

    /**
     * 첫 탑승 계획 화면 동안 서버의 오늘 계획을 받아 엔진에 넣는다.
     * 첫 요청은 2초 제한(늦으면 차 자기 계산이 이미 떠 있음), 그 뒤 정차 중이면 15초마다 — 폰에서 고르면 차에 뜬다.
     */
    private fun startPlanSync() {
        planJob?.cancel()
        val boardedAt = SystemClock.elapsedRealtime()
        planJob = lifecycleScope.launch {
            var tries = 0
            while (isActive) {
                val snap = TripHub.ui.value.snapshot
                if (snap != null && snap.state != TripState.PLANNING) break
                val parked = DriveGate.parked(snap)
                var ok = true
                if (parked) {
                    val home = engine.profile.home
                    val here = snap?.location ?: home
                    // 시연(디버그 시계)이면 그 시각으로 계산해 달라고 한다 — 서버는 데모 차만 받아 줌
                    val at = debugClockMin?.takeIf { BuildConfig.DEBUG }?.let { "%sT%02d:%02d".format(debugDay ?: LocalDate.now(), it / 60, it % 60) }
                    val res = server.plan(here, home, ::placeById, at, timeoutMs = if (tries == 0) FIRST_PLAN_TIMEOUT_MS else 6_000)
                    ok = res != null
                    if (res != null && res.plan.mode != PlanMode.REBOARD) {
                        val key = "${res.planId}|${res.chosen}|${res.chosenBy}"
                        if (key != lastServerKey) {
                            lastServerKey = key
                            res.companion?.let { planGoWith = it }
                            TripHub.update { it.copy(tomorrowHint = res.tomorrowHint) }
                            val ev = SignalEvent.ServerPlan(res.plan, res.chosen, res.chosenBy, SystemClock.elapsedRealtime())
                            incoming[ev] = Incoming(res.planId, res.chosen, SystemClock.elapsedRealtime() - boardedAt > FIRST_PLAN_TIMEOUT_MS)
                            inbox.trySend(ev)
                        }
                    }
                }
                tries++
                // 첫 요청이 실패하면 3초 뒤 한 번 더, 그 뒤로는 15초마다
                delay(if (!ok && tries == 1) 3_000 else PLAN_POLL_MS)
            }
        }
    }

    private fun stopPlanSync() {
        planJob?.cancel()
        planJob = null
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun consume() = lifecycleScope.launch(Dispatchers.Default.limitedParallelism(1)) {
        for (e in inbox) {
            if (resetRequested) {
                resetRequested = false
                engine.resetDay()
                stampedIds.clear()
                dayStartMs = System.currentTimeMillis(); stampCountDirty = true
                lifecycleScope.launch { StampStore.refresh(server) }
                loadFamily()
                stopPlanSync(); lastServerKey = null; shownPlanId = null; shownChosen = null
                lastCourse = null; syncDirty = false; seenServerVersion = -1; serverHasCourse = true; serverCourseSeen = false; TripHub.dismissed = null
                proposalWatch.reset()
                planGoWith = null
                TripHub.update { it.copy(tomorrowHint = false, plan = null, planNote = null, stamp = null, held = null, introPlaying = null, course = null, proposal = null, chip = null, lastSummary = null, storySent = null) }
                TripHub.log("하루 초기화")
            }
            // 시연·점검용: 매초 시계 말고 실제로 바뀐 신호만 logcat에 (adb logcat -s MileStamp)
            if (stampCountDirty) { stampCountDirty = false; applyStampCount() }
            pendingProfile?.let {
                pendingProfile = null
                engine.updateProfile(planGoWith?.let { g -> it.copy(companion = g) } ?: it)
                TripHub.update { ui -> ui.copy(dinnerMin = it.dinnerMin) }
                TripHub.log("우리 가족 설정 받음 (낮잠 ${if (it.hasNap) "${it.napStartMin / 60}시" else "없음"} · 아이 ${it.kidAges.size}명)")
            }
            planGoWith?.takeIf { it != engine.profile.companion }?.let { g ->
                engine.updateProfile(engine.profile.copy(companion = g))
                TripHub.log("이 계획의 동행: ${g.text}")
            }
            if (TripHub.ui.value.companion != engine.profile.companion) TripHub.update { it.copy(companion = engine.profile.companion) }
            pendingCatalog?.let {
                pendingCatalog = null
                engine.replaceCatalog(it)
                TripHub.catalog = engine.catalog
                TripHub.log("추천 후보 ${it.size}곳 (서버)")
            }
            if (e !is SignalEvent.Tick && e !is SignalEvent.Clock) Log.d(TAG, "신호 ${if (e is SignalEvent.ServerPlan) "ServerPlan ${e.plan.mode} 고름=${e.chosenIdx} ${e.by}" else e}")
            handlingIncoming = (e as? SignalEvent.ServerPlan)?.let { incoming.remove(it) }
            handlingSignal = e
            val effects = engine.handle(e)
            if (effects.isNotEmpty() || e !is SignalEvent.Tick) publish(effects)
            handlingIncoming = null
            handlingSignal = null
        }
    }

    /** 1초마다 '유지 시간' 판정, 1분마다 시각, 날이 바뀌면 해 시각. (엔진 호출 1회/초 — 가벼움) */
    private fun tickLoop() = lifecycleScope.launch {
        var lastMin = -1
        var sunDay: LocalDate? = null
        while (isActive) {
            val now = SystemClock.elapsedRealtime()
            val today = LocalDate.now()
            if (today != sunDay) {
                sunDay = today
                // 인터넷 없이도 되는 대체 계산(NOAA 공식, 집 기준). 서버 계획이 오면 그쪽 천문연 값이 들어 있다.
                Sun.riseSet(engine.profile.home, today)?.let { inbox.trySend(SignalEvent.Sun(it.sunriseMin, it.sunsetMin, now)) }
            }
            val min = debugClockMin ?: LocalTime.now().let { it.hour * 60 + it.minute }
            // 날짜도 같이 (축제 기간 판단). 디버그 시계에 날짜가 있으면 그 날
            if (min != lastMin) { lastMin = min; inbox.trySend(SignalEvent.Clock(min, now, debugDay ?: today.toString())) }
            inbox.trySend(SignalEvent.Tick(now))
            delay(1_000)
        }
    }

    private suspend fun publish(effects: List<Effect>) {
        val snap = engine.snapshot()
        TripHub.update { it.copy(snapshot = snap) }
        for (fx in effects) {
            TripHub.log(TripHub.describe(fx))
            apply(fx)
        }
        // 코스가 생기거나(카드 고름) 없어지면(바로 집으로·초기화) 화면에 — CourseUpdated 없이 바뀌는 경우
        val lc = engine.liveCourse
        if (lc !== lastCourse) {
            lastCourse = lc
            TripHub.update { it.copy(course = lc, proposal = if (lc == null) null else it.proposal) }
        }
        // 코스 화면 맨 위 쉬운 설명 (차 시계 기준 — 시간표가 뒤처졌으면 엔진이 Tick을 해 본 결과로)
        val ex = engine.explainCourse(snap.nowMin)
        if (ex != TripHub.ui.value.explain) TripHub.update { it.copy(explain = ex) }
    }

    private suspend fun apply(fx: Effect) {
        when (fx) {
            // 새 추천·보류·요약이 오면 앞서 떠 있던 도장 화면은 닫는다 (도장 화면이 우선이라 가려짐)
            is Effect.ShowPlan -> {
                val inc = handlingIncoming
                // 차 자기 계산을 먼저 보여 준 뒤 늦게 온 서버 계획으로 바꿨으면 작게 알린다
                val note = if (inc != null && inc.late && shownPlanId == null && inc.chosen == null) "방금 새로 받은 계획이에요" else null
                shownPlanId = inc?.planId
                shownChosen = inc?.chosen
                val far = kr.milestamp.car.ui.outOfAreaKm(TripHub.ui.value.snapshot?.location, TripHub.catalog)
                TripHub.update { it.copy(plan = fx.plan, planNote = note, outOfAreaKm = far, stamp = null, held = null, summary = null, sky = fx.plan.sky ?: it.sky) }
                bringToFront()
            }
            is Effect.ShowDrivingChip -> TripHub.update { it.copy(chip = fx.text) }
            is Effect.CourseUpdated -> onCourseUpdated(fx)
            is Effect.CourseProposal -> {
                val p = ProposalShown(fx.options, fx.change, fx.course.version)
                // 사용자가 '그대로 갈게요'로 치운 같은 제안은 다시 띄우지 않는다 (엔진은 다음 정차 때 다시 낸다)
                if (TripHub.proposalKey(p) != TripHub.dismissed) {
                    TripHub.update { it.copy(proposal = p) }
                    bringToFront()
                }
            }
            // 떠 있던 제안이 지남(코스가 바뀜·이미 감·권한 출발 시각 지남) 또는 '그대로 갈게요' → 카드 치움
            is Effect.ProposalCleared -> TripHub.update { it.copy(proposal = null) }
            Effect.CollapsePlan -> TripHub.update { it.copy(plan = null) }
            is Effect.PlanChosen -> {
                stopPlanSync()
                // 서버 계획에서 고른 것만 서버에 알린다 (폰에서 이미 고른 그 카드로 출발하면 다시 안 알림)
                val id = shownPlanId
                val idx = fx.index
                if (id != null && idx != null && idx != shownChosen) {
                    shownChosen = idx
                    lastServerKey = "$id|$idx|차"
                    lifecycleScope.launch { server.choose(id, idx) }
                }
            }
            is Effect.RequestRoute -> {
                TripHub.update { it.copy(plan = null, planNote = null) }
                // 코스 전체: 마지막 곳 = 목적지, 앞 곳 = 경유지. 바로 집으로면 집.
                when {
                    fx.option.stops.isNotEmpty() -> navi.requestCourse(fx.option.stops)
                    // 오늘 코스의 도착지(할머니 집 등)가 있으면 그곳, 아니면 집
                    fx.option.kind == OptionKind.GO_HOME -> navi.requestRouteHome(engine.liveCourse?.end?.at ?: engine.profile.home)
                }
            }
            is Effect.PlayIntro -> {
                TripHub.update { it.copy(introPlaying = fx.place.name) }
                introVariant = fx.variant
                intro.play(fx.place, fx.variant)
            }
            is Effect.HandoffToPhone -> {
                // 멈추기 전에 위치부터 잰다 → 폰은 그 위치가 속한 문장의 처음부터
                val pos = intro.positionMs()
                intro.fadeOutForHandoff()
                send("handoff", fx.place.id, JSONObject().put("variant", introVariant.name).put("positionMs", pos))
            }
            is Effect.PushMission -> send("mission", fx.place.id)
            is Effect.Visited -> {
                // 도장 없는 바깥 장소: 메달·소리 없이 '다녀옴' 화면. 서버 기록은 같은 정차의 코스 도착 사건(PATCH Arrived)이 한다
                val v = VisitShown(fx.place, recorded = CourseJson.isExt(fx.place.id), atMs = SystemClock.elapsedRealtime())
                TripHub.update { it.copy(visit = v, stamp = null, held = null, introPlaying = null) }
                bringToFront()
                lifecycleScope.launch {
                    delay(VISIT_SHOW_MS)
                    TripHub.update { if (it.visit == v) it.copy(visit = null) else it }
                }
            }
            is Effect.IntroToPhone -> send("intro", fx.place.id, JSONObject().put("variant", IntroVariant.FULL_60S.name))
            is Effect.StampGranted -> {
                stampedIds += fx.place.id
                TripHub.update { it.copy(stamp = StampShown(fx.place, fx.number, fx.rare, fx.silent), held = null, introPlaying = null) }
                val body = JSONObject().put("number", fx.number).put("rare", fx.rare ?: JSONObject.NULL).put("silent", fx.silent)
                // 축제 한정 도장: 서버가 기간·한 해 한 번을 다시 확인한다
                fx.place.festival?.let { body.put("festivalId", it.id) }
                sendStamp(fx.place, fx.number, body)
                if (!fx.silent) intro.stampSound()
                bringToFront()
            }
            is Effect.StampHeld -> {
                TripHub.update { it.copy(held = "${fx.place.name} · ${fx.verdict.detail}", stamp = null, summary = null, book = false) }
                bringToFront()
            }
            is Effect.DaySummary -> {
                send(
                    "summary", null,
                    JSONObject().put("stamps", fx.stamps).put("rare", fx.rare)
                        .put("km", fx.kmToday ?: JSONObject.NULL).put("places", JSONArray(stampedIds.distinct())),
                )
                val sum = DaySummaryShown(fx.stamps, fx.rare, fx.kmToday)
                TripHub.update { it.copy(summary = sum, lastSummary = sum, stamp = null, held = null, plan = null, book = false) }
                bringToFront()
            }
            Effect.WarnRearSeat -> if (!GoWords.rearSeatCheck(engine.profile.companion)) {
                // 어른끼리(연인·부부 · 친구끼리 · 혼자)는 뒷좌석 아이 확인을 하지 않는다
                TripHub.log("뒷좌석 확인 건너뜀 (${engine.profile.companion.text})")
            } else {
                TripHub.update { it.copy(summary = (it.summary ?: DaySummaryShown(0, 0, null)).copy(rearWarning = true)) }
                intro.say("잠깐만요! 뒷좌석에 아이가 있는지 꼭 확인해 주세요.", asset = "voice/rear_seat.mp3")
                bringToFront()
            }
            is Effect.StateChanged -> {
                if (fx.to == TripState.DRIVING || fx.to == TripState.HOMEWARD) {
                    // 주행 중엔 카드 없음 — 제안은 엔진이 들고 있다가 다음 정차 때 다시 낸다
                    TripHub.update { it.copy(stamp = null, held = null, summary = null, proposal = null) }
                }
                // 오늘 첫 탑승(대기 → 계획)일 때만 서버 계획을 받는다. 재탑승 계획은 차 자기 계산 (서버엔 재탑승 모드가 없음)
                if (fx.from == TripState.IDLE && fx.to == TripState.PLANNING) startPlanSync()
                else if (fx.to != TripState.PLANNING) stopPlanSync()
                // 살아 있는 코스 중 다시 탐: 새 추천 카드가 없어서 앞서 떠 있던 도장·보류 화면이 '오늘 코스'(제안 카드)를 가리던 것 → 닫기
                if (fx.to == TripState.PLANNING && fx.from != TripState.IDLE && engine.liveCourse != null) {
                    TripHub.update { it.copy(stamp = null, held = null) }
                }
            }
            else -> Unit // 칩·쉿 모드는 화면 로그로만
        }
    }

    // ---------------------------------------------------------------- 살아 있는 코스

    /**
     * 코스가 바뀜 → 화면(코스·칩), 음성 한 문장, 서버 맞추기.
     *  - 칩: 변경이 있고 QUIET이 아니면 그 글(주행 중 칩 자리에도 그대로).
     *  - 음성: LOUD 변경이고 쉿 모드가 아니면 한 문장 (주행 중에도 — 계획 2절 6번 "주행 중엔 칩 한 줄 + 음성 한 문장").
     *  - 서버: 차에서 비롯된 변경(출발·도착·내비·날씨·명령·채택)을 같은 사건으로 PATCH. 폰 코스(Remote)·보류 칩은 안 보냄.
     */
    private fun onCourseUpdated(fx: Effect.CourseUpdated) {
        val before = lastCourse
        val c = fx.course
        lastCourse = c
        val change = fx.change
        val signal = handlingSignal
        val proposalBefore = TripHub.ui.value.proposal
        TripHub.update {
            it.copy(
                course = c,
                chip = if (change != null && change.size != ChangeSize.QUIET) change.text else it.chip,
                // 코스가 다른 버전으로 바뀌면 옛 제안 카드는 치운다 (새 제안은 바로 뒤 CourseProposal로 온다)
                proposal = it.proposal?.takeIf { p -> p.version == c.version },
            )
        }
        val snap = engine.snapshot()
        if (fx.voice != null && change != null && change.size == ChangeSize.LOUD && !snap.quiet) intro.say(fx.voice!!)

        // ---- 서버 맞추기 ----
        if (change != null && (change.cause == "보류" || change.cause == "폰 변경")) return
        if (before != null && before.version == c.version) return
        val baseVersion = before?.version ?: (c.version - 1)
        if (change == null) {
            // 칩 없는 변화라도 장소 도착·출발은 서버에 알린다 — 안 보내면 서버 코스가 '다음 = 첫 장소'에 머물러
            // 폰 화면의 장소 상태와 서버 판정(들르기·빼기)이 실제와 어긋난다
            val ev = arrivalOrDeparture(signal, before, c) ?: return
            val drivingNow = snap.uxRestricted || snap.state == TripState.DRIVING || snap.state == TripState.ARRIVING || snap.state == TripState.HOMEWARD
            val j = CourseJson.event(ev, drivingNow, snap.location)
            enqueueSync { reply(server.courseEvent(baseVersion, j), "${j.optString("type")} v$baseVersion") }
            return
        }
        if (signal is SignalEvent.RouteChosen && change.cause == "선택") {
            // 제안 카드 채택 → adopt (서버도 같은 제안을 들고 있을 때만 통한다)
            val idx = proposalBefore?.options?.indexOf(signal.option)?.takeIf { it >= 0 }
            TripHub.update { it.copy(proposal = null) }
            // now = 차 시계(시연은 디버그 시계) — 서버가 제안이 지났는지(권한 출발 시각) 이 시각으로 본다
            val now = snap.nowMin
            if (idx != null) enqueueSync { reply(server.adoptCourse(baseVersion, idx, now), "채택 ${signal.option.label}") }
            return
        }
        val event = inferEvent(signal, before, c, change) ?: return
        val driving = snap.uxRestricted || snap.state == TripState.DRIVING || snap.state == TripState.ARRIVING || snap.state == TripState.HOMEWARD
        val json = CourseJson.event(event, driving, snap.location)
        enqueueSync { reply(server.courseEvent(baseVersion, json), "${json.optString("type")} v$baseVersion") }
    }

    /**
     * 어떤 사건이 코스를 바꿨는지 어림: 명령 신호면 그 사건, 아니면 변경 원인(cause)과 전·후 코스 차이로.
     * (엔진이 출발·도착·정차·내비를 안에서 만들기 때문에 효과에는 사건이 실려 오지 않는다.)
     */
    private fun inferEvent(signal: SignalEvent?, before: LiveCourse?, after: LiveCourse, change: Change): CourseEvent? {
        if (signal is SignalEvent.CourseCommand) return signal.event.takeUnless { it is CourseEvent.Remote }
        if (signal is SignalEvent.RouteChosen) return null
        val now = after.nowMin
        fun becameSkipped(): String? = before?.stops?.firstOrNull { b ->
            (b.remaining || b.status == StopStatus.ARRIVED) && after.stops.firstOrNull { it.id == b.id }?.status == StopStatus.SKIPPED
        }?.id
        val byCause: CourseEvent? = when (change.cause) {
            "도착" -> after.current?.let { CourseEvent.Arrived(now, it.id) }
            "출발", "일찍 출발", "늦게 출발" -> CourseEvent.Departed(now, before?.current?.id)
            "머무름 길어짐", "예상 밖 정차" -> CourseEvent.StillParked(now)
            "내비" -> (signal as? SignalEvent.Eta)?.let { CourseEvent.NaviEta(now, (it.remainS + 30) / 60) }
            "늦어짐" -> after.here?.let { CourseEvent.StillDriving(now, it) }
            "비" -> {
                val rain = after.rainFromMin
                val sky = (signal as? SignalEvent.Weather)?.sky ?: if (rain != null && rain <= now) Sky.RAIN else Sky.CLEAR
                CourseEvent.Weather(now, sky, rain?.takeIf { it > now })
            }
            "한계" -> CourseEvent.LimitChanged(now, after.limitMin)
            "다음 바꾸기" -> after.next?.let { CourseEvent.ReplaceNext(now, it.id) }
            "빼기" -> (becameSkipped() ?: before?.current?.takeIf { b -> after.stops.firstOrNull { it.id == b.id }?.status == StopStatus.DONE }?.id)
                ?.let { CourseEvent.Skip(now, it) }
            "들르기" -> after.stops.firstOrNull { a -> before?.stops?.none { it.id == a.id } == true }?.let { CourseEvent.Insert(now, it.id) }
            "문 닫음" -> becameSkipped()?.let { CourseEvent.PlaceClosed(now, it) }
            "집으로" -> CourseEvent.GoHome(now)
            else -> null
        }
        if (byCause != null) return byCause
        // 원인에 사건이 안 실린 경우('한계 침범' 등): 신호·코스 차이로
        return when {
            signal is SignalEvent.Eta -> CourseEvent.NaviEta(now, (signal.remainS + 30) / 60)
            signal is SignalEvent.Weather -> CourseEvent.Weather(now, signal.sky, after.rainFromMin?.takeIf { it > now })
            signal is SignalEvent.Sun -> CourseEvent.LimitChanged(now, after.limitMin)
            after.current != null && after.current?.id != before?.current?.id -> CourseEvent.Arrived(now, after.current!!.id)
            before?.current != null && after.stops.firstOrNull { it.id == before.current!!.id }?.status == StopStatus.DONE -> CourseEvent.Departed(now, before.current!!.id)
            else -> CourseEvent.StillParked(now)
        }
    }

    /** 칩 없는 코스 변화 중 장소 도착·출발만 사건으로 (그 밖의 조용한 시간표 변화는 서버가 다음 사건 때 스스로 맞춘다). */
    private fun arrivalOrDeparture(signal: SignalEvent?, before: LiveCourse?, after: LiveCourse): CourseEvent? {
        if (signal is SignalEvent.CourseCommand || signal is SignalEvent.RouteChosen) return null
        val now = after.nowMin
        after.current?.takeIf { it.id != before?.current?.id }?.let { return CourseEvent.Arrived(now, it.id) }
        val left = before?.current?.takeIf { b -> after.stops.firstOrNull { it.id == b.id }?.status == StopStatus.DONE }
        return left?.let { CourseEvent.Departed(now, it.id) }
    }

    private fun enqueueSync(work: suspend () -> Unit) {
        if (serverHasCourse && serverPatchOk) syncQueue.trySend(work) else syncDirty = true
    }

    /** 서버 호출을 한 줄로 순서대로. */
    private fun syncWorker() = lifecycleScope.launch { for (work in syncQueue) runCatching { work() }.onFailure { Log.w(TAG, "코스 서버 맞추기 실패", it) } }

    /** 서버 답 처리: 2xx면 버전 기억, 409면 서버 코스를 Remote로, 404면 서버에 코스 없음, 통신 실패면 다시 연결될 때 맞춘다. */
    private fun reply(r: CourseReply, what: String) {
        when (r) {
            is CourseReply.Ok -> {
                syncDirty = false; serverCourseSeen = true
                val v = r.json.optJSONObject("course")?.optInt("version", -1) ?: r.json.optInt("version", -1)
                if (v > seenServerVersion) seenServerVersion = v
                TripHub.log("서버 코스 맞춤: $what → v$v")
                checkServerProposal(r.json)
            }
            is CourseReply.Conflict -> {
                syncDirty = false; TripHub.log("서버 코스가 더 새로움: $what")
                checkServerProposal(r.json)
                considerRemote(r.json, defer = true)
            }
            is CourseReply.Rejected -> when (r.code) {
                404 -> { serverHasCourse = false; TripHub.log("서버에 오늘 코스 없음 — 맞추기 쉼"); serverCourseGone() }
                405 -> { serverPatchOk = false; TripHub.log("서버가 코스 PATCH를 아직 몰라요") }
                else -> TripHub.log("서버 코스 거절 ${r.code}: $what")
            }
            CourseReply.Offline -> { syncDirty = true; TripHub.log("서버 연결 안 됨 — 코스는 차 안에서만 ($what)") }
        }
    }

    /**
     * 서버 답에서 제안 카드 상태를 본다: 차 카드와 같은 제안을 서버가 들고 있던 그 버전에서 제안이 사라졌으면
     * (가족 폰 '그대로 갈게요' → `POST /api/plan/course/dismiss`) 차 카드도 치우고 엔진도 버린다([TripHub.dismissProposal]).
     * 차가 막 만들어 아직 서버에 없는 제안은 그대로 둔다 — [ProposalDismissWatch].
     */
    private fun checkServerProposal(o: JSONObject) {
        val sp = CourseJson.serverProposal(o)
        if (sp == ServerProposal.Unknown) return
        val v = if (o.has("version") && !o.isNull("version")) o.optInt("version", -1) else o.optJSONObject("course")?.optInt("version", -1) ?: -1
        if (proposalWatch.onServer(ProposalDismissWatch.shapes(TripHub.ui.value.proposal), v, sp)) {
            TripHub.log("가족 폰이 제안을 거절함 (서버 v$v) — 차 카드도 치움")
            TripHub.dismissProposal()
        }
    }

    /**
     * 서버(폰)가 바꾼 코스 {course, version}: 버전이 차보다 높고 아직 안 본 것이고 남은 순서가 다를 때만 Remote로 엔진에.
     * 주행 중이면 다음 정차 때 적용([defer]). 같은 순서면 우리 변경의 메아리라 버전만 기억한다.
     */
    private fun considerRemote(o: JSONObject, defer: Boolean) {
        val local = TripHub.ui.value.course ?: return
        val courseJ = o.optJSONObject("course") ?: o
        val version = if (o.has("version") && !o.isNull("version")) o.optInt("version") else courseJ.optInt("version", -1)
        if (version < 0 || version <= seenServerVersion) return
        seenServerVersion = version
        // 서버 버전은 차 버전과 나란히 가지 않는다 (차는 칩 없는 시간표 변화·내비 대기에도 +1, 서버는 받은 사건만 +1).
        // 그래서 '새 원격 코스'는 서버 버전끼리(seenServerVersion)만 비교하고, 엔진에는 차 버전보다 하나 높여 넘긴다 (엔진은 낮은 버전을 무시)
        val remote = CourseJson.parseCourse(courseJ, ::placeById, local) ?: return
        // 남은 순서도, 오늘 도착지·낮잠·정한 도착 목표도 같으면 메아리
        val sameSettings = remote.end == local.end && remote.napOff == local.napOff &&
            remote.userLimit == local.userLimit && (!remote.userLimit || remote.limitMin == local.limitMin)
        if (remote.remaining.map { it.id } == local.remaining.map { it.id } && sameSettings) return
        val v = maxOf(version, local.version + 1)
        // 서버 글자 '폰:아빠' → '아빠' (칩 '아빠가 코스를 바꿨어요')
        val by = o.optString("by").ifEmpty { remote.chosenBy }.removePrefix("폰:")
        val now = TripHub.ui.value.snapshot?.nowMin ?: local.nowMin
        TripHub.log("폰 코스 v$version ($by): ${remote.remaining.joinToString(" → ") { it.place.name }}")
        inbox.trySend(SignalEvent.CourseCommand(CourseEvent.Remote(now, v, remote.copy(version = v, chosenBy = by)), SystemClock.elapsedRealtime(), deferWhileDriving = defer))
    }

    /**
     * 정차 중 15초마다 서버 코스를 받는다 — 차엔 FCM이 없어 폰이 바꾼 코스는 이 길로만 온다.
     * 못 보낸 차 변경이 있으면(오프라인이었음) 먼저 차 코스의 남은 순서를 Remote(by=차)로 보내 맞춘다 (차가 실제 신호를 가졌으니 차 우선).
     */
    private fun courseLoop() = lifecycleScope.launch {
        while (isActive) {
            delay(COURSE_POLL_MS)
            val ui = TripHub.ui.value
            val snap = ui.snapshot ?: continue
            val lc = ui.course ?: continue
            if (snap.state == TripState.HOME || !DriveGate.parked(snap)) continue
            when (val r = server.course()) {
                is CourseReply.Ok -> {
                    serverHasCourse = true; serverCourseSeen = true
                    checkServerProposal(r.json)
                    if (syncDirty && serverPatchOk) {
                        TripHub.log("다시 연결됨 — 차 코스 v${lc.version}로 맞추기")
                        reply(server.courseEvent(lc.version, CourseJson.remoteSync(lc, snap.nowMin)), "다시 맞추기")
                    } else considerRemote(r.json, defer = false)
                }
                is CourseReply.Rejected -> if (r.code == 404) { serverHasCourse = false; serverCourseGone() }
                else -> Unit
            }
        }
    }

    /**
     * 서버에서 받았던 코스가 없어짐(404) = 가족 폰이 '이 코스 취소하기'(고르기 취소). 엔진이 아직 다녀온 곳이 없을 때만 차 코스를 지운다
     * (다녀온 곳이 있으면 폰은 GoHome을 보내 코스가 Remote로 온다). 한 번만.
     */
    private fun serverCourseGone() {
        if (!serverCourseSeen) return
        serverCourseSeen = false
        TripHub.log("가족 폰이 오늘 코스를 취소함 — 차 코스도 지움")
        inbox.trySend(SignalEvent.CourseCancelled(SystemClock.elapsedRealtime()))
    }

    /** 정차 중(P단 · 제한 없음, [DriveGate])일 때만 옆 창을 띄운다. 주행 중·신호 대기엔 화면 대신 소리. */
    private fun bringToFront() {
        if (!DriveGate.parked(engine.snapshot())) return
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        intent?.getStringExtra(EXTRA_CLOCK)?.let { t ->
            val (h, m) = t.split(":").map(String::toInt)
            debugClockMin = h * 60 + m
            intent.getStringExtra(EXTRA_CLOCK_DAY)?.let { d -> debugDay = d.takeIf { it.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) } }
            inbox.trySend(SignalEvent.Clock(h * 60 + m, SystemClock.elapsedRealtime(), debugDay ?: LocalDate.now().toString()))
        }
        if (intent?.getBooleanExtra(EXTRA_PERMS_GRANTED, false) == true) {
            // 실행 중 권한(속도·위치)을 막 받았다 → 서비스 종류에 '위치'를 더하고, 그 권한을 쓰는 신호원만 다시 연결
            startAsForeground()
            sources.filter { it is CarSignals || it is LocationFallback }.forEach { src ->
                runCatching { src.stop() }
                src.start { e -> inbox.trySend(e) }
            }
        }
        if (intent?.getBooleanExtra(EXTRA_PLAN_SYNC, false) == true) {
            // 디버그: 서버 계획을 지금 바로 다시 받기 (첫 탑승 계획 화면일 때만)
            if (TripHub.ui.value.snapshot?.state == TripState.PLANNING) { lastServerKey = null; startPlanSync() }
        }
        if (intent?.getBooleanExtra(EXTRA_RESET, false) == true) {
            // 엔진은 소비 스레드에서만 만진다
            resetRequested = true
            inbox.trySend(SignalEvent.Tick(SystemClock.elapsedRealtime()))
        }
        return START_STICKY
    }

    /**
     * '출발 · 길 안내' (코스 화면 큰 버튼): 남은 코스로 내비를 다시 띄운다 — 마지막 곳 = 목적지, 앞 곳 = 경유지.
     * 남은 곳이 없으면 오늘 도착지(집·할머니 집). 엔진 코스는 바꾸지 않는다 (실제 출발은 기어 신호로 엔진이 안다).
     */
    private fun navigateRemaining() {
        val lc = TripHub.ui.value.course ?: return
        val stops = lc.remainingPlaces
        if (stops.isNotEmpty()) navi.requestCourse(stops) else navi.requestRouteHome(lc.end?.at ?: engine.profile.home)
        TripHub.log("길 안내 다시 → ${stops.lastOrNull()?.name ?: lc.endName}")
    }

    /**
     * 차 화면 '그대로 갈게요'를 서버에도 (`POST /api/plan/course/dismiss {version}`) → 가족 폰 제안 카드도 치워진다.
     * 서버가 같은 모양의 제안을 들고 있는 걸 본 버전([ProposalDismissWatch.serverVersionOf])이 있을 때만 — 모르는 서버 제안을 지우지 않게.
     */
    private fun keepOnServer(p: ProposalShown) {
        val v = proposalWatch.serverVersionOf(ProposalDismissWatch.shapes(p))
        if (v == null) { TripHub.log("그대로 갈게요 — 서버엔 같은 제안이 없어 차에서만 치움"); return }
        enqueueSync {
            when (val r = server.dismissProposal(v)) {
                is CourseReply.Ok -> TripHub.log("그대로 갈게요 → 서버 v$v 제안 치움 (${if (r.json.optBoolean("dismissed")) "지움" else "이미 없음"})")
                is CourseReply.Conflict -> { TripHub.log("그대로 갈게요 — 서버 코스가 그새 바뀜"); considerRemote(r.json, defer = true) }
                is CourseReply.Rejected -> TripHub.log("그대로 갈게요 — 서버 거절 ${r.code}")
                CourseReply.Offline -> TripHub.log("그대로 갈게요 — 서버 연결 안 됨 (차에서만 치움)")
            }
        }
    }

    override fun onDestroy() {
        TripHub.sink = null
        TripHub.navigator = null
        TripHub.keepHook = null
        TripHub.storyHook = null
        TripHub.speaker = null
        sources.forEach { runCatching { it.stop() } }
        intro.release()
        inbox.close()
        super.onDestroy()
    }

    private fun startAsForeground() {
        val n: Notification = NotificationCompat.Builder(this, MileStampApp.CHANNEL_TRIP)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("여행을 기록하고 있어요")
            .setOngoing(true)
            .setSilent(true)
            .build()
        if (Build.VERSION.SDK_INT < 29) { startForeground(NOTI_ID, n); return }
        val media = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        // 위치 권한이 있으면 '위치' 종류도 함께: 길 안내 앱이 앞에 있을 때도 위치가 끊기지 않는다.
        // (부팅 직후처럼 화면 없이 시작하면 거절될 수 있어 그때는 미디어만)
        val withLocation = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        runCatching {
            ServiceCompat.startForeground(this, NOTI_ID, n, if (withLocation) media or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else media)
        }.onFailure {
            Log.w(TAG, "위치 종류로 시작 못 함 → 미디어만", it)
            ServiceCompat.startForeground(this, NOTI_ID, n, media)
        }
    }

    companion object {
        private const val NOTI_ID = 42
        /** '다녀옴' 화면을 띄워 두는 시간 (그 뒤 저절로 코스 화면으로). */
        private const val VISIT_SHOW_MS = 12_000L
        private const val TAG = "MileStamp"
        const val EXTRA_CLOCK = "clock"
        const val EXTRA_CLOCK_DAY = "clock_day"
        const val EXTRA_RESET = "reset_day"
        const val EXTRA_PERMS_GRANTED = "perms_granted"
        const val EXTRA_PLAN_SYNC = "plan_sync"
        /** 첫 서버 계획 요청 제한. 넘으면 차 자기 계산이 먼저 떠 있고, 서버 것은 다음 조회 때. */
        private const val FIRST_PLAN_TIMEOUT_MS = 2_000
        /** 계획 화면 동안 서버 계획 다시 받기 간격 (폰에서 고르면 반영). */
        private const val PLAN_POLL_MS = 15_000L
        /** 살아 있는 코스 동안 정차 중 서버 코스 다시 받기 간격 (폰이 바꾼 코스). */
        private const val COURSE_POLL_MS = 15_000L

        fun start(context: Context, extras: Intent.() -> Unit = {}) {
            context.startForegroundService(Intent(context, TripService::class.java).apply(extras))
        }
    }
}
