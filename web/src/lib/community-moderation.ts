import { aiApiKey } from "./ai-image";
import { aiTextMock, chatText } from "./ai-text";
import { checkHandle, checkText, type TextCheck } from "./community-shape";

/*
 * '함께' 글·별명 검사: ① 키워드(욕설·전화번호·계좌·학교 이름·링크 — community-shape.ts) → ② 글 AI(그림·일기와 같은 게이트웨이).
 * AI가 없거나(키 없음·AI_TEXT_MOCK=1) 늦거나 실패하면 키워드만으로 통과시킨다(fail-open). 키는 로그에 남기지 않는다.
 */

const SYSTEM = [
  "너는 아이와 나들이 가는 가족들의 지역 커뮤니티 글 검사기야.",
  "다음 중 하나라도 해당하면 막아: 욕설·비하·혐오, 성적인 내용, 광고·홍보, 개인정보(아이 실명, 전화번호, 주소, 학교·유치원·어린이집 이름, 계좌), 아이를 위험하게 할 수 있는 내용.",
  "평범한 나들이 후기·장소 팁·자랑은 통과야. 아이를 '첫째', '우리 딸'처럼 부르는 건 괜찮아.",
  '답은 JSON 한 줄만: {"ok":true} 또는 {"ok":false,"reason":"abuse|sexual|ad|privacy|child_safety"}',
].join("\n");

const REASON_MSG: Record<string, string> = {
  abuse: "고운 말로 다시 적어 주세요",
  sexual: "함께에 맞지 않는 내용이에요",
  ad: "광고·홍보 글은 올릴 수 없어요",
  privacy: "아이 이름·연락처·주소 같은 정보는 빼고 적어 주세요",
  child_safety: "아이 안전을 위해 올릴 수 없는 내용이에요",
};

/** AI 답 → 결과 (JSON이 아니거나 이상하면 통과 — fail-open) */
export function readModeration(answer: string): TextCheck {
  const m = /\{[\s\S]*\}/.exec(answer);
  if (!m) return { ok: true };
  try {
    const j = JSON.parse(m[0]) as { ok?: unknown; reason?: unknown };
    if (j.ok !== false) return { ok: true };
    const reason = typeof j.reason === "string" ? j.reason : "abuse";
    return { ok: false, code: "abuse", message: REASON_MSG[reason] ?? REASON_MSG.abuse };
  } catch {
    return { ok: true };
  }
}

export async function moderate(text: string, what: "post" | "handle"): Promise<TextCheck> {
  const base = what === "handle" ? checkHandle(text) : checkText(text);
  if (!base.ok || !text.trim()) return base;
  if (aiTextMock() || !aiApiKey()) return base;
  try {
    const answer = await chatText(SYSTEM, `${what === "handle" ? "가족 별명" : "글"}: ${text.trim()}`, { timeoutMs: 6_000, maxTokens: 60, feature: "moderation" });
    return readModeration(answer);
  } catch (e) {
    console.error("함께 AI 검사 건너뜀", (e as Error).message);
    return base;
  }
}
