package kr.milestamp.car

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kr.milestamp.car.net.RemoteStamps
import kr.milestamp.car.net.FestivalMeta
import kr.milestamp.car.net.StampStore
import kr.milestamp.car.trip.TripHub

class MileStampApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_TRIP, "여행 기록", NotificationManager.IMPORTANCE_MIN).apply {
                setShowBadge(false)
            }
        )
        // 도장북: 저장본을 읽고, 차가 찍은 도장은 서버에 올라가기 전에도 바로 도장북에 보이게 적어 둔다
        StampStore.init(this)
        RemoteStamps.init(this)
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            TripHub.ui.map { it.stamp }.distinctUntilChanged().filterNotNull().collect { s ->
                StampStore.recordLocal(s.place.id, s.number, s.rare, s.place.festival?.let { f ->
                    FestivalMeta.get(f.id) ?: FestivalMeta.Info(f.id, s.place.name, "", f.placeId, f.starts, f.ends)
                })
            }
        }
    }

    companion object {
        const val CHANNEL_TRIP = "trip"
    }
}
