package kr.milestamp.car.trip

import kr.milestamp.engine.PlanOption

/** 서버 답에 실린 제안 카드 상태. 답 모양이 제안을 말하지 않으면(PATCH의 NoChange 등) [Unknown]. */
sealed interface ServerProposal {
    /** 서버에 떠 있는 제안 없음 (`proposal: null`, 또는 지난 버전의 제안). */
    data object None : ServerProposal
    /** 서버 제안 카드들의 모양 ([ProposalDismissWatch.shape]). */
    data class Some(val shapes: List<String>) : ServerProposal
    data object Unknown : ServerProposal
}

/**
 * 가족 폰이 '그대로 갈게요'를 누르면 서버는 `plans.course_proposal`만 비운다(코스·버전 그대로).
 * 차의 제안 카드는 자기 엔진이 낸 것이라, 서버 답만 보고 치워도 되는지를 여기서 판단한다.
 *
 * 규칙: 차에 떠 있는 카드와 **같은 모양의 제안**을 서버가 버전 v에서 들고 있는 걸 한 번 본 뒤,
 * 같은 버전 v에서 서버 제안이 없어졌으면 = 누군가 거절한 것 → 치운다.
 *  - 차가 방금 만들고 아직 서버에 안 보낸 제안은 서버에서 본 적이 없으니 치우지 않는다.
 *  - 서버 버전이 바뀌어 제안이 사라진 건 거절이 아니라 코스 변화 — 차 엔진이 스스로 판단(ProposalCleared)한다.
 *  - 카드 모양 = 종류 + 장소 id 순서 (시각 글은 차·서버 시계 차이로 다를 수 있어 안 본다).
 * 서비스의 여러 코루틴에서 부르므로 동기화.
 */
class ProposalDismissWatch {
    private var shown: List<String>? = null
    private var matchedVersion = -1

    /**
     * 서버 답 하나를 본다. [carShapes] = 지금 차에 떠 있는 제안 카드 모양(없으면 null).
     * 차 카드를 치워야 하면 true.
     */
    @Synchronized
    fun onServer(carShapes: List<String>?, version: Int, server: ServerProposal): Boolean {
        if (carShapes != shown) { shown = carShapes; matchedVersion = -1 }
        if (carShapes == null || version < 0) return false
        return when (server) {
            is ServerProposal.Some -> { if (server.shapes == carShapes) matchedVersion = version; false }
            ServerProposal.None -> if (version == matchedVersion) { shown = null; matchedVersion = -1; true } else false
            ServerProposal.Unknown -> false
        }
    }

    /**
     * 차에 떠 있는 [carShapes]와 같은 제안을 서버가 들고 있던 버전 (차 '그대로 갈게요'를 서버에 보낼 때 쓰는 version).
     * 본 적 없으면 null.
     */
    @Synchronized
    fun serverVersionOf(carShapes: List<String>?): Int? =
        if (carShapes != null && carShapes == shown && matchedVersion >= 0) matchedVersion else null

    @Synchronized
    fun reset() { shown = null; matchedVersion = -1 }

    companion object {
        fun shape(o: PlanOption): String = shape(o.kind.name, o.stops.map { it.id })
        fun shape(kind: String, stopIds: List<String>): String = kind + ":" + stopIds.joinToString(",")
        fun shapes(p: ProposalShown?): List<String>? = p?.options?.map(::shape)
    }
}
