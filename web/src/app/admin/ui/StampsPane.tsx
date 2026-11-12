"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Download, ImagePlus, LoaderCircle, UploadCloud } from "lucide-react";
import type { AdminPlace, StampRef } from "@/lib/catalog-shape";
import type { AdminFestival } from "@/lib/festival-shape";
import { api, type Toast } from "./AdminApp";
import { uploadStamp } from "./stamp-upload";
import { INK, INK_FEST, INK_GOLD, SHEETS, composeStamp, cutArt, defaultTop, findCircles, toBw, toWebp, type Circle } from "./stampcraft";

type Cut = {
  circle: Circle;
  art: string; // 잘라 낸 그림 PNG data URL
  placeId: string;
  top: string;
  bottom: string;
  ink: string;
  rare: boolean;
  /** 축제 한정 도장 테두리 (붉은 인주·깃발) */
  festival?: boolean;
  preview?: string; // 완성 도장 data URL (컬러)
  previewBw?: string;
  previewKey?: string;
  done?: boolean;
};

const keyOf = (c: Cut) => JSON.stringify([c.art.length, c.top, c.bottom, c.ink, c.rare, !!c.festival]);
const isFest = (id: string) => id.startsWith("fest-");

export function StampsPane(props: {
  places: AdminPlace[];
  /** 축제 한정 도장도 같은 흐름으로 (장소 고르기에 '축제·행사' 묶음) */
  festivals: AdminFestival[];
  /** 축제 탭에서 '도장 올리기에서 만들기'로 온 축제 — 시트를 올리면 첫 원을 이 축제로 */
  focusFestival?: string | null;
  version: number;
  onSaved: (id: string, stamp: StampRef, version: number) => void;
  toast: Toast;
}) {
  const { places, toast } = props;
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [sel, setSel] = useState(0);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [storeReady, setStoreReady] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ ready: boolean }>("GET", "/api/admin/upload-url").then((r) => setStoreReady(r.ready)).catch(() => setStoreReady(false));
  }, []);

  const placeOf = (id: string) => places.find((p) => p.id === id);
  const festOf = (id: string) => props.festivals.find((f) => f.id === id);
  const nameOf = (id: string) => festOf(id)?.name ?? placeOf(id)?.name ?? id;
  const focus = props.focusFestival ? festOf(props.focusFestival) : undefined;
  const options = (
    <>
      <option value="">장소 고르기</option>
      {props.festivals.length ? (
        <optgroup label="축제·행사 (한정 도장)">
          {props.festivals.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.season}{f.stamp.url ? " (올린 그림 있음)" : ""}</option>)}
        </optgroup>
      ) : null}
      <optgroup label="명소">
        {places.map((p) => <option key={p.id} value={p.id}>{p.name}{p.stamp.url ? " (올린 그림 있음)" : ""}</option>)}
      </optgroup>
    </>
  );
  const cur = cuts[sel];

  // 고른 도장 미리보기 (글씨·잉크가 바뀌면 다시 그림, 0.3초 기다렸다가)
  useEffect(() => {
    if (!cur || cur.previewKey === keyOf(cur)) return;
    const c = cur;
    const i = sel;
    const t = setTimeout(async () => {
      try {
        const color = await composeStamp({ art: c.art, top: c.top, bottom: c.bottom, ink: c.ink, rare: c.rare, festival: c.festival, size: 520 });
        const bw = toBw(color);
        setCuts((xs) => xs.map((x, k) => (k === i ? { ...x, preview: color.toDataURL(), previewBw: bw.toDataURL(), previewKey: keyOf(c) } : x)));
      } catch (e) {
        toast((e as Error).message, true);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [cur, sel, toast]);

  async function loadFile(f: File) {
    setBusy("원을 찾는 중…");
    try {
      const url = URL.createObjectURL(f);
      const im = await new Promise<HTMLImageElement>((res, rej) => { const x = new Image(); x.onload = () => res(x); x.onerror = () => rej(new Error("그림 파일이 아니에요")); x.src = url; });
      const cv = sheetRef.current!;
      cv.width = im.naturalWidth;
      cv.height = im.naturalHeight;
      const x = cv.getContext("2d", { willReadFrequently: true })!;
      x.drawImage(im, 0, 0);
      URL.revokeObjectURL(url);
      const data = x.getImageData(0, 0, cv.width, cv.height);
      await new Promise((r) => setTimeout(r, 20));
      const circles = findCircles(data);
      const sheet = /sheet-([A-Z])\b/i.exec(f.name)?.[1]?.toUpperCase();
      const preset = sheet ? SHEETS[sheet] : undefined;
      const next: Cut[] = circles.map((c, i) => {
        const { png } = cutArt(cv, data, c);
        const pre = preset && preset.length === circles.length ? preset[i] : undefined;
        const p = pre ? placeOf(pre[0]) : undefined;
        return {
          circle: c, art: png, placeId: p?.id ?? "", ink: INK, rare: false,
          top: pre?.[1] ?? "", bottom: pre?.[2] ?? "",
        };
      });
      // 찾은 원 표시 (노란 테 + 번호)
      x.lineWidth = Math.max(4, cv.width / 250);
      x.strokeStyle = "#F2B230";
      x.fillStyle = "#F2B230";
      x.font = `bold ${Math.round(cv.width / 30)}px Pretendard, sans-serif`;
      circles.forEach((c, i) => {
        x.beginPath();
        x.ellipse(c.cx, c.cy, c.rx, c.ry, 0, 0, Math.PI * 2);
        x.stroke();
        x.fillText(String(i + 1), c.cx - c.rx, c.cy - c.ry + cv.width / 30);
      });
      // 축제 탭에서 왔으면 첫 원을 그 축제로 (붉은 테·해·계절 글씨)
      // (붙은 명소 그림이 시트에 있으면 그 원, 아니면 장소를 못 고른 첫 원, 그것도 없으면 첫 원)
      if (focus && next.length && !next.some((c) => c.placeId === focus.id)) {
        const k = Math.max(0, [next.findIndex((c) => !!focus.placeId && c.placeId === focus.placeId), next.findIndex((c) => !c.placeId)].find((x) => x >= 0) ?? 0);
        next[k] = { ...next[k], placeId: focus.id, festival: true, ink: INK_FEST, rare: false, top: focus.name, bottom: focus.season };
      }
      setSheetName(f.name);
      setCuts(next);
      setSel(Math.max(0, focus ? next.findIndex((c) => c.placeId === focus.id) : 0));
      toast(circles.length ? `원 ${circles.length}개를 찾았어요${preset && preset.length === circles.length ? ` · 시트 ${sheet} 순서로 채웠어요` : " · 장소를 골라 주세요"}` : "원을 못 찾았어요 · 흰 바탕 시트인지 확인해 주세요", !circles.length);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const edit = (i: number, patch: Partial<Cut>) => setCuts((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const assign = (i: number, id: string) => {
    const c = cuts[i];
    const f = festOf(id);
    if (f) {
      // 축제: 붉은 인주 + 깃발 테두리, 위는 축제 이름, 아래는 '2026 가을' 같은 해·계절
      edit(i, { placeId: id, done: false, festival: true, ink: INK_FEST, rare: false, top: f.name, bottom: f.season });
      return;
    }
    const p = placeOf(id);
    const back = c.festival ? { festival: false, ink: INK, top: "", bottom: "" } : {};
    edit(i, { placeId: id, done: false, ...back, top: (c.festival ? "" : c.top) || (p ? defaultTop(p.region, p.name) : "") });
  };

  async function make(c: Cut) {
    const color = await composeStamp({ art: c.art, top: c.top, bottom: c.bottom, ink: c.ink, rare: c.rare, festival: c.festival, size: 720 });
    return { color: await toWebp(color), bw: await toWebp(toBw(color)) };
  }

  async function publish(idx: number[]) {
    const todo = idx.filter((i) => cuts[i]?.placeId && !cuts[i].done);
    if (!todo.length) return toast("장소를 고른 도장이 없어요", true);
    if (!storeReady) return toast("저장소(R2) 연결이 필요해요", true);
    let ok = 0;
    for (const i of todo) {
      const c = cuts[i];
      const fest = isFest(c.placeId);
      const p = { id: c.placeId, name: nameOf(c.placeId) };
      setBusy(`${p.name} 올리는 중… (${ok + 1}/${todo.length})`);
      try {
        const { color, bw } = await make(c);
        // 서버가 판 번호와 R2 PUT 주소를 정해 준다 → 브라우저가 바로 올림 → 주소 저장
        const res = await uploadStamp({ id: p.id, festival: fest, color, bw });
        const a = { url: res.url };
        const b = { url: res.bwUrl };
        props.onSaved(p.id, { url: a.url, bwUrl: b.url, version: res.stampVersion }, res.version);
        edit(i, { done: true });
        ok++;
      } catch (e) {
        toast(`${p.name}: ${(e as Error).message}`, true);
        break;
      }
    }
    setBusy(null);
    if (ok) toast(`도장 ${ok}개를 올렸어요 · 폰·차는 다음 실행 때 바뀐 그림만 받아요`);
  }

  async function download(c: Cut) {
    try {
      const { color, bw } = await make(c);
      for (const [b, n] of [[color, `${c.placeId || "stamp"}.webp`], [bw, `${c.placeId || "stamp"}_bw.webp`]] as const) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = n;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const assigned = cuts.filter((c) => c.placeId && !c.done).length;

  return (
    <section>
      <div className="top">
        <h1>도장 올리기</h1>
        {sheetName ? <span className="ver">{sheetName} · 원 {cuts.length}개</span> : null}
        <div className="sp" />
        {busy ? <span className="row muted"><LoaderCircle className="spin" />{busy}</span> : null}
        <button className="btn ink" disabled={!!busy || !assigned || !storeReady} onClick={() => publish(cuts.map((_, i) => i))}>
          <UploadCloud />장소 고른 도장 {assigned ? `${assigned}개 ` : ""}모두 등록
        </button>
      </div>
      {focus ? (
        <div className="festnote">축제 <b style={{ margin: "0 2px" }}>{focus.name}</b> 한정 도장 만들기 · 시트를 올리면 첫 원이 이 축제로 채워져요 (붉은 인주·깃발 테두리, 아래 글씨 &lsquo;{focus.season}&rsquo;)</div>
      ) : null}
      {storeReady === false ? (
        <div className="hint warn" style={{ marginTop: 0, marginBottom: 12 }}>
          <CircleAlert size={14} style={{ verticalAlign: -2 }} /> <b>저장소(R2) 연결이 필요해요.</b> Cloudflare R2 버킷을 만들고 서버 환경 변수 <b>R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET · R2_PUBLIC_BASE</b>를 넣으면 등록할 수 있어요. 지금은 만들어 보기·내려받기만 돼요.
        </div>
      ) : null}
      <div className="up">
        <div className="card">
          <label className={`drop ${over ? "over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}>
            <ImagePlus size={28} />
            <b>ChatGPT 도장 시트를 끌어다 놓거나 눌러서 고르기</b>
            흰 바탕에 원형 그림 여러 개 · 브라우저가 원을 찾아 잘라요 (서버로 원본을 보내지 않아요)
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
          </label>
          <canvas ref={sheetRef} className="sheet" style={{ display: sheetName ? "block" : "none" }} />
          <div className="cuts">
            {cuts.map((c, i) => (
              <div key={i} className={`cut ${i === sel ? "on" : ""}`} onClick={() => setSel(i)}>
                <span className="no">{i + 1}</span>
                {c.done ? <span className="ok" title="등록함"><Check size={16} /></span> : null}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.art} alt="" />
                <select value={c.placeId} onChange={(e) => assign(i, e.target.value)} onClick={(e) => e.stopPropagation()}>
                  {options}
                </select>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>잉크 테두리 · 글씨 미리보기{cur ? ` · ${sel + 1}번` : ""}</h3>
          {cur ? (
            <>
              <div className="ringprev">
                <div>
                  {cur.preview
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img className="big" src={cur.preview} alt="" />
                    : <div className="big row" style={{ justifyContent: "center" }}><LoaderCircle /></div>}
                  {cur.previewBw ? (
                    <div className="row" style={{ marginTop: 6 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="bw" src={cur.previewBw} alt="" /><span className="muted" style={{ fontSize: 12 }}>흑백판 (안 찍은 칸)</span>
                    </div>
                  ) : null}
                </div>
                <div className="form" style={{ flex: 1, minWidth: 220, marginTop: 0 }}>
                  <div className="full"><label className="l">장소</label>
                    <select value={cur.placeId} onChange={(e) => assign(sel, e.target.value)}>
                      {options}
                    </select></div>
                  <div className="full"><label className="l">위 글씨 (지역 · 이름)</label>
                    <input value={cur.top} onChange={(e) => edit(sel, { top: e.target.value, done: false })} placeholder="대구 북구 · 침산공원" /></div>
                  <div className="full"><label className="l">{cur.festival ? "아래 글씨 (해·계절 — 예: 2026 가을)" : "아래 글씨 (한 줄 문구)"}</label>
                    <input value={cur.bottom} onChange={(e) => edit(sel, { bottom: e.target.value, done: false })} placeholder="언덕 위 정자에서 보는 노을" /></div>
                  <div><label className="l">잉크</label>
                    <select value={cur.ink} onChange={(e) => edit(sel, { ink: e.target.value, done: false })}>
                      <option value={INK}>기본 초록</option><option value={INK_GOLD}>희귀 금빛</option><option value={INK_FEST}>축제 붉은 인주</option>
                    </select></div>
                  <div><label className="l">테두리</label>
                    <select value={cur.festival ? "f" : cur.rare ? "1" : "0"} onChange={(e) => edit(sel, { rare: e.target.value === "1", festival: e.target.value === "f", done: false })}>
                      <option value="0">두 겹 (기본)</option><option value="1">세 겹 (희귀)</option><option value="f">축제 (붉은 테·깃발)</option>
                    </select></div>
                  <div className="full row" style={{ gap: 6 }}>
                    <button className="btn sm ink" disabled={!!busy || !cur.placeId || !storeReady || cur.done} onClick={() => publish([sel])}><UploadCloud />이 도장 등록</button>
                    <button className="btn sm soft" onClick={() => download(cur)}><Download />webp 내려받기</button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>시트를 올리면 잘라 낸 원마다 테두리·글씨를 둘러 보여 줘요.</p>
          )}
          <div className="hint">
            등록하면 <b>컬러·흑백 두 장</b>(720px webp)이 저장소(Cloudflare R2)에 올라가고, 그 장소의 <b>도장 판 번호</b>와 <b>목록 버전</b>이 올라가요.
            폰·차는 다음에 켤 때 <b>바뀐 그림만</b> 받아 기기에 저장해요. 인터넷이 없으면 저장해 둔 것, 그것도 없으면 앱에 넣어 둔 기본 그림을 써요.
            글꼴은 Gowun Batang(Google Fonts), 모양은 tools/stampgen과 같아요.
          </div>
        </div>
      </div>
    </section>
  );
}
