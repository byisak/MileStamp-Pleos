package kr.milestamp.car.trip

import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kr.milestamp.car.signals.SourceStatus
import kr.milestamp.engine.Change
import kr.milestamp.engine.Effect
import kr.milestamp.engine.Explanation
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.Place
import kr.milestamp.engine.Plan
import kr.milestamp.engine.PlanOption
import kr.milestamp.engine.SeedPlaces
import kr.milestamp.engine.SignalEvent
import kr.milestamp.engine.SkyToday
import kr.milestamp.engine.TripEngine
import kr.milestamp.engine.asHhmm

/** 화면이 그리는 값. 서비스가 쓰고, 화면은 읽기만 한다. */
data class UiState(
    val snapshot: TripEngine.Snapshot? = null,
    val plan: Plan? = null,
    /** 계획 아래 작은 글 (예: 늦게 온 서버 계획으로 바꿨을 때 '방금 새로 받았어요'). */
    val planNote: String? = null,
    /** 계획을 받을 때 시범 지역(대구·경북) 밖이었으면 가장 가까운 명소까지 km — 추천 화면 위 안내. 안이면 null. */
    val outOfAreaKm: Int? = null,
    /** 우리 가족 저녁 시각(분) — 오후 계획 칩·하루 막대 표시용. */
    val dinnerMin: Int? = null,
    val stamp: StampShown? = null,
    val held: String? = null,
    val summary: DaySummaryShown? = null,
    val pair: PairShown? = null,
    val introPlaying: String? = null,
    val sources: Map<String, SourceStatus> = emptyMap(),
    val log: List<String> = emptyList(),
    /** 살아 있는 코스 (카드를 고르면 생기고 집에 올 때까지). 정차 중 '오늘 코스' 화면. */
    val course: LiveCourse? = null,
    /** 정차 중 제안 카드 (주행 중엔 없음). */
    val proposal: ProposalShown? = null,
    /** 주행 중 칩 한 줄: 다음 목적지 또는 코스 변경 글(≤40자). */
    val chip: String? = null,
    /** 오늘 하늘 (마지막 계획의 것) — 코스 화면 하루 막대의 해 짐 표시. */
    val sky: SkyToday? = null,
    /** 도장북 화면 (머리줄 '도장북' · 도장 화면 '도장북 보기' · 글레오 OPEN_STAMP_BOOK). 정차 중에만 보인다. */
    val book: Boolean = false,
    /** '오늘 코스' 맨 위 쉬운 설명 (엔진 explain — 제목 + 한두 문장). 코스가 없으면 null. */
    val explain: Explanation? = null,
    /** 개발자 상태판 (기어·위치·연결·기록). 디버그 빌드에서 로고 길게 누르기 · 디버그 입력 DEV_BOARD로만 켠다. */
    val devBoard: Boolean = false,
    /** 오늘 집 도착 요약 (요약 화면을 닫아도 '오늘 나들이 끝' 화면이 km까지 보이게 남겨 둠). 하루 초기화 때 지움. */
    val lastSummary: DaySummaryShown? = null,
    /** 낮/밤 화면 (디버그 입력 THEME으로 고정 — 시연·캡처용. 보통은 AUTO = 차 밤 모드 · 해 시각). */
    val dayNight: kr.milestamp.car.ui.DayNight = kr.milestamp.car.ui.DayNight.AUTO,
    /** 도장 화면에서 '이야기는 폰으로 이어 듣기'를 눌러 보낸 장소 id (버튼을 '보냈어요'로). */
    val storySent: String? = null,
    /** 도장 없는 바깥 장소(ext:…)에 도착 → 차분한 '다녀옴' 화면 (메달·소리 없음). 잠시 뒤 저절로 닫힌다. */
    val visit: VisitShown? = null,
    /** 누구랑 가요? — 이 차 엔진의 동행 (가족 설정 · 서버 계획의 companion). 차 화면 글·뒷좌석 확인·낮잠 표시가 따른다. */
    val companion: kr.milestamp.engine.GoWith = kr.milestamp.engine.GoWith.KIDS,
    /** 서버 계획이 '밤이라 오늘은 더 갈 곳이 없음'(tomorrowHint) — 고른 코스가 없으면 계획 카드 대신 대기 화면 '내일 코스' 안내. */
    val tomorrowHint: Boolean = false,
)

/** '다녀옴' 화면: [place]에 다녀옴 · [recorded]면 서버 '다녀온 곳'에 적는 곳(바깥 장소). */
data class VisitShown(val place: Place, val recorded: Boolean, val atMs: Long)

/** 제안 카드 1~3장 + 머리글(변경 칩). [version]은 제안이 나온 코스 버전 (서버 채택 때 보냄). */
data class ProposalShown(val options: List<PlanOption>, val change: Change, val version: Int)

/** 차 화면 '폰 연결': QR 주소·코드와 지금 연결된 가족 폰. url이 null이면 준비 중/실패. */
data class PairShown(val url: String? = null, val code: String? = null, val phones: List<String> = emptyList(), val error: String? = null)

/** 집 도착 요약. rearWarning: 문이 열렸는데 2열에 아직 아이가 앉아 있음 (아이와일 때만 켠다). */
data class DaySummaryShown(val stamps: Int, val rare: Int, val km: Double?, val rearWarning: Boolean = false)

/** 떠 있는 도장. [number]는 차 엔진이 정한 No., [serverNumber]는 서버가 다르게 정했을 때 (보이는 건 [shownNumber]). */
data class StampShown(val place: Place, val number: Int, val rare: String?, val silent: Boolean, val serverNumber: Int? = null) {
    val shownNumber: Int get() = serverNumber ?: number
}

/**
 * 서비스 ↔ 화면 ↔ 글레오 사이의 연결점 (앱 프로세스 안에서만).
 * 서비스가 없을 때 들어온 입력은 [TripService]를 깨워 전달한다.
 */
object TripHub {
    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private val pending = mutableListOf<SignalEvent>()

    /** 서비스가 등록. 화면·글레오·디버그 입력이 엔진으로 신호를 넣을 때 쓴다. */
    @Volatile var sink: ((SignalEvent) -> Unit)? = null
        set(value) {
            field = value
            if (value != null) synchronized(pending) { pending.forEach(value); pending.clear() }
        }

    /** 서비스가 아직 안 떴으면 모아 두었다가 뜨는 즉시 넘긴다. */
    fun send(e: SignalEvent) {
        val s = sink
        if (s != null) s(e) else synchronized(pending) { pending += e }
    }

    internal fun update(f: (UiState) -> UiState) = _ui.update(f)

    internal fun log(line: String) = Log.i("MileStamp", line).let { _ui.update { it.copy(log = (listOf(line) + it.log).take(LOG_MAX)) } }

    internal fun status(s: SourceStatus) {
        Log.i("MileStamp", "연결 ${if (s.ok) "●" else "○"} ${s.name} — ${s.detail}")
        _ui.update { it.copy(sources = it.sources + (s.name to s)) }
    }

    /** 서비스가 등록하는 짧은 음성 (IntroAudio.say). 화면 '설명 듣기'가 쓴다. */
    @Volatile var speaker: ((String) -> Unit)? = null

    /** 짧은 문장을 차 스피커로 (서비스가 없으면 조용히 건너뜀). */
    fun speak(text: String) { speaker?.invoke(text) }

    fun dismissStamp() = _ui.update { it.copy(stamp = null, held = null, summary = null, visit = null) }

    fun closePair() = _ui.update { it.copy(pair = null) }

    /** 도장북 열기: 떠 있던 도장 화면은 치운다. 보류·요약은 그대로 두고 도장북을 그 위에 띄운다 (닫으면 다시 보임). */
    fun openBook() = _ui.update { it.copy(book = true, stamp = null) }

    fun closeBook() = _ui.update { it.copy(book = false) }

    /** 개발자 상태판 켜기/끄기 ([on]이 null이면 뒤집기). */
    fun toggleDevBoard(on: Boolean? = null) = _ui.update { it.copy(devBoard = on ?: !it.devBoard) }

    /**
     * '그대로 갈게요' — 제안 카드를 치우고 엔진도 그 제안을 버린다 (코스는 그대로, 다음 정차 때도 다시 안 띄움).
     * [fromUser]면(차 화면에서 누름) 서버에도 알려 가족 폰 카드도 치운다([keepHook] = 서비스의 `POST /api/plan/course/dismiss`).
     * 가족 폰이 서버에서 거절한 것을 따라 치울 때는 false.
     */
    fun dismissProposal(fromUser: Boolean = false) {
        _ui.value.proposal?.let { p -> dismissed = proposalKey(p); if (fromUser) keepHook?.invoke(p) }
        _ui.update { it.copy(proposal = null) }
        send(SignalEvent.ProposalDismissed(SystemClock.elapsedRealtime()))
    }

    /** 서비스가 등록: 차 화면 '그대로 갈게요'를 서버에 알림. */
    @Volatile var keepHook: ((ProposalShown) -> Unit)? = null

    /** 서비스가 등록: '출발 · 길 안내' — 남은 코스(없으면 도착지)로 내비를 다시 띄움. */
    @Volatile var navigator: (() -> Unit)? = null

    /** 남은 코스로 길 안내 다시 (서비스가 없으면 조용히 건너뜀). */
    fun navigate() { navigator?.invoke() }

    /** 서비스가 등록: 도장 화면 '이야기는 폰으로 이어 듣기' — 그 장소 소개를 가족 폰으로 (서버 intro 소식). */
    @Volatile var storyHook: ((String) -> Unit)? = null

    fun storyToPhone(placeId: String) {
        storyHook?.invoke(placeId)
        _ui.update { it.copy(storySent = placeId) }
    }

    /** 낮/밤 고정 (디버그 입력 THEME). */
    fun setDayNight(m: kr.milestamp.car.ui.DayNight) = _ui.update { it.copy(dayNight = m) }

    /** 사용자가 치운 제안의 표식 (칩 글 + 카드 제목). 서비스가 같은 제안을 다시 받으면 띄우지 않는다. */
    @Volatile internal var dismissed: String? = null
    internal fun proposalKey(p: ProposalShown) = p.change.text + "|" + p.options.joinToString("|") { it.label }

    /** 엔진 추천 후보 (서버 목록을 받으면 바뀜). 글레오 장소 이름 찾기·디버그 사건의 장소 id 확인용. */
    @Volatile var catalog: List<Place> = SeedPlaces.ALL
        internal set

    fun placeById(id: String): Place? = catalog.firstOrNull { it.id == id } ?: SeedPlaces.byId(id)

    /** 말로 들은 장소 이름 → 후보. id 그대로 · 이름 그대로 · 띄어쓰기 무시하고 서로 포함하는 것 순. */
    fun findPlace(query: String): Place? {
        val q = query.trim()
        if (q.isEmpty()) return null
        val all = (catalog + SeedPlaces.ALL).distinctBy { it.id }
        all.firstOrNull { it.id == q || it.name == q }?.let { return it }
        val n = q.replace(" ", "")
        return all.firstOrNull { it.name.replace(" ", "").let { m -> m.contains(n) || n.contains(m) } }
    }

    internal fun describe(e: Effect): String = when (e) {
        is Effect.StateChanged -> "상태 ${e.from} → ${e.to}"
        is Effect.ShowPlan -> "추천 ${e.plan.mode} ${e.plan.options.size}안"
        Effect.CollapsePlan -> "추천 접기"
        is Effect.RequestRoute -> "길 안내 → ${e.option.stops.lastOrNull()?.name ?: "집"}" +
            (if (e.option.stops.size > 1) " (경유 ${e.option.stops.dropLast(1).joinToString { it.name }})" else "")
        is Effect.PlanChosen -> "고름 ${e.index?.let { "${it + 1}번" } ?: "-"} ${e.option.label}"
        is Effect.ShowDrivingChip -> "칩: ${e.text}"
        is Effect.QuietMode -> "쉿 모드 ${if (e.on) "켜짐" else "꺼짐"}"
        is Effect.PlayIntro -> "소개 ${e.place.name} (${e.variant})"
        is Effect.IntroToPhone -> "소개를 폰으로 ${e.place.name}"
        is Effect.StampGranted -> "도장 No.${e.number} ${e.place.name}${e.rare?.let { " · 희귀 $it" } ?: ""}"
        is Effect.StampHeld -> "도장 보류 ${e.place.name}: ${e.verdict.reason}"
        is Effect.HandoffToPhone -> "폰으로 이어 듣기 ${e.place.name}"
        is Effect.PushMission -> "미션 알림 ${e.place.name}"
        is Effect.Visited -> "다녀옴 ${e.place.name} (${e.place.id})"
        is Effect.DaySummary -> "오늘 도장 ${e.stamps}개 · 희귀 ${e.rare} · ${e.kmToday?.let { "%.0fkm".format(it) } ?: "-"}"
        Effect.WarnRearSeat -> "뒷좌석 확인 경고"
        is Effect.CourseUpdated -> "코스 v${e.course.version} 귀가 ${e.course.arriveHomeMin.asHhmm()}" +
            (e.change?.let { " · ${it.text} (${it.size})" } ?: "")
        is Effect.CourseProposal -> "코스 제안 ${e.options.joinToString { it.label }} · ${e.change.text}"
        is Effect.ProposalCleared -> "제안 치움 (${e.reason})"
    }

    private const val LOG_MAX = 60
}
