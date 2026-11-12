"use client";

import { CompanionFit } from "./CompanionFit";
import { useState } from "react";
import { BarChart3, CalendarClock, Download, FileText, Landmark, LayoutList, Moon, PencilLine, Plus, ScrollText, Smartphone, Stamp, UploadCloud, X } from "lucide-react";
import {
  ALBUM_GROUPS,
  RADIUS_MAX,
  RADIUS_MIN,
  type AdminPlace,
  type ArrivalPoint,
  type Mission,
} from "@/lib/catalog-shape";
import { COMPANION_TEXT, COMPANIONS } from "@/lib/planner";
import { acceptPlaceDraft, discardDraft, draftText } from "@/lib/ai-fill-shape";
import type { AiDrafts } from "@/lib/place-attrs-shape";
import type { PlacesIntent } from "./AdminApp";
import { AiDraftsCard, MapBox, Ring, Sec, SecNav } from "./admin-kit";
import { placeState } from "./TodoPane";
import {
  addDays, arrivalLine, arrivalWindows, closedDatesFromRules, parseHoursRows, parseMoments, regionCodeOf,
  representativeHours, rowsFromColumns, weekday, META_FIELDS,
  type MetaField, type MetaSource, type VocabWord,
} from "@/lib/place-attrs-shape";
import { draftFromResearch, type AttrDraft } from "@/lib/place-attrs-text";
import { kstToday } from "@/lib/festival-shape";
import { MAX_WAIT_MIN, MIN_VISIT_MIN } from "@/lib/planner";
import { api, stampSrc, type Toast } from "./AdminApp";
import { AiStampCard } from "./AiStampCard";
import { defaultBottom, defaultTop } from "./stampcraft";
import type { Promote } from "./PopularPane";
import {
  ClosedBlock, Completeness, FacilityChips, FIELD_TEXT, FitExtraBlock, HoursEditor, KindRegion, MomentsBlock, ParkingBlock, PriceBlock,
  SecHead, SECTION_ICONS, SourceBadge, VocabTags, type Edit,
} from "./PlaceAttrs";
import { PlacesTable } from "./PlacesTable";

const groupTitle = (k: string) => ALBUM_GROUPS.find((g) => g.key === k)?.title ?? k;
const emptyMission = (): Mission => ({ quiz: { q: "", options: ["", "", ""], answer: 0 }, find: "" });

/** 비교용 (저장 안 한 변경 표시). */
const sig = (p: AdminPlace) => JSON.stringify([p.name, p.album, p.indoor, p.open, p.close, p.dwell, p.kidFit, p.fit, p.tags, p.dwellAdult, p.stampable, p.active,
  p.facilities, p.closedDays, p.tempClosed, p.points, p.intro, p.mission,
  p.openHours, p.closedRules, p.parking, p.price, p.moments, p.regionCode, p.kind, p.route, p.fitExtra, p.meta, p.aiDrafts]);

/** 저장 요청 몸 (편집 화면 · 표에서 바로 고침 · 한꺼번에 같은 모양). 예전 칸 open·close = 운영 시간 줄의 평일 대표값. */
export function placeBody(cur: AdminPlace) {
  const rep = representativeHours(cur.openHours) ?? { open: cur.open, close: cur.close };
  return {
    name: cur.name, album: cur.album, indoor: cur.indoor, open: rep.open, close: rep.close, dwell: cur.dwell, kidFit: cur.kidFit,
    stampable: cur.stampable, active: cur.active, facilities: cur.facilities, closedDays: cur.closedDays, tempClosed: cur.tempClosed,
    points: cur.points, intro: cur.intro, mission: cur.mission, fit: cur.fit, tags: cur.tags, dwellAdult: cur.dwellAdult,
    openHours: cur.openHours, closedRules: cur.closedRules, parking: cur.parking, price: cur.price, moments: cur.moments,
    regionCode: cur.regionCode, kind: cur.kind, route: cur.route, meta: cur.meta, fitExtra: cur.fitExtra, aiDrafts: cur.aiDrafts,
  };
}

type ListFilter = "all" | "check" | "evening" | "stamp";
const isEvening = (p: AdminPlace) => !!p.moments?.best.some((b) => b === "night" || b === "sunset") || !!p.fitExtra.evening || p.kind === "drive";

/** 섹션 ↔ 칸 (바로가기 '!' · 휴대폰에서 처음부터 펼침) */
const SECTIONS: { id: string; label: string; fields: string[] }[] = [
  { id: "s-map", label: "지도", fields: [] },
  { id: "s-basic", label: "기본", fields: ["kind", "region"] },
  { id: "s-hours", label: "운영 시간", fields: ["hours"] },
  { id: "s-closed", label: "쉬는 날", fields: ["closed"] },
  { id: "s-parking", label: "주차·가격", fields: ["parking", "price"] },
  { id: "s-fac", label: "시설", fields: ["facilities"] },
  { id: "s-moments", label: "저녁·시간 특성", fields: ["moments"] },
  { id: "s-fit", label: "어울림·태그", fields: ["fit", "tags"] },
  { id: "s-intro", label: "소개·미션", fields: [] },
  { id: "s-stamp", label: "도장", fields: [] },
];
const sectionOf = (field: string) => SECTIONS.find((s) => s.fields.includes(field))?.id ?? "s-basic";

/** 기준 주의 월요일 (미리 보기: 다음 주 월~일). */
const nextMonday = (today: string) => addDays(today, ((8 - weekday(today)) % 7) || 7);

export function PlacesPane(props: {
  places: AdminPlace[];
  version: number;
  stamps30: Record<string, number>;
  initialPlace?: string;
  storeReady?: boolean | null;
  onSaved: (p: AdminPlace, version: number) => void;
  /** '많이 고른 곳' → '명소로 올리기': 명소 추가 창을 이 이름·좌표·반경으로 채워 연다 */
  promote?: Promote | null;
  onPromoteDone?: () => void;
  /** 태그 단어장 (표가 없으면 처음 단어장) · 관광공사 키가 있나 */
  vocab: VocabWord[];
  tourReady: boolean;
  /** 할 일 → 걸러진 표·목록 · 그 명소 */
  intent?: PlacesIntent | null;
  /** 장소마다 최근 추천 횟수 (할 일 숫자) */
  recs?: Record<string, number>;
  aiReady: boolean | null;
  aiMock?: boolean;
  onReload: () => Promise<void>;
  toast: Toast;
}) {
  const { places, toast } = props;
  const today = kstToday();
  const [view, setView] = useState<"edit" | "table">(props.intent?.view ?? "edit");
  const [tableFilter, setTableFilter] = useState<{ value: string; n: number } | null>(props.intent?.filter ? { value: props.intent.filter, n: props.intent.n } : null);
  const [vocab, setVocab] = useState(props.vocab);
  const [raw, setRaw] = useState<{ title: string; lines: Record<string, string> } | null>(null);
  const [filling, setFilling] = useState(false);
  const [q, setQ] = useState("");
  const [lf, setLf] = useState<ListFilter>("all");
  const [curId, setCurId] = useState(() => places.find((p) => p.id === (props.intent?.id ?? props.initialPlace))?.id ?? places.find((p) => p.id === "chimsan")?.id ?? places[0]?.id);
  const [drafts, setDrafts] = useState<Record<string, AdminPlace>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(!!props.promote);
  const [dropped, setDropped] = useState<{ field: string; reason: string }[] | null>(null);

  // 할 일에서 왔으면 그 보기로 (n이 바뀔 때마다 한 번)
  const [seenIntent, setSeenIntent] = useState(props.intent?.n ?? null);
  const it = props.intent;
  if (it && it.n !== seenIntent) {
    setSeenIntent(it.n);
    setView(it.view);
    if (it.filter) setTableFilter({ value: it.filter, n: it.n });
    if (it.id && places.some((p) => p.id === it.id)) { setCurId(it.id); setRaw(null); setDropped(null); }
  }

  const saved = places.find((p) => p.id === curId);
  const cur = curId ? drafts[curId] ?? saved : undefined;
  const dirty = (id: string) => {
    const d = drafts[id];
    const s = places.find((p) => p.id === id);
    return !!d && !!s && sig(d) !== sig(s);
  };
  const setCur = (next: AdminPlace) => setDrafts((ds) => ({ ...ds, [next.id]: next }));

  /** 고치기. field를 주면 그 칸 출처를 '관리자 · 오늘'로 (확인 필요 표시도 지움). */
  const edit: Edit = (patch, field) => {
    if (!cur) return;
    const meta = field ? { ...cur.meta, [field]: { src: "admin" as const, conf: 1, at: today } } : cur.meta;
    setCur({ ...cur, ...patch, meta });
  };
  /** 값은 그대로 두고 '확인했어요' (출처 그대로, 날짜는 오늘). */
  const confirm = (f: MetaField) => {
    if (!cur?.meta[f]) return;
    const m = { ...cur.meta[f]!, at: today };
    delete m.check;
    setCur({ ...cur, meta: { ...cur.meta, [f]: m } });
  };
  /** 초안 넣기 (관광공사·조사 원문) — 읽은 칸만, 모두 '확인 필요'. */
  const applyDraft = (d: AttrDraft, src: MetaSource, title: string) => {
    if (!cur) return;
    const meta = { ...cur.meta };
    const patch: Partial<AdminPlace> = {};
    const filled: string[] = [];
    const mark = (f: MetaField) => { meta[f] = { src, conf: src === "tourapi" ? 0.7 : 0.6, at: today, check: true }; filled.push(FIELD_TEXT[f]); };
    if (d.hours?.length) { patch.openHours = d.hours; mark("hours"); }
    if (d.closedDays || d.closedRules) { patch.closedDays = d.closedDays ?? cur.closedDays; patch.closedRules = d.closedRules ?? cur.closedRules; mark("closed"); }
    if (d.parking) { patch.parking = d.parking; mark("parking"); }
    if (d.price) { patch.price = d.price; mark("price"); }
    if (d.facilities?.length) { patch.facilities = [...new Set([...cur.facilities, ...d.facilities])]; mark("facilities"); }
    setCur({ ...cur, ...patch, meta });
    setRaw({ title, lines: d.raw });
    toast(filled.length ? `${filled.join(" · ")}을(를) 채웠어요 · 노란 '확인 필요'를 보고 저장하세요` : "읽을 수 있는 칸이 없었어요", !filled.length);
  };
  async function fillFromTour() {
    if (!cur) return;
    setFilling(true);
    try {
      const r = await api<{ draft: AttrDraft; contentId: string; title: string | null }>("GET", `/api/admin/places/${cur.id}/tour`);
      applyDraft(r.draft, "tourapi", `관광공사 · ${r.title ?? r.contentId}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setFilling(false);
    }
  }
  async function addWord(tag: string, category: string) {
    try {
      const r = await api<{ vocab: VocabWord[] }>("POST", "/api/admin/tag-vocab", { tag, category });
      setVocab(r.vocab);
      toast(`단어장에 '${tag}'을(를) 더했어요`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  // ─ AI 초안: 맞아요 · 고치기 · 버리기 (저장 전까지는 이 화면에서만) · 채우기 (초안만 서버에 저장)
  const acceptAi = (f: string) => { if (cur) { setCur(acceptPlaceDraft(cur, f, today)); toast("칸에 넣었어요 · 저장하면 앱에 가요"); } };
  const fixAi = (f: string) => {
    if (!cur) return;
    const n = acceptPlaceDraft(cur, f, today);
    const m = n.meta[f as MetaField];
    // 고치기: 값은 칸으로 옮기되 '확인 필요'로 두고 그 섹션으로 (손대면 관리자 출처로 바뀜)
    setCur(m ? { ...n, meta: { ...n.meta, [f]: { ...m, check: true } } } : n);
    const el = document.getElementById(sectionOf(f));
    if (el) { el.classList.add("open"); el.scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  const discardAi = (f: string) => { if (cur) setCur(discardDraft(cur, f)); };
  async function fillAi(text: string | null) {
    if (!cur) return;
    try {
      const r = await api<{ drafts: AiDrafts; added: string[]; dropped: { field: string; reason: string }[]; asked: string[]; mock: boolean }>(
        "POST", "/api/admin/ai-fill", { kind: "place", id: cur.id, text });
      if (saved) props.onSaved({ ...saved, aiDrafts: r.drafts }, props.version);
      if (drafts[cur.id]) setCur({ ...drafts[cur.id], aiDrafts: r.drafts });
      setDropped(r.dropped.filter((d) => d.field !== "*" || !r.added.length));
      toast(!r.asked.length ? "물어볼 칸이 없어요 (모두 확인했거나 오늘 이미 읽었어요)" : r.added.length ? `AI 초안 ${r.added.length}칸${r.mock ? " (모의)" : ""} · 오른쪽에서 보고 받아들이세요` : "원문에서 근거를 찾은 칸이 없었어요", !r.added.length && !!r.asked.length);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const rows = places.map((p0) => {
    const p = drafts[p0.id] ?? p0;
    return { p, ...placeState(p, vocab, today) };
  });
  const lcount: Record<ListFilter, number> = {
    all: rows.length, check: rows.filter((r) => r.checks.length).length, evening: rows.filter((r) => isEvening(r.p)).length, stamp: rows.filter((r) => r.p.stampable).length,
  };
  const qs = q.trim();
  const pass = (r: (typeof rows)[number]) =>
    (!qs || `${r.p.name} ${r.p.region ?? ""} ${r.p.tags.join(" ")} ${r.p.id}`.includes(qs)) &&
    (lf === "all" || (lf === "check" ? r.checks.length > 0 : lf === "evening" ? isEvening(r.p) : r.p.stampable));
  const grouped = ALBUM_GROUPS.map((g) => ({ ...g, items: rows.filter((r) => r.p.album === g.key && pass(r)) })).filter((g) => g.items.length);

  const pick = (id: string) => { setCurId(id); setRaw(null); setDropped(null); };

  /** 한 곳 바로 저장 (표에서 고침 · 한꺼번에). 저장 안 한 변경이 있으면 같이. */
  async function saveOne(p: AdminPlace): Promise<AdminPlace> {
    const res = await api<{ place: AdminPlace; version: number }>("PUT", `/api/admin/places/${p.id}`, placeBody(p));
    props.onSaved(res.place, res.version);
    setDrafts((ds) => { const n = { ...ds }; delete n[p.id]; return n; });
    return res.place;
  }
  const dirtyIds = places.filter((p) => dirty(p.id)).map((p) => p.id);
  async function save() {
    if (!cur) return;
    setSaving(true);
    const ids = dirtyIds.includes(cur.id) ? [cur.id, ...dirtyIds.filter((x) => x !== cur.id)] : dirtyIds;
    let n = 0, v = props.version;
    try {
      for (const id of ids) {
        const res = await api<{ place: AdminPlace; version: number }>("PUT", `/api/admin/places/${id}`, placeBody(drafts[id]));
        props.onSaved(res.place, res.version);
        setDrafts((ds) => { const x = { ...ds }; delete x[id]; return x; });
        v = res.version; n++;
      }
      toast(`${n > 1 ? `${n}곳 ` : ""}저장했어요 · 폰·차는 다음 실행 때 v${v}를 받아요`);
    } catch (e) {
      toast(`${n ? `${n}곳까지 저장 · ` : ""}${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  if (!cur) return <div className="card">명소가 없어요. <code>npm run seed:places</code>로 씨앗을 넣어 주세요.</div>;
  const m = cur.mission ?? emptyMission();
  const setMission = (patch: { find?: string; quiz?: Partial<Mission["quiz"]> }) =>
    edit({ mission: { ...m, ...patch, quiz: { ...m.quiz, ...(patch.quiz ?? {}) } } });

  // 검사 (서버 저장 검사와 같은 함수) · 완성도 · 미리 보기
  const hoursErr = (() => { const r = parseHoursRows(cur.openHours); return "error" in r ? r.error : null; })();
  const rep = representativeHours(cur.openHours) ?? { open: cur.open, close: cur.close };
  const momentsErr = (() => { const r = parseMoments(cur.moments, { hours: cur.openHours, open: rep.open, close: rep.close }); return "error" in r ? r.error : null; })();
  const stNow = placeState(cur, vocab, today);
  const comp = stNow.comp;
  const checks = stNow.checks.map((f) => FIELD_TEXT[f]);
  const stale = stNow.stale.map((f) => FIELD_TEXT[f]);
  const week = nextMonday(today);
  const preview = arrivalLine(arrivalWindows({
    hours: cur.openHours, openMin: rep.open, closeMin: rep.close, closedDays: cur.closedDays, dwell: cur.dwell,
    closedDates: [...cur.tempClosed, ...closedDatesFromRules(cur.closedRules, week, 7, cur.closedDays)],
  }, week, { waitMax: MAX_WAIT_MIN, minVisit: MIN_VISIT_MIN }));
  const head = (field: MetaField | undefined, icon: React.ReactNode, title: string, children?: React.ReactNode) => (
    <SecHead icon={icon} title={title} field={field} cur={cur} today={today} onConfirm={confirm}>{children}</SecHead>
  );
  const secNeeds = (id: string) => SECTIONS.find((s) => s.id === id)!.fields.some((f) => cur.meta[f as MetaField]?.check);
  const secAi = (id: string) => SECTIONS.find((s) => s.id === id)!.fields.some((f) => cur.aiDrafts[f]);
  // 휴대폰: 그 섹션의 AI 초안을 섹션 안에서 바로 (넓은 화면은 오른쪽 카드)
  const inlineAi = (id: string) => {
    const fs = SECTIONS.find((s) => s.id === id)!.fields.filter((f) => cur.aiDrafts[f]);
    return fs.length ? (
      <div className="secai">
        {fs.map((f) => (
          <div key={f} className="aiitem">
            <b>✨ {FIELD_TEXT[f as MetaField]}</b> {draftText("place", f, cur.aiDrafts[f]!.value)}
            <div className="q">원문: &ldquo;{cur.aiDrafts[f]!.quote}&rdquo;</div>
            <div className="a"><button className="y" onClick={() => acceptAi(f)}>✓ 맞아요</button><button onClick={() => fixAi(f)}>고치기</button><button onClick={() => discardAi(f)}>버리기</button></div>
          </div>
        ))}
      </div>
    ) : null;
  };
  const sec = (id: string, icon: React.ReactNode, title: string, children: React.ReactNode, className?: string) => (
    <Sec id={id} icon={icon} title={title} needs={secNeeds(id)} ai={secAi(id)} className={className}>{inlineAi(id)}{children}</Sec>
  );
  const evening = isEvening(cur);
  const anyDirty = dirtyIds.length > 0;

  return (
    <section className="placespane">
      <div className="top">
        <h1>명소</h1>
        <span className={`ver ${anyDirty ? "dirty" : ""}`}>목록 버전 v{props.version}{anyDirty ? " · 저장 안 한 변경 있음" : ""}</span>
        <div className="sp" />
        <div className="seg">
          <button className={view === "edit" ? "on" : ""} onClick={() => setView("edit")}><PencilLine />편집</button>
          <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}><LayoutList />표</button>
        </div>
        <button className="btn line" onClick={() => setAdding(true)}><Plus />명소 추가</button>
        <button className="btn ink savebtn" onClick={save} disabled={saving || !anyDirty || (dirty(cur.id) && (!!hoursErr || !!momentsErr))}
          title={hoursErr ?? momentsErr ?? undefined}><UploadCloud />{saving ? "저장 중…" : `저장하고 앱에 보내기${dirtyIds.length ? ` (${dirtyIds.length}곳 고침)` : ""}`}</button>
      </div>
      {view === "table" ? (
        <PlacesTable places={places.map((p) => drafts[p.id] ?? p)} vocab={vocab} today={today} dirty={dirty} filter={tableFilter}
          aiReady={props.aiReady} onReload={props.onReload} onSave={saveOne} toast={toast}
          onOpen={(id) => { pick(id); setView("edit"); }} />
      ) : (
      <div className="ed3" data-picked={cur.id}>
        <div className="card list plist">
          <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·지역·태그 찾기" /></div>
          <div className="chips lchips">
            {([["all", "전체"], ["check", "확인 필요"], ["evening", "저녁 명소"], ["stamp", "도장"]] as [ListFilter, string][]).map(([k, t]) => (
              <button key={k} className={`chip ${lf === k ? "on" : ""}`} onClick={() => setLf(k)}>{t} {lcount[k]}</button>
            ))}
          </div>
          {grouped.map((g) => (
            <div key={g.key}>
              <div className="grp">{g.title} · {g.items.length}</div>
              {g.items.map(({ p, pct, checks: ck, drafts: dr, stale: stl }) => (
                <button key={p.id} className={`item ${p.id === cur.id ? "on" : ""} ${p.active ? "" : "off"}`} onClick={() => pick(p.id)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={stampSrc(p)} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                  <div style={{ minWidth: 0 }}><b>{p.name}</b><span className="s">{p.region ?? p.id}{dirty(p.id) ? " · 고치는 중" : ""}</span></div>
                  <span className="istat">
                    {ck.length ? <span className="tag w" title="확인 필요">{ck.length}</span> : null}
                    {dr.length ? <span className="tag ai" title="AI 초안">AI</span> : null}
                    {!ck.length && stl.length ? <span className="tag r">90일</span> : null}
                    {dirty(p.id) ? <span className="dot" title="저장 안 함" /> : null}
                    <Ring pct={pct} />
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="editcol" key={cur.id}>
          <div className="card edmain">
            <SecNav resetKey={cur.id} items={SECTIONS.map((s) => ({ id: s.id, label: s.label, warn: s.fields.some((f) => cur.meta[f as MetaField]?.check) }))} />
            <div className="row edhead">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stampSrc(cur)} alt="" style={{ width: 44, height: 44, borderRadius: "50%" }} />
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: 18 }}>{cur.name}</b>
                <div style={{ fontSize: 12.5, color: "var(--mute)" }}>{cur.region ?? ""} · {cur.id}{cur.regionCode ? ` · 지역 ${cur.regionCode}` : ""}</div>
              </div>
              <div className="sp" />
              {stNow.checks.length ? <span className="tag w">확인 {stNow.checks.length}</span> : null}
            </div>

            <div id="s-map">
              <MapBox points={cur.points} fitKey={cur.id} onChange={(points: ArrivalPoint[]) => edit({ points })} toast={toast}
                hint={<><b>지도를 누르면</b> 고른 도착 지점이 그 자리로 옮겨요. <b>핀</b>은 끌어서, <b>원 가장자리 흰 점</b>을 끌면 반경이 바뀌어요.
                  차가 <b>어느 원 안에서든</b> P단 3초 + 주행거리 검증이 맞으면 도장이 찍혀요.</>} />
            </div>
            <Sec id="s-basic" icon={<FileText />} title="기본" needs={secNeeds("s-basic")}>
              <div className="toolbar">
                <button className="btn sm soft" disabled={!props.tourReady || filling} onClick={fillFromTour}
                  title={props.tourReady ? "관광공사 이용 정보(시간·쉬는 날·주차·요금·유모차·반려동물)를 칸으로" : "DATA_GO_KR_KEY가 없어요"}>
                  <Landmark />{filling ? "불러오는 중…" : "관광공사에서 채우기"}</button>
                <button className="btn sm soft" disabled={!cur.hours && !cur.closed} onClick={() => applyDraft(draftFromResearch(cur.hours, cur.closed), "seed", "조사")}>
                  <ScrollText />조사 원문에서 채우기</button>
                <span className="muted" style={{ fontSize: 12 }}>채운 칸은 노란 &lsquo;확인 필요&rsquo; — 보고 맞으면 &lsquo;확인&rsquo;</span>
              </div>
              {raw ? (
                <div className="hint raw">
                  <div className="row"><b>{raw.title} 원문</b><div className="sp" /><button className="btn sm soft" onClick={() => setRaw(null)}><X /></button></div>
                  {Object.entries(raw.lines).map(([k, v]) => <div key={k}><span className="muted">{k}</span> {v}</div>)}
                </div>
              ) : null}
              {head("kind", <FileText />, "기본")}
              <div className="form">
                <div><label className="l">이름</label><input value={cur.name} onChange={(e) => edit({ name: e.target.value })} /></div>
                <div><label className="l">도장북 묶음</label>
                  <select value={cur.album} onChange={(e) => edit({ album: e.target.value })}>
                    {ALBUM_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.title}</option>)}
                  </select></div>
                <KindRegion cur={cur} edit={edit} suggested={regionCodeOf(cur.region)} />
                <div className="full"><label className="l">실내·야외 · 추천·도장</label>
                  <div className="chips">
                    <button className={`chip ${cur.indoor ? "on" : ""}`} onClick={() => edit({ indoor: true })}>실내</button>
                    <button className={`chip ${!cur.indoor ? "on" : ""}`} onClick={() => edit({ indoor: false })}>야외</button>
                    <span className="muted">·</span>
                    <button className={`chip ${cur.active ? "on" : ""}`} onClick={() => edit({ active: !cur.active })}>{cur.active ? "추천에 넣음" : "추천에서 뺌"}</button>
                    <button className={`chip ${cur.stampable ? "on" : ""}`} onClick={() => edit({ stampable: !cur.stampable })}>{cur.stampable ? "도장 찍힘" : "도장 없음"}</button>
                  </div></div>
              </div>
            </Sec>

            {sec("s-hours", SECTION_ICONS.hours, "운영 시간", <>
              {head("hours", SECTION_ICONS.hours, "운영 시간")}
              <HoursEditor rows={cur.openHours} error={hoursErr} onChange={(rows) => edit({ openHours: rows }, "hours")} />
              {!cur.openHours.length ? (
                <button className="btn sm soft" style={{ marginTop: 6 }} onClick={() => edit({ openHours: rowsFromColumns(cur.open, cur.close) }, "hours")}>
                  <Download />예전 하루 시각({Math.floor(cur.open / 60)}:{String(cur.open % 60).padStart(2, "0")}~)으로 줄 만들기</button>
              ) : null}
              <div className="preview"><CalendarClock /><span><b>{preview}</b><small>다음 주({week.slice(5).replace("-", "/")}~) · 머무름 {cur.dwell}분 · 문 열기 {MAX_WAIT_MIN}분 전부터 기다리고, 닫기 전 {MIN_VISIT_MIN}분은 있어야 추천 (엔진 규칙)</small></span></div>
              {cur.hours ? <div className="hint">조사 원문: {cur.hours}</div> : null}
            </>)}

            {sec("s-closed", <CalendarClock />, "쉬는 날", <>
              {head("closed", <CalendarClock />, "쉬는 날")}
              <ClosedBlock cur={cur} edit={edit} />
            </>)}

            {sec("s-parking", SECTION_ICONS.parking, "주차·가격", <>
              {head("parking", SECTION_ICONS.parking, "주차")}
              <ParkingBlock value={cur.parking} onChange={(v) => edit({ parking: v }, "parking")} />
              <div style={{ marginTop: 12 }}>
                {head("price", SECTION_ICONS.price, "가격")}
                <PriceBlock value={cur.price} onChange={(v) => edit({ price: v }, "price")} />
              </div>
            </>)}

            {sec("s-fac", <Stamp />, "시설", <>
              {head("facilities", <Stamp />, "시설")}
              <FacilityChips cur={cur} edit={edit} />
            </>)}

            {sec("s-moments", SECTION_ICONS.moments, "저녁·시간 특성", <>
              {head("moments", SECTION_ICONS.moments, "시간 특성 (언제 가면 좋은지)")}
              <MomentsBlock value={cur.moments} error={momentsErr} onChange={(v) => edit({ moments: v }, "moments")} />
            </>)}

            {sec("s-fit", SECTION_ICONS.fit, "어울림·태그", <>
              {head("fit", SECTION_ICONS.fit, "어울림")}
              <div className="form" style={{ marginTop: 4 }}>
                <CompanionFit kidFit={cur.kidFit} fit={cur.fit} tags={cur.tags} hideTags onChange={(v) => edit(v, "fit")} />
                <FitExtraBlock cur={cur} edit={edit} />
              </div>
              <div style={{ marginTop: 10 }}>
                {head("tags", SECTION_ICONS.tags, "단어장 태그 (추천은 이 말만 써요)")}
                <VocabTags cur={cur} edit={edit} vocab={vocab} onAdd={addWord} />
              </div>
            </>)}

            {sec("s-intro", <PencilLine />, "머무름·소개·미션", <>
              {head(undefined, <PencilLine />, "머무름 · 소개 · 미션")}
              <div className="form" style={{ marginTop: 4 }}>
              <div><label className="l">머무는 시간 (분, 4살 기준)</label>
                <input type="number" min={5} max={600} value={cur.dwell} onChange={(e) => edit({ dwell: Math.round(Number(e.target.value)) })} /></div>
              <div><label className="l">어른 머무는 시간 (분, 비우면 × 0.8 = {Math.round(cur.dwell * 0.8 / 5) * 5})</label>
                <input type="number" min={5} max={600} value={cur.dwellAdult ?? ""} placeholder="자동"
                  onChange={(e) => edit({ dwellAdult: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} /></div>
              <div className="full"><label className="l">도착 2분 전 소개 (음성으로 읽어요)</label>
                <textarea rows={3} value={cur.intro} onChange={(e) => edit({ intro: e.target.value })} placeholder="곧 ○○에 도착해요. …" />
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>음성 파일은 아직 따로 만들어요 (tools/introgen). 글만 바꾸면 앱 소개 음성은 그대로예요.</div></div>
              <div className="full"><label className="l">미션 — 퀴즈 (정답 보기에 ● 표시)</label>
                <input value={m.quiz.q} onChange={(e) => setMission({ quiz: { q: e.target.value } })} placeholder="퀴즈 질문" />
                <div className="quiz3">
                  {[0, 1, 2].map((k) => (
                    <div key={k} className="row" style={{ gap: 4 }}>
                      <button className={`chip ${m.quiz.answer === k ? "on" : ""}`} title="정답으로" onClick={() => setMission({ quiz: { answer: k } })}>{m.quiz.answer === k ? "●" : "○"}</button>
                      <input value={m.quiz.options[k] ?? ""} placeholder={`보기 ${k + 1}`}
                        onChange={(e) => { const o = [...m.quiz.options]; while (o.length < 3) o.push(""); o[k] = e.target.value; setMission({ quiz: { options: o } }); }} />
                    </div>
                  ))}
                </div>
                <input style={{ marginTop: 6 }} value={m.find} onChange={(e) => setMission({ find: e.target.value })} placeholder="찾아보기: 예) 석굴 안 부처님이 모두 몇 분인지 세어 보기" />
              </div>
              </div>
            </>)}
          </div>

          <div id="s-stamp">
            {saved ? (
              <AiStampCard key={saved.id} kind="place" id={saved.id} name={saved.name} album={groupTitle(saved.album)}
                top={defaultTop(saved.region, saved.name)} bottom={defaultBottom(saved.id)} storeReady={props.storeReady ?? null}
                onStampSaved={(stamp, v) => props.onSaved({ ...saved, stamp, stampable: true }, v)} toast={toast} />
            ) : null}
          </div>
          {anyDirty ? <button className="btn ink mobsave" onClick={save} disabled={saving}><UploadCloud />{saving ? "저장 중…" : `저장하고 앱에 보내기${dirtyIds.length > 1 ? ` (${dirtyIds.length}곳)` : ""}`}</button> : null}
        </div>

        <div className="rail">
          <Completeness done={comp.done} total={comp.total} missing={comp.missing} checks={checks} stale={stale} />
          <AiDraftsCard kind="place" drafts={cur.aiDrafts} onAccept={acceptAi} onFix={fixAi} onDiscard={discardAi} onFill={fillAi}
            ready={props.aiReady} mock={props.aiMock} dropped={dropped} />
          <div className="card prevcard">
            <h3><Moon />미리 보기</h3>
            <div className="pline">{preview}</div>
            <div className="pline">{evening ? <>저녁 나들이 후보 <b>✓</b></> : <span className="muted">저녁 후보 아님 (시간 특성에 밤·노을)</span>}
              {" · "}{COMPANIONS.map((c) => `${COMPANION_TEXT[c].replace("연인·부부", "연인").replace("친구끼리", "친구")} ${(c === "kids" ? cur.kidFit : cur.fit[c]).toFixed(1)}`).join(" · ")}</div>
            {props.recs?.[cur.id] != null ? <div className="pline muted">최근 30일 추천 카드에 {props.recs[cur.id]}번 나왔어요</div> : null}
          </div>
          <div className="card srcs">
            <h3>칸마다 출처</h3>
            {META_FIELDS.map((f) => (
              <div key={f} className={`srcline ${cur.meta[f]?.check ? "needs" : ""}`} title={cur.meta[f]?.quote ? `원문: ${cur.meta[f]!.quote}` : undefined}>
                <span>{FIELD_TEXT[f]}</span>
                <SourceBadge meta={cur.meta[f]} today={today} onConfirm={() => confirm(f)} />
              </div>
            ))}
          </div>
          <h3 className="railh"><Smartphone />폰 도장 획득 화면 미리보기</h3>
          <div className="medal">
            <div className="bg" style={{ backgroundImage: `url(${stampSrc(cur)})` }} />
            <div className="shade" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="coin" src={stampSrc(cur)} alt="" />
            <div className="pill"><Stamp size={14} />도장 획득!</div>
            <div className="info"><small>NEW STAMP</small><b>{cur.name}</b><span>No.{(props.stamps30[cur.id] ?? 0) + 1} · {groupTitle(cur.album)}</span></div>
          </div>
          <h3 className="railh"><BarChart3 />최근 30일</h3>
          <div className="stat">
            <div><b>{props.stamps30[cur.id] ?? 0}</b><span>도장 찍은 차</span></div>
            <div><b>{cur.dwell}분</b><span>머무는 시간(설정)</span></div>
            <div><b>v{cur.stamp.version}</b><span>도장 그림 판</span></div>
          </div>
        </div>
      </div>
      )}
      {adding ? (
        <AddPlace init={props.promote ?? undefined} near={cur.points[0]}
          onClose={() => { setAdding(false); props.onPromoteDone?.(); }}
          onDone={(p, v, r) => {
            props.onSaved(p, v);
            pick(p.id);
            setView("edit");
            // 올린 곳의 반경을 정했으면 저장 안 한 변경으로 넣어 둔다 (확인하고 '저장하고 앱에 보내기')
            if (r && p.points[0] && p.points[0].r !== r) setDrafts((ds) => ({ ...ds, [p.id]: { ...p, points: p.points.map((x, i) => (i === 0 ? { ...x, r } : x)) } }));
            setAdding(false);
            props.onPromoteDone?.();
            toast(props.promote
              ? `${p.name}을(를) 명소로 만들었어요 · 지도·시간을 다듬고 저장한 뒤 아래 'AI로 도장 만들기'`
              : `${p.name}을(를) 만들었어요 · 추천에서 빠진 상태예요`);
          }} toast={toast} />
      ) : null}
    </section>
  );
}


function AddPlace(props: { near: ArrivalPoint; init?: Promote; onClose: () => void; onDone: (p: AdminPlace, version: number, r?: number) => void; toast: Toast }) {
  const init = props.init;
  const [id, setId] = useState("");
  const [name, setName] = useState(init?.name ?? "");
  const [album, setAlbum] = useState("weekend");
  const [ll, setLl] = useState(init ? `${init.lat.toFixed(5)}, ${init.lng.toFixed(5)}` : `${props.near.lat.toFixed(5)}, ${props.near.lng.toFixed(5)}`);
  const [r, setR] = useState(init?.r ?? 300);
  const [busy, setBusy] = useState(false);
  async function go() {
    const [lat, lng] = ll.split(",").map((x) => Number(x.trim()));
    setBusy(true);
    try {
      const res = await api<{ place: AdminPlace; version: number }>("POST", "/api/admin/places", { id: id.trim(), name, lat, lng, album });
      props.onDone(res.place, res.version, init ? Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(r))) : undefined);
    } catch (e) {
      props.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dlg" onClick={props.onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b style={{ fontSize: 16 }}>{init ? "명소로 올리기" : "명소 추가"}</b><div className="sp" /><button className="btn sm soft" onClick={props.onClose}><X /></button></div>
        <div className="form" style={{ gridTemplateColumns: "1fr" }}>
          <div><label className="l">id (영문 소문자, 앱·도장 파일 이름)</label><input value={id} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="예) palgong" /></div>
          <div><label className="l">이름</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 팔공산 갓바위" /></div>
          <div><label className="l">좌표 (위도, 경도) — 만든 뒤 지도에서 옮겨요</label><input value={ll} onChange={(e) => setLl(e.target.value)} /></div>
          {init ? <div><label className="l">도착 반경 (m, {RADIUS_MIN}~{RADIUS_MAX})</label><input type="number" min={RADIUS_MIN} max={RADIUS_MAX} step={10} value={r} onChange={(e) => setR(Number(e.target.value))} /></div> : null}
          <div><label className="l">도장북 묶음</label>
            <select value={album} onChange={(e) => setAlbum(e.target.value)}>{ALBUM_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.title}</option>)}</select></div>
        </div>
        {init ? <div className="hint">가족들이 많이 고른 바깥 장소 <b>{init.from}</b>에서 가져왔어요. id만 영문으로 정해 주세요.</div> : null}
        <div className="hint">처음엔 <b>추천에서 빠진 상태</b>로 만들어져요. 지도·시간·도장 그림을 채운 뒤 &lsquo;추천에 넣음&rsquo;으로 바꿔 저장하세요.</div>
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn ink" disabled={busy || !id || !name} onClick={go}><Plus />만들기</button>
        </div>
      </div>
    </div>
  );
}
