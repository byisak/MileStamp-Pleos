package kr.milestamp.car.ui

/*
 * 말 맞추기 (폰 phone/src/words.ts · 시간 phone/src/timefmt.ts와 같은 표, docs/디자인-개편-계획.md 3절).
 * 차 화면 글은 여기 말을 쓴다. 차에는 시간 표시 설정이 없어 늘 12시간('오후 4:49') — 폰 기본값과 같다.
 * 엔진이 만든 글 속 'HH:MM'(설명·칩·이유)은 [clockText]로 바꿔 보인다. 엔진·서버로 보내는 값은 그대로 'HH:MM'.
 */
object W {
    /** 들렀다 나옴 (DONE) — '끝' 아님 */
    const val done = "다녀옴"
    const val here = "머무는 중"
    const val next = "다음"
    const val todo = "예정"
    /** 일정에서 빠짐 — 문 닫을 시간 등으로 저절로 */
    const val skipped = "건너뜀"
    /** 내가 뺌 */
    const val removed = "뺌"
    /** 소개·설명을 소리로 */
    const val listen = "말로 듣기"
    /** 차에서 듣던 것을 폰에서 계속 */
    const val resume = "이어 듣기"
    const val limit = "귀가 한계"
    /** 코스 고르기 (차에서는 고르면 바로 출발) */
    const val start = "이 길로 출발"
    /** 다시 탔을 때 다음 곳으로 길 안내 */
    const val go = "출발 · 길 안내"
    const val adopt = "이걸로 바꾸기"
    const val keep = "그대로 갈게요"
    const val more = "30분 더"
    const val insert = "들르기"
    const val skipNext = "다음 건너뛰기"
    const val replaceNext = "다음 바꾸기"
    const val details = "코스 자세히"
    const val dayEnd = "오늘 나들이 끝"
    /** 도장 없는 바깥 장소(ext:…) — 주행 화면 아래 줄 */
    const val arriveVisit = "도착하면 다녀옴으로 기록"
}

/** 바깥 장소 도착 한 줄: '해운대해수욕장 다녀옴 · 기록했어요' (기록 안 하는 곳이면 '다녀옴'까지만). */
fun visitLine(name: String, recorded: Boolean) = "$name ${W.done}" + if (recorded) " · 기록했어요" else ""

/** 예상 도착: 도착지 이름 그대로 — '집 오후 4:17 도착 예정' / '할머니 집 오후 4:17 도착 예정'. */
fun arriveText(dest: String, time: String) = "$dest $time 도착 예정"

/** 도장 번호: 이 차가 찍은 몇 번째 도장 ('No.29' 대신). */
fun stampNo(n: Int) = "${n}번째 도장"

/** 모은 칸: '도장북 5/34칸' ('모은 도장 5 / 34' 대신). */
fun albumCount(got: Int, total: Int) = "도장북 $got/${total}칸"

/** 도착지 이름 + 으로/로 ('집으로' · '할머니 집으로'). 엔진과 같은 규칙. */
fun toward(dest: String): String = kr.milestamp.engine.LiveCourseEngine.josa(dest, "으로/로")

// ---------------------------------------------------------------- 시각 (12시간 고정)

private fun norm(min: Int) = Math.floorMod(min, 24 * 60)

/** 시·분 → '오후 9:54'. [compact]면 빈칸 없이 '오후9:54' (하루 막대처럼 좁은 곳). */
fun clockHM(h: Int, m: Int, compact: Boolean = false): String =
    "${if (h < 12) "오전" else "오후"}${if (compact) "" else " "}${if (h % 12 == 0) 12 else h % 12}:${"%02d".format(m)}"

/** 그날 0시부터 분 → '오후 9:54' (자정 넘김 처리). */
fun clock(min: Int, compact: Boolean = false): String = norm(min).let { clockHM(it / 60, it % 60, compact) }

/** 두 시각 범위: 오전/오후가 같으면 한 번만 ('오후 2:10–3:30'). */
fun clockRange(a: Int, b: Int): String {
    val ca = clock(a)
    val cb = clock(b)
    return if ((norm(a) < 720) == (norm(b) < 720)) "$ca–${cb.substringAfter(' ')}" else "$ca–$cb"
}

// 글 속 시각: 'H:MM'·'HH:MM' (앞뒤가 숫자·콜론·점이면 시각이 아님). 앞에 오전/오후가 이미 붙어 있으면 그대로.
private val CLOCK_RE = Regex("(오[전후]\\s?)?(?<![\\d:.])(\\d{1,2}):([0-5]\\d)(?![\\d:])")

/** 엔진·서버가 만든 글 속 'HH:MM'을 12시간으로 ('집에는 16:47쯤' → '집에는 오후 4:47쯤'). */
fun clockText(s: String): String = CLOCK_RE.replace(s) { m ->
    if (m.groupValues[1].isNotEmpty()) return@replace m.value
    val h = m.groupValues[2].toInt()
    if (h > 23) m.value else clockHM(h, m.groupValues[3].toInt())
}

/** [clockText]의 null 허용판. */
fun clockTextOrNull(s: String?): String? = s?.let(::clockText)

// ---------------------------------------------------------------- 누구랑 가요? (동행에 맞춘 차 화면 글)

/**
 * 동행(아이와 · 연인·부부 · 친구끼리 · 혼자)에 따라 차가 직접 만드는 글. **아이와는 예전 글 그대로.**
 * 엔진·서버가 만든 글(설명·이유·카드 이름)은 이미 동행을 따르므로 여기서 손대지 않는다.
 */
object GoWords {
    /** S0·S1 머리의 작은 칩: '아이와' · '연인·부부' · '친구끼리' · '혼자'. */
    fun chip(g: kr.milestamp.engine.GoWith): String = g.text

    /** 폰을 부르는 말: 아이와 = '가족 폰', 그 밖 = '폰'. */
    fun phone(g: kr.milestamp.engine.GoWith): String = if (g.kids) "가족 폰" else "폰"

    /** 도장북을 부르는 말: 아이와 = '가족 도장북', 그 밖 = '도장북'. */
    fun book(g: kr.milestamp.engine.GoWith): String = if (g.kids) "가족 도장북" else "도장북"

    /** 집 도착 뒷좌석 확인(화면 전체 빨강 · 음성)은 아이와만. */
    fun rearSeatCheck(g: kr.milestamp.engine.GoWith): Boolean = g.kids

    /** 낮잠 칩·하루 막대 낮잠 칸은 아이와만. */
    fun showNap(g: kr.milestamp.engine.GoWith): Boolean = g.kids

    /** 대기 화면 '아직 안 탐': 제목 줄 · 아래 줄. */
    const val BOARD_TITLE = "차에 타면 오늘 추천을 보여 드려요"
    fun boardLine(g: kr.milestamp.engine.GoWith) = "${phone(g)}에서 미리 고른 코스가 있으면 그 코스가 먼저 떠요"

    /** 대기 화면 '불러오는 중' 아래 줄. */
    fun loadingLine(g: kr.milestamp.engine.GoWith) = "${phone(g)}에서 코스를 고르면 여기에 바로 떠요"

    /** 탔는데 고른 코스가 없을 때. */
    fun pickLine(g: kr.milestamp.engine.GoWith) = "${phone(g)}에서 오늘 코스를 골라 주세요"

    /** 밤(서버 tomorrowHint): 대기 화면 두 줄. */
    const val TOMORROW_TITLE = "오늘은 늦었어요"
    fun tomorrowLine(g: kr.milestamp.engine.GoWith) = "${phone(g)}에서 내일 코스를 정해 두면 아침에 여기 떠 있어요"

    /** 집 도착 요약 아래 한 줄. */
    fun storySent(g: kr.milestamp.engine.GoWith) = "오늘 이야기를 ${phone(g)}으로 보냈어요"

    /**
     * 코스 경고 칩: 엔진의 '깨어 있는 이동 N분 (곳)'은 아이 기준(60분). 어른끼리는 90분까지 빼고, 넘으면 '긴 이동 N분 (곳)'.
     * 그 밖 경고는 그대로. null = 안 보임.
     */
    fun warning(w: String, g: kr.milestamp.engine.GoWith): String? {
        if (g.kids || !w.startsWith(AWAKE)) return w
        val len = w.removePrefix(AWAKE).substringBefore('분').trim().toIntOrNull() ?: return w
        return if (len <= kr.milestamp.engine.Planner.ADULT_DRIVE_MAX_MIN) null else "긴 이동 " + w.removePrefix(AWAKE)
    }
    private const val AWAKE = "깨어 있는 이동 "

    /**
     * 저녁 나들이 계획(엔진 Plan.evening) 머리 글: 아이와 '저녁 산책 어때요?' · 연인·부부 '둘이 야경 보러 갈까요?' ·
     * 친구끼리 '저녁에 잠깐 놀다 갈까요?' · 혼자 '바람 쐬러 갈까요?' (폰 오늘 탭 저녁 화면과 같은 말).
     */
    fun eveningTitle(g: kr.milestamp.engine.GoWith): String = when (g) {
        kr.milestamp.engine.GoWith.KIDS -> "저녁 산책 어때요?"
        kr.milestamp.engine.GoWith.COUPLE -> "둘이 야경 보러 갈까요?"
        kr.milestamp.engine.GoWith.FRIENDS -> "저녁에 잠깐 놀다 갈까요?"
        kr.milestamp.engine.GoWith.SOLO -> "바람 쐬러 갈까요?"
    }

    /** 저녁 계획의 귀가 칩 이름: 아이와 '잠자기 전' · 어른끼리 '늦어도'. */
    fun eveningLimit(g: kr.milestamp.engine.GoWith): String = if (g.kids) "잠자기 전" else "늦어도"

    /** 도장 화면 '이야기는 폰으로 이어 듣기'를 누른 뒤. */
    fun sentToPhone(g: kr.milestamp.engine.GoWith) = "${phone(g)}으로 보냈어요"
}

/** 지금 화면의 동행 (MileStampScreen이 UiState.companion으로 준다). 기본 = 아이와. */
val LocalGoWith = androidx.compose.runtime.staticCompositionLocalOf { kr.milestamp.engine.GoWith.KIDS }
