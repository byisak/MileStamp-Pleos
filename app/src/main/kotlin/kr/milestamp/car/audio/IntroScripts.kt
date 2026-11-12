package kr.milestamp.car.audio

import kr.milestamp.engine.IntroVariant
import kr.milestamp.engine.Place

/**
 * 소개 대본. 소리는 Fish Audio로 미리 구운 MP3(assets/intro/)를 쓰고, 이 글은 폰 이어 듣기·예비 음성 합성용.
 * 감정 태그가 붙은 원본은 tools/introgen/fish_scripts.json — 태그를 뺀 문장이 여기와 같아야 한다 (make_fish.py가 확인).
 * 최종본은 서버가 장소 정보로 대본을 만들고 MP3로 굽는다 (3번 할 일).
 */
object IntroScripts {
    private val full = mapOf(
        "seokgul" to "곧 군위 삼존석굴에 도착해요. 높은 절벽 한가운데에 동굴이 하나 있는데요, 천삼백 년 전 신라 사람들이 그 안에 부처님 세 분을 모셨대요. 경주 석굴암보다도 먼저 만들어졌답니다. 도착하면 부처님 양옆에 누가 계신지 같이 찾아봐요.",
        "samguk" to "곧 삼국유사테마파크예요! 아주 먼 옛날, 일연 스님이 우리 옛이야기를 모아 책을 썼어요. 그 책이 바로 삼국유사예요. 여기서는 그 신기한 이야기들을 놀이로 만날 수 있대요. 해룡 미끄럼틀도 꼭 타 봐요!",
        "dgsm" to "곧 국립대구과학관에 도착해요. 천체투영관에 들어가면 둥근 천장 가득 별이 쏟아진대요. 밖에는 성덕대왕신종을 디지털로 되살린 종도 있어요. 신기한 걸 하나씩 찾아서, 이따 차에서 서로 알려 줘요.",
        "thearc" to "곧 디아크예요. 여기서 낙동강과 금호강, 강 두 개가 만나요. 물가에 은빛 건물이 있는데, 꼭 물 위로 뛰어오르는 물고기처럼 생겼어요. 비 오는 날엔 강물 위로 빗방울이 동그랗게 퍼져서 더 예쁘대요.",
        "hwabon" to "곧 화본역이에요. 1936년에 문을 연 아주 작은 시골 기차역이에요. 역 옆 높다란 탑은, 옛날 증기기관차가 물을 마시던 급수탑이래요. 역 앞에서 가족사진 한 장 찍어요!",
        "hahoe" to "곧 안동 하회마을이에요. 강물이 마을을 빙 돌아 흐른다고 해서 하회라고 불러요. 웃는 얼굴 하회탈을 찾아서, 누가 제일 똑같이 웃는지 내기해요!",
    )

    private val kids = mapOf(
        "seokgul" to "곧 바위 속 부처님을 만나요! 부처님이 몇 분인지 같이 세어 볼까요?",
        "samguk" to "곧 옛이야기 놀이공원이에요! 용을 찾아보자!",
        "dgsm" to "곧 별을 보러 가요! 로켓도 있을까?",
        "thearc" to "곧 은빛 물고기 건물이에요. 강이 두 개 만나는 곳을 찾아봐요!",
        "hwabon" to "곧 기차역이에요. 칙칙폭폭 기차가 물 마시던 탑을 찾아봐요!",
        "hahoe" to "곧 강이 빙 도는 마을이에요. 웃는 탈을 찾아봐요!",
    )

    fun text(place: Place, variant: IntroVariant): String = when (variant) {
        IntroVariant.FULL_60S -> full[place.id] ?: "곧 ${place.name}에 도착해요."
        IntroVariant.KIDS_30S -> kids[place.id] ?: "곧 ${place.name}이에요."
        IntroVariant.PHONE_ONLY -> "곧 ${place.name}이에요. 소개는 폰으로 보내 드릴게요."
    }

    fun title(place: Place) = "${place.name} 이야기"
}
