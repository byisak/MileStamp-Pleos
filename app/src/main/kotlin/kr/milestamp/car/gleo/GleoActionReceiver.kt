package kr.milestamp.car.gleo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kr.milestamp.car.trip.TripHub
import kr.milestamp.car.trip.TripService
import kr.milestamp.engine.CourseEvent
import kr.milestamp.engine.LiveCourse
import kr.milestamp.engine.SignalEvent
import kr.milestamp.engine.asHhmm
import org.json.JSONArray
import org.json.JSONObject

/**
 * 글레오 음성 명령 (assets/schema.json, component=service → sendBroadcast).
 * 7초 안에 결과(Callback)를 돌려줘야 한다. 메시지는 영어 문장, 데이터에는 한글 장소명 가능.
 *
 * 살아 있는 코스 명령(docs/코스-고도화-계획.md 6절): CHANGE_NEXT_PLACE(place) · SKIP_NEXT_PLACE · GO_HOME_NOW →
 * `SignalEvent.CourseCommand`(바로 적용, 주행 중에도) → 엔진이 코스를 바꾸면 그 변경 칩 글로 답한다 (최대 3초 기다림).
 */
class GleoActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val param = runCatching { JSONObject(intent.getStringExtra("ACTION_PARAM")?.trim('"') ?: "{}") }.getOrDefault(JSONObject())
        TripService.start(context)
        val ui = TripHub.ui.value
        when (action) {
            ACTION_RECOMMEND -> {
                val course = ui.course
                val plan = ui.plan
                val pick = plan?.chosenOption ?: plan?.best
                if (plan != null && pick != null) {
                    // 정차 중 계획 화면: 폰에서 고른 코스가 있으면 그것, 없으면 1순위. 화면에 이미 있는 값이라 바로 답함(7초 제한).
                    val places = pick.stops.map { it.name }
                    val depart = pick.legs.firstOrNull()?.fromMin ?: plan.nowMin
                    val data = JSONArray().put(
                        JSONObject()
                            .put("place", places.firstOrNull() ?: "home")
                            .put("places", JSONArray(places))
                            .put("label", pick.label)
                            .put("chosenByPhone", plan.chosen != null)
                            .put("travelMinutes", pick.firstLegMin)
                            .put("depart", depart.asHhmm())
                            .put("arriveHome", pick.arriveHomeMin.asHhmm())
                            .put("reasons", JSONArray(pick.reasons.take(3).map { it.text }))
                            .put("preference", param.optString("preference", "any"))
                            .put("evening", plan.evening)
                    )
                    val what = if (places.isEmpty()) "going straight home" else "${places.size} place(s)"
                    val msg = (if (plan.chosen != null) "The course picked on the family phone: " else if (plan.evening) "An evening outing idea: " else "Today's best plan: ") +
                        "$what, leaving at ${depart.asHhmm()} and back home by ${pick.arriveHomeMin.asHhmm()}."
                    respond(context, action, "success", msg, data.toString())
                } else if (course != null) {
                    // 살아 있는 코스: 다음 목적지·남은 순서·귀가 예정 (제안 카드가 떠 있으면 '한 곳 더' 등도 같이)
                    val next = course.next
                    val remaining = course.remainingPlaces.map { it.name }
                    val data = JSONArray().put(
                        JSONObject()
                            .put("place", next?.place?.name ?: "home")
                            .put("places", JSONArray(remaining))
                            .put("arrive", next?.plannedArriveMin?.asHhmm() ?: JSONObject.NULL)
                            .put("arriveHome", course.arriveHomeMin.asHhmm())
                            .put("slackMinutes", course.slackMin)
                            .put("proposals", JSONArray(ui.proposal?.options?.map { it.label }.orEmpty()))
                            .put("preference", param.optString("preference", "any"))
                    )
                    val msg = if (next == null) "No more stops today; heading home, arriving around ${course.arriveHomeMin.asHhmm()}."
                    else "Next is ${next.place.name}, arriving around ${next.plannedArriveMin.asHhmm()}, and back home by ${course.arriveHomeMin.asHhmm()}" +
                        (ui.proposal?.options?.firstOrNull()?.let { ". There is also an option: ${it.label}." } ?: ".")
                    respond(context, action, "success", msg, data.toString())
                } else {
                    respond(context, action, "asking", "A recommendation is shown when the car is parked. Please park first.")
                }
            }
            ACTION_STORY -> {
                val next = ui.snapshot?.nextStop
                if (next == null) {
                    respond(context, action, "fail", "There is no destination to tell a story about yet.")
                } else {
                    // 실제 재생은 엔진의 소개 흐름을 탄다 (2주차: 즉시 재생 명령 추가)
                    respond(context, action, "success", "Playing the story about the destination.",
                        JSONArray().put(JSONObject().put("place", next).put("audience", param.optString("audience", "family"))).toString(),
                        mode = "silent")
                }
            }
            ACTION_CHANGE_NEXT, ACTION_SKIP_NEXT, ACTION_GO_HOME -> {
                val course = ui.course
                if (course == null) {
                    respond(context, action, "fail", "There is no course today yet. Pick a course first when the car is parked.")
                    return
                }
                val now = ui.snapshot?.nowMin ?: course.nowMin
                val event: CourseEvent? = when (action) {
                    ACTION_CHANGE_NEXT -> {
                        val query = param.optString("place")
                        val place = TripHub.findPlace(query)
                        when {
                            place == null -> { respond(context, action, "fail", "I couldn't find a place called \"$query\"."); return }
                            course.next?.id == place.id -> { respond(context, action, "success", "${place.name} is already the next stop."); return }
                            else -> CourseEvent.ReplaceNext(now, place.id)
                        }
                    }
                    ACTION_SKIP_NEXT -> course.next?.let { CourseEvent.Skip(now, it.id) }
                    else -> CourseEvent.GoHome(now)
                }
                if (event == null) { respond(context, action, "fail", "There is no next stop to skip."); return }
                // 명령을 넣고 엔진이 코스를 바꿀 때까지(버전 +1) 최대 3초 기다려 변경 칩 글로 답한다 (7초 제한 안)
                val pending = goAsync()
                val before = course.version
                CoroutineScope(Dispatchers.Default).launch {
                    TripHub.send(SignalEvent.CourseCommand(event, SystemClock.elapsedRealtime(), deferWhileDriving = false))
                    val after = withTimeoutOrNull(3_000) { TripHub.ui.first { it.course == null || it.course.version != before }.course }
                    try {
                        val text = after?.lastChange?.text
                        val data = JSONArray().put(
                            JSONObject().put("chip", text ?: JSONObject.NULL)
                                .put("places", JSONArray(after?.remainingPlaces?.map { it.name }.orEmpty()))
                                .put("arriveHome", (after ?: course).arriveHomeMin.asHhmm())
                        )
                        respond(context, action, if (after != null) "success" else "fail", message(action, after, text), data.toString())
                    } finally { pending.finish() }
                }
            }
        }
    }

    private fun message(action: String, after: LiveCourse?, chip: String?): String {
        if (after == null) return "The course did not change. Please try again when the car is parked."
        val home = "Home by ${after.arriveHomeMin.asHhmm()}."
        return when (action) {
            ACTION_GO_HOME -> "Heading home now. $home"
            ACTION_SKIP_NEXT -> "Skipped. " + (after.next?.let { "Next is ${it.place.name}. " } ?: "") + home
            else -> "Changed. " + (after.next?.let { "Next is ${it.place.name}. " } ?: "") + home
        } + (chip?.let { " ($it)" } ?: "")
    }

    companion object {
        const val ACTION_RECOMMEND = "RECOMMEND_NEXT_PLACE"
        const val ACTION_STORY = "PLAY_PLACE_STORY"
        const val ACTION_STAMP_BOOK = "OPEN_STAMP_BOOK"
        const val ACTION_CHANGE_NEXT = "CHANGE_NEXT_PLACE"
        const val ACTION_SKIP_NEXT = "SKIP_NEXT_PLACE"
        const val ACTION_GO_HOME = "GO_HOME_NOW"
        private const val RESPONSE = "ai.pleos.playground.intent.action.APP_ACTION_RESPONSE"

        fun respond(context: Context, functionName: String, status: String, message: String, data: String? = null, mode: String? = null) {
            val json = JSONObject().put("functionName", functionName).put("status", status).put("message", message)
            data?.let { json.put("data", it) }
            mode?.let { json.put("mode", it) }
            context.sendBroadcast(Intent(RESPONSE).putExtra("packageName", context.packageName).putExtra("response", json.toString()))
        }
    }
}
