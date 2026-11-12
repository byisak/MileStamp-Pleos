package kr.milestamp.phone.auto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 폰 앱(JS) ↔ 안드로이드 오토. JS(src/auto.ts)가 SecureStore의 폰 토큰과 서버 주소를 넘겨 주면
 * 차 화면(CarAppService)이 같은 토큰으로 서버를 부른다. 앱이 켜져 있는 동안 투사 연결(CarConnection)도 지켜본다.
 */
class MilestampAutoModule : Module() {
  private val ctx get() = requireNotNull(appContext.reactContext) { "앱 컨텍스트 없음" }

  override fun definition() = ModuleDefinition {
    Name("MilestampAuto")

    OnCreate {
      appContext.reactContext?.let {
        AutoRuntime.init(it)
        AutoRuntime.watchConnection()
      }
    }

    /** 서버 주소·폰 토큰 (토큰 null = 연결 끊음) */
    Function("setConfig") { server: String, token: String? ->
      AutoRuntime.init(ctx)
      AutoRuntime.cfg.set(server, token)
    }

    /** 쉿 모드 (예전 다리): 켜기/끄기만. 새 코드는 setQuietMode */
    Function("setQuiet") { on: Boolean ->
      AutoRuntime.init(ctx)
      AutoRuntime.cfg.quietMode = if (on) QuietMode.ON else QuietMode.OFF
    }

    /** 쉿 모드 고름: 'auto'(낮잠 시간) · 'on' · 'off'. 지금 쉿인지 돌려준다 */
    Function("setQuietMode") { mode: String ->
      AutoRuntime.init(ctx)
      AutoRuntime.cfg.quietMode = QuietMode.of(mode)
      AutoRuntime.cfg.quiet
    }

    /** 가족 낮잠 (분, 둘 다 null = 낮잠 없음) — 가족 설정을 받거나 바꿀 때 JS가 넘긴다. 지금 쉿인지 돌려준다 */
    Function("setNap") { start: Int?, len: Int? ->
      AutoRuntime.init(ctx)
      AutoRuntime.cfg.setNap(start, len)
      AutoRuntime.cfg.quiet
    }

    /** 시간 표시: '12'(오후 9:54) · '24'(21:54) — 차 화면 시각을 같은 방식으로 */
    Function("setTimeFormat") { fmt: String ->
      AutoRuntime.init(ctx)
      AutoRuntime.cfg.hour12 = fmt != "24"
    }

    /** 지금 상태 (개발 탭·시험용) */
    Function("status") {
      AutoRuntime.init(ctx)
      AutoRuntime.status()
    }
  }
}
