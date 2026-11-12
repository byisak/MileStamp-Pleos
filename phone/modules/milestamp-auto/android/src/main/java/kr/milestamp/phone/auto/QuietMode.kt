package kr.milestamp.phone.auto

import kr.milestamp.engine.FamilyProfile
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.TimeBudget

/**
 * 쉿 모드 (아이가 자는 중 → 차에서 도장 소리·음성 없이 그림만).
 * 폰 '우리 차' 탭에서 고른다: 자동(낮잠 시간) / 켜기 / 끄기.
 * 자동이면 차 엔진과 같은 규칙 [TimeBudget.quietByDefault]: 낮잠 20분 전 ~ 낮잠 끝 (폰 시계, 그날 0시부터 분).
 * 가족 낮잠은 /api/family(napStart·napLen, 둘 다 null = 낮잠 없음 → 자동이면 늘 꺼짐).
 */
enum class QuietMode(val key: String) {
    AUTO("auto"), ON("on"), OFF("off");

    companion object {
        fun of(s: String?): QuietMode = entries.firstOrNull { it.key == s } ?: AUTO
    }
}

object QuietRule {
    /** [napStartMin]·[napLenMin]은 분 (780, 90). 하나라도 null이거나 길이 0 이하면 낮잠 없음 */
    fun quiet(mode: QuietMode, napStartMin: Int?, napLenMin: Int?, nowMin: Int): Boolean = when (mode) {
        QuietMode.ON -> true
        QuietMode.OFF -> false
        QuietMode.AUTO -> napStartMin != null && napLenMin != null && napLenMin > 0 &&
            TimeBudget.quietByDefault(nowMin, FamilyProfile(home = LatLng(0.0, 0.0), napStartMin = napStartMin, napEndMin = napStartMin + napLenMin))
    }
}
