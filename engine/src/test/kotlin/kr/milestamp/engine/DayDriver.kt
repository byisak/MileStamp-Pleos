package kr.milestamp.engine

/**
 * 테스트용 운전석. scripts/day_story.sh 와 같은 말로 신호를 넣고, 엔진이 낸 Effect를 모은다.
 * 시간은 [wait]로만 흐른다(1초마다 Tick).
 */
class DayDriver(
    val engine: TripEngine = TripEngine(SeedPlaces.demoProfile(), SeedPlaces.ALL),
) {
    var nowMs = 0L
        private set
    val effects = mutableListOf<Effect>()
    private var odoKm = 12_000.0

    private fun send(e: SignalEvent) { effects += engine.handle(e) }

    fun wait(seconds: Int) = repeat(seconds) { nowMs += 1_000; send(SignalEvent.Tick(nowMs)) }

    fun gear(g: Gear) = send(SignalEvent.GearChanged(g, nowMs))
    fun speed(kmh: Int) = send(SignalEvent.Speed(kmh.toFloat(), nowMs))
    fun seats(n: Int) = send(SignalEvent.RearSeats(n, nowMs))
    fun door(open: Boolean) = send(SignalEvent.DriverDoor(open, nowMs))
    fun clock(t: String) = send(SignalEvent.Clock(hhmm(t), nowMs))
    fun weather(sky: Sky, rainSoon: Boolean = false) = send(SignalEvent.Weather(sky, rainSoon, nowMs))
    fun at(p: LatLng) = send(SignalEvent.Location(p, nowMs))
    fun at(p: Place) = at(p.at)
    fun odoAdd(km: Int) { odoKm += km; send(SignalEvent.Odometer(odoKm, nowMs)) }

    /** 내비 onDestinationInfo 는 반복해서 오므로 두 번 넣는다 (디버그 입력도 같음). */
    fun eta(remainS: Int, remainM: Int = 2_000) {
        send(SignalEvent.Eta(remainS, remainM, nowMs)); send(SignalEvent.Eta(remainS, remainM, nowMs))
    }

    /** 화면의 1순위 카드 탭. */
    fun tapBest(): PlanOption {
        val option = requireNotNull(engine.lastPlan?.best) { "표시된 추천이 없음" }
        send(SignalEvent.RouteChosen(option, nowMs))
        return option
    }

    /** 위치 → 속도 0 → P (스크립트의 도착 동작). */
    fun parkAt(p: Place, odoKm: Int) {
        if (odoKm > 0) odoAdd(odoKm)
        at(p); speed(0); wait(1); gear(Gear.PARK); wait(4)
    }

    fun drive(kmh: Int = 60) { gear(Gear.DRIVE); speed(kmh); wait(1) }

    inline fun <reified T : Effect> take(): List<T> = effects.filterIsInstance<T>()

    /** 지금까지 모은 Effect를 비우고 돌려준다. 장면별 검사용. */
    fun drain(): List<Effect> = effects.toList().also { effects.clear() }
}
