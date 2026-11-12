"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PushSetup } from "@/components/push-setup";

const WHO = ["엄마", "아빠", "할머니", "할아버지", "이모", "삼촌"];

export function JoinForm() {
  const code = useSearchParams().get("c") ?? "";
  const [who, setWho] = useState("");
  const [state, setState] = useState<"ready" | "working" | "done">("ready");
  const [error, setError] = useState("");

  async function join() {
    setState("working");
    setError("");
    const res = await fetch("/api/phone/join", { method: "POST", body: JSON.stringify({ code, nickname: who || "가족" }) });
    if (res.ok) setState("done");
    else {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "연결하지 못했어요.");
      setState("ready");
    }
  }

  if (!code)
    return <p className="pt-10 text-center text-sub">차 화면의 QR을 휴대폰 카메라로 찍어 주세요.</p>;

  if (state === "done")
    return (
      <section className="pt-6 space-y-5">
        <h1 className="text-2xl font-bold">연결됐어요 🎉</h1>
        <p className="text-sub">마지막으로 알림을 켜 두면, 차 문이 열릴 때 바로 이어 들을 수 있어요.</p>
        <PushSetup />
        <Link href="/" className="block text-center h-12 leading-[3rem] rounded-xl border border-line bg-card font-semibold">
          오늘 소식 보기
        </Link>
      </section>
    );

  return (
    <section className="pt-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">우리 차와 연결할게요</h1>
        <p className="text-sub mt-2">누구의 폰인가요? (건너뛰어도 돼요)</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {WHO.map((w) => (
          <button
            key={w}
            onClick={() => setWho(w === who ? "" : w)}
            className={`h-14 rounded-xl border font-semibold ${w === who ? "bg-primary text-white border-primary" : "bg-card border-line"}`}
          >
            {w}
          </button>
        ))}
      </div>
      {error && <p className="text-warn text-sm">{error}</p>}
      <button
        onClick={join}
        disabled={state === "working"}
        className="w-full h-14 rounded-xl bg-primary text-white font-semibold text-lg disabled:opacity-50"
      >
        {state === "working" ? "연결 중…" : "연결하기"}
      </button>
      <p className="text-xs text-sub text-center">위치·사진은 보내지 않아요. 이 폰은 우리 가족 소식만 받아요.</p>
    </section>
  );
}
