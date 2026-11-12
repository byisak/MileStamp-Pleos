"use client";

/*
 * 맛집(식당) — 명소와 같은 입력 모양 (docs/장소-데이터-구조-계획.md §2.3 · §5.3 · §5.4) · 개편(11/3, 시안 ②③④).
 * 표(빈 칸·확인 필요·초안·AI 초안·90일 거르기, 줄마다 켜기, 짧은 칸 바로 고침, 줄 고르기 → 한꺼번에 확인·AI 초안 받아들이기·켜기·원문과 나란히)
 * ↔ 편집(작게 접힌 지도 · 섹션 바로가기 · 운영 시간(브레이크·마지막 주문) · 주차 · 아이 칸 · 음식 종류·가격 · 붐빔·식사 자리 · 어울림 · 태그)
 * + 오른쪽 완성도·AI 초안·출처. '카카오에서 근처 식당 가져오기'는 꺼진 초안으로 넣는다.
 * 검사는 lib/restaurant-shape.ts parseFoodInput (서버 저장 검사와 같은 함수).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Baby, BadgeCheck, Car, Clock3, Columns2, Download, ExternalLink, FileText, Pencil, Plus, Power, Soup, Sparkles, Table2, Tags, Trash2, Users, UtensilsCrossed, X,
} from "lucide-react";
import { FOOD_FACILITIES, type AdminPlace } from "@/lib/catalog-shape";
import { COMPANION_TEXT, COMPANIONS } from "@/lib/planner";
import { daysLabel, hm, isStale, representativeHours, type AiDrafts, type FieldMeta } from "@/lib/place-attrs-shape";
import {
  CUISINES, FOOD_DWELL_RANGE, FOOD_META_FIELDS, FOOD_PRICE_TEXT, KID_FEATURES, KID_TEXT, MEAL_TYPE_TEXT, MEAL_TYPES, RESERVE_TEXT, RESERVE_TYPES,
  WAIT_KEYS, WAIT_KEY_TEXT, WAIT_LEVEL_TEXT, foodCompleteness, parseFoodInput,
  type FoodMetaField, type FoodRestaurant, type MealType, type Reserve,
} from "@/lib/restaurant-shape";
import { acceptFoodDraft, discardDraft, draftText } from "@/lib/ai-fill-shape";
import { api, type FoodIntent, type Toast } from "./AdminApp";
import { Completeness, HoursEditor, ParkingBlock, SourceBadge } from "./PlaceAttrs";
import { AiDraftsCard, bulkFill, BulkBar, MapBox, Pop, Ring, Sec, SecNav, SideBySide } from "./admin-kit";
import { HoursPop, ParkingPop } from "./PlacesTable";

type Draft = Omit<FoodRestaurant, "id"> & { id: string | null };
type Filter = "all" | "draft" | "empty" | "check" | "ai" | "stale";

const FIELD_TEXT: Record<FoodMetaField, string> = {
  location: "위치", hours: "운영 시간", parking: "주차", price: "가격", kid: "아이 칸", wait: "붐빔", cuisine: "음식 종류", meal: "식사 자리", fit: "어울림", tags: "태그",
};
const PK = { yes: "있음", limited: "좁음", no: "없음" } as const;
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const toggle = <T,>(xs: readonly T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
const draftCount = (d: AiDrafts) => Object.keys(d).filter((k) => d[k]).length;

const blank = (near?: AdminPlace): Draft => ({
  id: null, name: "", placeId: near?.id ?? null, lat: near?.lat ?? null, lng: near?.lng ?? null, facilities: [], hours: null, closed: null, note: null,
  active: false, cuisine: [], price: null, kid: null, parking: null, wait: null, reserve: null, meal: [], dwellMin: null, fit: null, tags: [],
  meta: {}, aiDrafts: {}, kakaoId: null, phone: null, address: null, url: null,
  openHours: [{ days: [0, 1, 2, 3, 4, 5, 6], holiday: false, openMin: 660, closeMin: 1260, lastEntryMin: null, breaks: [], validFrom: null, validTo: null, note: null }],
});

/** 섹션 ↔ 칸 (바로가기 '!' · 휴대폰에서 처음부터 펼침) */
const FSECS: { id: string; label: string; fields: string[] }[] = [
  { id: "f-basic", label: "기본·위치", fields: ["location"] },
  { id: "f-hours", label: "운영 시간", fields: ["hours"] },
  { id: "f-parking", label: "주차", fields: ["parking"] },
  { id: "f-kid", label: "아이와", fields: ["kid"] },
  { id: "f-cuisine", label: "음식·가격", fields: ["cuisine", "price"] },
  { id: "f-meal", label: "식사·붐빔", fields: ["meal", "wait"] },
  { id: "f-fit", label: "어울림·태그", fields: ["fit", "tags"] },
  { id: "f-memo", label: "메모·켜기", fields: [] },
];

export function FoodPane(props: {
  places: AdminPlace[];
  restaurants: FoodRestaurant[];
  version: number;
  kakaoReady: boolean;
  intent?: FoodIntent | null;
  aiReady: boolean | null;
  aiMock?: boolean;
  onReload: () => Promise<void>;
  onChange: (rs: FoodRestaurant[], version: number) => void;
  toast: Toast;
}) {
  const { places, restaurants, toast } = props;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [kakao, setKakao] = useState(false);
  const [tags, setTags] = useState<string[] | null>(null);
  const [dropped, setDropped] = useState<{ field: string; reason: string }[] | null>(null);
  const today = kstToday();
  const placeName = (id: string | null) => (id ? places.find((p) => p.id === id)?.name ?? id : "—");

  // 할 일에서 왔으면 표 · 그 거르기로 (n이 바뀔 때마다 한 번)
  const [seenIntent, setSeenIntent] = useState<number | null>(null);
  if (props.intent && props.intent.n !== seenIntent) {
    setSeenIntent(props.intent.n);
    setDraft(null);
    if (props.intent.filter) setFilter(props.intent.filter as Filter);
  }

  async function reload(version?: number) {
    const r = await api<{ restaurants: FoodRestaurant[]; tags: string[] }>("GET", "/api/admin/restaurants");
    setTags(r.tags);
    props.onChange(r.restaurants, version ?? props.version);
  }
  async function open(d: Draft) {
    setDraft(d);
    setDropped(null);
    if (!tags) api<{ tags: string[] }>("GET", "/api/admin/restaurants").then((r) => setTags(r.tags)).catch(() => {});
  }

  /** 칸을 고치면 그 칸 출처는 관리자·확인함으로 (명소 편집과 같은 규칙). */
  const edit = (patch: Partial<Draft>, field?: FoodMetaField) =>
    setDraft((d) => d && ({
      ...d, ...patch,
      ...(field ? { meta: { ...d.meta, [field]: { src: "admin", conf: 1, at: today } as FieldMeta } } : {}),
    }));
  const confirm = (f: FoodMetaField) =>
    setDraft((d) => d && ({ ...d, meta: { ...d.meta, [f]: { ...(d.meta[f] ?? { src: "admin", conf: 1 }), at: today, check: undefined } as FieldMeta } }));

  const check = draft ? parseFoodInput(draft, { tags: tags ?? undefined, facilities: FOOD_FACILITIES }) : null;
  const hoursErr = check && "error" in check && /운영 시간|마지막 주문|쉬는 시간/.test(check.error) ? check.error : null;

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const { id, ...body } = draft;
      const res = await api<{ restaurant: FoodRestaurant; version: number }>(id ? "PUT" : "POST", id ? `/api/admin/restaurants/${id}` : "/api/admin/restaurants", body);
      const rs = id ? restaurants.map((r) => (r.id === id ? res.restaurant : r)) : [...restaurants, res.restaurant];
      props.onChange(rs, res.version);
      setDraft({ ...res.restaurant });
      toast(`저장했어요 · 목록 버전 v${res.version}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  /** 표에서 한 곳 바로 저장 (고친 칸 · 한꺼번에). 목록은 그때그때 바꾼다. */
  const latestRef = useRef(restaurants);
  useEffect(() => { latestRef.current = restaurants; }, [restaurants]);
  async function saveOne(r: FoodRestaurant): Promise<FoodRestaurant> {
    const { id, ...body } = r;
    const res = await api<{ restaurant: FoodRestaurant; version: number }>("PUT", `/api/admin/restaurants/${id}`, body);
    latestRef.current = latestRef.current.map((x) => (x.id === id ? res.restaurant : x));
    props.onChange(latestRef.current, res.version);
    return res.restaurant;
  }

  async function setActive(r: FoodRestaurant, active: boolean) {
    try {
      const res = await api<{ restaurant: FoodRestaurant; version: number }>("PATCH", `/api/admin/restaurants/${r.id}`, { active });
      latestRef.current = latestRef.current.map((x) => (x.id === r.id ? res.restaurant : x));
      props.onChange(latestRef.current, res.version);
      toast(active ? `${r.name} 켰어요 — 밥 자리 후보예요` : `${r.name} 껐어요`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function remove(r: { id: string | null; name: string }) {
    if (!r.id || !confirmDlg(`${r.name}을(를) 지울까요?`)) return;
    try {
      const res = await api<{ version: number }>("DELETE", `/api/admin/restaurants/${r.id}`);
      props.onChange(restaurants.filter((x) => x.id !== r.id), res.version);
      setDraft(null);
      toast("지웠어요");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  // ─ AI 초안 (편집 화면)
  const acceptAi = (f: string) => setDraft((d) => d && acceptFoodDraft(d, f, today));
  const fixAi = (f: string) => {
    setDraft((d) => {
      if (!d) return d;
      const n = acceptFoodDraft(d, f, today);
      const m = n.meta[f as FoodMetaField];
      return m ? { ...n, meta: { ...n.meta, [f]: { ...m, check: true } } } : n;
    });
    const el = document.getElementById(FSECS.find((s) => s.fields.includes(f))?.id ?? "f-basic");
    if (el) { el.classList.add("open"); el.scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  const discardAi = (f: string) => setDraft((d) => d && discardDraft(d, f));
  async function fillAi(text: string | null) {
    if (!draft?.id) { toast("먼저 저장한 뒤 AI로 채울 수 있어요", true); return; }
    try {
      const r = await api<{ drafts: AiDrafts; added: string[]; asked: string[]; dropped: { field: string; reason: string }[]; mock: boolean }>(
        "POST", "/api/admin/ai-fill", { kind: "restaurant", id: draft.id, text });
      setDraft((d) => d && { ...d, aiDrafts: r.drafts });
      props.onChange(restaurants.map((x) => (x.id === draft.id ? { ...x, aiDrafts: r.drafts } : x)), props.version);
      setDropped(r.dropped);
      toast(!r.asked.length ? "물어볼 칸이 없어요" : r.added.length ? `AI 초안 ${r.added.length}칸${r.mock ? " (모의)" : ""} · 오른쪽에서 보고 받아들이세요` : "원문에서 근거를 찾은 칸이 없었어요 · 안내 글을 붙여 넣어 보세요", !r.added.length && !!r.asked.length);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  if (draft) {
    return <FoodEditor draft={draft} places={places} tags={tags} today={today} busy={busy} hoursErr={hoursErr}
      error={check && "error" in check ? check.error : null} toast={toast} aiReady={props.aiReady} aiMock={props.aiMock} dropped={dropped}
      ai={{ accept: acceptAi, fix: fixAi, discard: discardAi, fill: fillAi }}
      edit={edit} confirm={confirm} onSave={save} onBack={() => setDraft(null)} onRemove={() => remove(draft)} />;
  }

  return (
    <section>
      <div className="top">
        <h1>맛집</h1>
        <span className="ver">목록 버전 v{props.version}</span>
        <div className="sp" />
        <button className="btn line" onClick={() => setKakao(true)} disabled={!props.kakaoReady}
          title={props.kakaoReady ? "" : "서버에 카카오 키(KAKAO_REST_KEY)가 없어요"}><Download />카카오에서 근처 식당 가져오기</button>
        <button className="btn line" onClick={() => open(blank())}><Plus />식당 추가</button>
      </div>
      <FoodTable restaurants={restaurants} placeName={placeName} today={today} filter={filter} setFilter={setFilter} q={q} setQ={setQ}
        aiReady={props.aiReady} toast={toast} onReload={props.onReload} onSave={saveOne}
        onOpen={(r) => open({ ...r })} onActive={setActive} />
      {kakao ? <KakaoImport places={places} onClose={() => setKakao(false)} toast={toast}
        onDone={async (v) => { await reload(v ?? undefined); setFilter("draft"); }} /> : null}
    </section>
  );
}

function confirmDlg(msg: string) {
  return typeof window !== "undefined" && window.confirm(msg);
}

// ------------------------------------------------------------------ 표 보기

function FoodTable(props: {
  restaurants: FoodRestaurant[]; placeName: (id: string | null) => string; today: string;
  filter: Filter; setFilter: (f: Filter) => void; q: string; setQ: (q: string) => void;
  aiReady: boolean | null; toast: Toast; onReload: () => Promise<void>; onSave: (r: FoodRestaurant) => Promise<FoodRestaurant>;
  onOpen: (r: FoodRestaurant) => void; onActive: (r: FoodRestaurant, on: boolean) => void;
}) {
  const { today, toast } = props;
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; field: "hours" | "parking" | "price" } | null>(null);
  const [sbs, setSbs] = useState(false);
  // 켠 식당 먼저 (그다음 초안), 같은 무리 안에선 받은 순서
  const rows = useMemo(() => [...props.restaurants].sort((a, b) => Number(b.active) - Number(a.active)).map((r) => ({
    r, comp: foodCompleteness(r),
    checks: FOOD_META_FIELDS.filter((f) => r.meta[f]?.check),
    stale: FOOD_META_FIELDS.filter((f) => isStale(r.meta[f], today)),
    ai: draftCount(r.aiDrafts),
  })), [props.restaurants, today]);
  const counts: Record<Filter, number> = {
    all: rows.length,
    draft: rows.filter((x) => !x.r.active).length,
    empty: rows.filter((x) => x.comp.missing.length).length,
    check: rows.filter((x) => x.checks.length).length,
    ai: rows.filter((x) => x.ai).length,
    stale: rows.filter((x) => x.stale.length).length,
  };
  const shown = rows.filter(({ r, comp, checks, stale, ai }) => {
    const qq = props.q.trim();
    if (qq && !`${r.name} ${props.placeName(r.placeId)} ${r.address ?? ""} ${r.cuisine.join(" ")}`.includes(qq)) return false;
    if (props.filter === "draft") return !r.active;
    if (props.filter === "empty") return comp.missing.length > 0;
    if (props.filter === "check") return checks.length > 0;
    if (props.filter === "ai") return ai > 0;
    if (props.filter === "stale") return stale.length > 0;
    return true;
  });
  const F: [Filter, string][] = [["all", "전체"], ["draft", "꺼진 초안"], ["check", "확인 필요"], ["ai", "AI 초안"], ["empty", "빈 칸 있는 곳"], ["stale", "90일 지남"]];
  const chosen = rows.filter((x) => sel.includes(x.r.id));
  const chosenChecks = [...new Set(chosen.flatMap((x) => x.checks))];
  const allOn = shown.length > 0 && shown.every((x) => sel.includes(x.r.id));
  const toggleSel = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function patch(r: FoodRestaurant, change: Partial<FoodRestaurant>, field: FoodMetaField) {
    setBusy(r.id);
    try {
      await props.onSave({ ...r, ...change, meta: { ...r.meta, [field]: { src: "admin", conf: 1, at: today } } });
      toast(`${r.name} ${FIELD_TEXT[field]} 저장했어요`);
      setEdit(null);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }
  async function each(label: string, f: (r: FoodRestaurant) => FoodRestaurant | null) {
    setBusy("bulk");
    let n = 0;
    try {
      for (const x of chosen) {
        const next = f(x.r);
        if (!next) continue;
        await props.onSave(next);
        n++;
      }
      toast(n ? `${n}곳 ${label} · 저장했어요` : `${label}할 곳이 없었어요`);
    } catch (e) {
      toast(`${n}곳까지 저장 · ${(e as Error).message}`, true);
    } finally {
      setBusy(null);
    }
  }
  const confirmAll = () => each("확인", (r) => {
    const hit = FOOD_META_FIELDS.filter((f) => r.meta[f]?.check);
    if (!hit.length) return null;
    const meta = { ...r.meta };
    for (const f of hit) { const m = { ...meta[f]!, at: today }; delete m.check; meta[f] = m; }
    return { ...r, meta };
  });
  const acceptAll = () => each("AI 초안 받아들임", (r) => {
    const fs = Object.keys(r.aiDrafts).filter((k) => r.aiDrafts[k]);
    return fs.length ? fs.reduce((x, f) => acceptFoodDraft(x, f, today), r) : null;
  });
  const turnOn = () => each("켬", (r) => (r.active ? null : r.cuisine.length ? { ...r, active: true } : null));
  async function fill() {
    setBusy("fill");
    try {
      const r = await bulkFill("restaurant", { ids: sel.length ? sel : undefined, onProgress: (t) => setBusy(`fill:${t}`) });
      await props.onReload();
      toast(r.stopped ?? (r.fields ? `${r.filled}곳에 AI 초안 ${r.fields}칸${r.mock ? " (모의)" : ""} · 보라 칸을 보고 받아들이세요` : "새로 채울 칸이 없었어요"), !!r.stopped);
      if (r.fields) props.setFilter("ai");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const ed = edit ? props.restaurants.find((r) => r.id === edit.id) : null;
  return (
    <div className="card tblcard">
      <div className="chips tblhead">
        <Table2 size={16} />
        {F.map(([k, t]) => <button key={k} className={`chip ${props.filter === k ? "on" : ""} ${k === "draft" && counts.draft ? "warnc" : ""} ${k === "ai" && counts.ai ? "aic" : ""}`} onClick={() => props.setFilter(k)}>{t} {counts[k]}</button>)}
        <div className="sp" />
        <input className="fld" style={{ width: 180, padding: "5px 10px" }} value={props.q} onChange={(e) => props.setQ(e.target.value)} placeholder="이름·장소·음식 찾기" />
        <button className="btn sm ai" disabled={!!busy || !props.aiReady} onClick={fill} title={props.aiReady ? "고른 곳(없으면 전체)의 빈 칸·확인 필요를 AI 초안으로" : "서버에 AI 키가 없어요"}>
          <Sparkles />{busy?.startsWith("fill") ? busy.slice(5) || "읽는 중…" : sel.length ? `고른 ${sel.length}곳 AI로 채우기` : "빈 칸 AI로 채우기"}</button>
      </div>
      <div className="tblwrap">
        <table className="ptbl cards">
          <thead>
            <tr>
              <th className="ck"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? sel.filter((id) => !shown.some((x) => x.r.id === id)) : [...new Set([...sel, ...shown.map((x) => x.r.id)])])} /></th>
              <th>식당</th><th>곁 장소</th><th>음식</th><th>운영 시간</th><th>주차</th><th>아이</th><th>가격</th><th>식사</th><th>완성도</th><th>확인</th><th>켜기</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, comp, checks, stale, ai }) => {
              const d = (f: string) => r.aiDrafts[f];
              const cls = (f: FoodMetaField) => `${r.meta[f]?.check ? "needs" : ""} ${isStale(r.meta[f], today) ? "stale" : ""} ${d(f) ? "ai" : ""}`;
              const aiLine = (f: string) => (d(f) ? <small className="ail">✨ {draftText("restaurant", f, d(f)!.value)}</small> : null);
              const rep = representativeHours(r.openHours);
              const kids = KID_FEATURES.filter((k) => r.kid?.[k]);
              return (
                <tr key={r.id} className={`${r.active ? "" : "off"} ${sel.includes(r.id) ? "sel" : ""}`}>
                  <td className="ck"><input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggleSel(r.id)} /></td>
                  <td className="nm" onClick={() => props.onOpen(r)} title="편집 열기"><b>{r.name}</b>{r.meta.location?.src === "kakao" ? <span className="src kakao" style={{ marginLeft: 6 }}>카카오</span> : null}<small>{r.address ?? (r.lat == null ? "좌표 없음" : "")}</small></td>
                  <td data-label="곁 장소">{props.placeName(r.placeId)}</td>
                  <td data-label="음식" className={cls("cuisine")}>{r.cuisine.length ? r.cuisine.join("·") : <span className="empty">—</span>}{aiLine("cuisine")}</td>
                  <td data-label="운영 시간" className={`ed ${cls("hours")}`} onClick={() => setEdit({ id: r.id, field: "hours" })}>
                    {r.openHours.length
                      ? <>{rep ? `${hm(rep.open)}–${hm(rep.close)}` : ""}<small>{daysLabel([...new Set(r.openHours.flatMap((h) => h.days))])}{r.openHours.some((h) => h.breaks.length) ? " · 브레이크" : ""}{r.openHours.some((h) => h.lastOrderMin != null) ? " · 마지막 주문" : ""}</small></>
                      : <span className="empty">비었음</span>}
                    {aiLine("hours")}
                  </td>
                  <td data-label="주차" className={`ed ${cls("parking")}`} onClick={() => setEdit({ id: r.id, field: "parking" })}>{r.parking ? `${PK[r.parking.has]}${r.parking.fee === "free" ? " · 무료" : r.parking.fee === "paid" ? " · 유료" : ""}` : <span className="empty">—</span>}{aiLine("parking")}</td>
                  <td data-label="아이" className={cls("kid")}>{kids.length ? <>{KID_TEXT[kids[0]]}{kids.length > 1 ? <small>+{kids.length - 1}</small> : null}</> : <span className="empty">—</span>}{aiLine("kid")}</td>
                  <td data-label="가격" className={`ed ${cls("price")}`} onClick={() => setEdit({ id: r.id, field: "price" })}>{r.price ? FOOD_PRICE_TEXT[r.price.level] : <span className="empty">—</span>}{aiLine("price")}</td>
                  <td data-label="식사" className={cls("meal")}>{r.meal.length ? r.meal.map((m) => MEAL_TYPE_TEXT[m]).join("·") : <span className="muted">기본</span>}{aiLine("meal")}</td>
                  <td data-label="완성도"><span className="row" style={{ gap: 6 }}><Ring pct={(comp.done / comp.total) * 100} /><small style={{ margin: 0 }}>{comp.done}/{comp.total}</small></span></td>
                  <td data-label="확인">
                    {checks.length ? <span className="src check" title={checks.map((f) => FIELD_TEXT[f]).join(" · ")}>확인 {checks.length}</span> : null}
                    {ai ? <span className="src ai">AI {ai}</span> : null}
                    {stale.length ? <span className="src stale" title={stale.map((f) => FIELD_TEXT[f]).join(" · ")}>오래됨 {stale.length}</span> : null}
                  </td>
                  <td data-label="켜기">
                    <button className={`chip ${r.active ? "on" : ""}`} onClick={() => props.onActive(r, !r.active)}>{r.active ? "켬" : "꺼짐"}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length ? <div className="hint">맞는 식당이 없어요. &lsquo;카카오에서 근처 식당 가져오기&rsquo;로 장소마다 2~3곳을 초안으로 넣을 수 있어요.</div> : null}
      </div>
      <BulkBar count={chosen.length} drafts={chosen.reduce((a, x) => a + x.ai, 0)} checks={chosen.reduce((a, x) => a + x.checks.length, 0)} onClear={() => setSel([])}>
        <button className="btn sm line" onClick={() => setSbs(true)}><Columns2 size={14} />원문과 나란히 보기</button>
        <button className="btn sm ai" disabled={!!busy || !chosen.some((x) => x.ai)} onClick={acceptAll}><Sparkles />AI 초안 모두 받아들이기</button>
        <button className="btn sm ink" disabled={!!busy || !chosenChecks.length} onClick={confirmAll}><BadgeCheck />고른 곳 모두 &lsquo;확인&rsquo;</button>
        <button className="btn sm line" disabled={!!busy || !chosen.some((x) => !x.r.active)} onClick={turnOn} title="음식 종류가 있는 곳만"><Power size={14} />켜기</button>
      </BulkBar>
      <div className="hint">
        켠 식당만 밥 자리 후보예요 (가족 설정 &lsquo;밥도 같이 짜기&rsquo; 또는 고르기의 &lsquo;점심도 넣어 줘요&rsquo;를 켰을 때). 노란 칸 = 확인 필요 —
        확인 전 운영 시간·주차는 추천 조건으로 안 쓰고(운영 시간은 11:00~21:00로 어림) 점수에만 약하게 써요. 보라 = AI 초안(✨). 빗금 = 90일 넘게 확인 안 함.
        <b> 운영 시간·주차·가격</b> 칸은 눌러서 바로 고쳐요.
      </div>
      {ed && edit?.field === "hours" ? <HoursPop p={ed} lastOrder busy={busy === ed.id} onClose={() => setEdit(null)} onSave={(rows) => patch(ed, { openHours: rows }, "hours")} /> : null}
      {ed && edit?.field === "parking" ? <ParkingPop value={ed.parking} name={ed.name} busy={busy === ed.id} onClose={() => setEdit(null)} onSave={(v) => patch(ed, { parking: v }, "parking")} /> : null}
      {ed && edit?.field === "price" ? (
        <Pop title={`${ed.name} · 가격 (1인)`} onClose={() => setEdit(null)}>
          <div className="chips">
            {FOOD_PRICE_TEXT.map((t, i) => (
              <button key={t} className={`chip ${ed.price?.level === i ? "on" : ""}`} disabled={busy === ed.id} onClick={() => patch(ed, { price: { level: i as 0 | 1 | 2 | 3 } }, "price")}>{t}</button>
            ))}
            <button className={`chip ${!ed.price ? "on" : ""}`} disabled={busy === ed.id} onClick={() => patch(ed, { price: null }, "price")}>모름</button>
          </div>
          <div className="hint">누르면 바로 저장하고 앱에 보내요.</div>
        </Pop>
      ) : null}
      {sbs ? <SideBySide kind="restaurant" items={chosen.map((x) => ({ id: x.r.id, name: x.r.name, drafts: x.r.aiDrafts }))} onClose={() => setSbs(false)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ 편집

function FoodEditor(props: {
  draft: Draft; places: AdminPlace[]; tags: string[] | null; today: string; busy: boolean; error: string | null; hoursErr: string | null;
  edit: (patch: Partial<Draft>, field?: FoodMetaField) => void; confirm: (f: FoodMetaField) => void;
  onSave: () => void; onBack: () => void; onRemove: () => void; toast: Toast;
  aiReady: boolean | null; aiMock?: boolean; dropped: { field: string; reason: string }[] | null;
  ai: { accept: (f: string) => void; fix: (f: string) => void; discard: (f: string) => void; fill: (text: string | null) => Promise<void> };
}) {
  const { draft: d, edit, today } = props;
  const comp = foodCompleteness({ ...d, id: d.id ?? "" });
  const checks = FOOD_META_FIELDS.filter((f) => d.meta[f]?.check).map((f) => FIELD_TEXT[f]);
  const stale = FOOD_META_FIELDS.filter((f) => isStale(d.meta[f], today)).map((f) => FIELD_TEXT[f]);
  const near = props.places.find((p) => p.id === d.placeId);
  const center = d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : near ? { lat: near.lat, lng: near.lng } : { lat: 35.8858, lng: 128.5828 };
  const needs = (id: string) => FSECS.find((s) => s.id === id)!.fields.some((f) => d.meta[f as FoodMetaField]?.check);
  const hasAi = (id: string) => FSECS.find((s) => s.id === id)!.fields.some((f) => d.aiDrafts[f]);
  const sec = (id: string, icon: React.ReactNode, title: string, field: FoodMetaField | undefined, body: React.ReactNode) => (
    <Sec id={id} icon={icon} title={title} needs={needs(id)} ai={hasAi(id)}>
      <div className={`sechead ${field && d.meta[field]?.check ? "needs" : ""}`}>
        {icon}<b>{title}</b>
        {field ? <SourceBadge meta={d.meta[field]} today={today} onConfirm={() => props.confirm(field)} /> : null}
      </div>
      {body}
    </Sec>
  );
  const fit = (c: (typeof COMPANIONS)[number]) => d.fit?.[c] ?? 0.6;
  return (
    <section>
      <div className="top">
        <button className="btn sm soft" onClick={props.onBack}><ArrowLeft />표로</button>
        <h1 style={{ marginLeft: 8 }}>{d.id ? d.name || "식당" : "식당 추가"}</h1>
        {d.active ? <span className="tag">켬</span> : <span className="tag">꺼짐 · 초안</span>}
        {checks.length ? <span className="tag w">확인 {checks.length}</span> : null}
        <div className="sp" />
        {d.id ? <button className="btn sm warn" onClick={props.onRemove}><Trash2 size={14} />지우기</button> : null}
        <button className="btn ink savebtn" disabled={props.busy || !!props.error} onClick={props.onSave} title={props.error ?? ""}>저장하고 앱에 보내기</button>
      </div>
      <div className="edit food" key={d.id ?? "new"}>
        <div className="card edmain">
          <SecNav resetKey={d.id ?? "new"} items={FSECS.map((s) => ({ id: s.id, label: s.label, warn: s.fields.some((f) => d.meta[f as FoodMetaField]?.check) }))} />
          <MapBox single label={d.lat != null ? `${d.lat.toFixed(5)}, ${d.lng?.toFixed(5)}` : "좌표 없음"} points={[{ lat: center.lat, lng: center.lng, r: 60, name: d.name || "식당" }]}
            fitKey={d.id ?? d.placeId ?? "new"} toast={props.toast} hint="지도를 누르거나 핀을 끌어 식당 위치를 옮겨요."
            onChange={(ps) => edit({ lat: Math.round(ps[0].lat * 1e6) / 1e6, lng: Math.round(ps[0].lng * 1e6) / 1e6 }, "location")} />
          {sec("f-basic", <FileText />, "기본 · 위치", "location", (
            <>
              <div className="form">
                <div><label className="l">이름</label><input value={d.name} onChange={(e) => edit({ name: e.target.value })} placeholder="예) 할매칼국수" /></div>
                <div><label className="l">곁 장소</label>
                  <select value={d.placeId ?? ""} onChange={(e) => edit({ placeId: e.target.value || null })}>
                    <option value="">고르지 않음</option>
                    {props.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></div>
                <div><label className="l">위도</label><input value={d.lat ?? ""} onChange={(e) => edit({ lat: e.target.value === "" ? null : Number(e.target.value) }, "location")} /></div>
                <div><label className="l">경도</label><input value={d.lng ?? ""} onChange={(e) => edit({ lng: e.target.value === "" ? null : Number(e.target.value) }, "location")} /></div>
                <div><label className="l">전화</label><input value={d.phone ?? ""} onChange={(e) => edit({ phone: e.target.value || null })} /></div>
                <div><label className="l">주소</label><input value={d.address ?? ""} onChange={(e) => edit({ address: e.target.value || null })} /></div>
                <div className="full"><label className="l">지도 주소 {d.kakaoId ? <span className="muted">· 카카오 {d.kakaoId}</span> : null}</label>
                  <span className="row" style={{ gap: 6 }}>
                    <input value={d.url ?? ""} onChange={(e) => edit({ url: e.target.value || null })} placeholder="https://place.map.kakao.com/…" />
                    {d.url ? <a className="btn sm soft" href={d.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a> : null}
                  </span></div>
              </div>
            </>
          ))}
          {sec("f-hours", <Clock3 />, "운영 시간 · 브레이크 · 마지막 주문", "hours", (
            <HoursEditor rows={d.openHours} error={props.hoursErr} lastOrder onChange={(rows) => edit({ openHours: rows }, "hours")} />
          ))}
          {sec("f-parking", <Car />, "주차", "parking", <ParkingBlock value={d.parking} onChange={(v) => edit({ parking: v }, "parking")} />)}
          {sec("f-kid", <Baby />, "아이와", "kid", (
            <div className="chips">
              {KID_FEATURES.map((k) => (
                <button key={k} className={`chip ${d.kid?.[k] ? "on" : ""}`}
                  onClick={() => { const n = { ...(d.kid ?? {}), [k]: !d.kid?.[k] }; Object.keys(n).forEach((x) => { if (!n[x]) delete n[x]; }); edit({ kid: Object.keys(n).length ? n : null }, "kid"); }}>{KID_TEXT[k]}</button>
              ))}
              <span className="muted">· 예전 칩</span>
              {FOOD_FACILITIES.map((f) => <button key={f} className={`chip ${d.facilities.includes(f) ? "on" : ""}`} onClick={() => edit({ facilities: toggle(d.facilities, f) })}>{f}</button>)}
            </div>
          ))}
          {sec("f-cuisine", <Soup />, "음식 종류 (1~2개) · 가격", "cuisine", (
            <>
              <div className="chips">
                {CUISINES.map((c) => (
                  <button key={c} className={`chip ${d.cuisine.includes(c) ? "on" : ""}`} disabled={!d.cuisine.includes(c) && d.cuisine.length >= 2}
                    onClick={() => edit({ cuisine: toggle(d.cuisine, c) }, "cuisine")}>{c}</button>
                ))}
              </div>
              <div className="chips" style={{ marginTop: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>가격(1인)</span>
                {FOOD_PRICE_TEXT.map((t, i) => (
                  <button key={t} className={`chip ${d.price?.level === i ? "on" : ""}`} onClick={() => edit({ price: d.price?.level === i ? null : { level: i as 0 | 1 | 2 | 3 } }, "price")}>{t}</button>
                ))}
              </div>
            </>
          ))}
          {sec("f-meal", <UtensilsCrossed />, "식사 자리 · 머무름 · 붐빔 · 예약", "wait", (
            <>
              <div className="chips">
                <span className="muted" style={{ fontSize: 12 }}>식사 자리</span>
                {MEAL_TYPES.map((m) => <button key={m} className={`chip ${d.meal.includes(m) ? "on" : ""}`} onClick={() => edit({ meal: toggle(d.meal, m) as MealType[] }, "meal")}>{MEAL_TYPE_TEXT[m]}</button>)}
                <span className="muted">(비우면 카페·베이커리 = 간식, 그 밖 = 점심·저녁)</span>
              </div>
              {WAIT_KEYS.map((k) => (
                <div key={k} className="chips" style={{ marginTop: 6 }}>
                  <span className="muted" style={{ fontSize: 12, minWidth: 64 }}>{WAIT_KEY_TEXT[k]}</span>
                  {WAIT_LEVEL_TEXT.map((t, i) => (
                    <button key={t} className={`chip ${d.wait?.[k] === i ? "on" : ""}`}
                      onClick={() => { const n = { ...(d.wait ?? {}) }; if (n[k] === i) delete n[k]; else n[k] = i as 0 | 1 | 2; edit({ wait: Object.keys(n).length ? n : null }, "wait"); }}>{t}</button>
                  ))}
                </div>
              ))}
              <div className="hgrid" style={{ marginTop: 8 }}>
                <label>머무름 (분, 비우면 50 · 카페 30)<input type="number" min={FOOD_DWELL_RANGE[0]} max={FOOD_DWELL_RANGE[1]} value={d.dwellMin ?? ""}
                  onChange={(e) => edit({ dwellMin: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} /></label>
                <label>예약
                  <select value={d.reserve ?? ""} onChange={(e) => edit({ reserve: (e.target.value || null) as Reserve | null })}>
                    <option value="">모름</option>
                    {RESERVE_TYPES.map((r) => <option key={r} value={r}>{RESERVE_TEXT[r]}</option>)}
                  </select></label>
              </div>
            </>
          ))}
          {sec("f-fit", <Users />, "어울림 (누구랑) · 태그", "fit", (
            <>
              <div className="hgrid">
                {COMPANIONS.map((c) => (
                  <label key={c}>{COMPANION_TEXT[c]} <b>{Math.round(fit(c) * 100)}</b>
                    <input type="range" min={0} max={1} step={0.05} value={fit(c)} onChange={(e) => edit({ fit: { ...(d.fit ?? {}), [c]: Number(e.target.value) } }, "fit")} /></label>
                ))}
              </div>
              <div className="chips" style={{ marginTop: 10 }}>
                <Tags size={14} /><span className="muted" style={{ fontSize: 12 }}>태그 (단어장 &lsquo;식당&rsquo;)</span>
                {(props.tags ?? []).map((t) => <button key={t} className={`chip ${d.tags.includes(t) ? "on" : ""}`} onClick={() => edit({ tags: toggle(d.tags, t) }, "tags")}>{t}</button>)}
                {!props.tags ? <span className="muted">단어장 읽는 중…</span> : null}
              </div>
            </>
          ))}
          {sec("f-memo", <Pencil />, "메모 · 앱에 보이기", undefined, (
            <div className="form" style={{ marginTop: 4 }}>
              <div className="full"><label className="l">메모 (표시용)</label><input value={d.note ?? ""} onChange={(e) => edit({ note: e.target.value || null })} placeholder="카카오 분류·주차 팁 등" /></div>
              <div className="full"><label className="l">켜기 (밥 자리 후보)</label>
                <div className="chips"><button className={`chip ${d.active ? "on" : ""}`} onClick={() => edit({ active: !d.active })}>{d.active ? "켬" : "꺼짐 · 초안"}</button></div></div>
            </div>
          ))}
          {props.error ? <div className="hint warn">{props.error}</div> : null}
          <button className="btn ink mobsave" disabled={props.busy || !!props.error} onClick={props.onSave}>저장하고 앱에 보내기</button>
        </div>
        <div className="rail">
          <Completeness done={comp.done} total={comp.total} missing={comp.missing} checks={checks} stale={stale} />
          <AiDraftsCard kind="restaurant" drafts={d.aiDrafts} onAccept={props.ai.accept} onFix={props.ai.fix} onDiscard={props.ai.discard} onFill={props.ai.fill}
            ready={d.id ? props.aiReady : false} mock={props.aiMock} dropped={props.dropped} />
          <div className="card prevcard">
            <h3><BadgeCheck />밥 자리에 쓰는 법</h3>
            <div className="hint">
              코스가 점심(11:30~13:30)·저녁(17:30~19:30) 때를 지나면 앞뒤 곳 사이에서 <b>돌아가는 시간 10분 안</b>, 그때 <b>문 연(브레이크·마지막 주문 피해서)</b> 식당을 골라요.
              점수: 누구랑 어울림 · 아이 칸(아이와) · 주차 · 주말 붐빔 · 태그.
            </div>
            <div className="hint">칩 예: <b>12:10 점심 · {d.name || "○○"}{(() => { const f = [KID_FEATURES.filter((k) => d.kid?.[k]).map((k) => KID_TEXT[k])[0], d.parking?.has === "yes" ? (d.parking.fee === "free" ? "주차 무료" : "주차 쉬움") : null].filter(Boolean); return f.length ? ` (${f.join("·")})` : ""; })()}</b></div>
          </div>
          <div className="card srcs">
            <h3>칸마다 출처</h3>
            {FOOD_META_FIELDS.map((f) => (
              <div key={f} className={`srcline ${d.meta[f]?.check ? "needs" : ""}`} title={d.meta[f]?.quote ? `원문: ${d.meta[f]!.quote}` : undefined}>
                <span>{FIELD_TEXT[f]}</span>
                <SourceBadge meta={d.meta[f]} today={today} onConfirm={() => props.confirm(f)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ 카카오에서 근처 식당 가져오기

type ImportResult = { places: number; added: number; version: number | null; per: { placeId: string; name: string; found: number; picked: string[]; error?: string }[] };

function KakaoImport(props: { places: AdminPlace[]; onClose: () => void; onDone: (version: number | null) => void; toast: Toast }) {
  const [scope, setScope] = useState<"place" | "region">("region");
  const [placeId, setPlaceId] = useState(props.places[0]?.id ?? "");
  const [region, setRegion] = useState("대구");
  const [take, setTake] = useState(3);
  const [cafes, setCafes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);
  const active = props.places.filter((p) => p.active);
  const regionCount = active.filter((p) => (p.region ?? "").startsWith(region.trim())).length;
  async function run() {
    setBusy(true);
    try {
      const r = await api<ImportResult>("POST", "/api/admin/restaurants/kakao", scope === "place" ? { placeId, take, cafes } : { region: region.trim(), take, cafes });
      setRes(r);
      props.toast(`${r.places}곳 둘레에서 ${r.added}곳을 초안으로 넣었어요`);
      props.onDone(r.version);
    } catch (e) {
      props.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dlg" onClick={props.onClose}>
      <div className="card" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="row"><b style={{ fontSize: 16 }}>카카오에서 근처 식당 가져오기</b><div className="sp" /><button className="btn sm soft" onClick={props.onClose}><X /></button></div>
        <div className="hint">장소마다 1.5km 안 음식점을 <b>가까운 순</b>으로 {take}곳 — <b>꺼진 초안</b>(출처 카카오 · 확인 필요)으로 넣어요. 이미 있는 카카오 번호는 건너뛰어요. 이름·좌표·주소·전화·음식 종류(카카오 분류로 짐작)까지 채워지고, 운영 시간·아이 칸·주차는 표에서 훑고 채운 뒤 켜 주세요.</div>
        <div className="form">
          <div className="full"><div className="seg">
            <button className={scope === "region" ? "on" : ""} onClick={() => setScope("region")}>지역 전체</button>
            <button className={scope === "place" ? "on" : ""} onClick={() => setScope("place")}>한 장소</button>
          </div></div>
          {scope === "region" ? (
            <div className="full"><label className="l">지역 (장소 지역 글 앞부분 — 대구 · 경북 · 대구 북구 …) · 켜진 장소 {regionCount}곳</label>
              <input value={region} onChange={(e) => setRegion(e.target.value)} /></div>
          ) : (
            <div className="full"><label className="l">장소</label>
              <select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>{props.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          )}
          <div><label className="l">장소마다</label>
            <div className="chips">{[2, 3, 4].map((n) => <button key={n} className={`chip ${take === n ? "on" : ""}`} onClick={() => setTake(n)}>{n}곳</button>)}</div></div>
          <div><label className="l">카페</label>
            <div className="chips"><button className={`chip ${cafes ? "on" : ""}`} onClick={() => setCafes(!cafes)}>{cafes ? "카페도 1곳씩" : "음식점만"}</button></div></div>
        </div>
        {res ? (
          <div className="hint" style={{ maxHeight: 220, overflow: "auto" }}>
            {res.per.map((p) => <div key={p.placeId}><b>{p.name}</b> — {p.error ? <span className="warn">{p.error}</span> : p.picked.length ? p.picked.join(" · ") : `새로 넣을 곳 없음 (찾은 ${p.found}곳)`}</div>)}
          </div>
        ) : null}
        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end", gap: 8 }}>
          <button className="btn ink" disabled={busy || (scope === "region" && regionCount === 0)} onClick={run}>{busy ? "가져오는 중…" : "가져오기"}</button>
        </div>
      </div>
    </div>
  );
}
