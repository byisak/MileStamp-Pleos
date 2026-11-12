// 오늘 탭 '대화하듯 고르기' (docs/대화형-고르기-계획.html) — 한 화면에 질문 하나, 큰 답 버튼 2~4개.
// 흐름: 인사(+날씨·축제 한 줄) → ① 오늘 가세요?(아침) / 지금 들렀다 갈까요?(오후) / 내일 미리 정할까요?(밤)
//   → ② 누구랑 가요? → ③ 어디로? (알아서 · 이번 주말 축제 · 가고 싶은 곳) → ④ 어떤 하루?(알아서일 때) → 결과 카드 한 장
// '내일·주말 미리' → 날 고르기(내일·토·일) → 같은 흐름을 그날(day=)로. 뒤로 가기 = 마지막 답 취소.
// 결과: 카드 1장 + 한 줄 이유('왜?' 첫 줄) + 큰 '이대로 차로 보내기' + '다른 코스 보기' · '코스 고치기'(CourseEditSheet).
// 아는 것(아이 나이·귀가 한계·날씨)은 묻지 않고 질문 아래 한 줄로만 — 누르면 함께 가는 사람 설정.
// 나들이 중(머무는 중) 질문 '조금 더 놀까요?'는 아래 StayAsk (CourseSection이 코스 카드 위에 놓음).
// 서버 계약: GET /api/plan?with=&day= (companion·tomorrowHint·options[i].kind) — 예전 서버면 with·day를 무시한 같은 계획(그대로 씀).
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, FlatList, Pressable, View } from 'react-native';
import { Alert } from '../alert';
import {
  aheadDays, pickableDays, backByText, COMPANION_INFO, companionNow, DayShape, EVENING_BUBBLE, EVENING_Q, eveningLeftText, optionShape, pickByShape,
  setAskMemory, stopsText, useAskMemory,
} from '../ask';
import { driveMin, festivals, festivalStatus, md, today } from '../catalog';
import { durText, ro } from '../course';
import { getList, DEFAULT_FILTERS } from '../explore/api';
import {
  COMPANIONS, Companion, ExploreItem, isMealStop, kidsText, MEAL_WORD, mealWindowOf, PlanOption, PlanRes, previewCourse, putFamily, reasonIcon, span,
  stopsWithMeal, toMin, type MealAlt, type MealJson, type StopRef,
} from '../plan';
import { usePlan } from '../planStore';
import { useSession } from '../session';
import { useSkyNow } from '../skyNow';
import { clock, clockText } from '../timefmt';
import { F, R, S } from '../theme';
import { done, Icon, IconName, plainError, Sheet, Skeleton, T, tick, useTheme } from '../ui';
import { ActionButton, ErrorRow, PrimaryCTA } from '../parts';
import { W } from '../words';
import { summaryOf } from '../summary';
import { useClosedStops, usePlaceDetail } from '../placeDetail';
import { PlacePhoto } from '../parts/PlacePhoto';
import type { Tab } from '../../App';
import { CourseEditSheet, EditStop } from './CourseEditSheet';
import { CourseMiniMap } from './CourseMap';
import { AnchorSheet, anchorOf, dayOf, ExploreSection } from './Explore';
import { FamilySheet } from './FamilySheet';
import { useNearFestivals } from './Festival';
import { Chip, CourseTitle } from './PlanBits';
import type { CourseCtl } from './courseBits';

type Step = 'start' | 'quick' | 'when' | 'who' | 'where' | 'shape' | 'festival' | 'kto100' | 'search' | 'result' | 'others' | 'rest' | 'sent';
/** meal = 이 계획만 밥 자리 넣기 (결과 카드 '점심도 넣어 줘요' · 없으면 가족 설정 '밥도 같이 짜기') */
type Ctx = { day?: string; dayLabel?: string; companion?: Companion; shape?: DayShape; intent?: 'festival'; idx?: number; meal?: boolean };
type Hist = { step: Step; ctx: Ctx; answer: string };

/** 시간대: 아침(~14시) · 오후(~20시) · 저녁(서버 저녁 계획: 해 진 뒤 ~ 귀가 한계 90분 전) · 밤 */
function partOfDay(d: PlanRes | null, now: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = now.getHours();
  if (d?.evening && !d.tomorrowHint) return 'evening';
  if (h >= 20 || h < 5 || (d?.tomorrowHint && h >= 17)) return 'night';
  if (h >= 14 || d?.plan.mode === 'AFTERNOON') return 'afternoon';
  return 'morning';
}

function hello(nick: string | undefined, now: Date) {
  const h = now.getHours();
  const g = h < 5 ? '늦은 밤이에요' : h < 11 ? '좋은 아침이에요' : h < 17 ? '좋은 오후예요' : '좋은 저녁이에요';
  return nick && nick !== '가족' ? `${g}, ${nick}!` : `${g}!`;
}

/** 답 버튼만 있는 짧은 질문 — 답을 화면 아래쪽(엄지 닿는 곳)으로 */
const BOTTOM_STEPS: Step[] = ['start', 'quick', 'when', 'who', 'where', 'shape', 'rest', 'sent'];

/** 지난번처럼 말풍선 글 */
const QUICK_WHO: Record<Companion, string> = { kids: '아이와', couple: '둘이', friends: '친구들이랑', solo: '혼자' };
const QUICK_SHAPE: Record<DayShape, string> = { light: '가볍게 한 곳', full: '알차게 두세 곳', nap: '낮잠 맞춤 코스', evening: '저녁에 잠깐', drive: '야경 드라이브' };

const SKY_WORD: Record<string, string> = { clear: '오늘 날씨가 맑아요', rain: '비가 와요 · 실내 위주로 볼게요', drizzle: '비가 조금 와요', snow: '눈이 와요', sleet: '진눈깨비가 와요' };

/** [initial] 'when' = '언제 갈까요?'부터 (저녁 화면 '내일 코스 미리 정하기' — 뒤로 가면 첫 질문) */
export function Ask({ go, onDetail, initial }: { go: (tab: Tab) => void; onDetail: () => void; initial?: 'when' }) {
  const t = useTheme();
  const p = usePlan();
  const { me, token } = useSession();
  const mem = useAskMemory();
  const sky = useSkyNow(token);
  const nearFest = useNearFestivals();
  const [step, setStep] = useState<Step>(initial ?? 'start');
  const [ctx, setCtx] = useState<Ctx>({});
  const [hist, setHist] = useState<Hist[]>(initial ? [{ step: 'start', ctx: {}, answer: '미리 정할래요' }] : []);
  const [famOpen, setFamOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 방금 보낸(저장한) 코스의 계획 — '취소할래요'가 이 계획만 지우게 (축제·100선 고르기는 모름 → 지금 코스) */
  const [sentPlanId, setSentPlanId] = useState<string | null>(null);
  // 누구랑·어느 날로 따로 받은 계획
  const [plan, setPlan] = useState<{ key: string; res: PlanRes | null; err: string | null } | null>(null);
  // 지금 시각 (개발 탭 '추천 시험' 장면이면 그 장면 시각 — 아침 흐름을 밤에도 확인)
  const now = p.test?.extra.at ? new Date(p.test.extra.at) : new Date();
  // 시간대(아침·오후·밤)는 서버 계획(tomorrowHint·모드)을 받은 뒤 한 번 정하고 고정한다 — 첫 질문·버튼이 그리는 중에
  // 바뀌어 엉뚱한 답이 눌리지 않게 (QA 0.9.7 #4). 받기 전(다시 받는 중 포함)엔 '확인하는 중…'만. 시험 장면을 바꾸면 다시 정한다
  const ready = (!!p.data || !!p.error) && !p.loading;
  const partKey = p.test?.title ?? '';
  const [fixed, setFixed] = useState<{ key: string; part: ReturnType<typeof partOfDay> } | null>(null);
  const part0 = fixed?.key === partKey ? fixed.part : null;
  useEffect(() => { if (ready && part0 == null) setFixed({ key: partKey, part: partOfDay(p.data, now) }); }, [ready, part0, partKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const part = part0 ?? partOfDay(p.data, now);
  const fam = p.family;
  const comp = ctx.companion ?? companionNow(mem.companion ?? fam?.companion);
  const kids = comp === 'kids';
  const hasNap = kids && fam?.napStart != null && fam?.napLen != null && fam.napLen > 0;
  const home = fam?.home ? { lat: fam.home[0], lng: fam.home[1] } : null;
  // 지난번처럼(A1): 동행·하루 모양을 둘 다 기억할 때만. 낮잠 모양은 아이와 + 낮잠 설정이 있을 때만
  const famNap = fam?.napStart != null && fam?.napLen != null && fam.napLen > 0;
  const quickOk = !!mem.companion && !!mem.shape && (mem.shape !== 'nap' || (mem.companion === 'kids' && famNap));
  const afterDay = quickOk ? 'quick' : 'who';

  /** 답 하나 → 다음 질문 (지금 질문·답을 기록해 뒤로 가기로 되돌림) */
  const answer = (label: string, next: Step, patch: Partial<Ctx> = {}) => {
    tick();
    setHist((h) => [...h, { step, ctx, answer: label }]);
    setCtx((c) => ({ ...c, ...patch }));
    setStep(next);
  };
  const back = () => {
    const last = hist[hist.length - 1];
    if (!last) return false;
    tick();
    setHist((h) => h.slice(0, -1));
    setCtx(last.ctx);
    setStep(last.step);
    return true;
  };
  // 안드로이드 뒤로 가기 = 마지막 답 취소 (첫 질문이면 앱 기본)
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => backRef.current());
    return () => sub.remove();
  }, []);

  // 동행을 고르면 그 조건으로 계획을 받아 둔다 (어디로·어떤 하루를 묻는 동안).
  // '가볍게 한 곳만'이면 한 곳짜리 코스로 다시 받는다(maxStops=1). 받은 계획은 조건별로 기억 — 뒤로 가서 바꿔도 다시 안 받음
  const [retry, setRetry] = useState(0);
  const light = ctx.shape === 'light';
  // 밥 자리: 이 계획만 켠 값 → 가족 설정 '밥도 같이 짜기' (기본 끔)
  const mealOn = ctx.meal ?? p.family?.mealPlan ?? false;
  const planKey = ctx.companion ? `${ctx.companion}|${ctx.day ?? ''}|${light ? 1 : ''}|${mealOn ? 'm' : ''}|${retry}` : '';
  const planCache = useRef(new Map<string, { res: PlanRes; at: number }>());
  useEffect(() => {
    if (!planKey || plan?.key === planKey) return;
    const hit = planCache.current.get(planKey);
    if (hit && Date.now() - hit.at < 10 * 60_000) { setPlan({ key: planKey, res: hit.res, err: null }); return; }
    let alive = true;
    setPlan({ key: planKey, res: null, err: null });
    p.fetchPlan({ with: ctx.companion, day: ctx.day, maxStops: light ? 1 : 3, ...(ctx.meal != null ? { meal: ctx.meal } : {}) })
      .then((res) => { planCache.current.set(planKey, { res, at: Date.now() }); if (alive) setPlan({ key: planKey, res, err: null }); })
      .catch((e) => { if (alive) setPlan({ key: planKey, res: null, err: plainError(e, '추천을 불러오지 못했어요') }); });
    return () => { alive = false; };
  }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = plan?.key === planKey ? plan.res : null;

  const pickWho = (c: Companion) => {
    setAskMemory({ companion: c });
    if (token) putFamily(token, { companion: c } as never).catch(() => {}); // 새 서버만 기억 (예전 서버는 무시)
    // 축제를 보러 왔으면 바로 축제, 오후엔 어디로를 묻고 하루 모양은 건너뜀
    answer(COMPANION_INFO[c].bubble, ctx.intent === 'festival' ? 'festival' : 'where', { companion: c });
  };
  // 저녁 모양(저녁에 잠깐·야경 드라이브)은 '지난번처럼'으로 기억하지 않는다 (아침에 다시 묻지 않게)
  const pickShape = (s: DayShape, label: string) => { if (s !== 'evening' && s !== 'drive') setAskMemory({ shape: s }); answer(label, 'result', { shape: s, idx: undefined }); };

  // 결과 카드 번호: 직접 고른 다른 코스 → 하루 모양 → 1순위
  // 오늘 밤(서버 tomorrowHint)이거나 갈 곳이 든 카드가 없으면 결과 카드 대신 '오늘은 늦었어요 → 내일 미리'
  const lateToday = !!res && !ctx.day && !!res.tomorrowHint;
  const idx0 = res && !lateToday ? (ctx.idx ?? pickByShape(res.plan.options, part === 'afternoon' && !ctx.day ? null : ctx.shape ?? null)) : -1;
  // 곳이 하나도 없는 카드('바로 집으로')는 결과로 보이지도, 차로 보내지도 않는다
  const idx = res && idx0 >= 0 && res.plan.options[idx0]?.stops.length ? idx0 : -1;
  const opt0 = res && idx >= 0 ? res.plan.options[idx] : null;
  // 코스 고치기 → '편집 저장': 고친 카드로 결과 카드를 바꿔 보여 주고, '이대로 차로 보내기'는 고친 순서·머무름 그대로 보낸다
  const [edited, setEdited] = useState<{ planId: string; idx: number; option: PlanOption; stops: StopRef[]; anchor?: string; dwell: Record<string, number> } | null>(null);
  const ed = edited && res && edited.planId === res.planId && edited.idx === idx ? edited : null;
  const opt = ed ? ed.option : opt0;

  // 밥 자리 바꾸기('다른 식당')·빼기('밥은 빼기'): 식당만 바꾼 곳 순서로 미리 보기 → 고친 카드처럼 결과 카드에 (보내면 그 순서 그대로)
  const [mealBusy, setMealBusy] = useState(false);
  const meal0 = opt0?.meal ?? null;
  const swapMeal = async (alt: MealAlt | null) => {
    if (!res || !opt || !token || idx < 0) return;
    setMealBusy(true);
    try {
      const refs = stopsWithMeal(opt, alt);
      const anchor = opt.anchorId && refs.some((r) => (typeof r === 'string' ? r : r.id) === opt.anchorId) ? opt.anchorId : undefined;
      const r = await previewCourse(token, { planId: res.planId, stops: refs, ...(anchor ? { anchor } : {}) });
      if (!r.option || !r.fits) throw new Error(alt ? `${alt.name}에 들르면 귀가 시각이 빠듯해요` : '이 순서로는 갈 수 없어요');
      setEdited({ planId: res.planId, idx, option: { ...r.option, anchorId: opt.anchorId ?? r.option.anchorId, ...(alt ? {} : { mealHint: undefined }) }, stops: refs, anchor, dwell: ed?.dwell ?? {} });
      tick();
    } catch (e) {
      Alert.alert(alt ? '식당을 바꾸지 못했어요' : '밥을 빼지 못했어요', plainError(e, '잠시 뒤 다시 눌러 주세요'));
    } finally {
      setMealBusy(false);
    }
  };

  // 다른 날 코스는 '저장만' (그날 아침 차에 뜸, 일정 탭에 모임) · 오늘 코스는 '차로 보내기'
  const saveOnly = !!ctx.day && ctx.day !== today();
  const send = async () => {
    if (!res || idx < 0 || !opt?.stops.length) return;
    setBusy(true);
    try {
      if (ed) await p.choosePlanned(res.planId, { stops: ed.stops, ...(ed.anchor ? { anchor: ed.anchor } : {}) }, ed.dwell);
      else await p.choosePlanned(res.planId, { idx });
      done(); setSentPlanId(res.planId);
      setHist((h) => [...h, { step, ctx, answer: saveOnly ? '이 날로 저장할게요' : '이대로 보낼게요' }]); setStep('sent');
    }
    catch (e) { Alert.alert('보내지 못했어요', plainError(e, '잠시 뒤 다시 눌러 주세요')); }
    finally { setBusy(false); }
  };

  // 보낸 코스 취소 (한 번 더 묻고) — 오늘 탭 코스 카드 '이 코스 취소하기'·되돌리기와 같은 API. 차는 다음 조회 때 코스를 지운다
  const cancelSent = () => Alert.alert(saveOnly ? '저장한 코스를 취소할까요?' : '차에 보낸 코스를 취소할까요?',
    saveOnly ? '일정에서 지워지고, 그날 갈 곳을 다시 고를 수 있어요.' : '차 화면의 코스도 지워지고, 다시 고를 수 있어요.', [
    { text: '아니요', style: 'cancel' },
    { text: '취소하기', style: 'destructive', onPress: async () => {
      setBusy(true);
      try { await p.cancelCourse(sentPlanId ?? undefined); done(); setSentPlanId(null); setHist([]); setCtx({}); setStep('start'); }
      catch (e) { Alert.alert('취소하지 못했어요', plainError(e, '잠시 뒤 다시 눌러 주세요')); }
      finally { setBusy(false); }
    } },
  ]);

  // ---- 위: 진행 막대 · 뒤로 · 자세히 ----
  const total = ctx.intent === 'festival' ? 3 : part === 'afternoon' && !ctx.day ? 4 : 5;
  const progress = step === 'sent' || step === 'result' || step === 'others' ? 1 : Math.min(0.9, (hist.length + 1) / total);
  const top = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m, marginTop: S.m, minHeight: 44 }}>
      {hist.length > 0 && step !== 'sent' ? (
        <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="뒤로 (마지막 답 취소)"
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.line : t.fill })}>
          <Icon name="chevron-left" size={22} color={t.ink} />
        </Pressable>
      ) : <View style={{ width: 4 }} />}
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: t.fill, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(progress * 100)}%`, height: 6, borderRadius: 3, backgroundColor: t.accent }} />
      </View>
      <ActionButton label="자세히" icon="layout-list" tone="ghost" size="sm" onPress={() => { tick(); onDetail(); }} />
    </View>
  );

  // ---- 아는 것 한 줄 (묻지 않음 · 누르면 설정) ----
  // 다른 날을 고르면 오늘 날씨 대신 그날 계획의 기상청 예보(있을 때만), 없으면 숨김 (QA 0.9.7 #13)
  const daySky = ctx.day ? (res?.sky?.weatherSource === 'kma' ? res.sky.sky : null) : undefined;
  const skyBit = daySky !== undefined
    ? (daySky === 'CLEAR' ? '맑음 예보' : daySky === 'RAIN' ? '비 예보' : daySky === 'SNOW' ? '눈 예보' : null)
    : sky ? `${sky.sky === 'clear' ? '맑음' : sky.sky === 'snow' ? '눈' : '비'} ${Math.round(sky.tempC)}°` : null;
  const facts = [
    kids && fam ? kidsText(fam.kidAges) : null,
    hasNap ? `낮잠 ${clock(fam!.napStart!)}` : null,
    fam || !kids ? `${backByText(kids, fam?.text.backBy, res?.plan.backByMin,
      part === 'evening' && !ctx.day && (res ?? p.data)?.evening ? { limitMin: (res ?? p.data)!.plan.backByMin } : null, fam?.lateReturn)} 귀가` : null,
    skyBit,
  ].filter(Boolean).join(' · ');
  const factLine = facts ? (
    <Pressable onPress={() => { tick(); setFamOpen(true); }} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${facts} · 바꾸기`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.s, opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}>
      <T v="cap" c="ink3" style={{ flexShrink: 1 }}>{facts}</T>
      <Icon name="pencil" size={12} color={t.ink3} />
    </Pressable>
  ) : null;

  // ---- 질문 본문 ----
  let bubble: string | null = null;
  let q = '';
  let sub: string | null = null;
  let body: ReactNode = null;
  /** 질문 대신 위에 둘 말풍선 (지난번처럼) */
  let lead: ReactNode = null;
  // 축제 한 줄: 그날(밤 첫 질문이면 내일)까지 열려 있는 것만 — 오늘 끝나는 축제를 내일 계획에 권하지 않게 (QA 0.9.7 #13)
  const festDay = ctx.day ?? (step === 'start' && part === 'night' ? aheadDays(now)[0].day : today());
  const fest0 = nearFest.find((f) => f.ends >= festDay && f.starts <= festDay) ?? null;
  const festLine = fest0 ? `${ctx.day || part === 'night' ? '' : '이번 주말 '}${fest0.name}도 열려요 · ${md(fest0.ends)}까지` : null;

  if (step === 'start' && part0 == null) {
    // 계획을 받기 전: 질문·버튼 대신 자리만 (받으면 그때 한 번 그린다)
    bubble = '확인하는 중…';
    body = (
      <View style={{ gap: S.m, marginTop: S.xl }}>
        <Skeleton h={36} r={R.md} />
        <Skeleton h={64} r={R.lg} />
        <Skeleton h={64} r={R.lg} />
        <Skeleton h={64} r={R.lg} />
      </View>
    );
  } else if (step === 'start') {
    const skyWord = sky ? SKY_WORD[sky.sky] ?? null : null;
    if (part === 'night') {
      const th = p.data?.tomorrowHint;
      const hint = typeof th === 'string' ? th : th && typeof th === 'object' ? th.text ?? null : null;
      const tmr0 = aheadDays(now)[0];
      // 서버가 내일 날짜를 주면 그것 (폰 날짜와 어긋나지 않게)
      const tmr = p.data?.tomorrow ? { ...tmr0, day: p.data.tomorrow } : tmr0;
      bubble = `오늘은 늦었어요. 푹 쉬세요`;
      q = '내일 나들이\n미리 정해 둘까요?';
      sub = hint ?? festLine ?? `${tmr.sub} · 정해 두면 아침에 차에 바로 떠 있어요`;
      body = (
        <Answers items={[
          { title: '내일 코스 정하기', sub: '아침에 차에 바로 떠 있어요', icon: 'calendar', onPress: () => answer('내일 코스 정할래요', afterDay, { day: tmr.day, dayLabel: tmr.label }) },
          { title: '이번 주 축제 보기', sub: '가까운 축제 3곳', icon: 'party-popper', onPress: () => answer('축제 볼래요', 'who', { day: tmr.day, dayLabel: tmr.label, intent: 'festival' }) },
          { title: '괜찮아요', icon: 'moon', onPress: () => answer('괜찮아요', 'rest') },
        ]} />
      );
    } else if (part === 'evening') {
      // 저녁 나들이 (해 진 뒤 ~ 귀가 한계 90분 전): '저녁에 잠깐 나가 볼까요?' — 고르면 누구랑 → 어디로 → 저녁 모양
      const limit = p.data?.plan.backByMin ?? 21 * 60;
      const nowMin = now.getHours() * 60 + now.getMinutes();
      bubble = `${eveningLeftText(nowMin, limit - 90)} 🌙`;
      q = EVENING_Q[comp];
      sub = `${kids ? '아이 잠자기 전' : '늦어도'}(${clock(limit)})까지 돌아와요`;
      body = (
        <Answers items={[
          { title: '네, 저녁에 잠깐', sub: kids ? '짧은 야경 산책·따뜻한 실내' : '야경·드라이브·늦게 여는 곳', icon: 'moon', onPress: () => answer(EVENING_BUBBLE[comp], 'who') },
          { title: '오늘은 쉬어요', icon: 'house', onPress: () => answer('오늘은 쉬어요', 'rest') },
          { title: '내일·주말 미리 정할래요', icon: 'calendar', onPress: () => answer('미리 정할래요', 'when') },
        ]} />
      );
    } else {
      bubble = [hello(me?.me.nickname, now), skyWord].filter(Boolean).join(' ');
      const after = part === 'afternoon';
      q = after ? '지금 어디\n들렀다 갈까요?' : kids ? '오늘 아이들이랑\n나들이 가세요?' : '오늘\n나들이 가세요?';
      sub = festLine;
      body = (
        <Answers items={[
          { title: after ? '네, 들렀다 갈래요' : '네, 가요', icon: 'car-front', onPress: () => answer(after ? '들렀다 갈래요' : '네, 가요', after ? 'who' : afterDay) },
          { title: '오늘은 쉬어요', icon: 'moon', onPress: () => answer('오늘은 쉬어요', 'rest') },
          { title: '내일·주말 미리 정할래요', icon: 'calendar', onPress: () => answer('미리 정할래요', 'when') },
        ]} />
      );
    }
  } else if (step === 'when') {
    q = '언제 갈까요?';
    sub = '정해 두면 그날 아침 차에 바로 떠 있어요';
    body = (
      <>
        <Answers items={[
          ...aheadDays(now).map((d) => ({ title: d.label, sub: d.sub, icon: 'calendar' as IconName, onPress: () => answer(d.label, afterDay, { day: d.day, dayLabel: d.label }) })),
          { title: '다른 날 고르기', sub: '2주 안의 날', icon: 'calendar' as IconName, onPress: () => { tick(); setDateOpen(true); } },
        ]} />
        {/* 달력: 내일부터 13일 · 7칸씩 */}
        <Sheet open={dateOpen} onClose={() => setDateOpen(false)}>
          <T v="title">날짜 고르기</T>
          <T v="sub" c="ink3" style={{ marginTop: S.xs, marginBottom: S.l }}>그날 아침 8:30에 집에서 출발하는 코스로 짜요</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.s }}>
            {pickableDays(now).map((d) => (
              <Pressable key={d.day} accessibilityRole="button" accessibilityLabel={d.label}
                onPress={() => { tick(); setDateOpen(false); answer(d.label, afterDay, { day: d.day, dayLabel: d.label }); }}
                style={({ pressed }) => ({ width: '13%', minWidth: 44, minHeight: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.line : t.fill })}>
                <T v="cap" c={d.dow === 0 || d.dow === 6 ? 'red' : 'ink3'}>{d.wd}</T>
                <T v="h">{d.md.split('/')[1]}</T>
              </Pressable>
            ))}
          </View>
          <T v="cap" c="ink3" style={{ marginTop: S.m }}>{pickableDays(now)[0].md} ~ {pickableDays(now).slice(-1)[0].md}</T>
        </Sheet>
      </>
    );
  } else if (step === 'quick' && mem.companion && mem.shape) {
    // 지난번처럼 할까요? — 네 = 바로 결과, 다르게 = 누구랑부터
    const c = mem.companion, sh = mem.shape;
    lead = <Bubble text={`지난번처럼 ${QUICK_WHO[c]} · ${ro(QUICK_SHAPE[sh])} 할까요?`} />;
    body = (
      <>
        <Answers items={[
          { title: '네, 그렇게', sub: `${COMPANION_INFO[c].label} · ${QUICK_SHAPE[sh]}`, icon: 'circle-check', onPress: () => answer('네, 그렇게', 'result', { companion: c, shape: sh, idx: undefined }) },
          { title: '다르게 고를래요', sub: '누구랑·어디로 다시 골라요', icon: 'pencil', onPress: () => answer('다르게 고를래요', 'who') },
        ]} />
      </>
    );
  } else if (step === 'who') {
    q = '누구랑 가요?';
    sub = '고른 사람에 맞춰 추천이 달라져요';
    const last = mem.companion ?? fam?.companion ?? null;
    body = (
      <Answers items={COMPANIONS.map((c) => ({
        title: COMPANION_INFO[c].label, sub: COMPANION_INFO[c].sub, icon: COMPANION_INFO[c].icon, on: c === last, onPress: () => pickWho(c),
      }))} />
    );
  } else if (step === 'where') {
    q = '어디로 갈까요?';
    sub = '고르기 어려우면 맡겨 주세요';
    const rainy = daySky !== undefined ? daySky === 'RAIN' || daySky === 'SNOW' : sky?.sky === 'rain' || sky?.sky === 'drizzle';
    const autoSub = rainy ? (ctx.day ? '비 예보라 실내 위주로 정해요' : '비 와서 실내 위주로 정해요') : hasNap ? '날씨·낮잠·거리 보고 정해요' : '날씨·거리 보고 정해요';
    const skipShape = part === 'afternoon' && !ctx.day;
    body = (
      <Answers items={[
        { title: '알아서 골라 주세요', sub: autoSub, icon: 'route', onPress: () => answer('알아서 골라 주세요', skipShape ? 'result' : 'shape', { idx: undefined }) },
        { title: ctx.day ? `${ctx.dayLabel ?? '그날'} 축제 볼래요` : '이번 주말 축제 볼래요', sub: '가까운 축제 3곳', icon: 'party-popper', onPress: () => answer('축제 볼래요', 'festival') },
        { title: '한국관광 100선 볼래요', sub: '나라에서 고른 꼭 가 볼 곳', icon: 'trophy', onPress: () => answer('100선 볼래요', 'kto100') },
        { title: '가고 싶은 곳이 있어요', sub: '이름이나 주소로 찾기', icon: 'search', onPress: () => answer('가고 싶은 곳이 있어요', 'search') },
      ]} />
    );
  } else if (step === 'shape' && part === 'evening' && !ctx.day) {
    // 저녁 모양: 저녁에 잠깐(야경 산책·실내) · 야경 드라이브(어른끼리, 드라이브 카드가 있을 때)
    q = '저녁은 어떻게\n보낼까요?';
    sub = res?.sky?.sunsetTip ? `노을은 내일 ${clock(toMin(res.sky.sunsetTip.arriveBy) ?? 0)}쯤 ${res.sky.sunsetTip.name}에서 보기 좋아요` : '하나만 골라 주세요';
    const hasDrive = !!res?.plan.options.some((o) => optionShape(o) === 'drive');
    body = (
      <Answers items={[
        { title: '저녁에 잠깐', sub: kids ? '가까운 야경 산책이나 따뜻한 실내' : '야경 보며 한두 곳', icon: 'moon' as IconName, onPress: () => pickShape('evening', '저녁에 잠깐') },
        ...(!kids && (hasDrive || !res) ? [{ title: '야경 드라이브', sub: '내리지 않아도 좋은 길', icon: 'car' as IconName, onPress: () => pickShape('drive', '야경 드라이브') }] : []),
      ]} />
    );
  } else if (step === 'shape') {
    q = ctx.day ? `${ctx.dayLabel ?? '그날'}은 어떤\n하루면 좋겠어요?` : '오늘은 어떤\n하루면 좋겠어요?';
    sub = '하나만 골라 주세요';
    const last = mem.shape;
    body = (
      <Answers items={[
        { title: '가볍게 한 곳만', sub: kids ? '점심 전후로 돌아와요' : '반나절이면 돌아와요', icon: 'map-pin' as IconName, on: last === 'light', onPress: () => pickShape('light', '가볍게 한 곳만') },
        { title: '두세 곳 알차게', sub: kids ? '해 지기 전까지' : '여유 있게 하루 종일', icon: 'route' as IconName, on: last === 'full', onPress: () => pickShape('full', '두세 곳 알차게') },
        ...(hasNap ? [{ title: '낮잠 시간 맞춰서', sub: '차에서 푹 재워요', icon: 'moon' as IconName, on: last === 'nap', onPress: () => pickShape('nap', '낮잠 시간 맞춰서') }] : []),
      ]} />
    );
  } else if (step === 'rest') {
    bubble = part === 'night' ? '네, 푹 쉬세요. 내일 아침에 다시 물어볼게요' : '네, 오늘은 푹 쉬어요';
    q = '그럼 이건 어때요?';
    body = (
      <Answers items={[
        { title: '내일·주말 미리 정할래요', icon: 'calendar', onPress: () => answer('미리 정할래요', 'when') },
        { title: '도장북 보기', sub: '지금까지 모은 도장', icon: 'stamp', onPress: () => { tick(); go('stamps'); } },
        { title: '오늘 화면 자세히', icon: 'layout-list', onPress: () => { tick(); onDetail(); } },
      ]} />
    );
  } else if (step === 'festival') {
    q = ctx.day ? '어느 축제에 갈까요?' : '이번 주말 어느 축제에\n갈까요?';
    sub = '한 곳을 고르면 그곳 중심으로 앞뒤를 짜 드려요';
    body = <FestivalPick day={ctx.day} onChosen={() => { setHist((h) => [...h, { step, ctx, answer: '이 축제로 갈게요' }]); setStep('sent'); }} />;
  } else if (step === 'kto100') {
    q = '100선 중 어디로 갈까요?';
    sub = '한 곳을 고르면 그곳 중심으로 앞뒤를 짜 드려요';
    body = (
      <>
        {/* 왜 100선인가: 처음 보는 사람도 알 수 있게 한 장으로 */}
        <View style={{ marginTop: S.l, backgroundColor: t.fill, borderRadius: R.lg, padding: S.l, gap: S.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s }}>
            <Icon name="trophy" size={18} color={t.accent} />
            <T v="h">한국관광 100선이 뭐예요?</T>
          </View>
          <T v="sub" c="ink2">문화체육관광부와 한국관광공사가 <T v="sub" style={{ fontFamily: F.b }}>2년마다</T> 고르는 '한국인이 꼭 가 봐야 할 국내 관광지 100곳'이에요. 지금은 2025~2026년 판이에요.</T>
          <T v="sub" c="ink2">이름난 곳이라 길·주차·화장실 같은 편의가 대체로 잘 갖춰져 있고, 처음 가는 곳이라도 실패가 적어요.</T>
          <T v="cap" c="ink3">우리 명소와 같은 곳은 도장을 찍고, 그 밖은 '다녀옴'으로 기록해요 · 관광공사 공식 스탬프와는 별개예요</T>
        </View>
        <View style={{ marginTop: S.l }}>
          <ExploreSection tab="kto100" day={ctx.day} onChosen={() => { setHist((h) => [...h, { step, ctx, answer: '여기로 갈게요' }]); setStep('sent'); }} />
        </View>
      </>
    );
  } else if (step === 'search') {
    body = <ExploreSection tab="search" day={ctx.day} onChosen={() => { setHist((h) => [...h, { step, ctx, answer: '여기로 갈게요' }]); setStep('sent'); }} />;
  } else if (step === 'sent') {
    bubble = saveOnly ? `좋아요! ${ctx.dayLabel ?? '그날'} 나들이를 일정에 저장했어요` : ctx.day ? `좋아요! ${ctx.dayLabel ?? '그날'} 아침 차 화면에 이 코스가 떠 있어요` : '좋아요! 시동 걸면 차 화면에 이 코스가 떠 있어요';
    q = '즐거운 나들이 되세요';
    sub = saveOnly ? '일정 탭에서 날짜별로 보고, 고치거나 날짜를 옮길 수 있어요. 그날 아침 시동을 걸면 차 화면에 떠요' : null;
    body = (
      <Answers items={[
        saveOnly
          ? { title: '일정 탭에서 보기', icon: 'calendar', onPress: () => { tick(); go('schedule'); } }
          : { title: '오늘 화면 자세히', icon: 'layout-list', onPress: () => { tick(); onDetail(); } },
        // 코스 바꾸기 = 보내기 전 화면(결과·다른 코스·고르던 목록)으로 — 다른 것을 보내면 그 코스로 바뀐다
        { title: '코스 바꾸기', icon: 'arrow-left-right', onPress: () => { back(); } },
        { title: '취소할래요', icon: 'circle-x', disabled: busy, onPress: cancelSent },
        { title: '처음부터 다시', icon: 'rotate-ccw', onPress: () => { tick(); setHist([]); setCtx({}); setStep('start'); } },
      ]} />
    );
  }

  // 내일 (서버가 내일 날짜를 주면 그것 — 폰 날짜와 어긋나지 않게)
  const tmrBase = aheadDays(now)[0];
  const tmrDay = res?.tomorrow ?? p.data?.tomorrow;
  const tmrNow = tmrDay ? { ...tmrBase, day: tmrDay } : tmrBase;

  // 결과 · 다른 코스: 계획을 기다리는 중 / 실패 / 카드
  const waiting = (step === 'result' || step === 'others') && !res;
  return (
    <View style={{ flexGrow: 1 }}>
      {top}
      {/* 앱 말풍선 (첫 화면 인사 · 밤 · 쉬기 · 보냄) */}
      {!!bubble && <Bubble text={bubble} />}
      {/* 지난 답 (오른쪽 말풍선) — 최근 3개만 */}
      {hist.slice(-3).map((h, i) => <Mine key={`${hist.length}-${i}`} text={h.answer} />)}

      {step === 'result' && (
        waiting ? <PlanWait err={plan?.err ?? null} onRetry={() => setRetry((n) => n + 1)} />
          : opt ? (
            <ResultCard res={res!} o={opt} kids={kids} home={home} dayLabel={ctx.day ? ctx.dayLabel : undefined} busy={busy}
              others={res!.plan.options.filter((x, i) => i !== idx && x.stops.length).length}
              save={saveOnly} onSend={send} onOthers={() => answer('다른 코스 볼래요', 'others')} onEdit={() => { tick(); setEditOpen(true); }}
              meal={{
                on: mealOn, orig: meal0, origStops: opt0?.stops ?? [], busy: mealBusy,
                onTurnOn: () => { tick(); setEdited(null); setCtx((c) => ({ ...c, meal: true, idx: undefined })); },
                onTurnOff: () => { tick(); setEdited(null); setCtx((c) => ({ ...c, meal: false, idx: undefined })); },
                onSwap: swapMeal,
              }} />
          ) : ctx.day ? (
            <>
              <Bubble text="그날은 갈 만한 곳을 못 찾았어요" />
              <Answers items={[
                { title: '다른 날 고를래요', icon: 'calendar', onPress: () => answer('다른 날 고를래요', 'when', { day: undefined, dayLabel: undefined, idx: undefined }) },
                { title: '오늘 화면 자세히', icon: 'layout-list', onPress: () => { tick(); onDetail(); } },
              ]} />
            </>
          ) : (
            // 오늘은 더 갈 곳이 없음 (해 짐·귀가 한계·문 닫을 시간) → 내일 미리 (고른 동행은 그대로)
            <>
              <Bubble text={lateToday ? '오늘은 늦었어요. 지금 나서면 집에 올 시간이 빠듯해요' : '지금은 갈 만한 곳이 없어요. 문 닫을 시간이 가깝거나 집에 올 시간이 빠듯해요'} />
              <Question q={'내일 나들이\n미리 정해 둘까요?'} sub="정해 두면 아침에 차에 바로 떠 있어요" small />
              <Answers items={[
                { title: '내일 코스 정하기', sub: tmrNow.sub, icon: 'calendar', onPress: () => answer('내일 코스 정할래요', 'where', { day: tmrNow.day, dayLabel: tmrNow.label, idx: undefined }) },
                { title: '다른 날 고르기', sub: '주말·2주 안의 날', icon: 'calendar', onPress: () => answer('다른 날 고를래요', 'when', { idx: undefined }) },
                { title: '괜찮아요', icon: 'moon', onPress: () => answer('괜찮아요', 'rest') },
              ]} />
            </>
          )
      )}
      {step === 'others' && (
        waiting ? <PlanWait err={plan?.err ?? null} onRetry={() => setRetry((n) => n + 1)} /> : (
          <>
            <Bubble text="옆으로 넘겨 보세요. 마음에 들면 '이걸로 할게요'" />
            <OtherPager res={res!} skip={idx} kids={kids} home={home}
              onPick={(i) => { tick(); setHist((h) => h.slice(0, -1)); setCtx((c) => ({ ...c, idx: i })); setStep('result'); }} />
          </>
        )
      )}
      {step !== 'result' && step !== 'others' && (
        <>
          {lead}
          {!!q && <Question q={q} sub={sub} />}
          {!!q && step !== 'sent' && factLine}
          {/* 엄지 닿는 곳(A4): 답 버튼만 있는 짧은 질문은 답을 아래쪽으로 (긴 목록은 그대로 위에서부터) */}
          {BOTTOM_STEPS.includes(step) && <View style={{ flexGrow: 1, minHeight: S.xl }} />}
          {body}
        </>
      )}
      {step === 'result' && opt && factLine}

      <FamilySheet open={famOpen} onClose={() => setFamOpen(false)} />
      {res && opt && editOpen && (
        // 순서 바꾸기(위·아래)·빼기·더하기·머무름 — 바뀐 순서 그대로 choose {stops}. 바깥 장소는 이름·좌표째, 앵커 카드면 중심 곳은 못 뺌
        <CourseEditSheet open onClose={() => setEditOpen(false)} day={res.day} planId={res.planId} anchorId={opt.anchorId ?? undefined}
          stopRef={(id) => askStopRef(opt0 ?? opt, id)} applyLabel="편집 저장" applyIcon="check"
          initial={opt.stops.map((st): EditStop => ({ id: st.id, name: isMealStop(st.id) ? `🍽 ${st.name}` : st.name, indoor: st.indoor, dwell: ed?.dwell[st.id] ?? st.dwell?.minutes ?? (isMealStop(st.id) ? 50 : 60) }))}
          initialDwell={ed?.dwell}
          onApply={async (stops, dwell, option) => {
            const refs = stops.map((id) => askStopRef(opt0 ?? opt, id));
            const anchor = opt.anchorId && stops.includes(opt.anchorId) ? opt.anchorId : undefined;
            // 미리 본 카드가 없으면(드묾) 예전처럼 바로 보낸다
            if (!option) {
              await p.choosePlanned(res.planId, { stops: refs, ...(anchor ? { anchor } : {}) }, dwell);
              setEditOpen(false); setSentPlanId(res.planId);
              setHist((h) => [...h, { step, ctx, answer: saveOnly ? '고친 코스로 저장할게요' : '고친 코스로 보낼게요' }]);
              setStep('sent');
              return;
            }
            setEdited({ planId: res.planId, idx, option: { ...option, anchorId: opt.anchorId ?? option.anchorId }, stops: refs, anchor, dwell });
            done();
            setEditOpen(false);
          }} />
      )}
      {/* 아래 큰 '이전으로' — 위 작은 뒤로와 같은 동작 (엄지로 누르기 쉽게) */}
      {hist.length > 0 && step !== 'sent' && (
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="이전 질문으로 (마지막 답 취소)"
          style={({ pressed }) => ({ alignSelf: 'center', marginTop: S.xl, minHeight: 52, paddingHorizontal: 28, borderRadius: 26, flexDirection: 'row', alignItems: 'center', gap: S.s, backgroundColor: pressed ? t.line : t.fill })}>
          <Icon name="chevron-left" size={20} color={t.ink} />
          <T v="h">이전 질문으로</T>
        </Pressable>
      )}
    </View>
  );
}

/** 코스 고치기로 보낼 칸: 바깥 장소(ext)는 이름·좌표째, 그 밖은 id */
function askStopRef(o: PlanOption, id: string): StopRef {
  const st = o.stops.find((x) => x.id === id);
  return st?.ext ? { id, ...st.ext } : id;
}

// ---------- 결과 카드 ----------
/** 받침에 맞는 '은/는' */
function iEun(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '은' : '는';
}

/** 카드 안쪽: 코스 이름 · 시각 · 작은 지도(+비교) · 한 줄 이유 · 칩 — 결과 카드와 다른 코스 넘기기 카드가 같이 씀 */
function CourseCardBody({ res, o, kids, home, map }: { res: PlanRes; o: PlanOption; kids: boolean; home: { lat: number; lng: number } | null; map: boolean }) {
  const t = useTheme();
  const p = usePlan();
  // 오늘 계획은 지금 있는 곳에서 출발 (다른 날은 집에서 08:30)
  const start = res.day === today() ? p.hereNow() : null;
  const depart = o.legs[0]?.fromMin ?? res.plan.nowMin;
  const stamps = o.stops.filter((s) => s.stampable).length;
  // 밥 자리(식당)는 이름 줄·곳 수에 안 넣는다 (아래 🍽 줄로 따로)
  const places = o.stops.filter((s) => !isMealStop(s.id));
  const meta = [`${clock(depart)} 출발`, `${clock(o.arriveHomeMin)} 집 도착`, places.length === 1 ? '한 곳' : null, stamps ? `도장 ${stamps}개` : null].filter(Boolean).join(' · ');
  // 한 줄 이유 (B1): 센 이유 2~3개를 동행에 맞춘 한 문장으로 (summary.ts). 못 만들면 예전처럼 '왜?' 첫 줄 → 이유 칩 첫 개.
  // 아이와가 아니면 아이·낮잠 말은 건너뜀
  const comp: Companion = res.companion ?? (kids ? 'kids' : 'couple');
  const kidWord = /아이|낮잠|재울/;
  const whyLines = (o.why ?? []).flatMap((w) => w.lines.map((l) => l.text));
  const sum = summaryOf(o, comp);
  const reason = sum?.text ?? (kids ? whyLines : whyLines.filter((x) => !kidWord.test(x)))[0]
    ?? (kids ? o.reasons : o.reasons.filter((r) => !kidWord.test(r.text)))[0]?.text ?? null;
  const used = new Set(sum?.used ?? []);
  // 밥 칩은 🍽 줄이 따로 보여 주므로 칩에서 뺀다
  const chips = (kids ? o.reasons : o.reasons.filter((r) => !kidWord.test(r.text))).filter((r) => r.tone !== 'MEAL' && r.text !== reason && !used.has(r.text)).slice(0, 2);
  // 사진·운영 정보 (B2·B3): 앵커가 있으면 그곳, 아니면 첫 곳
  const key = o.stops.find((s) => s.id === o.anchorId) ?? places[0] ?? o.stops[0];
  const detail = usePlaceDetail(map ? key?.id : null, res.day);
  return (
    <>
      {map ? <PlacePhoto uri={detail?.image} id={key?.id} h={140} wait={!detail} style={{ marginBottom: S.l }} />
        : <View style={{ height: 140, marginBottom: S.l, borderRadius: R.md, backgroundColor: t.fill }} />}
      <CourseTitle names={places.map((s) => s.name)} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.s, minHeight: 18 }}>
        <Icon name="clock" size={13} color={t.ink3} />
        <T v="cap" c="ink3" numberOfLines={1} style={{ flex: 1 }}>
          {detail ? clockText(`${o.stops.length > 1 && key ? `${key.name} · ` : ''}${detail.line}`) : ' '}
        </T>
      </View>
      <T v="cap" c="ink2" style={{ marginTop: S.xs, fontVariant: ['tabular-nums'] }}>{meta}</T>
      {/* 작은 지도: 보이는 카드만 그린다 (안 보이는 넘기기 카드는 자리만) */}
      {map ? <CourseMiniMap o={o} home={home} start={start} day={res.day} /> : <View style={{ height: 160, marginTop: S.l, borderRadius: R.md, backgroundColor: t.fill }} />}
      {!!reason && (
        <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.l, backgroundColor: t.fill, borderRadius: R.md, padding: S.l }}>
          <Icon name="circle-check" size={16} color={t.accent} style={{ marginTop: 1 }} />
          <T v="sub" style={{ flex: 1 }}>{clockText(reason)}</T>
        </View>
      )}
      {chips.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.xs + 1, marginTop: S.m }}>
          {chips.map((r) => <Chip key={r.text} parts={[{ icon: reasonIcon(r), text: clockText(r.text.replace(/^1곳 ·/, '한 곳 ·')) }]} tone={r.tone} />)}
        </View>
      )}
    </>
  );
}

function ResultCard({ res, o, kids, home, dayLabel, busy, others, save, onSend, onOthers, onEdit, meal }: {
  res: PlanRes; o: PlanOption; kids: boolean; home: { lat: number; lng: number } | null; dayLabel?: string; busy: boolean; others: number;
  /** 다른 날 코스: 큰 버튼이 '이 날로 저장' (차로 보내는 건 그날 아침) */
  save?: boolean;
  onSend: () => void; onOthers: () => void; onEdit: () => void;
  meal?: MealCtl;
}) {
  const t = useTheme();
  // 그날 쉬는 곳이 든 코스는 차로 보내지 않는다 (서버가 거르지만 옛 계획·고친 코스 대비)
  const closed = useClosedStops(o.stops, res.day);
  return (
    <>
      <Bubble text={dayLabel ? `${dayLabel}은 이렇게 다녀오면 어때요?` : '이렇게 다녀오면 어때요?'} />
      <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.xl }}>
        <CourseCardBody res={res} o={o} kids={kids} home={home} map />
        {meal && <MealRow o={o} ctl={meal} busy={busy} />}
        {closed.names.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.xl, backgroundColor: t.redSoft, borderRadius: R.md, padding: S.l }}>
            <Icon name="triangle-alert" size={16} color={t.redText} style={{ marginTop: 1 }} />
            <T v="sub" c="redText" style={{ flex: 1 }}>{closed.names.join(', ')}{iEun(closed.names[closed.names.length - 1])} {dayLabel ?? '오늘'} 쉬는 날이에요. 다른 코스를 보거나 고쳐 주세요</T>
          </View>
        ) : (
          <PrimaryCTA title={save ? '이 날로 저장' : `이대로 ${W.send}`} icon={save ? 'calendar-check' : 'send'} sub={save ? '일정 탭에 모여요 · 그날 아침 차 화면에 떠요' : undefined}
            busy={busy || !closed.ready} onPress={onSend} style={{ marginTop: S.xl }} />
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: S.xs, marginTop: S.m }}>
          {others > 0 && <ActionButton label={`다른 코스 ${others}개 보기`} tone="ghost" size="sm" disabled={busy} onPress={onOthers} />}
          {others > 0 && <T v="cap" c="ink3">·</T>}
          <ActionButton label="코스 고치기" tone="ghost" size="sm" disabled={busy} onPress={onEdit} />
        </View>
      </View>
    </>
  );
}

/** 다른 코스: 옆으로 넘기는 카드 + 점 (A3). 지도는 넘겨서 본 카드만 */
function OtherPager({ res, skip, kids, home, onPick }: {
  res: PlanRes; skip: number; kids: boolean; home: { lat: number; lng: number } | null; onPick: (i: number) => void;
}) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const [page, setPage] = useState(0);
  // 한 번 본 카드의 지도는 그대로 둔다 (다시 넘겨 와도 새로 안 불러오게)
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));
  const items = res.plan.options.map((o, i) => ({ o, i })).filter(({ o, i }) => i !== skip && o.stops.length);
  const gap = S.m;
  return (
    <View style={{ marginTop: S.l }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      {w > 0 && (
        <FlatList horizontal pagingEnabled={false} snapToInterval={w + gap} decelerationRate="fast" disableIntervalMomentum
          showsHorizontalScrollIndicator={false} data={items} keyExtractor={(x) => String(x.i)}
          ItemSeparatorComponent={() => <View style={{ width: gap }} />}
          onMomentumScrollEnd={(e) => { const n = Math.round(e.nativeEvent.contentOffset.x / (w + gap)); setPage(n); setSeen((s0) => (s0.has(n) ? s0 : new Set(s0).add(n))); }}
          renderItem={({ item, index }) => (
            <View style={{ width: w, backgroundColor: t.surface, borderRadius: R.lg, padding: S.xl }}>
              <T v="cap" c="ink3" style={{ marginBottom: S.s }}>{index + 1} / {items.length} · {item.o.stops.length > 1 ? `${stopsText(item.o.stops.length)} 코스` : '한 곳만'}{optionShape(item.o) === 'nap' && kids ? ' · 낮잠 맞춤' : ''}</T>
              <CourseCardBody res={res} o={item.o} kids={kids} home={home} map={seen.has(index)} />
              <PrimaryCTA title="이걸로 할게요" icon="check" onPress={() => onPick(item.i)} style={{ marginTop: S.xl }} />
            </View>
          )} />
      )}
      {items.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: S.s, marginTop: S.m }} accessibilityLabel={`${items.length}개 중 ${page + 1}번째`}>
          {items.map((x, i) => <View key={x.i} style={{ width: i === page ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: i === page ? t.accent : t.line }} />)}
        </View>
      )}
    </View>
  );
}

function PlanWait({ err, onRetry }: { err: string | null; onRetry: () => void }) {
  if (err) return <ErrorRow title={err} sub="인터넷을 확인하고 다시 해 주세요" onRetry={onRetry} style={{ marginTop: S.l }} />;
  return (
    <View style={{ marginTop: S.l, gap: S.m }}>
      <Bubble text="날씨·거리·귀가 시간을 보고 짜는 중이에요…" />
      <Skeleton h={180} r={R.lg} />
    </View>
  );
}

// ---------- 축제 3곳 ----------
function FestivalPick({ day, onChosen }: { day?: string; onChosen: () => void }) {
  const t = useTheme();
  const { token } = useSession();
  const p = usePlan();
  const [items, setItems] = useState<ExploreItem[] | null>(null);
  const [pick, setPick] = useState<{ anchor: ReturnType<typeof anchorOf>; day?: string; driveMin: number | null } | null>(null);
  const [more, setMore] = useState(false);
  const home = p.family?.home ? { lat: p.family.home[0], lng: p.family.home[1] } : { lat: 35.8858, lng: 128.5828 };
  // 앱에 든 등록 축제 (서버 목록이 없거나 실패할 때)
  const local = useMemo((): ExploreItem[] => festivals().filter((f) => festivalStatus(f, day ?? today()) !== 'ended').map((f): ExploreItem => ({
    kind: 'festival', id: f.id, name: f.name, starts: f.starts, ends: f.ends, lat: f.lat, lng: f.lng, addr: '', image: f.poster,
    driveMin: driveMin(home, f), indoor: f.indoor, ourStamp: true, thisWeekend: festivalStatus(f) === 'running',
  })).sort((a, b) => (a.driveMin ?? 0) - (b.driveMin ?? 0)), [day]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!token) return;
    let alive = true;
    getList(token, 'festivals', DEFAULT_FILTERS, { day })
      .then((r) => { if (alive) setItems(r.status === 'ok' && r.items.length ? r.items : local); })
      .catch(() => { if (alive) setItems(local); });
    return () => { alive = false; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  // 고른 날에 열리는 것 먼저 → 이번 주말 → 가까운 순
  const open = (it: ExploreItem) => !day || !it.starts || !it.ends || (it.starts <= day && day <= it.ends);
  // 그날(없으면 오늘) 전에 끝나는 축제는 빼고 (QA 0.9.7 #13)
  const by = day ?? today();
  const top3 = (items ?? []).filter((x) => (x.kind === 'festival' || (x.starts && x.ends)) && (!x.ends || x.ends >= by))
    .sort((a, b) => Number(open(b)) - Number(open(a)) || (b.fitSign ?? 0) - (a.fitSign ?? 0) || Number(!!b.thisWeekend) - Number(!!a.thisWeekend) || (a.driveMin ?? 1e9) - (b.driveMin ?? 1e9))
    .slice(0, 3);
  return (
    <View style={{ marginTop: S.l }}>
      {items === null ? <Skeleton h={200} r={R.lg} /> : top3.length === 0 ? (
        <Bubble text="가까운 곳에 열리는 축제가 없어요. 뒤로 가서 '알아서 골라 주세요'를 눌러 보세요" />
      ) : (
        <View style={{ gap: S.m }}>
          {top3.map((it) => (
            <AnswerBtn key={it.id} icon="party-popper" title={it.name} photo={{ uri: it.image, id: it.id }}
              sub={[it.starts && it.ends ? `${md(it.starts)}~${md(it.ends)}` : null, it.driveMin != null ? `차로 ${span(it.driveMin)}` : null, it.indoor == null ? null : it.indoor ? '실내' : '야외', it.fitNote ?? null, day && !open(it) ? '그날은 안 열려요' : null].filter(Boolean).join(' · ')}
              onPress={() => { tick(); setPick({ anchor: anchorOf(it), day: day && open(it) ? day : dayOf(it), driveMin: it.driveMin }); }} />
          ))}
        </View>
      )}
      {/* 3곳 말고 더: 전국·지역 고르기·지도 (축제 탐색 화면 그대로, 고른 날 기준) */}
      {items !== null && (more ? (
        <View style={{ marginTop: S.l }}>
          <ExploreSection tab="festival" day={day} onChosen={onChosen} />
        </View>
      ) : (
        <View style={{ marginTop: S.m }}>
          <AnswerBtn icon="map" title="전국 축제 더 보기" sub="지역 고르기 · 지도로 보기"
            onPress={() => { tick(); setMore(true); }} />
        </View>
      ))}
      <AnchorSheet target={pick} onClose={() => setPick(null)} onChosen={() => { setPick(null); onChosen(); }} />
    </View>
  );
}

// ---------- 나들이 중: 조금 더 놀까요? ----------
/** 머무는 중(stay)일 때 코스 카드 위. 답: 30분 더(ExtendStay 30) · 시간 맞춰 나갈게요(그대로 · 지금 나가면 ExtendStay 0) · 집으로 바로(GoHome 확인) */
export function StayAsk({ ctl }: { ctl: CourseCtl }) {
  const t = useTheme();
  const { c, stage, rem, busy, placeName } = ctl;
  const [said, setSaid] = useState<string | null>(null);
  if (stage.kind !== 'stay') return null;
  const s = stage.stop;
  const key = `${s.placeId}:${s.plannedDepartMin}`;
  const name = placeName(s.placeId);
  const nextName = rem[0] ? placeName(rem[0].placeId) : null;
  const leave = clock(s.plannedDepartMin);
  const answered = said === key;
  return (
    <View style={{ marginBottom: S.l }}>
      <Bubble text={`${name}에서 노는 중이에요 · ${leave}까지`} />
      {answered ? (
        <>
          <Mine text="시간 맞춰 나갈게요" />
          <Bubble text={`좋아요. ${leave}에 나서면 ${nextName ? `${nextName}도 들르고 ` : ''}${clock(c.arriveHomeMin)}에 ${ro(ctl.dest)} 가요`} />
          <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.s, justifyContent: 'flex-end' }}>
            <ActionButton label={W.leaveNow} icon="car-front" tone="ghost" size="sm" disabled={busy} onPress={() => ctl.act({ type: 'ExtendStay', minutes: 0 })} />
            <ActionButton label="다시 묻기" icon="rotate-ccw" tone="ghost" size="sm" onPress={() => setSaid(null)} />
          </View>
        </>
      ) : (
        <>
          <Question q="조금 더 놀까요?" sub={`${nextName ? `다음은 ${nextName} · ` : ''}${ctl.dest} ${clock(c.arriveHomeMin)} 도착 예정`} small />
          <Answers items={[
            { title: '30분 더 놀래요', sub: `${clock(s.plannedDepartMin + 30)}에 나서요 · 뒤 일정을 다시 맞춰요`, icon: 'hourglass', disabled: busy, onPress: () => { tick(); ctl.act({ type: 'ExtendStay', minutes: 30 }); } },
            { title: '시간 맞춰 나갈게요', sub: `${leave}에 나서요 · 머무름 ${durText(s.dwellGuessMin)}`, icon: 'clock', disabled: busy, onPress: () => { tick(); setSaid(key); } },
            { title: `${ctl.dest === '집' ? '집으로' : ro(ctl.dest)} 바로 갈래요`, sub: nextName ? `${nextName}은 다음에` : '남은 곳 없이 바로', icon: 'house', disabled: busy, onPress: () => { tick(); ctl.goHome(false); } },
          ]} />
        </>
      )}
    </View>
  );
}

// ---------- 말풍선 · 질문 · 답 버튼 ----------
/** 앱 말풍선 (왼쪽) — 이름 없는 'M' */
export function Bubble({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.m, marginTop: S.l }}>
      <View accessibilityLabel="마일스탬프" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
        <T v="label" c="onAccent" style={{ fontFamily: F.xb, fontSize: 15 }}>M</T>
      </View>
      <View style={{ flexShrink: 1, backgroundColor: t.surface, borderRadius: R.lg, borderTopLeftRadius: 6, paddingHorizontal: S.l + 2, paddingVertical: S.m + 2, maxWidth: '84%' }}>
        <T v="sub">{text}</T>
      </View>
    </View>
  );
}

/** 내가 고른 답 (오른쪽) */
function Mine({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'flex-end', marginTop: S.m }}>
      <View style={{ backgroundColor: t.accentSoft, borderRadius: R.lg, borderTopRightRadius: 6, paddingHorizontal: S.l + 2, paddingVertical: S.s + 2, maxWidth: '80%' }}>
        <T v="sub" style={{ color: t.accentInk, fontFamily: F.b }}>{text}</T>
      </View>
    </View>
  );
}

function Question({ q, sub, small }: { q: string; sub?: string | null; small?: boolean }) {
  return (
    <View style={{ marginTop: small ? S.l : S.sec }}>
      <T v="display" accessibilityRole="header" style={small ? { fontSize: 22, lineHeight: 30 } : { fontSize: 27, lineHeight: 36 }}>{q}</T>
      {!!sub && <T v="sub" c="ink3" style={{ marginTop: S.s }}>{sub}</T>}
    </View>
  );
}

type AnswerItem = { title: string; sub?: string; icon?: IconName; on?: boolean; disabled?: boolean; onPress: () => void;
  /** 아이콘 대신 장소 사진 (축제 3곳 등) */
  photo?: { uri: string | null; id: string } };
function Answers({ items }: { items: AnswerItem[] }) {
  return <View style={{ gap: S.m, marginTop: S.xl }}>{items.map((x) => <AnswerBtn key={x.title} {...x} />)}</View>;
}

/** 큰 답 버튼 (높이 64 이상) — on = 지난번 고른 것 (테두리 + '지난번') */
function AnswerBtn({ title, sub, icon, on, disabled, onPress, photo }: AnswerItem) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={sub ? `${title}, ${sub}` : title} accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ minHeight: 64, borderRadius: R.lg, backgroundColor: t.surface, paddingHorizontal: S.xl, paddingVertical: S.l,
        flexDirection: 'row', alignItems: 'center', gap: S.l, borderWidth: 2, borderColor: on ? t.accent : 'transparent',
        opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      {photo ? <PlacePhoto uri={photo.uri} id={photo.id} w={48} h={48} r={R.sm} icon={icon} /> : icon && (
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: on ? t.accentSoft : t.fill, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} color={on ? t.accentInk : t.ink2} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <T v="h" style={{ fontSize: 17, lineHeight: 24 }}>{title}</T>
        {!!sub && <T v="cap" c="ink3" style={{ marginTop: 1 }}>{sub}</T>}
      </View>
      {on && <T v="cap" c="accent" style={{ fontFamily: F.b }}>지난번</T>}
      <Icon name="chevron-right" size={18} color={t.ink3} />
    </Pressable>
  );
}


// ---------- 밥 자리 줄 (식사 넣기 — 결과 카드 🍽) ----------
/** 결과 카드의 밥 줄 손잡이: 켬/끔(이 계획만) · 처음 받은 밥 자리(다른 식당 후보) · 식당 바꾸기·빼기 */
type MealCtl = {
  on: boolean; orig: MealJson | null; origStops: PlanOption['stops']; busy: boolean;
  onTurnOn: () => void; onTurnOff: () => void; onSwap: (alt: MealAlt | null) => void;
};

/** 지금 카드의 밥 자리 (서버 meal → 없으면 고친 카드의 'ext:food:' 곳과 밥 칸으로) + 다른 식당 후보 (처음 것 포함, 지금 것 뺌) */
function mealViewOf(o: PlanOption, orig: MealJson | null, origStops: PlanOption['stops']) {
  const st = o.stops.find((s) => isMealStop(s.id));
  if (!st) return null;
  const leg = o.legs.find((l) => l.placeId === st.id && (l.meal || l.kind === 'STAY'));
  const fromOrig: MealAlt[] = [];
  if (orig) {
    const os = origStops.find((s) => s.id === orig.placeId);
    if (os?.ext) fromOrig.push({
      restaurantId: orig.restaurantId, placeId: orig.placeId, name: orig.name, lat: os.lat, lng: os.lng, index: orig.index,
      startMin: orig.startMin, start: orig.start, detourMin: orig.detourMin, features: orig.features, cuisine: orig.cuisine, ext: os.ext,
    });
    fromOrig.push(...orig.alternatives);
  }
  const known = fromOrig.find((a) => a.placeId === st.id);
  const startMin = o.meal?.startMin ?? leg?.fromMin ?? known?.startMin ?? null;
  const kind = o.meal?.kind ?? orig?.kind ?? (startMin != null && startMin >= 15 * 60 ? 'dinner' : 'lunch');
  return {
    name: st.name, startMin, kind, features: o.meal?.features ?? known?.features ?? [], cuisine: o.meal?.cuisine ?? known?.cuisine ?? [],
    alternatives: fromOrig.filter((a) => a.placeId !== st.id).slice(0, 3),
  };
}

function MealRow({ o, ctl, busy }: { o: PlanOption; ctl: MealCtl; busy: boolean }) {
  const t = useTheme();
  const [pick, setPick] = useState(false);
  const v = mealViewOf(o, ctl.orig, ctl.origStops);
  const win = mealWindowOf(o);
  const dis = busy || ctl.busy;
  const box = { marginTop: S.l, backgroundColor: t.fill, borderRadius: R.md, padding: S.l } as const;
  // 밥 끔: 코스가 점심·저녁 때를 지날 때만 '점심도 넣어 줘요'
  if (!ctl.on && !v) {
    if (!win) return null;
    return (
      <Pressable onPress={ctl.onTurnOn} disabled={dis} accessibilityRole="button" accessibilityLabel={`${MEAL_WORD(win)}도 넣어 줘요`}
        style={({ pressed }) => [box, { flexDirection: 'row', alignItems: 'center', gap: S.s, opacity: pressed ? 0.7 : 1 }]}>
        <T v="h" style={{ fontSize: 16 }}>🍽</T>
        <T v="sub" c="ink2" style={{ flex: 1 }}>{MEAL_WORD(win)} 때를 지나요 · 식당도 같이 짤까요?</T>
        <T v="sub" c="accent" style={{ fontFamily: F.b }}>{MEAL_WORD(win)}도 넣어 줘요</T>
      </Pressable>
    );
  }
  // 밥 켬인데 못 넣음: 까닭 + 끄기
  if (!v) {
    const hint = o.mealHint ?? (win ? '근처에 등록된 식당이 없어요' : null);
    if (!hint) return null;
    return (
      <View style={[box, { flexDirection: 'row', alignItems: 'center', gap: S.s }]}>
        <T v="h" style={{ fontSize: 16 }}>🍽</T>
        <T v="sub" c="ink2" style={{ flex: 1 }}>{hint} · 밥은 따로 챙겨 주세요</T>
        <ActionButton label="밥은 따로 할게요" tone="ghost" size="sm" disabled={dis} onPress={ctl.onTurnOff} />
      </View>
    );
  }
  const head = `${v.startMin != null ? `${clock(v.startMin)} ` : ''}${MEAL_WORD(v.kind)} · ${v.name}`;
  return (
    <View style={box}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s }}>
        <T v="h" style={{ fontSize: 16 }}>🍽</T>
        <View style={{ flex: 1 }}>
          <T v="sub" style={{ fontFamily: F.b }} numberOfLines={1}>{head}</T>
          {(v.features.length > 0 || v.cuisine.length > 0) && (
            <T v="cap" c="ink3" numberOfLines={1}>{[...v.cuisine, ...v.features].join(' · ')}</T>
          )}
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: S.xs, marginTop: S.s }}>
        {v.alternatives.length > 0 && <ActionButton label={`다른 식당 ${v.alternatives.length}곳`} tone="ghost" size="sm" disabled={dis} onPress={() => { tick(); setPick(true); }} />}
        <ActionButton label="밥은 빼기" tone="ghost" size="sm" disabled={dis} onPress={() => ctl.onSwap(null)} />
      </View>
      <Sheet open={pick} onClose={() => setPick(false)}>
        <T v="h" style={{ fontSize: 18, marginBottom: S.s }}>다른 식당으로 바꿀까요?</T>
        <T v="cap" c="ink3" style={{ marginBottom: S.s }}>코스 사이에서 들르기 좋은 곳이에요 · 바꾸면 시간표를 다시 재요</T>
        {v.alternatives.map((a) => (
          <Pressable key={a.placeId} onPress={() => { setPick(false); ctl.onSwap(a); }} accessibilityRole="button" accessibilityLabel={`${a.name}으로 바꾸기`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.m, paddingVertical: S.l, borderBottomWidth: 1, borderBottomColor: t.line, opacity: pressed ? 0.6 : 1 })}>
            <T v="h" style={{ fontSize: 18 }}>🍽</T>
            <View style={{ flex: 1 }}>
              <T v="h" numberOfLines={1}>{a.name}</T>
              <T v="cap" c="ink3" numberOfLines={2}>
                {[`${clock(a.startMin)} 도착`, a.detourMin > 0 ? `${a.detourMin}분 돌아가요` : '가는 길에 있어요', ...a.cuisine, ...a.features].join(' · ')}
              </T>
            </View>
            <Icon name="chevron-right" size={18} color={t.ink3} />
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}
