// '함께'(커뮤니티 1단계) — 서버 /api/community/* 부르기 + 글 미리 살피기 (서버가 최종 판단, web/src/lib/community-shape.ts와 같은 규칙)
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { call } from './api';

export type ReactionKind = 'clap' | 'want' | 'save';
export type ReportReason = 'spam' | 'abuse' | 'privacy' | 'child_safety' | 'other';
export type Profile = { handle: string; icon: string; region: string; termsAt: string | null; hidden: boolean; banned: boolean };
export type CommunityMe = {
  profile: Profile | null; suggestion: { handle: string; icon: string } | null; icons: string[]; tipTags: string[];
  region: { code: string; label: string }; contact: string | null;
};
export type FeedPost = {
  id: string;
  kind: 'stamp' | 'trip' | 'tip' | 'notice';
  author: { handle: string; icon: string; phone: string | null; operator: boolean };
  mine: boolean;
  pending: boolean;
  when: string;
  text: string;
  place: { id: string; name: string } | null;
  stamp: { name: string; tier: 'common' | 'rare' | 'legend'; stars: number; rare: string | null; artKey: string; festivalId: string | null } | null;
  trip: { places: { id: string | null; name: string }[]; stamps: number } | null;
  tip: { good: boolean; tags: string[] } | null;
  reactions: Record<ReactionKind, number>;
  my: Record<ReactionKind, boolean>;
};
export type Pulse = { families: number; stamps: number; approx: boolean; top: { id: string; name: string; families: number }[] };
export type FeedRes = { region: { code: string; label: string }; posts: FeedPost[]; nextCursor: string | null; pulse: Pulse | null; me: { handle: string; icon: string; hidden: boolean } | null };

export type NewPost =
  | { kind: 'stamp'; placeId: string; rare?: boolean; festivalId?: string | null; text?: string }
  | { kind: 'trip'; eventId?: string; text?: string }
  | { kind: 'tip'; placeId: string; good: boolean; tags: string[]; text?: string };

export const getCommunityMe = (t: string) => call<CommunityMe>(t, 'GET', '/api/community/me');
export const putCommunityMe = (t: string, body: { handle?: string; icon?: string; acceptTerms?: boolean; hidden?: boolean }) =>
  call<{ profile: Profile }>(t, 'PUT', '/api/community/me', body);
export const getFeed = (t: string, cursor?: string | null) =>
  call<FeedRes>(t, 'GET', `/api/community/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const getSaved = (t: string) => call<{ posts: FeedPost[] }>(t, 'GET', '/api/community/saved');
export const createPost = (t: string, body: NewPost) => call<{ post: FeedPost }>(t, 'POST', '/api/community/posts', body);
export const deletePost = (t: string, id: string) => call<{ ok: true }>(t, 'DELETE', `/api/community/posts/${id}`);
export const reactPost = (t: string, id: string, kind: ReactionKind, on: boolean) =>
  call<{ post: FeedPost }>(t, 'POST', `/api/community/posts/${id}/react`, { kind, on });
export const reportPost = (t: string, postId: string, reason: ReportReason) =>
  call<{ ok: true; hidden: boolean }>(t, 'POST', '/api/community/report', { postId, reason });
export const blockAuthor = (t: string, postId: string) => call<{ ok: true }>(t, 'POST', '/api/community/block', { postId });

export const TIP_TAGS = ['유모차 OK', '수유실', '주차 쉬움', '키즈존'];
export const TEXT_MAX = 140;

/** 올리기 전에 미리 알려 줄 것 (막는 건 서버). null이면 괜찮아 보임 */
export function textWarning(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  if (/(01[016789]|0[2-6][0-9]?)[\s.\-]?\d{3,4}[\s.\-]?\d{4}/.test(s)) return '전화번호처럼 보여요. 올리면 막혀요';
  if (/\d{2,6}-\d{2,6}-\d{2,8}|\d{10,}/.test(s.replace(/\s/g, ''))) return '계좌번호처럼 보이는 숫자가 있어요';
  if (/[가-힣A-Za-z0-9]+(초등학교|초교|중학교|유치원|어린이집)/.test(s.replace(/\s/g, ''))) return '학교·유치원·어린이집 이름은 빼 주세요';
  if (/https?:\/\/|www\.|open\.kakao|오픈채팅/i.test(s)) return '링크·연락처는 올릴 수 없어요';
  if (/(우리|내|제)\s?(딸|아들|첫째|둘째|막내|쌍둥이)\s?[가-힣]{2,3}(이가|이는|이랑|이도|가|는|랑)?(\s|$)/.test(s)) return '아이 이름처럼 보여요. 이름은 빼는 게 좋아요';
  return null;
}

// ---------- 앱 어디서나 여는 '올리기' 창 · '아이랑 어땠어요?' 묻기 ----------
// (메달 화면·자랑 카드·도장 받은 뒤에서 부른다 — 창은 App의 TogetherHosts가 그린다)

export type ComposeTarget =
  | { kind: 'stamp'; placeId: string; rare?: boolean; festivalId?: string | null; name: string; artKey: string; tier: 'common' | 'rare' | 'legend' }
  | { kind: 'trip'; eventId?: string; places: string[]; stamps: number };
export type TipTarget = { placeId: string; name: string };

type Store = { compose: ComposeTarget | null; tip: TipTarget | null; feedRev: number; goTab: number };
let state: Store = { compose: null, tip: null, feedRev: 0, goTab: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<Store>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export function useTogetherStore(): Store {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
}
export const openComposer = (c: ComposeTarget | null) => set({ compose: c });
export const closeTip = () => set({ tip: null });
/** 새 글을 올리면 함께 탭이 다시 불러온다 */
export const bumpFeed = () => set({ feedRev: state.feedRev + 1 });
/** 올린 뒤 '함께에서 보기' → 함께 탭으로 */
export const goTogether = () => set({ goTab: state.goTab + 1 });

const ASKED = 'together-tip-asked-v1';
let asked: string[] | null = null;
/** 도장 받은 뒤 한 번만 '이 곳 아이랑 어땠어요?' (장소마다 한 번) */
export async function askTipOnce(t: TipTarget) {
  if (!asked) asked = JSON.parse((await SecureStore.getItemAsync(ASKED).catch(() => null)) ?? '[]');
  if (asked!.includes(t.placeId)) return;
  asked = [...asked!, t.placeId].slice(-80);
  SecureStore.setItemAsync(ASKED, JSON.stringify(asked)).catch(() => {});
  set({ tip: t });
}
/** 개발 탭 '처음으로'에서 묻기 기록 지우기 */
export async function resetTipAsked() { asked = []; await SecureStore.deleteItemAsync(ASKED).catch(() => {}); }
