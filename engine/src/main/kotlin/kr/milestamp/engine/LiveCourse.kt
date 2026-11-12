package kr.milestamp.engine

/*
 * 살아 있는 코스 — 고른 카드(PlanOption)를 버리지 않고 하루 동안 들고 다니는 '버전이 있는 시간표'.
 * 계획: docs/코스-고도화-계획.md 2절. 판정은 [LiveCourseEngine]이 한다.
 * 서버(TS)가 같은 모양으로 옮기므로 칸 이름·뜻을 단순하게 둔다.
 */

/** 이름을 모르는 바깥 장소('ext:…')를 보일 때 쓰는 말 — 날 id를 사람에게 보이지 않는다. */
const val UNNAMED_EXT = "고른 곳"

/**
 * 곳 이름 하나로 정하기: 코스·계획에 실려 온 이름(payloadName) → 없으면 바깥 장소('ext:…')는 [UNNAMED_EXT], 그 밖은 id.
 * 장소 목록(명소)에서 먼저 찾는 것은 부르는 쪽이 한다 — 목록에 없을 때 이 함수로.
 */
fun stopName(id: String, payloadName: String? = null): String =
    payloadName?.trim()?.takeIf { it.isNotEmpty() } ?: if (id.startsWith("ext:")) UNNAMED_EXT else id

/** 장소 하나의 진행 상태. */
enum class StopStatus {
    /** 아직 갈 곳 */
    PLANNED,
    /** 다음 목적지 */
    NEXT,
    /** 지금 머무는 중 */
    ARRIVED,
    /** 다녀옴 */
    DONE,
    /** 뺌·건너뜀 */
    SKIPPED,
}

/** 코스 안의 장소 하나. 예정 시각은 시간표를 다시 짤 때마다 갱신, 실제 시각은 신호로 채운다. */
data class LiveStop(
    val place: Place,
    val status: StopStatus,
    val plannedArriveMin: Int,
    val plannedDepartMin: Int,
    val actualArriveMin: Int? = null,
    val actualDepartMin: Int? = null,
    /** 지금 쓰는 머무름 예상(분). 우리 가족 머무름([FamilyProfile.dwellFor])에 오늘 패턴(×0.9)·사용자 '덜 놀기'·직접 정한 값을 반영. */
    val dwellGuessMin: Int,
    /** 건너뛴 까닭 (SKIPPED일 때만): "문 닫음" = 문 닫을 시간이라 못 감(Tick·PlaceClosed). 사람이 뺀 곳은 null. */
    val skipReason: String? = null,
    /** 사람이 오늘만 직접 정한 머무름(SetDwell·ExtendStay) — 오늘 패턴 ×0.9가 덮어쓰지 않는다. */
    val dwellSet: Boolean = false,
) {
    val id: String get() = place.id
    val remaining: Boolean get() = status == StopStatus.PLANNED || status == StopStatus.NEXT
}

/**
 * 오늘 코스의 끝(도착지). 코스 [LiveCourse.end]가 null이면 집([FamilyProfile.home]).
 * 할머니 집·저녁 약속 장소처럼 오늘만 다른 곳으로 끝낼 때 쓴다. 좌표는 서버에 소수 셋째 자리(약 100m)로만 저장.
 */
data class CourseEnd(val name: String, val at: LatLng)

/** 변경의 크기. QUIET = 시간표만(칩 없음) · SOFT = 칩 한 줄 · LOUD = 칩 + 음성 한 문장. */
enum class ChangeSize { QUIET, SOFT, LOUD }

/**
 * 마지막 변경. [text]는 칩 글(40자 이내), [cause]는 원인 이름(같은 원인은 30분에 한 번만 LOUD),
 * [deltaHomeMin]은 귀가 예정이 얼마나 움직였는지(+ 늦어짐).
 */
data class Change(
    val text: String,
    val cause: String,
    val deltaHomeMin: Int,
    val size: ChangeSize,
    val atMin: Int,
)

/** 들어오는 사건. 시각은 모두 '그날 0시부터 분'. 장소는 id. */
sealed interface CourseEvent {
    val nowMin: Int

    /** 출발 또는 출발 준비(재탑승). [from]은 떠나는 장소 id, 집·길 위면 null. */
    data class Departed(override val nowMin: Int, val from: String? = null) : CourseEvent
    /** 장소 도착(P + 반경 안). */
    data class Arrived(override val nowMin: Int, val placeId: String) : CourseEvent
    /** 아직 서 있음 — 예정 출발이 지났거나(5분마다) 장소 아닌 곳에 10분 넘게 정차. */
    data class StillParked(override val nowMin: Int) : CourseEvent
    /** 내비 남은 시간(분). 두 번 연속 같은 방향으로 어림과 ≥8분 또는 15% 다를 때만 반영. */
    data class NaviEta(override val nowMin: Int, val remainMin: Int) : CourseEvent
    /**
     * 아직 달리는 중인데 다음 곳 예정 도착(−2분)이 지났고 최근 10분 동안 내비 ETA가 없음 (차가 주행 중 5분마다).
     * [here]에서 남은 구간을 보정된 계수로 다시 어림(최소 3분)해 시간표를 민다. 내비 ETA가 있으면 그쪽을 쓴다.
     */
    data class StillDriving(override val nowMin: Int, val here: LatLng) : CourseEvent
    /** 다음 목적지를 이곳으로 (원래 다음 곳은 그 뒤로 밀림). */
    data class ReplaceNext(override val nowMin: Int, val placeId: String) : CourseEvent
    /** 이 장소 빼기·건너뛰기 (지금 머무는 곳이면 지금 나서기). */
    data class Skip(override val nowMin: Int, val placeId: String) : CourseEvent
    /** 들르기 — 남은 자리마다 넣어 보고 되는 쪽. */
    data class Insert(override val nowMin: Int, val placeId: String) : CourseEvent
    /**
     * 날씨 갱신. 지금 비면 [sky] = RAIN, 아니면 [rainFromMin]에 비 시작 시각(없으면 null).
     * [air]는 미세먼지 등급 (null = 이번엔 모름, 코스가 아는 값을 그대로). 나쁨 이상인데 남은 곳에 야외가 있으면 경고 칩 '미세먼지 나쁨 · 마스크 챙기세요'.
     */
    data class Weather(override val nowMin: Int, val sky: Sky, val rainFromMin: Int? = null, val air: AirLevel? = null) : CourseEvent
    /** 문 닫음·휴무 → 그 장소는 못 가니 교체안. */
    data class PlaceClosed(override val nowMin: Int, val placeId: String) : CourseEvent
    /** 지금 집으로. */
    data class GoHome(override val nowMin: Int) : CourseEvent
    /** 귀가 한계가 바뀜 (해 짐 갱신·저녁·가족 설정). */
    data class LimitChanged(override val nowMin: Int, val limitMin: Int) : CourseEvent
    /** 폰·서버가 바꾼 코스. 버전이 낮으면 무시, 높으면 받아들임, 같으면 실제 신호를 가진 차 것이 이김. */
    data class Remote(override val nowMin: Int, val version: Int, val course: LiveCourse) : CourseEvent
    /**
     * 시간이 흘렀다 (서버가 코스를 꺼낼 때·화면 설명). 시간표가 [LiveCourseEngine.behindMin] 5분 넘게 뒤처졌거나 문 닫기 전에
     * 못 가는 곳이 있으면 지금 시각으로 다시 짠다. 문 닫을 시간이라 못 가는 곳은 건너뛴다(SKIPPED). 그 밖이면 NoChange.
     */
    data class Tick(override val nowMin: Int) : CourseEvent
    /**
     * 이 장소에서 머무는 시간을 오늘만 [minutes]분으로 (15~360분, 5분 단위로 맞춤). 머무는 중인 곳이면 도착부터 센 전체 시간.
     * 다른 사건처럼 다시 짜고 판정한다 — 짧아져 여유가 생기면 '한 곳 더', 길어져 넘치면 '덜 놀기'·빼기. 원인 이름 "머무름".
     */
    data class SetDwell(override val nowMin: Int, val placeId: String, val minutes: Int) : CourseEvent
    /**
     * 지금 머무는 곳에서 앞으로 [minutes]분 더 (0 = 지금 나갈게요, 360분까지, 5분 단위). 예정 출발 = 지금 + [minutes].
     * 머무는 곳이 없으면 NoChange. 원인 이름 "머무름".
     */
    data class ExtendStay(override val nowMin: Int, val minutes: Int) : CourseEvent
    /**
     * 오늘만 바꾸는 코스 끝 (폰 '도착 시간·도착지' 시트). 넣은 칸만 바뀐다.
     *  - [end]: 새 도착지 (할머니 집 등). [toHome]이면 집으로 되돌림. 둘 다 없으면 그대로.
     *  - [limitMin]: 오늘만 도착 목표 시각 (해 지기 30분 전·직접·저녁 약속을 폰이 시각으로 바꿔 보냄). 넣으면 그 뒤 해 시각·가족 설정의
     *    [LimitChanged]는 무시한다(오늘 사용자가 정한 값이 이김).
     *  - [napOff]: true = 오늘은 낮잠 안 자요(낮잠 이동을 짜지 않음), false = 다시 맞춤.
     * 그 뒤는 다른 사건처럼 다시 짜고 판정한다 (넘치면 '덜 놀기'·빼기 제안). 원인 이름 "도착지".
     */
    data class SetEnd(
        override val nowMin: Int,
        val end: CourseEnd? = null,
        val toHome: Boolean = false,
        val limitMin: Int? = null,
        val napOff: Boolean? = null,
    ) : CourseEvent
}

/** 설명의 '할 일' 버튼. GO_HOME = 지금 집으로(남은 곳 건너뛰고 집으로 안내) · END = 아직 집이라 오늘 코스 마치기. */
enum class ExplainAction { GO_HOME, END }

/**
 * 코스 화면 맨 위 쉬운 설명 ([LiveCourseEngine.explain]). [headline]은 한 줄 제목, [body]는 해요체 한두 문장.
 * [action]이 있으면 큰 버튼 하나, [homeMin]은 지금 집으로 가면 도착 시각, [warn]이면 제목을 빨강으로.
 */
data class Explanation(
    val headline: String,
    val body: String,
    val action: ExplainAction? = null,
    val homeMin: Int? = null,
    val warn: Boolean = false,
) {
    /** 읽어 줄 글 (제목 + 본문). */
    val speech: String get() = "$headline. $body"
}

/** 사건을 넣을 때의 차 상황. [driving]이면 카드 없이 칩·음성만, [here]는 지금 위치(모르면 코스가 아는 마지막 위치). */
data class CourseCtx(val driving: Boolean = false, val here: LatLng? = null)

/** 엔진이 내는 답. [drivingSafe]는 주행 중에도 보여 줄 칩 한 줄(40자 이내), [voice]는 읽어 줄 한 문장. */
sealed interface Outcome {
    val course: LiveCourse
    val change: Change?
    val voice: String?

    val drivingSafe: String? get() = change?.text

    /** 변화가 임계(5분) 미만. 코스의 숨은 값(상태·보정 계수)만 갱신됐을 수 있다. */
    data class NoChange(override val course: LiveCourse) : Outcome {
        override val change: Change? get() = null
        override val voice: String? get() = null
    }

    /** 시각만 바뀜. 칩은 [Change.size]가 QUIET이 아닐 때만. */
    data class Retimed(override val course: LiveCourse, override val change: Change, override val voice: String) : Outcome

    /** 제안 1~3장. 정차 중에만 카드, 주행 중엔 칩·음성만 두고 다음 P단까지 보류. */
    data class Proposal(
        override val course: LiveCourse,
        val options: List<PlanOption>,
        override val change: Change,
        override val voice: String,
    ) : Outcome

    /** 귀가만 가능. 남은 곳이 이미 SKIPPED면 결정된 것(집으로 안내), 아니면 '바로 집으로' 확인을 받는다. */
    data class HomeNow(override val course: LiveCourse, override val change: Change, override val voice: String) : Outcome
}

/**
 * 살아 있는 코스. 바뀔 때마다 [version] +1 (폰·차·서버 충돌 판정).
 * 시간표([legs])는 마지막으로 다시 짠 시각([nowMin])·위치([here])에서 집 도착까지.
 */
data class LiveCourse(
    val id: String,
    val version: Int,
    val chosenBy: String,
    val chosenAtMin: Int,
    /** 순서 유지. DONE·SKIPPED도 남겨 둔다(기록·폰 화면). */
    val stops: List<LiveStop>,
    /** 지금부터의 시간표 (하루 막대). */
    val legs: List<Leg>,
    /** 시간표를 짠 시각·위치. */
    val nowMin: Int,
    val here: LatLng?,
    val arriveHomeMin: Int,
    /** 귀가 한계 (해 지기 N분 전 또는 고정 시각). */
    val limitMin: Int,
    /** 차에서 낮잠 구간(있으면). */
    val napLeg: Leg? = null,
    val lastChange: Change? = null,
    /** 탐색용 규칙을 어긴 곳 — 버리지 않고 경고 칩으로만 (깨어 있는 이동 60분 초과 · 문 열기 30분 넘게 기다림 · 비 맞는 야외 · 문 닫기 전 짧은 머무름 · 미세먼지 나쁨인데 야외). */
    val warnings: List<String> = emptyList(),
    /** 비 시작 시각(이미 오면 지금 이전 시각). 모르면 null. */
    val rainFromMin: Int? = null,
    /** 미세먼지 등급 (고를 때의 하늘 → 날씨 갱신). 나쁨 이상이고 야외가 남아 있으면 경고 칩. 모르면 null. */
    val air: AirLevel? = null,
    /** 이동 시간 어림 계수. 내비 ETA와 어림의 비율을 EMA(α 0.3)로 보정. */
    val roadFactor: Double = TravelTime.ROAD_FACTOR,
    /** 오늘 머무름 패턴. 예정의 80% 미만으로 머물면 남은 곳 ×0.9. */
    val dwellScale: Double = 1.0,
    /** 낮잠 이동을 이미 했는지 (하루 한 번). */
    val napTaken: Boolean = false,
    /** 아직 한 번만 온 내비 ETA (두 번 연속이어야 반영). */
    val etaPending: Int? = null,
    /** 오늘 코스의 끝. null = 집. 시간표의 마지막 구간(HOME)이 여기서 끝난다. */
    val end: CourseEnd? = null,
    /** 오늘만 낮잠 안 자요 — 낮잠 이동을 짜지 않는다. */
    val napOff: Boolean = false,
    /** 사용자가 오늘 도착 목표([limitMin])를 직접 정함 — 해 시각·가족 설정의 한계 변경을 무시한다. */
    val userLimit: Boolean = false,
) {
    /** 도착지 이름 (집 또는 할머니 집 등). */
    val endName: String get() = end?.name ?: "집"

    /** 여유 = 한계 − 귀가 예정. */
    val slackMin: Int get() = limitMin - arriveHomeMin

    /** 아직 갈 곳 (순서대로). */
    val remaining: List<LiveStop> get() = stops.filter { it.remaining }

    /** 다음 목적지. */
    val next: LiveStop? get() = remaining.firstOrNull()

    /** 지금 머무는 곳. */
    val current: LiveStop? get() = stops.firstOrNull { it.status == StopStatus.ARRIVED }

    /** 남은 장소들 (길 안내용). */
    val remainingPlaces: List<Place> get() = remaining.map { it.place }

    /** 남은 코스를 카드 모양으로 (길 안내 재요청·화면). 남은 곳이 없으면 '바로 집으로'. */
    fun asOption(label: String = "고른 코스"): PlanOption {
        val stops = remainingPlaces
        return PlanOption(
            kind = if (stops.isEmpty()) OptionKind.GO_HOME else OptionKind.COURSE,
            stops = stops,
            firstLegMin = legs.firstOrNull { !it.isStay }?.minutes ?: 0,
            detourMin = null,
            arriveHomeMin = arriveHomeMin,
            legs = legs,
            reasons = listOf(Reason(if (end == null) "${arriveHomeMin.asHhmm()} 귀가" else "$endName ${arriveHomeMin.asHhmm()} 도착")),
            label = if (stops.isEmpty()) "바로 ${LiveCourseEngine.josa(endName, "으로/로")}" else label,
        )
    }

    companion object {
        /**
         * 고른 카드에서 코스를 만든다. 예정 시각은 카드의 하루 막대에서, 한계는 계획의 귀가 한계에서.
         * [here]는 고른 순간의 위치(모르면 null — 첫 도착 전까지는 집·출발지 어림을 쓴다).
         * [profile]을 주면 머무름 예상이 우리 가족 값([FamilyProfile.dwellFor]), 없으면 조사값.
         */
        fun from(option: PlanOption, plan: Plan, chosenBy: String, nowMin: Int, here: LatLng? = null, profile: FamilyProfile? = null): LiveCourse {
            val stops = option.stops.mapIndexed { i, p ->
                val stay = option.legs.firstOrNull { it.isStay && it.placeId == p.id }
                LiveStop(
                    place = p,
                    status = if (i == 0) StopStatus.NEXT else StopStatus.PLANNED,
                    plannedArriveMin = stay?.fromMin ?: nowMin,
                    plannedDepartMin = stay?.toMin ?: nowMin,
                    dwellGuessMin = profile?.dwellFor(p) ?: p.dwellP80Min,
                )
            }
            return LiveCourse(
                id = "lc-$nowMin",
                version = 1,
                chosenBy = chosenBy,
                chosenAtMin = nowMin,
                stops = stops,
                legs = option.legs,
                nowMin = nowMin,
                here = here,
                arriveHomeMin = option.arriveHomeMin,
                limitMin = plan.backByMin,
                napLeg = option.legs.firstOrNull { it.kind == LegKind.NAP_DRIVE },
                rainFromMin = Planner.rainStartMin(plan.sky, nowMin),
                air = plan.sky?.air,
            )
        }
    }
}
