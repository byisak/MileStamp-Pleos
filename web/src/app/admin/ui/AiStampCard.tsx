"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, History, Image as ImageIcon, LoaderCircle, RefreshCw, Sparkles, Stamp, UploadCloud, Wand2 } from "lucide-react";
import type { StampRef } from "@/lib/catalog-shape";
import { api, type Toast } from "./AdminApp";
import { INK, INK_FEST, composeStamp, cutSingle, toBw, toWebp } from "./stampcraft";
import { uploadStamp } from "./stamp-upload";

/** 서버 lib/ai-stamp-jobs AiJob과 같은 모양 (클라이언트라 따로 적음). */
type Job = {
  id: string;
  purpose: "stamp" | "background";
  scene: string;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  candidates: { url: string }[];
  chosen: number | null;
  nImages: number;
  mode: string | null;
  model: string | null;
  mock: boolean;
  createdAt: string;
  finishedAt: string | null;
};
type Info = {
  jobs: Job[];
  sceneKo: string;
  sceneEn: string;
  fromResearch: boolean;
  used: number;
  limit: number;
  keyReady: boolean;
  mock: boolean;
  r2: boolean;
  balance: { amount: number; currency: string } | null;
  gateway: string;
  bgUrl: string | null;
  /** 기본 모델 (안 고르면 서버가 쓰는 것) */
  model: string | null;
  /** 게이트웨이 그림 모델 목록 */
  models: string[];
};
type Craft = { idx: number; art: string; found: boolean; top: string; bottom: string; preview?: string; previewBw?: string; key?: string };

const MODE_LABEL: Record<string, string> = { edit: "참고 그림 3장", generate: "글로만(참고 그림 없이)", mock: "모의" };
const kstTime = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const running = (j: Job | null) => !!j && (j.status === "queued" || j.status === "running");
/** 고른 모델은 이 브라우저에 기억 (명소를 옮겨 다녀도 그대로) */
const MODEL_KEY = "milestamp.aiStampModel";

/**
 * 'AI로 도장 만들기' 카드 (명소·축제 편집 화면). docs/AI-도장-계획.md — 자동 검사 없이:
 * 장면 문장 → 후보 4장(2초마다 확인) → 고르기 → 기존 stampcraft(원 찾기·자르기·잉크 테두리·글씨·흑백판) → 앱 크기 미리보기 → 등록(R2).
 */
export function AiStampCard(props: {
  kind: "place" | "festival";
  id: string;
  name: string;
  /** 테두리 위·아래 글씨 처음 값 */
  top: string;
  bottom: string;
  /** 도장북 묶음 이름 (미리보기 글) */
  album?: string;
  storeReady: boolean | null;
  onStampSaved: (stamp: StampRef, version: number) => void;
  toast: Toast;
}) {
  const { kind, id, toast } = props;
  const festival = kind === "festival";
  const [info, setInfo] = useState<Info | null>(null);
  const [scene, setScene] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [bgJob, setBgJob] = useState<Job | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [craft, setCraft] = useState<Craft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [model, setModel] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<Info>("GET", `/api/admin/ai-stamp?target=${kind}:${encodeURIComponent(id)}`);
      setInfo(r);
      setLoadErr(null);
      return r;
    } catch (e) {
      setLoadErr((e as Error).message);
      return null;
    }
  }, [kind, id]);

  // 처음(대상마다 key로 새로 그림): 장면 문장 = 조사 묘사, 마지막 후보 작업을 다시 보여 줌
  useEffect(() => {
    api<Info>("GET", `/api/admin/ai-stamp?target=${kind}:${encodeURIComponent(id)}`).then((r) => {
      setInfo(r);
      setScene(r.sceneEn);
      const saved = localStorage.getItem(MODEL_KEY) ?? "";
      setModel(r.models.includes(saved) ? saved : "");
      const last = r.jobs.find((j) => j.purpose === "stamp");
      if (last) { setJob(last); setSel(last.chosen); }
      const bg = r.jobs.find((j) => j.purpose === "background");
      if (bg && running(bg)) setBgJob(bg);
    }).catch((e: Error) => setLoadErr(e.message));
  }, [kind, id]);

  // 진행 중인 작업 2초마다 확인 + 걸린 시간
  useEffect(() => {
    const live = [job, bgJob].filter(running) as Job[];
    if (!live.length) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      for (const j of live) {
        try {
          const r = await api<{ job: Job }>("GET", `/api/admin/ai-stamp/${j.id}`);
          if (running(r.job)) continue;
          if (r.job.purpose === "background") {
            setBgJob(r.job);
            if (r.job.status === "done") toast("배경을 만들었어요 · 이 명소에 저장했어요");
          } else {
            setJob(r.job);
            setSel(null);
            if (r.job.status === "done") toast(`후보 ${r.job.candidates.length}장이 왔어요 · 마음에 드는 걸 골라 주세요`);
          }
          if (r.job.status === "failed") toast(r.job.error ?? "만들지 못했어요", true);
          load();
        } catch { /* 다음 차례에 다시 */ }
      }
    }, 2000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [job, bgJob, load, toast]);

  async function start(purpose: "stamp" | "background", text = scene) {
    try {
      const r = await api<{ jobId: string }>("POST", "/api/admin/ai-stamp", { kind, id, scene: text, purpose, model: model || undefined });
      const fresh: Job = { id: r.jobId, purpose, scene: text, status: "queued", error: null, candidates: [], chosen: null, nImages: 0, mode: null, model: model || info?.model || null, mock: !!info?.mock, createdAt: new Date().toISOString(), finishedAt: null };
      setNow(Date.now());
      if (purpose === "background") setBgJob(fresh);
      else { setJob(fresh); setSel(null); setCraft(null); }
      load();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  // 고른 후보 → 원 찾기·자르기 (서버를 거친 같은 주소로 읽어 캔버스가 막히지 않게)
  async function makeStamp() {
    if (!job || sel === null) return;
    setBusy("원을 찾아 자르는 중…");
    try {
      const { art, found } = await cutSingle(`/api/admin/ai-stamp/${job.id}/image?n=${sel}`);
      setCraft({ idx: sel, art, found, top: props.top, bottom: props.bottom });
      if (!found) toast("원을 또렷이 못 찾아 가운데 큰 원으로 잘랐어요 · 미리보기를 확인해 주세요", true);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  // 글씨가 바뀌면 0.3초 뒤 미리보기 다시
  useEffect(() => {
    if (!craft) return;
    const key = JSON.stringify([craft.art.length, craft.idx, craft.top, craft.bottom]);
    if (craft.key === key) return;
    const c = craft;
    const t = setTimeout(async () => {
      try {
        const color = await composeStamp({ art: c.art, top: c.top, bottom: c.bottom, ink: festival ? INK_FEST : INK, festival, size: 520 });
        const bw = toBw(color);
        setCraft((x) => (x && x.art === c.art ? { ...x, preview: color.toDataURL(), previewBw: bw.toDataURL(), key } : x));
      } catch (e) {
        toast((e as Error).message, true);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [craft, festival, toast]);

  async function register() {
    if (!craft || !job) return;
    setBusy("올리는 중…");
    try {
      const color = await composeStamp({ art: craft.art, top: craft.top, bottom: craft.bottom, ink: festival ? INK_FEST : INK, festival, size: 720 });
      const res = await uploadStamp({ id, festival, color: await toWebp(color), bw: await toWebp(toBw(color)) });
      await api("PATCH", `/api/admin/ai-stamp/${job.id}`, { chosen: craft.idx }).catch(() => {});
      props.onStampSaved({ url: res.url, bwUrl: res.bwUrl, version: res.stampVersion }, res.version);
      toast(`도장을 등록했어요 (판 v${res.stampVersion}) · 폰·차는 다음 실행 때 받아요`);
      load();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const blocked = info && !info.mock ? (!info.keyReady ? "이미지 AI 키가 설정되지 않았어요" : !info.r2 ? "저장소(R2) 연결이 필요해요" : info.balance && info.balance.amount <= 0 ? "이미지 AI 잔액이 없어요 · 게이트웨이에서 충전해 주세요" : info.used + 4 > info.limit ? `오늘 만들 수 있는 그림을 다 썼어요 (${info.used}/${info.limit}장)` : null) : null;
  const elapsed = (j: Job) => Math.max(0, Math.round((now - new Date(j.createdAt).getTime()) / 1000));
  const bgUrl = bgJob?.status === "done" ? bgJob.candidates[0]?.url : info?.bgUrl;

  return (
    <div className="card aicard">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <h3 className="aih"><Sparkles />AI로 도장 만들기</h3>
        <div className="sp" />
        {info ? (
          <span className="aimeta">
            {info.mock ? <b className="mock">모의 모드 (AI_IMAGE_MOCK)</b> : <>{info.gateway}</>}
            {" · "}오늘 {info.used}/{info.limit}장
            {info.balance ? <> · 잔액 <b className={info.balance.amount <= 0 ? "neg" : ""}>{info.balance.currency === "KRW" ? won(info.balance.amount) : `${info.balance.amount} ${info.balance.currency}`}</b></> : null}
          </span>
        ) : null}
      </div>
      {loadErr ? <div className="hint warn"><CircleAlert size={13} style={{ verticalAlign: -2 }} /> {loadErr}</div> : null}
      {blocked ? <div className="hint warn"><CircleAlert size={13} style={{ verticalAlign: -2 }} /> <b>{blocked}</b>{!info?.keyReady ? " — 서버 환경 변수 AI_API_KEY(게이트웨이 키)를 넣고 다시 배포하면 켜져요." : ""}</div> : null}

      <div className="aigrid">
        <div>
          <label className="l">장면 문장 (그림 AI에 보내요 · 영어 권장, 한국어도 돼요)</label>
          <textarea className="fld" rows={4} value={scene} onChange={(e) => setScene(e.target.value)} placeholder="A traditional pavilion on a hilltop…" />
          {info ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
              {info.fromResearch ? "조사 묘사" : "자동 문장"}: {info.sceneKo}
              {scene !== info.sceneEn ? <> · <button className="linkbtn" onClick={() => setScene(info.sceneEn)}>처음 문장으로</button></> : null}
            </div>
          ) : null}
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            그림체·원 하나·흰 바탕·초록 테와 금지 사항(글자·숫자·사람·가족 실루엣·남산타워·빨강흰 줄무늬 탑·글씨 같은 무늬·가장자리 그림)은 서버가 붙여요.
          </div>
          {info && !info.mock && info.keyReady ? (
            <div style={{ marginTop: 10 }}>
              <label className="l" htmlFor={`aimodel-${id}`}>그림 모델 (게이트웨이 {info.gateway}에서 받은 목록)</label>
              <select id={`aimodel-${id}`} className="fld" value={model}
                onChange={(e) => { setModel(e.target.value); localStorage.setItem(MODEL_KEY, e.target.value); }}>
                <option value="">기본값{info.model ? ` · ${info.model}` : ""}</option>
                {info.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {info.models.length ? "값·그림체가 모델마다 달라요. 기존 도장과 그림체가 맞는 건 gpt-image 계열이에요." : "게이트웨이에서 모델 목록을 못 받았어요 · 기본값으로 만들어요"}
              </div>
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn ink" disabled={!!blocked || running(job) || scene.trim().length < 8} onClick={() => start("stamp")}><Wand2 />후보 4장 만들기</button>
            {job && !running(job) ? (
              <button className="btn soft" disabled={!!blocked} onClick={() => { setScene(job.scene); start("stamp", job.scene); }}><RefreshCw />같은 장면으로 다시</button>
            ) : null}
            {kind === "place" ? (
              <button className="btn line" disabled={!!blocked || running(bgJob)} onClick={() => start("background")}><ImageIcon />배경(9:16) 만들기</button>
            ) : null}
          </div>

          {running(job) ? (
            <div className="aiprog">
              <LoaderCircle className="spin" />
              <div style={{ flex: 1 }}>
                <b>후보 4장 만드는 중… {elapsed(job!)}초{job!.model ? ` · ${job!.model}` : ""}</b>
                <div className="bar"><i style={{ width: `${Math.min(95, (elapsed(job!) / 75) * 100)}%` }} /></div>
                <span className="muted" style={{ fontSize: 12 }}>보통 30~90초 · 이 화면을 떠나도 서버가 계속 만들어요</span>
              </div>
            </div>
          ) : null}
          {job?.status === "failed" ? <div className="hint warn"><CircleAlert size={13} style={{ verticalAlign: -2 }} /> {job.error}</div> : null}

          {job?.status === "done" ? (
            <>
              <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                {kstTime(job.createdAt)} · {MODE_LABEL[job.mode ?? ""] ?? job.mode}{job.model ? ` · ${job.model}` : ""} · 눌러서 고르기
              </div>
              <div className="aicands">
                {job.candidates.map((c, i) => (
                  <button key={i} className={`aicand ${sel === i ? "on" : ""}`} onClick={() => { setSel(i); }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.url} alt={`후보 ${i + 1}`} />
                    <span className="no">{i + 1}</span>
                    {sel === i ? <span className="ok"><Check size={14} /></span> : null}
                    {job.chosen === i ? <span className="used">등록함</span> : null}
                  </button>
                ))}
              </div>
              <button className="btn ink" style={{ marginTop: 10 }} disabled={sel === null || !!busy} onClick={makeStamp}><Stamp />이 그림으로 도장 만들기</button>
            </>
          ) : null}

          {kind === "place" && (running(bgJob) || bgUrl || bgJob?.status === "failed") ? (
            <div className="aibg">
              <div className="bgbox">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {running(bgJob) ? <LoaderCircle className="spin" /> : bgUrl ? <img src={bgUrl} alt="배경" /> : <CircleAlert />}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--sub)", lineHeight: 1.5 }}>
                <b>도장 획득 화면 배경 (9:16)</b><br />
                {running(bgJob) ? <>만드는 중… {elapsed(bgJob!)}초</> : bgJob?.status === "failed" ? bgJob.error : <>저장됨 · 앱 목록엔 아직 안 보내요</>}
              </div>
            </div>
          ) : null}
        </div>

        <div>
          {craft ? (
            <>
              <div className="ringprev">
                <div>
                  {craft.preview
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img className="big" src={craft.preview} alt="" />
                    : <div className="big row" style={{ justifyContent: "center" }}><LoaderCircle className="spin" /></div>}
                </div>
                <div className="form" style={{ flex: 1, minWidth: 200, marginTop: 0, gridTemplateColumns: "1fr" }}>
                  <div><label className="l">{festival ? "위 글씨 (축제 이름)" : "위 글씨 (지역 · 이름)"}</label>
                    <input value={craft.top} onChange={(e) => setCraft({ ...craft, top: e.target.value })} /></div>
                  <div><label className="l">{festival ? "아래 글씨 (해·계절 — 예: 2026 가을)" : "아래 글씨 (한 줄 문구)"}</label>
                    <input value={craft.bottom} onChange={(e) => setCraft({ ...craft, bottom: e.target.value })} placeholder="언덕 위 정자에서 보는 노을" /></div>
                </div>
              </div>
              <h4 className="aisub">앱 크기로 보기</h4>
              <div className="aisizes">
                <div className="book">
                  <div className="cells">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {craft.preview ? <img src={craft.preview} alt="" /> : <span />}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {craft.previewBw ? <img src={craft.previewBw} alt="" className="dim" /> : <span />}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {craft.previewBw ? <img src={craft.previewBw} alt="" className="dim" /> : <span />}
                  </div>
                  <span>도장북 칸 · 찍음 / 안 찍음(흑백)</span>
                </div>
                <div className="medal mini">
                  {craft.preview ? <div className="bg" style={{ backgroundImage: `url(${craft.preview})` }} /> : null}
                  <div className="shade" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {craft.preview ? <img className="coin" src={craft.preview} alt="" /> : null}
                  <div className="pill"><Stamp size={13} />도장 획득!</div>
                  <div className="info"><small>{festival ? "기간 한정 도장" : "NEW STAMP"}</small><b>{props.name}</b>{props.album ? <span>{props.album}</span> : null}</div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn ink" disabled={!!busy || !craft.preview || !props.storeReady} onClick={register}><UploadCloud />등록</button>
                {busy ? <span className="row muted"><LoaderCircle className="spin" />{busy}</span> : null}
              </div>
              {props.storeReady === false ? (
                <div className="hint warn"><CircleAlert size={13} style={{ verticalAlign: -2 }} /> 저장소(R2) 연결 전이라 등록은 꺼져 있어요. 미리보기까지만 돼요.</div>
              ) : (
                <div className="hint">등록하면 &lsquo;도장 올리기&rsquo;와 같이 <b>컬러·흑백 720px webp</b>가 R2에 올라가고 도장 판·목록 버전이 +1 돼요.</div>
              )}
            </>
          ) : (
            <div className="aiempty">
              <Stamp size={26} />
              <span>후보를 고르고 &lsquo;이 그림으로 도장 만들기&rsquo;를 누르면<br />잉크 테두리·글씨를 둘러 여기 보여 줘요</span>
            </div>
          )}
        </div>
      </div>

      {info && info.jobs.length ? (
        <div className="aihist">
          <h4 className="aisub"><History />기록</h4>
          {info.jobs.map((j) => (
            <button key={j.id} className={`hrow ${job?.id === j.id ? "on" : ""}`} disabled={j.purpose !== "stamp" || j.status !== "done"}
              onClick={() => { setJob(j); setSel(j.chosen); setCraft(null); setScene(j.scene); }}>
              <span className="t">{kstTime(j.createdAt)}</span>
              <span className={`st st-${j.status}`}>{j.status === "done" ? "완료" : j.status === "failed" ? "실패" : "만드는 중"}</span>
              <span className="p">{j.purpose === "background" ? "배경" : "후보"} {j.status === "done" ? `${j.candidates.length}장` : ""}{j.mock ? " · 모의" : j.mode ? ` · ${MODE_LABEL[j.mode] ?? j.mode}` : ""}{j.model ? ` · ${j.model}` : ""}</span>
              <span className="thumbs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {j.candidates.slice(0, 4).map((c, i) => <img key={i} src={c.url} alt="" className={j.chosen === i ? "chosen" : ""} />)}
              </span>
              <span className="s">{j.status === "failed" ? j.error : j.scene}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
