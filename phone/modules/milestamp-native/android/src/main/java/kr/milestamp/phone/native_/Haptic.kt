package kr.milestamp.phone.native_

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * 짧고 또렷한 햅틱. 진동 모터를 몇 ms 돌리는 방식(잉~)이 아니라, 기기가 튜닝해 둔
 * 프리미티브(API 30+, 지원 기기) → 미리 정의된 효과(API 29+) 순으로 쓴다.
 */
object Haptic {
  private var vib: Vibrator? = null

  private fun vibrator(ctx: Context): Vibrator? {
    vib?.let { return it }
    val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
      (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    else @Suppress("DEPRECATION") (ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
    vib = v
    return v
  }

  fun play(ctx: Context, kind: String) {
    val v = vibrator(ctx) ?: return
    if (!v.hasVibrator()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val prim = when (kind) {
        "tick" -> VibrationEffect.Composition.PRIMITIVE_TICK
        "success" -> VibrationEffect.Composition.PRIMITIVE_CLICK
        else -> VibrationEffect.Composition.PRIMITIVE_CLICK
      }
      if (v.areAllPrimitivesSupported(prim)) {
        val c = VibrationEffect.startComposition()
        when (kind) {
          "tick" -> c.addPrimitive(prim, 0.7f)
          "heavy" -> c.addPrimitive(prim, 1.0f)
          "success" -> { c.addPrimitive(prim, 0.8f); c.addPrimitive(prim, 1.0f, 70) }
          else -> c.addPrimitive(prim, 0.9f)
        }
        v.vibrate(c.compose())
        return
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val id = when (kind) {
        "tick" -> VibrationEffect.EFFECT_TICK
        "heavy" -> VibrationEffect.EFFECT_HEAVY_CLICK
        "success" -> VibrationEffect.EFFECT_DOUBLE_CLICK
        else -> VibrationEffect.EFFECT_CLICK
      }
      v.vibrate(VibrationEffect.createPredefined(id))
      return
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      v.vibrate(VibrationEffect.createOneShot(if (kind == "heavy") 20 else 8, if (v.hasAmplitudeControl()) 200 else VibrationEffect.DEFAULT_AMPLITUDE))
    }
  }
}
