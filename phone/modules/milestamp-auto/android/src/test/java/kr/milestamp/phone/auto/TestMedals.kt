package kr.milestamp.phone.auto

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File

/** 시안 proto/auto-medal.html의 K 표와 같은 다섯 가지 메달 */
object TestMedals {
    val normal = MedalInfo(
        key = "chimsan", placeId = "chimsan", name = "침산공원", number = 15, got = 15, total = 34,
        groupTitle = "우리 동네 평일 오후", groupGot = 5, groupTotal = 9, phoneVerified = false,
        nextName = "금호강 하중도", departMin = 12 * 60 + 10, homeMin = 16 * 60 + 20,
    )
    val rare = MedalInfo(
        key = "thearc_rain", placeId = "thearc", name = "비 오는 날 디아크", number = 16, got = 16, total = 34, rare = "비 오는 날",
        groupTitle = "대구·경북 시즌 1",
    )
    val festival = MedalInfo(
        key = "fest-palgong", placeId = "fest-palgong", name = "팔공산 단풍축제", number = 17, got = 17, total = 34,
        festival = true, festivalSeason = "2026 가을", festivalUntil = "11/9",
    )
    val again = MedalInfo(
        key = "hwabon", placeId = "hwabon", name = "화본역", number = 12, got = 15, total = 34, visit = 3, firstDay = "10/12",
        groupTitle = "대구·경북 시즌 1",
    )
    val quiet = MedalInfo(
        key = "dgsm", placeId = "dgsm", name = "국립대구과학관", number = 15, got = 15, total = 34, quiet = true,
        groupTitle = "대구·경북 시즌 1",
    )

    val all = linkedMapOf("normal" to normal, "rare" to rare, "festival" to festival, "again" to again, "quiet" to quiet)

    /** 그림 파일 이름 (축제는 붙은 명소 케이블카 그림 — 시안과 같게) */
    private val artId = mapOf("normal" to "chimsan", "rare" to "thearc_rain", "festival" to "cablecar", "again" to "hwabon", "quiet" to "dgsm")

    /** 시험 실행 폴더 = phone/modules/milestamp-auto/android → 저장소 뿌리 */
    val repo: File = File("../../../..").canonicalFile

    fun art(variant: String): Bitmap? = File(repo, "web/public/stamps/${artId[variant]}.webp").takeIf { it.exists() }
        ?.let { MedalArt.decode(it, 512) ?: BitmapFactory.decodeFile(it.path) }

    fun fonts(): MedalFonts = MedalFonts.fromDir(File(repo, "phone/assets/fonts"))
}
