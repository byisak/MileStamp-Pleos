import { place } from "@/lib/places";

export type FeedEvent = {
  id: string;
  kind: "handoff" | "mission" | "intro" | "stamp" | "summary";
  place_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export function describe(e: FeedEvent): { icon: string; title: string; sub: string } {
  const p = place(e.place_id);
  const name = p?.name ?? "";
  switch (e.kind) {
    case "handoff":
      return { icon: "🎧", title: `${name} 이야기 이어 듣기`, sub: "차에서 듣던 문장부터" };
    case "intro":
      return { icon: p?.emoji ?? "📖", title: `곧 ${name}`, sub: "조용히 가는 중이라 소개를 폰으로" };
    case "mission":
      return { icon: p?.emoji ?? "⭐", title: `${name} 미션`, sub: "퀴즈 하나 + 찾아보기 하나" };
    case "stamp": {
      const n = e.payload.number as number | undefined;
      const rare = e.payload.rare as string | undefined;
      return { icon: "🟢", title: `도장 쾅! ${name}`, sub: [n ? `${n}번째 도장` : "", rare ? `희귀 · ${rare}` : ""].filter(Boolean).join(" · ") };
    }
    case "summary": {
      const s = e.payload as { stamps?: number; rare?: number; km?: number };
      return { icon: "🏅", title: "오늘 하루 자랑 카드", sub: `도장 ${s.stamps ?? 0}개${s.rare ? ` · 희귀 ${s.rare}` : ""}${s.km ? ` · ${Math.round(s.km)}km` : ""}` };
    }
  }
}

export function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}
