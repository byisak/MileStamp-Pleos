package kr.milestamp.car.signals

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.SignalEvent

/**
 * 위치 예비 경로: 안드로이드 기본 위치.
 * 내비가 위치를 안 줄 때(내비 미장착 차량, 에뮬레이터의 geo fix 시연)를 대비한다.
 * 이동 경로는 저장하지 않는다 — 엔진이 '최신 위치' 하나만 들고 있다.
 */
class LocationFallback(private val context: Context, private val onStatus: (SourceStatus) -> Unit) : SignalSource {
    override val name = "기본 위치"

    private var lm: LocationManager? = null
    private var emit: (SignalEvent) -> Unit = {}
    private val listener = LocationListener { loc: Location ->
        emit(SignalEvent.Location(LatLng(loc.latitude, loc.longitude), now()))
    }

    @SuppressLint("MissingPermission")
    override fun start(emit: (SignalEvent) -> Unit) {
        this.emit = emit
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            onStatus(SourceStatus(name, false, "위치 권한 없음"))
            return
        }
        val m = context.getSystemService(LocationManager::class.java).also { lm = it }
        val provider = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.FUSED_PROVIDER)
            .firstOrNull { runCatching { m.isProviderEnabled(it) }.getOrDefault(false) }
        if (provider == null) {
            onStatus(SourceStatus(name, false, "위치 제공자 없음"))
            return
        }
        // 20m 이상 움직였을 때만, 최소 5초 간격
        m.requestLocationUpdates(provider, 5_000L, 20f, listener, Looper.getMainLooper())
        m.getLastKnownLocation(provider)?.let { listener.onLocationChanged(it) }
        onStatus(SourceStatus(name, true, provider))
    }

    override fun stop() {
        runCatching { lm?.removeUpdates(listener) }
        lm = null
    }
}
