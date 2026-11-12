package kr.milestamp.car.trip

import kr.milestamp.engine.Gear
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 정차 = P단이면서 주행 제한 없음 (서비스·화면 같은 기준). */
class DriveGateTest {
    @Test fun p단_제한없음만_정차() {
        assertTrue(DriveGate.parked(Gear.PARK, uxRestricted = false))
    }

    @Test fun 신호대기_D단_제한없음은_정차가_아님() {
        assertFalse(DriveGate.parked(Gear.DRIVE, uxRestricted = false))
    }

    @Test fun P단이어도_주행제한이면_정차가_아님() {
        assertFalse(DriveGate.parked(Gear.PARK, uxRestricted = true))
    }

    @Test fun 기어를_모르거나_N_R이면_정차가_아님() {
        assertFalse(DriveGate.parked(Gear.UNKNOWN, uxRestricted = false))
        assertFalse(DriveGate.parked(Gear.NEUTRAL, uxRestricted = false))
        assertFalse(DriveGate.parked(Gear.REVERSE, uxRestricted = false))
    }

    @Test fun 신호를_아직_못받았으면_정차로_봄() {
        assertTrue(DriveGate.parked(null))
    }
}
