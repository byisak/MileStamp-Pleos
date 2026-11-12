package kr.milestamp.car.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit

/*
 * 화면 아이콘 = Lucide 선 아이콘 한 벌 (시안 proto/icons.html ③ 차 화면).
 * 굵기 2 · 둥근 끝, 색은 둘레 글자색을 그대로 따른다. 크기는 글자 크기 기준:
 * 글 속 아이콘 ≈ 글자 크기, 버튼 아이콘 ≈ 글자 × 1.1.
 * Lucide: ISC 라이선스 (https://lucide.dev/license), Compose판 com.composables:icons-lucide: MIT — app/NOTICE
 */

/** 글자 크기(sp)에 맞춘 아이콘. [scale] 1.0 = 글 속, 1.1 = 버튼. 색을 안 주면 둘레 글자색(LocalContentColor). */
@Composable
fun MsIcon(icon: ImageVector, textSize: TextUnit, modifier: Modifier = Modifier, tint: Color = LocalContentColor.current, scale: Float = 1f) {
    val d = with(LocalDensity.current) { (textSize * scale).toDp() }
    Icon(icon, contentDescription = null, tint = tint, modifier = modifier.size(d))
}

/** 아이콘 + 글. 아이콘은 글자색과 같고, 사이 간격은 글자 크기의 0.35배. */
@Composable
fun IconText(
    icon: ImageVector?,
    text: String,
    size: TextUnit,
    modifier: Modifier = Modifier,
    color: Color = LocalContentColor.current,
    weight: FontWeight? = null,
    iconScale: Float = 1f,
    maxLines: Int = Int.MAX_VALUE,
    lineHeight: TextUnit = TextUnit.Unspecified,
) {
    val gap = with(LocalDensity.current) { (size * 0.35f).toDp() }
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(gap)) {
        if (icon != null) MsIcon(icon, size, tint = color, scale = iconScale)
        Text(text, fontSize = size, fontWeight = weight, color = color, maxLines = maxLines, lineHeight = lineHeight)
    }
}
