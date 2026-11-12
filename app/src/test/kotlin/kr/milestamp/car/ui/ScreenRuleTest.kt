package kr.milestamp.car.ui

import kr.milestamp.car.trip.DaySummaryShown
import kr.milestamp.car.trip.StampShown
import kr.milestamp.car.trip.UiState
import kr.milestamp.car.trip.VisitShown
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.Place
import kr.milestamp.engine.Gear
import kr.milestamp.engine.SeedPlaces
import kr.milestamp.engine.Sky
import kr.milestamp.engine.TripEngine
import kr.milestamp.engine.TripState
import org.junit.Assert.assertEquals
import org.junit.Test

class ScreenRuleTest {
    private fun snap(state: TripState, gear: Gear, speed: Float = 0f, ux: Boolean = false, now: Int = 8 * 60 + 30, stamps: List<String> = emptyList()) =
        TripEngine.Snapshot(state, gear, speed, false, 0, null, null, ux, now, Sky.CLEAR, false, null, stamps)

    private val stamp = StampShown(SeedPlaces.ALL.first(), 1, null, false)

    @Test fun 신호대기_D단_0km_제한없음이면_버튼화면_대신_주행화면() {
        val ui = UiState(snapshot = snap(TripState.DRIVING, Gear.DRIVE, speed = 0f, ux = false), stamp = stamp, summary = DaySummaryShown(1, 0, 10.0))
        assertEquals(CarScreen.DRIVING, carScreenFor(ui))
    }

    @Test fun P단이어도_주행제한이면_주행화면() {
        assertEquals(CarScreen.DRIVING, carScreenFor(UiState(snapshot = snap(TripState.PARKED, Gear.PARK, ux = true), stamp = stamp)))
    }

    @Test fun P단_제한없음이면_도장화면() {
        assertEquals(CarScreen.STAMP, carScreenFor(UiState(snapshot = snap(TripState.PARKED, Gear.PARK), stamp = stamp)))
    }

    @Test fun 시동직후는_대기화면_타기전엔_타면_추천() {
        assertEquals(CarScreen.WAITING, carScreenFor(UiState()))
        val ui = UiState(snapshot = snap(TripState.IDLE, Gear.PARK))
        assertEquals(CarScreen.WAITING, carScreenFor(ui))
        // 아직 안 탐 = 불러오는 것이 없음 → '차에 타면 오늘 추천'
        assertEquals(WaitKind.BEFORE_BOARD, waitKindFor(ui.snapshot?.state))
        // 상태를 아직 모름 · 탑승해서 계획을 받는 중 = '불러오는 중'
        assertEquals(WaitKind.LOADING, waitKindFor(null))
        assertEquals(WaitKind.LOADING, waitKindFor(TripState.PLANNING))
    }

    @Test fun 탔는데_코스가_없으면_골라주세요() {
        val ui = UiState(snapshot = snap(TripState.PARKED, Gear.PARK))
        assertEquals(CarScreen.WAITING, carScreenFor(ui))
        assertEquals(WaitKind.NO_COURSE, waitKindFor(TripState.PARKED))
        assertEquals(WaitKind.NO_COURSE, waitKindFor(TripState.OUT))
    }

    @Test fun 집_요약을_닫으면_나들이_끝() {
        val home = snap(TripState.HOME, Gear.PARK, now = 17 * 60, stamps = listOf("화본역", "디아크"))
        assertEquals(CarScreen.SUMMARY, carScreenFor(UiState(snapshot = home, summary = DaySummaryShown(2, 0, 80.0))))
        assertEquals(CarScreen.DAY_END, carScreenFor(UiState(snapshot = home)))
    }

    @Test fun 개발자_상태판은_켰을때만() {
        val parked = snap(TripState.IDLE, Gear.PARK)
        assertEquals(CarScreen.DEV_BOARD, carScreenFor(UiState(snapshot = parked, devBoard = true)))
        // 주행 중엔 상태판도 안 보임
        assertEquals(CarScreen.DRIVING, carScreenFor(UiState(snapshot = snap(TripState.DRIVING, Gear.DRIVE), devBoard = true)))
    }

    @Test fun 시각별_인사() {
        assertEquals("좋은 아침이에요", greetingFor(8 * 60 + 30))
        assertEquals("좋은 오후예요", greetingFor(13 * 60))
        assertEquals("좋은 저녁이에요", greetingFor(18 * 60))
        assertEquals("안녕하세요", greetingFor(23 * 60))
        assertEquals("안녕하세요", greetingFor(null))
    }

    @Test fun 바깥장소_도착은_도장대신_다녀옴화면_주행중엔_주행화면() {
        val ext = Place("ext:tour:126081", "해운대해수욕장", LatLng(35.1587, 129.1604), stampable = false)
        val v = VisitShown(ext, recorded = true, atMs = 0)
        assertEquals(CarScreen.VISIT, carScreenFor(UiState(snapshot = snap(TripState.PARKED, Gear.PARK), visit = v)))
        assertEquals(CarScreen.DRIVING, carScreenFor(UiState(snapshot = snap(TripState.DRIVING, Gear.DRIVE, speed = 40f), visit = v)))
        assertEquals("해운대해수욕장 다녀옴 · 기록했어요", visitLine(ext.name, true))
        assertEquals("해운대해수욕장 다녀옴", visitLine(ext.name, false))
    }

    @Test fun 시범_지역_밖이면_가장_가까운_명소_거리() {
        val places = SeedPlaces.ALL
        // 대구 북구청 = 시범 지역 안 → 안내 없음
        assertEquals(null, outOfAreaKm(LatLng(35.8858, 128.5828), places))
        // 판교(에뮬레이터 기본 위치) → 100km 넘음 → 거리
        val far = outOfAreaKm(LatLng(37.4020, 127.1086), places)
        assert(far != null && far > 100) { "판교는 시범 지역 밖이어야 함: $far" }
        // 위치를 모르거나 목록이 비면 띄우지 않음
        assertEquals(null, outOfAreaKm(null, places))
        assertEquals(null, outOfAreaKm(LatLng(37.4020, 127.1086), emptyList()))
    }
}
