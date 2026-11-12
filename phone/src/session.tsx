// 연결 상태 공유: 폰 토큰 + 내 정보·가족 폰. 401이면 연결이 끊긴 것(차에서 지웠거나 서버 초기화)
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, getMe, loadToken, Me, saveToken } from './api';
import { syncAuto } from './auto';

/** 안드로이드 오토 차 화면에 토큰을 넘긴다 (없어도 앱은 그대로 — 기다리지 않음). */
const auto = (t: string | null) => { try { syncAuto(t).catch(() => {}); } catch { /* 모듈 없음 */ } };

type Session = {
  token: string | null | undefined; // undefined = 불러오는 중
  me: Me | null;
  refresh: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => { loadToken().then((t) => { setToken(t); auto(t); }); }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try { setMe(await getMe(token)); }
    catch (e) { if (e instanceof ApiError && e.status === 401) { await saveToken(null); setToken(null); setMe(null); auto(null); } }
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  const signIn = async (t: string) => { await saveToken(t); setToken(t); auto(t); };
  const signOut = async () => { await saveToken(null); setToken(null); setMe(null); auto(null); };

  return <Ctx.Provider value={{ token, me, refresh, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('SessionProvider 밖');
  return s;
}
