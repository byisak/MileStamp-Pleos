import { after } from "next/server";
import { adminGuard } from "@/lib/admin-auth";
import { AiError, aiApiKey, aiBase, aiDailyLimit, aiMock, getBalance, isModelId, listImageModels, resolveImageModel } from "@/lib/ai-image";
import { createJob, listJobs, loadTarget, placeBg, runJob, sceneFor, usedToday, type AiKind, type AiPurpose } from "@/lib/ai-stamp-jobs";
import { publicOrigin } from "@/lib/origin";
import { r2Ready } from "@/lib/r2";
import { STAMP_CANDIDATES, buildBackgroundPrompt, buildStampPrompt, cleanScene } from "@/lib/stamp-prompt";

/** 그림 생성(후보 4장 ≈ 30~90초)은 응답 뒤 after()에서 — 이 함수가 그만큼 살아 있어야 한다. */
export const maxDuration = 300;

const kindOf = (k: unknown): AiKind | null => (k === "place" || k === "festival" ? k : null);

/**
 * 관리자: AI 도장 작업 만들기 { kind: 'place'|'festival', id, scene?, purpose?: 'stamp'|'background', model? } → { jobId }.
 * model = 화면에서 고른 그림 모델 (게이트웨이 목록에 있어야 함). 없으면 기본값.
 * 바로 돌아오고, 그림은 뒤에서 만든다 (GET /api/admin/ai-stamp/<jobId>로 확인).
 */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => ({}))) as { kind?: string; id?: string; scene?: string; purpose?: string; model?: unknown };
  if (b.model != null && b.model !== "" && !isModelId(b.model)) return Response.json({ error: "모델 이름이 이상해요" }, { status: 400 });
  const want = isModelId(b.model) ? b.model : null;
  const kind = kindOf(b.kind);
  const purpose: AiPurpose = b.purpose === "background" ? "background" : "stamp";
  if (!kind || !b.id) return Response.json({ error: "어느 명소·축제인지 알려 주세요" }, { status: 400 });
  if (purpose === "background" && kind !== "place") return Response.json({ error: "배경은 명소만 만들 수 있어요" }, { status: 400 });
  const target = await loadTarget(kind, String(b.id));
  if (!target) return Response.json({ error: "그런 명소·축제가 없어요" }, { status: 404 });

  const mock = aiMock();
  const n = purpose === "background" ? 1 : STAMP_CANDIDATES;
  if (!mock) {
    if (!aiApiKey()) return Response.json({ error: "이미지 AI 키가 설정되지 않았어요" }, { status: 503 });
    if (!r2Ready()) return Response.json({ error: "저장소(R2) 연결이 필요해요" }, { status: 503 });
    const used = await usedToday();
    const limit = aiDailyLimit();
    if (used + n > limit) {
      return Response.json({ error: `오늘 만들 수 있는 그림을 다 썼어요 (${used}/${limit}장) · 내일 다시 해 주세요`, used, limit }, { status: 429 });
    }
    const bal = await getBalance();
    if (bal && bal.amount <= 0) return Response.json({ error: "이미지 AI 잔액이 없어요 · 게이트웨이에서 충전한 뒤 다시 해 주세요", balance: bal }, { status: 402 });
    if (want) {
      try {
        await resolveImageModel(undefined, want); // 목록에 없는 모델이면 여기서 바로 알려 줌
      } catch (e) {
        if (e instanceof AiError) return Response.json({ error: e.message }, { status: e.status });
        throw e;
      }
    }
  }

  const scene = cleanScene(typeof b.scene === "string" && b.scene.trim() ? b.scene : sceneFor(target).sceneEn);
  if (scene.length < 8) return Response.json({ error: "장면 문장을 조금 더 써 주세요" }, { status: 400 });
  const prompt = (purpose === "background" ? buildBackgroundPrompt : buildStampPrompt)(scene, { withRefs: true });
  const jobId = await createJob({ kind, id: target.id, purpose, scene, prompt, n, mock, model: mock ? null : want });
  const origin = publicOrigin(req);
  after(() => runJob(jobId, { origin, target, purpose, scene, mock, model: want }));
  return Response.json({ jobId, mock });
}

/**
 * 관리자: 대상 하나의 AI 작업 기록 ?target=place:chimsan
 * → { jobs, sceneKo, sceneEn, fromResearch, used, limit, keyReady, mock, r2, balance, gateway, bgUrl, model(기본값), models(게이트웨이 그림 모델 목록) }
 */
export async function GET(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const t = new URL(req.url).searchParams.get("target") ?? "";
  const i = t.indexOf(":");
  const kind = kindOf(t.slice(0, i));
  if (!kind) return Response.json({ error: "target=place:<id> 또는 festival:<id>" }, { status: 400 });
  const target = await loadTarget(kind, t.slice(i + 1));
  if (!target) return Response.json({ error: "그런 명소·축제가 없어요" }, { status: 404 });
  const mock = aiMock();
  const live = !mock && !!aiApiKey();
  const [jobs, used, balance, bgUrl, model, models] = await Promise.all([
    listJobs(kind, target.id),
    usedToday(),
    mock ? Promise.resolve(null) : getBalance(),
    kind === "place" ? placeBg(target.id) : Promise.resolve(null),
    live ? resolveImageModel().catch(() => null) : Promise.resolve(null),
    live ? listImageModels() : Promise.resolve([]),
  ]);
  return Response.json({
    jobs, ...sceneFor(target), used, limit: aiDailyLimit(), keyReady: !!aiApiKey(), mock, r2: r2Ready(), balance,
    gateway: new URL(aiBase()).host, bgUrl, model: model?.id ?? null, models: models.map((m) => m.id),
  });
}
