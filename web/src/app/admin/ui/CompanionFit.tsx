"use client";

import { COMPANION_TAG_CHOICES, COMPANION_TEXT, COMPANIONS, type Companion } from "@/lib/planner";
import type { FitView } from "@/lib/companion-shape";

/**
 * 누구랑 가요? — 동행 적합도 막대 4개(아이와 = 아이 적합도) + 분위기 표시 칩. 명소·축제 편집 화면이 같이 쓴다.
 * 표시 칩은 분위기 표시만 켜고 끄고, 조사에서 온 다른 표시(역사·강 …)는 그대로 둔다.
 */
export function CompanionFit(props: {
  kidFit: number;
  fit: FitView;
  tags: string[];
  /** 명소는 단어장 태그 칸에서 고르므로 분위기 칩을 숨김 */
  hideTags?: boolean;
  onChange: (v: { kidFit?: number; fit?: FitView; tags?: string[] }) => void;
}) {
  const { kidFit, fit, tags, onChange } = props;
  const value = (c: Companion) => (c === "kids" ? kidFit : fit[c]);
  const set = (c: Companion, v: number) => {
    const x = Math.round(v * 100) / 100;
    if (c === "kids") onChange({ kidFit: x, fit: { ...fit, kids: x } });
    else onChange({ fit: { ...fit, kids: kidFit, [c]: x } });
  };
  const toggle = (t: string) => onChange({ tags: tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t] });
  return (
    <>
      <div className="full"><label className="l">누구랑 가기 좋아요? (0~1 · 아이와 = 아이 적합도)</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {COMPANIONS.map((c) => (
            <label key={c} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ minWidth: 64 }}>{COMPANION_TEXT[c]}</span>
              <input type="range" min={0} max={1} step={0.05} value={value(c)} onChange={(e) => set(c, Number(e.target.value))} style={{ flex: 1 }} />
              <span className="muted" style={{ minWidth: 32, textAlign: "right" }}>{value(c).toFixed(2)}</span>
            </label>
          ))}
        </div></div>
      {props.hideTags ? null : <div className="full"><label className="l">분위기 표시 (연인 야경·데이트 · 친구 액티비티·체험 · 혼자 조용함·전시에 가점)</label>
        <div className="chips">
          {COMPANION_TAG_CHOICES.map((t) => (
            <button key={t} className={`chip ${tags.includes(t) ? "on" : ""}`} onClick={() => toggle(t)}>{t}</button>
          ))}
        </div></div>}
    </>
  );
}
