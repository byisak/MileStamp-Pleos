package kr.milestamp.car.audio

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes as SysAudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kr.milestamp.engine.IntroVariant
import kr.milestamp.engine.Place

/**
 * 도착 전 소개 음성.
 * 1순위: 서버에서 미리 만든 MP3 (앞 0.15~0.2초 무음 포함) — Pleos TTS SDK가 '준비 중'이라 의존하지 않음.
 *        미디어로 재생하므로 운전석 화면 음악 칸에 "제목 · 마일스탬프"로 표시되고, 폰에서도 같은 파일로 이어 듣는다.
 * 예비: 안드로이드 기본 음성 합성 (없으면 조용히 건너뜀).
 * 소리 우선순위: ExoPlayer가 오디오 포커스를 관리 → 내비 안내는 겹쳐 나오고(줄임), 글레오·전화가 오면 멈춘다.
 */
@OptIn(UnstableApi::class)
class IntroAudio(private val context: Context, private val onFinished: (placeId: String) -> Unit) {

    private val main = Handler(Looper.getMainLooper())
    private var currentPlaceId: String? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val audioManager = context.getSystemService(AudioManager::class.java)
    /** 음성 합성(예비 경로)용 오디오 포커스. MP3는 ExoPlayer가 포커스를 직접 다룬다. */
    private val ttsAttrs = SysAudioAttributes.Builder()
        .setUsage(SysAudioAttributes.USAGE_MEDIA).setContentType(SysAudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val ttsFocus: AudioFocusRequest? = if (android.os.Build.VERSION.SDK_INT >= 26)
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(ttsAttrs)
            // 글레오·전화가 오면(포커스 잃음) 바로 멈춘다
            .setOnAudioFocusChangeListener { change -> if (change < 0) main.post { tts?.stop(); releaseTtsFocus() } }
            .build() else null

    private val player: ExoPlayer by lazy {
        IntroPlayerHolder.get(context).also { p ->
            p.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED) finish()
                }
            })
        }
    }

    init {
        main.post {
            tts = TextToSpeech(context) { status ->
                val lang = tts?.setLanguage(Locale.KOREAN)
                ttsReady = status == TextToSpeech.SUCCESS && lang != null && lang >= TextToSpeech.LANG_AVAILABLE
                Log.i(TAG, "음성 합성 준비: status=$status 한국어=$lang 엔진=${tts?.defaultEngine}")
            }.also {
                it.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String?) = Unit
                    override fun onDone(id: String?) {
                        if (id?.startsWith(PRE) == true) return
                        main.post { releaseTtsFocus(); if (id?.startsWith("intro:") == true) finish() }
                    }
                    @Deprecated("Deprecated in Java") override fun onError(id: String?) {
                        if (id?.startsWith(PRE) == true) return
                        main.post { releaseTtsFocus(); if (id?.startsWith("intro:") == true) finish() }
                    }
                })
                it.setAudioAttributes(ttsAttrs)
            }
        }
    }

    fun play(place: Place, variant: IntroVariant) = main.post {
        currentPlaceId = place.id
        val asset = "intro/${place.id}_${variant.name.lowercase()}.mp3"
        if (assetExists(asset)) {
            context.startService(Intent(context, IntroPlaybackService::class.java))
            player.setMediaItem(
                MediaItem.Builder()
                    .setUri("asset:///$asset")
                    .setMediaMetadata(MediaMetadata.Builder().setTitle(IntroScripts.title(place)).setArtist("마일스탬프").build())
                    .build()
            )
            player.volume = 1f
            player.prepare()
            player.play()
        } else {
            speak(IntroScripts.text(place, variant), "intro:${place.id}")
        }
    }

    /** 지금 소개의 재생 위치(ms). MP3가 아니라 음성 합성으로 읽는 중이면 0 (폰은 처음부터). */
    suspend fun positionMs(): Long = withContext(Dispatchers.Main) {
        val p = IntroPlayerHolder.peek()
        if (p != null && currentPlaceId != null && p.isPlaying) p.currentPosition else 0L
    }

    /** 소개 중 운전석 문이 열림: 0.8초 동안 줄이고 멈춤 → 폰에서 같은 문장부터. */
    fun fadeOutForHandoff() = main.post {
        if (!player.isPlaying) { tts?.stop(); return@post }
        val steps = 8
        for (i in 1..steps) main.postDelayed({ player.volume = 1f - i / steps.toFloat(); if (i == steps) player.pause() }, i * 100L)
    }

    fun stampSound() = main.post {
        runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, 80).startTone(ToneGenerator.TONE_PROP_ACK, 220) }
    }

    /** 짧은 안내. 미리 구운 MP3(asset)가 있으면 그걸, 없으면 음성 합성. */
    fun say(text: String, asset: String? = null) = main.post {
        if (asset != null && assetExists(asset)) {
            player.setMediaItem(MediaItem.fromUri("asset:///$asset"))
            player.volume = 1f
            player.prepare()
            player.play()
        } else speak(text, "say:${System.nanoTime()}")
    }

    private fun speak(text: String, id: String) {
        val t = tts
        if (t == null || !ttsReady) {
            Log.w(TAG, "음성 합성 없음 → 건너뜀: $text")
            if (id.startsWith("intro:")) finish()
            return
        }
        // 오디오 포커스 정책: 잠깐 받아 쓰고(내비와는 겹침 허용) 끝나면 돌려준다. 못 받으면 읽지 않음
        val f = ttsFocus
        if (f != null && audioManager?.requestAudioFocus(f) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            Log.w(TAG, "오디오 포커스를 못 받음 → 건너뜀: $text")
            if (id.startsWith("intro:")) finish()
            return
        }
        // 음성 앞 무음 0.18초 (Pleos 규칙 150~200ms). MP3는 파일 앞에 이미 들어 있다
        t.playSilentUtterance(LEAD_SILENCE_MS, TextToSpeech.QUEUE_FLUSH, PRE + id)
        t.speak(text, TextToSpeech.QUEUE_ADD, null, id)
    }

    private fun releaseTtsFocus() {
        ttsFocus?.let { audioManager?.abandonAudioFocusRequest(it) }
    }

    private fun finish() {
        val id = currentPlaceId ?: return
        currentPlaceId = null
        onFinished(id)
    }

    private fun assetExists(path: String) = runCatching { context.assets.open(path).close(); true }.getOrDefault(false)

    fun release() = main.post {
        tts?.shutdown(); tts = null
        releaseTtsFocus()
        IntroPlayerHolder.release()
    }

    companion object {
        private const val TAG = "IntroAudio"
        /** 음성 합성 앞 무음 (Pleos 소리 규칙 150~200ms). */
        const val LEAD_SILENCE_MS = 180L
        private const val PRE = "pre:"
    }
}

/** 소개 재생기 하나를 서비스 사이에 공유 (MediaSession이 같은 재생기를 노출). */
@OptIn(UnstableApi::class)
object IntroPlayerHolder {
    private var player: ExoPlayer? = null

    fun get(context: Context): ExoPlayer = player ?: ExoPlayer.Builder(context.applicationContext)
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(),
            /* handleAudioFocus = */ true,
        )
        .build().also { player = it }

    fun peek(): ExoPlayer? = player

    fun release() { player?.release(); player = null }
}
