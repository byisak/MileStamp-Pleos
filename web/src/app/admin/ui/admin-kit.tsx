"use client";

/*
 * 관리자 개편(11/3, 시안 proto/admin-tour/redesign.html) 공용 부품 —
 * 완성도 원 · 작게 접힌 지도(크게 펼쳐 도착 지점 고치기) · 섹션 바로가기(확인 필요 '!') · 접히는 섹션(휴대폰) ·
 * AI 초안 칸(✓ 맞아요 / 고치기 / 버리기) · 표 한꺼번에 막대 · 원문과 나란히 보기.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, CirclePlus, Maximize2, Minimize2, Radius, Sparkles, Trash2, X } from "lucide-react";
import { RADIUS_MAX, RADIUS_MIN, type ArrivalPoint } from "@/lib/catalog-shape";
import { AI_FIELD_TEXT, draftText, type AiKind, type AiSource } from "@/lib/ai-fill-shape";
import type { AiDrafts } from "@/lib/place-attrs-shape";
import { api, type Toast } from "./AdminApp";
import { PlaceMap, POINT_COLORS } from "./PlaceMap";

// ------------------------------------------------------------------ 완성도 원

export function Ring(props: { pct: number; size?: number; title?: string }) {
  const s = props.size ?? 22;
  return <span className="ring" title={props.title ?? `완성도 ${Math.round(props.pct)}%`} style={{ width: s, height: s, ["--p" as string]: `${Math.max(0, Math.min(100, props.pct))}%` }} />;
}

// ------------------------------------------------------------------ 지도 (작게 ↔ 크게)

/**
 * 도착 지점 지도: 처음엔 작게(170px, 휴대폰 130px) 보기만 — 누르면 크게(430px) 펼쳐 지점 옮기기·반경·추가·이름.
 * 작을 때 지도를 눌러도 지점이 옮겨지지 않게 위를 덮는다.
 */
export function MapBox(props: {
  points: ArrivalPoint[];
  fitKey: string;
  onChange: (points: ArrivalPoint[]) => void;
  toast: Toast;
  /** 크게일 때 막대 오른쪽에 더 놓을 단추 (축제 '명소 지점으로') */
  tools?: React.ReactNode;
  hint?: React.ReactNode;
  /** 지점 하나만 (식당) — 반경·추가·목록 없음 */
  single?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const pts = props.points;
  const ai = Math.min(active, pts.length - 1);
  const pt = pts[ai];
  const maxR = Math.max(...pts.map((p) => p.r));
  return (
    <div className={`mapbox ${open ? "open" : ""}`}>
      <div className="mapwrap">
        <PlaceMap points={pts} active={ai} fitKey={props.fitKey} height={open ? 430 : undefined}
          onChange={props.onChange} onActive={setActive} onMoved={(t) => props.toast(t)} />
        {!open ? (
          <button className="mapcover" onClick={() => setOpen(true)} aria-label="지도 크게">
            <span className="ov">
              {props.single ? <span>{props.label ?? "위치"}</span> : <><span>도착 지점 {pts.length}곳</span><span>반경 {maxR}m</span></>}
              <span className="go"><Maximize2 size={13} />크게 · {props.single ? "위치 고치기" : "도착 지점 고치기"}</span>
            </span>
          </button>
        ) : (
          <button className="btn sm line mapmin" onClick={() => setOpen(false)}><Minimize2 size={14} />작게</button>
        )}
      </div>
      {open && !props.single ? (
        <>
          <div className="maptools">
            <div className="range">
              <Radius />{ai + 1}번 반경
              <input type="range" min={RADIUS_MIN} max={RADIUS_MAX} step={10} value={pt.r}
                onChange={(e) => props.onChange(pts.map((p, i) => (i === ai ? { ...p, r: Number(e.target.value) } : p)))} />
              <b>{pt.r}m</b>
            </div>
            <button className="btn sm soft" disabled={pts.length >= 8} onClick={() => {
              const last = pts[pts.length - 1];
              props.onChange([...pts, { lat: Math.round((last.lat + 0.0015) * 1e6) / 1e6, lng: Math.round((last.lng + 0.0015) * 1e6) / 1e6, r: 200, name: `${pts.length + 1}번 주차장` }]);
              setActive(pts.length);
              props.toast("도착 지점을 하나 더 만들었어요 · 지도를 눌러 옮기세요");
            }}><CirclePlus />도착 지점 추가</button>
            {props.tools}
          </div>
          {props.hint ? <div className="hint">{props.hint}</div> : null}
          <div className="pts">
            {pts.map((p, i) => (
              <div key={i} className={`pt ${i === ai ? "on" : ""}`} onClick={() => setActive(i)}>
                <span className="dot" style={{ background: POINT_COLORS[i % POINT_COLORS.length] }} />
                <b>{i + 1}.</b>
                <input value={p.name} onChange={(e) => props.onChange(pts.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                <span className="c">{p.lat.toFixed(5)}, {p.lng.toFixed(5)} · 반경 {p.r}m</span>
                <div className="sp" />
                {pts.length > 1 ? (
                  <button className="btn sm soft" title="지우기" onClick={(e) => { e.stopPropagation(); props.onChange(pts.filter((_, k) => k !== i)); setActive(0); }}><Trash2 /></button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
      {open && props.single && props.hint ? <div className="hint">{props.hint}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ 섹션 · 바로가기

/** 섹션: 넓은 화면에선 늘 펼침, 휴대폰(≤760px)에선 머리를 눌러 접고 펼침 — 확인 필요·AI 초안이 있으면 처음부터 펼침. */
export function Sec(props: { id: string; icon?: React.ReactNode; title: string; needs?: boolean; ai?: boolean; children: React.ReactNode; head?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(!!(props.needs || props.ai));
  return (
    <section id={props.id} className={`sec acc ${open ? "open" : ""} ${props.className ?? ""}`}>
      <button type="button" className="acch" onClick={() => setOpen(!open)}>
        {props.icon}<b>{props.title}</b>
        {props.needs ? <span className="tag w">확인</span> : null}
        {props.ai ? <span className="tag ai">AI</span> : null}
        <span className="sp" />
        <ChevronDown className="chev" />
      </button>
      {props.head}
      <div className="accb">{props.children}</div>
    </section>
  );
}

/** 위에 붙어 따라오는 섹션 바로가기 — 확인 필요 칸이 있는 섹션은 '!'. 스크롤에 맞춰 지금 섹션을 칠한다. */
export function SecNav(props: { items: { id: string; label: string; warn?: boolean }[]; resetKey: string }) {
  const [on, setOn] = useState(props.items[0]?.id);
  const ids = props.items.map((i) => i.id).join(",");
  useEffect(() => {
    const els = ids.split(",").map((id) => document.getElementById(id)).filter((x): x is HTMLElement => !!x);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setOn(vis.target.id);
    }, { rootMargin: "-90px 0px -60% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [ids, props.resetKey]);
  return (
    <nav className="secnav">
      {props.items.map((i) => (
        <button key={i.id} type="button" className={on === i.id ? "on" : ""}
          onClick={() => { const el = document.getElementById(i.id); if (el) { el.classList.add("open"); el.scrollIntoView({ behavior: "smooth", block: "start" }); setOn(i.id); } }}>
          {i.label}{i.warn ? <b>!</b> : null}
        </button>
      ))}
    </nav>
  );
}

// ------------------------------------------------------------------ AI 초안 칸

/**
 * 오른쪽 'AI 초안' 카드 — 칸마다 값 · 원문 인용 · ✓ 맞아요(진짜 칸으로) / 고치기(칸으로 옮기고 그 섹션으로) / 버리기.
 * 아래 'AI로 채우기'(빈 칸·확인 필요) · 공식 안내 글 붙여 넣기. 받아들인 뒤 '저장하고 앱에 보내기'를 눌러야 앱에 간다.
 */
export function AiDraftsCard(props: {
  kind: AiKind;
  drafts: AiDrafts;
  onAccept: (field: string) => void;
  onFix: (field: string) => void;
  onDiscard: (field: string) => void;
  onFill: (text: string | null) => Promise<void>;
  ready: boolean | null;
  mock?: boolean;
  dropped?: { field: string; reason: string }[] | null;
}) {
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const entries = Object.entries(props.drafts).filter((e): e is [string, NonNullable<(typeof e)[1]>] => !!e[1]);
  async function fill() {
    setBusy(true);
    try { await props.onFill(paste?.trim() || null); setPaste(null); } finally { setBusy(false); }
  }
  return (
    <div className="card aidrafts">
      <h3><Sparkles />AI 초안 {entries.length ? <span className="tag ai">{entries.length}칸</span> : null}{props.mock ? <span className="tag">모의</span> : null}</h3>
      {!entries.length ? <div className="muted" style={{ fontSize: 12.5 }}>아직 초안이 없어요. 빈 칸·확인 필요 칸을 원문에서 읽어 채워 볼까요?</div> : null}
      {entries.map(([f, d]) => (
        <div key={f} className="aiitem">
          <b>{AI_FIELD_TEXT[f] ?? f}</b> {draftText(props.kind, f, d.value)}
          <div className="q">원문: &ldquo;{d.quote}&rdquo;</div>
          <div className="a">
            <button className="y" onClick={() => props.onAccept(f)}>✓ 맞아요</button>
            <button onClick={() => props.onFix(f)}>고치기</button>
            <button onClick={() => props.onDiscard(f)}>버리기</button>
          </div>
        </div>
      ))}
      {props.dropped?.length ? (
        <div className="hint" style={{ fontSize: 12 }}>못 채운 칸: {props.dropped.map((d) => `${AI_FIELD_TEXT[d.field] ?? (d.field === "*" ? "" : d.field)} ${d.reason}`).join(" · ")}</div>
      ) : null}
      {paste !== null ? (
        <textarea className="fld" rows={4} style={{ marginTop: 8 }} value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder="공식 누리집·안내판 글을 붙여 넣으면 그 글도 읽어요 (전화·메일은 지우고 보내요)" />
      ) : null}
      <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn sm ai" disabled={busy || !props.ready} onClick={fill} title={props.ready ? "" : "서버에 AI 키가 없어요 · '관광공사에서 채우기'를 써 주세요"}>
          <Sparkles />{busy ? "읽는 중…" : "AI로 채우기"}</button>
        {paste === null ? <button className="btn sm soft" onClick={() => setPaste("")}>안내 글 붙여 넣기</button> : null}
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>원문에 근거가 있는 칸만, 정해진 말로만 채워요. &lsquo;맞아요&rsquo; 뒤 저장해야 앱에 가요.</div>
    </div>
  );
}

// ------------------------------------------------------------------ 표: 한꺼번에 막대 · 원문과 나란히

export function BulkBar(props: { count: number; drafts: number; checks: number; children: React.ReactNode; onClear: () => void }) {
  if (!props.count) return null;
  return (
    <div className="bulk">
      <span><b>{props.count}곳</b> 고름 · AI 초안 {props.drafts}칸 · 확인 필요 {props.checks}칸</span>
      <button className="btn sm line" onClick={props.onClear} title="고르기 풀기"><X size={13} /></button>
      <div className="sp" />
      {props.children}
    </div>
  );
}

/** 고른 곳마다 원문(왼쪽)과 AI 초안·인용(오른쪽). 원문은 서버에서 다시 모은다 (관광공사 캐시 · 조사 원문 · 소개 · 카카오 분류). */
export function SideBySide(props: { kind: AiKind; items: { id: string; name: string; drafts: AiDrafts }[]; onClose: () => void }) {
  const [src, setSrc] = useState<Record<string, AiSource[] | string>>({});
  const items = props.items.slice(0, 8);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    for (const it of items) {
      api<{ sources: AiSource[] }>("GET", `/api/admin/ai-fill?kind=${props.kind}&id=${encodeURIComponent(it.id)}`)
        .then((r) => setSrc((s) => ({ ...s, [it.id]: r.sources })))
        .catch((e: Error) => setSrc((s) => ({ ...s, [it.id]: e.message })));
    }
  });
  return (
    <div className="dlg" onClick={props.onClose}>
      <div className="card sbs" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b style={{ fontSize: 16 }}>원문과 나란히 보기</b><span className="muted">{items.length}곳{props.items.length > items.length ? ` (처음 ${items.length}곳)` : ""}</span><div className="sp" /><button className="btn sm soft" onClick={props.onClose}><X /></button></div>
        <div className="sbsbody">
          {items.map((it) => {
            const s = src[it.id];
            const ds = Object.entries(it.drafts).filter((e) => !!e[1]);
            return (
              <div key={it.id} className="sbsrow">
                <div className="sbsl">
                  <b>{it.name}</b>
                  {s === undefined ? <div className="muted">원문 읽는 중…</div> : typeof s === "string" ? <div className="hint warn">{s}</div> : s.length ? s.map((x, i) => (
                    <div key={i} className="srcblk"><small>{x.label}</small><pre>{x.text}</pre></div>
                  )) : <div className="muted">원문이 없어요</div>}
                </div>
                <div className="sbsr">
                  {ds.length ? ds.map(([f, d]) => (
                    <div key={f} className="aiitem"><b>{AI_FIELD_TEXT[f] ?? f}</b> {draftText(props.kind, f, d!.value)}<div className="q">원문: &ldquo;{d!.quote}&rdquo;</div></div>
                  )) : <div className="muted">AI 초안이 없어요</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 작은 떠 있는 편집 칸 (표 칸 고치기). */
export function Pop(props: { title: string; onClose: () => void; onSave?: () => void; saveText?: string; busy?: boolean; error?: string | null; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="dlg" onClick={props.onClose}>
      <div className={`card pop ${props.wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="row"><b style={{ fontSize: 15 }}>{props.title}</b><div className="sp" /><button className="btn sm soft" onClick={props.onClose}><X /></button></div>
        <div style={{ marginTop: 10 }}>{props.children}</div>
        {props.error ? <div className="hint warn">{props.error}</div> : null}
        {props.onSave ? (
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn ink" disabled={props.busy || !!props.error} onClick={props.onSave}>{props.busy ? "저장 중…" : props.saveText ?? "저장하고 앱에 보내기"}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 한꺼번에 AI 채우기 (묶음 10곳씩, 남으면 이어서 · 못 채운 곳은 다시 안 부름). 진행 글은 onProgress로. */
export async function bulkFill(kind: AiKind, opts: { ids?: string[]; onProgress?: (t: string) => void }): Promise<{ filled: number; fields: number; errors: string[]; stopped: string | null; mock: boolean; results: { id: string; drafts?: AiDrafts }[] }> {
  const skip: string[] = [];
  let filled = 0, fields = 0, mock = false;
  const errors: string[] = [];
  const results: { id: string; drafts?: AiDrafts }[] = [];
  for (let round = 0; round < 60; round++) {
    const r = await api<{ done: { id: string; name: string; added?: string[]; drafts?: AiDrafts; error?: string }[]; remaining: number; stopped: string | null; mock: boolean }>(
      "POST", "/api/admin/ai-fill/bulk", { kind, ids: opts.ids, skip, limit: 10 });
    mock = r.mock;
    for (const d of r.done) {
      skip.push(d.id);
      results.push({ id: d.id, drafts: d.drafts });
      if (d.error) errors.push(`${d.name}: ${d.error}`);
      else if (d.added?.length) { filled++; fields += d.added.length; }
    }
    opts.onProgress?.(`${skip.length}곳 읽음 · ${filled}곳에 ${fields}칸 초안${r.remaining ? ` · 남은 ${r.remaining}곳` : ""}`);
    if (r.stopped) return { filled, fields, errors, stopped: r.stopped, mock, results };
    if (!r.remaining || !r.done.length) break;
  }
  return { filled, fields, errors, stopped: null, mock, results };
}
