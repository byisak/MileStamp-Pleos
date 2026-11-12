import { Suspense } from "react";
import { currentPhone } from "@/lib/auth";
import { Feed } from "@/components/feed";
import { PushSetup } from "@/components/push-setup";

export default function Home() {
  return (
    <Suspense fallback={<p className="text-sub text-sm py-6">불러오는 중…</p>}>
      <HomeBody />
    </Suspense>
  );
}

async function HomeBody() {
  const phone = await currentPhone();
  if (!phone)
    return (
      <section className="pt-10 text-center">
        <p className="text-5xl">🚗 → 📱</p>
        <h1 className="mt-6 text-2xl font-bold leading-snug">
          차에서 내려도
          <br />
          나들이가 이어져요
        </h1>
        <p className="mt-4 text-sub leading-relaxed">
          차를 세운 뒤 차 화면의 <b>마일스탬프 → 폰 연결</b>을 누르고,
          <br />
          나오는 QR을 휴대폰 카메라로 찍어 주세요.
        </p>
      </section>
    );

  return (
    <section className="space-y-5 pt-2">
      <div>
        <h1 className="text-2xl font-bold">오늘 우리 가족</h1>
        <p className="text-sm text-sub mt-1">{phone.nickname} 폰 · 차와 연결됨</p>
      </div>
      <PushSetup />
      <Feed />
    </section>
  );
}
