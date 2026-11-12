package kr.milestamp.phone.auto

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.SoundPool
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * 도장 소리: '쾅'(0.3초) → 축하음(종류마다 다른 음, 약 0.7초) → 음성 한 문장. 쉿 모드면 아무 소리도 내지 않는다.
 * 길 안내 음성과 같은 통로(USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)로 내고, 잠깐 소리 초점(덕킹)을 받아
 * 안드로이드 오토로 길 안내·음악 중에도 차 스피커로 나온다 (음악은 잠깐 작아졌다 돌아온다).
 * 음성은 지금은 안드로이드 TTS(ko-KR).
 * TODO: 소개 음성과 같은 하윤 목소리로 미리 만든 문장(phone/assets/intro 처럼)으로 바꾸기 — 종류·번호별 클립 묶음
 */
class MedalSound(context: Context) {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    private val speechAttrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    private val pool = SoundPool.Builder().setMaxStreams(2).setAudioAttributes(attrs).build()
    private val thud = pool.load(app, R.raw.medal_thud, 1)
    private val chimes = mapOf(
        MedalKind.NORMAL to pool.load(app, R.raw.medal_chime_normal, 1),
        MedalKind.RARE to pool.load(app, R.raw.medal_chime_rare, 1),
        MedalKind.FESTIVAL to pool.load(app, R.raw.medal_chime_festival, 1),
        MedalKind.AGAIN to pool.load(app, R.raw.medal_chime_again, 1),
    )
    private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false
    private var waitingLine: String? = null
    private var focus: AudioFocusRequest? = null
    private val focusListener = AudioManager.OnAudioFocusChangeListener { }

    init {
        tts = TextToSpeech(app) { st ->
            ttsReady = st == TextToSpeech.SUCCESS && tts?.let { t ->
                t.setAudioAttributes(speechAttrs)
                t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String?) {}
                    override fun onDone(id: String?) { main.post { release() } }
                    @Deprecated("old") override fun onError(id: String?) { main.post { release() } }
                })
                t.setLanguage(Locale.KOREAN) >= TextToSpeech.LANG_AVAILABLE
            } == true
            if (!ttsReady) Log.w(TAG, "한국어 음성(TTS)을 못 씀 — 쾅·축하음만")
            waitingLine?.let { line -> waitingLine = null; main.post { speak(line) } }
        }
    }

    /** 메달 소리 한 번. 메인 스레드에서 */
    fun play(m: MedalInfo) {
        if (m.quiet) return // 쉿 모드: 소리 없음
        grab()
        pool.play(thud, 1f, 1f, 1, 0, 1f)
        main.postDelayed({ chimes[m.kind]?.let { pool.play(it, .9f, .9f, 1, 0, 1f) } }, CHIME_AT_MS)
        val line = m.voice
        main.postDelayed({ if (line != null) speak(line) else release() }, VOICE_AT_MS)
    }

    private fun speak(line: String) {
        val t = tts
        if (t == null || !ttsReady) {
            if (t != null && waitingLine == null) { waitingLine = line; main.postDelayed({ if (waitingLine == line) { waitingLine = null; release() } }, 4_000) }
            else release()
            return
        }
        // 통로는 setAudioAttributes(길 안내)로 — 여기서 stream을 주면 그것이 덮어쓴다
        t.speak(line, TextToSpeech.QUEUE_FLUSH, Bundle(), "medal-${System.currentTimeMillis()}")
    }

    /** 잠깐 소리 초점 (다른 소리는 작게) */
    @Suppress("DEPRECATION")
    private fun grab() {
        if (Build.VERSION.SDK_INT >= 26) {
            val f = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attrs).setOnAudioFocusChangeListener(focusListener).build()
            focus = f
            am.requestAudioFocus(f)
        } else {
            am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        }
        // 음성이 끝났다는 소식이 안 와도 8초 뒤에는 돌려준다
        main.removeCallbacks(releaseLater)
        main.postDelayed(releaseLater, 8_000)
    }

    private val releaseLater = Runnable { release() }

    @Suppress("DEPRECATION")
    private fun release() {
        main.removeCallbacks(releaseLater)
        if (Build.VERSION.SDK_INT >= 26) focus?.let { am.abandonAudioFocusRequest(it) } else am.abandonAudioFocus(focusListener)
        focus = null
    }

    fun shutdown() {
        release()
        runCatching { tts?.shutdown() }
        pool.release()
    }

    companion object {
        private const val TAG = "MilestampAuto"
        const val CHIME_AT_MS = 350L
        const val VOICE_AT_MS = 1_100L
    }
}
