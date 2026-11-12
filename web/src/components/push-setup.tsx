"use client";

import { useEffect, useState } from "react";

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "checking" | "unsupported" | "ios-install" | "off" | "denied" | "on" | "working";

/** 알림 켜기. 아이폰은 '홈 화면에 추가'한 뒤에만 웹푸시가 된다(iOS 16.4+). */
export function PushSetup({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })();
  }, []);

  async function enable() {
    setState("working");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
        }));
      const res = await fetch("/api/phone/push", { method: "POST", body: JSON.stringify(sub) });
      setState(res.ok ? "on" : "off");
    } catch {
      setState("off");
    }
  }

  if (state === "checking") return null;
  if (state === "on")
    return compact ? null : <p className="text-sm text-sub">🔔 알림이 켜져 있어요. 차에서 내리면 바로 알려 드려요.</p>;

  return (
    <div className="rounded-2xl bg-card p-4 border border-line">
      {state === "ios-install" ? (
        <>
          <p className="font-semibold">아이폰은 홈 화면에 추가해야 알림이 와요</p>
          <p className="text-sm text-sub mt-1">사파리 아래 공유 버튼 → &lsquo;홈 화면에 추가&rsquo; → 홈 화면의 마일스탬프로 다시 열어 주세요.</p>
        </>
      ) : state === "unsupported" ? (
        <p className="text-sm text-sub">이 브라우저는 알림을 못 받아요. 이 화면을 열어 두면 3초마다 새 소식을 확인해요.</p>
      ) : state === "denied" ? (
        <p className="text-sm text-sub">알림이 꺼져 있어요. 휴대폰 설정에서 이 사이트의 알림을 허용해 주세요.</p>
      ) : (
        <>
          <p className="font-semibold">차에서 내리면 폰으로 이어 들을까요?</p>
          <p className="text-sm text-sub mt-1">문이 열리는 순간 알림이 와요. 끊긴 문장부터 이어서 들려 드려요.</p>
          <button
            onClick={enable}
            disabled={state === "working"}
            className="mt-3 w-full h-12 rounded-xl bg-primary text-white font-semibold disabled:opacity-50"
          >
            {state === "working" ? "켜는 중…" : "알림 켜기"}
          </button>
        </>
      )}
    </div>
  );
}
