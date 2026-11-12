"use client";

/*
 * '할 일' 첫 화면 (시안 proto/admin-tour/redesign.html ①) — 들어오자마자 무엇을 해야 하는지.
 * 카드 4개(명소 확인 필요 · 꺼진 식당 초안 · 지난 축제 · 새 신고)는 누르면 그 조건으로 걸러진 표·목록으로.
 * '먼저 손볼 곳' = 최근 추천에 자주 나오는데(plans 카드) 빈 칸·확인 필요가 많은 곳 순 — 효과 큰 곳부터.
 * '이번 주' = 지난 7일 도장·가족·함께 글·AI 사용 + 날마다 막대(추천 만든 수 · 도장).
 */
import { useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import type { AdminPlace } from "@/lib/catalog-shape";
import type { FoodRestaurant } from "@/lib/restaurant-shape";
import type { TodoStats } from "@/lib/admin-todo";
import { festivalStatus, kstToday, type AdminFestival } from "@/lib/festival-shape";
import { completeness, isStale, vocabTags, META_FIELDS, type MetaField, type VocabWord } from "@/lib/place-attrs-shape";
import { api, type Tab, type Toast } from "./AdminApp";
import { FIELD_TEXT } from "./PlaceAttrs";
import { bulkFill, Ring } from "./admin-kit";

export type Go = (tab: Tab, o?: { view?: "edit" | "table"; filter?: string; id?: string }) => void;

const WD = ["일", "월", "화", "수", "목", "금", "토"];

/** 명소 한 곳 상태 (할 일 · 목록 · 표 공용). */
export function placeState(p: AdminPlace, vocab: readonly VocabWord[], today: string) {
  const comp = completeness({
    hours: p.openHours, closedDays: p.closedDays, closedRules: p.closedRules, parking: p.parking, price: p.price,
    facilities: p.facilities.filter((f) => f !== "주차장" && f !== "입장료 있음"), moments: p.moments,
    vocabTagCount: vocabTags(p.tags, vocab).length, regionCode: p.regionCode, intro: p.intro, meta: p.meta,
  });
  const checks = META_FIELDS.filter((f) => p.meta[f]?.check);
  const stale = META_FIELDS.filter((f) => !p.meta[f]?.check && isStale(p.meta[f], today));
  const drafts = Object.keys(p.aiDrafts).filter((k) => p.aiDrafts[k]);
  return { comp, pct: (comp.done / comp.total) * 100, checks, stale, drafts };
}

export function TodoPane(props: {
  places: AdminPlace[];
  restaurants: FoodRestaurant[];
  festivals: AdminFestival[];
  version: number;
  vocab: VocabWord[];
  stats: TodoStats | null;
  go: Go;
  toast: Toast;
  onFestivalsOff: (ids: string[], version: number | null) => void;
  onFilled: () => Promise<void>;
}) {
  const { places, stats, go } = props;
  const today = kstToday();
  const [filling, setFilling] = useState<string | null>(null);
  const [offBusy, setOffBusy] = useState(false);

  const st = useMemo(() => places.map((p) => ({ p, ...placeState(p, props.vocab, today) })), [places, props.vocab, today]);
  const needs = st.filter((x) => x.checks.length);
  const byField = META_FIELDS.map((f) => [f, needs.filter((x) => x.checks.includes(f)).length] as [MetaField, number]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const drafts = props.restaurants.filter((r) => !r.active);
  const noHours = drafts.filter((r) => !r.openHours.length).length;
  const ended = props.festivals.filter((f) => f.active && festivalStatus(f, today) === "ended");
  const aiDraftCount = st.reduce((a, x) => a + x.drafts.length, 0);

  // 먼저 손볼 곳: (최근 추천 + 1) × (확인 필요 1.5 + 빈 칸 1 + 오래됨 1 + 초안 0.5) — 켠 곳만
  const recs = stats?.recs ?? {};
  const rank = st
    .filter((x) => x.p.active)
    .map((x) => ({ ...x, rec: recs[x.p.id] ?? 0, score: ((recs[x.p.id] ?? 0) + 1) * (x.checks.length * 1.5 + x.comp.missing.length + x.stale.length + x.drafts.length * 0.5) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.rec - a.rec)
    .slice(0, 7);

  async function fillAll() {
    setFilling("시작하는 중…");
    try {
      const r = await bulkFill("place", { onProgress: setFilling });
      await props.onFilled();
      props.toast(r.stopped ? r.stopped : r.fields ? `${r.filled}곳에 AI 초안 ${r.fields}칸을 만들었어요${r.mock ? " (모의)" : ""} · 명소 표에서 보고 받아들이세요` : "새로 채울 칸이 없었어요", !!r.stopped);
    } catch (e) {
      props.toast((e as Error).message, true);
    } finally {
      setFilling(null);
    }
  }
  async function endFestivals() {
    if (!ended.length || !confirm(`끝난 축제 ${ended.length}개를 앱에서 끌까요? (지우지는 않아요)`)) return;
    setOffBusy(true);
    try {
      const r = await api<{ ids: string[]; version: number | null }>("POST", "/api/admin/festivals/ended");
      props.onFestivalsOff(r.ids, r.version);
      props.toast(`축제 ${r.ids.length}개를 껐어요${r.version ? ` · 목록 v${r.version}` : ""}`);
    } catch (e) {
      props.toast((e as Error).message, true);
    } finally {
      setOffBusy(false);
    }
  }

  const w = stats?.week;
  const maxDay = Math.max(1, ...(w?.days ?? []).map((d) => d.plans + d.stamps));
  const ai = stats?.ai;
  return (
    <section className="todo">
      <div className="top">
        <h1>오늘 할 일</h1>
        <span className="ver">목록 버전 v{props.version}</span>
        <div className="sp" />
        <button className="btn ai" disabled={!!filling || !stats?.aiReady} onClick={fillAll}
          title={stats?.aiReady ? "확인 필요·빈 칸을 관광공사 글·조사 원문에서 AI 초안으로 (진짜 칸은 그대로)" : "서버에 AI 키가 없어요"}>
          <Sparkles />{filling ? filling : "AI로 확인 필요 채우기"}{stats?.aiMock ? " (모의)" : ""}</button>
      </div>

      <div className="todocards">
        <button className={`card tc ${needs.length ? "warn" : ""}`} onClick={() => go("places", { view: "table", filter: "check" })}>
          <span className="k">명소 확인 필요</span>
          <b className="v">{needs.length}곳</b>
          <span className="s">{byField.length ? byField.slice(0, 4).map(([f, n]) => `${FIELD_TEXT[f]} ${n}`).join(" · ") : "모두 확인했어요"}</span>
          <span className="goto">확인하러 가기 <ArrowRight size={14} /></span>
        </button>
        <button className={`card tc ${drafts.length ? "warn" : ""}`} onClick={() => go("food", { filter: "draft" })}>
          <span className="k">꺼진 식당 초안</span>
          <b className="v">{drafts.length}곳</b>
          <span className="s">{drafts.length ? `카카오에서 가져옴 · 운영 시간 비어 있음 ${noHours}` : "초안이 없어요"}</span>
          <span className="goto">{drafts.length ? "AI로 채우고 켜기" : "맛집 보기"} <ArrowRight size={14} /></span>
        </button>
        <div className={`card tc ${ended.length ? "" : ""}`}>
          <span className="k">지난 축제</span>
          <b className="v">{ended.length}개</b>
          <span className="s">{ended.length ? `끝났는데 켜져 있어요 · ${ended.slice(0, 2).map((f) => f.name).join(", ")}${ended.length > 2 ? " …" : ""}` : "끝난 축제는 모두 꺼져 있어요"}</span>
          {ended.length
            ? <button className="goto linkbtn" disabled={offBusy} onClick={endFestivals}>{offBusy ? "끄는 중…" : "한꺼번에 끄기"} <ArrowRight size={14} /></button>
            : <button className="goto linkbtn" onClick={() => go("festivals")}>축제 보기 <ArrowRight size={14} /></button>}
        </div>
        <button className="card tc" onClick={() => go("reports")}>
          <span className="k">새 신고</span>
          <b className="v">{stats ? stats.reports.open : "–"}</b>
          <span className="s">{stats ? `숨겨진 글 ${stats.reports.hidden} · 운영팀 글 ${stats.reports.notices}` : "불러오는 중…"}</span>
          <span className="goto">신고 보기 <ArrowRight size={14} /></span>
        </button>
      </div>

      <div className="todotwo">
        <div className="card todolist">
          <div className="row"><b style={{ fontSize: 15 }}>먼저 손볼 곳</b><span className="muted" style={{ fontSize: 12 }}>많이 추천되는데 비어 있는 칸 순{stats ? ` · 최근 ${stats.recDays}일` : ""}</span>
            <div className="sp" />{aiDraftCount ? <button className="linkbtn" onClick={() => go("places", { view: "table", filter: "ai" })}>AI 초안 {aiDraftCount}칸 보기</button> : null}</div>
          {rank.map((x) => (
            <button key={x.p.id} className="trow" onClick={() => go("places", { view: "edit", id: x.p.id })}>
              <Ring pct={x.pct} />
              <b>{x.p.name}</b>
              <span className="tags">
                {x.checks.slice(0, 3).map((f) => <span key={f} className="tag w">{FIELD_TEXT[f]}</span>)}
                {x.comp.missing.filter((m) => !x.checks.some((f) => FIELD_TEXT[f] === m)).slice(0, x.checks.length ? 1 : 2).map((m) => <span key={m} className="tag">{m} 비었음</span>)}
                {x.drafts.length ? <span className="tag ai">AI 초안 {x.drafts.length}</span> : null}
                {x.stale.length ? <span className="tag r">90일 지남</span> : null}
              </span>
              <span className="tag rec">추천 {x.rec}번</span>
            </button>
          ))}
          {!rank.length ? <div className="muted" style={{ padding: "10px 0" }}>손볼 곳이 없어요. 모든 명소 칸이 차 있어요.</div> : null}
        </div>

        <div className="card week">
          <b style={{ fontSize: 15 }}>이번 주</b> <span className="muted" style={{ fontSize: 12 }}>지난 7일 · 데모 차 빼고</span>
          <div className="nums">
            <div><b>{w ? w.stamps : "–"}</b>도장</div>
            <div><b>{w ? w.families : "–"}</b>가족</div>
            <div><b>{w ? w.posts : "–"}</b>함께 글</div>
            <div title={ai?.byFeature.map((f) => `${f.feature} ${f.calls}번`).join(" · ")}>
              <b>{!ai ? "–" : !ai.tracked ? "—" : ai.krw != null ? `₩${ai.krw.toLocaleString()}` : `${ai.calls}번`}</b>AI 사용
              {ai?.tracked ? <small>{ai.tokens ? `글 ${Math.round(ai.tokens / 1000)}천 토큰` : ""}{ai.images ? ` · 그림 ${ai.images}장` : ""}{ai.failures ? ` · 실패 ${ai.failures}` : ""}</small> : ai ? <small>기록 표 없음</small> : null}
            </div>
          </div>
          {w && !w.plans && !w.stamps ? <div className="barsempty">지난 7일 동안 추천·도장이 없어요 (데모 차 빼고)</div> : null}
          <div className="bars" title="날마다 추천 만든 수(옅은 색) + 도장(진한 색)">
            {(w?.days ?? Array.from({ length: 7 }, (_, i) => ({ day: String(i), plans: 0, stamps: 0 }))).map((d, i, a) => (
              <div key={d.day} className={`bar ${i === a.length - 1 ? "on" : ""}`}>
                <span className="n">{d.plans + d.stamps || ""}</span>
                <i className="p" style={{ height: `${(d.plans / maxDay) * 100}%` }} />
                <i className="s" style={{ height: `${(d.stamps / maxDay) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="barlbl">{(w?.days ?? []).map((d) => <span key={d.day}>{WD[new Date(`${d.day}T00:00:00Z`).getUTCDay()]}</span>)}</div>
          <div className="legend"><i className="p" />추천 만든 수 <i className="s" />도장 {w ? `· 추천 ${w.plans}번` : ""}</div>
        </div>
      </div>
    </section>
  );
}
