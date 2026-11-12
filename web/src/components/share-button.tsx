"use client";

import { useState } from "react";

export function ShareButton({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        const url = location.href;
        if (navigator.share) await navigator.share({ title, text, url }).catch(() => {});
        else {
          await navigator.clipboard.writeText(`${text} ${url}`);
          setCopied(true);
        }
      }}
      className="w-full h-14 rounded-xl bg-primary text-white font-semibold"
    >
      {copied ? "주소를 복사했어요" : "가족에게 보내기"}
    </button>
  );
}
