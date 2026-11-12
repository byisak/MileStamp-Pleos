package kr.milestamp.car.gleo

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 글레오 schema.json 심사 규칙 (Pleos App Schema Writing Guide):
 * 음성 함수는 최대 3개, component는 activity(startActivity) 또는 service(sendBroadcast).
 * 선언한 함수마다 매니페스트가 실제로 받는지도 본다 (service = 리시버 액션, activity = 액티비티 인텐트 필터).
 */
class GleoSchemaTest {
    private val main = File("src/main").takeIf { it.exists() } ?: File("app/src/main")
    private val schema = JSONObject(File(main, "assets/schema.json").readText())
    private val manifest = File(main, "AndroidManifest.xml").readText()

    @Test fun 음성_함수는_3개까지() {
        val calls = schema.getJSONArray("actionCalls")
        assertTrue("함수 ${calls.length()}개 — Pleos는 최대 3개", calls.length() <= 3)
        assertEquals("kr.milestamp.car", schema.getString("packageName"))
        for (k in listOf("appDescription", "version")) assertTrue(k, schema.optString(k).isNotBlank())
    }

    @Test fun 선언한_함수는_모두_받는_곳이_있다() {
        val calls = schema.getJSONArray("actionCalls")
        val names = (0 until calls.length()).map { calls.getJSONObject(it).getJSONObject("function") }
        assertEquals(
            setOf(GleoActionReceiver.ACTION_RECOMMEND, GleoActionReceiver.ACTION_STORY, GleoActionReceiver.ACTION_STAMP_BOOK),
            names.map { it.getString("name") }.toSet(),
        )
        for (f in names) {
            val comp = f.optString("component", "activity")
            assertTrue(comp, comp == "service" || comp == "activity")
            assertTrue("${f.getString("name")} 이(가) 매니페스트에 없음", manifest.contains("<action android:name=\"${f.getString("name")}\""))
            assertTrue(f.getJSONObject("parameters").getString("type") == "object")
        }
        // 스키마에서 뺀 함수는 매니페스트에도 남기지 않는다
        for (gone in listOf("CHANGE_NEXT_PLACE", "SKIP_NEXT_PLACE", "GO_HOME_NOW")) assertTrue(gone, !manifest.contains("\"$gone\""))
    }
}
