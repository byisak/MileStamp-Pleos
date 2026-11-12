package kr.milestamp.engine

import kotlin.math.roundToInt

/* 기획서 6장·3-2의 추론 규칙. 모두 결정적(같은 입력 → 같은 출력)이라 단위 테스트로 고정한다. */

/** MVP 이동시간 근사: 직선거리 × 도로계수 ÷ 평균속도. 상용화 때 자체 경로엔진(OSRM)으로 교체. */
object TravelTime {
    const val ROAD_FACTOR = 1.3
    const val AVG_KMH = 50.0

    fun roadKm(a: LatLng, b: LatLng): Double = Geo.km(a, b) * ROAD_FACTOR

    fun minutes(a: LatLng, b: LatLng): Int = (roadKm(a, b) / AVG_KMH * 60).roundToInt()
}

/** 귀가 목표 안에서 쓸 수 있는 시간. */
object TimeBudget {
    const val SAFETY_MIN = 10

    /** B = 귀가 목표 − 지금 − 집까지 − 안전 10분 */
    fun availableMin(nowMin: Int, backByMin: Int, toHomeMin: Int): Int =
        backByMin - nowMin - toHomeMin - SAFETY_MIN

    /** Δ = τ(지금→후보) + τ(후보→집) − τ(지금→집) */
    fun detourMin(toCandMin: Int, candToHomeMin: Int, toHomeMin: Int): Int =
        toCandMin + candToHomeMin - toHomeMin

    fun fits(detourMin: Int, dwellMin: Int, budgetMin: Int): Boolean = detourMin + dwellMin <= budgetMin

    /**
     * 낮잠 맞춤: 낮잠 20분 전~10분 후 사이에 출발하고,
     * 이동시간이 낮잠 길이의 0.7~1.1배면 "차에서 한숨 자고 도착".
     */
    fun napAligned(departMin: Int, travelMin: Int, profile: FamilyProfile): Boolean {
        if (!profile.hasNap) return false
        val len = profile.napLengthMin
        val departOk = departMin in (profile.napStartMin - 20)..(profile.napStartMin + 10)
        val travelOk = travelMin >= 0.7 * len && travelMin <= 1.1 * len
        return departOk && travelOk
    }

    /** 낮잠 시간대 출발이면 쉿 모드가 기본. 차는 아이가 잠들었는지 알 수 없다. */
    fun quietByDefault(departMin: Int, profile: FamilyProfile): Boolean =
        profile.hasNap && departMin in (profile.napStartMin - 20)..profile.napEndMin
}

enum class IntroVariant { FULL_60S, KIDS_30S, PHONE_ONLY }

/** 도착 전 소개 길이 고르기. 남은 시간에서 주차 25초를 빼고 남는 여유로 정한다. */
object IntroPicker {
    const val TRIGGER_REMAIN_S = 150
    const val TRIGGER_SOFT_KM = 1.5
    private const val PARKING_S = 25

    fun pick(remainS: Int?, quiet: Boolean): IntroVariant {
        if (quiet) return IntroVariant.PHONE_ONLY
        val spare = (remainS ?: TRIGGER_REMAIN_S) - PARKING_S
        return when {
            spare >= 75 -> IntroVariant.FULL_60S
            spare >= 40 -> IntroVariant.KIDS_30S
            else -> IntroVariant.PHONE_ONLY
        }
    }
}

sealed interface StampVerdict {
    data class Granted(val odoDeltaKm: Double, val minKm: Double, val maxKm: Double) : StampVerdict
    data class Held(val reason: HoldReason, val detail: String) : StampVerdict
}

enum class HoldReason { ODO_TOO_SHORT, ODO_TOO_LONG, NO_ODOMETER, ALREADY_TODAY }

/**
 * 도장 판정 (차 1차 검증). 서버가 같은 규칙으로 2차 검증한다.
 * 0.9 × 직선거리 − 1km ≤ 늘어난 주행거리 ≤ 1.5 × 경로거리 + 20km
 *
 * 돌아온 길(우회): 이번 구간 GPS 궤적 길이([gpsPathKm])가 있고 믿을 만하면(≥ 0.9 × 직선거리) 위 상한을
 * max(1.5 × 경로 + 20, 1.15 × 궤적 + 3)으로 넓힌다. 하한은 그대로라 위치만 바꾼 위조(주행거리 거의 0)는 여전히 보류,
 * 궤적으로 설명 안 되는 주행거리(궤적보다 한참 긺)도 보류.
 */
object StampVerifier {
    /** 궤적이 직선거리의 이 비율 이상이어야 믿는다 (위치가 튀어 궤적이 빠졌으면 안 씀). */
    const val GPS_CONSISTENT_RATIO = 0.9
    /** 궤적 기준 상한 = 1.15 × 궤적 + 3km (GPS가 굽은 길을 짧게 재는 몫). */
    const val GPS_SLACK_RATIO = 1.15
    const val GPS_SLACK_KM = 3.0

    fun verify(
        legStart: LatLng,
        place: Place,
        odoStartKm: Double?,
        odoNowKm: Double?,
        routeKmHint: Double?,
        alreadyToday: Boolean,
        /** 이번 구간 GPS 궤적 길이(km, 튀는 위치 뺌). 모르면 null. */
        gpsPathKm: Double? = null,
    ): StampVerdict {
        if (alreadyToday) return StampVerdict.Held(HoldReason.ALREADY_TODAY, "오늘 이미 찍은 곳이에요")
        if (odoStartKm == null || odoNowKm == null) {
            return StampVerdict.Held(HoldReason.NO_ODOMETER, "주행거리 신호를 받지 못했어요")
        }
        val straight = Geo.km(legStart, place.at)
        val route = routeKmHint ?: (straight * TravelTime.ROAD_FACTOR)
        val delta = odoNowKm - odoStartKm
        val min = 0.9 * straight - 1.0
        val byRoute = 1.5 * route + 20.0
        val pathOk = gpsPathKm != null && gpsPathKm >= GPS_CONSISTENT_RATIO * straight
        val max = if (pathOk) maxOf(byRoute, GPS_SLACK_RATIO * gpsPathKm!! + GPS_SLACK_KM) else byRoute
        return when {
            delta < min -> StampVerdict.Held(
                HoldReason.ODO_TOO_SHORT,
                "주행거리가 이동거리와 맞지 않아요 (%.1fkm < %.1fkm)".format(delta, min),
            )
            delta > max -> StampVerdict.Held(
                HoldReason.ODO_TOO_LONG,
                "주행거리가 경로보다 너무 길어요 (%.1fkm > %.1fkm)".format(delta, max),
            )
            else -> StampVerdict.Granted(delta, min, max)
        }
    }
}
