import { josa, stopName, type CourseJson, type OptionJson } from "./livecourse";
import { isMealId, parseCompanion, weekdayOf, type Companion } from "./planner";
import { kst } from "./kst";
import { albumKeyOf } from "./arrive";

/*
 * '그날의 기록'(자동 일기) — DB 없이 시험하려고 사실 모으기·기본 문장·AI 글 검사만 여기 둔다 (DB는 diary.ts).
 * 사실은 서버가 이미 가진 것만: 그날 코스(실제 도착·출발 시각) · 머무름 기록(dwell_visits) · 도장 소식 · '다녀옴'(visits_ext)
 * · 그날 계획의 하늘 · 차가 집에 와서 보낸 오늘 요약(summary: km) · 처음 출발 기록(diaries.depart_min).
 * 이야기는 이 사실 밖의 것을 쓰지 않는다 (AI 글도 숫자가 사실에 없으면 버리고 기본 문장).
 */

export type Tone = "parent" | "child";
export const TONES: readonly Tone[] = ["parent", "child"];
export const isTone = (v: unknown): v is Tone => v === "parent" || v === "child";

export type DiaryStamp = {
  id: string; placeId: string;
  /** 폰 도장북 칸 (비 오는 날 디아크 = thearc_rain, 축제 = 축제 id) */
  key: string;
  number: number | null; rare: string | null; festivalId: string | null;
  name: string; atMin: number;
};
export type DiaryStop = {
  placeId: string; name: string; lat: number | null; lng: number | null;
  arriveMin: number | null; departMin: number | null;
  /** 머문 분 (도착·출발을 다 알 때만) */
  stayMin: number | null;
  /** 여기서 받은 도장 id */
  stamps: string[];
};
export type DiaryWeather = { sky: "RAIN" | "SNOW" | "CLEAR"; label: string };
export type DiaryFacts = {
  day: string;
  /** '11월 8일 일요일' */
  dateText: string;
  weather: DiaryWeather | null;
  companion: Companion;
  /** 집에서 나선 시각. approx = 기록이 없어 첫 곳 도착에서 계획한 이동 시간만큼 뺀 어림 */
  depart: { min: number; approx: boolean } | null;
  stops: DiaryStop[];
  stamps: DiaryStamp[];
  /** km = 차가 집에 와서 보낸 오늘 주행거리 · min = 실제 시각으로 센 운전 시간(모르는 구간이 있으면 null) */
  drive: { km: number | null; min: number | null; approx: boolean } | null;
  /** 차에서 낮잠 맞춤 이동 (계획한 분, 그 이동을 실제로 했을 때만) */
  nap: { min: number; fromMin: number } | null;
  /** 집 도착 (차의 오늘 요약 시각) */
  homeMin: number | null;
  done: boolean;
  /** 코스에 넣은 밥 자리 중 실제로 들른 곳 ('ext:food:…' — 점심(15시 전 도착)·저녁). 예전 기록엔 없을 수 있다. */
  meals?: { name: string; kind: "점심" | "저녁"; arriveMin: number | null }[];
};

/** 들른 곳 중 밥 자리('ext:food:…')를 뺀 곳 (이야기 글의 '○○에서 N시간'). */
const placesOf = (f: DiaryFacts) => f.stops.filter((s) => !isMealId(s.placeId));
/** 밥 자리 이름 — '점심은 할매칼국수에서' (같은 끼니가 둘이면 앞의 것). */
function mealLine(f: DiaryFacts, child: boolean): string | null {
  const ms = f.meals ?? [];
  if (!ms.length) return null;
  const parts = ms.slice(0, 2).map((m) => `${m.kind}은 ${m.name}에서`);
  return child ? `${parts.join(", ")} 먹었다.` : `${parts.join(", ")} 먹었어요.`;
}

export type DiaryRaw = {
  day: string; today: string;
  course: CourseJson | null;
  option: OptionJson | null;
  sky: { sky?: unknown; rainFromMin?: unknown } | null;
  companion: unknown;
  stamps: { id: string; place_id: string | null; payload: Record<string, unknown>; created_at: Date }[];
  dwell: { place_id: string; arrive_min: number; depart_min: number }[];
  ext: { ext_id: string; name: string; lat: number | null; lng: number | null; visited_at: Date }[];
  summary: { created_at: Date; payload: Record<string, unknown> } | null;
  departMin: number | null;
  /** 장소 id → 이름·좌표 (명소·축제 표) */
  nameOf: (id: string) => { name: string; lat: number | null; lng: number | null } | null | undefined;
};

const WD = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
/** '11월 8일 일요일' */
export function dateText(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${m}월 ${d}일 ${WD[weekdayOf(day)]}`;
}

/** 'YYYY-MM-DD'이고 실제 날짜인지 */
export const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** 일기를 볼 수 있는 날: 오늘까지, 1년 안. 틀리면 쉬운 말 이유 */
export function diaryDayError(day: unknown, today: string): string | null {
  if (!isDay(day)) return "day는 YYYY-MM-DD예요";
  if (day > today) return "아직 오지 않은 날이에요";
  if (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) > 400 * 86_400_000) return "1년 넘게 지난 날은 볼 수 없어요";
  return null;
}

/** 분 → '오전 8:30' (12시간, 폰 timefmt와 같은 모양) */
export function clockKo(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h < 12 ? "오전" : "오후"} ${h12}:${String(mm).padStart(2, "0")}`;
}

/** 분 → '1시간 20분' · '45분' · '2시간' */
export function durKo(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r}분`;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}

/** 도장 소식 → 도장북 칸 (폰 stampsByKey와 같은 규칙) */
export function stampKey(placeId: string, payload: Record<string, unknown>): string {
  const fid = typeof payload.festivalId === "string" ? payload.festivalId : null;
  if (fid) return fid;
  return albumKeyOf(placeId, payload.rare);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const minOf = (at: Date, day: string): number | null => { const k = kst(at); return k.day === day ? k.min : null; };

function weatherOf(sky: DiaryRaw["sky"], stamps: DiaryRaw["stamps"]): DiaryWeather | null {
  const s = typeof sky?.sky === "string" ? sky.sky : null;
  // 도장 소식이 '비 오는 날'(희귀) 또는 rainy면 비 (그날 실제로 찍힌 사실)
  const wet = stamps.some((x) => x.payload.rainy === true || (x.place_id === "thearc" && typeof x.payload.rare === "string" && /비/.test(x.payload.rare)));
  if (wet || s === "RAIN") return { sky: "RAIN", label: "비" };
  if (s === "SNOW") return { sky: "SNOW", label: "눈" };
  if (s === "CLEAR") return { sky: "CLEAR", label: "맑음" };
  return null;
}

/** 사실 모으기. 순서 = 도착 시각 순(모르면 코스 순서 그대로 뒤에) */
export function buildFacts(r: DiaryRaw): DiaryFacts {
  const { day } = r;
  const companion = parseCompanion(r.companion) ?? "kids";
  const name = (id: string, carried?: string | null) => {
    const k = r.nameOf(id);
    return { name: stopName(id, carried || k?.name), lat: num(k?.lat), lng: num(k?.lng) };
  };

  const stamps: DiaryStamp[] = r.stamps
    .filter((s) => s.place_id)
    .map((s) => {
      const fid = typeof s.payload.festivalId === "string" ? s.payload.festivalId : null;
      const carried = typeof s.payload.festivalName === "string" ? s.payload.festivalName : typeof s.payload.name === "string" ? s.payload.name : null;
      return {
        id: s.id, placeId: s.place_id!, key: stampKey(s.place_id!, s.payload),
        number: num(s.payload.number), rare: typeof s.payload.rare === "string" && s.payload.rare ? s.payload.rare : null,
        festivalId: fid, name: name(s.place_id!, carried).name, atMin: minOf(s.created_at, day) ?? 0,
      };
    })
    .sort((a, b) => a.atMin - b.atMin);

  // 1) 코스에서 실제로 들른 곳 (도착·다녀옴)
  const stops: DiaryStop[] = [];
  const seen = new Map<string, DiaryStop>();
  const add = (s: DiaryStop) => { seen.set(s.placeId, s); stops.push(s); };
  for (const s of r.course?.stops ?? []) {
    if (s.status !== "ARRIVED" && s.status !== "DONE") continue;
    if (seen.has(s.placeId)) continue;
    const x = s as typeof s & { name?: string; lat?: number; lng?: number };
    const n = name(s.placeId, x.name);
    const arrive = num(s.actualArriveMin), depart = num(s.actualDepartMin);
    add({ placeId: s.placeId, name: n.name, lat: num(x.lat) ?? n.lat, lng: num(x.lng) ?? n.lng, arriveMin: arrive, departMin: depart, stayMin: null, stamps: [] });
  }
  // 2) 머무름 기록 (도장 소식에 실려 온 도착·출발) — 코스에 없던 곳이거나 코스가 시각을 모를 때
  for (const d of r.dwell) {
    const hit = seen.get(d.place_id);
    if (hit) {
      hit.arriveMin ??= d.arrive_min;
      hit.departMin ??= d.depart_min;
      continue;
    }
    const n = name(d.place_id);
    add({ placeId: d.place_id, name: n.name, lat: n.lat, lng: n.lng, arriveMin: d.arrive_min, departMin: d.depart_min, stayMin: null, stamps: [] });
  }
  // 3) 도장만 있는 곳 (도착 시각 = 도장 찍힌 때)
  for (const s of stamps) {
    const pid = s.placeId;
    const hit = seen.get(pid);
    if (hit) { hit.stamps.push(s.id); hit.arriveMin ??= s.atMin; continue; }
    const n = name(pid, s.name);
    add({ placeId: pid, name: s.name || n.name, lat: n.lat, lng: n.lng, arriveMin: s.atMin, departMin: null, stayMin: null, stamps: [s.id] });
  }
  // 4) 바깥 장소 '다녀옴'
  for (const e of r.ext) {
    if (seen.has(e.ext_id)) continue;
    add({ placeId: e.ext_id, name: stopName(e.ext_id, e.name), lat: num(e.lat), lng: num(e.lng), arriveMin: minOf(e.visited_at, day), departMin: null, stayMin: null, stamps: [] });
  }
  for (const s of stops) s.stayMin = s.arriveMin != null && s.departMin != null && s.departMin > s.arriveMin ? s.departMin - s.arriveMin : null;
  stops.sort((a, b) => (a.arriveMin ?? 1e9) - (b.arriveMin ?? 1e9));

  // 집 도착 = 차의 오늘 요약 (그날 것만)
  const homeMin = r.summary ? minOf(r.summary.created_at, day) : null;
  const done = homeMin != null || day < r.today;

  // 출발: 기록이 있으면 그것, 없으면 첫 곳 도착 − 계획한 첫 이동 시간 (어림)
  let depart: DiaryFacts["depart"] = r.departMin != null ? { min: r.departMin, approx: false } : null;
  const first = stops[0];
  if (!depart && first?.arriveMin != null && r.option?.legs?.length) {
    const leg = r.option.legs[0];
    const toFirst = r.option.stops?.[0]?.id === first.placeId && (leg.kind === "DRIVE" || leg.kind === "NAP_DRIVE");
    const len = leg.toMin - leg.fromMin;
    if (toFirst && len > 0 && len < 240 && first.arriveMin - len >= 0) depart = { min: first.arriveMin - len, approx: true };
  }
  if (depart && first?.arriveMin != null && depart.min > first.arriveMin) depart = null;

  // 운전 시간: 출발 → 곳마다 → 집, 모든 시각을 알 때만
  let driveMin: number | null = null;
  if (depart && homeMin != null && stops.length && stops.every((s) => s.arriveMin != null && s.departMin != null)) {
    let t = depart.min, sum = 0, okAll = true;
    for (const s of stops) { const g = s.arriveMin! - t; if (g < 0) okAll = false; sum += Math.max(0, g); t = s.departMin!; }
    const back = homeMin - t;
    if (back < 0) okAll = false;
    sum += Math.max(0, back);
    driveMin = okAll ? sum : null;
  }
  const km = r.summary ? num(r.summary.payload.km) : null;
  const drive = km != null || driveMin != null ? { km: km != null ? Math.round(km * 10) / 10 : null, min: driveMin, approx: !!depart?.approx && driveMin != null } : null;

  // 낮잠: 아이와 + 낮잠 맞춤 이동을 실제로 함 (곳으로 가는 낮잠 = 도착함 · 집으로 가는 낮잠 = 집에 옴)
  let nap: DiaryFacts["nap"] = null;
  const nl = r.course?.napLeg;
  if (companion === "kids" && nl && nl.toMin > nl.fromMin) {
    const took = nl.placeId ? (r.course?.napTaken === true || stops.some((s) => s.placeId === nl.placeId)) : homeMin != null;
    if (took) nap = { min: nl.toMin - nl.fromMin, fromMin: nl.fromMin };
  }

  const meals = stops.filter((s) => isMealId(s.placeId))
    .map((s) => ({ name: s.name, kind: (s.arriveMin != null && s.arriveMin >= 15 * 60 ? "저녁" : "점심") as "점심" | "저녁", arriveMin: s.arriveMin }));
  return {
    day, dateText: dateText(day), weather: weatherOf(r.sky, r.stamps), companion,
    depart, stops, stamps, drive, nap, homeMin, done,
    ...(meals.length ? { meals } : {}),
  };
}

// ------------------------------------------------------------------ 글

const WITH: Record<Companion, string> = { kids: "아이와 함께", couple: "둘이서", friends: "친구들과", solo: "혼자" };

/** 사실을 한 줄씩 (AI에 넘기는 목록이자 숫자 검사의 기준) */
export function factLines(f: DiaryFacts): string[] {
  const out: string[] = [];
  out.push(`날짜: ${f.dateText}`);
  if (f.weather) out.push(`날씨: ${f.weather.label}`);
  out.push(`누구랑: ${WITH[f.companion]}`);
  if (f.depart) out.push(`집에서 출발: ${clockKo(f.depart.min)}${f.depart.approx ? "쯤(어림)" : ""}`);
  f.stops.forEach((s, i) => {
    const bits = [`${i + 1}번째로 들른 곳: ${s.name}`];
    if (s.arriveMin != null) bits.push(`도착 ${clockKo(s.arriveMin)}`);
    if (s.stayMin != null) bits.push(`머문 시간 ${durKo(s.stayMin)}`);
    const st = f.stamps.filter((x) => s.stamps.includes(x.id));
    if (st.length) bits.push(st.map((x) => (x.festivalId ? "축제 도장" : x.rare ? `희귀 도장(${x.rare})` : "도장")).join("·") + " 받음");
    out.push(bits.join(", "));
  });
  for (const m of f.meals ?? []) out.push(`${m.kind} 먹은 곳: ${m.name}`);
  if (f.stops.length) out.push(`들른 곳 수: ${f.stops.length}곳`);
  if (f.stamps.length) out.push(`받은 도장: ${f.stamps.length}개`);
  if (f.drive?.km != null) out.push(`달린 거리: ${f.drive.km}km`);
  if (f.drive?.min != null) out.push(`운전한 시간: ${durKo(f.drive.min)}${f.drive.approx ? "쯤" : ""}`);
  if (f.nap) out.push(`차에서 낮잠 맞춤 이동: ${durKo(f.nap.min)}`);
  if (f.homeMin != null) out.push(`집 도착: ${clockKo(f.homeMin)}`);
  return out;
}

/**
 * AI가 안 될 때의 기본 글 — 사실로만 만든 해요체(부모 기록) / '오늘 나는 …했다'(아이 일기). 이름은 쓰지 않는다.
 */
export function fallbackStory(f: DiaryFacts, tone: Tone): string {
  const child = tone === "child";
  const S: string[] = [];
  const wet = f.weather?.sky === "RAIN" ? "비 오는 날" : f.weather?.sky === "SNOW" ? "눈 오는 날" : null;
  const at = (min: number, approx: boolean) => `${clockKo(min)}${approx ? "쯤" : "에"}`;
  const places = placesOf(f);
  const shown = places.slice(0, 3);
  const meal = mealLine(f, child);
  const timed = shown.filter((s) => s.stayMin != null);
  const untimed = shown.filter((s) => s.stayMin == null);
  if (child) {
    S.push(f.depart ? `오늘 나는 ${wet ? `${wet} ` : ""}${at(f.depart.min, f.depart.approx)} 집을 나섰다.` : `오늘 나는 ${wet ? `${wet} ` : ""}나들이를 갔다.`);
    for (const s of timed) S.push(`${s.name}에서 ${durKo(s.stayMin!)} 동안 놀았다.`);
    if (untimed.length) S.push(`${untimed.map((s) => s.name).join(", ")}에 갔다.`);
    if (meal) S.push(meal);
    if (f.stamps.length) S.push(`도장을 ${f.stamps.length}개 받았다.`);
    if (f.nap) S.push(`돌아오는 차에서 ${durKo(f.nap.min)} 동안 낮잠 시간을 가졌다.`);
    if (f.homeMin != null) S.push(`${clockKo(f.homeMin)}에 집에 왔다.`);
    return S.join(" ");
  }
  if (f.depart) S.push(`${wet ? `${wet}, ` : ""}${at(f.depart.min, f.depart.approx)} 집을 나섰어요.`);
  else if (wet && f.stops.length) S.push(`${wet}의 나들이였어요.`);
  if (timed.length) S.push(`${josa(timed.map((s) => `${s.name}에서 ${durKo(s.stayMin!)}`).join(", "), "을/를")} 보냈어요.`);
  if (untimed.length) S.push(`${untimed.map((s) => s.name).join(", ")}에 들렀어요.`);
  if (meal) S.push(meal);
  if (places.length > 3) S.push(`모두 ${places.length}곳을 다녀왔어요.`);
  if (f.stamps.length) {
    const rare = f.stamps.filter((x) => x.rare).length, fest = f.stamps.filter((x) => x.festivalId).length;
    const extra = [rare ? `희귀 도장 ${rare}개` : "", fest ? `축제 도장 ${fest}개` : ""].filter(Boolean).join("·");
    S.push(`도장은 ${f.stamps.length}개${extra ? `(${extra} 포함)` : ""} 받았어요.`);
  }
  if (f.nap && f.homeMin != null) S.push(`돌아오는 길엔 차에서 ${durKo(f.nap.min)} 낮잠 시간을 가졌고, ${clockKo(f.homeMin)}에 집에 도착했어요.`);
  else if (f.nap) S.push(`돌아오는 길엔 차에서 ${durKo(f.nap.min)} 낮잠 시간을 가졌어요.`);
  else if (f.homeMin != null) S.push(`${clockKo(f.homeMin)}에 집에 도착했어요.`);
  if (!S.length) S.push("이날은 들른 곳 기록이 없어요.");
  return S.join(" ");
}

/** AI에 줄 글 (system · user). 이름은 kidNames가 있을 때만 */
export function storyPrompt(f: DiaryFacts, tones: readonly Tone[], kidNames: string[] = []): { system: string; user: string } {
  const system = [
    "너는 가족 나들이 앱의 일기 작가야. 아래 '사실' 목록에 있는 것만 써.",
    "규칙:",
    "- 사실에 없는 장소·사건·감정·대사·음식·날씨·사람을 지어내지 마.",
    "- 시각·시간·거리·개수 숫자는 사실에 적힌 그대로만 써. 다른 숫자는 쓰지 마.",
    "- '쯤(어림)'이라고 적힌 값은 '쯤'을 붙여.",
    kidNames.length ? `- 아이 이름은 ${kidNames.join(", ")}만 쓸 수 있어.` : "- 사람 이름을 쓰지 마. ('아이', '우리'처럼만)",
    "- 각 글은 3~4문장, 한국어, 이모지·따옴표·제목 없이.",
    tones.includes("parent") ? "- parent: 부모가 남기는 기록. 해요체(…했어요). 예: '돌아오는 길엔 차에서 32분 낮잠 시간을 가졌어요.'" : "",
    tones.includes("child") ? "- child: 아이가 쓴 그림일기 말투. '오늘 나는'으로 시작하고 …했다 체." : "",
    `JSON 한 줄로만 답해: {${tones.map((t) => `"${t}": "…"`).join(", ")}}`,
  ].filter(Boolean).join("\n");
  const user = `사실:\n${factLines(f).map((l) => `- ${l}`).join("\n")}`;
  return { system, user };
}

const digits = (s: string) => new Set((s.match(/\d+(?:\.\d+)?/g) ?? []).map((x) => String(Number(x))));

/**
 * AI 답 검사: JSON에서 그 말투 글을 꺼내 다듬고, 사실에 없는 숫자가 있거나 너무 짧거나 길면 null (→ 기본 문장).
 */
export function checkStory(raw: unknown, f: DiaryFacts, tone: Tone): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.replace(/\s+/g, " ").replace(/^["'“”\s]+|["'“”\s]+$/g, "").trim();
  if (text.length < 15 || text.length > 500) return null;
  // 이모지·마크다운 표시 빼기
  text = text.replace(/[*#`_]/g, "").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim();
  const allowed = digits(factLines(f).join(" "));
  for (const d of digits(text)) if (!allowed.has(d)) return null;
  if (tone === "child" && !/^오늘/.test(text)) text = `오늘 ${text}`;
  return text;
}

/** AI 답 글 → {tone: 글}. JSON 앞뒤에 다른 글이 붙어 와도 첫 { … } 를 읽는다 */
export function parseStoryJson(text: string): Partial<Record<Tone, unknown>> {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return {};
  try {
    const o = JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
    return { parent: o.parent, child: o.child };
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ 저장 모양

export type StoryCell = { text: string; by: "ai" | "facts" | "edit"; at: string };
export type StoredStory = Partial<Record<Tone, StoryCell>>;

/** 저장된 글을 다시 만들어야 하나 — 비었거나, 기본 문장인데 1시간이 지남(AI가 돌아왔을 수 있음). 사람이 고친 글은 안 건드림 */
export function needsStory(cell: StoryCell | undefined, now = new Date()): boolean {
  if (!cell) return true;
  if (cell.by !== "facts") return false;
  return now.getTime() - Date.parse(cell.at) > 3600_000;
}

/** 응답의 story 칸 */
export function storyView(s: StoredStory | null): { parent: string | null; child: string | null; generatedAt: string | null; by: { parent: StoryCell["by"] | null; child: StoryCell["by"] | null } } {
  const at = [s?.parent?.at, s?.child?.at].filter((x): x is string => !!x).sort().pop() ?? null;
  return {
    parent: s?.parent?.text ?? null, child: s?.child?.text ?? null, generatedAt: at,
    by: { parent: s?.parent?.by ?? null, child: s?.child?.by ?? null },
  };
}

/** 사람이 고친 글 확인 — 다듬은 글 또는 쉬운 말 오류 */
export function editText(v: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof v !== "string") return { ok: false, error: "text가 필요해요" };
  const t = v.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!t) return { ok: false, error: "글이 비었어요" };
  if (t.length > 800) return { ok: false, error: "800자까지 쓸 수 있어요" };
  return { ok: true, text: t };
}
