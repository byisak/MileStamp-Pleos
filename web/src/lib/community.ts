import { sql } from "./db";
import { place } from "./places";
import { pushToCar } from "./push";
import { moderate } from "./community-moderation";
import { albumKeyOf, RARE_NIGHT } from "./arrive";
import {
  CLAP_PUSH_AT, DAILY_POST_LIMIT, ICONS, PULSE_MIN_FAMILIES, REGION, TIP_TAGS,
  decodeCursor, dropBlocked, encodeCursor, kstDayStart, roundPulse, shouldAutoHide, suggestHandle, toFeedPost, visibleAtFor,
  type FeedPost, type PostRow, type Pulse, type ReactionKind, type ReportReason,
} from "./community-shape";

/*
 * '함께'(커뮤니티 1단계) DB 쪽. 규칙은 community-shape.ts, 검사는 community-moderation.ts.
 * 표: community_profiles · posts · reactions · reports · blocks (schema.sql 끝 절, migrate-2026-11-02-community.sql)
 * 개인정보: 응답에 차·폰 id·좌표·정확한 시각을 넣지 않는다(toFeedPost). 글은 집 도착 뒤(또는 2시간 뒤)에 보인다.
 */

export class CommunityError extends Error {
  constructor(msg: string, public status = 400, public code = "bad") { super(msg); }
}

export type Profile = { handle: string; icon: string; region: string; termsAt: string | null; hidden: boolean; banned: boolean };

type ProfileRow = { handle: string; icon: string; region: string; terms_at: Date | null; hidden_from_community: boolean; banned_at: Date | null };
const shapeProfile = (r: ProfileRow): Profile => ({
  handle: r.handle, icon: r.icon, region: r.region, termsAt: r.terms_at?.toISOString() ?? null, hidden: r.hidden_from_community, banned: !!r.banned_at,
});

export async function loadProfile(carId: string): Promise<Profile | null> {
  const [r] = await sql<ProfileRow[]>`
    select handle, icon, region, terms_at, hidden_from_community, banned_at from community_profiles where car_id = ${carId}`;
  return r ? shapeProfile(r) : null;
}

/** 아직 아무도 안 쓰는 추천 별명 (몇 번 해 보고 안 되면 숫자를 붙인다) */
export async function freeSuggestion(): Promise<{ handle: string; icon: string }> {
  for (let i = 0; i < 8; i++) {
    const s = suggestHandle();
    const [used] = await sql`select 1 from community_profiles where handle = ${s.handle}`;
    if (!used) return s;
  }
  const s = suggestHandle();
  return { handle: `${s.handle.slice(0, 7)}${Math.floor(Math.random() * 90 + 10)}`, icon: s.icon };
}

/** 별명·아이콘·동의·숨기기 저장. 처음이면 만든다(동의가 있어야 함). */
export async function saveProfile(carId: string, body: { handle?: unknown; icon?: unknown; acceptTerms?: unknown; hidden?: unknown }): Promise<Profile> {
  const cur = await loadProfile(carId);
  const handle = typeof body.handle === "string" ? body.handle.trim().replace(/\s+/g, " ") : undefined;
  const icon = typeof body.icon === "string" ? body.icon : undefined;
  if (icon !== undefined && !ICONS.includes(icon)) throw new CommunityError("고를 수 없는 아이콘이에요");
  if (handle !== undefined && handle !== cur?.handle) {
    const c = await moderate(handle, "handle");
    if (!c.ok) throw new CommunityError(c.message, 400, c.code);
    const [used] = await sql`select 1 from community_profiles where handle = ${handle} and car_id <> ${carId}`;
    if (used) throw new CommunityError("이미 다른 가족이 쓰는 별명이에요", 409, "taken");
  }
  if (!cur) {
    if (body.acceptTerms !== true) throw new CommunityError("이용 규칙에 동의해 주세요", 400, "terms");
    const s = handle ? { handle, icon: icon ?? "🌱" } : await freeSuggestion();
    try {
      await sql`
        insert into community_profiles (car_id, handle, icon, region, terms_at, hidden_from_community)
        values (${carId}, ${s.handle}, ${icon ?? s.icon}, ${REGION.code}, now(), ${body.hidden === true})`;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new CommunityError("이미 다른 가족이 쓰는 별명이에요", 409, "taken");
      throw e;
    }
  } else {
    await sql`
      update community_profiles set
        handle = ${handle ?? cur.handle},
        icon = ${icon ?? cur.icon},
        terms_at = ${body.acceptTerms === true ? sql`now()` : sql`terms_at`},
        hidden_from_community = ${typeof body.hidden === "boolean" ? body.hidden : cur.hidden}
      where car_id = ${carId}`;
  }
  return (await loadProfile(carId))!;
}

// ---------------- 글 ----------------

/** 지금 올리면 언제 보이나: 오늘 집 도착이 있고 그 뒤 새 도장이 없으면 바로, 아니면 2시간 뒤 */
export async function visibleAtNow(carId: string, now = new Date()): Promise<Date> {
  const start = kstDayStart(now);
  const [r] = await sql<{ summary_at: Date | null; stamp_at: Date | null }[]>`
    select max(created_at) filter (where kind = 'summary') as summary_at,
           max(created_at) filter (where kind = 'stamp') as stamp_at
    from events where car_id = ${carId} and created_at >= ${start} and kind in ('summary', 'stamp')`;
  return visibleAtFor({ now, summaryAt: r?.summary_at ?? null, lastStampAt: r?.stamp_at ?? null });
}

/** 집 도착(오늘 요약) 소식이 오면 기다리던 글을 지금 보이게. 표가 없어도(운영 반영 전) 조용히 넘어간다. */
export async function releasePending(carId: string): Promise<number> {
  try {
    const r = await sql`update posts set visible_at = now() where car_id = ${carId} and status = 'visible' and visible_at > now()`;
    return r.count;
  } catch (e) {
    if ((e as { code?: string }).code !== "42P01") console.error("함께 글 보이기 실패", (e as Error).message);
    return 0;
  }
}

type NewPost = {
  kind?: unknown; placeId?: unknown; festivalId?: unknown; rare?: unknown; eventId?: unknown;
  text?: unknown; good?: unknown; tags?: unknown;
};

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

async function placeName(id: string): Promise<string | null> {
  const p = place(id);
  if (p) return p.name;
  const [r] = await sql<{ name: string }[]>`
    select name from places where id = ${id} union all select name from festivals where id = ${id} limit 1`;
  return r?.name ?? null;
}

export async function createPost(phone: { id: string; car_id: string }, body: NewPost, now = new Date()): Promise<FeedPost> {
  const carId = phone.car_id;
  const prof = await loadProfile(carId);
  if (!prof?.termsAt) throw new CommunityError("함께 이용 규칙에 먼저 동의해 주세요", 403, "terms");
  if (prof.banned) throw new CommunityError("함께에 글을 올릴 수 없는 상태예요. 문의해 주세요", 403, "banned");
  const kind = body.kind;
  if (kind !== "stamp" && kind !== "trip" && kind !== "tip") throw new CommunityError("올릴 수 없는 종류예요");

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const check = await moderate(text, "post");
  if (!check.ok) throw new CommunityError(check.message, 400, check.code);

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from posts where car_id = ${carId} and created_at >= ${kstDayStart(now)}`;
  if (n >= DAILY_POST_LIMIT) throw new CommunityError(`함께에는 하루 ${DAILY_POST_LIMIT}번까지 올릴 수 있어요`, 429, "limit");

  let placeId: string | null = null, eventId: string | null = null;
  let medal: Record<string, unknown> | null = null, places: { id: string | null; name: string }[] | null = null, tip: Record<string, unknown> | null = null;

  if (kind === "stamp") {
    const fid = typeof body.festivalId === "string" && body.festivalId ? body.festivalId : null;
    const pid = fid ?? (typeof body.placeId === "string" ? body.placeId : "");
    if (!pid) throw new CommunityError("어느 도장인지 알려 주세요");
    const rare = body.rare === true && !fid;
    const [ev] = await sql<{ id: string; payload: Record<string, unknown> }[]>`
      select id, payload from events
      where car_id = ${carId} and kind = 'stamp' and place_id = ${pid}
        ${rare ? sql`and coalesce(payload->>'rare', '') <> ''` : sql``}
      order by created_at desc limit 1`;
    if (!ev) throw new CommunityError("이 도장을 받은 기록이 없어요", 400, "nostamp");
    const [dup] = await sql`select 1 from posts where event_id = ${ev.id} and kind = 'stamp' and status <> 'removed'`;
    if (dup) throw new CommunityError("이 도장은 이미 함께에 올렸어요", 409, "dup");
    const name = (await placeName(pid)) ?? "도장";
    const rareText = typeof ev.payload.rare === "string" && ev.payload.rare ? ev.payload.rare : null;
    placeId = pid; eventId = ev.id;
    const night = rareText === RARE_NIGHT;
    medal = {
      name: night ? `밤의 ${name}` : rareText && pid === "thearc" ? `${rareText} ${name}` : name,
      tier: fid ? "legend" : rareText ? "rare" : "common",
      rare: rareText,
      festivalId: fid,
      artKey: fid ? pid : albumKeyOf(pid, rareText),
    };
  } else if (kind === "trip") {
    const [ev] = isUuid(body.eventId)
      ? await sql<{ id: string; payload: Record<string, unknown> }[]>`
          select id, payload from events where id = ${body.eventId} and car_id = ${carId} and kind = 'summary'`
      : await sql<{ id: string; payload: Record<string, unknown> }[]>`
          select id, payload from events where car_id = ${carId} and kind = 'summary' order by created_at desc limit 1`;
    if (!ev) throw new CommunityError("다녀온 기록을 찾지 못했어요", 400, "nosummary");
    const [dup] = await sql`select 1 from posts where event_id = ${ev.id} and kind = 'trip' and status <> 'removed'`;
    if (dup) throw new CommunityError("이 나들이는 이미 함께에 올렸어요", 409, "dup");
    const ids = Array.isArray(ev.payload.places) ? (ev.payload.places as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 6) : [];
    // 우리 명소·축제만 이름으로 (바깥 장소 id·좌표는 싣지 않음)
    const named = await Promise.all(ids.filter((id) => !id.startsWith("ext:")).map(async (id) => ({ id, name: await placeName(id) })));
    places = named.filter((x): x is { id: string; name: string } => !!x.name);
    if (!places.length) throw new CommunityError("올릴 수 있는 장소가 없어요", 400, "noplaces");
    eventId = ev.id;
    medal = { stamps: Math.max(0, Math.min(20, Number(ev.payload.stamps) || 0)) };
  } else {
    const pid = typeof body.placeId === "string" ? body.placeId : "";
    const name = pid ? await placeName(pid) : null;
    if (!name) throw new CommunityError("어느 장소인지 알려 주세요");
    const [ev] = await sql<{ id: string }[]>`
      select id from events where car_id = ${carId} and kind = 'stamp' and place_id = ${pid} order by created_at desc limit 1`;
    if (!ev) throw new CommunityError("다녀온 곳만 한줄팁을 남길 수 있어요", 400, "nostamp");
    const tags = Array.isArray(body.tags) ? [...new Set(body.tags.filter((x): x is string => (TIP_TAGS as readonly string[]).includes(x as string)))] : [];
    if (body.good !== true && body.good !== false) throw new CommunityError("👍 또는 👎를 골라 주세요");
    placeId = pid; eventId = ev.id;
    tip = { good: body.good, tags };
  }

  const visibleAt = await visibleAtNow(carId, now);
  const [row] = await sql<{ id: string }[]>`
    insert into posts (car_id, phone_id, kind, place_id, event_id, medal, places, text, tip, region, visible_at)
    values (${carId}, ${phone.id}, ${kind}, ${placeId}, ${eventId}, ${medal ? sql.json(medal as never) : null},
            ${places ? sql.json(places as never) : null}, ${text}, ${tip ? sql.json(tip as never) : null}, ${prof.region}, ${visibleAt})
    returning id`;
  return (await one(carId, row.id))!;
}

export async function deletePost(carId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await sql`update posts set status = 'removed', hidden_reason = 'owner' where id = ${id} and car_id = ${carId} and status <> 'removed'`;
  return r.count > 0;
}

// ---------------- 목록 ----------------

// postgres.js 조각 (sql`...`를 다른 쿼리 안에 끼움)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Frag = any;

/** 글 줄 읽기 (반응 수·내 반응·별명·폰 이름·장소 이름). where는 p.* 조건, includeOwnPending이면 내 기다리는 글도.
 *  visibleAt은 커서용으로만 (응답 글에는 안 나감) */
async function selectPosts(me: string, where: Frag, limit: number, includeOwnPending: boolean, demoViewer = true): Promise<{ post: FeedPost; visibleAt: Date }[]> {
  const now = new Date();
  const [rows, blockedRows] = await Promise.all([sql<PostRow[]>`
    select p.id, p.car_id, p.kind, p.operator, p.place_id, p.medal, p.places, p.text, p.tip, p.visible_at, p.created_at,
           cp.handle, cp.icon, ph.nickname,
           coalesce((select name from places where id = p.place_id), (select name from festivals where id = p.place_id)) as place_name,
           coalesce(rx.clap, 0) as clap, coalesce(rx.want, 0) as want, coalesce(rx.save, 0) as save,
           coalesce(rx.my_clap, false) as my_clap, coalesce(rx.my_want, false) as my_want, coalesce(rx.my_save, false) as my_save
    from posts p
    left join community_profiles cp on cp.car_id = p.car_id
    left join phones ph on ph.id = p.phone_id
    left join cars c on c.id = p.car_id
    left join lateral (
      select count(*) filter (where r.kind = 'clap')::int as clap,
             count(*) filter (where r.kind = 'want')::int as want,
             count(*) filter (where r.kind = 'save')::int as save,
             bool_or(r.kind = 'clap' and r.car_id = ${me}) as my_clap,
             bool_or(r.kind = 'want' and r.car_id = ${me}) as my_want,
             bool_or(r.kind = 'save' and r.car_id = ${me}) as my_save
      from reactions r where r.post_id = p.id
    ) rx on true
    where ${where}
      and p.status = 'visible'
      and (p.visible_at <= now() ${includeOwnPending ? sql`or p.car_id = ${me}` : sql``})
      and (p.car_id is null or (cp.car_id is not null and cp.banned_at is null and (not cp.hidden_from_community or p.car_id = ${me})))
      and (${demoViewer} or p.car_id is null or not c.demo)
      and not exists (select 1 from blocks b where b.car_id = ${me} and b.blocked_car_id = p.car_id)
    order by p.visible_at desc, p.id desc
    limit ${limit}`,
    sql<{ id: string }[]>`select blocked_car_id::text as id from blocks where car_id = ${me}`,
  ]);
  // 가린 가족은 SQL에서도 빼지만, 응답 직전에 한 번 더 (규칙 시험: community.test.ts)
  return dropBlocked(rows, new Set(blockedRows.map((b) => b.id))).map((r) => ({ post: toFeedPost(r, { me, now }), visibleAt: r.visible_at }));
}

export const PAGE = 20;

export async function feed(me: { carId: string; demo: boolean }, cursor: string | null): Promise<{ posts: FeedPost[]; nextCursor: string | null }> {
  const c = decodeCursor(cursor);
  const where = c
    ? sql`p.region = ${REGION.code} and (p.visible_at, p.id) < (${c.at}, ${c.id}::uuid)`
    : sql`p.region = ${REGION.code}`;
  const rows = await selectPosts(me.carId, where, PAGE + 1, true, me.demo);
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  return { posts: page.map((x) => x.post), nextCursor: more && last ? encodeCursor(last.visibleAt, last.post.id) : null };
}

const one = async (me: string, id: string, demo = true) => (await selectPosts(me, sql`p.id = ${id}`, 1, true, demo))[0]?.post;

/** 📌 담은 글 (최근 담은 순) */
export async function savedPosts(me: { carId: string; demo: boolean }): Promise<FeedPost[]> {
  const posts = (await selectPosts(me.carId,
    sql`exists (select 1 from reactions s where s.post_id = p.id and s.car_id = ${me.carId} and s.kind = 'save')`, 100, true, me.demo)).map((x) => x.post);
  const order = await sql<{ post_id: string }[]>`
    select post_id from reactions where car_id = ${me.carId} and kind = 'save' order by created_at desc`;
  const rank = new Map(order.map((o, i) => [o.post_id, i]));
  return posts.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

// ---------------- 반응·신고·가리기 ----------------

export async function react(me: { carId: string; demo: boolean }, postId: string, kind: ReactionKind, on: boolean): Promise<FeedPost> {
  if (!isUuid(postId)) throw new CommunityError("없는 글이에요", 404, "notfound");
  const p = await one(me.carId, postId, me.demo);
  if (!p) throw new CommunityError("없는 글이에요", 404, "notfound");
  if (on) {
    const ins = await sql`insert into reactions (post_id, car_id, kind) values (${postId}, ${me.carId}, ${kind}) on conflict do nothing`;
    if (ins.count && kind === "clap") await clapPush(postId, me.carId).catch((e) => console.error("함께 반응 알림 실패", (e as Error).message));
  } else {
    await sql`delete from reactions where post_id = ${postId} and car_id = ${me.carId} and kind = ${kind}`;
  }
  return (await one(me.carId, postId, me.demo))!;
}

/** 👏가 1·5·10번째일 때만 글쓴이 가족에게 알림 하나 (스스로 누른 건 빼고) */
async function clapPush(postId: string, by: string) {
  const [p] = await sql<{ car_id: string | null; kind: string; n: number }[]>`
    select p.car_id, p.kind, (select count(*)::int from reactions r where r.post_id = p.id and r.kind = 'clap' and r.car_id <> p.car_id) as n
    from posts p where p.id = ${postId}`;
  if (!p?.car_id || p.car_id === by || !CLAP_PUSH_AT.includes(p.n)) return;
  const word = p.kind === "tip" ? "도움됐대요" : "축하해 줬어요";
  await pushToCar(p.car_id, {
    title: "함께",
    body: p.n === 1 ? `함께에 올린 글에 첫 반응이 왔어요 · 다른 가족이 ${word}` : `함께에 올린 글에 ${p.n}가족이 ${word}`,
    url: "/", tag: "community",
  }, { kind: "community" });
}

export async function report(me: string, body: { postId?: unknown; handle?: unknown; reason?: unknown }): Promise<{ hidden: boolean }> {
  const reason = body.reason as ReportReason;
  if (!["spam", "abuse", "privacy", "child_safety", "other"].includes(reason)) throw new CommunityError("신고 이유를 골라 주세요");
  // 별명 신고 (글 없이): 기록만 — 관리자가 보고 정지
  if (!body.postId && typeof body.handle === "string") {
    const [who] = await sql<{ car_id: string }[]>`select car_id from community_profiles where handle = ${body.handle.trim()}`;
    if (!who) throw new CommunityError("없는 별명이에요", 404, "notfound");
    if (who.car_id === me) throw new CommunityError("우리 가족은 신고할 수 없어요");
    await sql`insert into reports (target_car_id, reporter_car_id, reason) values (${who.car_id}, ${me}, ${reason})`;
    return { hidden: false };
  }
  if (!isUuid(body.postId)) throw new CommunityError("없는 글이에요", 404, "notfound");
  const [p] = await sql<{ id: string; car_id: string | null; status: string }[]>`select id, car_id, status from posts where id = ${body.postId}`;
  if (!p) throw new CommunityError("없는 글이에요", 404, "notfound");
  if (p.car_id === me) throw new CommunityError("내 글은 신고할 수 없어요");
  await sql`
    insert into reports (post_id, target_car_id, reporter_car_id, reason) values (${p.id}, ${p.car_id}, ${me}, ${reason})
    on conflict (post_id, reporter_car_id) where post_id is not null do update set reason = excluded.reason, created_at = now(), resolved_at = null`;
  const rs = await sql<{ reporter: string; reason: string }[]>`
    select reporter_car_id::text as reporter, reason from reports where post_id = ${p.id} and resolved_at is null`;
  if (p.status === "visible" && shouldAutoHide(rs)) {
    await sql`update posts set status = 'hidden', hidden_reason = 'reports' where id = ${p.id} and status = 'visible'`;
    return { hidden: true };
  }
  return { hidden: p.status !== "visible" };
}

/** 이 가족 가리기 — 글 id로 (차 id는 폰에 안 나가므로) */
export async function block(me: string, postId: unknown): Promise<void> {
  if (!isUuid(postId)) throw new CommunityError("없는 글이에요", 404, "notfound");
  const [p] = await sql<{ car_id: string | null }[]>`select car_id from posts where id = ${postId}`;
  if (!p) throw new CommunityError("없는 글이에요", 404, "notfound");
  if (!p.car_id) throw new CommunityError("운영팀 글은 가릴 수 없어요");
  if (p.car_id === me) throw new CommunityError("우리 가족은 가릴 수 없어요");
  await sql`insert into blocks (car_id, blocked_car_id) values (${me}, ${p.car_id}) on conflict do nothing`;
}

// ---------------- 이번 주 우리 지역 ----------------

/** 지난 7일(오늘 빼고 — 하루 늦게) 도장: 가족 수·도장 수·많이 간 곳 4. 데모 차 빼고, 하루 한 번 tour_cache에 저장. */
export async function regionPulse(now = new Date()): Promise<Pulse | null> {
  const start = kstDayStart(now);
  const key = `community-pulse:${start.toISOString().slice(0, 10)}`;
  try {
    const [hit] = await sql<{ data: { pulse: Pulse | null } }[]>`select data from tour_cache where key = ${key}`;
    if (hit) return hit.data.pulse;
    const from = new Date(start.getTime() - 7 * 86400_000);
    const [tot] = await sql<{ families: number; stamps: number }[]>`
      select count(distinct e.car_id)::int as families, count(*)::int as stamps
      from events e join cars c on c.id = e.car_id
      where e.kind = 'stamp' and not c.demo and e.created_at >= ${from} and e.created_at < ${start}`;
    let pulse: Pulse | null = null;
    if (tot && tot.families >= PULSE_MIN_FAMILIES) {
      const top = await sql<{ id: string; families: number }[]>`
        select e.place_id as id, count(distinct e.car_id)::int as families
        from events e join cars c on c.id = e.car_id
        where e.kind = 'stamp' and not c.demo and e.place_id is not null and e.created_at >= ${from} and e.created_at < ${start}
        group by e.place_id order by families desc, e.place_id limit 4`;
      const named = await Promise.all(top.map(async (t) => ({ id: t.id, name: (await placeName(t.id)) ?? t.id, families: t.families })));
      pulse = { ...roundPulse(tot.families, tot.stamps), top: named };
    }
    await sql`
      insert into tour_cache (key, data, fetched_at) values (${key}, ${sql.json({ pulse } as never)}, now())
      on conflict (key) do update set data = excluded.data, fetched_at = now()`;
    return pulse;
  } catch (e) {
    console.error("이번 주 우리 지역 실패", (e as Error).message);
    return null;
  }
}

// ---------------- 관리자 ----------------

export type AdminPost = {
  id: string; kind: string; status: string; hiddenReason: string | null; text: string; placeName: string | null;
  handle: string | null; banned: boolean; operator: boolean; createdAt: string;
  reports: { reason: string; n: number }[]; reportCount: number;
};

/** 숨겨졌거나 처리 안 된 신고가 있는 글 (+ 운영팀 글) */
export async function adminReported(): Promise<AdminPost[]> {
  const rows = await sql<{ id: string; kind: string; status: string; hidden_reason: string | null; text: string; place_name: string | null; medal: { name?: string } | null;
    handle: string | null; banned_at: Date | null; operator: boolean; created_at: Date; reasons: { reason: string; n: number }[] | null; report_count: number }[]>`
    select p.id, p.kind, p.status, p.hidden_reason, p.text, p.medal, p.operator, p.created_at, cp.handle, cp.banned_at,
           coalesce((select name from places where id = p.place_id), (select name from festivals where id = p.place_id)) as place_name,
           (select jsonb_agg(jsonb_build_object('reason', reason, 'n', n)) from (
              select reason, count(*)::int as n from reports r where r.post_id = p.id and r.resolved_at is null group by reason) x) as reasons,
           (select count(*)::int from reports r where r.post_id = p.id and r.resolved_at is null) as report_count
    from posts p left join community_profiles cp on cp.car_id = p.car_id
    where p.status = 'hidden' or p.operator
       or exists (select 1 from reports r where r.post_id = p.id and r.resolved_at is null)
    order by (p.status = 'hidden') desc, p.operator, p.created_at desc
    limit 200`;
  return rows.map((r) => ({
    id: r.id, kind: r.kind, status: r.status, hiddenReason: r.hidden_reason, text: r.text, placeName: r.place_name ?? r.medal?.name ?? null,
    handle: r.handle, banned: !!r.banned_at, operator: r.operator, createdAt: r.created_at.toISOString(),
    reports: r.reasons ?? [], reportCount: r.report_count,
  }));
}

/** 글 없이 별명으로 들어온 신고 (처리 안 된 것) */
export async function adminHandleReports(): Promise<{ handle: string; banned: boolean; reasons: string[]; n: number }[]> {
  const rows = await sql<{ handle: string; banned_at: Date | null; reasons: string[]; n: number }[]>`
    select cp.handle, cp.banned_at, array_agg(distinct r.reason) as reasons, count(*)::int as n
    from reports r join community_profiles cp on cp.car_id = r.target_car_id
    where r.post_id is null and r.resolved_at is null
    group by cp.handle, cp.banned_at order by n desc limit 100`;
  return rows.map((r) => ({ handle: r.handle, banned: !!r.banned_at, reasons: r.reasons, n: r.n }));
}

export async function adminAct(postId: string, action: "restore" | "remove" | "ban" | "unban"): Promise<void> {
  if (!isUuid(postId)) throw new CommunityError("없는 글이에요", 404);
  if (action === "restore") {
    await sql`update posts set status = 'visible', hidden_reason = null where id = ${postId}`;
    await sql`update reports set resolved_at = now() where post_id = ${postId} and resolved_at is null`;
  } else if (action === "remove") {
    await sql`update posts set status = 'removed', hidden_reason = 'admin' where id = ${postId}`;
    await sql`update reports set resolved_at = now() where post_id = ${postId} and resolved_at is null`;
  } else {
    const [p] = await sql<{ car_id: string | null }[]>`select car_id from posts where id = ${postId}`;
    if (!p?.car_id) throw new CommunityError("운영팀 글이에요");
    await sql`update community_profiles set banned_at = ${action === "ban" ? sql`now()` : null} where car_id = ${p.car_id}`;
  }
}

/** 운영팀 글 (장소는 우리 명소 id → 이름) */
export async function createNotice(text: string, placeIds: string[]): Promise<string> {
  const t = text.trim();
  if (!t || [...t].length > 140) throw new CommunityError("글은 1~140자예요");
  const places = (await Promise.all(placeIds.slice(0, 5).map(async (id) => ({ id, name: await placeName(id) })))).filter((p) => p.name);
  const [r] = await sql<{ id: string }[]>`
    insert into posts (car_id, kind, operator, text, places, region, visible_at)
    values (null, 'notice', true, ${t}, ${places.length ? sql.json(places as never) : null}, ${REGION.code}, now()) returning id`;
  return r.id;
}
