package kr.milestamp.car.signals

import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.area.DoorArea
import ai.pleos.playground.vehicle.api.model.area.SeatArea
import ai.pleos.playground.vehicle.constant.area.DoorValue
import ai.pleos.playground.vehicle.constant.area.SeatValue
import ai.pleos.playground.vehicle.listener.DistanceDrivenListener
import ai.pleos.playground.vehicle.listener.DoorPositionListener
import ai.pleos.playground.vehicle.listener.SeatOccupancyListener
import android.content.Context
import android.util.Log
import kr.milestamp.engine.SignalEvent

/**
 * Pleos Vehicle SDK 2.3.2 (Vehicle State = Playground '바로 사용').
 * - 누적 주행거리 km (CAR_DRIVE): 도장 위조 검증
 * - 2열 좌·우 탑승 (CAR_SEATS): 탑승·재탑승·뒷좌석 확인
 * - 운전석 문 ROW_1_LEFT (CAR_DOORS): 하차·핸드오프
 */
class PleosVehicleSignals(private val context: Context, private val onStatus: (SourceStatus) -> Unit) : SignalSource {
    override val name = "Pleos 차량"

    private var vehicle: Vehicle? = null
    private var emit: (SignalEvent) -> Unit = {}
    private val rear = mutableMapOf<SeatValue, Boolean>()

    private val odoListener = object : DistanceDrivenListener {
        override fun onDistanceDrivenUpdated(value: Float?) {
            value?.let { emit(SignalEvent.Odometer(it.toDouble(), now())) }
        }
        override fun onFailed(e: Exception) = fail("주행거리", e)
    }

    private val doorListener = object : DoorPositionListener {
        override fun onPositionUpdated(pos: Int?) {
            pos?.let { emit(SignalEvent.DriverDoor(it > 0, now())) }
        }
        override fun onFailed(e: Exception) = fail("운전석 문", e)
    }

    private val seatListeners = REAR_SEATS.associateWith { seat ->
        object : SeatOccupancyListener {
            override fun onSeatOccupancyUpdated(occupancy: Boolean?) {
                // SDK 2.3.2는 값이 반대로 온다 (에뮬레이터 확인 2026-10-25: 차 원값 2=앉음 → false, 1=빔 → true)
                if (occupancy != null) rear[seat] = if (SEAT_VALUE_INVERTED) !occupancy else occupancy
                emit(SignalEvent.RearSeats(rear.values.count { it }, now()))
            }
            override fun onFailed(e: Exception) = fail("2열 ${seat.name}", e)
        }
    }

    override fun start(emit: (SignalEvent) -> Unit) {
        this.emit = emit
        runCatching {
            val v = Vehicle(context).also { vehicle = it }
            v.initialize()

            val odo = v.getOdometer()
            odo.getCurrentDistanceDriven(
                onComplete = { km -> km?.let { emit(SignalEvent.Odometer(it.toDouble(), now())) } },
                onFailed = { fail("주행거리 첫 값", it) },
            )
            odo.registerDistanceDriven(odoListener)

            val door = v.getDoor()
            door.registerDoorPosition(DRIVER_DOOR, doorListener)

            val seat = v.getSeat()
            for ((value, l) in seatListeners) {
                val area = SeatArea(value)
                seat.getCurrentSeatOccupancy(
                    area,
                    onComplete = { occ -> l.onSeatOccupancyUpdated(occ) },
                    onFailed = { fail("2열 첫 값", it) },
                )
                seat.registerSeatOccupancy(area, l)
            }
            onStatus(SourceStatus(name, true, "주행거리·좌석·문 구독"))
        }.onFailure {
            onStatus(SourceStatus(name, false, "초기화 실패: ${it.message}"))
        }
    }

    override fun stop() {
        val v = vehicle ?: return
        runCatching { v.getOdometer().unregisterDistanceDriven(odoListener) }
        runCatching { v.getDoor().unregisterDoorPosition(DRIVER_DOOR, doorListener) }
        runCatching { for ((value, l) in seatListeners) v.getSeat().unregisterSeatOccupancy(SeatArea(value), l) }
        runCatching { v.release() }
        vehicle = null
    }

    private fun fail(what: String, e: Exception) {
        Log.w(TAG, "$what 실패", e)
        onStatus(SourceStatus(name, false, "$what: ${e.message}"))
    }

    companion object {
        private const val TAG = "PleosVehicle"
        /** 국내 차량 기준 운전석 = 1열 왼쪽. */
        val DRIVER_DOOR = DoorArea(DoorValue.ROW_1_LEFT)
        val REAR_SEATS = listOf(SeatValue.ROW_2_LEFT, SeatValue.ROW_2_RIGHT)
        /** SDK가 고쳐지면 false로. 실제 차에서 한 번 더 확인할 것. */
        private const val SEAT_VALUE_INVERTED = true
    }
}
