package kr.milestamp.car.trip

import kr.milestamp.engine.Gear
import kr.milestamp.engine.TripEngine

/**
 * 정차 판단 한 곳 — 서비스(서버 계획·코스 받기, 창 띄우기)와 화면(버튼 화면 열기)이 같은 기준을 쓴다.
 *
 * 정차 = **P단이면서 주행 제한 없음**. 신호 대기(D단 · 0km/h)는 AAOS가 '제한 없음'으로 두는 일이 많아서
 * 주행 제한 하나만 보면 버튼 많은 화면이 열린다 → 기어도 같이 본다.
 * 아직 신호를 하나도 못 받았으면(스냅숏 없음) 정차로 본다 (앱을 막 켰을 때 대기 화면이 보이게).
 */
object DriveGate {
    fun parked(gear: Gear, uxRestricted: Boolean): Boolean = gear == Gear.PARK && !uxRestricted

    fun parked(snap: TripEngine.Snapshot?): Boolean = snap == null || parked(snap.gear, snap.uxRestricted)
}
