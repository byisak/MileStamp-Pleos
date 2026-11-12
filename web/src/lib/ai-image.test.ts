import { test } from "node:test";
import assert from "node:assert/strict";
import { AiError, fitSize, forgetModels, generateImages, getBalance, isModelId, isUnsupported, parseBalance, parseImageModels, pickImageModel, rememberMode, rememberedMode, resolveImageModel, sniff } from "./ai-image";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(200).fill(1)]);
const b64 = Buffer.from(PNG).toString("base64");
const refs = async () => [{ bytes: new Uint8Array([1, 2, 3]), type: "image/webp", name: "a.webp" }];
const prompt = (withRefs: boolean) => (withRefs ? "with refs" : "text only");

type Call = { url: string; init?: RequestInit };
function fakeFetch(handler: (c: Call) => Response): { f: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const c = { url: String(url), init };
    // 모델 목록은 따로 답한다 (기록에는 넣지 않음)
    if (c.url.endsWith("/models")) return json({ data: [{ id: "gpt-image-1.5", mode: "image_generation", image: { sizes: ["1024x1024", "1024x1536"] } }] });
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return { f, calls };
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

test("그림 AI: 키가 없으면 분명한 오류", async () => {
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(generateImages({ prompt, refs, n: 4, size: "1024x1024" }), (e: AiError) => e.message === "이미지 AI 키가 설정되지 않았어요" && e.status === 503);
});

test("그림 AI: edits가 되면 참고 그림 multipart로 4장", async () => {
  process.env.AI_API_KEY = "k";
  process.env.AI_BASE_URL = "https://gw.example/v1/";
  rememberMode(null);
  const { f, calls } = fakeFetch(() => json({ data: [1, 2, 3, 4].map(() => ({ b64_json: b64 })) }));
  const r = await generateImages({ prompt, refs, n: 4, size: "1024x1024", fetchImpl: f });
  assert.equal(r.mode, "edit");
  assert.equal(r.images.length, 4);
  assert.equal(r.images[0].ext, "png");
  assert.equal(calls[0].url, "https://gw.example/v1/images/edits");
  const fd = calls[0].init!.body as FormData;
  assert.equal(fd.get("prompt"), "with refs");
  assert.equal(fd.get("n"), "4");
  assert.equal(fd.get("quality"), "medium");
  assert.equal((calls[0].init!.headers as Record<string, string>).Authorization, "Bearer k");
  assert.equal(rememberedMode(), "edit");
});

test("그림 AI: edits 404면 generations(글로만)로, url 응답도 읽고, 다음엔 바로 generations", async () => {
  process.env.AI_API_KEY = "k";
  rememberMode(null);
  const { f, calls } = fakeFetch((c) => {
    if (c.url.endsWith("/images/edits")) return json({ error: { message: "Not Found" } }, 404);
    if (c.url.endsWith("/images/generations")) return json({ data: [{ url: "https://cdn.example/1.png" }, { b64_json: b64 }] });
    if (c.url === "https://cdn.example/1.png") return new Response(PNG);
    return json({}, 500);
  });
  const r = await generateImages({ prompt, refs, n: 4, size: "1024x1024", fetchImpl: f });
  assert.equal(r.mode, "generate");
  assert.equal(r.images.length, 4); // 2장 + 한 장씩 2번 더
  const gen = calls.filter((c) => c.url.endsWith("/images/generations"));
  assert.equal(JSON.parse(gen[0].init!.body as string).prompt, "text only");
  assert.equal(JSON.parse(gen[0].init!.body as string).n, 4);
  assert.equal(JSON.parse(gen[1].init!.body as string).n, 1);
  assert.equal(rememberedMode(), "generate");
  calls.length = 0;
  await generateImages({ prompt, refs, n: 2, size: "1024x1024", fetchImpl: f });
  assert.equal(calls.some((c) => c.url.endsWith("/images/edits")), false);
});

test("그림 AI: 잔액 부족·키 오류는 바로 알림 (generations로 넘어가지 않음)", async () => {
  process.env.AI_API_KEY = "k";
  rememberMode(null);
  const { f, calls } = fakeFetch(() => json({ error: { message: "Insufficient balance" } }, 402));
  await assert.rejects(generateImages({ prompt, refs, n: 4, size: "1024x1024", fetchImpl: f }), (e: AiError) => e.code === "balance" && /잔액/.test(e.message));
  assert.equal(calls.length, 1);
  const bad = fakeFetch(() => json({ error: "bad key" }, 401));
  await assert.rejects(generateImages({ prompt, refs, n: 1, size: "1024x1024", fetchImpl: bad.f }), (e: AiError) => e.code === "auth");
});

test("그림 AI: 도우미 (지원 안 함 판단·바이트 형식·잔액 읽기)", async () => {
  assert.equal(isUnsupported(404, ""), true);
  assert.equal(isUnsupported(400, "Endpoint /v1/images/edits is not supported"), true);
  assert.equal(isUnsupported(400, "Your request was rejected by the safety system"), false);
  assert.equal(sniff(new Uint8Array([0xff, 0xd8, 0, 0])).ext, "jpg");
  assert.equal(sniff(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])).ext, "webp");
  assert.deepEqual(parseBalance({ balance: 12500 }), { amount: 12500, currency: "KRW" });
  assert.deepEqual(parseBalance({ data: { balance_krw: "3000" } }), { amount: 3000, currency: "KRW" });
  assert.equal(parseBalance({ ok: true }), null);
  process.env.AI_API_KEY = "k";
  const { f } = fakeFetch(() => json({ balance: 0, currency: "krw" }));
  assert.deepEqual(await getBalance(f), { amount: 0, currency: "KRW" });
  const gone = fakeFetch(() => json({}, 404));
  assert.equal(await getBalance(gone.f), null);
});

test("그림 AI: 게이트웨이 모델 목록에서 그림 모델 고르기·크기 맞추기", () => {
  const list = parseImageModels({
    data: [
      { id: "gpt-4.1", mode: "chat" },
      { id: "gemini-2.5-flash-image", mode: "image_generation", image: { sizes: ["1024x1024"] } },
      { id: "gpt-image-1.5", mode: "image_generation", image: { sizes: ["1024x1024", "1024x1536", "1536x1024"] } },
      { id: "dall-e-3" },
    ],
  });
  assert.deepEqual(list.map((m) => m.id), ["gemini-2.5-flash-image", "gpt-image-1.5", "dall-e-3"]);
  assert.equal(pickImageModel(list)?.id, "gpt-image-1.5");
  assert.equal(pickImageModel(list.filter((m) => !/gpt/.test(m.id)))?.id, "gemini-2.5-flash-image");
  assert.equal(pickImageModel([]), null);
  assert.equal(fitSize("1024x1024", []), "1024x1024");
  assert.equal(fitSize("1024x1536", ["1024x1024", "1024x1536"]), "1024x1536");
  assert.equal(fitSize("1024x1536", ["1024x1024", "832x1248"]), "832x1248");
  assert.equal(fitSize("1024x1024", ["auto"]), undefined);
});

test("그림 AI: 화면에서 고른 모델 — 목록에 있으면 그 모델, 없으면 오류, 목록을 못 받으면 이름 그대로", async () => {
  process.env.AI_API_KEY = "k";
  delete process.env.AI_IMAGE_MODEL;
  forgetModels();
  const list = (async (url: string | URL) => json({ data: [
    { id: "gpt-image-1.5", mode: "image_generation", image: { sizes: ["1024x1024"] } },
    { id: "gemini-2.5-flash-image", mode: "image_generation" },
    { id: "gpt-4o", mode: "chat" },
  ] }, String(url).endsWith("/models") ? 200 : 404)) as typeof fetch;
  assert.equal((await resolveImageModel(list, "gemini-2.5-flash-image")).id, "gemini-2.5-flash-image");
  assert.equal((await resolveImageModel(list)).id, "gpt-image-1.5");
  await assert.rejects(resolveImageModel(list, "gpt-4o"), (e: AiError) => /gpt-4o/.test(e.message) && e.status === 400);
  forgetModels();
  const down = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await resolveImageModel(down, "flux-1"), { id: "flux-1", sizes: [] });
  forgetModels();
  assert.ok(isModelId("gemini-2.5-flash-image") && isModelId("openai/gpt-image-1"));
  assert.ok(!isModelId("a b") && !isModelId("") && !isModelId(3));
});

test("그림 AI: 고른 모델을 보내고, edits가 되는지는 모델마다 따로 기억", async () => {
  process.env.AI_API_KEY = "k";
  forgetModels();
  rememberMode(null);
  const sent: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/models")) return json({ data: [{ id: "gpt-image-1.5", mode: "image_generation" }, { id: "imagen-4", mode: "image_generation" }] });
    if (u.endsWith("/images/edits")) {
      const m = (init?.body as FormData).get("model") as string;
      sent.push(`edit:${m}`);
      return m === "imagen-4" ? json({ error: { message: "not supported" } }, 404) : json({ data: [{ b64_json: b64 }] });
    }
    const m = JSON.parse(String(init?.body)).model as string;
    sent.push(`gen:${m}`);
    return json({ data: [{ b64_json: b64 }] });
  }) as typeof fetch;
  const a = await generateImages({ prompt, refs, n: 1, size: "1024x1024", model: "imagen-4", fetchImpl: f });
  assert.deepEqual([a.mode, a.model], ["generate", "imagen-4"]);
  const b = await generateImages({ prompt, refs, n: 1, size: "1024x1024", model: "gpt-image-1.5", fetchImpl: f });
  assert.deepEqual([b.mode, b.model], ["edit", "gpt-image-1.5"]);
  assert.equal(rememberedMode("imagen-4"), "generate");
  assert.equal(rememberedMode("gpt-image-1.5"), "edit");
  assert.deepEqual(sent, ["edit:imagen-4", "gen:imagen-4", "edit:gpt-image-1.5"]);
  rememberMode(null);
  forgetModels();
});
