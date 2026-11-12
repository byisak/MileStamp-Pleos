package kr.milestamp.car.ui

import android.Manifest
import android.car.Car
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import java.time.LocalDate
import kr.milestamp.engine.SeedPlaces
import kr.milestamp.engine.Sun
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kr.milestamp.car.gleo.GleoActionReceiver
import kr.milestamp.car.net.ServerApi
import kr.milestamp.car.net.StampStore
import kr.milestamp.car.trip.DriveGate
import kr.milestamp.car.trip.PairShown
import kr.milestamp.car.trip.TripHub
import kr.milestamp.car.trip.TripService
import kr.milestamp.engine.CourseEvent
import kr.milestamp.engine.PlanOption
import kr.milestamp.engine.SignalEvent
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private val server by lazy { ServerApi(applicationContext) }
    private var pairJob: Job? = null

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        // 권한을 받은 뒤 서비스에 알려 속도·위치 신호를 다시 붙인다
        TripService.start(this) { putExtra(TripService.EXTRA_PERMS_GRANTED, true) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        TripService.start(this)
        // 실행 중에 사용자 허락이 필요한 권한: 위치, 차 속도(CAR_SPEED). 알림 권한은 쓰지 않음(포그라운드 서비스는 알림 권한 없이도 돈다)
        val missing = RUNTIME_PERMISSIONS.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) askPermissions.launch(missing.toTypedArray())

        // 맨 위 화면에서 뒤로 가기 = 앱 숨김 (종료 금지, Pleos CCP Back 정책)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val s = TripHub.ui.value
                when {
                    s.pair != null -> TripHub.closePair()
                    s.stamp != null || s.held != null || s.summary != null -> TripHub.dismissStamp()
                    s.book -> TripHub.closeBook()
                    s.devBoard -> TripHub.toggleDevBoard()
                    else -> moveTaskToBack(true)
                }
            }
        })

        setContent {
            val ui by TripHub.ui.collectAsStateWithLifecycle()
            // 낮/밤: 차의 밤 모드(시스템) 또는 해 시각 (디버그 시계도 따름). 디버그 입력 THEME으로 고정 가능
            val sky = ui.sky ?: ui.plan?.sky
            // 서버 하늘이 없으면 차 안 계산(NOAA 공식, 대구 기준 — 낮/밤 가르는 데는 충분)
            val sun = remember { Sun.riseSet(SeedPlaces.DEMO_HOME, LocalDate.now()) }
            MileStampTheme(
                mode = ui.dayNight, nowMin = ui.snapshot?.nowMin,
                sunriseMin = sky?.sunriseMin ?: sun?.sunriseMin, sunsetMin = sky?.sunsetMin ?: sun?.sunsetMin,
            ) {
                MileStampScreen(
                    ui = ui,
                    onChoose = ::choose,
                    onDismissStamp = TripHub::dismissStamp,
                    onHide = { moveTaskToBack(true) },
                    onPair = ::openPair,
                    onClosePair = TripHub::closePair,
                    onCourseCommand = ::courseCommand,
                    onDismissProposal = { TripHub.dismissProposal(fromUser = true) },
                    onNavigate = TripHub::navigate,
                    onStoryToPhone = TripHub::storyToPhone,
                    onOpenBook = ::openBook,
                    onCloseBook = TripHub::closeBook,
                )
            }
        }
        // 도장 획득 화면의 '모은 도장' 수를 맞추려고 켤 때 한 번 받아 둔다 (안 되면 저장본)
        lifecycleScope.launch { StampStore.refresh(server) }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** 글레오 "스탬프북 보여줘" (schema.json OPEN_STAMP_BOOK, component=activity). 주행 중이면 열지 않고 말로만. */
    private fun handleIntent(intent: Intent?) {
        if (intent?.action != GleoActionReceiver.ACTION_STAMP_BOOK) return
        setIntent(Intent(this, MainActivity::class.java)) // 화면을 다시 만들 때 또 열리지 않게
        val action = GleoActionReceiver.ACTION_STAMP_BOOK
        if (!DriveGate.parked(TripHub.ui.value.snapshot)) {
            GleoActionReceiver.respond(this, action, "fail", "The stamp book opens when the car is parked.")
            return
        }
        openBook()
        val rows = StampStore.rows.value
        GleoActionReceiver.respond(
            this, action, "success",
            "Opening the stamp book: ${StampAlbum.gotCount(rows)} of ${StampAlbum.ALL.size} stamps collected.",
            JSONArray().put(JSONObject().put("collected", StampAlbum.gotCount(rows)).put("total", StampAlbum.ALL.size).put("times", rows.size)).toString(),
            mode = "silent",
        )
    }

    /** 도장북 열기 + 서버에서 새로 받기 (안 되면 저장본 + 차 기록). */
    private fun openBook() {
        TripHub.openBook()
        lifecycleScope.launch { StampStore.refresh(server) }
    }

    /** '폰 연결': QR을 받아 보여 주고, 화면이 떠 있는 동안 3초마다 연결된 폰을 확인. */
    private fun openPair() {
        pairJob?.cancel()
        pairJob = lifecycleScope.launch {
            TripHub.update { it.copy(pair = PairShown()) }
            val p = server.pair()
            if (p == null) {
                TripHub.update { it.copy(pair = PairShown(error = "서버에 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.")) }
                return@launch
            }
            TripHub.update { it.copy(pair = PairShown(p.url, p.code)) }
            while (TripHub.ui.value.pair != null) {
                server.phones()?.let { phones -> TripHub.update { s -> s.copy(pair = s.pair?.copy(phones = phones)) } }
                delay(3_000)
            }
        }
    }

    /** 추천 카드·제안 카드('이걸로') 모두 같은 신호 — 제안이면 엔진이 코스를 그대로 바꾼다. */
    private fun choose(option: PlanOption) {
        TripHub.send(SignalEvent.RouteChosen(option, SystemClock.elapsedRealtime()))
    }

    /** 코스 화면의 차 버튼(다음 건너뛰기 · 지금 집으로): 바로 적용 (주행 중 보류는 폰 명령만). */
    private fun courseCommand(event: CourseEvent) {
        TripHub.send(SignalEvent.CourseCommand(event, SystemClock.elapsedRealtime(), deferWhileDriving = false))
    }

    companion object {
        private val RUNTIME_PERMISSIONS = listOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Car.PERMISSION_SPEED,
        )
    }
}
