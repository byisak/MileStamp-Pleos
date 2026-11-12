package kr.milestamp.car.trip

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 시동(부팅) 후 자동 시작: 앱을 열지 않아도 첫 탑승부터 기록. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        runCatching { TripService.start(context) }
    }
}
