"use client";

import { useMemo, useRef, useState } from "react";
import { FileUp, Flame, Landmark, Link2, MapPinPlus, RefreshCw } from "lucide-react";
import type { AdminPlace } from "@/lib/catalog-shape";
import { matchOurPlace } from "@/lib/explore-shape";
import type { CuratedRow } from "@/lib/kto100-shape";
import { api, type Toast } from "./AdminApp";
import { SpotCandidates } from "./SpotCandidates";

/** 관리자 '많이 고른 곳'의 한 줄 (lib/explore.ts PopularExt와 같은 모양). */
export type PopularRow = {
  id: string; name: string; lat: number | null; lng: number | null;
  picks: number; families: number; demoPicks: number; visits: number; last: string;
};

/** '명소로 올리기' — 명소 탭 '명소 추가'를 이 값으로 채워 연다. */
export type Promote = { name: string; lat: number; lng: number; r: number; from: string };

const extLabel = (id: string) => (id.startsWith("ext:tour:") ? `TourAPI ${id.slice(9)}` : id.startsWith("ext:kto100:") ? `100선 ${id.slice(11)}번`
  : id.startsWith("ext:kakao:") ? `카카오 ${id.slice(10)}` : id.startsWith("ext:pin:") ? `지도 핀 ${id.slice(8)}` : id);

/** 파일 글 읽기: UTF-8로 읽어 깨지면(공공데이터 CSV는 흔히 EUC-KR) EUC-KR로 다시. */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf = new TextDecoder("utf-8").decode(buf);
  return utf.includes("�") ? new TextDecoder("euc-kr").decode(buf) : utf;
}

export function PopularPane(props: {
  popular: PopularRow[];
  kto100: CuratedRow[];
  places: AdminPlace[];
  tourReady: boolean;
  onPromote: (p: Promote) => void;
  toast: Toast;
}) {
  const { toast } = props;
  const [rows, setRows] = useState(props.kto100);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const placeList = useMemo(() => props.places.map((p) => ({ id: p.id, name: p.name, lat: p.points[0].lat, lng: p.points[0].lng })), [props.places]);
  const placeName = (id: string | null | undefined) => props.places.find((p) => p.id === id)?.name ?? id ?? "";

  const kto = useMemo(() => rows.map((r) => {
    const auto = r.our_place_id ? null : matchOurPlace(r, placeList);
    return { ...r, linked: r.our_place_id ?? auto?.id ?? null, auto: !r.our_place_id && !!auto };
  }), [rows, placeList]);
  const shown = kto.filter((r) => !q.trim() || `${r.no} ${r.name} ${r.area ?? ""} ${r.region ?? ""}`.includes(q.trim()));
  const nLinked = kto.filter((r) => r.linked).length;
  const nNoId = kto.filter((r) => !r.content_id).length;

  async function upload(f: File) {
    if (/\.xlsx?$/i.test(f.name)) { toast("엑셀 파일은 'CSV UTF-8'로 저장해서 올려 주세요", true); return; }
    setBusy("upload");
    try {
      const text = await readText(f);
      const r = await api<{ saved: number; errors: string[]; rows: CuratedRow[] }>("POST", "/api/explore/kto100", { action: "upload", text });
      setRows(r.rows);
      toast(`${r.saved}곳을 올렸어요${r.errors.length ? ` · 건너뛴 줄 ${r.errors.length}개 (${r.errors[0]})` : ""}`, r.errors.length > 0);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  }

  async function fill() {
    setBusy("fill");
    try {
      const r = await api<{ filled: string[]; missing: string[]; left: number; rows: CuratedRow[] }>("POST", "/api/explore/kto100", { action: "fill" });
      setRows(r.rows);
      toast(`${r.filled.length}곳 채움${r.missing.length ? ` · 못 찾음 ${r.missing.length}곳` : ""} · 남은 곳 ${r.left}곳`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  async function link(name: string, placeId: string | null) {
    try {
      const r = await api<{ rows: CuratedRow[] }>("POST", "/api/explore/kto100", { action: "link", name, placeId });
      setRows(r.rows);
      toast(placeId ? `${name} ↔ ${placeName(placeId)} 묶었어요` : `${name}: 자동(이름·거리)으로 되돌렸어요`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <section>
      <div className="top">
        <h1>많이 고른 곳 · 100선</h1>
        <span className="ver">우리 명소가 아닌 곳 (도장 대신 &lsquo;다녀옴&rsquo;)</span>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, margin: "0 0 8px", display: "flex", gap: 6, alignItems: "center" }}><Flame size={16} />많이 고른 곳 (최근 90일)</h3>
        <div className="hint" style={{ marginTop: 0 }}>
          가족들이 코스로 고른 <b>바깥 장소</b>(축제·직접 찾기·100선 중 우리 명소가 아닌 곳)예요. 자주 고르는 곳은
          <b> &lsquo;명소로 올리기&rsquo;</b> → 이름·좌표·반경이 채워진 명소 추가 창 → 만든 뒤 지도·시간을 다듬고 아래 <b>AI로 도장 만들기</b>.
        </div>
        {props.popular.length ? (
          <table>
            <thead><tr><th>장소</th><th>고른 가족</th><th>고른 횟수</th><th>다녀옴</th><th>마지막</th><th /></tr></thead>
            <tbody>
              {props.popular.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><div className="muted" style={{ fontSize: 12 }}>{extLabel(p.id)}{p.lat != null ? ` · ${p.lat.toFixed(4)}, ${p.lng!.toFixed(4)}` : ""}</div></td>
                  <td>{p.families}</td>
                  <td>{p.picks}{p.demoPicks ? <span className="muted"> (데모 {p.demoPicks})</span> : null}</td>
                  <td>{p.visits}</td>
                  <td className="muted">{p.last.slice(0, 10)}</td>
                  <td>
                    <button className="btn sm line" disabled={p.lat == null || p.lng == null}
                      onClick={() => props.onPromote({ name: p.name, lat: p.lat!, lng: p.lng!, r: 300, from: p.id })}>
                      <MapPinPlus />명소로 올리기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ margin: 0 }}>아직 바깥 장소를 고른 코스가 없어요. 폰에서 축제·100선·직접 찾기로 코스를 고르면 여기에 쌓여요.</p>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <h3 style={{ fontSize: 15, margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Landmark size={16} />한국관광 100선 (2025~2026)</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>{rows.length}곳 · 우리 명소와 같은 곳 {nLinked} · TourAPI 번호 없음 {nNoId}</span>
          <div className="sp" />
          <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <button className="btn sm line" disabled={!!busy} onClick={() => file.current?.click()}><FileUp />{busy === "upload" ? "올리는 중…" : "새 판 올리기 (CSV)"}</button>
          <button className="btn sm line" disabled={!!busy || !props.tourReady || nNoId === 0} title={props.tourReady ? "" : "DATA_GO_KR_KEY가 없어요"}
            onClick={fill}><RefreshCw />{busy === "fill" ? "채우는 중…" : "TourAPI로 좌표·번호 채우기"}</button>
        </div>
        <div className="hint">
          출처: 공공데이터포털 &lsquo;한국관광공사_국내 관광지 정보(한국관광 100선)&rsquo; (이용허락범위 제한 없음). 앱에는 이름 &lsquo;한국관광 100선&rsquo;과
          우리 그림체 배지 &lsquo;100선&rsquo;만 보여요 — <b>관광공사 로고·인증 도장 그림은 쓰지 않아요</b>.
          새 판(2년마다)은 첫 줄에 <code>순번·권역·지역·이름·위도·경도·주소</code> 칸이 있는 CSV/TSV로 올려요 (판에 없는 이름은 지워져요, 엑셀은 &lsquo;CSV UTF-8&rsquo;로 저장).
          좌표가 근사값인 곳은 &lsquo;TourAPI로 채우기&rsquo;(한 번에 25곳)로 정확한 좌표·번호·사진을 받아요.
        </div>
        <div className="search" style={{ margin: "8px 0" }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·권역·지역 찾기" /></div>
        {rows.length ? (
          <table>
            <thead><tr><th>#</th><th>이름</th><th>지역</th><th>TourAPI</th><th>우리 명소</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.name}>
                  <td className="muted">{r.no}</td>
                  <td><b>{r.name}</b>{r.lat != null ? <div className="muted" style={{ fontSize: 12 }}>{r.lat.toFixed(4)}, {r.lng!.toFixed(4)}</div> : null}</td>
                  <td>{r.area} · {r.region}</td>
                  <td>{r.content_id ?? <span className="muted">근사 좌표</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <Link2 size={14} />
                      <select value={r.our_place_id ?? ""} onChange={(e) => void link(r.name, e.target.value || null)}>
                        <option value="">{r.auto ? `자동: ${placeName(r.linked)}` : "자동 (없음)"}</option>
                        {props.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ margin: 0 }}>표가 비었어요. 운영 DB에 <code>tools/kto100/kto100-2025.sql</code>을 넣거나 CSV를 올려 주세요.</p>}
      </div>

      <SpotCandidates places={props.places} onPromote={props.onPromote} toast={toast} />
    </section>
  );
}
