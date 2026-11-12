"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { describe, hhmm, type FeedEvent } from "./event-text";

const URGENT = new Set(["handoff", "mission", "intro", "summary"]);

/** 오늘 소식. 푸시가 없어도 화면을 열어 두면 3초마다 확인하고, 새로 온 급한 소식은 위에 크게. */
export function Feed() {
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [fresh, setFresh] = useState<FeedEvent | null>(null);
  const latest = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function tick(first: boolean) {
      if (document.visibilityState !== "visible" && !first) return;
      const q = latest.current ? `?after=${encodeURIComponent(latest.current)}` : "";
      const res = await fetch(`/api/phone/feed${q}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok || stop) return;
      const { events: got } = (await res.json()) as { events: FeedEvent[] };
      if (got.length) {
        latest.current = got[0].created_at;
        // 경계 시각이 겹쳐 같은 소식이 다시 올 수 있어 id로 거른다
        setEvents((old) => {
          const seen = new Set((old ?? []).map((e) => e.id));
          return [...got.filter((e) => !seen.has(e.id)), ...(old ?? [])];
        });
        const urgent = got.find((e) => URGENT.has(e.kind));
        if (!first && urgent) {
          setFresh(urgent);
          navigator.vibrate?.(120);
        }
      } else if (first) setEvents([]);
    }
    tick(true);
    const t = setInterval(() => tick(false), 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (events === null) return <p className="text-sub text-sm py-6">불러오는 중…</p>;

  return (
    <div className="space-y-3">
      {fresh && (
        <Link href={`/e/${fresh.id}`} className="block rounded-2xl bg-primary text-white p-5 shadow-lg">
          <p className="text-sm opacity-80">방금 차에서</p>
          <p className="text-xl font-bold mt-1">
            {describe(fresh).icon} {describe(fresh).title}
          </p>
          <p className="mt-3 font-semibold">눌러서 열기 →</p>
        </Link>
      )}
      {events.length === 0 ? (
        <p className="text-sub text-sm py-6 text-center">아직 오늘 소식이 없어요. 출발하면 여기에 쌓여요.</p>
      ) : (
        <ul className="rounded-2xl bg-card border border-line divide-y divide-line">
          {events.map((e) => {
            const d = describe(e);
            return (
              <li key={e.id}>
                <Link href={`/e/${e.id}`} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="text-2xl w-8 text-center">{d.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{d.title}</span>
                    <span className="block text-sm text-sub truncate">{d.sub}</span>
                  </span>
                  <span className="text-xs text-sub tabular-nums">{hhmm(e.created_at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
