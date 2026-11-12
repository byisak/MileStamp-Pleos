package kr.milestamp.car.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import kr.milestamp.car.net.CourseJson
import kr.milestamp.car.trip.TripHub
import kr.milestamp.car.trip.TripService
import kr.milestamp.engine.Gear
import kr.milestamp.engine.LatLng
import kr.milestamp.engine.Planner
import kr.milestamp.engine.SeedPlaces
import kr.milestamp.engine.SignalEvent
import kr.milestamp.engine.Sky
import kr.milestamp.engine.hhmm
import org.json.JSONObject

/**
 * 시연·테스트용 입력 (디버그 빌드에만 포함).
 *   adb shell am broadcast -p kr.milestamp.car -a kr.milestamp.DEBUG --es type CLOCK --es now 08:30
 * type: CLOCK(now, day=2026-10-31 — 서버 계획 at= 날짜, 폰과 같은 날 계획을 보려고) · ETA(remain_s, remain_m) · ODO_ADD(km) · ODO(km) · WEATHER(sky=clear|rain, soon=true, rain_from=15:00)
 *       SUN(rise=06:46, set=17:32) — 해 시각 고정 (시연 영상이 날짜와 상관없이 같게)
 *       COURSE(ids=seokgul,samguk,dgsm, by=아빠 폰) — 그 순서의 코스를 '폰에서 고른 코스'로 계획 맨 앞에 끼움 (서버 계획 흉내)
 *       PICK(i, by=폰:엄마) — 지금 계획의 i번째 카드를 폰에서 고른 것처럼 (인터넷 없이 '폰에서 고른 코스' 카드 보기)
 *       PLAN_SYNC — 서버 오늘 계획을 지금 바로 다시 받기 (15초 기다리지 않고, 첫 탑승 계획 화면일 때만)
 *       COURSE_EVENT(json) — 살아 있는 코스 사건, 계획 10절 JSON 그대로 (Departed·Arrived·StillParked·NaviEta·ReplaceNext·Skip·Insert·Weather·PlaceClosed·GoHome·LimitChanged·Remote)
 *                 예) --es json '{"type":"Departed","now":"12:10","from":"samguk"}'  · now가 없으면 지금 시계 · --ez defer true 면 폰 명령처럼 주행 중 보류
 *       ADOPT(i) — 떠 있는 제안 카드 i번째 고르기 ('이걸로')
 *       DEV_BOARD(on=true|false) — 개발자 상태판 (기어·위치·연결·기록), 화면에선 디버그 빌드 로고 길게 누르기
 *       GEAR(g=P|D|R|N) · SPEED(kmh) · REAR(n) · DOOR(open=true|false) · LOC(lat,lng) · CHOOSE(i) · RESET_DAY · SYNC_BEEP
 * 가상 콘솔로도 기어·주행거리·문·좌석을 바꿀 수 있지만, 영상 촬영 때 순서를 정확히 맞추려고 둔다.
 */
class DebugReceiver : BroadcastReceiver() {
    private var odoKm = 0.0

    override fun onReceive(context: Context, intent: Intent) {
        val t = SystemClock.elapsedRealtime()
        val type = intent.getStringExtra("type") ?: return
        when (type) {
            "CLOCK" -> TripService.start(context) {
                putExtra(TripService.EXTRA_CLOCK, intent.getStringExtra("now"))
                intent.getStringExtra("day")?.let { putExtra(TripService.EXTRA_CLOCK_DAY, it) }
            }
            "RESET_DAY" -> TripService.start(context) { putExtra(TripService.EXTRA_RESET, true) }
            "PLAN_SYNC" -> TripService.start(context) { putExtra(TripService.EXTRA_PLAN_SYNC, true) }
            // 개발자 상태판 (화면에선 로고 길게 누르기). on=true|false, 없으면 뒤집기
            "DEV_BOARD" -> TripHub.toggleDevBoard(intent.getStringExtra("on")?.toBooleanStrictOrNull())
            // 낮/밤 화면 고정: --es mode day|night|auto (시연·캡처용)
            "THEME" -> TripHub.setDayNight(when (intent.getStringExtra("mode")) { "day" -> kr.milestamp.car.ui.DayNight.DAY; "night" -> kr.milestamp.car.ui.DayNight.NIGHT; else -> kr.milestamp.car.ui.DayNight.AUTO })
            else -> {
                TripService.start(context)
                val e: SignalEvent? = when (type) {
                    "ETA" -> SignalEvent.Eta(intent.getIntExtra("remain_s", 0), intent.getIntExtra("remain_m", 0), t)
                    "ODO" -> { odoKm = intent.getStringExtra("km")?.toDouble() ?: 0.0; SignalEvent.Odometer(odoKm, t) }
                    "ODO_ADD" -> {
                        val base = TripHub.ui.value.snapshot?.odoKm ?: odoKm
                        odoKm = base + intent.getIntExtra("km", 0)
                        SignalEvent.Odometer(odoKm, t)
                    }
                    "WEATHER" -> SignalEvent.Weather(
                        if (intent.getStringExtra("sky") == "rain") Sky.RAIN else Sky.CLEAR,
                        intent.getStringExtra("soon") == "true", // 곧 비 예보 (3시간 안)
                        t,
                        intent.getStringExtra("rain_from")?.let(::hhmm), // 비 시작 시각을 알면
                    )
                    "SUN" -> SignalEvent.Sun(hhmm(intent.getStringExtra("rise") ?: "06:46"), hhmm(intent.getStringExtra("set") ?: "17:32"), t)
                    "GEAR" -> SignalEvent.GearChanged(when (intent.getStringExtra("g")) { "P" -> Gear.PARK; "D" -> Gear.DRIVE; "R" -> Gear.REVERSE; "N" -> Gear.NEUTRAL; else -> Gear.UNKNOWN }, t)
                    "SPEED" -> SignalEvent.Speed(intent.getStringExtra("kmh")?.toFloat() ?: 0f, t)
                    "REAR" -> SignalEvent.RearSeats(intent.getIntExtra("n", 0), t)
                    "DOOR" -> SignalEvent.DriverDoor(intent.getStringExtra("open") == "true", t)
                    "LOC" -> intent.getStringExtra("ll")?.split(",")?.let { SignalEvent.Location(LatLng(it[0].toDouble(), it[1].toDouble()), t) }
                    "COURSE" -> TripHub.ui.value.plan?.let { plan ->
                        val stops = intent.getStringExtra("ids")?.split(",")?.mapNotNull { SeedPlaces.byId(it.trim()) }.orEmpty()
                        val here = TripHub.ui.value.snapshot?.location ?: SeedPlaces.DEMO_HOME
                        Planner.course(plan.nowMin, here, SeedPlaces.demoProfile(), stops, plan.sky, "폰에서 고른 코스")?.let { opt ->
                            SignalEvent.ServerPlan(plan.copy(options = listOf(opt) + plan.options.take(2)), 0, intent.getStringExtra("by") ?: "아빠 폰", t)
                        }
                    }
                    "PICK" -> TripHub.ui.value.plan?.let { plan ->
                        val i = intent.getIntExtra("i", 0).coerceIn(0, plan.options.lastIndex)
                        SignalEvent.ServerPlan(plan, i, intent.getStringExtra("by") ?: "폰:아빠", t)
                    }
                    "CHOOSE" -> TripHub.ui.value.plan?.options?.getOrNull(intent.getIntExtra("i", 0))?.let { SignalEvent.RouteChosen(it, t) }
                    "ADOPT" -> TripHub.ui.value.proposal?.options?.getOrNull(intent.getIntExtra("i", 0))?.let { SignalEvent.RouteChosen(it, t) }
                    "COURSE_EVENT" -> {
                        // 살아 있는 코스 사건(계획 10절 JSON): now가 없으면 지금 시계. defer=true면 폰 명령처럼 주행 중 보류
                        val ui = TripHub.ui.value
                        val json = runCatching { JSONObject(intent.getStringExtra("json") ?: "{}") }.getOrNull()
                        val event = json?.let { CourseJson.parseEvent(it, ui.snapshot?.nowMin ?: 0, TripHub::placeById, ui.course) }
                        if (event == null) Log.w("MileStamp", "COURSE_EVENT 읽기 실패: ${intent.getStringExtra("json")}")
                        event?.let { SignalEvent.CourseCommand(it, t, deferWhileDriving = intent.getBooleanExtra("defer", false)) }
                    }
                    else -> null
                }
                e?.let(TripHub::send)
            }
        }
    }
}
