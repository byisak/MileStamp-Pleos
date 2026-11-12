// 차에서 온 소식 공유: 목록(오늘) · 알림을 누르면 그 소식 열기 · 앱이 앞에 있으면 20초마다 확인
// 오늘 계획 알림(종류 plan, 소식 id 없음): planPing을 올려 계획을 다시 불러오게 하고, 누르면 오늘 탭(todayPing)
// 코스 변경 알림(종류 course_update): data에 실린 답 JSON(Outcome)을 그대로 코스 저장소에 넘긴다(서버를 기다리지 않음). 누르면 오늘 탭
import * as Notifications from 'expo-notifications';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { feed, TripEvent } from './api';
import { normOutcome, Outcome } from './course';
import { sendPushToken, setupChannel, syncPushToken } from './notify';
import { useSession } from './session';

type Events = {
  events: TripEvent[] | null;
  reload: () => Promise<void>;
  /** 마지막 불러오기가 실패했는가 (인터넷 끊김 등). events가 null이고 이게 true면 '불러오지 못했어요' + 다시 불러오기 */
  failed: boolean;
  /** 불러오는 중 (다시 불러오기 버튼 돌기) */
  loading: boolean;
  opened: TripEvent | null;
  open: (e: TripEvent | null) => void;
  /** 다른 폰·차가 오늘 코스를 골랐다는 알림이 올 때마다 1씩 오른다 */
  planPing: number;
  /** 그 알림을 눌렀을 때마다 1씩 오른다 → 오늘 탭으로 */
  todayPing: number;
  /** '함께' 반응 알림을 누르면 +1 → 함께 탭 */
  togetherPing: number;
  /** 코스 변경 알림(종류 course_update)에 실려 온 답 JSON. 올 때마다 새 객체 → planStore가 코스를 갱신 */
  courseUpdate: { seq: number; outcome: Outcome | null } | null;
  /** 열린 '그날의 기록' 날짜 (일기 완성 알림·일정 탭 지난 나들이). null이면 닫힘 */
  diaryDay: string | null;
  openDiary: (day: string | null) => void;
};
const Ctx = createContext<Events | null>(null);

export function EventsProvider({ children }: { children: ReactNode }) {
  const { token, refresh } = useSession();
  const [events, setEvents] = useState<TripEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<TripEvent | null>(null);
  const pendingId = useRef<string | null>(null);
  const [planPing, setPlanPing] = useState(0);
  const [todayPing, setTodayPing] = useState(0);
  const [togetherPing, setTogetherPing] = useState(0);
  const [courseUpdate, setCourseUpdate] = useState<Events['courseUpdate']>(null);
  const courseSeq = useRef(0);
  const [diaryDay, setDiaryDay] = useState<string | null>(null);
  /** 알림 data에서 답 JSON 꺼내기: outcome · payload · course 칸 중 있는 것 (글이면 JSON으로) */
  const courseFrom = (d: Record<string, string>) => {
    for (const k of ['outcome', 'payload', 'json', 'course']) {
      const v = (d as any)[k];
      if (v == null) continue;
      try {
        const o = typeof v === 'string' ? JSON.parse(v) : v;
        const out = normOutcome(k === 'course' ? { kind: d.outcomeKind ?? 'Retimed', course: o } : o);
        if (out) return out;
      } catch {}
    }
    return null;
  };

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await feed(token);
      setEvents(r.events);
      setFailed(false);
      if (pendingId.current) {
        const hit = r.events.find((e) => e.id === pendingId.current);
        if (hit) { setOpened(hit); pendingId.current = null; }
      }
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setupChannel().then(() => syncPushToken(token)).then(() => refresh());
    reload();
    // 토큰이 바뀌었을 때만: 이벤트에 담긴 새 토큰을 그대로 보낸다 (여기서 다시 가져오면 무한 반복)
    const tokenSub = Notifications.addPushTokenListener((t) => { if (typeof t.data === 'string') sendPushToken(token, t.data); });
    // FCM 데이터: 앱이 켜져 있으면 content.data, 백그라운드에서 누르면 trigger.remoteMessage.data에 올 수 있다
    const dataOf = (req: Notifications.NotificationRequest) =>
      ({ ...((req.trigger as any)?.remoteMessage?.data ?? {}), ...(req.content.data ?? {}) }) as Record<string, string>;
    const recv = Notifications.addNotificationReceivedListener((n) => {
      const d = dataOf(n.request);
      if (d.kind === 'plan') setPlanPing((x) => x + 1);
      else if (d.kind === 'course_update') setCourseUpdate({ seq: ++courseSeq.current, outcome: courseFrom(d) });
      else if (d.kind !== 'diary' && d.kind !== 'community') reload();
    });
    const openFrom = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const d = dataOf(r.notification.request);
      if (d.kind === 'plan') { setPlanPing((x) => x + 1); setTodayPing((x) => x + 1); return; }
      if (d.kind === 'community') { setTogetherPing((x) => x + 1); return; }
      if (d.kind === 'course_update') { setCourseUpdate({ seq: ++courseSeq.current, outcome: courseFrom(d) }); setTodayPing((x) => x + 1); return; }
      // 일기 완성 알림 → 그날의 기록
      if (d.kind === 'diary') { if (typeof d.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.day)) setDiaryDay(d.day); return; }
      if (!d.eventId) return;
      try {
        // 알림에 담긴 것만으로 바로 연다
        setOpened({ id: d.eventId, kind: d.kind as TripEvent['kind'], place_id: d.placeId || null, payload: JSON.parse(d.payload || '{}'), created_at: d.createdAt || new Date().toISOString() });
      } catch { pendingId.current = d.eventId; }
      reload();
    };
    openFrom(Notifications.getLastNotificationResponse());
    const resp = Notifications.addNotificationResponseReceivedListener(openFrom);
    let timer: ReturnType<typeof setInterval> | null = setInterval(reload, 20000);
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') { reload(); if (!timer) timer = setInterval(reload, 20000); }
      else if (timer) { clearInterval(timer); timer = null; }
    });
    return () => { tokenSub.remove(); recv.remove(); resp.remove(); app.remove(); if (timer) clearInterval(timer); };
  }, [token, reload]);

  return <Ctx.Provider value={{ events, reload, failed, loading, opened, open: setOpened, planPing, todayPing, togetherPing, courseUpdate, diaryDay, openDiary: setDiaryDay }}>{children}</Ctx.Provider>;
}

export function useEvents() {
  const e = useContext(Ctx);
  if (!e) throw new Error('EventsProvider 밖');
  return e;
}
