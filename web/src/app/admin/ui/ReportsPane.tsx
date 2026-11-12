"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, EyeOff, Megaphone, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
import type { AdminPost } from "@/lib/community";
import type { AdminPlace } from "@/lib/catalog-shape";
import { api, type Toast } from "./AdminApp";

const REASON: Record<string, string> = { spam: "광고·도배", abuse: "욕설·비하", privacy: "개인정보", child_safety: "아이 안전", other: "그 밖" };
const KIND: Record<string, string> = { stamp: "도장 자랑", trip: "다녀왔어요", tip: "한줄팁", notice: "운영팀" };

/** '함께' 신고 칸: 숨겨진 글(신고 3번·아이 안전 1번)·신고 들어온 글 → 복구/삭제, 그 가족 정지. 아래는 운영팀 글 올리기. */
export function ReportsPane({ places, toast }: { places: AdminPlace[]; toast: Toast }) {
  const [rows, setRows] = useState<AdminPost[] | null>(null);
  const [handles, setHandles] = useState<{ handle: string; banned: boolean; reasons: string[]; n: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pick, setPick] = useState<string[]>([]);

  const load = useCallback(() => {
    api<{ posts: AdminPost[]; handles?: typeof handles }>("GET", "/api/admin/community")
      .then((r) => { setRows(r.posts); setHandles(r.handles ?? []); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (id: string, action: "restore" | "remove" | "ban" | "unban", ask?: string) => {
    if (ask && !confirm(ask)) return;
    setBusy(id);
    try {
      await api("POST", `/api/admin/community/${id}`, { action });
      toast({ restore: "복구했어요", remove: "지웠어요", ban: "그 가족을 정지했어요", unban: "정지를 풀었어요" }[action]);
      load();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  };
  const postNotice = async () => {
    setBusy("notice");
    try {
      await api("POST", "/api/admin/community", { text, placeIds: pick });
      setText(""); setPick([]); toast("운영팀 글을 올렸어요"); load();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  };

  const flagged = (rows ?? []).filter((r) => !r.operator);
  const notices = (rows ?? []).filter((r) => r.operator && r.status !== "removed");
  return (
    <section>
      <div className="top"><h1>신고 · 함께</h1><span className="ver">숨겨진 글 {flagged.filter((r) => r.status === "hidden").length} · 신고 {flagged.reduce((n, r) => n + r.reportCount, 0)}</span></div>
      {err ? <div className="hint warn">{err}</div> : null}
      <div className="card">
        <h3 style={{ fontSize: 15, margin: "0 0 8px", display: "flex", gap: 6, alignItems: "center" }}><ShieldAlert size={16} />숨겨진 글 · 신고 들어온 글</h3>
        <div className="hint" style={{ marginTop: 0 }}>
          서로 다른 가족이 <b>3번</b> 신고하거나 <b>아이 안전</b>으로 <b>1번</b> 신고하면 글이 저절로 숨겨져요(정보통신망법 임시조치).
          확인 뒤 <b>복구</b>(신고 처리 끝) 또는 <b>삭제</b>. 반복되면 그 가족을 <b>정지</b> — 글이 모두 안 보이고 새로 못 올려요.
        </div>
        {rows === null ? <p className="muted">{err ? "" : "불러오는 중…"}</p> : flagged.length ? (
          <table>
            <thead><tr><th>상태</th><th>글</th><th>가족</th><th>신고</th><th /></tr></thead>
            <tbody>
              {flagged.map((r) => (
                <tr key={r.id} className={r.status === "removed" ? "off" : undefined}>
                  <td>{r.status === "hidden" ? <span className="tag"><EyeOff size={12} /> 숨김</span> : r.status === "removed" ? <span className="tag">삭제됨</span> : <span className="tag">보임</span>}</td>
                  <td style={{ maxWidth: 360 }}>
                    <div className="muted" style={{ fontSize: 12 }}>{KIND[r.kind] ?? r.kind}{r.placeName ? ` · ${r.placeName}` : ""} · {r.createdAt.slice(0, 10)}</div>
                    <div>{r.text || <span className="muted">(한마디 없음)</span>}</div>
                  </td>
                  <td>{r.handle ?? "–"}{r.banned ? <div className="muted" style={{ fontSize: 12 }}>정지됨</div> : null}</td>
                  <td>{r.reports.length ? r.reports.map((x) => `${REASON[x.reason] ?? x.reason} ${x.n}`).join(" · ") : <span className="muted">없음</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn sm line" disabled={busy === r.id} onClick={() => act(r.id, "restore")}><RotateCcw />복구</button>{" "}
                    <button className="btn sm line" disabled={busy === r.id || r.status === "removed"} onClick={() => act(r.id, "remove", "이 글을 지울까요?")}><Trash2 />삭제</button>{" "}
                    {r.banned
                      ? <button className="btn sm line" disabled={busy === r.id} onClick={() => act(r.id, "unban")}>정지 풀기</button>
                      : <button className="btn sm warn" disabled={busy === r.id} onClick={() => act(r.id, "ban", `${r.handle ?? "이 가족"}을(를) 정지할까요? 글이 모두 안 보이게 돼요.`)}><Ban />가족 정지</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ margin: 0 }}>숨겨진 글도, 처리할 신고도 없어요.</p>}
        {handles.length ? (
          <>
            <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>별명 신고</h3>
            <table>
              <tbody>{handles.map((h) => (
                <tr key={h.handle}><td><b>{h.handle}</b>{h.banned ? <span className="muted"> · 정지됨</span> : null}</td>
                  <td>{h.reasons.map((x) => REASON[x] ?? x).join(" · ")}</td><td>{h.n}번</td></tr>
              ))}</tbody>
            </table>
          </>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 8px", display: "flex", gap: 6, alignItems: "center" }}><Megaphone size={16} />운영팀 글</h3>
        <div className="hint" style={{ marginTop: 0 }}>가짜 가족이 아니라 <b>&lsquo;운영팀&rsquo; 표시</b>를 달고 올라가요. 이번 주 추천 코스·안내에 써 주세요 (140자).</div>
        <div className="form" style={{ display: "grid", gap: 8 }}>
          <textarea value={text} maxLength={140} rows={3} placeholder="비 오는 주말엔 실내 3곳 코스 — …" onChange={(e) => setText(e.target.value)} />
          <div className="chips">
            {places.slice(0, 40).map((p) => (
              <button key={p.id} type="button" className={`chip ${pick.includes(p.id) ? "on" : ""}`}
                onClick={() => setPick((xs) => (xs.includes(p.id) ? xs.filter((x) => x !== p.id) : xs.length < 5 ? [...xs, p.id] : xs))}>{p.name}</button>
            ))}
          </div>
          <div><button className="btn sm" disabled={!text.trim() || busy === "notice"} onClick={postNotice}><Megaphone />올리기</button> <span className="muted" style={{ fontSize: 12 }}>장소 {pick.length}/5 · {text.length}/140</span></div>
        </div>
        {notices.length ? (
          <table style={{ marginTop: 10 }}>
            <tbody>{notices.map((r) => (
              <tr key={r.id}><td className="muted" style={{ whiteSpace: "nowrap" }}>{r.createdAt.slice(0, 10)}</td><td>{r.text}</td>
                <td><button className="btn sm line" disabled={busy === r.id} onClick={() => act(r.id, "remove", "이 운영팀 글을 내릴까요?")}><Trash2 />내리기</button></td></tr>
            ))}</tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
