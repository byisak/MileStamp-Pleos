package kr.milestamp.car.signals

import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.NavigationStatus
import ai.pleos.playground.navi.constants.WaypointIndex
import ai.pleos.playground.navi.data.CurrentLocationInfo
import ai.pleos.playground.navi.data.DestinationArrivedInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.RouteWithWaypointsRequest
import ai.pleos.playground.navi.data.TripInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import android.content.Context
import android.util.Log
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.Place
import kr.milestamp.engine.SignalEvent

/**
 * Pleos NaviHelper SDK 3.0.5 ('바로 사용').
 * - onDestinationInfo: 남은 시간·거리 → 도착 전 소개 시점
 * - onTripInfo: 경로 총거리 → 도장 검증의 '경로 거리'
 * - onCurrentLocationInfo: 현재 위치 (FusedLocation SDK가 '준비 중'이라 1순위 위치원)
 * - requestRoute / requestRouteWithWaypoints: 추천 카드에서 고른 코스로 길 안내 (마지막 곳 = 목적지, 앞의 곳 = 경유지, 경유지는 최대 2곳)
 */
class NaviSignals(private val context: Context, private val onStatus: (SourceStatus) -> Unit) : SignalSource {
    override val name = "Pleos 내비"

    private var navi: NaviHelper? = null
    private var emit: (SignalEvent) -> Unit = {}
    private var routeDistanceSent = false
    private var lastRouteKm = 0.0
    var lastStatus: NavigationStatus? = null
        private set

    private val listener = object : NaviHelperEventListener {
        override fun onDestinationInfo(destinationInfo: DestinationInfo) {
            emit(SignalEvent.Eta(destinationInfo.remainTime, destinationInfo.remainDistance, now()))
        }

        override fun onTripInfo(tripInfo: TripInfo) {
            val km = tripInfo.distance / 1000.0
            // 처음 값 + 재탐색으로 경로가 1km 넘게 길어지면 다시 보냄 (엔진은 처음·마지막 중 큰 값을 도장 검증에 씀)
            if (tripInfo.distance > 0 && (!routeDistanceSent || km > lastRouteKm + REROUTE_GROW_KM)) {
                routeDistanceSent = true
                emit(SignalEvent.RouteDistance(km, now()))
            }
            if (tripInfo.distance > 0) lastRouteKm = km
            if (tripInfo.eta > 0) emit(SignalEvent.Eta(tripInfo.eta, tripInfo.distance, now()))
        }

        override fun onCurrentLocationInfo(currentLocationInfo: CurrentLocationInfo) {
            emit(SignalEvent.Location(LatLng(currentLocationInfo.latitude, currentLocationInfo.longitude), now()))
        }

        override fun onRoutingCompleted() {
            routeDistanceSent = false
            navi?.getDestinationInfo()
        }

        override fun onDestinationArrived(destinationArrivedInfo: DestinationArrivedInfo) {
            // 도착 자체로 도장을 찍지 않는다 (P단 3초 + 반경 + 주행거리 검증은 엔진이 판정)
            Log.i(TAG, "destination arrived")
            navi?.getCurrentLocationInfo()
        }

        override fun onWayPointArrived(waypointArrivedInfo: ai.pleos.playground.navi.data.WaypointArrivedInfo) {
            // 경유지 도착도 도장 판정은 엔진이 (P단 3초 + 반경 + 주행거리)
            Log.i(TAG, "waypoint arrived $waypointArrivedInfo")
            navi?.getCurrentLocationInfo()
        }

        override fun onNavigationStatus(status: NavigationStatus) {
            lastStatus = status
        }

        override fun onError(errorCode: NaviErrorCode) {
            onStatus(SourceStatus(name, false, "내비 오류: $errorCode"))
        }
    }

    override fun start(emit: (SignalEvent) -> Unit) {
        this.emit = emit
        runCatching {
            val n = NaviHelper(context).also { navi = it }
            n.initialize(
                onConnected = {
                    n.addListener(listener)
                    n.getCurrentLocationInfo()
                    n.getDestinationInfo()
                    onStatus(SourceStatus(name, true, "길 안내 연결"))
                },
                onFailed = { t -> onStatus(SourceStatus(name, false, "연결 실패: ${t.message}")) },
            )
        }.onFailure { onStatus(SourceStatus(name, false, "초기화 실패: ${it.message}")) }
    }

    /**
     * 코스 전체로 길 안내: 마지막 장소가 목적지, 앞 장소들은 경유지(SDK가 FIRST·SECOND 두 곳까지).
     * 한 곳이면 보통 경로 요청. 경유지 요청이 실패하면 첫 장소만으로 다시 요청한다.
     */
    fun requestCourse(stops: List<Place>) {
        if (stops.isEmpty()) return
        if (stops.size == 1) { requestRouteTo(stops.first()); return }
        val n = navi ?: return
        routeDistanceSent = false
        // 경유지는 두 곳까지 — 곳이 넷 이상(밥 자리를 넣은 코스)이면 앞 세 곳까지만 안내하고, 거기 도착하면 다음 안내 (가운데를 건너뛰지 않게)
        val route = stops.take(MAX_WAYPOINTS + 1)
        val dest = route.last()
        val via = route.dropLast(1)
        runCatching {
            n.requestRouteWithWaypoints(
                RouteWithWaypointsRequest(
                    destination = routeInfo(dest.at, dest.name, dest.id),
                    waypoints = via.mapIndexed { i, p ->
                        RequestWaypointInfo(
                            latitude = p.at.lat,
                            longitude = p.at.lng,
                            poiName = p.name,
                            waypointIndex = if (i == 0) WaypointIndex.FIRST else WaypointIndex.SECOND,
                            poiId = p.id,
                            address = p.name,
                            poiSubId = "0",
                        )
                    },
                ),
            )
            Log.i(TAG, "경유지 경로 요청: ${via.joinToString(" → ") { it.name }} → ${dest.name}")
        }.onFailure {
            Log.w(TAG, "경유지 경로 요청 실패 → 첫 장소만", it)
            requestRouteTo(stops.first())
        }
    }

    /** 고른 장소 한 곳으로 길 안내 요청. */
    fun requestRouteTo(place: Place) = request(place.at, place.name, place.id)

    /** '바로 집으로'. */
    fun requestRouteHome(home: LatLng) = request(home, "집", "home")

    private fun request(at: LatLng, name: String, id: String) {
        val n = navi ?: return
        routeDistanceSent = false
        runCatching { n.requestRoute(routeInfo(at, name, id)) }
            .onFailure { onStatus(SourceStatus(this.name, false, "경로 요청 실패: ${it.message}")) }
    }

    private fun routeInfo(at: LatLng, name: String, id: String) = RouteInfo(
        latitude = at.lat,
        longitude = at.lng,
        poiName = name,
        poiId = id,
        address = name,
        poiSubId = "0",
    )

    override fun stop() {
        runCatching { navi?.removeListener(listener) }
        runCatching { navi?.release() }
        navi = null
    }

    companion object {
        private const val TAG = "NaviSignals"
        /** NaviHelper 3.0.5 경유지 칸 (WaypointIndex FIRST·SECOND). */
        const val MAX_WAYPOINTS = 2
        /** 재탐색 판정: 경로거리가 이만큼(km) 넘게 늘면. */
        const val REROUTE_GROW_KM = 1.0
    }
}
