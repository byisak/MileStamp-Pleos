import { sql } from "./db";
import { kst } from "./kst";
import { AiError } from "./ai-image";
import { aiTextMock, chatText } from "./ai-text";
import { pushToCar } from "./push";
import type { CourseJson, OptionJson } from "./livecourse";
import {
  buildFacts, checkStory, fallbackStory, needsStory, parseStoryJson, storyPrompt, storyView, TONES,
  type DiaryFacts, type DiaryRaw, type StoredStory, type Tone,
} from "./diary-shape";

/*
 * '그날의 기록' — DB 쪽 (모양·글은 diary-shape.ts). 표 diaries(car_id, day): depart_min(처음 출발 기록) · story(글 jsonb).
 *   표가 아직 없으면(운영에 schema.sql 반영 전) 읽기는 빈 값, 쓰기는 조용히 건너뛴다 → 사실·기본 문장만 보인다.
 */

export type DiaryView = {
  day: string; facts: DiaryFacts;
  story: ReturnType<typeof storyView>;
  done: boolean;
};

type DiaryRow = { depart_min: number | null; story: StoredStory | null };

async function diaryRow(carId: string, day: string): Promise<DiaryRow | null> {
  try {
    const [r] = await sql<DiaryRow[]>`select depart_min, story from diaries where car_id = ${carId} and day = ${day}::date`;
    return r ?? null;
  } catch {
    return null; // 표 없음
  }
}

/** 그날 사실 모으기 (코스·도장·머무름·다녀옴·요약·하늘·출발 기록) */
export async function loadFacts(carId: string, day: string, now = new Date()): Promise<{ facts: DiaryFacts; row: DiaryRow | null }> {
  const today = kst(now).day;
  const from = sql`(${day}::date::timestamp at time zone 'Asia/Seoul')`;
  const to = sql`((${day}::date + 1)::timestamp at time zone 'Asia/Seoul')`;
  const [plans, stamps, summary, dwell, ext, row] = await Promise.all([
    sql<{ course: CourseJson | null; options: OptionJson[]; chosen: number | null; sky: DiaryRaw["sky"]; companion: string | null }[]>`
      select course, options, chosen, sky, companion from plans
      where car_id = ${carId} and day = ${day}::date
      order by (course is not null) desc, created_at desc limit 1`,
    sql<{ id: string; place_id: string | null; payload: Record<string, unknown>; created_at: Date }[]>`
      select id, place_id, payload, created_at from events
      where car_id = ${carId} and kind = 'stamp' and created_at >= ${from} and created_at < ${to}
      order by created_at`,
    sql<{ created_at: Date; payload: Record<string, unknown> }[]>`
      select created_at, payload from events
      where car_id = ${carId} and kind = 'summary' and created_at >= ${from} and created_at < ${to}
      order by created_at desc limit 1`,
    sql<{ place_id: string; arrive_min: number; depart_min: number }[]>`
      select place_id, arrive_min, depart_min from dwell_visits where car_id = ${carId} and day = ${day}::date`.catch(() => []),
    sql<{ ext_id: string; name: string; lat: number | null; lng: number | null; visited_at: Date }[]>`
      select ext_id, name, lat, lng, visited_at from visits_ext where family_id = ${carId} and day = ${day}::date`.catch(() => []),
    diaryRow(carId, day),
  ]);
  const plan = plans[0] ?? null;
  const option = plan && plan.chosen != null && Array.isArray(plan.options) ? plan.options[plan.chosen] ?? null : null;
  // 이름·좌표: 명소·축제 표 (코스·소식에 실린 이름이 먼저)
  const ids = new Set<string>([...(plan?.course?.stops ?? []).map((s) => s.placeId), ...stamps.map((s) => s.place_id ?? ""), ...dwell.map((d) => d.place_id)]);
  ids.delete("");
  const known = new Map<string, { name: string; lat: number | null; lng: number | null }>();
  if (ids.size) {
    const list = [...ids];
    const [ps, fs] = await Promise.all([
      sql<{ id: string; name: string; lat: number; lng: number }[]>`select id, name, lat, lng from places where id in ${sql(list)}`.catch(() => []),
      sql<{ id: string; name: string; lat: number | null; lng: number | null }[]>`select id, name, lat, lng from festivals where id in ${sql(list)}`.catch(() => []),
    ]);
    for (const p of [...fs, ...ps]) known.set(p.id, { name: p.name, lat: p.lat, lng: p.lng });
  }
  const facts = buildFacts({
    day, today, course: plan?.course ?? null, option, sky: plan?.sky ?? null, companion: plan?.companion ?? null,
    stamps, dwell, ext, summary: summary[0] ?? null, departMin: row?.depart_min ?? null,
    nameOf: (id) => known.get(id),
  });
  return { facts, row };
}

/** AI로 글 쓰기 — 말투마다 검사를 통과한 것만, 못 쓰면 그 말투는 기본 문장(by 'facts'). */
export async function writeStories(facts: DiaryFacts, tones: readonly Tone[]): Promise<Partial<Record<Tone, { text: string; by: "ai" | "facts" }>>> {
  const out: Partial<Record<Tone, { text: string; by: "ai" | "facts" }>> = {};
  let got: Partial<Record<Tone, unknown>> = {};
  if (!aiTextMock()) {
    try {
      const p = storyPrompt(facts, tones);
      got = parseStoryJson(await chatText(p.system, p.user, { feature: "diary" }));
    } catch (e) {
      if (!(e instanceof AiError) || e.code !== "nokey") console.error("일기 글 AI 실패", (e as Error).message);
    }
  }
  for (const t of tones) {
    const ok = checkStory(got[t], facts, t);
    out[t] = ok ? { text: ok, by: "ai" } : { text: fallbackStory(facts, t), by: "facts" };
  }
  return out;
}

async function saveStory(carId: string, day: string, story: StoredStory): Promise<boolean> {
  try {
    await sql`
      insert into diaries (car_id, day, story, updated_at) values (${carId}, ${day}::date, ${sql.json(story as never)}, now())
      on conflict (car_id, day) do update set story = excluded.story, updated_at = now()`;
    return true;
  } catch (e) {
    console.error("일기 저장 실패", (e as Error).message);
    return false;
  }
}

/**
 * 그날 일기. 나들이가 끝났으면(집 도착 기록 또는 지난 날) 글을 하루 한 번 만들어 저장한다.
 * 기본 문장으로 저장된 글은 1시간 뒤 다시 AI로 시도(사람이 고친 글은 그대로).
 */
export async function getDiary(carId: string, day: string, now = new Date()): Promise<DiaryView & { fresh: boolean }> {
  const { facts, row } = await loadFacts(carId, day, now);
  let story: StoredStory | null = row?.story ?? null;
  let fresh = false;
  if (facts.done && (facts.stops.length || facts.stamps.length)) {
    const want = TONES.filter((t) => needsStory(story?.[t], now));
    if (want.length) {
      const wrote = await writeStories(facts, want);
      const at = now.toISOString();
      const next: StoredStory = { ...(story ?? {}) };
      for (const t of want) {
        const w = wrote[t]!;
        // 기본 문장 → 기본 문장이면 시각만 바꾸지 않는다(1시간마다 다시 시도하도록 처음 시각 유지)
        if (w.by === "facts" && story?.[t]?.by === "facts") continue;
        next[t] = { text: w.text, by: w.by, at };
      }
      story = next;
      fresh = true;
      await saveStory(carId, day, story);
    }
  }
  return { day, facts, story: storyView(facts.done ? story : null), done: facts.done, fresh };
}

/** '다시 쓰기' — 그 말투만 새로 (사람이 고친 글도 바꿈) */
export async function regenDiary(carId: string, day: string, tone: Tone, now = new Date()): Promise<{ ok: true; view: DiaryView } | { ok: false; status: number; error: string }> {
  const { facts, row } = await loadFacts(carId, day, now);
  if (!facts.done) return { ok: false, status: 409, error: "나들이가 끝나면 쓸 수 있어요" };
  const w = (await writeStories(facts, [tone]))[tone]!;
  const story: StoredStory = { ...(row?.story ?? {}), [tone]: { text: w.text, by: w.by, at: now.toISOString() } };
  await saveStory(carId, day, story);
  return { ok: true, view: { day, facts, story: storyView(story), done: true } };
}

/** 사람이 고친 글 저장 */
export async function editDiary(carId: string, day: string, tone: Tone, text: string, now = new Date()): Promise<{ ok: true; view: DiaryView } | { ok: false; status: number; error: string }> {
  const { facts, row } = await loadFacts(carId, day, now);
  if (!facts.done) return { ok: false, status: 409, error: "나들이가 끝나면 고칠 수 있어요" };
  const story: StoredStory = { ...(row?.story ?? {}), [tone]: { text, by: "edit", at: now.toISOString() } };
  if (!(await saveStory(carId, day, story))) return { ok: false, status: 503, error: "지금은 저장할 수 없어요" };
  return { ok: true, view: { day, facts, story: storyView(story), done: true } };
}

/** 그날 처음 출발 기록 (코스 사건 Departed — 아직 들른 곳이 없을 때). 이미 있으면 그대로. 표가 없으면 건너뜀 */
export async function recordDepart(carId: string, day: string, min: number) {
  try {
    await sql`
      insert into diaries (car_id, day, depart_min) values (${carId}, ${day}::date, ${min})
      on conflict (car_id, day) do update set depart_min = coalesce(diaries.depart_min, excluded.depart_min), updated_at = now()`;
  } catch {
    /* 표 없음 */
  }
}

/**
 * 집 도착(차의 오늘 요약)을 받은 뒤: 일기를 만들고 가족 폰에 알림 하나 '오늘의 나들이 일기가 완성됐어요'.
 * 들른 곳·도장이 없으면 알리지 않는다.
 */
export async function completeDiary(carId: string, now = new Date()): Promise<number> {
  const day = kst(now).day;
  const v = await getDiary(carId, day, now);
  if (!v.done || !v.fresh || !(v.facts.stops.length || v.facts.stamps.length)) return 0;
  const first = (v.story.parent ?? "").split(/(?<=[.!?요])\s/)[0]?.slice(0, 60) ?? "";
  return pushToCar(
    carId,
    { title: "오늘의 나들이 일기가 완성됐어요", body: first || "도장북에서 그날의 기록을 볼 수 있어요", url: "/", tag: "diary" },
    { kind: "diary", day },
  ).catch(() => 0);
}
