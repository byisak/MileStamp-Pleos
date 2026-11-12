// 마일스탬프 서버(web/, https://milestamp.vercel.app)의 폰 API. 차 QR로 연결하면 받는 폰 토큰을 Bearer로 붙인다.
import * as SecureStore from 'expo-secure-store';

// 시험 빌드만 EXPO_PUBLIC_SERVER_URL(빌드할 때 박힘)로 다른 서버를 쓴다. 기본은 운영 서버
export const BASE = process.env.EXPO_PUBLIC_SERVER_URL || 'https://milestamp.vercel.app';
const KEY = 'phone_token';

export async function loadToken() { return SecureStore.getItemAsync(KEY); }
export async function saveToken(t: string | null) { return t ? SecureStore.setItemAsync(KEY, t) : SecureStore.deleteItemAsync(KEY); }

/** 서버 오류. data는 서버가 보낸 본문(409 '차가 먼저 바꿨어요'처럼 본문에 최신 값이 실려 올 때 쓴다) */
export class ApiError extends Error { constructor(msg: string, public status: number, public data?: unknown) { super(msg); } }

/** signal: 앞 요청 취소용(자동완성) — 취소되면 ApiError status -1 */
export async function call<T>(token: string | null, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  signal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError((data as { error?: string }).error || `서버 오류 (${res.status})`, res.status, data);
    return data as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw new ApiError('취소했어요', -1);
    throw new ApiError(e?.name === 'AbortError' ? '서버 응답이 늦어요. 잠시 뒤 다시 해 주세요' : '인터넷 연결을 확인해 주세요', 0);
  } finally {
    clearTimeout(timer);
  }
}

/** 차 화면 QR(또는 6자리 코드)로 가족이 된다 */
export function join(code: string, nickname: string) {
  return call<{ ok: true; token: string; nickname: string }>(null, 'POST', '/api/phone/join', { code, nickname, app: true });
}

export type Family = { nickname: string; hasPush: boolean; me: boolean; since: string };
export type Me = { demo: boolean; me: { id: string; nickname: string; hasPush: boolean }; family: Family[] };
export const getMe = (t: string) => call<Me>(t, 'GET', '/api/phone/me');
export const renameMe = (t: string, nickname: string) => call<{ nickname: string }>(t, 'PATCH', '/api/phone/me', { nickname });
export const unlink = (t: string) => call<{ ok: true }>(t, 'DELETE', '/api/phone/me');

/** QR 글(주소 …/join?c=ABC123 또는 코드만)에서 코드를 꺼낸다 */
export function codeFrom(text: string): string | null {
  const s = text.trim();
  const m = /[?&]c=([A-Za-z0-9]{6})\b/.exec(s) ?? /^([A-Za-z0-9]{6})$/.exec(s);
  return m ? m[1].toUpperCase() : null;
}

// ---------- 차에서 온 소식 ----------
export type EventKind = 'handoff' | 'mission' | 'intro' | 'stamp' | 'summary';
export type TripEvent = { id: string; kind: EventKind; place_id: string | null; payload: Record<string, any>; created_at: string };

/** 오늘(최근 12시간) 소식, after 이후만 */
export const feed = (t: string, after?: string) =>
  call<{ events: TripEvent[] }>(t, 'GET', `/api/phone/feed${after ? `?after=${encodeURIComponent(after)}` : ''}`);

/** 이 폰의 FCM 토큰을 서버에 (차 문이 열리면 여기로 알림) */
export const registerPush = (t: string, fcm: string) => call<{ ok: true }>(t, 'POST', '/api/phone/push', { fcm });

export const answerMission = (t: string, eventId: string, choice: number | null, found: boolean) =>
  call<{ correct: boolean | null; answer: number }>(t, 'POST', '/api/phone/mission', { eventId, choice, found });

export type StampRow = { id: string; place_id: string; payload: { number?: number; rare?: string | null; silent?: boolean }; created_at: string };
export const getStamps = (t: string) => call<{ stamps: StampRow[] }>(t, 'GET', '/api/phone/stamps');

export type MissionRow = { id: string; place_id: string; created_at: string; answer: { choice: number | null; found: boolean } | null; correct: boolean | null };
export const getMissions = (t: string) => call<{ missions: MissionRow[] }>(t, 'GET', '/api/phone/missions');

// 개발자 시험용 데모 차에서만: 차가 보낸 것처럼 소식 만들기 / 모두 지우기
//   placeId: 장소 고르기 · rare: 비 오는 날 디아크 · quiet: 쉿 모드 도장 · push: false면 알림 없이 저장만
//   (예전 서버는 placeId 등을 무시하고 종류별 기본 소식을 만든다 — 응답에 placeId가 없으면 예전 서버)
export type DemoKind = 'handoff' | 'intro' | 'mission' | 'stamp' | 'summary';
export type DemoReq = { kind: DemoKind; placeId?: string; rare?: boolean | string; quiet?: boolean; push?: boolean; festivalId?: string };
export type DemoRes = { id: string; pushed: number; placeId?: string | null; payload?: StampRow['payload'] };
export const sendDemo = (t: string, req: DemoReq) => call<DemoRes>(t, 'POST', '/api/phone/demo', req);
export const clearDemo = (t: string) => call<{ ok: true }>(t, 'DELETE', '/api/phone/demo');
