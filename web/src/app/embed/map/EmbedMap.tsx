"use client";

// 지도 페이지 몸통: 카카오 → 안 되면 Leaflet 으로 지도를 만들고, window.msMap 으로 앱의 지시를 받는다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { initFromHash, LONGPRESS_MS, LONGPRESS_SLOP, parseInit, parsePolylines, toLatLng, type EmbedInit, type EmbedOut, type Polyline } from "@/lib/map-embed";
import { loadMapLib } from "@/lib/map-loaders";
import { kakaoEngine, leafletEngine, type Engine } from "./engines";

type MsMap = {
  engine: "kakao" | "leaflet";
  init(raw: unknown): void;
  setPos(lat: number, lng: number): void;
  select(id: string | null): void;
  setPolylines(lines: unknown): void;
  setMark(lat: number | null, lng?: number, move?: boolean): void;
};

/** 앱으로 보내기. 앱 밖(브라우저)에서는 window.__msLog 에 쌓아 둔다 (시험·캡처용) */
function post(m: EmbedOut) {
  const w = window as any;
  if (w.ReactNativeWebView?.postMessage) w.ReactNativeWebView.postMessage(JSON.stringify(m));
  (w.__msLog ??= []).push(m);
}

/** '시간 보기' 켬/끔은 이 폰(WebView 저장소)에 기억 */
const CHIPS_KEY = "msmap.legTime";
const readChips = () => { try { return localStorage.getItem(CHIPS_KEY) === "1"; } catch { return false; } };
const saveChips = (on: boolean) => { try { localStorage.setItem(CHIPS_KEY, on ? "1" : "0"); } catch { /* 저장 못 해도 지금 화면은 그대로 */ } };
/** 단추를 보일까: 코스 지도(큰 것)이고 구간 시간이 하나라도 있을 때 */
const wantsTimeBtn = (cfg: EmbedInit | null, ls: Polyline[]) => cfg?.mode === "route" && !cfg.compact && ls.some((l) => l.min != null);

const CLOCK = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);

export function EmbedMap() {
  const el = useRef<HTMLDivElement>(null);
  const engRef = useRef<Engine | null>(null);
  const [engine, setEngine] = useState<"kakao" | "leaflet" | null>(null);
  const [dark, setDark] = useState(false);
  const [route, setRoute] = useState(false);
  const [timeBtn, setTimeBtn] = useState(false);
  const [chips, setChips] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let eng: Engine | null = null;
    let make: (() => Engine) | null = null;
    let cur: EmbedInit | null = null;
    const onResize = () => eng?.relayout();
    window.addEventListener("resize", onResize);

    // 길게 누름 (init longpress:true): 손가락 하나로 0.55초, 10px 넘게 움직이거나 두 손가락이면 취소.
    // 지도 엔진과 상관없이 상자에서 잡고(capture), 화면 점 → 좌표는 엔진이 바꾼다.
    let lp: { t: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
    const lpStop = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
    const lpDown = (e: PointerEvent) => {
      lpStop();
      if (!cur?.longpress || !e.isPrimary || !el.current) return;
      const box = el.current, x = e.clientX, y = e.clientY;
      lp = {
        x, y, t: setTimeout(() => {
          lp = null;
          const r = box.getBoundingClientRect();
          const p = eng?.pointToLatLng(x - r.left, y - r.top);
          if (!p) return;
          eng?.setMark(p, false);
          post({ type: "longpress", lat: p[0], lng: p[1] });
        }, LONGPRESS_MS),
      };
    };
    const lpMove = (e: PointerEvent) => {
      if (!lp) return;
      if (!e.isPrimary || Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONGPRESS_SLOP) lpStop();
    };
    const box0 = el.current;
    box0?.addEventListener("pointerdown", lpDown, true);
    box0?.addEventListener("pointermove", lpMove, true);
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) box0?.addEventListener(ev, lpStop, true);
    const noMenu = (e: Event) => { if (cur?.longpress) e.preventDefault(); };
    box0?.addEventListener("contextmenu", noMenu, true);

    loadMapLib().then((lib) => {
      if (dead || !el.current) return;
      const box = el.current;
      make = lib.engine === "kakao" ? () => kakaoEngine(lib.kakao, box, post) : () => leafletEngine(lib.L, box, post);
      setEngine(lib.engine);
      const start = (cfg: EmbedInit) => {
        eng?.destroy();
        cur = cfg;
        setDark(cfg.dark);
        setRoute(cfg.mode === "route");
        eng = make!();
        engRef.current = eng;
        const on = readChips();
        setChips(on);
        eng.setChips(on);
        eng.init(cfg);
        setTimeBtn(wantsTimeBtn(cfg, cfg.polylines));
      };
      const api: MsMap = {
        engine: lib.engine,
        init(raw) {
          const cfg = parseInit(raw);
          if (!cfg) { post({ type: "error", message: "지도 설정 모양이 틀렸어요" }); return; }
          start(cfg);
        },
        setPos(lat, lng) { const p = toLatLng([lat, lng]); if (p) eng?.setPos(p); },
        select(id) { eng?.select(typeof id === "string" ? id : null); },
        setPolylines(lines) {
          const ls = parsePolylines(lines);
          eng?.setPolylines(ls);
          setTimeBtn(wantsTimeBtn(cur, ls));
        },
        setMark(lat, lng, move) {
          if (lat == null) { eng?.setMark(null, false); return; }
          const p = toLatLng([lat, lng]);
          if (p) eng?.setMark(p, move === true);
        },
      };
      (window as any).msMap = api;
      post({ type: "ready", engine: lib.engine });
      const fromHash = initFromHash(location.hash);
      if (fromHash) start(fromHash);
    }).catch(() => {
      if (dead) return;
      setErr("지도를 불러오지 못했어요 · 인터넷 연결을 확인해 주세요");
      post({ type: "error", message: "지도를 불러오지 못했어요" });
    });

    return () => {
      dead = true;
      lpStop();
      box0?.removeEventListener("pointerdown", lpDown, true);
      box0?.removeEventListener("pointermove", lpMove, true);
      for (const ev of ["pointerup", "pointercancel", "pointerleave"]) box0?.removeEventListener(ev, lpStop, true);
      box0?.removeEventListener("contextmenu", noMenu, true);
      window.removeEventListener("resize", onResize);
      eng?.destroy();
      engRef.current = null;
    };
  }, []);

  const toggleChips = () => {
    const on = !chips;
    setChips(on);
    saveChips(on);
    engRef.current?.setChips(on);
  };

  return (
    <div className={`msmap${dark ? " dark" : ""}${route ? " route" : ""}${engine ? ` ${engine}` : ""}`}>
      <div ref={el} style={{ position: "absolute", inset: 0, zIndex: 0 }} />
      {timeBtn ? (
        <button type="button" className="tbtn" aria-pressed={chips} onClick={toggleChips}>
          {CLOCK}{chips ? "시간 숨기기" : "시간 보기"}
        </button>
      ) : null}
      {err ? <div className="err" role="alert">{err}</div> : null}
    </div>
  );
}
