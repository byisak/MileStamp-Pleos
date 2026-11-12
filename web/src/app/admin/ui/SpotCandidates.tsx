"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Binoculars, Check, ExternalLink, EyeOff, FileUp, Link2, MapPinPlus, RotateCcw } from "lucide-react";
import type { AdminPlace } from "@/lib/catalog-shape";
import { REGIONS } from "@/lib/explore-region";
import { spotMapLinks, spotNote, SPOT_IMPORT_MAX, SPOT_META, type SpotRow, type SpotStatus } from "@/lib/spot100-shape";
import { api, type Toast } from "./AdminApp";
import type { Promote } from "./PopularPane";

/*
 * 명소발굴 100x100 후보 (관리자 전용) — 한국관광공사 시범 사이트 spot100x100.kr 의 9,883줄을 같은 곳끼리 합친 목록.
 * 한 줄 설명은 'AI·관리자 참고'로만 보인다 (읽기 전용, 앱·차·공개 API에는 없음). 좋은 곳은 '명소로 올리기' → 명소 추가 창.
 */

type Facets = { total: number; withContentId: number; sido: Record<string, number>; status: Record<string, number> };
type Res = { rows: SpotRow[]; total: number; page: number; size: number; facets: Facets };

const STATUS_TEXT: Record<SpotStatus, string> = { new: "새것", ok: "괜찮음", hidden: "안 볼 것" };
const SIZE = 30;

export function SpotCandidates(props: { places: AdminPlace[]; onPromote: (p: Promote) => void; toast: Toast }) {
  const { toast } = props;
  const [f, setF] = useState({ sido: "", theme: "", topic: "", cid: "", status: "new", q: "" });
  const [qLive, setQLive] = useState("");
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // 검색어는 0.4초 쉬었다가 거른다
  useEffect(() => {
    const t = setTimeout(() => { setF((x) => (x.q === qLive.trim() ? x : { ...x, q: qLive.trim() })); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [qLive]);

  const [tick, setTick] = useState(0);
  const load = useCallback(async () => { setTick((n) => n + 1); }, []);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page), size: String(SIZE) });
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    let alive = true;
    api<Res>("GET", `/api/admin/spots?${p}`)
      .then((r) => { if (alive) { setRes(r); setErr(null); } })
      .catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [f, page, tick]);

  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v, ...(k === "theme" ? { topic: "" } : {}) })); setPage(1); };

  async function importFile(file0: File) {
    setBusy("import");
    try {
      const json = JSON.parse(await file0.text()) as { rows?: unknown[] };
      const all = Array.isArray(json.rows) ? json.rows : [];
      if (!all.length) throw new Error("파일에 rows가 없어요 (tools/spot100/spot100-2026.json)");
      let saved = 0, skipped = 0;
      for (let i = 0; i < all.length; i += SPOT_IMPORT_MAX) {
        const r = await api<{ saved: number; skipped: number }>("POST", "/api/admin/spots", { action: "import", rows: all.slice(i, i + SPOT_IMPORT_MAX) });
        saved += r.saved; skipped += r.skipped;
        toast(`올리는 중… ${Math.min(i + SPOT_IMPORT_MAX, all.length)} / ${all.length}`);
      }
      toast(`${saved}곳을 올렸어요${skipped ? ` · 건너뜀 ${skipped}` : ""}`, skipped > 0);
      setPage(1);
      await load();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  }

  async function setStatus(key: string, status: SpotStatus) {
    try {
      await api("POST", "/api/admin/spots", { action: "status", keys: [key], status });
      await load();
    } catch (e) { toast((e as Error).message, true); }
  }
  async function link(key: string, placeId: string | null) {
    try {
      await api("POST", "/api/admin/spots", { action: "link", key, placeId });
      toast(placeId ? "우리 명소와 묶었어요" : "묶음을 풀었어요");
      await load();
    } catch (e) { toast((e as Error).message, true); }
  }

  const placeName = (id: string | null) => props.places.find((p) => p.id === id)?.name ?? id ?? "";
  const topicsShown = SPOT_META.topics.map((t, i) => ({ ...t, i })).filter((t) => !f.theme || t.th === Number(f.theme));
  const pages = res ? Math.max(1, Math.ceil(res.total / SIZE)) : 1;
  const fc = res?.facets;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <h3 style={{ fontSize: 15, margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Binoculars size={16} />명소발굴 후보 (100×100)</h3>
        {fc ? <span className="muted" style={{ fontSize: 12.5 }}>{fc.total}곳 · TourAPI 번호 {fc.withContentId} · 새것 {fc.status.new ?? 0} · 괜찮음 {fc.status.ok ?? 0}</span> : null}
        <div className="sp" />
        <input ref={file} type="file" accept=".json,application/json" style={{ display: "none" }}
          onChange={(e) => { const x = e.target.files?.[0]; if (x) void importFile(x); }} />
        <button className="btn sm line" disabled={!!busy} onClick={() => file.current?.click()}><FileUp />{busy === "import" ? "올리는 중…" : "후보 올리기 (JSON)"}</button>
      </div>
      <div className="hint">
        한국관광공사 시범 사이트 <b>spot100x100.kr</b>의 9,883줄을 같은 곳(이름+주소)끼리 합친 <b>관리자 전용</b> 후보예요. 한 줄 설명은 관광공사 저작물이라
        <b> 참고용 글로만</b> 보이고 폰·차·추천에는 쓰이지 않아요. 좋은 곳은 <b>명소로 올리기</b> → 명소를 만든 뒤 아래 &lsquo;우리 명소&rsquo;로 묶어 두세요.
        파일 <code>tools/spot100/spot100-2026.json</code>을 올리면 500곳씩 나눠 저장돼요 (여러 번 올려도 상태·묶음은 그대로).
      </div>

      <div className="row spotfilters" style={{ gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
        <select value={f.sido} onChange={(e) => set("sido", e.target.value)}>
          <option value="">시·도 전체</option>
          {REGIONS.map((r) => <option key={r.code} value={r.code}>{r.name}{fc?.sido[r.code] ? ` (${fc.sido[r.code]})` : ""}</option>)}
        </select>
        <select value={f.theme} onChange={(e) => set("theme", e.target.value)}>
          <option value="">테마 전체</option>
          {SPOT_META.themes.map((t, i) => <option key={i} value={i}>{t.icon} {t.name}</option>)}
        </select>
        <select value={f.topic} onChange={(e) => set("topic", e.target.value)}>
          <option value="">주제 전체</option>
          {topicsShown.map((t) => <option key={t.i} value={t.i}>{t.name}</option>)}
        </select>
        <select value={f.cid} onChange={(e) => set("cid", e.target.value)}>
          <option value="">TourAPI 번호 상관없음</option>
          <option value="1">번호 있음</option>
          <option value="0">번호 없음</option>
        </select>
        <select value={f.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">상태 전체</option>
          {(Object.keys(STATUS_TEXT) as SpotStatus[]).map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}{fc?.status[s] ? ` (${fc.status[s]})` : ""}</option>)}
        </select>
        <div className="search" style={{ flex: "1 1 160px" }}><input value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder="이름·주소 찾기" /></div>
      </div>

      {err ? <p className="muted" style={{ margin: 0 }}>{err}</p> : !res ? <p className="muted" style={{ margin: 0 }}>불러오는 중…</p> : (
        <>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{res.total}곳 · {page}/{pages}쪽</div>
          {res.rows.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {fc && fc.total === 0 ? "아직 후보가 없어요. 위 '후보 올리기'로 spot100-2026.json을 올리거나 tools/spot100/*.sql을 DB에 넣어 주세요." : "조건에 맞는 곳이 없어요."}
            </p>
          ) : res.rows.map((r) => <SpotCard key={r.key} r={r} places={props.places} placeName={placeName}
            onStatus={setStatus} onLink={link} onPromote={props.onPromote} />)}
          <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 8 }}>
            <button className="btn sm line" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
            <span className="muted" style={{ fontSize: 12.5 }}>{page} / {pages}</span>
            <button className="btn sm line" disabled={page >= pages} onClick={() => setPage(page + 1)}>다음</button>
          </div>
        </>
      )}
    </div>
  );
}

function SpotCard(props: {
  r: SpotRow; places: AdminPlace[]; placeName: (id: string | null) => string;
  onStatus: (key: string, s: SpotStatus) => void; onLink: (key: string, id: string | null) => void; onPromote: (p: Promote) => void;
}) {
  const { r } = props;
  const m = spotMapLinks(r.name, r.lat, r.lng);
  const region = REGIONS.find((x) => x.code === r.sido)?.name;
  const note = spotNote(r.topics);
  const others = r.topics.filter((t) => t.n && t.n !== note).slice(0, 3);
  return (
    <div className="spotcard">
      {r.image ? <img className="spotimg" src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="spotimg" />}
      <div className="spotbody">
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <b>{r.name}</b>
          <span className={`tag ${r.status === "ok" ? "" : r.status === "hidden" ? "rec" : "w"}`}>{STATUS_TEXT[r.status]}</span>
          {r.ourPlaceId ? <span className="tag ai">명소 · {props.placeName(r.ourPlaceId)}</span> : null}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {region ? `${region} · ` : ""}{r.addr ?? "주소 없음"} · {r.lat.toFixed(4)}, {r.lng.toFixed(4)}{r.contentId ? ` · TourAPI ${r.contentId}` : " · 번호 없음"}
        </div>
        <div className="chips" style={{ margin: "4px 0" }}>
          {r.topics.map((t) => <span key={t.t} className="tag">{SPOT_META.themes[t.th]?.icon} {SPOT_META.topics[t.t]?.name}{t.r ? ` ${t.r}위` : ""}</span>)}
        </div>
        {note ? (
          <div className="spotnote">
            <span className="tag ai">AI·관리자 참고</span> {note}
            {others.map((t) => <div key={t.t} className="muted" style={{ fontSize: 12 }}>· {t.n}</div>)}
          </div>
        ) : null}
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <button className="btn sm line" onClick={() => props.onPromote({ name: r.name, lat: r.lat, lng: r.lng, r: 300, from: `spot:${r.key}` })}><MapPinPlus />명소로 올리기</button>
          {r.status !== "ok" ? <button className="btn sm line" onClick={() => props.onStatus(r.key, "ok")}><Check />괜찮음</button> : null}
          {r.status !== "hidden" ? <button className="btn sm line" onClick={() => props.onStatus(r.key, "hidden")}><EyeOff />안 볼래요</button> : null}
          {r.status !== "new" ? <button className="btn sm line" onClick={() => props.onStatus(r.key, "new")}><RotateCcw />새것으로</button> : null}
          {r.sourceUrl ? <a className="btn sm line" href={r.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />출처</a> : null}
          <a className="btn sm line" href={m.kakao} target="_blank" rel="noreferrer"><ExternalLink />카카오맵</a>
          <a className="btn sm line" href={m.naver} target="_blank" rel="noreferrer"><ExternalLink />네이버지도</a>
          <span className="row" style={{ gap: 4 }}>
            <Link2 size={14} />
            <select value={r.ourPlaceId ?? ""} onChange={(e) => props.onLink(r.key, e.target.value || null)}>
              <option value="">우리 명소 (안 묶음)</option>
              {props.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </span>
        </div>
      </div>
    </div>
  );
}
