package kr.milestamp.car.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import kr.milestamp.car.R
import kr.milestamp.car.net.RemoteStamps
import java.io.File

/**
 * 도장 그림: 관리자에서 올려 받아 둔 그림(files/stamps/<id>_<ver>.webp)이 있으면 그것, 없으면 차에 든 그림.
 * 비 오는 날 디아크(희귀) 칸은 늘 차에 든 그림.
 */
@Composable
fun stampPainter(placeId: String, rare: Boolean): Painter? {
    val ver by RemoteStamps.version.collectAsState()
    val bmp = remember(placeId, rare, ver) { StampArt.remote(placeId, rare)?.let(RemoteStamps::bitmap) }
    if (bmp != null) return remember(bmp) { BitmapPainter(bmp) }
    return StampArt.of(placeId, rare)?.let { painterResource(it) }
}

/** 장소 id → 도장 그림 (ChatGPT 풍경 + 마일스탬프 잉크 테두리, 투명 배경). */
object StampArt {
    /** 받아 둔 서버 그림 파일 (없으면 null). */
    fun remote(placeId: String, rare: Boolean): File? = if (rare && placeId == "thearc") null else RemoteStamps.file(placeId)

    fun of(placeId: String, rare: Boolean): Int? = when (placeId) {
        "seokgul" -> R.drawable.stamp_samjon
        "samguk" -> R.drawable.stamp_samguk
        "dgsm" -> R.drawable.stamp_science
        "thearc" -> if (rare) R.drawable.stamp_arc_rain else R.drawable.stamp_arc
        "hwabon" -> R.drawable.stamp_hwabon
        "hahoe" -> R.drawable.stamp_hahoe
        "donghwa" -> R.drawable.stamp_donghwa
        // 새 도장 27곳 (tools/stampgen/sheet_wrap.py)
        "weather" -> R.drawable.stamp_weather
        "eduseum" -> R.drawable.stamp_eduseum
        "unamji" -> R.drawable.stamp_unamji
        "hajungdo" -> R.drawable.stamp_hajungdo
        "chimsan" -> R.drawable.stamp_chimsan
        "dalseong" -> R.drawable.stamp_dalseong
        "aayang" -> R.drawable.stamp_aayang
        "duryu" -> R.drawable.stamp_duryu
        "samsung" -> R.drawable.stamp_samsung
        "hanbam" -> R.drawable.stamp_hanbam
        "bullo" -> R.drawable.stamp_bullo
        "samunjin" -> R.drawable.stamp_samunjin
        "suseongmot" -> R.drawable.stamp_suseongmot
        "aquarium" -> R.drawable.stamp_aquarium
        "kidsworld" -> R.drawable.stamp_kidsworld
        "nmd" -> R.drawable.stamp_nmd
        "safety" -> R.drawable.stamp_safety
        "bangjja" -> R.drawable.stamp_bangjja
        "gumisci" -> R.drawable.stamp_gumisci
        "daegaya" -> R.drawable.stamp_daegaya
        "naturepark" -> R.drawable.stamp_naturepark
        "eworld" -> R.drawable.stamp_eworld
        "suppia" -> R.drawable.stamp_suppia
        "songhae" -> R.drawable.stamp_songhae
        "arboretum" -> R.drawable.stamp_arboretum
        "honeybee" -> R.drawable.stamp_honeybee
        "cablecar" -> R.drawable.stamp_cablecar
        else -> null
    }
}

/** 축제 한정 도장 그림: 올려 받아 둔 축제 그림 → 붙은 명소 그림(붉은 테는 화면이 두름) → 없음. */
@Composable
fun festivalPainter(festivalId: String, attachedPlaceId: String?): Painter? {
    val ver by RemoteStamps.version.collectAsState()
    val bmp = remember(festivalId, ver) { RemoteStamps.file(festivalId)?.let(RemoteStamps::bitmap) }
    if (bmp != null) return remember(bmp) { BitmapPainter(bmp) }
    return attachedPlaceId?.let { stampPainter(it, false) }
}
