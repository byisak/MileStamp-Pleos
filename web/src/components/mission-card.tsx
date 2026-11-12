"use client";

import { useState } from "react";
import type { Mission } from "@/lib/places";

export function MissionCard({ eventId, mission }: { eventId: string; mission: Mission }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [answer, setAnswer] = useState<number | null>(null);
  const [found, setFound] = useState(false);

  async function send(next: { choice?: number | null; found?: boolean }) {
    const res = await fetch("/api/phone/mission", {
      method: "POST",
      body: JSON.stringify({ eventId, choice: next.choice ?? choice, found: next.found ?? found }),
    });
    if (res.ok) setAnswer(((await res.json()) as { answer: number }).answer);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card border border-line p-5">
        <p className="text-sm text-sub">퀴즈</p>
        <p className="font-semibold text-lg mt-1">{mission.quiz.q}</p>
        <div className="mt-4 grid gap-2">
          {mission.quiz.options.map((o, i) => {
            const picked = choice === i;
            const done = answer !== null;
            const right = done && i === answer;
            return (
              <button
                key={o}
                disabled={done}
                onClick={() => {
                  setChoice(i);
                  send({ choice: i });
                }}
                className={`h-14 rounded-xl border text-left px-4 font-medium ${
                  right ? "border-ink bg-ink text-white" : picked && done ? "border-warn text-warn" : "border-line"
                }`}
              >
                {o} {right ? "✓" : ""}
              </button>
            );
          })}
        </div>
        {answer !== null && (
          <p className="mt-3 font-semibold">{choice === answer ? "정답이에요! 🎉" : "아쉬워요. 다음 장소에서 또 해 봐요!"}</p>
        )}
      </div>
      <label className="flex items-center gap-4 rounded-2xl bg-card border border-line p-5">
        <input
          type="checkbox"
          checked={found}
          onChange={(e) => {
            setFound(e.target.checked);
            send({ found: e.target.checked });
          }}
          className="w-7 h-7 accent-[#2c4a3e]"
        />
        <span>
          <span className="block text-sm text-sub">찾아보기</span>
          <span className="block font-semibold">{mission.find}</span>
        </span>
      </label>
      <p className="text-xs text-sub text-center">차에 다시 타고 출발하면 미션은 잠겨요.</p>
    </div>
  );
}
