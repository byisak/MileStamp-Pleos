package kr.milestamp.phone.auto

import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.Session
import androidx.car.app.model.Alert
import androidx.car.app.model.CarIcon
import androidx.car.app.model.CarText
import androidx.core.graphics.drawable.IconCompat
import androidx.car.app.AppManager
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * 안드로이드 오토가 붙는 곳 (범주: 관심 장소 POI). 매니페스트 등록은 phone/plugins/withAndroidAuto.js.
 * release 빌드는 구글이 서명한 안드로이드 오토·AAOS 호스트만 받는다 (라이브러리가 준 허용 목록).
 */
class MilestampCarAppService : CarAppService() {
    override fun createHostValidator(): HostValidator {
        val debuggable = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        return if (debuggable) HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        else HostValidator.Builder(applicationContext).addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample).build()
    }

    override fun onCreateSession(): Session = AutoSession()
}

/** 차 화면 하나 = 세션 하나. 세션이 생기면 '탑승', 없어지면 '하차' (판정은 [AutoRuntime]) */
class AutoSession : Session(), AutoRuntime.Listener {
    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                AutoRuntime.init(carContext)
                AutoRuntime.listener = this@AutoSession
                AutoRuntime.sessionStarted(carContext)
            }

            // 차 화면이 다시 보이면: 주행 중이라 미뤄 둔 메달 (첫 화면이 그려진 뒤에)
            override fun onResume(owner: LifecycleOwner) {
                AutoRuntime.sessionResumed()
            }

            override fun onDestroy(owner: LifecycleOwner) {
                if (AutoRuntime.listener === this@AutoSession) AutoRuntime.listener = null
                AutoRuntime.sessionEnded()
            }
        })
    }

    override fun onCreateScreen(intent: Intent): Screen = HomeScreen(carContext)

    private val screens get() = carContext.getCarService(ScreenManager::class.java)

    /**
     * 도장(정차 중): 메달 화면을 띄운다 (홈·코스 위에). 단계 제한(한 흐름에 템플릿 5개)을 넘지 않게
     * 맨 위가 도장·도장북이면 바꿔 끼우고, 화면이 3개 넘게 쌓였으면 홈까지 되감은 뒤에 넣는다.
     */
    override fun onMedalShow(m: ReadyMedal) {
        val sm = screens
        if (sm.top is StampScreen || sm.top is StampBookScreen) sm.pop()
        if (sm.stackSize > 3) sm.popToRoot()
        sm.push(StampScreen(carContext, m))
    }

    /** 도장(주행 중): 알림 한 줄 '도장 쾅! 침산공원 · 15 / 34' — 큰 화면은 멈추면 */
    override fun onMedalAlert(m: ReadyMedal) {
        val i = m.info
        if (apiLevel(carContext) >= 5) {
            runCatching {
                val b = Alert.Builder(i.key.hashCode(), CarText.create(i.alertLine), 6_000).setSubtitle(CarText.create(i.alertSub))
                m.icon?.let { b.setIcon(CarIcon.Builder(IconCompat.createWithBitmap(it)).build()) }
                carContext.getCarService(AppManager::class.java).showAlert(b.build())
                return
            }
        }
        CarToast.makeText(carContext, i.alertLine, CarToast.LENGTH_LONG).show()
    }

    override fun onToast(text: String) = notify(carContext, text)

    companion object {
        /** 짧은 알림: 호스트가 알림창(API 5+)을 지원하면 그것, 아니면 토스트 */
        fun notify(cc: androidx.car.app.CarContext, text: String) {
            if (apiLevel(cc) >= 5) {
                runCatching {
                    cc.getCarService(AppManager::class.java).showAlert(
                        Alert.Builder(text.hashCode(), CarText.create(text), 5_000).build(),
                    )
                    return
                }
            }
            CarToast.makeText(cc, text, CarToast.LENGTH_LONG).show()
        }
    }
}
