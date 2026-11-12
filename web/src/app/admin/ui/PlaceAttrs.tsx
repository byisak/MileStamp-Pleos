"use client";

/*
 * 명소 편집 화면의 구조 칸 묶음 (docs/장소-데이터-구조-계획.md §5.1) — 운영 시간 편집기 · 쉬는 날 · 주차 · 시설·가격 · 시간 특성 ·
 * 어울림(아이 나이대·저녁) · 단어장 태그 · 출처 배지 · 완성도. 검사·모양은 lib/place-attrs-shape.ts (서버 저장 검사와 같은 함수).
 */
import { useState } from "react";
import { ArrowUp, BadgeCheck, CalendarRange, Car, Clock3, Coins, Moon, Plus, Sparkles, Tags, Trash2, Users, X } from "lucide-react";
import { COMPANION_TEXT, COMPANIONS } from "@/lib/planner";
import { hhmm, minOf, PLACE_FACILITIES, type AdminPlace } from "@/lib/catalog-shape";
import {
  BEST_TEXT, BEST_TIMES, CLOSED_RULES, CLOSED_RULE_KEYS, KID_AGE_BANDS, KID_AGE_TEXT, KIND_TEXT, LIGHT_ON_RE, PLACE_KINDS, SOURCE_TEXT,
  WEEKDAY_TEXT, isStale, priceLevel, regionNameOf,
  type FieldMeta, type HoursRow, type MetaField, type Moments, type Parking, type Price, type VocabWord,
} from "@/lib/place-attrs-shape";

export type Edit = (patch: Partial<AdminPlace>, field?: MetaField) => void;

const toggle = <T,>(xs: readonly T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
const sortDays = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** 시각 칸 값: 1440 이상(다음 날)은 하루 안 시각으로, 1440 자체는 23:59 (상시 개방 끝). */
const timeVal = (min: number) => hhmm(min === 1440 ? 1439 : min > 1440 ? min - 1440 : min);
/** 닫는·마지막 입장 시각 입력: 여는 시각과 같거나 앞이면 다음 날(+1440). '23:59'는 1440. */
const afterOpen = (open: number, v: string) => {
  const m = minOf(v);
  if (!Number.isFinite(m)) return NaN;
  return m === 1440 ? 1440 : m <= open ? m + 1440 : m;
};

// ------------------------------------------------------------------ 섹션 머리 + 출처 배지

export function SourceBadge(props: { meta?: FieldMeta; today: string; onConfirm?: () => void }) {
  const m = props.meta;
  if (!m) return <span className="src none">출처 없음</span>;
  const stale = isStale(m, props.today);
  return (
    <span className="srcwrap">
      <span className={`src ${m.src}`} title={`믿을 만한 정도 ${Math.round(m.conf * 100)}% · ${m.at}`}>{SOURCE_TEXT[m.src]} · {m.at.slice(5).replace("-", "/")}</span>
      {m.check ? <span className="src check">확인 필요</span> : null}
      {!m.check && stale ? <span className="src stale">다시 확인</span> : null}
      {(m.check || stale) && props.onConfirm ? (
        <button className="btn sm soft" onClick={props.onConfirm} title="값을 보고 맞으면 확인"><BadgeCheck />확인</button>
      ) : null}
    </span>
  );
}

export function SecHead(props: { icon: React.ReactNode; title: string; field?: MetaField; cur: AdminPlace; today: string; onConfirm?: (f: MetaField) => void; children?: React.ReactNode }) {
  const m = props.field ? props.cur.meta[props.field] : undefined;
  return (
    <div className={`sechead ${m?.check ? "needs" : ""}`}>
      {props.icon}<b>{props.title}</b>
      {props.field ? <SourceBadge meta={m} today={props.today} onConfirm={props.onConfirm ? () => props.onConfirm!(props.field!) : undefined} /> : null}
      <div className="sp" />
      {props.children}
    </div>
  );
}

// ------------------------------------------------------------------ ① 운영 시간 편집기

const emptyRow = (days: number[], from?: HoursRow): HoursRow => ({
  days, holiday: false, openMin: from?.openMin ?? 540, closeMin: from?.closeMin ?? 1080, lastEntryMin: from?.lastEntryMin ?? null,
  breaks: [], validFrom: null, validTo: null, note: null,
});

export function HoursEditor(props: { rows: HoursRow[]; onChange: (rows: HoursRow[]) => void; error: string | null; lastOrder?: boolean }) {
  const { rows, onChange } = props;
  const set = (i: number, patch: Partial<HoursRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const first = rows[0];
  return (
    <div className="hours">
      <div className="chips" style={{ marginBottom: 8 }}>
        <button className="chip" onClick={() => onChange([{ ...emptyRow([0, 1, 2, 3, 4, 5, 6], first), holiday: false }])}>매일 같게</button>
        <button className="chip" onClick={() => onChange([emptyRow([1, 2, 3, 4, 5], first), { ...emptyRow([0, 6], first), holiday: true }])}>평일·주말 다르게</button>
        <button className="chip" onClick={() => onChange([...rows, { ...emptyRow([5, 6], first), validFrom: "07-01", validTo: "08-31", note: "여름 야간 개장", closeMin: 1320 }])}>
          <CalendarRange size={13} />계절 줄 더하기</button>
        <button className="chip" onClick={() => onChange([...rows, emptyRow([], first)])}><Plus size={13} />줄 추가</button>
      </div>
      {!rows.length ? <div className="hint">줄이 없으면 예전 하루 시각 하나로 계산해요. &lsquo;매일 같게&rsquo;로 시작하세요.</div> : null}
      {rows.map((r, i) => {
        const next = r.closeMin > 1440;
        return (
          <div key={i} className={`hline ${r.validFrom ? "season" : ""}`}>
            <div className="chips">
              <span className="no">{i + 1}</span>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} className={`chip day ${r.days.includes(d) ? "on" : ""} ${d === 0 || d === 6 ? "we" : ""}`} onClick={() => set(i, { days: sortDays(toggle(r.days, d)) })}>{WEEKDAY_TEXT[d]}</button>
              ))}
              <button className={`chip day ${r.holiday ? "on" : ""}`} onClick={() => set(i, { holiday: !r.holiday })}>공휴일</button>
              <div className="sp" />
              {i > 0 ? <button className="btn sm soft" title="위로 (위 줄이 먼저)" onClick={() => onChange([...rows.slice(0, i - 1), r, rows[i - 1], ...rows.slice(i + 1)])}><ArrowUp /></button> : null}
              <button className="btn sm soft" title="줄 지우기" onClick={() => onChange(rows.filter((_, k) => k !== i))}><Trash2 /></button>
            </div>
            <div className="hgrid">
              <label>여는<input type="time" value={timeVal(r.openMin)} onChange={(e) => { const m = minOf(e.target.value); if (Number.isFinite(m) && m < 1440) set(i, { openMin: m }); }} /></label>
              <label>닫는{next ? <em>다음 날</em> : null}<input type="time" value={timeVal(r.closeMin)} onChange={(e) => { const m = afterOpen(r.openMin, e.target.value); if (Number.isFinite(m)) set(i, { closeMin: m }); }} /></label>
              {props.lastOrder ? (
                <label>마지막 주문
                  <span className="row" style={{ gap: 4 }}>
                    <input type="time" value={r.lastOrderMin == null ? "" : timeVal(r.lastOrderMin)}
                      onChange={(e) => set(i, { lastOrderMin: e.target.value ? afterOpen(r.openMin, e.target.value) : null })} />
                    {r.lastOrderMin != null ? <button className="btn sm soft" title="비우기" onClick={() => set(i, { lastOrderMin: null })}><X /></button> : null}
                  </span></label>
              ) : (
                <label>마지막 입장
                  <span className="row" style={{ gap: 4 }}>
                    <input type="time" value={r.lastEntryMin == null ? "" : timeVal(r.lastEntryMin)}
                      onChange={(e) => set(i, { lastEntryMin: e.target.value ? afterOpen(r.openMin, e.target.value) : null })} />
                    {r.lastEntryMin != null ? <button className="btn sm soft" title="비우기" onClick={() => set(i, { lastEntryMin: null })}><X /></button> : null}
                  </span></label>
              )}
              <label>기간 (해마다)
                <span className="row" style={{ gap: 4 }}>
                  <input placeholder="MM-DD" value={r.validFrom ?? ""} onChange={(e) => set(i, { validFrom: e.target.value || null })} style={{ width: 72 }} />~
                  <input placeholder="MM-DD" value={r.validTo ?? ""} onChange={(e) => set(i, { validTo: e.target.value || null })} style={{ width: 72 }} />
                </span></label>
              <label className="wide">메모<input value={r.note ?? ""} placeholder="예) 여름 야간 개장" onChange={(e) => set(i, { note: e.target.value || null })} /></label>
            </div>
            <div className="chips" style={{ marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>쉬는 시간(브레이크)</span>
              {r.breaks.map((b, k) => (
                <span key={k} className="chip date">
                  <input type="time" className="tiny" value={timeVal(b.fromMin)} onChange={(e) => { const m = afterOpen(r.openMin - 1, e.target.value); if (Number.isFinite(m)) set(i, { breaks: r.breaks.map((x, j) => (j === k ? { ...x, fromMin: m } : x)) }); }} />~
                  <input type="time" className="tiny" value={timeVal(b.toMin)} onChange={(e) => { const m = afterOpen(b.fromMin, e.target.value); if (Number.isFinite(m)) set(i, { breaks: r.breaks.map((x, j) => (j === k ? { ...x, toMin: m } : x)) }); }} />
                  <X size={12} style={{ cursor: "pointer" }} onClick={() => set(i, { breaks: r.breaks.filter((_, j) => j !== k) })} />
                </span>
              ))}
              {r.breaks.length < 4 ? <button className="chip" onClick={() => set(i, { breaks: [...r.breaks, { fromMin: Math.min(900, r.closeMin - 60), toMin: Math.min(1020, r.closeMin - 1) }] })}><Plus size={12} />더하기</button> : null}
            </div>
          </div>
        );
      })}
      {props.error ? <div className="hint warn">{props.error}</div> : null}
      <div className="hint">위 줄이 먼저예요. 그날 <b>공휴일 줄 → 요일 줄</b> 순서로 고르고, <b>기간 있는 줄</b>은 그 기간엔 기간 없는 줄보다 먼저 써요 (여름 야간 줄엔 그날 전체 시각을 적어요). 맞는 줄이 없는 요일은 <b>쉬는 날</b>로 봐요. 자정을 넘기면 닫는 시각에 &lsquo;다음 날&rsquo;이 붙어요.</div>
    </div>
  );
}

// ------------------------------------------------------------------ ② 쉬는 날

export function ClosedBlock(props: { cur: AdminPlace; edit: Edit }) {
  const { cur, edit } = props;
  return (
    <>
      <div className="chips">
        <span className="muted" style={{ fontSize: 12 }}>매주</span>
        {[1, 2, 3, 4, 5, 6, 0].map((i) => (
          <button key={i} className={`chip ${cur.closedDays.includes(i) ? "on" : ""}`} onClick={() => edit({ closedDays: sortDays(toggle(cur.closedDays, i)) }, "closed")}>{WEEKDAY_TEXT[i]}</button>
        ))}
      </div>
      <div className="chips" style={{ marginTop: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>규칙</span>
        {CLOSED_RULE_KEYS.map((k) => (
          <button key={k} className={`chip ${cur.closedRules.includes(k) ? "on" : ""}`} onClick={() => edit({ closedRules: toggle(cur.closedRules, k).sort() }, "closed")}>{CLOSED_RULES[k]}</button>
        ))}
      </div>
      <div className="chips" style={{ marginTop: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>임시 휴무</span>
        {cur.tempClosed.map((d) => (
          <button key={d} className="chip date" title="빼기" onClick={() => edit({ tempClosed: cur.tempClosed.filter((x) => x !== d) })}>{d.slice(5).replace("-", "/")}<X size={12} /></button>
        ))}
        <input type="date" className="fld" style={{ width: 150, padding: "4px 8px" }} value=""
          onChange={(e) => { const v = e.target.value; if (v && !cur.tempClosed.includes(v)) edit({ tempClosed: [...cur.tempClosed, v].sort() }); }} />
      </div>
      {cur.closed ? <div className="hint">조사 원문: {cur.closed}</div> : null}
    </>
  );
}

// ------------------------------------------------------------------ ③ 주차

const PK_HAS: [Parking["has"], string][] = [["yes", "있음"], ["limited", "좁음"], ["no", "없음"]];
const PK_KIND: [NonNullable<Parking["kind"]>, string][] = [["own", "자체"], ["public", "공영"], ["street", "길가"]];
const PK_FEE: [NonNullable<Parking["fee"]>, string][] = [["free", "무료"], ["paid", "유료"], ["partial", "일부 무료"]];

export function ParkingBlock(props: { value: Parking | null; onChange: (v: Parking | null) => void }) {
  const v = props.value;
  const set = (patch: Partial<Parking>) => props.onChange({ ...(v ?? { has: "yes" }), ...patch });
  const pick = <K extends keyof Parking>(k: K, x: Parking[K]) => set({ [k]: v?.[k] === x ? null : x } as Partial<Parking>);
  return (
    <div className="blk">
      <div className="chips">
        {PK_HAS.map(([k, t]) => <button key={k} className={`chip ${v?.has === k ? "on" : ""}`} onClick={() => set({ has: k })}>{t}</button>)}
        <button className={`chip ${!v ? "on" : ""}`} onClick={() => props.onChange(null)}>모름</button>
      </div>
      {v && v.has !== "no" ? (
        <>
          <div className="chips" style={{ marginTop: 6 }}>
            {PK_KIND.map(([k, t]) => <button key={k} className={`chip ${v.kind === k ? "on" : ""}`} onClick={() => pick("kind", k)}>{t}</button>)}
            <span className="muted">·</span>
            {PK_FEE.map(([k, t]) => <button key={k} className={`chip ${v.fee === k ? "on" : ""}`} onClick={() => pick("fee", k)}>{t}</button>)}
            <span className="muted">·</span>
            {(["S", "M", "L"] as const).map((k) => <button key={k} className={`chip ${v.size === k ? "on" : ""}`} onClick={() => pick("size", k)}>{({ S: "작음", M: "보통", L: "넓음" })[k]}</button>)}
            <span className="muted">·</span>
            <button className={`chip ${v.weekend_full ? "on" : ""}`} onClick={() => set({ weekend_full: !v.weekend_full })}>주말 꽉 참</button>
            <button className={`chip ${v.ev ? "on" : ""}`} onClick={() => set({ ev: !v.ev })}>전기차 충전</button>
          </div>
          <div className="hgrid" style={{ marginTop: 6 }}>
            <label>요금 메모<input value={v.fee_note ?? ""} placeholder="1시간 1,000원" onChange={(e) => set({ fee_note: e.target.value || null })} /></label>
            <label>주차장에서 걷는 분<input type="number" min={0} max={60} value={v.walk_min ?? ""} onChange={(e) => set({ walk_min: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} /></label>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ ⑤ 가격

export function PriceBlock(props: { value: Price | null; onChange: (v: Price | null) => void }) {
  const v = props.value;
  const set = (patch: Partial<Price>) => {
    const n = { ...(v ?? { free: false, level: 1 as const }), ...patch } as Price;
    props.onChange({ ...n, level: priceLevel(n) });
  };
  const amount = (x: string) => (x === "" ? null : Math.max(0, Math.round(Number(x))));
  return (
    <div className="blk">
      <div className="chips">
        <button className={`chip ${v?.free ? "on" : ""}`} onClick={() => set({ free: true, adult: null, child: null })}>무료</button>
        <button className={`chip ${v && !v.free ? "on" : ""}`} onClick={() => set({ free: false })}>입장료 있음</button>
        <button className={`chip ${!v ? "on" : ""}`} onClick={() => props.onChange(null)}>모름</button>
        {v ? <span className="muted" style={{ fontSize: 12 }}>단계 {v.level} · {["무료", "가족 1만 원 안쪽", "3만 원 안쪽", "3만 원 넘음"][v.level]}</span> : null}
      </div>
      {v ? (
        <div className="hgrid" style={{ marginTop: 6 }}>
          {!v.free ? <label>어른 (원)<input type="number" min={0} step={500} value={v.adult ?? ""} onChange={(e) => set({ adult: amount(e.target.value) })} /></label> : null}
          {!v.free ? <label>아이 (원)<input type="number" min={0} step={500} value={v.child ?? ""} onChange={(e) => set({ child: amount(e.target.value) })} /></label> : null}
          <label>몇 살 아래 무료<input type="number" min={1} max={19} value={v.child_free_under ?? ""} onChange={(e) => set({ child_free_under: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} /></label>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ ⑧ 시간 특성

export function MomentsBlock(props: { value: Moments | null; onChange: (v: Moments | null) => void; error: string | null }) {
  const v: Moments = props.value ?? { best: [] };
  const set = (patch: Partial<Moments>) => props.onChange({ ...v, ...patch });
  const light = v.light ?? null;
  const sunsetMode = !light || light.on.startsWith("sunset");
  const sunsetN = light && light.on.startsWith("sunset") ? Number(light.on.slice(6) || 0) : 15;
  const shows = v.shows ?? [];
  const season = v.season ?? [];
  const setShow = (i: number, patch: Partial<NonNullable<Moments["shows"]>[number]>) => set({ shows: shows.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <div className="blk">
      <div className="chips">
        <span className="muted" style={{ fontSize: 12 }}>언제 좋아요?</span>
        {BEST_TIMES.map((b) => (
          <button key={b} className={`chip ${v.best.includes(b) ? "on" : ""}`} onClick={() => set({ best: BEST_TIMES.filter((x) => (x === b ? !v.best.includes(b) : v.best.includes(x))) })}>{BEST_TEXT[b]}</button>
        ))}
      </div>
      <div className="chips" style={{ marginTop: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>조명</span>
        <button className={`chip ${light ? "on" : ""}`} onClick={() => set({ light: light ? null : { on: "sunset+15", off: null } })}>{light ? "켜짐" : "없음"}</button>
        {light ? (
          <>
            <button className={`chip ${sunsetMode ? "on" : ""}`} onClick={() => set({ light: { ...light, on: `sunset+${sunsetN}` } })}>해 지고</button>
            {sunsetMode ? (
              <input type="number" className="fld" style={{ width: 70, padding: "4px 8px" }} value={sunsetN}
                onChange={(e) => { const n = Math.round(Number(e.target.value)); set({ light: { ...light, on: n >= 0 ? `sunset+${n}` : `sunset${n}` } }); }} />
            ) : null}
            {sunsetMode ? <span className="muted" style={{ fontSize: 12 }}>분 뒤</span> : null}
            <button className={`chip ${!sunsetMode ? "on" : ""}`} onClick={() => set({ light: { ...light, on: "18:30" } })}>정해진 시각</button>
            {!sunsetMode ? <input type="time" className="fld" style={{ width: 110, padding: "4px 8px" }} value={light.on} onChange={(e) => set({ light: { ...light, on: e.target.value } })} /> : null}
            <span className="muted" style={{ fontSize: 12 }}>꺼짐</span>
            <input type="time" className="fld" style={{ width: 110, padding: "4px 8px" }} value={light.off ?? ""} onChange={(e) => set({ light: { ...light, off: e.target.value || null } })} />
            {!LIGHT_ON_RE.test(light.on) ? <span className="src check">모양 확인</span> : null}
          </>
        ) : null}
      </div>
      <div style={{ marginTop: 8 }}>
        <div className="chips"><span className="muted" style={{ fontSize: 12 }}>쇼 시간표</span>
          <button className="chip" onClick={() => set({ shows: [...shows, { name: "음악분수", times: ["19:00", "20:00"], days: [5, 6, 0] }] })}><Plus size={12} />쇼 더하기</button></div>
        {shows.map((s, i) => (
          <div key={i} className="hline">
            <div className="hgrid">
              <label>이름<input value={s.name} onChange={(e) => setShow(i, { name: e.target.value })} /></label>
              <label className="wide">시각 (쉼표로)<input value={s.times.join(", ")} onChange={(e) => setShow(i, { times: e.target.value.split(/[,\s]+/).filter(Boolean) })} /></label>
            </div>
            <div className="chips" style={{ marginTop: 6 }}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} className={`chip day ${(s.days ?? []).includes(d) ? "on" : ""}`} onClick={() => setShow(i, { days: sortDays(toggle(s.days ?? [], d)) })}>{WEEKDAY_TEXT[d]}</button>)}
              <span className="muted">·</span>
              <MonthChips value={s.months ?? []} onChange={(m) => setShow(i, { months: m })} />
              <div className="sp" />
              <button className="btn sm soft" onClick={() => set({ shows: shows.filter((_, k) => k !== i) })}><Trash2 /></button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <div className="chips"><span className="muted" style={{ fontSize: 12 }}>계절 볼거리</span>
          <button className="chip" onClick={() => set({ season: [...season, { what: "단풍", months: [10, 11] }] })}><Plus size={12} />더하기</button></div>
        {season.map((s, i) => (
          <div key={i} className="chips" style={{ marginTop: 6 }}>
            <input className="fld" style={{ width: 110, padding: "4px 8px" }} value={s.what} onChange={(e) => set({ season: season.map((x, k) => (k === i ? { ...x, what: e.target.value } : x)) })} />
            <MonthChips value={s.months} onChange={(m) => set({ season: season.map((x, k) => (k === i ? { ...x, months: m } : x)) })} />
            <button className="btn sm soft" onClick={() => set({ season: season.filter((_, k) => k !== i) })}><Trash2 /></button>
          </div>
        ))}
      </div>
      {props.error ? <div className="hint warn">{props.error}</div> : null}
    </div>
  );
}

function MonthChips(props: { value: number[]; onChange: (m: number[]) => void }) {
  return (
    <span className="months">
      {Array.from({ length: 12 }, (_, k) => k + 1).map((m) => (
        <button key={m} className={`chip m ${props.value.includes(m) ? "on" : ""}`} onClick={() => props.onChange(toggle(props.value, m).sort((a, b) => a - b))}>{m}</button>
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ ⑥ 어울림 확장 · ⑦ 단어장 태그 · ④ 시설 · 종류·지역

function Slider(props: { label: string; value: number; auto: boolean; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ minWidth: 64 }}>{props.label}</span>
      <input type="range" min={0} max={1} step={0.05} value={props.value} onChange={(e) => props.onChange(Math.round(Number(e.target.value) * 100) / 100)} style={{ flex: 1 }} />
      <span className="muted" style={{ minWidth: 44, textAlign: "right" }}>{props.auto ? "자동" : props.value.toFixed(2)}</span>
    </label>
  );
}

export function FitExtraBlock(props: { cur: AdminPlace; edit: Edit }) {
  const { cur, edit } = props;
  const ka = cur.fitExtra.kid_age ?? {};
  const ev = cur.fitExtra.evening ?? {};
  const night = cur.moments?.best.includes("night") ?? false;
  return (
    <>
      <div className="full"><label className="l">아이 나이대 (비우면 아이 적합도 {cur.kidFit.toFixed(2)})</label>
        <div className="sliders">
          {KID_AGE_BANDS.map((b) => (
            <Slider key={b} label={KID_AGE_TEXT[b]} value={ka[b] ?? cur.kidFit} auto={ka[b] == null}
              onChange={(x) => edit({ fitExtra: { ...cur.fitExtra, kid_age: { ...ka, [b]: x } } }, "fit")} />
          ))}
        </div></div>
      <div className="full"><label className="l">해 진 뒤 어울림 (비우면 낮 값{night ? "" : " × 0.6 — 밤에 좋은 곳이 아니에요"})</label>
        <div className="sliders">
          {COMPANIONS.map((c) => {
            const day = c === "kids" ? cur.kidFit : cur.fit[c];
            return (
              <Slider key={c} label={COMPANION_TEXT[c]} value={ev[c] ?? Math.round(day * (night ? 1 : 0.6) * 100) / 100} auto={ev[c] == null}
                onChange={(x) => edit({ fitExtra: { ...cur.fitExtra, evening: { ...ev, [c]: x } } }, "fit")} />
            );
          })}
        </div></div>
    </>
  );
}

export function VocabTags(props: { cur: AdminPlace; edit: Edit; vocab: VocabWord[]; onAdd: (tag: string, category: string) => Promise<void> }) {
  const { cur, edit, vocab } = props;
  const [word, setWord] = useState("");
  // 식당 묶음은 식당 화면에서만
  const cats = [...new Set(vocab.map((v) => v.category))].filter((c) => c !== "식당");
  const [cat, setCat] = useState(cats[0] ?? "경치");
  const words = new Set(vocab.map((v) => v.tag));
  const free = cur.tags.filter((t) => !words.has(t));
  const toggleTag = (t: string) => edit({ tags: cur.tags.includes(t) ? cur.tags.filter((x) => x !== t) : [...cur.tags, t] }, "tags");
  return (
    <>
      {cats.map((c) => (
        <div key={c} className="chips" style={{ marginTop: 4 }}>
          <span className="cat">{c}</span>
          {vocab.filter((v) => v.category === c).map((v) => (
            <button key={v.tag} className={`chip ${cur.tags.includes(v.tag) ? "on" : ""}`} onClick={() => toggleTag(v.tag)}>{v.tag}</button>
          ))}
        </div>
      ))}
      <div className="chips" style={{ marginTop: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>단어장에 더하기</span>
        <input className="fld" style={{ width: 120, padding: "4px 8px" }} value={word} placeholder="새 말" onChange={(e) => setWord(e.target.value)} />
        <select className="fld" style={{ width: 100, padding: "4px 8px" }} value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <button className="btn sm soft" disabled={!word.trim()} onClick={async () => { await props.onAdd(word.trim(), cat); setWord(""); }}><Plus />더하기</button>
      </div>
      {free.length ? (
        <div className="chips" style={{ marginTop: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>예전 자유 태그 (표시만 · 추천엔 안 씀)</span>
          {free.map((t) => <button key={t} className="chip old" title="빼기" onClick={() => edit({ tags: cur.tags.filter((x) => x !== t) }, "tags")}>{t}<X size={11} /></button>)}
        </div>
      ) : null}
    </>
  );
}

export function FacilityChips(props: { cur: AdminPlace; edit: Edit }) {
  const { cur, edit } = props;
  return (
    <div className="chips">
      {PLACE_FACILITIES.map((f) => (
        <button key={f} className={`chip ${cur.facilities.includes(f) ? "on" : ""}`} onClick={() => edit({ facilities: toggle(cur.facilities, f) }, "facilities")}>{f}</button>
      ))}
      {cur.facilities.filter((f) => !PLACE_FACILITIES.includes(f)).map((f) => <span key={f} className="chip old" title="주차·가격 칸에서 저절로 맞춰요">{f}</span>)}
    </div>
  );
}

export function KindRegion(props: { cur: AdminPlace; edit: Edit; suggested: string | null }) {
  const { cur, edit } = props;
  const route = cur.route ?? { points: [], pass_min: 20 };
  return (
    <>
      <div><label className="l">종류</label>
        <select value={cur.kind} onChange={(e) => edit({ kind: e.target.value as AdminPlace["kind"] }, "kind")}>
          {PLACE_KINDS.map((k) => <option key={k} value={k}>{KIND_TEXT[k]}</option>)}
        </select></div>
      <div><label className="l">지역 코드 (법정동 시군구 5자리){cur.regionCode ? ` · ${regionNameOf(cur.regionCode) ?? "목록 밖"}` : ""}</label>
        <div className="row" style={{ gap: 6 }}>
          <input value={cur.regionCode ?? ""} placeholder="27230" onChange={(e) => edit({ regionCode: e.target.value.trim() || null }, "region")} />
          {props.suggested && props.suggested !== cur.regionCode ? <button className="btn sm soft" onClick={() => edit({ regionCode: props.suggested }, "region")}>{props.suggested}</button> : null}
        </div></div>
      {cur.kind === "drive" ? (
        <div className="full"><label className="l">드라이브 길 — 지나갈 점 (한 줄에 &lsquo;위도, 경도, 이름&rsquo;) · 지나가는 분</label>
          <div className="row" style={{ gap: 8, alignItems: "start" }}>
            <textarea rows={3} style={{ flex: 1 }} value={route.points.map((p) => `${p.lat}, ${p.lng}${p.name ? `, ${p.name}` : ""}`).join("\n")}
              onChange={(e) => edit({ route: { ...route, points: e.target.value.split("\n").map((l) => l.split(",").map((x) => x.trim())).filter((a) => a.length >= 2).map(([la, ln, nm]) => ({ lat: Number(la), lng: Number(ln), ...(nm ? { name: nm } : {}) })) } }, "kind")} />
            <input type="number" min={5} max={240} style={{ width: 90 }} value={route.pass_min} onChange={(e) => edit({ route: { ...route, pass_min: Math.round(Number(e.target.value)) } }, "kind")} />
          </div></div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ 오른쪽: 완성도 · 출처

export function Completeness(props: { done: number; total: number; missing: string[]; checks: string[]; stale: string[] }) {
  const pct = Math.round((props.done / props.total) * 100);
  return (
    <div className="card comp">
      <h3><Sparkles />완성도</h3>
      <div className="meter"><i style={{ width: `${pct}%` }} /></div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}><b>{props.done} / {props.total}칸</b><span className="muted">{pct}%</span></div>
      {props.missing.length ? <div className="hint">빈 칸: {props.missing.join(" · ")}</div> : <div className="hint">필수 칸을 다 채웠어요.</div>}
      {props.checks.length ? <div className="hint needs">확인 필요: <b>{props.checks.join(" · ")}</b></div> : null}
      {props.stale.length ? <div className="hint needs">90일 지남: {props.stale.join(" · ")}</div> : null}
    </div>
  );
}

export const FIELD_TEXT: Record<MetaField, string> = {
  hours: "운영 시간", closed: "쉬는 날", parking: "주차", price: "가격", facilities: "시설", moments: "시간 특성", fit: "어울림", tags: "태그", kind: "종류", region: "지역",
};

export const SECTION_ICONS = { hours: <Clock3 />, parking: <Car />, price: <Coins />, moments: <Moon />, fit: <Users />, tags: <Tags /> };
