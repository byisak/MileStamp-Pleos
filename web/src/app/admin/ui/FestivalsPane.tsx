"use client";

import { CompanionFit } from "./CompanionFit";
import { COMPANION_TAG_CHOICES } from "@/lib/planner";
import { useMemo, useRef, useState } from "react";
import {
  CalendarRange, CircleAlert, Download, Flag, ImagePlus, LoaderCircle, MapPin, PartyPopper, Plus, Smartphone,
  Stamp, Trash2, UploadCloud, X,
} from "lucide-react";
import { WEEKDAYS, hhmm, minOf, type AdminPlace, type ArrivalPoint } from "@/lib/catalog-shape";
import {
  FESTIVAL_INK, STATUS_LABEL, WEIGHT_NORMAL, WEIGHT_STRONG, addDays, festivalStatus, kstToday, periodText, seasonLabel,
  type AdminFestival, type FestivalStatus, type TourFestival,
} from "@/lib/festival-shape";
import { api, stampSrc, type Toast } from "./AdminApp";
import { MapBox } from "./admin-kit";
import { toWebp } from "./stampcraft";
import { AiStampCard } from "./AiStampCard";

const ORDER: FestivalStatus[] = ["running", "upcoming", "ended"];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 비교용 (저장 안 한 변경 표시). */
const sig = (f: AdminFestival) => JSON.stringify([f.name, f.summary, f.placeId, f.points, f.starts, f.ends, f.open, f.close, f.closedDays,
  f.dwell, f.indoor, f.kidFit, f.fit, f.tags, f.weight, f.crowdNote, f.season, f.poster.url, f.active]);

const body = (f: AdminFestival) => ({
  name: f.name, summary: f.summary, placeId: f.placeId, points: f.points, starts: f.starts, ends: f.ends, open: f.open, close: f.close,
  closedDays: f.closedDays, dwell: f.dwell, indoor: f.indoor, kidFit: f.kidFit, fit: f.fit, tags: f.tags, weight: f.weight, crowdNote: f.crowdNote,
  season: f.season, posterUrl: f.poster.url, source: f.source, active: f.active,
});

/** 한정 도장 그림: 올린 것, 없으면 붙은 명소 도장(붉은 테로 미리보기만). */
export function festivalStampSrc(f: AdminFestival, places: AdminPlace[]): string | null {
  if (f.stamp.url) return f.stamp.url;
  const p = places.find((x) => x.id === f.placeId);
  return p ? stampSrc(p) : null;
}

export function FestivalsPane(props: {
  festivals: AdminFestival[];
  places: AdminPlace[];
  version: number;
  tourReady: boolean;
  storeReady: boolean | null;
  onSaved: (f: AdminFestival, version: number) => void;
  onDeleted: (id: string, version: number) => void;
  onMakeStamp: (id: string) => void;
  toast: Toast;
}) {
  const { festivals, places, toast } = props;
  const today = kstToday();
  const [q, setQ] = useState("");
  const [curId, setCurId] = useState<string | undefined>(() => festivals.find((f) => festivalStatus(f, today) === "running")?.id ?? festivals[0]?.id);
  const [drafts, setDrafts] = useState<Record<string, AdminFestival>>({});
  const [, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState<Partial<AdminFestival> | null>(null);
  const [touring, setTouring] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const posterIn = useRef<HTMLInputElement>(null);

  const saved = festivals.find((f) => f.id === curId);
  const cur = curId ? drafts[curId] ?? saved : undefined;
  const dirty = (id: string) => {
    const d = drafts[id];
    const s = festivals.find((f) => f.id === id);
    return !!d && !!s && sig(d) !== sig(s);
  };
  const edit = (patch: Partial<AdminFestival>) => {
    if (!cur) return;
    setDrafts((ds) => ({ ...ds, [cur.id]: { ...cur, ...patch } }));
  };
  const setPoints = (points: ArrivalPoint[]) => edit({ points });

  const grouped = useMemo(() => {
    const s = q.trim();
    const all = festivals.map((f) => drafts[f.id] ?? f).filter((f) => !s || `${f.name} ${f.summary} ${f.id}`.includes(s));
    return ORDER.map((st) => ({
      st,
      items: all.filter((f) => festivalStatus(f, today) === st)
        .sort((a, b) => (st === "ended" ? b.ends.localeCompare(a.ends) : a.starts.localeCompare(b.starts))),
    })).filter((g) => g.items.length);
  }, [festivals, drafts, q, today]);

  async function save() {
    if (!cur) return;
    setSaving(true);
    try {
      const res = await api<{ festival: AdminFestival; version: number }>("PUT", `/api/admin/festivals/${cur.id}`, body(cur));
      props.onSaved(res.festival, res.version);
      setDrafts((ds) => { const n = { ...ds }; delete n[cur.id]; return n; });
      toast(`저장했어요 · 폰·차는 다음 실행 때 v${res.version}를 받아요`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!cur || !confirm(`${cur.name}을(를) 지울까요? 이미 찍힌 도장 기록은 남아요.`)) return;
    try {
      const res = await api<{ version: number }>("DELETE", `/api/admin/festivals/${cur.id}`);
      props.onDeleted(cur.id, res.version);
      setCurId(festivals.find((f) => f.id !== cur.id)?.id);
      toast("지웠어요");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  /** 포스터: 브라우저에서 긴 변 1080px 이하 webp로 줄여 R2에 바로 올린다. */
  async function uploadPoster(file: File) {
    if (!cur) return;
    if (dirty(cur.id)) return toast("먼저 저장해 주세요", true);
    setBusy("포스터 올리는 중…");
    try {
      const url = URL.createObjectURL(file);
      const im = await new Promise<HTMLImageElement>((res, rej) => { const x = new Image(); x.onload = () => res(x); x.onerror = () => rej(new Error("그림 파일이 아니에요")); x.src = url; });
      const k = Math.min(1, 1080 / Math.max(im.naturalWidth, im.naturalHeight));
      const cv = document.createElement("canvas");
      cv.width = Math.round(im.naturalWidth * k);
      cv.height = Math.round(im.naturalHeight * k);
      const x = cv.getContext("2d")!;
      x.imageSmoothingQuality = "high";
      x.drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      const blob = await toWebp(cv, 0.84);
      const u = await api<{ putUrl: string; publicUrl: string }>("POST", "/api/admin/upload-url", { festivalId: cur.id, kind: "poster" });
      const r = await fetch(u.putUrl, { method: "PUT", body: blob, headers: { "Content-Type": "image/webp" } });
      if (!r.ok) throw new Error(`저장소에 못 올렸어요 (${r.status})`);
      const res = await api<{ posterVersion: number; version: number }>("POST", `/api/admin/festivals/${cur.id}/poster`, { url: u.publicUrl });
      props.onSaved({ ...cur, poster: { url: u.publicUrl, version: res.posterVersion } }, res.version);
      toast(`포스터를 올렸어요 · ${cv.width}×${cv.height}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const top = (
    <div className="top">
      <h1>축제·행사</h1>
      <span className={`ver ${festivals.some((f) => dirty(f.id)) ? "dirty" : ""}`}>목록 버전 v{props.version} · 오늘 {md(today)}</span>
      <div className="sp" />
      {busy ? <span className="row muted"><LoaderCircle className="spin" />{busy}</span> : null}
      {props.tourReady
        ? <button className="btn line" onClick={() => setTouring(true)}><Download />TourAPI에서 가져오기</button>
        : <span className="muted" style={{ fontSize: 12 }} title="서버 환경 변수 DATA_GO_KR_KEY">TourAPI 가져오기는 공공데이터 키가 있을 때만</span>}
      <button className="btn line" onClick={() => setAdding({})}><Plus />축제 추가</button>
      {cur ? <button className="btn ink" onClick={save} disabled={saving || !dirty(cur.id)}><UploadCloud />{saving ? "저장 중…" : "저장하고 앱에 보내기"}</button> : null}
    </div>
  );

  const dialogs = (
    <>
      {adding ? (
        <AddFestival seed={adding} places={places} onClose={() => setAdding(null)} toast={toast}
          onDone={(f, v) => { props.onSaved(f, v); setCurId(f.id); setActive(0); setAdding(null); toast(`${f.name}을(를) 만들었어요`); }} />
      ) : null}
      {touring ? <TourDialog onClose={() => setTouring(false)} onPick={(t) => {
        setTouring(false);
        setAdding({
          name: t.title.slice(0, 40), summary: t.addr, starts: t.starts, ends: t.ends, source: `tourapi:${t.contentId}`,
          poster: { url: t.image, version: 0 },
          points: t.lat != null && t.lng != null ? [{ lat: t.lat, lng: t.lng, r: 400, name: "행사장" }] : undefined,
        });
      }} toast={toast} /> : null}
    </>
  );

  if (!cur) {
    return (
      <section>
        {top}
        <div className="card">
          <p style={{ margin: 0 }}>아직 등록한 축제가 없어요. <b>축제 추가</b>로 만들거나, 공공데이터 키가 있으면 TourAPI에서 가져와요.</p>
          <div className="hint">축제는 <b>기간 안에만</b> 추천(&lsquo;이번 주말만&rsquo; 칩)과 <b>기간 한정 도장</b>(붉은 축제 테두리)이 되고, 끝나면 저절로 빠져 도장북 &lsquo;지난 축제&rsquo;로 남아요.</div>
        </div>
        {dialogs}
      </section>
    );
  }

  const st = festivalStatus(cur, today);
  const attached = places.find((p) => p.id === cur.placeId);
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const stampImg = festivalStampSrc(cur, places);

  return (
    <section>
      {top}
      <div className="places">
        <div className="card list">
          <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="축제 이름 찾기" /></div>
          {grouped.map((g) => (
            <div key={g.st}>
              <div className="grp">{STATUS_LABEL[g.st]} · {g.items.length}</div>
              {g.items.map((f) => (
                <button key={f.id} className={`item ${f.id === cur.id ? "on" : ""} ${f.active ? "" : "off"}`} onClick={() => { setCurId(f.id); setActive(0); }}>
                  {f.poster.url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={f.poster.url} alt="" style={{ borderRadius: 10, objectFit: "cover" }} />
                    : <span className="fthumb"><PartyPopper size={18} /></span>}
                  <div style={{ minWidth: 0 }}><b>{f.name}</b><span className="s">{periodText(f)} · {f.season}</span></div>
                  {dirty(f.id) ? <span className="dot" title="저장 안 함" /> : null}
                  <span className={`r st-${g.st}`}>{STATUS_LABEL[g.st]}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="editcol">
        <div className="edit">
          <div className="card">
            <div className="row" style={{ gap: 10 }}>
              <span className="fthumb big"><PartyPopper size={22} /></span>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: 18 }}>{cur.name}</b>
                <div style={{ fontSize: 12.5, color: "var(--mute)" }}>
                  {cur.id} · {periodText(cur)} · {attached ? <>명소 <b style={{ color: "var(--sub)" }}>{attached.name}</b>에 붙음</> : "새 위치"}
                </div>
              </div>
              <div className="sp" />
              <span className={`stbadge st-${st}`}>{STATUS_LABEL[st]}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <MapBox points={cur.points} fitKey={`${cur.id}:${cur.placeId ?? ""}`} onChange={setPoints} toast={toast}
                tools={attached ? (
                  <button className="btn sm soft" title="붙은 명소의 도착 지점으로 되돌리기" onClick={() => { setPoints(attached.points); toast(`${attached.name} 도착 지점으로 맞췄어요`); }}>
                    <MapPin />명소 지점으로
                  </button>
                ) : null}
                hint={<>축제 기간 동안 차가 <b>이 원들 안</b>에서 P단 3초 + 주행거리 검증이 맞으면 <b>기간 한정 도장</b>이 찍혀요(한 차에 해마다 한 번).
                  명소에 붙인 축제는 그 명소 도장도 같이 찍히고, 열리는 날엔 추천에서 <b>명소 대신 축제</b>가 나와요.</>} />
            </div>

            <div className="form">
              <div><label className="l">이름</label><input value={cur.name} onChange={(e) => edit({ name: e.target.value })} /></div>
              <div><label className="l">장소</label>
                <select value={cur.placeId ?? ""} onChange={(e) => {
                  const p = places.find((x) => x.id === e.target.value);
                  // 명소에 붙이면 도착 원은 그 명소 것으로 시작
                  edit(p ? { placeId: p.id, points: p.points } : { placeId: null });
                  setActive(0);
                }}>
                  <option value="">새 위치 (지도에서 원 그리기)</option>
                  {places.map((p) => <option key={p.id} value={p.id}>기존 명소에 붙이기 · {p.name}</option>)}
                </select></div>
              <div className="full"><label className="l">한 줄 소개</label>
                <input value={cur.summary} onChange={(e) => edit({ summary: e.target.value })} placeholder="예) 케이블카 타고 단풍 위로" /></div>
              <div><label className="l">시작일</label>
                <input type="date" value={cur.starts} onChange={(e) => e.target.value && edit({ starts: e.target.value })} /></div>
              <div><label className="l">종료일</label>
                <input type="date" value={cur.ends} min={cur.starts} onChange={(e) => e.target.value && edit({ ends: e.target.value })} /></div>
              <div><label className="l">하루 여는 시각</label>
                <input type="time" value={hhmm(Math.min(cur.open, 1439))} onChange={(e) => { const v = minOf(e.target.value); if (Number.isFinite(v)) edit({ open: v === 1440 ? 1439 : v }); }} /></div>
              <div><label className="l">하루 닫는 시각</label>
                <input type="time" value={hhmm(Math.min(cur.close, 1439))} onChange={(e) => { const v = minOf(e.target.value); if (Number.isFinite(v)) edit({ close: v }); }} /></div>
              <div className="full"><label className="l">쉬는 요일 (이날은 추천·도장 없음)</label>
                <div className="chips">
                  {WEEKDAYS.map((d, i) => (
                    <button key={d} className={`chip ${cur.closedDays.includes(i) ? "on" : ""}`} onClick={() => edit({ closedDays: toggle(cur.closedDays, i).sort() })}>{d}</button>
                  ))}
                </div></div>
              <div><label className="l">머무는 시간 (분, 4살 기준)</label>
                <input type="number" min={10} max={600} value={cur.dwell} onChange={(e) => edit({ dwell: Math.round(Number(e.target.value)) })} /></div>
              <CompanionFit kidFit={cur.kidFit} fit={cur.fit} tags={cur.tags} onChange={(v) => edit(v)} />
              <div className="full"><label className="l">추천 가중치 · 실내·야외</label>
                <div className="chips">
                  <button className={`chip ${cur.weight < WEIGHT_STRONG ? "on" : ""}`} onClick={() => edit({ weight: WEIGHT_NORMAL })}>보통 (+1)</button>
                  <button className={`chip ${cur.weight >= WEIGHT_STRONG ? "on" : ""}`} onClick={() => edit({ weight: WEIGHT_STRONG })}>강하게 (+2.5 · 주말 1순위 후보)</button>
                  <span className="muted">·</span>
                  <button className={`chip ${cur.indoor ? "on" : ""}`} onClick={() => edit({ indoor: true })}>실내</button>
                  <button className={`chip ${!cur.indoor ? "on" : ""}`} onClick={() => edit({ indoor: false })}>야외</button>
                </div></div>
              <div><label className="l">혼잡 예상</label>
                <input value={cur.crowdNote} onChange={(e) => edit({ crowdNote: e.target.value })} placeholder="예) 주말 오후 붐빔 · 오전 일찍 추천" /></div>
              <div><label className="l">도장 아래 글씨 (해·계절)</label>
                <input value={cur.season} onChange={(e) => edit({ season: e.target.value })} placeholder={seasonLabel(cur.starts)} /></div>
              <div className="full"><label className="l">상태</label>
                <div className="chips">
                  <button className={`chip ${cur.active ? "on" : ""}`} onClick={() => edit({ active: !cur.active })}>{cur.active ? "앱에 보냄" : "숨김 (앱에 안 보냄)"}</button>
                  <span className="muted" style={{ fontSize: 12 }}>예정·진행 중·끝남은 날짜로 저절로 정해져요</span>
                  <div className="sp" />
                  <button className="btn sm warn" onClick={remove}><Trash2 />지우기</button>
                </div></div>
            </div>
          </div>

          <div className="prev">
            <h3><ImagePlus />포스터</h3>
            <div className="poster">
              {cur.poster.url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={cur.poster.url} alt="" />
                : <div className="none"><PartyPopper size={28} /><span>포스터 없음</span></div>}
            </div>
            <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <button className="btn sm ink" disabled={!props.storeReady || !!busy} onClick={() => posterIn.current?.click()}><UploadCloud />포스터 올리기</button>
              <input ref={posterIn} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPoster(f); e.target.value = ""; }} />
              {cur.poster.url ? <button className="btn sm soft" onClick={() => edit({ poster: { ...cur.poster, url: null } })}><X />빼기</button> : null}
            </div>
            <input className="fld" style={{ marginTop: 6, fontSize: 12 }} placeholder="또는 그림 주소 (https://…)" value={cur.poster.url ?? ""}
              onChange={(e) => edit({ poster: { ...cur.poster, url: e.target.value.trim() || null } })} />
            {props.storeReady === false ? (
              <div className="hint warn"><CircleAlert size={13} style={{ verticalAlign: -2 }} /> 저장소(R2) 연결 전이라 올리기는 꺼져 있어요. 주소를 직접 넣을 수는 있어요.</div>
            ) : <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>브라우저에서 긴 변 1080px 이하 webp로 줄여 올려요 (festivals/{cur.id}/poster-판.webp)</div>}

            <h3 style={{ marginTop: 16 }}><Stamp />기간 한정 도장</h3>
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <div className="fstamp">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {stampImg ? <img src={stampImg} alt="" className={cur.stamp.url ? "" : "ghost"} /> : <PartyPopper size={30} />}
                <span className="ribbon" style={{ background: FESTIVAL_INK }}><Flag size={11} />{cur.season || seasonLabel(cur.starts)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--sub)", lineHeight: 1.5 }}>
                {cur.stamp.url ? <>올린 한정 도장 v{cur.stamp.version}</> : <>아직 없어요 · {attached ? `${attached.name} 그림에 붉은 테로 미리보기` : "그림 없음"}</>}
                <br />
                <button className="btn sm soft" style={{ marginTop: 6 }} onClick={() => props.onMakeStamp(cur.id)}><Stamp />도장 올리기에서 만들기</button>
              </div>
            </div>

            <h3 style={{ marginTop: 16 }}><Smartphone />앱에서 이렇게 보여요</h3>
            <div className="fbanner"><CalendarRange size={15} /><span>이번 주말 <b>{cur.name}</b> · {md(cur.ends)}까지</span></div>
            <div className="chips" style={{ marginTop: 8 }}>
              <span className="fchip"><PartyPopper size={12} />이번 주말만 · {md(cur.ends)}까지</span>
              <span className="chip" style={{ cursor: "default" }}>도장 +1</span>
            </div>
            <div className="hint">
              기간 <b>{periodText(cur)}</b> {hhmm(cur.open)}~{hhmm(Math.min(cur.close, 1440))}{cur.closedDays.length ? ` · ${cur.closedDays.map((d) => WEEKDAYS[d]).join("·")} 쉼` : ""}.
              추천 점수 <b>+{cur.weight >= WEIGHT_STRONG ? "2.5" : "1"}</b>{cur.crowdNote ? ` · ${cur.crowdNote}` : ""}.
              {st === "ended" ? " 끝난 축제는 추천·도장에서 빠지고 도장북 '지난 축제'로 남아요." : ""}
            </div>
          </div>

        </div>
          {saved ? (
            <AiStampCard key={saved.id} kind="festival" id={saved.id} name={saved.name} album="축제 도장"
              top={saved.name} bottom={saved.season || seasonLabel(saved.starts)} storeReady={props.storeReady}
              onStampSaved={(stamp, v) => props.onSaved({ ...saved, stamp }, v)} toast={toast} />
          ) : null}
        </div>
      </div>
      {dialogs}
    </section>
  );
}

function AddFestival(props: {
  seed: Partial<AdminFestival>; places: AdminPlace[]; onClose: () => void; onDone: (f: AdminFestival, version: number) => void; toast: Toast;
}) {
  const s = props.seed;
  const today = kstToday();
  const [id, setId] = useState(() => `fest-${today.slice(0, 4)}-${Math.random().toString(36).slice(2, 6)}`);
  const [name, setName] = useState(s.name ?? "");
  const [placeId, setPlaceId] = useState(s.placeId ?? "");
  const [starts, setStarts] = useState(s.starts ?? today);
  const [ends, setEnds] = useState(s.ends ?? addDays(today, 14));
  const first = s.points?.[0];
  const [ll, setLl] = useState(first ? `${first.lat.toFixed(5)}, ${first.lng.toFixed(5)}` : "35.88580, 128.58280");
  const [busy, setBusy] = useState(false);
  async function go() {
    const p = props.places.find((x) => x.id === placeId);
    const [lat, lng] = ll.split(",").map((x) => Number(x.trim()));
    const points = p ? p.points : [{ lat, lng, r: 400, name: "행사장" }];
    setBusy(true);
    try {
      const res = await api<{ festival: AdminFestival; version: number }>("POST", "/api/admin/festivals", {
        id: id.trim(), name, summary: s.summary ?? "", placeId: p?.id ?? null, points, starts, ends,
        open: p ? Math.max(p.open, 9 * 60) : 10 * 60, close: p ? Math.min(p.close, 18 * 60) : 18 * 60, closedDays: [],
        dwell: 90, indoor: p?.indoor ?? false, kidFit: 0.8, weight: WEIGHT_NORMAL, crowdNote: "", season: seasonLabel(starts),
        // 붙는 명소의 동행 적합도·분위기 표시를 처음 값으로
        ...(p ? { fit: { ...p.fit, kids: 0.8 }, tags: p.tags.filter((t) => (COMPANION_TAG_CHOICES as readonly string[]).includes(t)) } : {}),
        posterUrl: s.poster?.url ?? null, source: s.source ?? null, active: true,
      });
      props.onDone(res.festival, res.version);
    } catch (e) {
      props.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dlg" onClick={props.onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b style={{ fontSize: 16 }}>축제 추가{s.source ? " · TourAPI에서" : ""}</b><div className="sp" /><button className="btn sm soft" onClick={props.onClose}><X /></button></div>
        <div className="form" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="full"><label className="l">이름</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 팔공산 단풍축제" autoFocus /></div>
          <div className="full"><label className="l">장소</label>
            <select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
              <option value="">새 위치</option>
              {props.places.map((p) => <option key={p.id} value={p.id}>기존 명소에 붙이기 · {p.name}</option>)}
            </select></div>
          {!placeId ? <div className="full"><label className="l">좌표 (위도, 경도) — 만든 뒤 지도에서 옮겨요</label><input value={ll} onChange={(e) => setLl(e.target.value)} /></div> : null}
          <div><label className="l">시작일</label><input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
          <div><label className="l">종료일</label><input type="date" value={ends} min={starts} onChange={(e) => setEnds(e.target.value)} /></div>
          <div className="full"><label className="l">id (fest- 뒤 영문 소문자·숫자, 도장 파일 이름)</label><input value={id} onChange={(e) => setId(e.target.value.toLowerCase())} /></div>
        </div>
        <div className="hint">명소에 붙이면 도착 원은 그 명소 것으로 시작해요. 만든 뒤 시각·쉬는 요일·가중치·포스터·한정 도장을 채워 저장하세요.</div>
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn ink" disabled={busy || !name.trim() || !id} onClick={go}><Plus />만들기</button>
        </div>
      </div>
    </div>
  );
}

/** TourAPI searchFestival2 (대구 4 · 경북 35, 기간) → 고르면 '축제 추가' 폼을 채운다. */
function TourDialog(props: { onClose: () => void; onPick: (t: TourFestival) => void; toast: Toast }) {
  const today = kstToday();
  const [area, setArea] = useState("4");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 60));
  const [items, setItems] = useState<TourFestival[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function search() {
    setBusy(true);
    try {
      const r = await api<{ ready: boolean; items: TourFestival[] }>("GET", `/api/admin/festivals/tour?area=${area}&from=${from}&to=${to}`);
      setItems(r.items);
    } catch (e) {
      props.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dlg" onClick={props.onClose}>
      <div className="card" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="row"><b style={{ fontSize: 16 }}>TourAPI 축제 가져오기</b><div className="sp" /><button className="btn sm soft" onClick={props.onClose}><X /></button></div>
        <div className="form" style={{ gridTemplateColumns: "1fr 1fr 1fr auto", alignItems: "end" }}>
          <div><label className="l">지역</label><select value={area} onChange={(e) => setArea(e.target.value)}><option value="4">대구</option><option value="35">경북</option></select></div>
          <div><label className="l">이날부터</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="l">이날까지</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn ink" disabled={busy} onClick={search}>{busy ? <LoaderCircle className="spin" /> : null}찾기</button>
        </div>
        <div style={{ maxHeight: 380, overflow: "auto", marginTop: 10 }}>
          {items === null ? <p className="muted">지역·기간을 고르고 찾기를 누르세요.</p> : items.length === 0 ? <p className="muted">찾은 축제가 없어요.</p> : (
            <table><tbody>
              {items.map((t) => (
                <tr key={t.contentId}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <td style={{ width: 54 }}>{t.image ? <img src={t.image} alt="" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 8 }} /> : null}</td>
                  <td><b>{t.title}</b><br /><span className="muted" style={{ fontSize: 12 }}>{t.addr}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>{periodText(t)}</td>
                  <td><button className="btn sm soft" onClick={() => props.onPick(t)}>가져오기</button></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
        <div className="hint">가져오면 이름·기간·좌표·포스터가 채워져요. <b>사람이 검수</b>한 뒤 저장하세요 (기간·운영 시각·도착 원 확인).</div>
      </div>
    </div>
  );
}
