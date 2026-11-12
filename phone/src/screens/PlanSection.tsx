// 오늘 탭 맨 위 '오늘 어디 갈까요?' (오후 첫 탑승이면 '지금 어디 들렀다 갈까요?')
// 서버가 날씨·해 시각·낮잠·길 사정으로 계산한 3장을 보여 주고, 고르면 차로 보낸다(서버 '오늘 계획'에 저장 → 차가 받아 감).
// 1순위 카드만 진하게(곳마다 도착·머무름·하루 막대·큰 '차로 보내기'), 2·3순위는 옅고 짧게(펼치면 자세히). 고른 뒤엔 고른 카드 한 장만.
// 고른 뒤 서버가 '살아 있는 코스'를 주면 카드 대신 코스 카드(CourseSection)를 보여 준다. ··· '다른 코스 보기'로 카드를 다시 펼칠 수 있다.
// 시안: proto/home-redesign.html A · 계획 docs/디자인-개편-계획.md 4절
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Alert } from '../alert';
import { durText } from '../course';
import { airText, chooser, previewCourse, iGa, kidsText, optionMeta, optionTitle, PlanOption, PlanRes, reasonIcon, span, Stop, stopDwell, toMin, Tone, weatherText, withDwellOverrides } from '../plan';
import { usePlan } from '../planStore';
import { backByText, COMPANION_INFO, companionNow, useAskMemory } from '../ask';
import { useDevUi } from '../devclean';
import { useSession } from '../session';
import { clock, clockText, useTimeFmt } from '../timefmt';
import { F, H, R, S } from '../theme';
import { done, Icon, IconName, Pill, plainError, Skeleton, Surface, T, tick, useTheme } from '../ui';
import { ActionButton, Empty, ErrorRow, PrimaryCTA } from '../parts';
import { place } from '../places';
import { CourseSection } from './CourseSection';
import { DayBar, DayLegend, Mark } from './DayBar';
import { FamilySheet } from './FamilySheet';
import { Chip, ChipPart, CourseTitle } from './PlanBits';
import { CourseEditSheet, courseEditInput, EditStop } from './CourseEditSheet';
import { DwellSheet } from './DwellSheet';
import { WhySheet } from './WhySheet';
import { W } from '../words';
import { useClosedStops } from '../placeDetail';

export function PlanSection({ dayDone }: { dayDone?: boolean }) {
  const t = useTheme();
  const p = usePlan();
  const { me } = useSession();
  const [famOpen, setFamOpen] = useState(false);
  const [busy, setBusy] = useState<number | 'undo' | null>(null);
  const [open, setOpen] = useState(false); // 코스 진행 중 '다른 코스 보기'로 카드를 다시 펼침
  const [showAll, setShowAll] = useState(false); // 고른 뒤 나머지 카드 펼치기
  const d = p.data;
  // 고르기 전 카드마다 오늘만 머무름 {카드 번호: {장소 id: 분}} — 계획이 바뀌면 비운다
  const [ov, setOv] = useState<Record<number, Record<string, number>>>({});
  const [dwellOf, setDwellOf] = useState<{ i: number; st: Stop; min: number } | null>(null);
  const [editOf, setEditOf] = useState<number | null>(null);
  // 'ⓘ 왜?' 시트: 카드 번호·장소
  const [whyOf, setWhyOf] = useState<{ o: PlanOption; st: Stop } | null>(null);
  useEffect(() => { setOv({}); setShowAll(false); }, [d?.planId]);
  const c = p.course;
  const live = c && d && editOf != null && d.chosen === editOf ? courseEditInput(c, p.placeName, (id) => d.plan.options[editOf].stops.find((x) => x.id === id)?.indoor) : null;
  const editLive = !!live?.visited;
  const afternoon = d?.plan.mode === 'AFTERNOON';
  // 시험 장면 알약·'실제로 돌아가기'는 개발 표시 (시연용 깔끔 보기면 숨김)
  const devUi = useDevUi();

  const pick = async (idx: number | null) => {
    setBusy(idx ?? 'undo');
    try {
      await p.choose(idx, idx != null ? ov[idx] : undefined);
      if (idx != null) { done(); setShowAll(false); setOpen(false); setOv((x) => { const y = { ...x }; delete y[idx]; return y; }); }
    }
    catch (e: any) { Alert.alert(idx == null ? '되돌리지 못했어요' : '보내지 못했어요', plainError(e, '잠시 뒤 다시 눌러 주세요')); }
    finally { setBusy(null); }
  };

  const title = afternoon ? '지금 어디 들렀다 갈까요?' : '오늘 어디 갈까요?';
  const kids = companionNow(useAskMemory().companion ?? p.family?.companion) === 'kids';
  const sub = afternoon ? '해 지기 전·저녁 전에 돌아오는 곳만 골랐어요' : kids ? '날씨·낮잠·해 지는 시각·길 사정으로 계산했어요' : '날씨·해 지는 시각·길 사정으로 계산했어요';

  // 고른 코스가 살아 있는 코스로 돌아가는 중이면 카드 대신 코스 카드 (B·B2·B3·B4·C, 집에 왔으면 D 한 줄)
  if (d && p.course && !open) {
    return <CourseSection onOtherCourses={() => setOpen(true)} dayDone={dayDone} />;
  }
  // 집에 왔는데(요약 도착) 서버 코스가 이미 없으면: 고른 코스 카드 대신 한 줄
  if (d && dayDone && d.chosen != null && !open) {
    return (
      <View style={{ marginTop: S.sec, backgroundColor: t.surface, borderRadius: R.lg, paddingLeft: S.xl, paddingRight: S.l, paddingVertical: S.l, flexDirection: 'row', alignItems: 'center', gap: S.l }}>
        <Icon name="circle-check" size={20} color={t.accent} />
        <View style={{ flex: 1 }}>
          <T v="h">오늘 코스 끝</T>
          <T v="cap" c="ink3">내일 추천은 아침에 와요</T>
        </View>
      </View>
    );
  }

  const chosen = d?.chosen ?? null;
  // 고른 뒤에는 고른 카드 한 장만 (나머지는 '다른 코스 보기 N개'로 접음)
  const cards = d ? d.plan.options.map((o, i) => ({ o, i })).filter(({ i }) => chosen == null || showAll || open || i === chosen) : [];
  const hidden = d && chosen != null && !showAll && !open ? d.plan.options.length - 1 : 0;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: S.sec, paddingHorizontal: S.xxs }}>
        <T v="title" accessibilityRole="header" style={{ fontSize: 20, lineHeight: 27, letterSpacing: -0.4, flex: 1 }}>{chosen != null && !open ? '오늘 고른 코스' : title}</T>
      </View>
      {(chosen == null || open) && <T v="cap" c="ink3" style={{ marginTop: S.xxs, paddingHorizontal: S.xxs }}>{sub}</T>}

      {p.test && devUi && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m, marginTop: S.l - 2, flexWrap: 'wrap' }}>
          <Pill text={`시험 장면 ${p.test.title}`} tone="blue" icon="flask-conical" />
          <Pressable hitSlop={8} onPress={() => { tick(); p.setTest(null); }}>
            <T v="cap" c="blue" style={{ fontFamily: F.b, textDecorationLine: 'underline' }}>실제로 돌아가기</T>
          </Pressable>
        </View>
      )}

      {/* 코스 진행 중에 다른 코스를 펼쳤으면: 돌아가기 (연한 버튼) */}
      {d && p.course && open && (
        <ActionButton label="코스 진행으로 돌아가기" icon="route" tone="accent" size="row" onPress={() => setOpen(false)} style={{ marginTop: S.l }} />
      )}

      {d && (chosen == null || open) && <SkyChips d={d} dinner={p.family?.dinner ?? null} />}
      {(chosen == null || open) && <FamilyChips onEdit={() => setFamOpen(true)} afternoon={afternoon} />}
      {d && p.noLoc && !p.test && chosen == null && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.m, paddingHorizontal: S.xxs }}>
          <Icon name="map-pin" size={13} color={t.ink3} />
          <T v="cap" c="ink3" style={{ flex: 1 }}>위치 없이 계산했어요 (차가 마지막으로 있던 곳 기준)</T>
        </View>
      )}

      {p.error && !d && (
        <ErrorRow title={p.error} sub="아래로 당기거나 다시 불러와 주세요" onRetry={() => p.reload({ full: true })} busy={p.loading} style={{ marginTop: S.l }} />
      )}
      {!d && !p.error && <PlanSkeleton />}

      {d && <ChosenBanner d={d} myNick={me?.me.nickname} onUndo={() => pick(null)} undoing={busy === 'undo'} />}
      {d && chosen != null && !p.course && p.courseError && (
        <ErrorRow title={p.courseError} sub="고른 코스는 차로 잘 보냈어요" onRetry={() => { tick(); p.loadCourse(); }} busy={p.courseBusy} style={{ marginTop: S.m }} />
      )}
      {/* 추천 0장 (밤 늦게·모두 문 닫음 등) */}
      {d && d.plan.options.length === 0 && (
        <Surface style={{ marginTop: S.l }}>
          <Empty compact icon="moon" title="지금은 갈 만한 곳이 없어요" sub="문 닫을 시간이 가깝거나 집에 올 시간이 빠듯해요. 내일 아침에 다시 골라 드릴게요."
            action={<ActionButton label="다시 불러오기" icon="refresh-cw" busy={p.loading} onPress={() => p.reload()} />} />
        </Surface>
      )}
      {d && cards.map(({ o, i }) => (
        <OptionCard key={i} d={d} o={o} i={i} dinner={p.family?.dinner ?? null} ov={ov[i]}
          strong={chosen != null ? chosen === i : i === 0}
          chosen={chosen === i} anyChosen={chosen != null} busy={busy === i} disabled={busy != null}
          onPick={() => pick(i)}
          onDwell={chosen === i && p.course ? undefined : (st, min) => setDwellOf({ i, st, min })}
          onEdit={o.stops.length ? () => setEditOf(i) : undefined}
          onWhy={o.why?.length ? (st) => setWhyOf({ o, st }) : undefined} />
      ))}
      {hidden > 0 && (
        <ActionButton label={`다른 코스 보기 ${hidden}개`} icon="chevron-down" tone="plain" size="row" onPress={() => setShowAll(true)} style={{ marginTop: S.m }} />
      )}
      {d && p.error && <ErrorRow title="새로 불러오지 못했어요" sub="전에 받은 추천을 보여 드려요" onRetry={() => p.reload()} busy={p.loading} style={{ marginTop: S.m }} />}

      <FamilySheet open={famOpen} onClose={() => setFamOpen(false)} />
      <WhySheet stop={whyOf?.st ?? null} why={whyOf?.o.why?.find((w) => w.placeId === whyOf.st.id) ?? null} onClose={() => setWhyOf(null)} />
      {/* 카드의 머무름 바꾸기 (고르기 전, 폰 안에서만 — 고르면 SetDwell로) */}
      <DwellSheet open={!!dwellOf} onClose={() => setDwellOf(null)} name={dwellOf?.st.name ?? ''} minutes={dwellOf?.min ?? 60}
        source={dwellOf?.st.dwell} set={dwellOf ? ov[dwellOf.i]?.[dwellOf.st.id] != null : false}
        onApply={(m) => { const x = dwellOf!; setDwellOf(null); setOv((o) => ({ ...o, [x.i]: { ...o[x.i], [x.st.id]: m } })); }} />
      {/* 코스 편집 */}
      {d && editOf != null && (
        <CourseEditSheet open={editOf != null} onClose={() => setEditOf(null)} day={d.day} planId={d.planId}
          live={editLive} locked={live?.locked}
          initial={editLive ? live!.initial : d.plan.options[editOf].stops.map((st): EditStop => ({ id: st.id, name: st.name, indoor: st.indoor, dwell: stopDwell(d.plan.options[editOf], st) }))}
          initialDwell={editLive ? live!.initialDwell : { ...(live?.initialDwell ?? {}), ...(ov[editOf] ?? {}) }}
          onApply={async (stops, dwell) => {
            const i = editOf;
            if (editLive) await p.liveEdit(stops, dwell);
            else if (stops.join() === d.plan.options[i].stops.map((x) => x.id).join()) await p.choose(i, dwell);
            else await p.chooseStops(stops, dwell);
            setOv((x) => { const y = { ...x }; delete y[i]; return y; });
            setOpen(false);
          }} />
      )}
    </View>
  );
}

// ---------- 하늘 칩: 날씨 · 미세먼지 · 해 시각 (오후: 해 지기까지 · 저녁) ----------
function SkyChips({ d, dinner }: { d: PlanRes; dinner: number | null }) {
  const sky = d.sky;
  const chips: { parts: ChipPart[]; tone?: Tone }[] = [];
  const w = weatherText(sky);
  if (w) chips.push({ parts: [w], tone: sky?.sky === 'RAIN' || sky?.sky === 'SNOW' ? 'RAIN' : 'PLAIN' });
  // 미세먼지: 늘 보이되 좋음·보통은 보통 색, 나쁨 이상은 주황빨강 (모르면 없음)
  const a = airText(sky);
  if (a) chips.push({ parts: [{ icon: a.icon, text: a.text }], tone: a.bad ? 'AIR' : 'PLAIN' });
  const sunset = toMin(sky?.sunset);
  if (d.plan.mode === 'AFTERNOON') {
    if (sunset != null) {
      const left = sunset - d.plan.nowMin;
      chips.push({ parts: [{ icon: 'sunset', text: left > 0 ? `해 짐 ${sky!.sunset} · ${span(left)} 남음` : `해 졌어요 · ${sky!.sunset}` }], tone: 'SUN' });
    }
    if (dinner != null && dinner > d.plan.nowMin) chips.push({ parts: [{ icon: 'utensils', text: `저녁 ${clock(dinner)}` }] });
  } else if (sky?.sunrise || sky?.sunset) {
    chips.push({ parts: [{ icon: 'sunrise', text: sky.sunrise ?? '–' }, { icon: 'sunset', text: sky.sunset ?? '–' }], tone: 'SUN' });
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
      {chips.map((c) => <Chip key={c.parts.map((x) => x.text).join()} parts={c.parts} tone={c.tone ?? 'PLAIN'} big />)}
    </View>
  );
}

// ---------- 가족 조건 칩 (눌러서 바꾸기) ----------
function FamilyChips({ onEdit, afternoon }: { onEdit: () => void; afternoon: boolean }) {
  const t = useTheme();
  const { family: f, data } = usePlan();
  const comp = companionNow(useAskMemory().companion ?? f?.companion);
  const kids = comp === 'kids';
  // 어른끼리는 가족 설정의 귀가 기준(아이용)을 안 쓴다 — 계획의 귀가 한계(늦어도 몇 시, 기본 밤 11시)
  const adultLimit = data?.companion && data.companion !== 'kids' ? data.plan.backByMin : null;
  // 저녁 계획이면 귀가 = 잠자는 시간 · 늦어도 몇 시
  const ev = data?.evening && !data.tomorrowHint ? { limitMin: data.plan.backByMin } : null;
  const items = f ? ([
    kids ? { icon: 'baby', text: kidsText(f.kidAges) } : { icon: COMPANION_INFO[comp].icon, text: COMPANION_INFO[comp].label },
    afternoon || !kids ? null : { icon: 'moon', text: f.napStart != null && f.napLen != null ? `낮잠 ${clock(f.napStart)} · ${f.napLen}분` : '낮잠 없음' },
    { icon: 'house', text: `귀가 · ${backByText(kids, f.text.backBy, adultLimit, ev, f.lateReturn)}${afternoon && kids && f.dinner != null && !ev ? ' · 저녁 전' : ''}` },
  ].filter(Boolean) as { icon: IconName; text: string }[]) : [];
  const chip = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, height: 28, paddingHorizontal: 10, borderRadius: R.pill, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line };
  return (
    <Pressable onPress={() => { tick(); onEdit(); }} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {items.map((s) => (
        <View key={s.text} style={chip}>
          <Icon name={s.icon} size={14} color={t.ink2} strokeWidth={2.2} />
          <T v="cap" c="ink2" numberOfLines={1} textBreakStrategy="simple" style={{ fontFamily: F.b }}>{s.text}</T>
        </View>
      ))}
      <View style={chip}>
        <Icon name="pencil" size={13} color={t.accent} strokeWidth={2.2} />
        <T v="cap" c="accent" style={{ fontFamily: F.b }}>{f ? '바꾸기' : '함께 가는 사람 설정'}</T>
      </View>
    </Pressable>
  );
}

// ---------- 고른 뒤 띠 ----------
function ChosenBanner({ d, myNick, onUndo, undoing }: { d: PlanRes; myNick?: string; onUndo: () => void; undoing: boolean }) {
  const t = useTheme();
  if (d.chosen == null) return null;
  const o = d.plan.options[d.chosen];
  const by = chooser(d.chosenBy);
  const mine = !!by && !by.car && by.who === myNick;
  const head = mine ? '차로 보냈어요' : by?.car ? '차에서 골랐어요' : `${by?.who ?? '가족'}${iGa(by?.who ?? '가족')} 골랐어요`;
  const icon: IconName = mine ? 'circle-check' : by?.car ? 'car-front' : 'smartphone';
  const sub = mine ? '시동 걸면 차 화면에 이 코스가 떠 있어요' : o ? `${optionTitle(o)} · ${clockText(o.arriveHome)} 귀가` : '';
  return (
    <View style={{ marginTop: S.l, borderRadius: R.md + 2, paddingVertical: S.s, paddingLeft: S.l + 2, paddingRight: S.xs, backgroundColor: t.accentSoft, flexDirection: 'row', alignItems: 'center', gap: S.l - 2 }}>
      <Icon name={icon} size={20} color={t.accentInk} />
      <View style={{ flex: 1, paddingVertical: S.xs }}>
        <T v="h" style={{ color: t.accentInk, fontSize: 15, lineHeight: 21 }}>{head}</T>
        {!!sub && <T v="cap" style={{ color: t.accentInk, marginTop: 1 }}>{sub}</T>}
      </View>
      <ActionButton label="되돌리기" icon="undo-2" tone="ghost" size="md" busy={undoing} onPress={onUndo} />
    </View>
  );
}

// ---------- 카드 ----------
// strong = 1순위(고른 뒤엔 고른 카드): 곳마다 도착 시각·머무름, 하루 막대, 큰 '차로 보내기'.
// 나머지는 옅고 짧게: 제목·한 줄·이유 칩 2개 + 펼치면 곳마다 시각·막대, 연한 '차로 보내기'.
// 앵커 코스 결과(AnchorSheet)도 이 카드를 그대로 쓴다 (d = 앵커 답을 계획 모양으로).
export function OptionCard({ d, o: o0, i, dinner, ov, strong, chosen, anyChosen, busy, disabled, onPick, onDwell, onEdit, editLabel = '코스 편집', onWhy, firstLabel = true }: {
  d: PlanRes; o: PlanOption; i: number; dinner: number | null; ov?: Record<string, number>; strong: boolean; chosen: boolean; anyChosen: boolean; busy: boolean; disabled: boolean;
  onPick: () => void;
  /** 머무름 칩을 누름 (없으면 칩은 보기만) */
  onDwell?: (st: Stop, min: number) => void;
  onEdit?: () => void;
  /** 편집 버튼 글 (앵커 결과는 '코스 고치기') */
  editLabel?: string;
  /** 장소마다 'ⓘ 왜?' (없으면 안 보임) */
  onWhy?: (st: Stop) => void;
  /** 첫 카드에 '오늘 1순위' 이름표 (앵커 결과는 끔) */
  firstLabel?: boolean;
}) {
  const t = useTheme();
  const [more, setMore] = useState(false);
  // 오늘만 머무름을 바꿨으면 하루 막대·귀가를 다시 그린다: 서버 미리 보기(문 닫는 시각·낮잠까지 엔진 계산, 저장 안 함),
  // 그 전이나 실패하면 폰 어림(그곳 칸을 늘리고 뒤를 민다). 이름·이유 칩은 원래 카드 것
  const { token } = useSession();
  const [srv, setSrv] = useState<PlanOption | null>(null);
  const ovKey = JSON.stringify(ov ?? {});
  useEffect(() => {
    setSrv(null);
    if (!token || !ov || !Object.keys(ov).length) return;
    let alive = true;
    previewCourse(token, { planId: d.planId, stops: o0.stops.map((x) => x.id), dwell: ov })
      .then((r) => { if (alive && r.option) setSrv({ ...o0, stops: o0.stops.map((st, k) => ({ ...st, dwell: r.option!.stops[k]?.dwell ?? st.dwell })), legs: r.option.legs, arriveHomeMin: r.option.arriveHomeMin, arriveHome: r.option.arriveHome, firstLegMin: r.option.firstLegMin }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [ovKey, d.planId, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const o = useMemo(() => srv ?? withDwellOverrides(o0, ov), [srv, o0, ov]);
  const tf = useTimeFmt();
  const { from, to, marks } = useMemo(() => barRange(d, dinner, o), [d, dinner, o, tf]); // eslint-disable-line react-hooks/exhaustive-deps
  const by = chooser(d.chosenBy);
  const late = o !== o0 && o.arriveHomeMin > d.plan.backByMin ? o.arriveHomeMin - d.plan.backByMin : 0;
  const detail = strong || more;
  const label = [o.label !== optionTitle(o) ? clockText(o.label) : null, firstLabel && i === 0 && !anyChosen && !/1순위/.test(o.label) ? '오늘 1순위' : null].filter(Boolean).join(' · ');
  // 머무름을 바꾼 카드는 귀가 시각을 말하는 칩(옛 시간표 기준)을 뺀다
  const reasons = o.reasons.filter((r) => o === o0 || !/귀가|도착/.test(r.text));
  // 곳이 없는 카드('바로 집으로')·그날 쉬는 곳이 든 카드는 차로 보내지 않는다
  const closed = useClosedStops(o.stops, d.day);
  const sendable = o.stops.length > 0 && closed.names.length === 0;
  return (
    <View style={{ marginTop: S.l - 2, backgroundColor: strong ? t.surface : 'transparent', borderRadius: R.lg, paddingHorizontal: S.xl, paddingTop: S.l + 2, paddingBottom: S.l + 2,
      borderWidth: chosen ? 2 : strong ? 0 : 1, borderColor: chosen ? t.accent : t.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m, minHeight: onEdit ? 28 : 0 }}>
        <View style={{ flex: 1 }}>
          {!!label && <T v="label" c="accent">{label}</T>}
        </View>
        {onEdit && <ActionButton label={editLabel} icon="pencil" tone="plain" size="sm" disabled={disabled} onPress={onEdit} />}
      </View>
      {/* 장소 이름 중간에서 줄이 바뀌지 않게 이름마다 따로 놓고 줄바꿈 */}
      <View style={{ marginTop: S.xxs }}>
        <CourseTitle names={o.stops.length ? o.stops.map((x) => x.name) : [optionTitle(o)]} />
      </View>
      <T v="cap" c="ink2" style={{ marginTop: S.xxs }}>{clockText(optionMeta(o))}</T>

      {detail && o.stops.length > 0 && <StopList o={o} ov={ov} onDwell={onDwell} onWhy={onWhy} />}
      {/* 귀가 한계를 넘는 카드 (앵커 코스 '여기만') */}
      {o.overLimit && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.s }}>
          <Icon name="triangle-alert" size={14} color={t.red} />
          <T v="cap" c="redText" style={{ fontFamily: F.b, flex: 1 }}>집에 {clock(o.arriveHomeMin)} 도착 · 귀가 한계 {clock(d.plan.backByMin)}를 넘어요</T>
        </View>
      )}
      {late > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.s }}>
          <Icon name="triangle-alert" size={14} color={t.red} />
          <T v="cap" c="redText" style={{ fontFamily: F.b, flex: 1 }}>귀가 한계 {clock(d.plan.backByMin)}보다 {late}분 늦어요</T>
        </View>
      )}
      {detail && <DayBar legs={o.legs} from={from} to={to} marks={marks} />}
      {detail && strong && <DayLegend />}
      {reasons.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.xs + 1, marginTop: S.l - 2 }}>
          {(detail ? reasons : reasons.slice(0, 2)).map((r) => <Chip key={r.text} parts={[{ icon: reasonIcon(r), text: r.text }]} tone={r.tone} />)}
        </View>
      )}
      {!strong && o.stops.length > 0 && (
        <ActionButton label={more ? '접기' : '곳마다 시각 · 하루 막대'} icon={more ? 'chevron-up' : 'chevron-down'} tone="ghost" size="sm"
          onPress={() => setMore((v) => !v)} style={{ alignSelf: 'flex-start', marginTop: S.s, marginLeft: -S.m }} />
      )}
      {chosen ? (
        <View style={{ marginTop: S.l, minHeight: H.act, borderRadius: R.md, backgroundColor: t.accentSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.s }}>
          <Icon name={by?.car ? 'car-front' : 'circle-check'} size={18} color={t.accentInk} />
          <T v="btn" style={{ color: t.accentInk }}>{by?.car ? '차에서 골랐어요' : '차로 보냈어요'}</T>
        </View>
      ) : closed.names.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.l }}>
          <Icon name="triangle-alert" size={14} color={t.red} />
          <T v="cap" c="redText" style={{ fontFamily: F.b, flex: 1 }}>{closed.names.join(', ')} · 그날 쉬어요. 다른 코스를 골라 주세요</T>
        </View>
      ) : !sendable ? null : strong && !anyChosen ? (
        <>
          <PrimaryCTA title={W.send} icon="send" busy={busy} disabled={(disabled || !closed.ready) && !busy} onPress={onPick} style={{ marginTop: S.l + 2 }} />
          <T v="cap" c="ink3" style={{ marginTop: S.s, textAlign: 'center' }}>고르면 시동 걸 때 차 화면에 이 코스가 떠 있어요</T>
        </>
      ) : (
        <ActionButton label={anyChosen ? '이 코스로 바꾸기' : W.send} icon="send" tone="plain" size="row" busy={busy} disabled={(disabled || !closed.ready) && !busy}
          onPress={onPick} style={{ marginTop: S.l }} />
      )}
    </View>
  );
}

/** 카드 안 곳마다: 아이콘 · 이름 · 도착 시각, 그 아래 머무름 칩(누르면 머무름 바꾸기) → 마지막 줄 집 도착 */
function StopList({ o, ov, onDwell, onWhy }: { o: PlanOption; ov?: Record<string, number>; onDwell?: (st: Stop, min: number) => void; onWhy?: (st: Stop) => void }) {
  const t = useTheme();
  const arrive = (id: string) => o.legs.find((l) => l.kind === 'STAY' && l.placeId === id)?.fromMin;
  return (
    <View style={{ marginTop: S.l, backgroundColor: t.fill, borderRadius: R.md, paddingHorizontal: S.l, paddingVertical: S.s }}>
      {o.stops.map((st) => {
        const min = stopDwell(o, st);
        const at = arrive(st.id);
        const set = ov?.[st.id] != null;
        const own = st.dwell?.source === 'family';
        return (
          <View key={st.id} style={{ paddingVertical: S.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m }}>
              <Icon name={place(st.id)?.icon ?? 'map-pin'} size={16} color={t.ink2} strokeWidth={2.1} />
              <T v="h" numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, lineHeight: 21 }}>{st.name}</T>
              {/* 'ⓘ 왜?' — 이 곳이 왜 들어갔는지 (서버 why 줄) */}
              {onWhy && o.why?.some((w) => w.placeId === st.id) ? (
                <Pressable onPress={() => { tick(); onWhy(st); }} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${st.name} 왜 골랐는지 보기`}
                  style={({ pressed }) => ({ paddingHorizontal: S.s, minHeight: 28, justifyContent: 'center', borderRadius: R.pill, backgroundColor: pressed ? t.line : t.surface })}>
                  <T v="cap" c="accent" style={{ fontFamily: F.b }}>ⓘ 왜?</T>
                </Pressable>
              ) : null}
              <View style={{ flex: 1 }} />
              {at != null && <T v="cap" c="ink2" style={{ fontVariant: ['tabular-nums'] }}>{clock(at)} 도착</T>}
            </View>
            <Pressable disabled={!onDwell} onPress={() => { tick(); onDwell?.(st, min); }} hitSlop={6}
              accessibilityRole={onDwell ? 'button' : undefined} accessibilityLabel={`${st.name} 머무름 ${durText(min)}${onDwell ? ' 바꾸기' : ''}`}
              style={({ pressed }) => ({ marginTop: S.xs, marginLeft: 24, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: S.xs + 1, minHeight: 32, paddingHorizontal: S.l - 2,
                borderRadius: R.pill, backgroundColor: set ? t.accentSoft : t.surface, flexShrink: 1, opacity: pressed ? 0.6 : 1 })}>
              <Icon name="clock" size={14} color={set ? t.accentInk : t.ink} strokeWidth={2.3} />
              <T v="cap" numberOfLines={1} style={{ color: set ? t.accentInk : t.ink, fontFamily: F.b, flexShrink: 1, fontVariant: ['tabular-nums'] }}>
                머무름 {durText(min)}{set ? ' · 오늘만' : own ? ' · 우리 가족' : ''}
              </T>
              {onDwell && <Icon name="pencil" size={12} color={set ? t.accentInk : t.ink3} strokeWidth={2.3} />}
            </Pressable>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m, paddingVertical: S.s, borderTopWidth: 1, borderTopColor: t.line, marginTop: S.xxs }}>
        <Icon name="house" size={16} color={t.ink2} strokeWidth={2.1} />
        <T v="h" style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>집</T>
        <T v="cap" c="ink2" style={{ fontVariant: ['tabular-nums'] }}>{clock(o.arriveHomeMin)} 도착</T>
      </View>
    </View>
  );
}

/** 세 카드가 같은 눈금을 쓰게: 지금(조금 앞) ~ 가장 늦은 귀가·해 짐·저녁(조금 뒤) */
function barRange(d: PlanRes, dinner: number | null, shown?: PlanOption): { from: number; to: number; marks: Mark[] } {
  const now = d.plan.nowMin;
  const sunset = toMin(d.sky?.sunset);
  const afternoon = d.plan.mode === 'AFTERNOON';
  // 머무름을 늘린 카드는 그 카드만 눈금이 길어진다 (나머지 카드는 같은 눈금)
  const ends = [...d.plan.options.map((o) => o.arriveHomeMin), ...(shown ? [shown.arriveHomeMin] : [])];
  const marks: Mark[] = [{ min: now, label: '지금', tone: 'now' }];
  // 이미 지난 해 짐·저녁은 막대에 넣지 않는다 (밤에 열면 '바로 집으로'만 남는다)
  if (sunset != null && sunset > now) { marks.push({ min: sunset, label: `해 짐 ${clock(sunset, true)}`, tone: 'sun' }); ends.push(sunset); }
  if (afternoon && dinner != null && dinner > now) { marks.push({ min: dinner, label: `저녁 ${clock(dinner, true)}`, tone: 'dinner' }); ends.push(dinner); }
  const from = now - (afternoon ? 10 : 15);
  const to = Math.max(now + 45, ...ends) + (afternoon ? 12 : 25);
  return { from, to, marks };
}

function PlanSkeleton() {
  return (
    <>
      {[0, 1].map((k) => (
        <Surface key={k} style={{ marginTop: S.l - 2, gap: 9 }}>
          <Skeleton w="30%" h={11} />
          <Skeleton w="80%" h={17} />
          <Skeleton w="50%" h={12} />
          <Skeleton h={12} r={6} style={{ marginTop: S.m }} />
          <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.s }}><Skeleton w={90} h={22} r={11} /><Skeleton w={70} h={22} r={11} /></View>
          <Skeleton h={H.cta} r={R.md} style={{ marginTop: S.s }} />
        </Surface>
      ))}
    </>
  );
}
