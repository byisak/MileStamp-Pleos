package kr.milestamp.phone.auto

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.connection.CarConnection
import androidx.car.app.hardware.CarHardwareManager
import androidx.car.app.hardware.common.CarValue
import androidx.car.app.hardware.common.OnCarDataAvailableListener
import androidx.car.app.hardware.info.Mileage
import androidx.car.app.hardware.info.Speed
import androidx.core.content.ContextCompat
import androidx.lifecycle.Observer
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.Place
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 앱 프로세스 하나에 하나: 판정 어댑터 + 신호(연결·속도·주행거리·GPS) + 서버.
 * 안드로이드 오토 세션(화면)이 있든 없든 연결 신호는 여기로 모인다.
 *  - 탑승/하차: [CarConnection] 투사 연결(앱 프로세스가 살아 있을 때) + 세션 생성/종료 (둘 중 먼저 온 것)
 *  - 속도·주행거리: 세션이 있을 때 [CarHardwareManager] (지원 차만, 안 되면 GPS 속도)
 *  - GPS: 폰 LocationManager (연결돼 있는 동안만)
 */
@SuppressLint("StaticFieldLeak") // 앱 컨텍스트만 붙든다
object AutoRuntime {
    private const val TAG = "MilestampAuto"
    private const val TICK_MS = 5_000L

    private lateinit var app: Context
    lateinit var cfg: AutoConfig; private set
    lateinit var api: AutoApi; private set
    val io = Executors.newSingleThreadExecutor { Thread(it, "milestamp-auto-io") }
    private val main = Handler(Looper.getMainLooper())

    @Volatile var catalog: List<CatalogEntry> = emptyList(); private set
    @Volatile private var places: List<Place> = emptyList()
    /** 오늘 코스의 바깥 장소(ext:…, 명소 목록 밖) — 도착 원(300m) 판정용. 코스를 받을 때마다 바꾼다 */
    @Volatile private var courseExt: List<Place> = emptyList()
    /** 오늘 코스 곳의 이름 (목록에 없는 곳 이름 보이기) */
    @Volatile private var courseNames: Map<String, String> = emptyMap()
    lateinit var detector: AutoTripDetector; private set

    /** 차 화면에 알릴 것 (지금 세션이 있으면 받는다) */
    interface Listener {
        /** 정차 중: 메달 화면(안내 문단 + 합성 그림) */
        fun onMedalShow(m: ReadyMedal)
        /** 주행 중: 알림 한 줄만 (메달은 멈추면) */
        fun onMedalAlert(m: ReadyMedal)
        fun onToast(text: String)
    }

    /** 메달을 언제 크게 보여 줄지 (주행 중이면 미룸) */
    val medals = MedalPresenter<ReadyMedal>()
    private var sound: MedalSound? = null
    @Volatile var listener: Listener? = null

    @Volatile var connected = false; private set
    private var sessionCount = 0
    private var projected = false
    private var watching = false
    private var locating = false
    private var hardwareCtx: CarContext? = null
    @Volatile var hasHardwareSpeed = false; private set
    @Volatile var hasMileage = false; private set

    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        AutoRuntimeFiles.cacheDir = app.cacheDir
        cfg = AutoConfig(app)
        AutoJson.hour12 = cfg.hour12
        api = AutoApi(app, cfg)
        detector = AutoTripDetector({ places + courseExt }, { cfg.stampedToday(it) })
        io.execute { loadCatalog() }
    }

    fun loadCatalog() {
        val c = runCatching { api.catalog() }.getOrDefault(emptyList())
        if (c.isNotEmpty()) setCatalog(c)
    }

    /** 시험·미리 받은 목록 넣기. 도장 판정 장소 = 명소 + 오늘 열리는 축제 */
    fun setCatalog(c: List<CatalogEntry>) {
        catalog = c
        val day = today()
        places = c.filter { it.festival?.runsOn(day) ?: true }.map { it.toPlace() }
    }

    fun catalogEntry(id: String) = catalog.firstOrNull { it.id == id }
    /** 곳 이름: 명소 목록 → 코스에 실려 온 이름 → (바깥 장소면) '고른 곳' (엔진 stopName — 날 id를 보이지 않는다) */
    fun placeName(id: String) = catalogEntry(id)?.name ?: kr.milestamp.engine.stopName(id, courseNames[id])
    /** 코스 곳 이름: 명소 목록 → 서버가 실은 이름 → 전에 받은 코스 이름 → '고른 곳' */
    fun stopName(s: AutoCourseStop) = catalogEntry(s.placeId)?.name ?: kr.milestamp.engine.stopName(s.placeId, s.name ?: courseNames[s.placeId])

    /** 코스를 받았음 (화면·도착 뒤): 바깥 장소를 도착 판정에 넣고 이름을 기억한다 */
    fun noteCourse(c: AutoCourse?) {
        if (c == null) return
        courseExt = c.stops.filter { it.isExt }.mapNotNull { it.toExtPlace() }
        courseNames = c.stops.mapNotNull { s -> s.name?.let { s.placeId to it } }.toMap()
    }
    val albumTotal get() = catalog.count { it.inAlbum }.takeIf { it > 0 } ?: 34

    // ------------------------------------------------------------ 연결

    /** CarConnection(투사 연결)을 앱이 살아 있는 동안 지켜본다. 메인 스레드에서 */
    fun watchConnection() {
        main.post {
            if (watching) return@post
            watching = true
            runCatching {
                CarConnection(app).type.observeForever(Observer { type ->
                    projected = type == CarConnection.CONNECTION_TYPE_PROJECTION
                    updateConnected("CarConnection=$type")
                })
            }.onFailure { Log.w(TAG, "CarConnection 못 씀: ${it.message}") }
        }
    }

    fun sessionStarted(carContext: CarContext) {
        sessionCount++
        hardwareCtx = carContext
        if (sound == null) sound = runCatching { MedalSound(app) }.onFailure { Log.w(TAG, "소리 준비 실패: ${it.message}") }.getOrNull()
        startHardware(carContext)
        updateConnected("session")
    }

    /** 차 화면이 보임 (세션 시작·재개): 미뤄 둔 메달이 있으면 */
    fun sessionResumed() {
        medals.resumed(SystemClock.elapsedRealtime())?.let(::deliver)
    }

    fun sessionEnded() {
        sessionCount = (sessionCount - 1).coerceAtLeast(0)
        stopHardware()
        hardwareCtx = null
        updateConnected("session end")
    }

    private fun updateConnected(why: String) {
        val now = projected || sessionCount > 0
        if (now == connected) return
        connected = now
        Log.i(TAG, "연결 ${if (now) "됨" else "끊김"} ($why)")
        val at = SystemClock.elapsedRealtime()
        if (now) {
            handle(detector.connected(at))
            startLocation()
            main.postDelayed(ticker, TICK_MS)
            // 가족 낮잠(쉿 모드 자동)도 연결될 때마다 새로
            io.execute {
                if (catalog.isEmpty()) loadCatalog(); runCatching { api.refreshFamily() }; api.flushPending()
                // 오늘 코스의 바깥 장소도 도착 판정에 (화면을 안 열어도)
                runCatching { noteCourse(api.course()) }
            }
        } else {
            // 끊기기 직전 위치로 도착 원 판정 (주차 후 시동 끔)
            lastKnown()?.let { detector.location(LatLng(it.latitude, it.longitude), it.accuracy, at) }
            handle(detector.disconnected(at))
            medals.disconnected()
            stopLocation()
            main.removeCallbacks(ticker)
        }
    }

    private val ticker = object : Runnable {
        override fun run() {
            val now = SystemClock.elapsedRealtime()
            handle(detector.tick(now))
            medals.tick(now)?.let(::deliver)
            if (connected) main.postDelayed(this, TICK_MS)
        }
    }

    // ------------------------------------------------------------ 결과 처리

    private fun handle(outs: List<AutoTripDetector.Out>) {
        for (o in outs) when (o) {
            is AutoTripDetector.Out.Stamp -> onAttempt(o.attempt)
            is AutoTripDetector.Out.Parked -> if (o.place == null) Log.i(TAG, "3분 정차 (도장 장소 밖)")
            else -> Log.i(TAG, "판정: $o")
        }
    }

    private fun onAttempt(a: AutoTripDetector.Attempt) {
        // 쉿 모드는 도장 때마다 폰 시계로 다시 계산 (자동이면 낮잠 20분 전 ~ 끝)
        val quiet = cfg.quiet
        if (a.place.id.startsWith("ext:")) { onVisit(a, quiet); return }
        Log.i(TAG, "도장 시도 ${a.place.id} ${a.verdict} 출처=${a.source} 궤적=${"%.2f".format(a.gpsPathKm)}km")
        if (!a.granted) {
            val why = (a.verdict as? kr.milestamp.engine.StampVerdict.Held)?.detail ?: ""
            main.post { listener?.onToast("도장 보류 · ${a.place.name} · $why") }
            io.execute { api.arrive(a, quiet) } // 보류도 서버에 남긴다 (서버가 판정)
            return
        }
        cfg.markStamped(a.place.id)
        io.execute {
            val reply = api.arrive(a, quiet)
            val stamps = api.stamps()
            // 코스에도 '도착'을 알린다 (폰과 같이 driving:false) → 다음 갈 곳·귀가를 메달 화면에
            val course = runCatching {
                api.course()?.let { c -> api.courseEvent(c.version, JSONObject().put("type", "Arrived").put("now", nowHhmm()).put("place", a.place.id))?.course ?: c }
            }.getOrNull()
            val info = MedalFacts.build(a.place.id, a.place.name, catalog, reply, stamps, course, quiet, a.source, albumTotal)
            val m = prepare(info)
            main.post { stamped(m) }
        }
    }

    /**
     * 도장 없는 바깥 장소(ext:…) 도착: 메달·소리 없이 알림 한 줄 '해운대해수욕장 다녀옴 · 기록했어요'.
     * 서버 /api/phone/arrive가 '다녀온 곳'에 적고(검증 없음), 코스에도 도착을 알린다. 하루 한 곳 한 번.
     */
    private fun onVisit(a: AutoTripDetector.Attempt, quiet: Boolean) {
        if (cfg.stampedToday(a.place.id)) return
        cfg.markStamped(a.place.id)
        Log.i(TAG, "다녀옴 ${a.place.id} ${a.place.name}")
        main.post { listener?.onToast("${a.place.name} 다녀옴 · 기록했어요") }
        io.execute {
            api.arrive(a, quiet)
            runCatching {
                api.course()?.let { c -> api.courseEvent(c.version, JSONObject().put("type", "Arrived").put("now", nowHhmm()).put("place", a.place.id))?.course ?: c }
            }.getOrNull()?.let(::noteCourse)
        }
    }

    /** 메달 그림 합성 (일꾼 스레드): 도장 그림 받기 → 720 합성 → 차 크기 */
    fun prepare(info: MedalInfo): ReadyMedal {
        val entry = catalogEntry(info.placeId)
        val art = runCatching { MedalArt.load(java.io.File(app.filesDir, "auto-medal-art"), cfg.server, info.key, entry, api::download) }.getOrNull()
        val full = runCatching { MedalComposer.compose(info, art ?: MedalComposer.fallbackArt(), MedalFonts.load(app)) }
            .onFailure { Log.w(TAG, "메달 합성 실패: ${it.message}") }.getOrNull()
        val icon = (art ?: MedalComposer.fallbackArt(256)).let { Bitmap.createScaledBitmap(it, 160, 160, true) }
        return ReadyMedal(info, full?.let { MedalComposer.forCar(it) }, icon)
    }

    /** 도장 직후 (메인): 소리는 바로(쉿 모드면 없음), 화면은 주행 중이면 알림 한 줄만 */
    private fun stamped(m: ReadyMedal) {
        if (connected) sound?.play(m.info)
        val now = SystemClock.elapsedRealtime()
        // 차 화면이 없거나(연결 끊고 내림) 끊기는 중이면 쥐고 있다가 다음 연결에서
        if (listener == null || !connected) { medals.hold(m, now); return }
        deliver(medals.stamp(m, now))
    }

    private fun deliver(a: MedalPresenter.Action<ReadyMedal>) {
        val l = listener
        when (a) {
            is MedalPresenter.Action.Alert -> l?.onMedalAlert(a.medal)
            is MedalPresenter.Action.Show -> if (l != null) l.onMedalShow(a.medal) else medals.hold(a.medal, SystemClock.elapsedRealtime())
        }
    }

    /** 속도 (km/h): 판정 어댑터 + 메달 미루기 */
    private fun onSpeed(kmh: Float, at: Long) {
        handle(detector.speed(kmh, at))
        medals.speed(kmh, at)?.let(::deliver)
    }

    fun nowHhmm(): String = java.util.Calendar.getInstance().let { AutoJson.hhmm(it.get(java.util.Calendar.HOUR_OF_DAY) * 60 + it.get(java.util.Calendar.MINUTE)) }

    // ------------------------------------------------------------ 차량 신호 (지원 차만)

    private val speedListener = OnCarDataAvailableListener<Speed> { s ->
        val v = s.rawSpeedMetersPerSecond
        if (v.status == CarValue.STATUS_SUCCESS && v.value != null) {
            hasHardwareSpeed = true
            onSpeed(v.value!! * 3.6f, SystemClock.elapsedRealtime())
        }
    }
    private val mileageListener = OnCarDataAvailableListener<Mileage> { m ->
        val v = m.odometerMeters
        if (v.status == CarValue.STATUS_SUCCESS && v.value != null) {
            hasMileage = true
            detector.mileage(v.value!!.toDouble() / 1000.0)
        }
    }

    private fun startHardware(cc: CarContext) {
        if (apiLevel(cc) < 3) return
        runCatching {
            val info = cc.getCarService(CarHardwareManager::class.java).carInfo
            val ex = ContextCompat.getMainExecutor(app)
            runCatching { info.addSpeedListener(ex, speedListener) }.onFailure { Log.i(TAG, "속도 신호 없음: ${it.message}") }
            runCatching { info.addMileageListener(ex, mileageListener) }.onFailure { Log.i(TAG, "주행거리 신호 없음: ${it.message}") }
        }.onFailure { Log.i(TAG, "차량 신호 못 씀: ${it.message}") }
    }

    private fun stopHardware() {
        val cc = hardwareCtx ?: return
        runCatching {
            val info = cc.getCarService(CarHardwareManager::class.java).carInfo
            runCatching { info.removeSpeedListener(speedListener) }
            runCatching { info.removeMileageListener(mileageListener) }
        }
    }

    // ------------------------------------------------------------ GPS (폰)

    private val locListener = LocationListener { l -> onLocation(l) }

    private fun onLocation(l: Location) {
        val at = SystemClock.elapsedRealtime()
        handle(detector.location(LatLng(l.latitude, l.longitude), if (l.hasAccuracy()) l.accuracy else 30f, at))
        // 차 속도 신호가 없으면 GPS 속도로
        if (!hasHardwareSpeed && l.hasSpeed()) onSpeed(l.speed * 3.6f, at)
    }

    private fun granted() = ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    private fun startLocation() {
        if (locating || !granted()) return
        val lm = app.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        runCatching {
            for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (lm.allProviders.contains(p)) lm.requestLocationUpdates(p, 2_000L, 0f, locListener, Looper.getMainLooper())
            }
            locating = true
            lastKnown()?.let(::onLocation)
        }.onFailure { Log.w(TAG, "위치 못 씀: ${it.message}") }
    }

    private fun stopLocation() {
        if (!locating) return
        runCatching { (app.getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(locListener) }
        locating = false
    }

    @SuppressLint("MissingPermission")
    fun lastKnown(): Location? {
        if (!::app.isInitialized || !granted()) return null
        val lm = app.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
    }

    /** 폰 앱(JS)에서 보는 상태 */
    fun status(): Map<String, Any?> = mapOf(
        "connected" to connected,
        "phase" to detector.phase.name,
        "gpsPathKm" to detector.gpsPathKm,
        "hardwareSpeed" to hasHardwareSpeed,
        "mileage" to hasMileage,
        "pending" to cfg.pending().length(),
        "lastAttempt" to detector.lastAttempt?.let { "${it.place.id}:${if (it.granted) "granted" else "held"}:${it.source}" },
        "hasToken" to api.hasToken,
        "quiet" to cfg.quiet,
        "quietMode" to cfg.quietMode.key,
        "napStart" to cfg.napStart,
        "napLen" to cfg.napLen,
        "timeFmt" to if (cfg.hour12) "12" else "24",
        "pendingMedal" to medals.pending?.info?.name,
    )
}
