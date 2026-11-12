"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Flame, House, LogOut, MapPin, MoreHorizontal, PartyPopper, ShieldAlert, Stamp, Utensils } from "lucide-react";
import type { AdminPlace } from "@/lib/catalog-shape";
import type { FoodRestaurant } from "@/lib/restaurant-shape";
import { festivalStatus, kstToday, type AdminFestival } from "@/lib/festival-shape";
import { FestivalsPane } from "./FestivalsPane";
import { PlacesPane } from "./PlacesPane";
import type { VocabWord } from "@/lib/place-attrs-shape";
import { StampsPane } from "./StampsPane";
import { FoodPane } from "./FoodPane";
import { OpsPane } from "./OpsPane";
import { ReportsPane } from "./ReportsPane";
import { PopularPane, type PopularRow, type Promote } from "./PopularPane";
import type { CuratedRow } from "@/lib/kto100-shape";
import type { TodoStats } from "@/lib/admin-todo";
import { META_FIELDS } from "@/lib/place-attrs-shape";
import { TodoPane, type Go } from "./TodoPane";

export type Tab = "todo" | "places" | "festivals" | "stamps" | "food" | "popular" | "reports" | "ops";
/** 할 일 → 걸러진 목록·표로 바로 (n이 바뀌면 다시 적용) */
export type PlacesIntent = { view: "edit" | "table"; filter?: string; id?: string; n: number };
export type FoodIntent = { filter?: string; n: number };
export type Toast = (text: string, err?: boolean) => void;

/** 서버 JSON 호출 (실패하면 서버가 준 한국어 문구로 throw). */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `서버 오류 (${res.status})`);
  return data as T;
}

export function AdminApp(props: {
  initialTab: Tab;
  initialPlace?: string;
  places: AdminPlace[];
  version: number;
  restaurants: FoodRestaurant[];
  stamps30: Record<string, number>;
  festivals: AdminFestival[];
  /** TourAPI 키(DATA_GO_KR_KEY)가 있으면 '가져오기' 버튼 */
  tourReady: boolean;
  /** 카카오 로컬 키가 서버에 있음 (식당 '카카오에서 근처 식당 가져오기'). */
  kakaoReady?: boolean;
  /** 태그 단어장 (명소 편집) */
  tagVocab: VocabWord[];
  /** 많이 고른 바깥 장소 · 한국관광 100선 표 (표가 아직 없으면 빈 목록) */
  popular: PopularRow[];
  kto100: CuratedRow[];
}) {
  const [tab, setTabRaw] = useState<Tab>(props.initialTab);
  const [more, setMore] = useState(false);
  const setTab = useCallback((t: Tab) => { setTabRaw(t); setMore(false); if (typeof window !== "undefined") window.scrollTo(0, 0); }, []);
  const [todo, setTodo] = useState<TodoStats | null>(null);
  const [placesIntent, setPlacesIntent] = useState<PlacesIntent | null>(props.initialPlace ? { view: "edit", id: props.initialPlace, n: 1 } : null);
  const [foodIntent, setFoodIntent] = useState<FoodIntent | null>(null);
  const refreshTodo = useCallback(() => {
    api<TodoStats>("GET", "/api/admin/todo").then(setTodo).catch(() => {});
  }, []);
  useEffect(() => { refreshTodo(); }, [refreshTodo]);
  const [places, setPlaces] = useState(props.places);
  const [version, setVersion] = useState(props.version);
  const [restaurants, setRestaurants] = useState(props.restaurants);
  const [festivals, setFestivals] = useState(props.festivals);
  // 도장 올리기에서 만들 축제 (축제 탭 '도장 올리기에서 만들기')
  const [stampFor, setStampFor] = useState<string | null>(null);
  // '많이 고른 곳' → '명소로 올리기' (명소 탭 '명소 추가'를 채워 연다)
  const [promote, setPromote] = useState<Promote | null>(null);
  const [storeReady, setStoreReady] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ ready: boolean }>("GET", "/api/admin/upload-url").then((r) => setStoreReady(r.ready)).catch(() => setStoreReady(false));
  }, []);
  const [toastMsg, setToastMsg] = useState<{ text: string; err: boolean; show: boolean }>({ text: "", err: false, show: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast: Toast = useCallback((text, err = false) => {
    setToastMsg({ text, err, show: true });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg((t) => ({ ...t, show: false })), err ? 3600 : 2400);
  }, []);

  const replacePlace = useCallback((p: AdminPlace) => setPlaces((xs) => {
    const i = xs.findIndex((x) => x.id === p.id);
    return i < 0 ? [...xs, p].sort((a, b) => a.id.localeCompare(b.id)) : xs.map((x) => (x.id === p.id ? p : x));
  }), []);

  const reloadPlaces = useCallback(async () => {
    const r = await api<{ places: AdminPlace[]; version: number }>("GET", "/api/admin/places");
    setPlaces(r.places);
    setVersion(r.version);
  }, []);
  const reloadFood = useCallback(async () => {
    const r = await api<{ restaurants: FoodRestaurant[] }>("GET", "/api/admin/restaurants");
    setRestaurants(r.restaurants);
  }, []);

  /** 할 일 카드·목록 → 걸러진 목록·표 */
  const go: Go = useCallback((t, o) => {
    if (t === "places") setPlacesIntent((x) => ({ view: o?.view ?? "table", filter: o?.filter, id: o?.id, n: (x?.n ?? 0) + 1 }));
    if (t === "food") setFoodIntent((x) => ({ filter: o?.filter, n: (x?.n ?? 0) + 1 }));
    setTab(t);
  }, [setTab]);

  const today = kstToday();
  const placeChecks = places.filter((p) => META_FIELDS.some((f) => p.meta[f]?.check)).length;
  const foodDrafts = restaurants.filter((r) => !r.active).length;
  const ended = festivals.filter((f) => f.active && festivalStatus(f, today) === "ended").length;
  const running = festivals.filter((f) => f.active && festivalStatus(f, today) === "running").length;
  const reportsOpen = todo ? todo.reports.open + todo.reports.hidden : 0;
  const NAV: { k: Tab; label: string; short?: string; icon: React.ReactNode; cnt?: number; warn?: boolean }[] = [
    { k: "todo", label: "할 일", icon: <House /> },
    { k: "places", label: "명소", icon: <MapPin />, cnt: placeChecks || undefined, warn: placeChecks > 0 },
    { k: "food", label: "맛집", icon: <Utensils />, cnt: foodDrafts || undefined, warn: foodDrafts > 0 },
    { k: "festivals", label: "축제·행사", short: "축제", icon: <PartyPopper />, cnt: ended || running || undefined, warn: ended > 0 },
    { k: "stamps", label: "도장 올리기", icon: <Stamp /> },
    { k: "popular", label: "많이 고른 곳·100선", icon: <Flame />, cnt: props.popular.length || undefined },
    { k: "reports", label: "신고", icon: <ShieldAlert />, cnt: reportsOpen || undefined, warn: reportsOpen > 0 },
    { k: "ops", label: "운영 현황", icon: <Activity /> },
  ];
  const TABBAR: Tab[] = ["todo", "places", "food", "festivals"];

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><div className="logo" /><div>마일스탬프<small>관리자</small></div></div>
        {NAV.map((n) => (
          <button key={n.k} className={`nav ${tab === n.k ? "on" : ""}`} onClick={() => setTab(n.k)}>
            {n.icon}{n.label}{n.cnt !== undefined ? <span className={`cnt ${n.warn ? "w" : ""}`}>{n.cnt}</span> : null}
          </button>
        ))}
        <form className="foot" method="post" action="/api/admin/logout">
          <button className="nav" type="submit"><LogOut />나가기</button>
        </form>
      </aside>
      <main className="main">
        {tab === "todo" && (
          <TodoPane places={places} restaurants={restaurants} festivals={festivals} version={version} vocab={props.tagVocab} stats={todo}
            go={go} toast={toast}
            onFestivalsOff={(ids, v) => { setFestivals((xs) => xs.map((x) => (ids.includes(x.id) ? { ...x, active: false } : x))); if (v) setVersion(v); }}
            onFilled={async () => { await reloadPlaces(); refreshTodo(); }} />
        )}
        {tab === "places" && (
          <PlacesPane places={places} version={version} stamps30={props.stamps30} initialPlace={props.initialPlace} storeReady={storeReady}
            promote={promote} onPromoteDone={() => setPromote(null)} vocab={props.tagVocab} tourReady={props.tourReady}
            intent={placesIntent} recs={todo?.recs ?? {}} aiReady={todo ? todo.aiReady : null} aiMock={!!todo?.aiMock}
            onReload={reloadPlaces}
            onSaved={(p, v) => { replacePlace(p); setVersion(v); }} toast={toast} />
        )}
        {tab === "festivals" && (
          <FestivalsPane festivals={festivals} places={places} version={version} tourReady={props.tourReady} storeReady={storeReady}
            onSaved={(f, v) => { setFestivals((xs) => (xs.some((x) => x.id === f.id) ? xs.map((x) => (x.id === f.id ? f : x)) : [...xs, f])); setVersion(v); }}
            onDeleted={(id, v) => { setFestivals((xs) => xs.filter((x) => x.id !== id)); setVersion(v); }}
            onMakeStamp={(id) => { setStampFor(id); setTab("stamps"); }}
            toast={toast} />
        )}
        {tab === "stamps" && (
          <StampsPane places={places} festivals={festivals} focusFestival={stampFor} version={version}
            onSaved={(id, stamp, v) => {
              if (festivals.some((f) => f.id === id)) setFestivals((xs) => xs.map((x) => (x.id === id ? { ...x, stamp } : x)));
              else setPlaces((xs) => xs.map((x) => (x.id === id ? { ...x, stamp, stampable: true } : x)));
              setVersion(v);
            }}
            toast={toast} />
        )}
        {tab === "food" && (
          <FoodPane places={places} restaurants={restaurants} version={version} kakaoReady={!!props.kakaoReady}
            intent={foodIntent} aiReady={todo ? todo.aiReady : null} aiMock={!!todo?.aiMock} onReload={reloadFood}
            onChange={(rs, v) => { setRestaurants(rs); setVersion(v); }} toast={toast} />
        )}
        {tab === "popular" && (
          <PopularPane popular={props.popular} kto100={props.kto100} places={places} tourReady={props.tourReady}
            onPromote={(p) => { setPromote(p); setTab("places"); }} toast={toast} />
        )}
        {tab === "reports" && <ReportsPane places={places} toast={toast} />}
        {tab === "ops" && <OpsPane />}
      </main>
      {/* 휴대폰: 아래 탭 5개 (할 일 · 명소 · 맛집 · 축제 · 더보기) */}
      <nav className="tabbar">
        {TABBAR.map((k) => {
          const n = NAV.find((x) => x.k === k)!;
          return (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {n.icon}<span>{n.short ?? n.label}</span>{n.cnt !== undefined && n.warn ? <i className="badge">{n.cnt > 99 ? "99+" : n.cnt}</i> : null}
            </button>
          );
        })}
        <button className={more || !TABBAR.includes(tab) ? "on" : ""} onClick={() => setMore(!more)}><MoreHorizontal /><span>더보기</span>{reportsOpen ? <i className="badge">{reportsOpen}</i> : null}</button>
      </nav>
      {more ? (
        <div className="moresheet" onClick={() => setMore(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            {NAV.filter((n) => !TABBAR.includes(n.k)).map((n) => (
              <button key={n.k} className={`nav ${tab === n.k ? "on" : ""}`} onClick={() => setTab(n.k)}>
                {n.icon}{n.label}{n.cnt !== undefined ? <span className={`cnt ${n.warn ? "w" : ""}`}>{n.cnt}</span> : null}
              </button>
            ))}
            <form method="post" action="/api/admin/logout"><button className="nav" type="submit"><LogOut />나가기</button></form>
          </div>
        </div>
      ) : null}
      <div className={`toast ${toastMsg.show ? "show" : ""} ${toastMsg.err ? "err" : ""}`}>{toastMsg.text}</div>
    </div>
  );
}

/** 도장 그림 주소: 관리자에서 올린 것, 없으면 웹에 넣어 둔 기본 그림. */
export function stampSrc(p: Pick<AdminPlace, "id" | "stamp">): string {
  return p.stamp.url ?? `/stamps/${p.id}.webp`;
}
