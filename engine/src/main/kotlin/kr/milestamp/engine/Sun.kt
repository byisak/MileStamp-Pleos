package kr.milestamp.engine

import java.time.LocalDate
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.tan

/**
 * 해 뜨고 지는 시각 (미국 해양대기청 NOAA 천문 공식). 오차 1~2분.
 *
 * 서버는 한국천문연구원 출몰시각 API를 쓰고, 이 공식은 인터넷이 안 될 때 차가 쓰는 대체 계산이다.
 * 해가 뜨고 지는 순간 = 해 중심이 지평선 아래 0.833도(대기 굴절 + 해 반지름).
 */
object Sun {
    /** 해 뜨는·지는 시각 (그날 0시부터 분, 지역 시간). 백야·극야면 null. */
    data class RiseSet(val sunriseMin: Int, val sunsetMin: Int)

    /** 한국 표준시 = UTC+9. */
    const val KST_HOURS = 9.0

    fun riseSet(at: LatLng, date: LocalDate, tzHours: Double = KST_HOURS): RiseSet? {
        // 그날 지역 정오의 율리우스일 → 율리우스 세기
        val jd = date.toEpochDay() + 2440587.5 + 0.5 - tzHours / 24.0
        val t = (jd - 2451545.0) / 36525.0

        val l0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032)) // 해의 평균 황경
        val m = 357.52911 + t * (35999.05029 - 0.0001537 * t) // 평균 근점 이각
        val e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t) // 지구 궤도 이심률
        val mr = rad(m)
        val c = sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
            sin(2 * mr) * (0.019993 - 0.000101 * t) + sin(3 * mr) * 0.000289
        val omega = 125.04 - 1934.136 * t
        val lambda = l0 + c - 0.00569 - 0.00478 * sin(rad(omega)) // 겉보기 황경
        val eps0 = 23.0 + (26.0 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.0) / 60.0
        val eps = eps0 + 0.00256 * cos(rad(omega)) // 황도 경사
        val decl = asin(sin(rad(eps)) * sin(rad(lambda))) // 해의 적위

        val y = tan(rad(eps / 2)).let { it * it }
        val l0r = rad(l0)
        val eqTimeMin = 4 * deg(
            y * sin(2 * l0r) - 2 * e * sin(mr) + 4 * e * y * sin(mr) * cos(2 * l0r) -
                0.5 * y * y * sin(4 * l0r) - 1.25 * e * e * sin(2 * mr),
        )

        val latR = rad(at.lat)
        val cosHa = cos(rad(90.833)) / (cos(latR) * cos(decl)) - tan(latR) * tan(decl)
        if (cosHa < -1 || cosHa > 1) return null
        val haMin = 4 * deg(acos(cosHa))
        val noonMin = 720 - 4 * at.lng - eqTimeMin + tzHours * 60
        return RiseSet((noonMin - haMin).roundToInt(), (noonMin + haMin).roundToInt())
    }

    private fun rad(d: Double) = Math.toRadians(d)
    private fun deg(r: Double) = Math.toDegrees(r)
    private fun norm360(d: Double) = ((d % 360) + 360) % 360
}
