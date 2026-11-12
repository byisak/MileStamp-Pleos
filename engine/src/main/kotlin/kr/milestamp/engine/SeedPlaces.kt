package kr.milestamp.engine

/**
 * 시연 동선 시드 + 차가 인터넷 없이 쓰는 추천 후보.
 * 체류(P80)·아이 적합도는 초기값이며 서버의 '같은 나이 가족' 기록으로 보정된다.
 */
object SeedPlaces {
    /** 데모 '집' = 대구 북구청 (공개 영상이므로 실제 집 좌표를 쓰지 않는다). */
    val DEMO_HOME = LatLng(35.8858, 128.5828)

    /** '상시 개방'의 닫는 시각 = 자정. */
    private const val DAY_END = 24 * 60

    /*
     * 좌표·운영 시간은 장소 조사(tools/places/candidates.json, TourAPI 기준, 10/25).
     * 머무는 시간·아이 적합도는 시연 하루 이야기(day_story.sh)에 맞춰 둔 처음 값 그대로 (조사값과 다른 곳: 과학관 150분 등).
     */
    /** 상시 개방. */
    val SEOKGUL = Place("seokgul", "군위 삼존석굴", LatLng(36.04890, 128.64090), indoor = false, dwellP80Min = 30, kidFit = 0.5,
        openMin = 0, closeMin = DAY_END)
    val THEME_PARK = Place("samguk", "삼국유사테마파크", LatLng(36.16429, 128.69592), indoor = false, dwellP80Min = 160, kidFit = 1.0,
        openMin = 10 * 60, closeMin = 18 * 60)
    val SCIENCE = Place("dgsm", "국립대구과학관", LatLng(35.68620, 128.46642), indoor = true, dwellP80Min = 120, kidFit = 1.0,
        openMin = 9 * 60 + 30, closeMin = 17 * 60 + 30)
    /** 전시 관람 10:00~17:30. */
    val THE_ARC = Place("thearc", "디아크", LatLng(35.83908, 128.46817), indoor = true, dwellP80Min = 25, kidFit = 0.5,
        openMin = 10 * 60, closeMin = 17 * 60 + 30)
    val HWABON = Place("hwabon", "화본역", LatLng(36.12665, 128.69488), indoor = false, dwellP80Min = 40, kidFit = 0.7,
        openMin = 9 * 60, closeMin = 17 * 60)
    /** 위조 시도 시연용으로 멀리 떨어진 장소. 동절기 09:00~17:00. */
    val HAHOE = Place("hahoe", "안동 하회마을", LatLng(36.5390, 128.5180), indoor = false, dwellP80Min = 120, kidFit = 0.6,
        openMin = 9 * 60, closeMin = 17 * 60)

    /** 시연 하루 이야기의 도장 장소. */
    val STORY = listOf(SEOKGUL, THEME_PARK, SCIENCE, THE_ARC, HWABON, HAHOE)

    /*
     * 추천을 그럴듯하게 하려고 넣은 대구 시내 후보 몇 곳 — 장소 조사(tools/places/candidates.json)에서 골라 옮김.
     * 10/26부터 34곳 모두 도장 그림이 있어 모두 도장 장소(stampable 기본값 true). 실제 후보 전체는 서버 places 표에서 받는다.
     * '실내·야외 섞임'인 곳은 비 오는 날 갈 만한 곳만 실내로 침. 요즘 많이 감(popular)은 서버 방문 기록이 없어 0.
     */
    val AQUARIUM = Place("aquarium", "대구아쿠아리움", LatLng(35.87802, 128.62943), indoor = true, dwellP80Min = 100, kidFit = 0.95,
        openMin = 10 * 60 + 30, closeMin = 20 * 60)
    val KIDSWORLD = Place("kidsworld", "대구어린이세상", LatLng(35.84665, 128.62776), indoor = true, dwellP80Min = 120, kidFit = 1.0,
        openMin = 9 * 60, closeMin = 18 * 60)
    val MUSEUM = Place("nmd", "국립대구박물관", LatLng(35.84586, 128.63721), indoor = true, dwellP80Min = 75, kidFit = 0.8,
        openMin = 9 * 60, closeMin = 18 * 60)
    val WEATHER = Place("weather", "국립대구기상과학관", LatLng(35.87902, 128.65052), indoor = true, dwellP80Min = 50, kidFit = 0.75,
        openMin = 10 * 60, closeMin = 17 * 60 + 30)
    val EWORLD = Place("eworld", "이월드", LatLng(35.85434, 128.56483), indoor = false, dwellP80Min = 180, kidFit = 0.85,
        openMin = 10 * 60, closeMin = 21 * 60)
    /** 북구 집·어린이집 근처 공원들 (오후 짧은 나들이용, 상시 개방). */
    val HAJUNGDO = Place("hajungdo", "금호강 하중도", LatLng(35.90092, 128.55985), indoor = false, dwellP80Min = 50, kidFit = 0.75,
        openMin = 0, closeMin = DAY_END)
    val CHIMSAN = Place("chimsan", "침산공원", LatLng(35.89523, 128.58586), indoor = false, dwellP80Min = 40, kidFit = 0.6,
        openMin = 0, closeMin = DAY_END)
    val UNAMJI = Place("unamji", "운암지 수변공원", LatLng(35.93208, 128.56891), indoor = false, dwellP80Min = 45, kidFit = 0.7,
        openMin = 0, closeMin = DAY_END)

    /** 운영 시간 미확인 → 기본 09:00~18:00. */
    val SAMSUNG = Place("samsung", "대구삼성창조캠퍼스", LatLng(35.88414, 128.59491), indoor = false, dwellP80Min = 40, kidFit = 0.6)

    val NEARBY = listOf(AQUARIUM, KIDSWORLD, MUSEUM, WEATHER, EWORLD, HAJUNGDO, CHIMSAN, UNAMJI, SAMSUNG)

    /** 차 엔진이 쓰는 전체 후보 (인터넷이 안 될 때). */
    val ALL = STORY + NEARBY

    fun byId(id: String): Place? = ALL.firstOrNull { it.id == id }

    /**
     * 시연 가족. 귀가는 시연 대본(day_story.sh, 16:10 디아크 → 17:22 귀가)에 맞춰 17:30 고정.
     * 실제 가족 기본값은 '해 지기 30분 전'([FamilyProfile.backBy] 기본값).
     */
    fun demoProfile() = FamilyProfile(
        home = DEMO_HOME,
        kids = 2,
        napStartMin = hhmm("13:00"),
        napEndMin = hhmm("14:30"),
        backBy = BackBy.At(hhmm("17:30")),
        stampsBefore = 22,
    )
}
