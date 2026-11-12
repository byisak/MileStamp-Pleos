import type { Metadata } from "next";
import Link from "next/link";
import { Clause, CONTACT_EMAIL, Items, LegalPage } from "@/components/legal";

export const metadata: Metadata = { title: "함께 이용 규칙" };

/*
 * '함께'(가족 커뮤니티) 이용 규칙 — 폰 앱 이용 규칙 시트(phone/src/screens/TogetherSheets.tsx RULES)의 네 가지를 풀어 쓴 것.
 * 검사·신고 기준은 web/src/lib/community-shape.ts · community-moderation.ts와 같게. 규칙을 바꾸면 셋 다 같이.
 */
export default function CommunityRulesPage() {
  return (
    <LegalPage
      current="/community-rules"
      title="함께 이용 규칙"
      lead="'함께'는 가까운 지역 가족들이 다녀온 곳·도장·장소 팁을 나누는 곳이에요. 아이를 지키는 규칙 네 가지를 꼭 지켜 주세요."
    >
      <Clause n={1} title="아이 얼굴·이름·학교는 올리지 않아요">
        <Items>
          <li>아이 실명, 유치원·어린이집·학교 이름, 전화번호, 주소, 계좌번호는 쓰지 않아요. &apos;첫째&apos;, &apos;우리 딸&apos;처럼 불러 주세요.</li>
          <li>글에는 &apos;가족 별명 · 폰 이름&apos;(예: 별빛가족 · 엄마)이 보여요. 별명(2~10자)과 폰 이름은 실명이나 아이 이름 말고 별명으로 지어 주세요.</li>
          <li>&apos;함께&apos;에는 사진을 올릴 수 없어요. 도장 그림과 장소 이름만 보여요.</li>
        </Items>
      </Clause>

      <Clause n={2} title="집·지금 있는 곳은 안 나가요">
        <Items>
          <li>글에는 장소 이름만 보이고, 좌표·집 위치·차나 폰을 알아볼 수 있는 연결 정보는 절대 나가지 않아요.</li>
          <li>글은 그날 집에 도착한 뒤(또는 올리고 2시간 뒤)부터 다른 가족에게 보여요. 지금 어디 있는지 드러나지 않게 하려는 거예요.</li>
          <li>&apos;함께 숨기기&apos;를 켜면 우리 가족 글이 다른 가족에게 보이지 않아요.</li>
        </Items>
      </Clause>

      <Clause n={3} title="고운 말로 이야기해요">
        <Items>
          <li>욕설·비하·혐오, 성적인 내용, 광고·홍보는 안 돼요. 링크·오픈채팅·연락처도 올릴 수 없어요.</li>
          <li>글은 140자까지예요. 올리기 전에 서버가 글을 먼저 살펴요: 전화번호·계좌번호·학교 이름·링크 같은 낱말을 막고, AI 글 도우미가 한 번 더 살펴요(<Link className="underline" href="/privacy">개인정보처리방침</Link> 4조).</li>
        </Items>
      </Clause>

      <Clause n={4} title="이상한 글은 신고해 주세요">
        <Items>
          <li>글이나 가족 별명을 신고할 수 있어요. 이유: 스팸·광고, 욕설·비하, 개인정보 노출, 아이 안전, 그 밖에.</li>
          <li>서로 다른 가족 3곳이 신고하거나, &apos;아이 안전&apos; 신고가 한 번이라도 오면 글을 바로 숨기고 운영팀이 살펴요.</li>
          <li>보기 싫은 가족은 &apos;가리기&apos;로 내 화면에서 그 가족 글을 모두 안 보이게 할 수 있어요.</li>
        </Items>
      </Clause>

      <Clause title="운영팀이 하는 일">
        <Items>
          <li>규칙을 어긴 글은 운영팀이 숨기거나 지울 수 있어요. 여러 번 또는 심하게 어기면 그 가족은 글을 올릴 수 없게 되고, 올린 글도 보이지 않아요.</li>
          <li>내가 올린 글은 언제든 지울 수 있어요. 지운 글은 다른 가족에게 바로 안 보여요.</li>
          <li>올린 글에 대한 책임은 올린 가족에게 있어요. 다른 사람의 권리(저작권·초상권·명예)를 해치지 말아 주세요.</li>
          <li>잘못 숨겨졌다고 생각되면 <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>로 알려 주세요.</li>
        </Items>
      </Clause>
    </LegalPage>
  );
}
