"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { OpsStats } from "@/lib/catalog";
import { api } from "./AdminApp";

/** 운영 현황 (이번 주 = 한국 시각 월요일 0시부터, 데모 차 빼고). */
export function OpsPane() {
  const [s, setS] = useState<OpsStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<OpsStats>("GET", "/api/admin/ops").then(setS).catch((e: Error) => setErr(e.message));
  }, []);
  return (
    <section>
      <div className="top"><h1>운영 현황</h1><span className="ver">이번 주 · 데모 차 빼고</span></div>
      {err ? <div className="hint warn">{err}</div> : null}
      <div className="kpis">
        <div className="kpi"><b>{s ? s.weekStamps : "–"}</b><span>이번 주 찍힌 도장</span>{s?.weekStampsDemo ? <small>데모 차 {s.weekStampsDemo}개 따로</small> : null}</div>
        <div className="kpi"><b>{s ? s.weekCars : "–"}</b><span>이번 주 도장 찍은 가족</span></div>
        <div className="kpi"><b>{s ? s.weekChosen : "–"}</b><span>코스를 고른 가족</span>{s ? <small>추천 {s.plansWeek}번 만듦</small> : null}</div>
        <div className="kpi"><b>{s ? s.cars : "–"}</b><span>연결된 차</span>{s ? <small>가족 폰 {s.phones}대</small> : null}</div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>최근 30일 도장 많은 곳</h3>
        {s && s.topPlaces.length ? (
          <table>
            <thead><tr><th>장소</th><th>도장 (데모 포함)</th></tr></thead>
            <tbody>{s.topPlaces.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.n}</td></tr>)}</tbody>
          </table>
        ) : <p className="muted" style={{ margin: 0 }}>{s ? "아직 찍힌 도장이 없어요." : "불러오는 중…"}</p>}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 8px", display: "flex", gap: 6, alignItems: "center" }}><ShieldCheck size={16} />보류된 도장 (위조 의심)</h3>
        <div className="hint" style={{ marginTop: 0 }}>
          <b>보류 기록은 다음 단계</b>예요. 지금 차는 보류(주행거리 검증 실패)를 차 화면에만 보여 주고 서버에 보내지 않아요.
          차가 &lsquo;held&rsquo; 소식을 보내기 시작하면 여기서 이유와 함께 보고 &lsquo;인정하기&rsquo;를 누를 수 있게 할게요.
        </div>
      </div>
    </section>
  );
}
