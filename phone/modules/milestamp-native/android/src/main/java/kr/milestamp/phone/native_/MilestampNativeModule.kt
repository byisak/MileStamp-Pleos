package kr.milestamp.phone.native_

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// MindNest 네이티브 모듈에서 햅틱만 가져왔다 (같은 촉감)
class MilestampNativeModule : Module() {
  private val ctx get() = requireNotNull(appContext.reactContext) { "앱 컨텍스트 없음" }

  override fun definition() = ModuleDefinition {
    Name("MilestampNative")

    // 또렷한 햅틱: tick(탭·선택) · click(버튼) · heavy · success(완료 · 도장 쾅)
    Function("haptic") { kind: String -> Haptic.play(ctx, kind) }
  }
}
