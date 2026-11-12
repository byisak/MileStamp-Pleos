"use client";

/*
 * 명소 '표' (시안 ③) — 전체 명소를 한 표로: 빈 칸 · 확인 필요 · AI 초안 · 90일 거르기 (계획서 §5.2).
 * 짧은 칸은 표에서 바로 고침(운영 시간 → 작은 편집 칸 · 주차 있음/요금 · 가격 무료/금액 · 밤 예/아니오) — 고치면 바로 저장하고 앱에 보냄.
 * 줄 고르기 → 아래 막대: '고른 곳 모두 확인'(고른 칸의 확인 필요 풀기) · 'AI 초안 모두 받아들이기' · '원문과 나란히 보기' · 'AI로 채우기'.
 * 휴대폰(≤760px)에선 줄이 카드로 (CSS).
 */
import { useMemo, useState } from "react";
import { BadgeCheck, Columns2, Sparkles } from "lucide-react";
import type { AdminPlace } from "@/lib/catalog-shape";
import {
  BEST_TEXT, CLOSED_RULES, daysLabel, hm, isStale, parseHoursRows, priceLevel, representativeHours, vocabTags,
  type HoursRow, type MetaField, type Parking, type VocabWord,
} from "@/lib/place-attrs-shape";
import { acceptPlaceDraft, draftText } from "@/lib/ai-fill-shape";
import type { Toast } from "./AdminApp";
import { FIELD_TEXT, HoursEditor } from "./PlaceAttrs";
import { bulkFill, BulkBar, Pop, Ring, SideBySide } from "./admin-kit";
import { placeState } from "./TodoPane";

type Filter = "all" | "empty" | "check" | "ai" | "stale" | "dirty";
const PK = { yes: "있음", limited: "좁음", no: "없음" } as const;
const FEE = { free: "무료", paid: "유료", partial: "일부 무료" } as const;

export function PlacesTable(props: {
  places: AdminPlace[];
  vocab: VocabWord[];
  today: string;
  dirty: (id: string) => boolean;
  onOpen: (id: string) => void;
  /** 한 곳 바로 저장 (표에서 고침·한꺼번에) — 저장한 명소 */
  onSave: (p: AdminPlace) => Promise<AdminPlace>;
  onReload: () => Promise<void>;
  filter?: { value: string; n: number } | null;
  aiReady: boolean | null;
  toast: Toast;
}) {
  const { today, toast } = props;
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [edit, setEdit] = useState<{ id: string; field: "hours" | "parking" | "price" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sbs, setSbs] = useState(false);
  const [confirmPick, setConfirmPick] = useState<MetaField[] | null>(null);
  // 할 일에서 걸러 왔으면 그 거르기로 (n이 바뀔 때마다 한 번)
  const [seen, setSeen] = useState<number | null>(null);
  if (props.filter && props.filter.n !== seen) {
    setSeen(props.filter.n);
    const f = props.filter.value;
    if (["all", "empty", "check", "ai", "stale", "dirty"].includes(f)) { setFilter(f as Filter); setSel([]); }
  }

  const rows = useMemo(() => props.places.map((p) => ({ p, ...placeState(p, props.vocab, today) })), [props.places, props.vocab, today]);
  const counts: Record<Filter, number> = {
    all: rows.length,
    empty: rows.filter((r) => r.comp.missing.length).length,
    check: rows.filter((r) => r.checks.length).length,
    ai: rows.filter((r) => r.drafts.length).length,
    stale: rows.filter((r) => r.stale.length).length,
    dirty: rows.filter((r) => props.dirty(r.p.id)).length,
  };
  const shown = rows.filter((r) => {
    if (q.trim() && !`${r.p.name} ${r.p.id} ${r.p.region ?? ""}`.includes(q.trim())) return false;
    if (filter === "empty") return r.comp.missing.length > 0;
    if (filter === "check") return r.checks.length > 0;
    if (filter === "ai") return r.drafts.length > 0;
    if (filter === "stale") return r.stale.length > 0;
    if (filter === "dirty") return props.dirty(r.p.id);
    return true;
  });
  const F: [Filter, string][] = [["all", "전체"], ["check", "확인 필요"], ["ai", "AI 초안"], ["empty", "빈 칸 있는 곳"], ["stale", "90일 지남"], ["dirty", "저장 안 함"]];
  const chosen = rows.filter((r) => sel.includes(r.p.id));
  const chosenChecks = [...new Set(chosen.flatMap((r) => r.checks))];
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allOn = shown.length > 0 && shown.every((r) => sel.includes(r.p.id));

  /** 한 곳 고쳐서 바로 저장 (그 칸 출처 = 관리자 · 오늘) */
  async function patch(p: AdminPlace, change: Partial<AdminPlace>, field: MetaField) {
    setBusy(p.id);
    try {
      await props.onSave({ ...p, ...change, meta: { ...p.meta, [field]: { src: "admin", conf: 1, at: today } } });
      toast(`${p.name} ${FIELD_TEXT[field]} 저장했어요`);
      setEdit(null);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  /** 고른 곳마다 차례로 저장 */
  async function each(label: string, f: (p: AdminPlace) => AdminPlace | null) {
    setBusy("bulk");
    let n = 0;
    try {
      for (const r of chosen) {
        const next = f(r.p);
        if (!next) continue;
        await props.onSave(next);
        n++;
      }
      toast(n ? `${n}곳 ${label} · 저장하고 앱에 보냈어요` : `${label}할 칸이 없었어요`);
    } catch (e) {
      toast(`${n}곳까지 저장 · ${(e as Error).message}`, true);
    } finally {
      setBusy(null);
    }
  }
  const confirmAll = (fields: MetaField[]) => each("확인", (p) => {
    const hit = fields.filter((f) => p.meta[f]?.check);
    if (!hit.length) return null;
    const meta = { ...p.meta };
    for (const f of hit) { const m = { ...meta[f]!, at: today }; delete m.check; meta[f] = m; }
    return { ...p, meta };
  });
  const acceptAll = () => each("AI 초안 받아들임", (p) => {
    const fs = Object.keys(p.aiDrafts).filter((k) => p.aiDrafts[k]);
    if (!fs.length) return null;
    return fs.reduce((x, f) => acceptPlaceDraft(x, f, today), p);
  });
  async function fill() {
    setBusy("fill");
    try {
      const r = await bulkFill("place", { ids: sel.length ? sel : undefined, onProgress: (t) => setBusy(`fill:${t}`) });
      await props.onReload();
      toast(r.stopped ?? (r.fields ? `${r.filled}곳에 AI 초안 ${r.fields}칸${r.mock ? " (모의)" : ""} · 보라 칸을 보고 받아들이세요` : "새로 채울 칸이 없었어요"), !!r.stopped);
      if (r.fields) setFilter("ai");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const ed = edit ? props.places.find((p) => p.id === edit.id) : null;
  return (
    <div className="card tblcard">
      <div className="chips tblhead">
        {F.map(([k, t]) => (
          <button key={k} className={`chip ${filter === k ? "on" : ""} ${k === "check" && counts.check ? "warnc" : ""} ${k === "ai" && counts.ai ? "aic" : ""}`} onClick={() => setFilter(k)}>{t} {counts[k]}</button>
        ))}
        <div className="sp" />
        <input className="fld" style={{ width: 180, padding: "5px 10px" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·지역 찾기" />
        <button className="btn sm ai" disabled={!!busy || !props.aiReady} onClick={fill} title={props.aiReady ? "고른 곳(없으면 전체)의 빈 칸·확인 필요를 AI 초안으로" : "서버에 AI 키가 없어요"}>
          <Sparkles />{busy?.startsWith("fill") ? busy.slice(5) || "읽는 중…" : sel.length ? `고른 ${sel.length}곳 AI로 채우기` : "빈 칸 AI로 채우기"}</button>
      </div>
      <div className="tblwrap">
        <table className="ptbl cards">
          <thead>
            <tr>
              <th className="ck"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? sel.filter((id) => !shown.some((r) => r.p.id === id)) : [...new Set([...sel, ...shown.map((r) => r.p.id)])])} /></th>
              <th>명소</th><th>운영 시간</th><th>쉬는 날</th><th>주차</th><th>가격</th><th>밤</th><th>태그</th><th>완성도</th><th>확인</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ p, comp, pct, checks, stale, drafts }) => {
              const rep = representativeHours(p.openHours);
              const d = (f: string) => p.aiDrafts[f];
              const cls = (f: MetaField) => `${p.meta[f]?.check ? "needs" : ""} ${isStale(p.meta[f], today) ? "stale" : ""} ${d(f) ? "ai" : ""}`;
              const aiLine = (f: string) => (d(f) ? <small className="ail">✨ {draftText("place", f, d(f)!.value)}</small> : null);
              const night = !!p.moments?.best.includes("night");
              return (
                <tr key={p.id} className={`${p.active ? "" : "off"} ${sel.includes(p.id) ? "sel" : ""}`}>
                  <td className="ck"><input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td className="nm" onClick={() => props.onOpen(p.id)} title="편집 열기">
                    <b>{p.name}</b>{props.dirty(p.id) ? <span className="dot" title="저장 안 함" /> : null}<small>{p.region ?? p.id}</small>
                  </td>
                  <td data-label="운영 시간" className={`ed ${cls("hours")}`} onClick={() => setEdit({ id: p.id, field: "hours" })}>
                    {p.openHours.length ? <>{rep ? `${hm(rep.open)}–${hm(rep.close)}` : ""}<small>{daysLabel([...new Set(p.openHours.flatMap((r) => r.days))])}{p.openHours.length > 1 ? ` · ${p.openHours.length}줄` : ""}{p.openHours.some((r) => r.lastEntryMin != null) ? " · 입장 마감" : ""}</small></> : <span className="empty">비었음</span>}
                    {aiLine("hours")}
                  </td>
                  <td data-label="쉬는 날" className={cls("closed")} onClick={() => props.onOpen(p.id)}>
                    {p.closedDays.length || p.closedRules.length
                      ? <>{p.closedDays.length ? daysLabel(p.closedDays) : ""}<small>{p.closedRules.map((r) => CLOSED_RULES[r]).join(" · ")}</small></>
                      : p.meta.closed ? "없음" : <span className="empty">—</span>}
                    {aiLine("closed")}
                  </td>
                  <td data-label="주차" className={`ed ${cls("parking")}`} onClick={() => setEdit({ id: p.id, field: "parking" })}>
                    {p.parking ? `${PK[p.parking.has]}${p.parking.fee ? ` · ${FEE[p.parking.fee]}` : ""}` : <span className="empty">—</span>}
                    {aiLine("parking")}
                  </td>
                  <td data-label="가격" className={`ed ${cls("price")}`} onClick={() => setEdit({ id: p.id, field: "price" })}>
                    {p.price ? (p.price.free ? "무료" : p.price.adult ? `${p.price.adult.toLocaleString()}원` : `단계 ${p.price.level}`) : <span className="empty">—</span>}
                    {aiLine("price")}
                  </td>
                  <td data-label="밤" className={`ed ${cls("moments")}`} onClick={(e) => {
                    e.stopPropagation();
                    const best = night ? (p.moments?.best ?? []).filter((b) => b !== "night") : [...(p.moments?.best ?? []), "night" as const];
                    void patch(p, { moments: { ...(p.moments ?? { best: [] }), best } }, "moments");
                  }} title="눌러서 밤에 좋음 켜기·끄기">
                    <span className={`yn ${night ? "on" : ""}`}>{busy === p.id ? "…" : night ? "✓ 밤" : "—"}</span>
                    {p.moments?.best.length ? <small>{p.moments.best.map((b) => BEST_TEXT[b]).join("·")}{p.moments.shows?.length ? " · 쇼" : ""}</small> : null}
                    {aiLine("moments")}
                  </td>
                  <td data-label="태그" className={cls("tags")}>{(() => { const n = vocabTags(p.tags, props.vocab).length; return n ? `${n}개` : <span className="empty">—</span>; })()}{aiLine("tags")}</td>
                  <td data-label="완성도"><span className="row" style={{ gap: 6 }}><Ring pct={pct} /><small style={{ margin: 0 }}>{comp.done}/{comp.total}</small></span></td>
                  <td data-label="확인">
                    {checks.length ? <span className="src check" title={checks.map((f) => FIELD_TEXT[f]).join(" · ")}>확인 {checks.length}</span> : null}
                    {drafts.length ? <span className="src ai" title={drafts.map((f) => FIELD_TEXT[f as MetaField] ?? f).join(" · ")}>AI {drafts.length}</span> : null}
                    {stale.length ? <span className="src stale" title={stale.map((f) => FIELD_TEXT[f]).join(" · ")}>오래됨 {stale.length}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length ? <div className="hint">맞는 명소가 없어요.</div> : null}
      </div>
      <BulkBar count={chosen.length} drafts={chosen.reduce((a, r) => a + r.drafts.length, 0)} checks={chosen.reduce((a, r) => a + r.checks.length, 0)} onClear={() => setSel([])}>
        <button className="btn sm line" onClick={() => setSbs(true)}><Columns2 size={14} />원문과 나란히 보기</button>
        <button className="btn sm ai" disabled={!!busy || !chosen.some((r) => r.drafts.length)} onClick={acceptAll}><Sparkles />AI 초안 모두 받아들이기</button>
        <button className="btn sm ink" disabled={!!busy || !chosenChecks.length} onClick={() => setConfirmPick(chosenChecks)}><BadgeCheck />고른 곳 모두 &lsquo;확인&rsquo;</button>
      </BulkBar>
      <div className="hint">
        노란 칸 = 확인 필요(관광공사·AI·조사에서 온 값), 보라 = AI 초안(✨, 아직 앱에 안 감), 빗금 = 90일 넘게 확인 안 함.
        <b> 운영 시간·주차·가격·밤</b> 칸은 눌러서 바로 고쳐요 — 고치면 바로 저장하고 앱에 보내요(그 명소의 저장 안 한 변경도 같이).
      </div>

      {ed && edit?.field === "hours" ? <HoursPop p={ed} busy={busy === ed.id} onClose={() => setEdit(null)} onSave={(rows) => patch(ed, { openHours: rows }, "hours")} /> : null}
      {ed && edit?.field === "parking" ? <ParkingPop value={ed.parking} name={ed.name} busy={busy === ed.id} onClose={() => setEdit(null)} onSave={(v) => patch(ed, { parking: v }, "parking")} /> : null}
      {ed && edit?.field === "price" ? (
        <PricePop p={ed} busy={busy === ed.id} onClose={() => setEdit(null)} onSave={(v) => patch(ed, { price: v }, "price")} />
      ) : null}
      {sbs ? <SideBySide kind="place" items={chosen.map((r) => ({ id: r.p.id, name: r.p.name, drafts: r.p.aiDrafts }))} onClose={() => setSbs(false)} /> : null}
      {confirmPick ? (
        <Pop title={`고른 ${chosen.length}곳 · 어느 칸을 확인할까요?`} onClose={() => setConfirmPick(null)} busy={busy === "bulk"} saveText="확인하고 앱에 보내기"
          onSave={async () => { await confirmAll(confirmPick); setConfirmPick(null); }} error={confirmPick.length ? null : "칸을 하나 이상 골라 주세요"}>
          <div className="chips">
            {chosenChecks.map((f) => (
              <button key={f} className={`chip ${confirmPick.includes(f) ? "on" : ""}`} onClick={() => setConfirmPick(confirmPick.includes(f) ? confirmPick.filter((x) => x !== f) : [...confirmPick, f])}>
                {FIELD_TEXT[f]} {chosen.filter((r) => r.checks.includes(f)).length}
              </button>
            ))}
          </div>
          <div className="hint">값은 그대로 두고 &lsquo;확인 필요&rsquo;만 풀어요 (출처는 그대로, 날짜는 오늘). 확인한 칸은 추천 조건으로 써요.</div>
        </Pop>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ 표 칸 고치기 (작은 칸)

export function HoursPop(props: { p: { name: string; openHours: HoursRow[] }; busy: boolean; lastOrder?: boolean; onClose: () => void; onSave: (rows: HoursRow[]) => void }) {
  const [rows, setRows] = useState(props.p.openHours.length ? props.p.openHours : [{ days: [0, 1, 2, 3, 4, 5, 6], holiday: false, openMin: 540, closeMin: 1080, lastEntryMin: null, breaks: [], validFrom: null, validTo: null, note: null }]);
  const r = parseHoursRows(rows);
  const err = "error" in r ? r.error : null;
  return (
    <Pop title={`${props.p.name} · 운영 시간`} wide onClose={props.onClose} busy={props.busy} onSave={() => "ok" in r && props.onSave(r.ok)}>
      <HoursEditor rows={rows} onChange={setRows} error={err} lastOrder={props.lastOrder} />
    </Pop>
  );
}

const HAS: [Parking["has"], string][] = [["yes", "있음"], ["limited", "좁음"], ["no", "없음"]];
export function ParkingPop(props: { value: Parking | null; name: string; busy: boolean; onClose: () => void; onSave: (v: Parking | null) => void }) {
  const [v, setV] = useState<Parking | null>(props.value);
  return (
    <Pop title={`${props.name} · 주차`} onClose={props.onClose} busy={props.busy} onSave={() => props.onSave(v)}>
      <div className="chips">
        {HAS.map(([k, t]) => <button key={k} className={`chip ${v?.has === k ? "on" : ""}`} onClick={() => setV({ ...(v ?? {}), has: k })}>{t}</button>)}
        <button className={`chip ${!v ? "on" : ""}`} onClick={() => setV(null)}>모름</button>
      </div>
      {v && v.has !== "no" ? (
        <div className="chips" style={{ marginTop: 8 }}>
          {(["free", "paid", "partial"] as const).map((k) => <button key={k} className={`chip ${v.fee === k ? "on" : ""}`} onClick={() => setV({ ...v, fee: v.fee === k ? null : k })}>{FEE[k]}</button>)}
        </div>
      ) : null}
      <div className="hint">종류·크기·걷는 분은 편집 화면 &lsquo;주차·가격&rsquo;에서.</div>
    </Pop>
  );
}

function PricePop(props: { p: AdminPlace; busy: boolean; onClose: () => void; onSave: (v: AdminPlace["price"]) => void }) {
  const [free, setFree] = useState(props.p.price?.free ?? false);
  const [adult, setAdult] = useState<string>(props.p.price?.adult != null ? String(props.p.price.adult) : "");
  const [known, setKnown] = useState(!!props.p.price);
  const save = () => {
    if (!known) return props.onSave(null);
    const base = { ...(props.p.price ?? {}), free, adult: free ? null : adult === "" ? null : Math.max(0, Math.round(Number(adult))) };
    if (free) base.child = null;
    props.onSave({ ...base, level: priceLevel(base) } as AdminPlace["price"]);
  };
  return (
    <Pop title={`${props.p.name} · 가격`} onClose={props.onClose} busy={props.busy} onSave={save}>
      <div className="chips">
        <button className={`chip ${known && free ? "on" : ""}`} onClick={() => { setKnown(true); setFree(true); }}>무료</button>
        <button className={`chip ${known && !free ? "on" : ""}`} onClick={() => { setKnown(true); setFree(false); }}>입장료 있음</button>
        <button className={`chip ${!known ? "on" : ""}`} onClick={() => setKnown(false)}>모름</button>
      </div>
      {known && !free ? (
        <div className="hgrid" style={{ marginTop: 8 }}><label>어른 (원)<input type="number" min={0} step={500} value={adult} onChange={(e) => setAdult(e.target.value)} autoFocus /></label></div>
      ) : null}
    </Pop>
  );
}
