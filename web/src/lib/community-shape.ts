/*
 * '함께'(커뮤니티 1단계) — DB 없이 시험할 수 있는 규칙만 모은 곳 (proto/community-plan.html).
 *  - 보이는 시각(visibleAtFor) · 대충 시각 글(coarseWhen) · 글·별명 검사(checkText/checkHandle)
 *  - 자동 숨김 기준(shouldAutoHide) · 가린 가족 빼기(dropBlocked) · 응답 모양(toFeedPost — 좌표·차/폰 id 없음)
 */

export const REGION = { code: "dg-gb", label: "대구·경북" } as const;
export type PostKind = "stamp" | "trip" | "tip" | "notice";
export type ReactionKind = "clap" | "want" | "save";
export const REACTIONS: ReactionKind[] = ["clap", "want", "save"];
export type ReportReason = "spam" | "abuse" | "privacy" | "child_safety" | "other";
export const REPORT_REASONS: ReportReason[] = ["spam", "abuse", "privacy", "child_safety", "other"];
export const TIP_TAGS = ["유모차 OK", "수유실", "주차 쉬움", "키즈존"] as const;
export const TEXT_MAX = 140;
export const DAILY_POST_LIMIT = 10;
/** 집 도착 소식이 없을 때 보이기까지 */
export const FALLBACK_DELAY_MS = 2 * 3600_000;
/** 반응 알림을 보내는 👏 수 (그 밖엔 조용히) */
export const CLAP_PUSH_AT = [1, 5, 10];

// ---------------- 보이는 시각 ----------------

/**
 * 글이 다른 가족에게 보이기 시작하는 때.
 * 오늘(한국 날짜) 집 도착(summary)이 이미 있고, 그 뒤로 새 도장이 없으면(= 집에 있음) 바로.
 * 아니면 지금 + 2시간 (그 사이 집 도착 소식이 오면 releasePending이 그때로 당긴다).
 */
export function visibleAtFor(o: { now: Date; summaryAt?: Date | null; lastStampAt?: Date | null }): Date {
  const { now, summaryAt, lastStampAt } = o;
  const home = !!summaryAt && sameKstDay(summaryAt, now) && summaryAt.getTime() <= now.getTime()
    && (!lastStampAt || lastStampAt.getTime() <= summaryAt.getTime());
  return home ? now : new Date(now.getTime() + FALLBACK_DELAY_MS);
}

function kstParts(d: Date) {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return { day: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}
function sameKstDay(a: Date, b: Date) { return kstParts(a).day === kstParts(b).day; }

/** 한국 날짜 0시(UTC 시각) */
export function kstDayStart(now: Date): Date {
  return new Date(`${kstParts(now).day}T00:00:00+09:00`);
}

// ---------------- 대충 시각 ----------------

/** '오늘 오전' · '오늘 오후' · '오늘 저녁' · '어제' · 'N일 전' · 'N주 전' · 'M월' — 정확한 시각은 안 보인다. */
export function coarseWhen(at: Date, now: Date): string {
  const a = kstParts(at), n = kstParts(now);
  const days = Math.round((Date.parse(n.day) - Date.parse(a.day)) / 86400_000);
  if (days <= 0) return a.hour < 12 ? "오늘 오전" : a.hour < 18 ? "오늘 오후" : "오늘 저녁";
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  if (days < 28) return `${Math.floor(days / 7)}주 전`;
  return `${Number(a.day.slice(5, 7))}월`;
}

// ---------------- 글·별명 검사 (키워드) ----------------

export type TextCheck = { ok: true } | { ok: false; code: "empty" | "long" | "abuse" | "phone" | "account" | "school" | "link" | "short" | "chars"; message: string };

// 욕설 기본 (자모 줄임 포함). 띄어쓰기·특수문자를 지운 글에서 찾는다.
const ABUSE = [
  "시발", "씨발", "씨빨", "시바ㄹ", "ㅅㅂ", "ㅆㅂ", "병신", "븅신", "ㅂㅅ", "개새끼", "개새기", "좆", "존나", "졸라", "ㅈㄴ",
  "지랄", "ㅈㄹ", "미친놈", "미친년", "미친새", "꺼져", "닥쳐", "느금", "니애미", "니미", "엠창", "fuck", "shit", "bitch",
];
// 학교·유치원·어린이집 이름 (앞에 이름이 붙은 것: '햇살어린이집', '대구초등학교')
const SCHOOL = /[가-힣A-Za-z0-9]+(초등학교|초교|중학교|유치원|어린이집)/;
// 전화번호 (휴대폰·지역번호, 띄어쓰기·점·줄표 허용)
const PHONE = /(01[016789]|0[2-6][0-9]?)[\s.\-]?\d{3,4}[\s.\-]?\d{4}/;
// 계좌번호처럼 보이는 것: 줄표로 이은 숫자 덩어리 3개 이상, 또는 숫자 10자리 이상
const ACCOUNT = /\d{2,6}-\d{2,6}-\d{2,8}|\d{10,}/;
const LINK = /https?:\/\/|www\.|open\.kakao|오픈채팅|카톡\s?아이디|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i;

const squash = (s: string) => s.toLowerCase().replace(/[\s.\-_*~!@#^&()·,'"`]/g, "");

/** 글(한마디·한줄팁) 검사. 서버가 최종 판단, 폰은 같은 규칙으로 미리 알려 준다. */
export function checkText(raw: string, opts: { required?: boolean } = {}): TextCheck {
  const text = raw.trim();
  if (!text) return opts.required ? { ok: false, code: "empty", message: "한마디를 적어 주세요" } : { ok: true };
  if ([...text].length > TEXT_MAX) return { ok: false, code: "long", message: `${TEXT_MAX}자까지 적을 수 있어요` };
  if (PHONE.test(text)) return { ok: false, code: "phone", message: "전화번호는 올릴 수 없어요. 우리 가족 정보를 지켜 주세요" };
  if (ACCOUNT.test(text.replace(/\s/g, ""))) return { ok: false, code: "account", message: "계좌번호처럼 보이는 숫자는 올릴 수 없어요" };
  if (SCHOOL.test(text.replace(/\s/g, ""))) return { ok: false, code: "school", message: "학교·유치원·어린이집 이름은 올리지 않아요. 아이가 드러날 수 있어요" };
  if (LINK.test(text)) return { ok: false, code: "link", message: "링크·연락처는 올릴 수 없어요" };
  const flat = squash(text);
  if (ABUSE.some((w) => flat.includes(w))) return { ok: false, code: "abuse", message: "고운 말로 다시 적어 주세요" };
  return { ok: true };
}

/** 가족 별명: 2~10자, 한글·영문·숫자·띄어쓰기만, 글 검사도 같이. */
export function checkHandle(raw: string): TextCheck {
  const h = raw.trim().replace(/\s+/g, " ");
  const n = [...h].length;
  if (n < 2) return { ok: false, code: "short", message: "별명은 2자 넘게 지어 주세요" };
  if (n > 10) return { ok: false, code: "long", message: "별명은 10자까지예요" };
  if (!/^[가-힣A-Za-z0-9 ]+$/.test(h)) return { ok: false, code: "chars", message: "별명은 한글·영문·숫자로만 지어 주세요" };
  if (/운영|관리자|마일스탬프|milestamp|admin/i.test(h)) return { ok: false, code: "chars", message: "운영팀으로 보이는 별명은 쓸 수 없어요" };
  const c = checkText(h);
  return c.ok ? { ok: true } : c;
}

/** 폰이 미리 알려 주는 '아이 이름 같아요' (막지는 않음 — 서버도 막지 않는다) */
export function looksLikeChildName(text: string): boolean {
  return /(우리|내|제)\s?(딸|아들|첫째|둘째|막내|쌍둥이)\s?[가-힣]{2,3}(이가|이는|이랑|이도|가|는|랑)?(\s|$)/.test(text);
}

// ---------------- 별명 추천 ----------------

export const HANDLE_WORDS: { w: string; icon: string }[] = [
  { w: "별빛", icon: "🌙" }, { w: "여우", icon: "🦊" }, { w: "고래", icon: "🐳" }, { w: "곰돌이", icon: "🐻" },
  { w: "다람쥐", icon: "🐿️" }, { w: "솔방울", icon: "🌲" }, { w: "햇살", icon: "☀️" }, { w: "바람", icon: "🍃" },
  { w: "토끼", icon: "🐰" }, { w: "펭귄", icon: "🐧" }, { w: "은하수", icon: "✨" }, { w: "도토리", icon: "🌰" },
  { w: "민들레", icon: "🌼" }, { w: "수달", icon: "🦦" }, { w: "부엉이", icon: "🦉" }, { w: "구름", icon: "☁️" },
  { w: "단풍", icon: "🍁" }, { w: "거북이", icon: "🐢" }, { w: "꿀벌", icon: "🐝" }, { w: "새싹", icon: "🌱" },
];
export const ICONS = [...new Set([...HANDLE_WORDS.map((x) => x.icon), "🐶", "🐱", "🦁", "🐼", "🐬", "🌈", "🍀", "🌻"])];

/** 별명 하나 추천: '{단어}가족' 또는 '{단어}네' + 아이콘. rnd는 시험용. */
export function suggestHandle(rnd: () => number = Math.random): { handle: string; icon: string } {
  const x = HANDLE_WORDS[Math.floor(rnd() * HANDLE_WORDS.length) % HANDLE_WORDS.length];
  return { handle: rnd() < 0.5 ? `${x.w}가족` : `${x.w}네`, icon: x.icon };
}

// ---------------- 신고·가리기 ----------------

/** 서로 다른 가족 3번, 또는 아이 안전 신고 1번이면 자동 숨김 */
export function shouldAutoHide(reports: { reporter: string; reason: string }[]): boolean {
  if (reports.some((r) => r.reason === "child_safety")) return true;
  return new Set(reports.map((r) => r.reporter)).size >= 3;
}

/** 가린 가족의 글 빼기 (DB에서도 거르지만, 한 번 더) */
export function dropBlocked<T extends { car_id: string | null }>(rows: T[], blocked: Set<string>): T[] {
  return rows.filter((r) => !r.car_id || !blocked.has(r.car_id));
}

// ---------------- 응답 모양 ----------------

export type PostRow = {
  id: string; car_id: string | null; kind: PostKind; operator: boolean; place_id: string | null;
  medal: { name?: string; tier?: string; rare?: string | null; festivalId?: string | null; artKey?: string; stamps?: number } | null;
  places: { id?: string | null; name: string }[] | null;
  text: string; tip: { good?: boolean; tags?: string[] } | null;
  visible_at: Date; created_at: Date;
  handle: string | null; icon: string | null; nickname: string | null; place_name: string | null;
  clap: number; want: number; save: number; my_clap: boolean; my_want: boolean; my_save: boolean;
};

export type FeedPost = {
  id: string;
  kind: PostKind;
  author: { handle: string; icon: string; phone: string | null; operator: boolean };
  mine: boolean;
  /** 내 글인데 아직 다른 가족에게 안 보임 ('집에 도착하면 함께에 보여요') */
  pending: boolean;
  when: string;
  text: string;
  place: { id: string; name: string } | null;
  stamp: { name: string; tier: "common" | "rare" | "legend"; stars: number; rare: string | null; artKey: string; festivalId: string | null } | null;
  trip: { places: { id: string | null; name: string }[]; stamps: number } | null;
  tip: { good: boolean; tags: string[] } | null;
  reactions: Record<ReactionKind, number>;
  my: Record<ReactionKind, boolean>;
};

const STARS = { common: 1, rare: 2, legend: 3 } as const;

/** DB 줄 → 폰에 보내는 글. 차·폰 id, 좌표, 정확한 시각은 넣지 않는다. */
export function toFeedPost(r: PostRow, ctx: { me: string; now: Date }): FeedPost {
  const operator = r.operator || !r.car_id;
  const tier = (r.medal?.tier === "rare" || r.medal?.tier === "legend" ? r.medal.tier : "common") as "common" | "rare" | "legend";
  const placeName = r.place_name ?? r.medal?.name ?? null;
  return {
    id: r.id,
    kind: r.kind,
    author: operator
      ? { handle: "마일스탬프 운영팀", icon: "🌱", phone: null, operator: true }
      : { handle: r.handle ?? "함께 가족", icon: r.icon ?? "🌱", phone: r.nickname ?? null, operator: false },
    mine: !!r.car_id && r.car_id === ctx.me,
    pending: r.visible_at.getTime() > ctx.now.getTime(),
    when: coarseWhen(r.created_at, ctx.now),
    text: r.text ?? "",
    place: r.place_id && placeName ? { id: r.place_id, name: placeName } : null,
    stamp: r.kind === "stamp" && r.medal ? {
      name: r.medal.name ?? placeName ?? "도장",
      tier, stars: STARS[tier], rare: r.medal.rare ?? null,
      artKey: r.medal.artKey ?? r.place_id ?? "", festivalId: r.medal.festivalId ?? null,
    } : null,
    trip: r.kind === "trip" || (r.kind === "notice" && r.places?.length)
      ? { places: (r.places ?? []).map((p) => ({ id: p.id ?? null, name: p.name })), stamps: Number(r.medal?.stamps ?? 0) || 0 }
      : null,
    tip: r.kind === "tip" ? { good: r.tip?.good !== false, tags: (r.tip?.tags ?? []).filter((x) => (TIP_TAGS as readonly string[]).includes(x)) } : null,
    reactions: { clap: r.clap ?? 0, want: r.want ?? 0, save: r.save ?? 0 },
    my: { clap: !!r.my_clap, want: !!r.my_want, save: !!r.my_save },
  };
}

// ---------------- 커서 ----------------

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}
export function decodeCursor(c: string | null | undefined): { at: Date; id: string } | null {
  if (!c) return null;
  try {
    const [iso, id] = Buffer.from(c, "base64url").toString().split("|");
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? "")) return null;
    return { at, id };
  } catch {
    return null;
  }
}

// ---------------- 이번 주 우리 지역 ----------------

export type Pulse = { families: number; stamps: number; approx: boolean; top: { id: string; name: string; families: number }[] };

/** 숫자는 둥글게: 10 미만은 그대로, 넘으면 5 단위로 내림 (approx = '넘게') */
export function roundPulse(families: number, stamps: number): { families: number; stamps: number; approx: boolean } {
  const r = (n: number) => (n < 10 ? n : Math.floor(n / 5) * 5);
  return { families: r(families), stamps: r(stamps), approx: families >= 10 || stamps >= 10 };
}

/** 3가족 미만이면 숨김 (몇 집 안 되면 누가 어디 갔는지 드러날 수 있어서) */
export const PULSE_MIN_FAMILIES = 3;
