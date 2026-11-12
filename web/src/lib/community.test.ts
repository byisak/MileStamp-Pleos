import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkHandle, checkText, coarseWhen, decodeCursor, dropBlocked, encodeCursor, looksLikeChildName, roundPulse,
  shouldAutoHide, suggestHandle, toFeedPost, visibleAtFor, FALLBACK_DELAY_MS, type PostRow,
} from "./community-shape";
import { readModeration } from "./community-moderation";

const at = (s: string) => new Date(`${s}+09:00`); // 한국 시각으로 적기

test("함께 · 보이는 시각: 오늘 집 도착 뒤면 바로, 아니면 2시간 뒤", () => {
  const now = at("2026-11-02T18:30");
  // 집 도착 소식 없음 → 2시간 뒤
  assert.equal(visibleAtFor({ now }).getTime(), now.getTime() + FALLBACK_DELAY_MS);
  // 오늘 17:50 집 도착, 그 뒤 도장 없음 → 바로
  assert.equal(visibleAtFor({ now, summaryAt: at("2026-11-02T17:50"), lastStampAt: at("2026-11-02T15:10") }).getTime(), now.getTime());
  // 집 도착 뒤 다시 나가서 도장을 받음(지금 밖) → 2시간 뒤
  assert.equal(visibleAtFor({ now, summaryAt: at("2026-11-02T12:00"), lastStampAt: at("2026-11-02T17:00") }).getTime(), now.getTime() + FALLBACK_DELAY_MS);
  // 어제 집 도착은 오늘 글에 안 쓴다
  assert.equal(visibleAtFor({ now: at("2026-11-02T09:00"), summaryAt: at("2026-11-01T18:00") }).getTime(), at("2026-11-02T11:00").getTime());
  // 한국 자정 넘김: UTC로는 같은 날이어도 한국 날짜가 다르면 다른 날
  assert.equal(visibleAtFor({ now: at("2026-11-03T00:30"), summaryAt: at("2026-11-02T23:50") }).getTime(), at("2026-11-03T02:30").getTime());
});

test("함께 · 대충 시각 글: 정확한 시각 없이", () => {
  const now = at("2026-11-02T20:00");
  assert.equal(coarseWhen(at("2026-11-02T09:12"), now), "오늘 오전");
  assert.equal(coarseWhen(at("2026-11-02T14:47"), now), "오늘 오후");
  assert.equal(coarseWhen(at("2026-11-02T19:05"), now), "오늘 저녁");
  assert.equal(coarseWhen(at("2026-11-01T23:59"), now), "어제");
  assert.equal(coarseWhen(at("2026-10-30T10:00"), now), "3일 전");
  assert.equal(coarseWhen(at("2026-10-19T10:00"), now), "2주 전");
  assert.equal(coarseWhen(at("2026-08-05T10:00"), now), "8월");
  // 한국 자정 직후: 어제 밤 11시는 '어제'
  assert.equal(coarseWhen(at("2026-11-01T23:00"), at("2026-11-02T00:10")), "어제");
  for (const s of ["오늘 오전", "오늘 오후", "어제"]) assert.ok(!/\d{1,2}:\d{2}/.test(s));
});

test("함께 · 글 검사: 전화번호·계좌·학교 이름·링크·욕설은 막고, 보통 후기는 통과", () => {
  const no = (s: string, code: string) => { const r = checkText(s); assert.equal(r.ok, false, s); assert.equal((r as { code: string }).code, code, s); };
  const yes = (s: string) => assert.equal(checkText(s).ok, true, s);
  no("연락 주세요 010-1234-5678", "phone");
  no("01012345678 로 문자", "phone");
  no("053 123 4567 예약했어요", "phone");
  no("입금은 123-456-789012", "account");
  no("햇살어린이집 친구들이랑 왔어요", "school");
  no("대구 산격초등학교 앞", "school");
  no("오픈채팅 들어오세요 https://open.kakao.com/x", "link");
  no("아 씨 발 진짜", "abuse");
  no("ㅅㅂ 주차 최악", "abuse");
  no("가".repeat(141), "long");
  yes("비 와서 걱정했는데 오히려 사람이 없어서 최고였어요");
  yes("주차는 지하가 넓어요. 4D 영상은 10시에 예약 마감!");
  yes("어린이집 끝나고 잠깐 들렀어요"); // 이름 없는 '어린이집'은 괜찮음
  yes("새끼 오리가 귀여웠어요");
  yes("");
  assert.equal(checkText("", { required: true }).ok, false);
  // 아이 이름 같아요(경고만)
  assert.ok(looksLikeChildName("우리 딸 서연이가 좋아했어요"));
  assert.ok(!looksLikeChildName("첫째가 좋아했어요"));
});

test("함께 · 별명: 2~10자, 운영팀 흉내·특수문자·욕설 안 됨, 추천은 '{단어}가족/네'", () => {
  assert.equal(checkHandle("별빛가족").ok, true);
  assert.equal(checkHandle("곰돌이네").ok, true);
  assert.equal(checkHandle("가").ok, false);
  assert.equal(checkHandle("가나다라마바사아자차카").ok, false);
  assert.equal(checkHandle("운영팀").ok, false);
  assert.equal(checkHandle("별빛🌙").ok, false);
  assert.equal(checkHandle("병신가족").ok, false);
  for (let i = 0; i < 30; i++) {
    const s = suggestHandle();
    assert.match(s.handle, /^[가-힣]+(가족|네)$/);
    assert.equal(checkHandle(s.handle).ok, true, s.handle);
    assert.ok(s.icon.length > 0);
  }
});

test("함께 · 자동 숨김: 서로 다른 가족 3번 또는 아이 안전 1번", () => {
  assert.equal(shouldAutoHide([]), false);
  assert.equal(shouldAutoHide([{ reporter: "a", reason: "spam" }, { reporter: "b", reason: "abuse" }]), false);
  // 같은 가족이 여러 번은 한 번
  assert.equal(shouldAutoHide([{ reporter: "a", reason: "spam" }, { reporter: "a", reason: "abuse" }, { reporter: "b", reason: "spam" }]), false);
  assert.equal(shouldAutoHide([{ reporter: "a", reason: "spam" }, { reporter: "b", reason: "abuse" }, { reporter: "c", reason: "other" }]), true);
  assert.equal(shouldAutoHide([{ reporter: "a", reason: "child_safety" }]), true);
});

test("함께 · 가린 가족의 글은 빠지고, 운영팀 글은 남는다", () => {
  const rows = [{ id: 1, car_id: "A" }, { id: 2, car_id: "B" }, { id: 3, car_id: null }, { id: 4, car_id: "A" }];
  assert.deepEqual(dropBlocked(rows, new Set(["A"])).map((r) => r.id), [2, 3]);
  assert.deepEqual(dropBlocked(rows, new Set()).map((r) => r.id), [1, 2, 3, 4]);
});

const baseRow = (o: Partial<PostRow>): PostRow => ({
  id: "11111111-2222-4333-8444-555555555555", car_id: "c0ffee00-1f8e-446d-89b6-68d5147a7700", kind: "stamp", operator: false, place_id: "thearc",
  medal: { name: "비 오는 날 디아크", tier: "rare", rare: "비 오는 날", artKey: "thearc_rain" }, places: null,
  text: "비 와서 걱정했는데 최고였어요", tip: null, visible_at: at("2026-11-02T18:00"), created_at: at("2026-11-02T14:47:31"),
  handle: "여우네", icon: "🦊", nickname: "아빠", place_name: "디아크",
  clap: 12, want: 4, save: 0, my_clap: true, my_want: false, my_save: false, ...o,
});

test("함께 · 응답에 좌표·차/폰 id·정확한 시각이 없다", () => {
  const now = at("2026-11-02T20:00");
  // DB 줄에 좌표·집 칸이 섞여 들어와도 응답 모양에는 안 실린다
  const leaky = { ...baseRow({}), lat: 35.89, lng: 128.58, home_cell: "35.89,128.58", phone_id: "p-1" } as PostRow;
  const posts = [
    toFeedPost(leaky, { me: "someone-else", now }),
    toFeedPost(baseRow({ kind: "trip", place_id: null, medal: { stamps: 3 }, places: [{ id: "nmd", name: "국립대구박물관" }, { id: "dgsm", name: "국립대구과학관" }] }), { me: "x", now }),
    toFeedPost(baseRow({ kind: "tip", tip: { good: true, tags: ["유모차 OK", "수유실", "<script>"] } }), { me: "x", now }),
    toFeedPost(baseRow({ kind: "notice", car_id: null, operator: true, handle: null, nickname: null, places: [{ id: "nmd", name: "국립대구박물관" }] }), { me: "x", now }),
  ];
  const json = JSON.stringify(posts);
  assert.ok(!/"(lat|lng|latitude|longitude|home|home_cell|car_id|carId|phone_id|phoneId|visible_at|created_at|createdAt)"/.test(json), json);
  assert.ok(!json.includes("c0ffee00"), "차 id가 새면 안 됨");
  assert.ok(!/35\.\d+|128\.\d+/.test(json), "좌표 숫자가 새면 안 됨");
  assert.ok(!/T\d{2}:\d{2}/.test(json), "ISO 시각이 새면 안 됨");
  assert.ok(!/14:47/.test(json));
  assert.equal(posts[0].when, "오늘 오후");
  assert.deepEqual(posts[0].stamp, { name: "비 오는 날 디아크", tier: "rare", stars: 2, rare: "비 오는 날", artKey: "thearc_rain", festivalId: null });
  assert.equal(posts[0].author.phone, "아빠");
  assert.equal(posts[0].mine, false);
  assert.deepEqual(posts[1].trip, { places: [{ id: "nmd", name: "국립대구박물관" }, { id: "dgsm", name: "국립대구과학관" }], stamps: 3 });
  assert.deepEqual(posts[2].tip, { good: true, tags: ["유모차 OK", "수유실"] });
  assert.equal(posts[3].author.operator, true);
  assert.equal(posts[3].author.handle, "마일스탬프 운영팀");
});

test("함께 · 내 글이 아직 안 보이면 pending", () => {
  const now = at("2026-11-02T15:00");
  const me = "c0ffee00-1f8e-446d-89b6-68d5147a7700";
  const p = toFeedPost(baseRow({ visible_at: at("2026-11-02T17:00") }), { me, now });
  assert.equal(p.mine, true);
  assert.equal(p.pending, true);
  assert.equal(toFeedPost(baseRow({ visible_at: at("2026-11-02T14:00") }), { me, now }).pending, false);
});

test("함께 · 커서·이번 주 숫자 둥글게·AI 검사 답 읽기", () => {
  const c = encodeCursor(at("2026-11-02T18:00"), "11111111-2222-4333-8444-555555555555");
  assert.deepEqual(decodeCursor(c), { at: at("2026-11-02T18:00"), id: "11111111-2222-4333-8444-555555555555" });
  assert.equal(decodeCursor("garbage"), null);
  assert.equal(decodeCursor(Buffer.from("2026-11-02|'; drop table posts").toString("base64url")), null);
  assert.deepEqual(roundPulse(7, 9), { families: 7, stamps: 9, approx: false });
  assert.deepEqual(roundPulse(23, 41), { families: 20, stamps: 40, approx: true });
  assert.deepEqual(readModeration('{"ok":true}'), { ok: true });
  assert.equal(readModeration('```json\n{"ok":false,"reason":"privacy"}\n```').ok, false);
  assert.equal(readModeration("모르겠어요").ok, true); // 이상한 답이면 통과(키워드 검사는 이미 함)
});
