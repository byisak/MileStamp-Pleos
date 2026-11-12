import { sql } from "@/lib/db";
import { currentPhone } from "@/lib/auth";
import { asHhmm, COMPANION_TEXT } from "@/lib/planner";
import { cellOf, latLngPair, loadFamily, missingStructure, parseFavorites, validateFamily, type Family } from "@/lib/plan";
import { loadDwell, setDwellPref, type FamilyDwell } from "@/lib/dwell";
import { DWELL_PREF_TEXT, isDwellPref } from "@/lib/dwell-shape";
import { dwellChip } from "@/lib/planner";

/**
 * 우리 가족 설정 — 폰.
 *   GET  /api/family → { kidAges, napStart, napLen, backBy, dinner, saved, text }
 *   PUT  /api/family { kidAges?, napStart?, napLen?, backBy?, dinner? } → 넣은 칸만 바꾼다
 *     kidAges: [4,4] (0~12살, 1~6명) · napStart·napLen: 분 (780, 90) 또는 둘 다 null(낮잠 없음)
 *     backBy: 'sunset-30'(해 지기 30분 전) | 'at:17:30' · dinner: 분(1110 = 18:30) 또는 null
 *     home: [위도, 경도] 또는 null — 소수 셋째 자리(약 100m)로 깎아 저장(집 칸 home_cell도 같이). 좌표는 로그에 남기지 않는다
 *     favorites: [{name, lat, lng}] 8곳까지 (오늘 도착지 고르기 — 할머니 집 등), 좌표는 셋째 자리
 *     companion: "kids"(아이와) | "couple"(연인·부부) | "friends"(친구끼리) | "solo"(혼자) — 누구랑 가요? 마지막으로 고른 값(기억). 아이·낮잠은 kids일 때만 씀
 *     dwellPref: "quick"(빨리 둘러봐요 0.8×) | "normal"(1.0×) | "long"(오래 놀아요 1.25×) — 바꾸면 머무름 배율을 이 값으로 다시 시작(배운 횟수는 둠)
 *     bedtime: 분 (1260 = 21:00, 18:00~23:00) — 아이 잠자는 시간. 아이와 저녁 나들이는 이 시각 전 귀가 (저녁 카드는 이 90분 전까지)
 *     lateReturn: 분 (1380 = 23:00, 19:00~23:59) — 어른끼리 '늦어도 몇 시 귀가'. 어른끼리 낮·저녁 귀가 한계 (예전 22:00 고정 대신)
 *     mealPlan: true·false (기본 false) — '밥도 같이 짜기'. 켜면 코스가 점심(11:30~13:30)·저녁(17:30~19:30) 때를 지날 때 식당 한 곳을 넣는다
 *   답의 dwell = { pref, factor, n, text } — text 예: "우리 가족은 보통 1.2배 머물러요 (5번 기록)" · "아직 기록이 없어요 · 보통"
 * 바꾸면 오늘 아직 안 고른 계획은 다시 계산하게 표시한다.
 */

function dwellText(d: FamilyDwell): string {
  if (d.n === 0) return `아직 기록이 없어요 · ${DWELL_PREF_TEXT[d.pref]}`;
  const chip = dwellChip({ dwellFactor: d.factor, dwellN: Math.max(d.n, 2) } as never);
  return `${chip ?? "우리 가족은 조사값과 비슷하게 머물러요"} (${d.n}번 기록)`;
}

/** 1260 → '오후 9시', 1410 → '오후 11시 30분' (설정 줄 글). */
function clock12(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  const ap = h < 12 ? "오전" : "오후";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${hh}시${m ? ` ${m}분` : ""}`;
}

function view(f: Family, saved: boolean, d: FamilyDwell) {
  return {
    ...f,
    saved,
    dwellPref: d.pref,
    dwell: { pref: d.pref, factor: d.factor, n: d.n, text: dwellText(d) },
    // 화면에 바로 쓰는 글
    text: {
      nap: f.napStart != null && f.napLen != null ? `${asHhmm(f.napStart)}부터 ${f.napLen}분` : "낮잠 없음",
      backBy: f.backBy.startsWith("sunset-") ? `해 지기 ${f.backBy.slice(7)}분 전` : `${f.backBy.slice(3)}까지`,
      dinner: f.dinner != null ? asHhmm(f.dinner) : "따지지 않음",
      home: f.home ? "정했어요" : "아직 안 정했어요",
      companion: COMPANION_TEXT[f.companion],
      bedtime: clock12(f.bedtime),
      lateReturn: clock12(f.lateReturn),
      mealPlan: f.mealPlan ? "밥도 같이 짜요" : "밥은 따로 해요",
    },
  };
}

export async function GET(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const [{ family, saved }, dwell] = await Promise.all([loadFamily(phone.car_id), loadDwell(phone.car_id)]);
  return Response.json(view(family, saved, dwell));
}

export async function PUT(req: Request) {
  const phone = await currentPhone(req);
  if (!phone) return Response.json({ error: "not paired" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 2048) return Response.json({ error: "too large" }, { status: 413 });
  let body: Partial<Record<keyof Family | "dwellPref", unknown>>;
  try {
    body = JSON.parse(raw);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { family: cur } = await loadFamily(phone.car_id);
  const pick = <K extends keyof Family>(k: K): Family[K] => (k in body ? (body[k] as Family[K]) : cur[k]);
  // 집·즐겨찾기 좌표는 받자마자 셋째 자리로 깎는다
  if ("home" in body && body.home != null) {
    const h = latLngPair(body.home);
    if (!h) return Response.json({ error: "집 위치는 [위도, 경도]예요" }, { status: 400 });
    body.home = h;
  }
  if ("favorites" in body) {
    const f = parseFavorites(body.favorites);
    if (!f) return Response.json({ error: "즐겨찾기 모양이 이상해요" }, { status: 400 });
    body.favorites = f;
  }
  const next: Family = {
    kidAges: pick("kidAges"),
    napStart: pick("napStart"),
    napLen: pick("napLen"),
    backBy: pick("backBy"),
    dinner: pick("dinner"),
    home: pick("home"),
    favorites: pick("favorites"),
    companion: pick("companion"),
    bedtime: pick("bedtime"),
    lateReturn: pick("lateReturn"),
    mealPlan: pick("mealPlan"),
  };
  const error = validateFamily(next);
  if (error) return Response.json({ error }, { status: 400 });
  if ("dwellPref" in body && !isDwellPref(body.dwellPref)) return Response.json({ error: "머무는 편은 quick·normal·long 중 하나예요" }, { status: 400 });
  const homeChanged = "home" in body;
  const homeCell = next.home ? cellOf(next.home[0], next.home[1]).cell : null;

  await sql`
    insert into families (car_id, kid_ages, nap_start, nap_len, back_by, dinner, home_lat, home_lng, home_cell, favorites, companion, updated_at)
    values (${phone.car_id}, ${next.kidAges}, ${next.napStart}, ${next.napLen}, ${next.backBy}, ${next.dinner},
            ${next.home?.[0] ?? null}, ${next.home?.[1] ?? null}, ${homeCell}, ${sql.json(next.favorites as never)}, ${next.companion}, now())
    on conflict (car_id) do update set kid_ages = excluded.kid_ages, nap_start = excluded.nap_start, nap_len = excluded.nap_len,
      back_by = excluded.back_by, dinner = excluded.dinner, favorites = excluded.favorites, companion = excluded.companion,
      home_lat = excluded.home_lat, home_lng = excluded.home_lng,
      home_cell = case when ${homeChanged} then coalesce(excluded.home_cell, families.home_cell) else families.home_cell end,
      updated_at = now()`;
  // 저녁 나들이 귀가 기준 (칸이 아직 없는 DB면 넘어감 — 기본값으로 계산)
  if ("bedtime" in body || "lateReturn" in body) {
    try {
      await sql`update families set bedtime_min = ${next.bedtime}, late_return_min = ${next.lateReturn} where car_id = ${phone.car_id}`;
    } catch (e) {
      if (!missingStructure(e)) throw e;
      return Response.json({ error: "서버 준비 중이에요 (잠자는 시간 칸) — 잠시 뒤 다시 해 주세요" }, { status: 503 });
    }
  }
  // 밥도 같이 짜기 (칸이 아직 없는 DB면 503)
  if ("mealPlan" in body) {
    try {
      await sql`update families set meal_plan = ${next.mealPlan} where car_id = ${phone.car_id}`;
    } catch (e) {
      if (!missingStructure(e)) throw e;
      return Response.json({ error: "서버 준비 중이에요 (밥도 같이 짜기 칸) — 잠시 뒤 다시 해 주세요" }, { status: 503 });
    }
  }
  // '머무는 편'이 바뀌면 배율을 그 씨앗으로 (같은 값이면 배운 배율 그대로)
  if (isDwellPref(body.dwellPref) && (await loadDwell(phone.car_id)).pref !== body.dwellPref) await setDwellPref(phone.car_id, body.dwellPref);
  // 아직 안 고른 계획은 새 설정으로 다시 계산
  await sql`update plans set stale = true where car_id = ${phone.car_id} and chosen is null and not stale`;
  return Response.json(view(next, true, await loadDwell(phone.car_id)));
}
