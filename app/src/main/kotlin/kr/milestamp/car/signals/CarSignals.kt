package kr.milestamp.car.signals

import android.car.Car
import android.car.VehicleGear
import android.car.VehiclePropertyIds
import android.car.drivingstate.CarUxRestrictionsManager
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Context
import android.util.Log
import kr.milestamp.engine.Gear
import kr.milestamp.engine.SignalEvent

/**
 * AAOS 표준 차량 API.
 * - 기어(GEAR_SELECTION)·속도(PERF_VEHICLE_SPEED): Pleos 문서가 "표준 데이터는 AAOS Car API"로 안내.
 *   (Vehicle SDK 2.3.1에서 VehicleSpeedListener 삭제됨)
 * - 주행 제한(CarUxRestrictions): 화면을 줄이거나 숨기는 기준.
 */
class CarSignals(private val context: Context, private val onStatus: (SourceStatus) -> Unit) : SignalSource {
    override val name = "AAOS 차량"

    private var car: Car? = null
    private var props: CarPropertyManager? = null
    private var ux: CarUxRestrictionsManager? = null
    private var emit: (SignalEvent) -> Unit = {}
    private var lastSpeedKmh = -1f
    private var gearOk = false
    private var speedOk = false

    private val propCallback = object : CarPropertyManager.CarPropertyEventCallback {
        override fun onChangeEvent(value: CarPropertyValue<*>) {
            when (value.propertyId) {
                VehiclePropertyIds.GEAR_SELECTION -> emit(SignalEvent.GearChanged(mapGear(value.value as Int), now()))
                VehiclePropertyIds.PERF_VEHICLE_SPEED -> {
                    val kmh = (value.value as Float) * 3.6f
                    // 0.5km/h 이상 바뀔 때만 넘김 (엔진 호출 최소화)
                    if (kotlin.math.abs(kmh - lastSpeedKmh) >= 0.5f || (kmh == 0f && lastSpeedKmh != 0f)) {
                        lastSpeedKmh = kmh
                        emit(SignalEvent.Speed(kmh, now()))
                    }
                }
            }
        }

        override fun onErrorEvent(propertyId: Int, areaId: Int) {
            Log.w(TAG, "property error id=$propertyId area=$areaId")
        }
    }

    override fun start(emit: (SignalEvent) -> Unit) {
        this.emit = emit
        car = Car.createCar(context, null, Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT) { c, ready ->
            if (ready) onCarReady(c) else onStatus(SourceStatus(name, false, "차 서비스 연결 끊김"))
        }
    }

    private fun onCarReady(c: Car) {
        runCatching {
            val pm = c.getCarManager(Car.PROPERTY_SERVICE) as CarPropertyManager
            props = pm
            gearOk = pm.registerCallback(propCallback, VehiclePropertyIds.GEAR_SELECTION, CarPropertyManager.SENSOR_RATE_ONCHANGE)
            // 속도는 실행 중 권한(CAR_SPEED)을 받아야 보인다. 없으면 false
            speedOk = pm.registerCallback(propCallback, VehiclePropertyIds.PERF_VEHICLE_SPEED, CarPropertyManager.SENSOR_RATE_NORMAL)
            // 첫 값
            runCatching { emit(SignalEvent.GearChanged(mapGear(pm.getIntProperty(VehiclePropertyIds.GEAR_SELECTION, 0)), now())) }
            runCatching { emit(SignalEvent.Speed(pm.getFloatProperty(VehiclePropertyIds.PERF_VEHICLE_SPEED, 0) * 3.6f, now())) }
        }.onFailure { onStatus(SourceStatus(name, false, "기어·속도: ${it.message}")) }

        runCatching {
            val um = c.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as CarUxRestrictionsManager
            ux = um
            um.registerListener { r -> emit(SignalEvent.UxRestricted(r.isRequiresDistractionOptimization, now())) }
            emit(SignalEvent.UxRestricted(um.currentCarUxRestrictions.isRequiresDistractionOptimization, now()))
        }.onFailure { onStatus(SourceStatus(name, false, "주행 제한: ${it.message}")) }

        val missing = listOfNotNull("기어".takeUnless { gearOk }, "속도(권한 필요)".takeUnless { speedOk }, "주행 제한".takeIf { ux == null })
        onStatus(
            if (missing.isEmpty()) SourceStatus(name, true, "기어·속도·주행 제한 연결")
            else SourceStatus(name, false, "안 됨: ${missing.joinToString(", ")}")
        )
    }

    override fun stop() {
        runCatching { props?.unregisterCallback(propCallback) }
        runCatching { ux?.unregisterListener() }
        runCatching { car?.disconnect() }
        props = null; ux = null; car = null
    }

    private fun mapGear(v: Int): Gear = when (v) {
        VehicleGear.GEAR_PARK -> Gear.PARK
        VehicleGear.GEAR_REVERSE -> Gear.REVERSE
        VehicleGear.GEAR_NEUTRAL -> Gear.NEUTRAL
        VehicleGear.GEAR_DRIVE -> Gear.DRIVE
        else -> if (v >= VehicleGear.GEAR_FIRST) Gear.DRIVE else Gear.UNKNOWN
    }

    companion object { private const val TAG = "CarSignals" }
}
