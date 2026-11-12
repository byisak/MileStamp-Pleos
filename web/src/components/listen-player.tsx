"use client";

import { useEffect, useRef, useState } from "react";

/** 같은 MP3를 끊긴 문장 시작부터. 브라우저가 자동 재생을 막으면 큰 재생 버튼 한 번. */
export function ListenPlayer({ src, start, title, text }: { src: string; start: number; title: string; text: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(start);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    const a = audio.current!;
    const onMeta = () => {
      setDur(a.duration);
      a.currentTime = start;
      a.play().catch(() => {}); // 막히면 버튼으로
    };
    a.addEventListener("loadedmetadata", onMeta);
    if ("mediaSession" in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: "마일스탬프", artwork: [{ src: "/icons/icon-512.png", sizes: "512x512" }] });
    return () => a.removeEventListener("loadedmetadata", onMeta);
  }, [start, title]);

  const toggle = () => {
    const a = audio.current!;
    if (a.paused) a.play();
    else a.pause();
  };

  return (
    <div className="rounded-2xl bg-card border border-line p-5">
      <audio
        ref={audio}
        src={src}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
      />
      <div className="flex items-center gap-4">
        <button
          onClick={toggle}
          aria-label={playing ? "멈춤" : "재생"}
          className="w-16 h-16 shrink-0 rounded-full bg-primary text-white grid place-items-center text-2xl"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="flex-1">
          <p className="font-semibold">{title}</p>
          <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden">
            <div className="h-full bg-ink" style={{ width: dur ? `${(t / dur) * 100}%` : "0%" }} />
          </div>
          <p className="mt-1 text-xs text-sub tabular-nums">
            {fmt(t)} / {fmt(dur)} {start > 0.5 && t < start + 2 ? "· 끊긴 문장부터" : ""}
          </p>
        </div>
      </div>
      <p className="mt-4 leading-relaxed text-[15px] text-sub">{text}</p>
    </div>
  );
}

function fmt(s: number) {
  if (!Number.isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
