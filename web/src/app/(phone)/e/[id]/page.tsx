import { Suspense } from "react";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { sql, type EventRow } from "@/lib/db";
import { currentPhone } from "@/lib/auth";
import { clip, place, resumeAt, PLACES } from "@/lib/places";
import { ListenPlayer } from "@/components/listen-player";
import { MissionCard } from "@/components/mission-card";
import { ShareButton } from "@/components/share-button";

export default function EventPage({ params }: PageProps<"/e/[id]">) {
  return (
    <Suspense fallback={<p className="text-sub text-sm py-6">불러오는 중…</p>}>
      <EventBody params={params} />
    </Suspense>
  );
}

async function EventBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [ev] = await sql<EventRow[]>`select * from events where id = ${id}`;
  if (!ev) notFound();

  // 자랑 카드만 링크를 받은 누구나 볼 수 있다. 나머지는 우리 가족 폰만.
  if (ev.kind !== "summary") {
    const phone = await currentPhone();
    if (!phone || phone.car_id !== ev.car_id) notFound();
  }

  const p = place(ev.place_id);
  const payload = ev.payload as Record<string, unknown>;

  if ((ev.kind === "handoff" || ev.kind === "intro") && p) {
    const variant = (payload.variant as string) ?? "FULL_60S";
    const c = clip(p.id, variant === "PHONE_ONLY" ? "FULL_60S" : variant) ?? clip(p.id, "FULL_60S");
    if (!c) notFound();
    const start = ev.kind === "handoff" ? resumeAt(c, Number(payload.positionMs ?? 0)) : 0;
    return (
      <section className="space-y-4 pt-2">
        <h1 className="text-2xl font-bold">
          {p.emoji} {p.name}
        </h1>
        <p className="text-sub">{ev.kind === "handoff" ? "차에서 듣던 이야기를 이어서 들려 드려요." : "조용히 가는 중이라 소개를 폰으로 보냈어요."}</p>
        <ListenPlayer src={c.src} start={start} title={`${p.name} 이야기`} text={c.text} />
        <Link href="/" className="block text-center text-sub text-sm py-2">오늘 소식으로</Link>
      </section>
    );
  }

  if (ev.kind === "mission" && p?.mission)
    return (
      <section className="space-y-4 pt-2">
        <h1 className="text-2xl font-bold">
          {p.emoji} {p.name} 미션
        </h1>
        <MissionCard eventId={ev.id} mission={p.mission} />
      </section>
    );

  if (ev.kind === "stamp" && p) {
    const rare = payload.rare as string | undefined;
    return (
      <section className="pt-6 text-center space-y-3">
        <Image src={`/stamps/${p.id}${rare && p.id === "thearc" ? "_rain" : ""}.webp`} alt={`${p.name} 도장`} width={260} height={260} className="mx-auto" />
        <h1 className="text-2xl font-bold">{p.name}</h1>
        <p className="text-sub">
          {payload.number ? `${String(payload.number)}번째 도장` : ""} {rare ? `· 희귀 도장 '${rare}'` : ""}
        </p>
      </section>
    );
  }

  if (ev.kind === "summary") {
    const s = payload as { stamps?: number; rare?: number; km?: number; places?: string[] };
    const visited = (s.places ?? []).map((id) => PLACES[id]).filter(Boolean);
    const text = `오늘 도장 ${s.stamps ?? 0}개${s.rare ? ` · 희귀 ${s.rare}` : ""}${s.km ? ` · ${Math.round(s.km)}km` : ""}`;
    return (
      <section className="pt-2 space-y-5">
        <div className="rounded-3xl bg-primary text-white p-6 shadow-xl">
          <p className="text-sm opacity-70">
            {new Date(ev.created_at).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" })}
          </p>
          <p className="mt-2 text-3xl font-bold leading-tight">
            오늘 도장
            <br />
            {s.stamps ?? 0}개 쾅!
          </p>
          <div className="mt-5 grid grid-cols-4 gap-2">
            {visited.map((v) => (
              <Image key={v.id} src={`/stamps/${v.id}.webp`} alt={v.name} width={72} height={72} className="rounded-full bg-white/10" />
            ))}
          </div>
          <p className="mt-5 text-sm opacity-80">
            {[s.rare ? `희귀 ${s.rare}` : "", s.km ? `${Math.round(s.km)}km 달림` : ""].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-4 text-xs opacity-60">마일스탬프 · 차가 찍어 준 가족 나들이 도장</p>
        </div>
        <ShareButton title="오늘 우리 가족 나들이" text={text} />
      </section>
    );
  }

  notFound();
}
