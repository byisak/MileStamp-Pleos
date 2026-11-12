// 개발 탭 (데모 차에서만): 전체 점검 · 추천 시험 · 코스 시험(살아 있는 코스 사건) · 하루 시나리오 재생 · 소식 하나씩 보내기 · 상태 · 데모 소식 지우기
// 차 없이 폰 하나로 모든 기능을 시험한다. 보내는 소식은 서버에 실제로 저장되고 알림도 실제로 온다.
import { Asset } from 'expo-asset';
import Constants from 'expo-constants';
import { getPermissionsAsync as mediaPermission, requestPermissionsAsync as askMedia } from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { Tab } from '../../App';
import { Alert } from '../alert';
import { BASE, clearDemo, DemoReq, getMe, getMissions, getStamps, sendDemo } from '../api';
import { CLIPS, VOICE } from '../clips';
import { CourseEvent, CourseResult } from '../course';
import { useEvents } from '../events';
import { clipFor, resumeAt } from '../places';
import { PLAN_TESTS, usePlan } from '../planStore';
import { useSession } from '../session';
import { setDemoClean } from '../devclean';
import { F, R } from '../theme';
import { Btn, Divider, Icon, IconName, Page, Pill, Section, Segmented, Surface, T, done, tick, useTheme } from '../ui';

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const host = BASE.replace(/^https?:\/\//, '');

/** 시간 제한: 네트워크가 멈춰도 점검이 끝없이 돌지 않게 */
function within<X>(p: Promise<X>, ms = 12000): Promise<X> {
  return Promise.race([p, new Promise<X>((_, no) => setTimeout(() => no(new Error(`${ms / 1000}초 넘게 응답 없음`)), ms))]);
}

// ---------- 전체 점검 ----------
type Ctx = { token: string; shot: { current: unknown } };
type Check = { icon: IconName; title: string; sub: string; run: (c: Ctx) => Promise<string | void> };
const CHECKS: Check[] = [
  { icon: 'globe', title: '서버 연결', sub: '응답 시간', run: async ({ token }) => {
    const me = await getMe(token);
    return `${host}${me.demo ? ' · 데모 차' : ''}`;
  } },
  { icon: 'bell', title: '알림 토큰', sub: 'FCM 등록', run: async ({ token }) => {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) throw new Error('알림 권한 없음');
    const t = await Notifications.getDevicePushTokenAsync();
    if (typeof t.data !== 'string' || !t.data) throw new Error('토큰을 못 받음');
    const me = await getMe(token);
    if (!me.me.hasPush) throw new Error('서버에 토큰 없음');
    return `FCM 등록됨 · 끝 …${t.data.slice(-4)}`;
  } },
  { icon: 'headphones', title: '이어 듣기', sub: '끊긴 문장부터 재생', run: async () => {
    const c = clipFor('samguk', 'FULL_60S');
    if (!c) throw new Error('삼국유사 음성 없음');
    // 차가 9.0초에서 끊겼다면 그 문장의 처음부터
    const want = c.starts.filter((s) => s <= 9).pop();
    const at = resumeAt(c, 9000);
    if (at !== want) throw new Error(`문장 시작이 어긋남 (${at}초)`);
    const a = await Asset.fromModule(c.src).downloadAsync();
    if (!a.localUri && !a.uri) throw new Error('음성 파일 없음');
    return `9.0초에서 끊김 → ${at}초 문장부터`;
  } },
  { icon: 'mic', title: '소개 음성 13개', sub: '파일 · 문장 시작 시각', run: async () => {
    const list = Object.entries(CLIPS);
    if (list.length !== 13) throw new Error(`${list.length}개뿐`);
    const bad = list.filter(([, c]) => !c.starts.length || c.starts[0] > 0.5 || c.starts.some((s, i) => (i && s < c.starts[i - 1]) || s >= c.duration));
    if (bad.length) throw new Error(`문장 시각 이상: ${bad.map(([k]) => k).join(', ')}`);
    const files = await Promise.all(list.map(([, c]) => Asset.fromModule(c.src).downloadAsync()));
    const missing = files.filter((a) => !a.localUri && !a.uri).length;
    if (missing) throw new Error(`파일 ${missing}개 없음`);
    return `13개 · 문장 ${list.reduce((n, [, c]) => n + c.starts.length, 0)}개`;
  } },
  { icon: 'stamp', title: '도장 저장·도장북', sub: '찍기 → 목록', run: async ({ token }) => `도장 ${(await getStamps(token)).stamps.length}개` },
  { icon: 'flag', title: '미션', sub: '퀴즈 답 · 찾아보기', run: async ({ token }) => `미션 ${(await getMissions(token)).missions.length}개` },
  { icon: 'trophy', title: '자랑 카드', sub: '이미지 캡처', run: async ({ shot }) => {
    const uri = await captureRef(shot as any, { format: 'png', result: 'tmpfile' });
    if (!uri) throw new Error('캡처 실패');
    return '이미지로 찍힘';
  } },
  { icon: 'images', title: '사진첩 권한', sub: '자랑 카드 저장', run: async () => {
    const p = await mediaPermission(true);
    if (!p.granted) throw new Error('권한 필요 · 눌러서 허용');
    return '저장 가능';
  } },
];
type St = { s: 'idle' | 'run' | 'ok' | 'fail'; label?: string; note?: string };

// ---------- 하루 시나리오 (차 day_story.sh와 같은 순서) ----------
const DAY: { at: string; label: string; send?: DemoReq[] }[] = [
  { at: '08:30', label: '탑승 → 아침 추천 3곳' },
  { at: '09:17', label: '도착 2분 전 소개(석굴)' },
  { at: '09:20', label: '도장 쾅 · 군위 삼존석굴', send: [{ kind: 'stamp', placeId: 'seokgul' }] },
  { at: '10:07', label: '소개(테마파크)' },
  { at: '10:10', label: '문 열림 → 폰 이어 듣기 + 미션', send: [{ kind: 'handoff', placeId: 'samguk' }, { kind: 'mission', placeId: 'samguk' }] },
  { at: '12:50', label: '재탑승 · 낮잠 맞춤 추천' },
  { at: '12:55', label: '쉿 모드 → 소개는 폰으로', send: [{ kind: 'intro', placeId: 'dgsm' }] },
  { at: '14:06', label: '도장 쾅 · 과학관(무음)', send: [{ kind: 'stamp', placeId: 'dgsm', quiet: true }] },
  { at: '16:10', label: '비 → 귀갓길 디아크 추천' },
  { at: '16:30', label: '희귀 도장 · 비 오는 날 디아크', send: [{ kind: 'stamp', rare: true }] },
  { at: '17:22', label: '귀가 → 자랑 카드 + 뒷좌석 확인', send: [{ kind: 'summary' }] },
  { at: '17:25', label: '위조 시도 → 보류' },
];
// ---------- 코스 시험: engine/src/test/resources/plan-live-cases.json 사례의 사건을 그대로 보낸다 (기준 하루 토 08:30 석굴 → 테마파크 → 과학관) ----------
const COURSE_TESTS: { key: string; label: string; icon: IconName; events: CourseEvent[]; sub: string }[] = [
  { key: 'morning', label: '아침 재생', icon: 'play', sub: '집 출발 08:30 → 석굴 09:00–09:30 → 테마파크 10:00 도착',
    events: [{ type: 'Departed', now: '08:30', from: null }, { type: 'Arrived', now: '09:00', place: 'seokgul' }, { type: 'Departed', now: '09:30', from: 'seokgul' }, { type: 'Arrived', now: '10:00', place: 'samguk' }] },
  { key: 'early', label: '① 30분 일찍 나옴', icon: 'fast-forward', sub: '테마파크 12:10 출발 준비 → 낮잠 창 밖 → 12:50에 출발 · 한 곳 더', events: [{ type: 'Departed', now: '12:10', from: 'samguk' }] },
  { key: 'eta', label: '③ 내비 ETA 36분', icon: 'navigation', sub: '08:31·08:32 두 번 → 조용히 시간표만 (+7분)', events: [{ type: 'NaviEta', now: '08:31', remainMin: 36 }, { type: 'NaviEta', now: '08:32', remainMin: 36 }] },
  { key: 'rain', label: '④ 비 12:30부터', icon: 'cloud-rain', sub: '테마파크 머무는 중 11:00 → 비 오기 전 출발 제안', events: [{ type: 'Weather', now: '11:00', sky: 'CLEAR', rainFrom: '12:30' }] },
  { key: 'replace', label: '⑤ 다음은 디아크로', icon: 'arrow-left-right', sub: '테마파크 출발 직후 12:52 → 디아크 → 과학관, 한계 넘으면 덜 놀기·빼기', events: [{ type: 'Departed', now: '12:40', from: 'samguk' }, { type: 'ReplaceNext', now: '12:52', place: 'thearc' }] },
  { key: 'skip', label: '⑥ 과학관 빼기', icon: 'circle-minus', sub: '13:00 → 여유 커져 한 곳 더', events: [{ type: 'Skip', now: '13:00', place: 'dgsm' }] },
  { key: 'home', label: '⑦ 지금 집으로', icon: 'house', sub: '14:30 → 남은 곳 건너뜀, 집으로', events: [{ type: 'GoHome', now: '14:30' }] },
  { key: 'limit', label: '⑩ 해 짐 당겨짐', icon: 'sunset', sub: '한계 16:40 → 덜 놀기·빼기 제안', events: [{ type: 'LimitChanged', now: '11:00', limit: '16:40' }] },
  { key: 'remote', label: '⑪ 엄마 폰이 코스 바꿈', icon: 'smartphone', sub: '버전 9 (석굴 → 테마파크 → 디아크) → 받아들임', events: [{ type: 'Remote', now: '11:00', version: 9, stops: ['seokgul', 'samguk', 'thearc'], by: '엄마 폰' }] },
  { key: 'stale', label: '⑪ 낮은 버전 무시', icon: 'rotate-ccw', sub: '버전 0 → NoChange', events: [{ type: 'Remote', now: '11:00', version: 0, stops: ['seokgul', 'samguk', 'thearc'], by: '엄마 폰' }] },
];
const KIND_TEXT = { NoChange: '변화 없음', Retimed: '시각만 바뀜', Proposal: '제안', HomeNow: '집으로' };

type Speed = 'real' | 'fast';
const STEP_MS: Record<Speed, number> = { real: 15000, fast: 2500 }; // 12장면: 3분 / 30초

// ---------- 하나씩 보내기 ----------
const ONE: { key: string; label: string; icon: IconName; req: DemoReq; later?: boolean }[] = [
  { key: 'handoff', label: '이어 듣기', icon: 'headphones', req: { kind: 'handoff' } },
  { key: 'intro', label: '조용한 소개', icon: 'moon', req: { kind: 'intro' } },
  { key: 'mission', label: '미션', icon: 'flag', req: { kind: 'mission' } },
  { key: 'stamp', label: '도장', icon: 'stamp', req: { kind: 'stamp', placeId: 'thearc' } },
  { key: 'rare', label: '희귀 도장', icon: 'gem', req: { kind: 'stamp', rare: true } },
  { key: 'summary', label: '자랑 카드', icon: 'trophy', req: { kind: 'summary' } },
  { key: 'later', label: '5초 뒤 알림', icon: 'timer', req: { kind: 'handoff' }, later: true },
];

export function DevTab({ go }: { go: (tab: Tab) => void }) {
  const t = useTheme();
  const s = useSession();
  const ev = useEvents();
  const plan = usePlan();
  const shot = useRef<any>(null); // RN 0.88의 View 참조 타입이 view-shot 타입과 달라서 any (Brag와 같음)

  // 전체 점검
  const [st, setSt] = useState<St[]>(CHECKS.map(() => ({ s: 'idle' })));
  const running = st.some((x) => x.s === 'run');
  const finished = st.filter((x) => x.s === 'ok' || x.s === 'fail').length;
  const passed = st.filter((x) => x.s === 'ok').length;
  const runOne = async (i: number) => {
    if (!s.token) return;
    const ctx = { token: s.token, shot };
    const set = (v: St) => setSt((a) => a.map((x, j) => (j === i ? v : x)));
    set({ s: 'run' });
    const t0 = Date.now();
    try { const note = await within(CHECKS[i].run(ctx)); set({ s: 'ok', label: sec(Date.now() - t0), note: note || undefined }); }
    catch (e: any) { set({ s: 'fail', label: e?.message || '실패' }); throw e; }
  };
  const runAll = async () => {
    // 8개를 동시에 — 끝나는 대로 표시
    const r = await Promise.allSettled(CHECKS.map((_, i) => runOne(i)));
    if (r.every((x) => x.status === 'fulfilled')) done();
    loadStatus();
  };

  // 하루 재생
  const [speed, setSpeed] = useState<Speed>('fast');
  const [cur, setCur] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [dayErr, setDayErr] = useState('');
  const stop = useRef<{ stopped: boolean; wake?: () => void }>({ stopped: false });
  const wait = (ms: number) => new Promise<void>((res) => {
    const timer = setTimeout(res, ms);
    stop.current.wake = () => { clearTimeout(timer); res(); };
  });
  const play = async () => {
    if (!s.token) return;
    if (playing) { stop.current.stopped = true; stop.current.wake?.(); return; }
    stop.current = { stopped: false };
    setPlaying(true); setDayErr('');
    for (let i = 0; i < DAY.length && !stop.current.stopped; i++) {
      setCur(i);
      for (const req of DAY[i].send ?? []) {
        try { await sendDemo(s.token, req); } catch (e: any) { setDayErr(`${DAY[i].at} 보내지 못함 · ${e?.message}`); }
      }
      if (DAY[i].send) ev.reload();
      await wait(STEP_MS[speed]);
    }
    setCur(stop.current.stopped ? -1 : DAY.length);
    setPlaying(false);
    ev.reload();
  };
  useEffect(() => () => { stop.current.stopped = true; stop.current.wake?.(); }, []);

  // 하나씩
  const [sending, setSending] = useState('');
  const [sent, setSent] = useState('');
  const sendOne = async (o: (typeof ONE)[number]) => {
    if (!s.token) return;
    setSending(o.key);
    try {
      if (o.later) { setSent('5초 뒤에 보내요 · 화면 끄고 기다려 보세요'); await new Promise((r) => setTimeout(r, 5000)); }
      const r = await sendDemo(s.token, o.req);
      setSent(`${o.label} 보냈어요 · 알림 ${r.pushed}대`);
      ev.reload();
    } catch (e: any) { setSent(''); Alert.alert('보내지 못했어요', e?.message); }
    finally { setSending(''); }
  };

  // 코스 시험
  const [courseKey, setCourseKey] = useState('');
  const [courseRes, setCourseRes] = useState('');
  const runCourse = async (x: (typeof COURSE_TESTS)[number]) => {
    if (!plan.course) { Alert.alert('고른 코스가 없어요', plan.courseMock ? '모의 엔진을 켜면 기준 코스가 생겨요.' : "추천 시험 ①에서 코스를 하나 고르면 서버가 '살아 있는 코스'를 만들어요."); return; }
    setCourseKey(x.key); setCourseRes('');
    try {
      let r: CourseResult | null = null;
      for (const e of x.events) r = await plan.courseAct(e);
      if (!r) setCourseRes('코스가 없어요');
      else if (!r.ok) setCourseRes(`409 충돌 → 최신 코스 v${r.version}로 바꿨어요`);
      else setCourseRes(`${KIND_TEXT[r.outcome.kind]} · v${r.outcome.course.version}${r.outcome.change ? ` · ${r.outcome.change.text}` : ''}${r.outcome.options ? ` · 카드 ${r.outcome.options.length}장` : ''}`);
    } catch (e: any) { setCourseRes(''); Alert.alert('보내지 못했어요', e?.message); }
    finally { setCourseKey(''); }
  };

  // 상태
  const [status, setStatus] = useState<{ server?: St; push?: St; voice: St; version: string }>({
    voice: { s: 'ok', label: '정상', note: `앱에 ${Object.keys(CLIPS).length}개 내장 · ${VOICE}` },
    version: `${Constants.expoConfig?.version ?? '?'} (${Constants.expoConfig?.android?.versionCode ?? '?'})`,
  });
  const loadStatus = async () => {
    if (!s.token) return;
    const t0 = Date.now();
    const server: St = await within(getMe(s.token), 10000)
      .then(() => ({ s: 'ok' as const, label: sec(Date.now() - t0), note: host }))
      .catch((e: any) => ({ s: 'fail' as const, label: '응답 없음', note: e?.message }));
    const push: St = await (async () => {
      const p = await Notifications.getPermissionsAsync();
      if (!p.granted) return { s: 'fail' as const, label: '꺼짐', note: '알림 권한 없음' };
      const tk = await within(Notifications.getDevicePushTokenAsync(), 8000);
      return { s: 'ok' as const, label: '정상', note: `FCM 등록됨 · 끝 …${String(tk.data).slice(-4)}` };
    })().catch((e: any) => ({ s: 'fail' as const, label: '확인 실패', note: e?.message }));
    setStatus((x) => ({ ...x, server, push }));
  };
  useEffect(() => { loadStatus(); }, [s.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const wipe = () => Alert.alert('데모 차의 소식을 모두 지울까요?', '도장·미션·오늘 흐름이 비워져요.', [
    { text: '취소', style: 'cancel' },
    { text: '지우기', style: 'destructive', onPress: async () => {
      if (!s.token) return;
      try { await clearDemo(s.token); setCur(-1); setSent(''); setSt(CHECKS.map(() => ({ s: 'idle' }))); await ev.reload(); }
      catch (e: any) { Alert.alert('지우지 못했어요', e?.message); }
    } },
  ]);

  return (
    <Page title="개발 모드" right={<Pill text="데모 차" tone="blue" icon="flask-conical" />}
      refresh={<RefreshControl refreshing={false} onRefresh={loadStatus} colors={[t.accent]} progressBackgroundColor={t.surface} />}>
      <T v="cap" c="ink3" style={{ marginHorizontal: 4, marginTop: 2 }}>차 없이 폰 하나로 모든 기능을 시험해요. 통과 코드로 연결했을 때만 보여요.</T>

      {/* 시연용 깔끔 보기: 켜면 개발 표시(도장북 고리·안내 띠·모두 찍기·데모 알약·시험 장면 알약)와 이 탭을 숨긴다 */}
      <Section title="시연용 깔끔 보기" />
      <Surface>
        <Segmented<'off' | 'on'> value="off" onChange={(k) => {
          if (k !== 'on') return;
          tick();
          setDemoClean(true);
          go('today');
        }} options={[{ key: 'off', label: '개발 표시 보이기' }, { key: 'on', label: '깔끔하게 (시연용)' }]} />
        <T v="cap" c="ink3" style={{ marginTop: 10 }}>데모 차에 연결돼 있어도 보통 가족 폰처럼 보여요. 이 개발 탭도 숨겨져요. 다시 보려면 아래 '우리 차' 탭을 길게 누르세요.</T>
        <T v="cap" c="ink3" style={{ marginTop: 2 }}>깔끔 보기에서도 도장북 칸을 길게 누르면 그 도장이 바로 찍혀요.</T>
      </Surface>

      {/* 자랑 카드 캡처 점검용 작은 판 (화면 밖) */}
      <View ref={shot} collapsable={false} pointerEvents="none"
        style={{ position: 'absolute', left: -200, top: 0, width: 48, height: 48, borderRadius: 12, backgroundColor: '#18181B', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 20, height: 20, borderRadius: R.sm, borderWidth: 2.5, borderColor: '#fff' }} />
      </View>

      <Section title="전체 점검 · 병렬" right={finished || running
        ? <T v="cap" c={running ? 'blue' : passed === CHECKS.length ? 'ok' : 'red'} style={{ fontFamily: F.b }}>
            {running ? `${finished}/${CHECKS.length}` : `${passed}/${CHECKS.length} 통과`}
          </T>
        : undefined} />
      <Surface pad={0} style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
        {CHECKS.map((c, i) => (
          <View key={c.title}>
            {i > 0 && <Divider />}
            <Row icon={c.icon} title={c.title} sub={st[i].note ?? c.sub}
              onPress={st[i].s === 'fail' && i === CHECKS.length - 1 ? async () => { await askMedia(true).catch(() => null); runOne(i).catch(() => {}); } : undefined}
              right={<State v={st[i]} />} />
          </View>
        ))}
      </Surface>
      <Btn title={running ? '점검 중…' : '전체 점검 한 번에 돌리기'} icon="play" kind="accent" disabled={running} onPress={runAll} style={{ marginTop: 10 }} />

      <Section title="추천 시험 · 오늘 어디 갈까요?" right={plan.test ? <Pill text="시험 중" tone="blue" /> : undefined} />
      <Surface pad={0} style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
        {PLAN_TESTS.map((x, i) => (
          <View key={x.key}>
            {i > 0 && <Divider />}
            <Row icon={x.key === 'rain' ? 'cloud-rain' : x.key === 'pickup' ? 'school' : 'cloud-sun'} title={x.title}
              sub={`${x.extra.at!.replace('T', ' ')} · ${x.extra.sky === 'RAIN' ? '종일 비' : x.extra.rainFrom ? `${x.extra.rainFrom}부터 비` : '맑음'} · 해 짐 ${x.extra.sunset}`}
              onPress={() => { plan.setTest(x); go('today'); }}
              right={plan.test?.key === x.key ? <Pill text="보는 중" tone="accent" /> : <Icon name="chevron-right" size={16} color={t.ink3} />} />
          </View>
        ))}
      </Surface>
      <T v="cap" c="ink3" style={{ marginTop: 8, marginHorizontal: 4 }}>
        누르면 그 시각·날씨로 서버가 새로 계산해 오늘 탭에 보여 줘요. 오늘 탭의 '실제로 돌아가기'로 끝내요.
      </T>
      {plan.test && <Btn title="실제로 돌아가기" kind="line" icon="undo-2" small onPress={() => plan.setTest(null)} style={{ marginTop: 8, alignSelf: 'flex-start' }} />}
      <Btn title="이야기 코스로 고르기 (화본역 → 테마파크 → 과학관)" kind="line" icon="route" small style={{ marginTop: 8, alignSelf: 'flex-start' }}
        onPress={async () => {
          // 34곳 모두 도장이라 계획 3장에 이야기 코스가 없을 수 있다 → 데모 차만 순서를 정해 고른다 (서버가 '고른 코스' 카드를 붙임)
          if (!plan.data) { Alert.alert('계획이 없어요', "추천 시험 ①을 먼저 켜 주세요."); return; }
          try { await plan.chooseStops(['hwabon', 'samguk', 'dgsm']); go('today'); }
          catch (e) { Alert.alert('고르지 못했어요', e instanceof Error ? e.message : String(e)); }
        }} />

      <Section title="코스 시험 · 살아 있는 코스" right={plan.course ? <Pill text={`v${plan.course.version}${plan.courseMock ? ' · 모의' : ''}`} tone={plan.courseMock ? 'blue' : 'accent'} /> : undefined} />
      <Surface>
        <Segmented<'real' | 'mock'> value={plan.courseMock ? 'mock' : 'real'} onChange={(k) => { plan.setCourseMock(k === 'mock'); setCourseRes(''); }}
          options={[{ key: 'real', label: '실제 서버' }, { key: 'mock', label: '모의 엔진 (서버 없이)' }]} />
        <T v="cap" c="ink3" style={{ marginTop: 8 }}>
          {plan.courseMock
            ? '폰 안의 모의 엔진이 답해요. 서버에 코스 기능이 없을 때 화면만 확인하는 용도예요.'
            : plan.course ? '서버 PATCH /api/plan/course 에 사건을 보내요. 차·다른 폰이 먼저 바꿨으면 409 → 최신으로.'
              : plan.courseError ? `코스 없음 · ${plan.courseError}` : "추천 시험 ①을 켜고 오늘 탭에서 코스를 하나 고르면 서버가 '살아 있는 코스'를 만들어요."}
        </T>
        <View style={{ marginTop: 10 }}>
          {COURSE_TESTS.map((x, i) => (
            <View key={x.key}>
              {i > 0 && <Divider />}
              <Row icon={x.icon} title={x.label} sub={x.sub} onPress={() => runCourse(x)}
                right={courseKey === x.key ? <ActivityIndicator size="small" color={t.blue} /> : <Icon name="send" size={15} color={t.ink3} />} />
            </View>
          ))}
        </View>
        {!!courseRes && <T v="cap" c="ok" style={{ marginTop: 6 }}>{courseRes}</T>}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Btn title="오늘 탭에서 보기" kind="soft" small icon="map" onPress={() => go('today')} />
          {plan.courseMock && <Btn title="코스 처음으로" kind="line" small icon="rotate-ccw" onPress={() => { plan.setCourseMock(true); setCourseRes(''); }} />}
          {!plan.courseMock && <Btn title="다시 받기" kind="line" small icon="refresh-cw" onPress={() => { plan.loadCourse(); setCourseRes(''); }} />}
        </View>
      </Surface>

      <Section title="차 시뮬레이터 · 하루 시나리오" />
      <Surface>
        <Segmented<Speed> value={speed} onChange={setSpeed}
          options={[{ key: 'real', label: '실제 속도 (3분)' }, { key: 'fast', label: '빠르게 (30초)' }]} />
        <View style={{ marginTop: 14, marginLeft: 8, paddingLeft: 18, borderLeftWidth: 2, borderLeftColor: t.fill2 }}>
          {DAY.map((d, i) => {
            const now = i === cur, past = i < cur;
            return (
              <View key={d.at} style={{ paddingVertical: 6, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{
                  position: 'absolute', left: -24, top: 11, width: 10, height: 10, borderRadius: 5,
                  backgroundColor: now ? t.point : past ? t.accent : t.fill2, transform: [{ scale: now ? 1.3 : 1 }],
                }} />
                <T v="cap" c="ink3" style={{ fontSize: 13, fontVariant: ['tabular-nums'], marginRight: 8 }}>{d.at}</T>
                <T v="cap" c={now ? 'ink' : past ? 'ink2' : 'ink3'} style={{ flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: now ? F.b : F.sb }}>{d.label}</T>
                {d.send && <Icon name="send" size={13} color={now ? t.blue : t.ink3} />}
              </View>
            );
          })}
        </View>
        {!!dayErr && <T v="cap" c="red" style={{ marginTop: 8 }}>{dayErr}</T>}
        <Btn title={playing ? '멈추기' : '하루 재생 (알림까지 실제로 와요)'} icon={playing ? 'square' : 'play'} onPress={play} style={{ marginTop: 12 }} />
        <T v="cap" c="ink3" style={{ marginTop: 8 }}>종이비행기 표시가 있는 장면에서 실제 소식을 보내요.</T>
      </Surface>

      <Section title="하나씩 보내기" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ONE.map((o) => (
          <Btn key={o.key} title={o.label} icon={o.icon} kind="soft" small busy={sending === o.key}
            disabled={!!sending && sending !== o.key} onPress={() => sendOne(o)} />
        ))}
      </View>
      <T v="cap" c={sent ? 'ok' : 'ink3'} style={{ marginTop: 8, marginHorizontal: 4 }}>
        {sent || '누르고 바로 홈으로 나가면 실제 알림이 와요. 알림을 누르면 그 화면이 열려요.'}
      </T>

      <Section title="상태" />
      <Surface pad={0} style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
        <Row icon="globe" title="서버 응답" sub={status.server?.note ?? host} right={<State v={status.server ?? { s: 'run' }} />} />
        <Divider />
        <Row icon="bell" title="알림 토큰" sub={status.push?.note ?? '확인 중'} right={<State v={status.push ?? { s: 'run' }} />} />
        <Divider />
        <Row icon="mic" title="소개 음성" sub={status.voice.note!} right={<State v={status.voice} />} />
        <Divider />
        <Row icon="package" title="앱 버전" sub={status.version} right={<T v="cap" c="ink3" style={{ fontFamily: F.b }}>—</T>} />
      </Surface>

      <Btn title="데모 소식 모두 지우기" kind="line" icon="trash-2" onPress={wipe} disabled={playing} style={{ marginTop: 12 }} />
    </Page>
  );
}

function Row({ icon, title, sub, right, onPress }: { icon: IconName; title: string; sub: string; right: ReactNode; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable disabled={!onPress} onPress={() => { tick(); onPress?.(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={t.ink2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="h" style={{ fontSize: 15, lineHeight: 21 }}>{title}</T>
        <T v="cap" c="ink3" numberOfLines={1}>{sub}</T>
      </View>
      <View style={{ maxWidth: '42%', alignItems: 'flex-end' }}>{right}</View>
    </Pressable>
  );
}

function State({ v }: { v: St }) {
  const t = useTheme();
  if (v.s === 'run') return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <ActivityIndicator size="small" color={t.blue} />
      <T v="cap" c="blue" style={{ fontFamily: F.b }}>확인 중</T>
    </View>
  );
  const c = v.s === 'ok' ? 'ok' : v.s === 'fail' ? 'red' : 'ink3';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {v.s === 'ok' && <Icon name="check" size={14} color={t.ok} strokeWidth={2.6} />}
      {v.s === 'fail' && <Icon name="circle-alert" size={13} color={t.red} strokeWidth={2.2} />}
      <T v="cap" c={c} numberOfLines={2} style={{ fontFamily: F.b, textAlign: 'right', flexShrink: 1 }}>{v.label ?? '대기'}</T>
    </View>
  );
}
