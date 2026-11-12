// 함께 가는 사람 설정: 기본 동행(아이와·연인·부부·친구끼리·혼자) · (아이와면) 아이 나이 · 낮잠 · 귀가 한계 · 저녁 시각 · 집 위치. 오늘 추천·코스 계산에 쓴다(차도 켤 때 받아 감).
// 오늘 탭 '바꾸기'·코스 카드 '설정'·우리 차 탭 '우리 가족'이 같은 시트, 처음 연결 4단계(건너뛰기 가능)는 FamilyForm만.
// 집 위치: '지금 위치를 집으로' 또는 지도에서 고르기(MapPick). 서버는 소수 셋째 자리(약 100m)로만 저장.
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Alert } from '../alert';
import { COMPANIONS, Companion, DEFAULT_BEDTIME, DEFAULT_FAMILY, DEFAULT_LATE_RETURN, DwellPref, Family, hhmm, putFamily } from '../plan';
import { COMPANION_INFO, companionNow, setAskMemory, useAskMemory } from '../ask';
import { clock } from '../timefmt';
import { usePlan } from '../planStore';
import { useSession } from '../session';
import { F, R } from '../theme';
import { Btn, done, Icon, plainError, Label, Pill, Segmented, Sheet, T, tick, useTheme } from '../ui';
import { currentSpot, MapPickSheet, round3 } from './MapPick';

const MAX_KIDS = 4;
const AGES = Array.from({ length: 13 }, (_, i) => i);
const NAP_STARTS = [11 * 60, 11 * 60 + 30, 12 * 60, 12 * 60 + 30, 13 * 60, 13 * 60 + 30, 14 * 60, 14 * 60 + 30, 15 * 60];
const NAP_LENS = [60, 90, 120];
const BACK_ATS = [15 * 60, 15 * 60 + 30, 16 * 60, 16 * 60 + 30, 17 * 60, 17 * 60 + 30, 18 * 60, 18 * 60 + 30, 19 * 60, 19 * 60 + 30, 20 * 60];
const DINNERS = [17 * 60, 17 * 60 + 30, 18 * 60, 18 * 60 + 30, 19 * 60, 19 * 60 + 30, 20 * 60];
/** 아이 잠자는 시간 (저녁 나들이 귀가 한계, 서버 18:00~23:00) */
const BEDTIMES = [19 * 60, 19 * 60 + 30, 20 * 60, 20 * 60 + 30, 21 * 60, 21 * 60 + 30, 22 * 60, 22 * 60 + 30];
/** 어른끼리 늦어도 몇 시 귀가 (서버 19:00~23:59) */
const LATE_RETURNS = [20 * 60, 21 * 60, 22 * 60, 22 * 60 + 30, 23 * 60, 23 * 60 + 30, 23 * 60 + 59];
const ORD = ['첫째', '둘째', '셋째', '넷째'];

/** 가로로 넘기는 고르기 칩 줄 */
export function ChipRow<V extends number>({ values, value, label, onPick }: { values: V[]; value: V | null; label: (v: V) => string; onPick: (v: V) => void }) {
  const t = useTheme();
  const ref = useRef<any>(null); // RN 0.88 ScrollView 참조 타입이 맞지 않아 any (Dev의 view-shot과 같음)
  const shown = useRef(false);
  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
      {values.map((v) => {
        const on = v === value;
        return (
          <Pressable key={v} onPress={() => { tick(); onPick(v); }}
            // 처음 열 때 고른 칩이 화면 밖이면 보이게 넘겨 둔다
            onLayout={on && !shown.current ? (e) => { shown.current = true; ref.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 60), animated: false }); } : undefined}
            style={{ height: 36, minWidth: 44, paddingHorizontal: 12, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.ink : t.fill }}>
            <T v="cap" style={{ fontFamily: F.b, color: on ? t.onInk : t.ink2 }}>{label(v)}</T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** simple: 처음 연결 4단계용 — 아이 나이 + 낮잠 있음/없음만 (시각·귀가 한계·저녁은 기본값, 우리 차 탭에서) */
/** noKids: 동행이 아이와가 아니면 아이 나이·낮잠 칸을 숨긴다 (값은 그대로 둠) */
export function FamilyForm({ value, onChange, simple, noKids }: { value: Family; onChange: (f: Family) => void; simple?: boolean; noKids?: boolean }) {
  const t = useTheme();
  const f = value;
  const set = (p: Partial<Family>) => onChange({ ...f, ...p });
  const nap = f.napStart != null && f.napLen != null;
  const backAt = f.backBy.startsWith('at:') ? Number(f.backBy.slice(3, 5)) * 60 + Number(f.backBy.slice(6, 8)) : null;
  return (
    <View>
      {!noKids && <>
      <Label>아이 나이</Label>
      <View style={{ gap: 10 }}>
        {f.kidAges.map((age, k) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T v="cap" c="ink3" style={{ width: 30, fontFamily: F.b }}>{ORD[k]}</T>
            <View style={{ flex: 1 }}>
              <ChipRow values={AGES} value={age} label={(v) => `${v}살`}
                onPick={(v) => set({ kidAges: f.kidAges.map((a, j) => (j === k ? v : a)) })} />
            </View>
            {f.kidAges.length > 1 && (
              <Pressable hitSlop={8} onPress={() => { tick(); set({ kidAges: f.kidAges.filter((_, j) => j !== k) }); }}
                style={{ width: 28, height: 28, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: t.fill }}>
                <Icon name="x" size={15} color={t.ink3} />
              </Pressable>
            )}
          </View>
        ))}
      </View>
      {f.kidAges.length < MAX_KIDS && (
        <Pressable onPress={() => { tick(); set({ kidAges: [...f.kidAges, f.kidAges[f.kidAges.length - 1] ?? 4] }); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, alignSelf: 'flex-start', paddingVertical: 4 }}>
          <Icon name="circle-plus" size={18} color={t.accent} />
          <T v="cap" c="accent" style={{ fontFamily: F.b }}>아이 더하기</T>
        </Pressable>
      )}

      <View style={{ height: 18 }} />
      <Label>낮잠</Label>
      <Segmented<'none' | 'nap'> value={nap ? 'nap' : 'none'}
        options={[{ key: 'none', label: '없음' }, { key: 'nap', label: '있어요' }]}
        onChange={(k) => set(k === 'nap' ? { napStart: f.napStart ?? 13 * 60, napLen: f.napLen ?? 90 } : { napStart: null, napLen: null })} />
      {nap && !simple && (
        <View style={{ marginTop: 10, gap: 10 }}>
          <ChipRow values={NAP_STARTS} value={f.napStart} label={(v) => `${clock(v)}부터`} onPick={(v) => set({ napStart: v })} />
          <ChipRow values={NAP_LENS} value={f.napLen} label={(v) => `${v}분`} onPick={(v) => set({ napLen: v })} />
          <T v="cap" c="ink3">낮잠 시각에 차를 타면 아이가 차에서 자도록 코스를 짜요</T>
        </View>
      )}

      {nap && simple && <T v="cap" c="ink3" style={{ marginTop: 8 }}>낮잠은 {clock(f.napStart ?? 13 * 60)}부터 {f.napLen ?? 90}분으로 둘게요</T>}
      </>}
      {!simple && <>
      {!noKids && <View style={{ height: 18 }} />}
      <Label>귀가 한계</Label>
      <Segmented<'sun' | 'at'> value={backAt == null ? 'sun' : 'at'}
        options={[{ key: 'sun', label: '해 지기 30분 전' }, { key: 'at', label: '직접 정하기' }]}
        onChange={(k) => set({ backBy: k === 'sun' ? 'sunset-30' : `at:${hhmm(backAt ?? 17 * 60 + 30)}` })} />
      {backAt != null && (
        <View style={{ marginTop: 10 }}>
          <ChipRow values={BACK_ATS} value={backAt} label={(v) => `${clock(v)}까지`} onPick={(v) => set({ backBy: `at:${hhmm(v)}` })} />
        </View>
      )}

      <View style={{ height: 18 }} />
      <Label>저녁 시각</Label>
      <ChipRow values={DINNERS} value={f.dinner} label={(v) => clock(v)} onPick={(v) => set({ dinner: v })} />
      <T v="cap" c="ink3" style={{ marginTop: 8 }}>오후에 짧게 나갈 땐 저녁 전에 돌아오는 곳만 추천해요</T>

      {/* 저녁 나들이 귀가 기준: 아이와 = 잠자는 시간 · 어른끼리 = 늦어도 몇 시 귀가 (해 진 뒤 저녁 카드는 이 90분 전까지) */}
      <View style={{ height: 18 }} />
      {!noKids ? <>
        <Label>아이 잠자는 시간</Label>
        <ChipRow values={BEDTIMES} value={f.bedtime ?? DEFAULT_BEDTIME} label={(v) => clock(v)} onPick={(v) => set({ bedtime: v })} />
        <T v="cap" c="ink3" style={{ marginTop: 8 }}>해 진 뒤엔 잠자기 전에 돌아오는 저녁 산책을 추천해요 · {clock((f.bedtime ?? DEFAULT_BEDTIME) - 90)}까지 나갈 수 있어요</T>
      </> : <>
        <Label>늦어도 몇 시 귀가</Label>
        <ChipRow values={LATE_RETURNS} value={f.lateReturn ?? DEFAULT_LATE_RETURN} label={(v) => clock(v)} onPick={(v) => set({ lateReturn: v })} />
        <T v="cap" c="ink3" style={{ marginTop: 8 }}>어른끼리 갈 땐 이 시각 전에 집에 오도록 짜요 · 해 진 뒤엔 야경·드라이브 카드가 나와요</T>
      </>}

      {/* 밥도 같이 짜기 (기본 끔 — 고를 때 '점심도 넣어 줘요'로 그때만 켤 수도) */}
      <View style={{ height: 18 }} />
      <Label>밥도 같이 짜기</Label>
      <Segmented<'off' | 'on'> value={f.mealPlan ? 'on' : 'off'}
        options={[{ key: 'off', label: '밥은 따로 해요' }, { key: 'on', label: '🍽 밥도 같이 짜기' }]}
        onChange={(k) => set({ mealPlan: k === 'on' })} />
      <T v="cap" c="ink3" style={{ marginTop: 8 }}>켜면 코스가 점심(11:30~1:30)·저녁(5:30~7:30) 때를 지날 때 가는 길 가까운 식당 한 곳을 같이 넣어요. 고를 때 &lsquo;점심도 넣어 줘요&rsquo;로 그때만 켤 수도 있어요</T>
      </>}
    </View>
  );
}

/** 오늘 탭 '바꾸기' */
export function FamilySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useSession();
  const p = usePlan();
  const t = useTheme();
  const [f, setF] = useState<Family>(DEFAULT_FAMILY);
  const [home, setHome] = useState<[number, number] | null>(null);
  const [homeTouched, setHomeTouched] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /** 머무는 편 (빨리 둘러봐요 0.8× · 보통 · 오래 놀아요 1.25×) — 바꾸면 서버가 배율을 이 값으로 다시 시작 */
  const [pref, setPref] = useState<DwellPref>('normal');
  /** 기본 동행 (이 폰 기억 → 서버 가족 설정 companion) */
  const askMem = useAskMemory();
  const [comp, setComp] = useState<Companion>('kids');
  useEffect(() => {
    if (!open) return;
    setComp(companionNow(askMem.companion ?? p.family?.companion));
    setErr(''); setHomeTouched(false);
    setPref(p.family?.dwellPref ?? 'normal');
    const v = p.family;
    if (v) setF({ kidAges: v.kidAges, napStart: v.napStart, napLen: v.napLen, backBy: v.backBy, dinner: v.dinner,
      bedtime: v.bedtime ?? DEFAULT_BEDTIME, lateReturn: v.lateReturn ?? DEFAULT_LATE_RETURN, mealPlan: v.mealPlan ?? false });
    setHome(v?.home ?? null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const hereAsHome = async () => {
    tick();
    setLocating(true);
    const at = await currentSpot();
    setLocating(false);
    if (!at) { Alert.alert('위치를 알 수 없어요', '휴대폰 설정에서 마일스탬프의 위치 권한을 켜 주세요. 지도에서 골라도 돼요.'); return; }
    setHome([round3(at[0]), round3(at[1])]); setHomeTouched(true);
  };

  const save = async () => {
    if (!token) return;
    setBusy(true); setErr('');
    try {
      // 가족 다섯 칸 + (바꿨으면) 집. 즐겨찾기는 오늘 도착 시트가 따로 저장한다
      const body: Partial<Family> = { kidAges: f.kidAges, napStart: f.napStart, napLen: f.napLen, backBy: f.backBy, dinner: f.dinner };
      // 저녁 나들이 귀가 기준은 바꿨을 때만 (옛 서버는 칸을 모름 → 보내지 않으면 그대로)
      if ((f.bedtime ?? DEFAULT_BEDTIME) !== (p.family?.bedtime ?? DEFAULT_BEDTIME)) body.bedtime = f.bedtime;
      if ((f.lateReturn ?? DEFAULT_LATE_RETURN) !== (p.family?.lateReturn ?? DEFAULT_LATE_RETURN)) body.lateReturn = f.lateReturn;
      // 밥도 같이 짜기도 바꿨을 때만 (옛 서버는 칸을 모름)
      if (!!f.mealPlan !== !!p.family?.mealPlan) body.mealPlan = !!f.mealPlan;
      if (homeTouched) body.home = home;
      if (pref !== (p.family?.dwellPref ?? 'normal')) (body as { dwellPref?: DwellPref }).dwellPref = pref;
      (body as { companion?: Companion }).companion = comp;
      setAskMemory({ companion: comp });
      p.setFamily(await putFamily(token, body));
      done();
      onClose();
      // 서버가 아직 안 고른 계획을 다시 계산하게 표시해 둔다 → 새로 받기
      p.reload({ full: true });
    } catch (e: any) { setErr(plainError(e, '저장하지 못했어요. 다시 눌러 주세요')); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} full>
      <T v="title">함께 가는 사람</T>
      <T v="sub" c="ink3" style={{ marginTop: 4, marginBottom: 6 }}>오늘 추천을 계산할 때 써요. 언제든 바꿀 수 있어요.</T>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        <Label>기본 동행</Label>
        {/* 넷이라 한 줄 칸(Segmented)에선 글이 잘려서 두 줄 칩으로 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {COMPANIONS.map((k) => {
            const on = k === comp;
            return (
              <Pressable key={k} onPress={() => { tick(); setComp(k); }} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={{ flexBasis: '47%', flexGrow: 1, minHeight: 48, borderRadius: R.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: on ? t.ink : t.fill }}>
                <Icon name={COMPANION_INFO[k].icon} size={16} color={on ? t.onInk : t.ink2} />
                <T v="h" style={{ fontSize: 15, color: on ? t.onInk : t.ink2 }}>{COMPANION_INFO[k].label}</T>
              </Pressable>
            );
          })}
        </View>
        <T v="cap" c="ink3" style={{ marginTop: 8, marginBottom: 18 }}>{COMPANION_INFO[comp].sub} · 오늘 탭에서 그날그날 바꿀 수 있어요</T>
        <FamilyForm value={f} onChange={setF} noKids={comp !== 'kids'} />
        <DwellField pref={pref} onChange={setPref} text={p.family?.dwell?.text} kids={comp === 'kids'} />
        <HomeField home={home} locating={locating} onHere={hereAsHome} onMap={() => { tick(); setMapOpen(true); }} />
      </ScrollView>
      {!!err && <View style={{ marginTop: 8 }}><Pill text={err} tone="red" icon="circle-alert" /></View>}
      <Btn title="저장하고 다시 계산하기" onPress={save} busy={busy} style={{ marginTop: 12 }} />
      <MapPickSheet open={mapOpen} onClose={() => setMapOpen(false)} title="집 위치" sub="집이 있는 곳에 핀을 두세요 · 약 100m 단위로만 저장해요"
        start={home} onPick={(lat, lng) => { setHome([lat, lng]); setHomeTouched(true); setMapOpen(false); done(); }} />
    </Sheet>
  );
}

/** 집 위치 칸: 정했는지 · 지금 위치를 집으로 · 지도에서 고르기 */
function HomeField({ home, locating, onHere, onMap }: { home: [number, number] | null; locating: boolean; onHere: () => void; onMap: () => void }) {
  const t = useTheme();
  return (
    <View>
      <View style={{ height: 18 }} />
      <Label>집 위치</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.fill, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12 }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: home ? t.accentSoft : t.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="house" size={17} color={home ? t.accent : t.ink3} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="h" style={{ fontSize: 15, lineHeight: 21 }}>{home ? '집을 정했어요' : '아직 안 정했어요'}</T>
          <T v="cap" c="ink3">{home ? `${home[0].toFixed(3)}, ${home[1].toFixed(3)} · 약 100m 단위` : '정하기 전엔 차가 아는 집으로 계산해요'}</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Btn title="지금 위치를 집으로" icon="locate-fixed" kind="soft" small busy={locating} onPress={onHere} style={{ flex: 1 }} />
        <Btn title="지도에서 고르기" icon="map" kind="soft" small onPress={onMap} style={{ flex: 1 }} />
      </View>
      <T v="cap" c="ink3" style={{ marginTop: 8 }}>집 좌표는 우리 차와 가족 폰만 써요. 귀가 시간 계산과 차 길 안내에 써요</T>
    </View>
  );
}

/** 머무는 편: 우리 가족이 한 곳에서 얼마나 노는지 — 처음 값. 다녀올 때마다 실제 머문 시간을 배워 조금씩 맞춘다 */
function DwellField({ pref, onChange, text, kids }: { pref: DwellPref; onChange: (p: DwellPref) => void; text?: string; kids?: boolean }) {
  return (
    <View>
      <View style={{ height: 18 }} />
      <Label>머무는 편</Label>
      <Segmented<DwellPref> value={pref}
        options={[{ key: 'quick', label: '빨리 둘러봐요' }, { key: 'normal', label: '보통' }, { key: 'long', label: '오래 놀아요' }]}
        onChange={(k) => { tick(); onChange(k); }} />
      <T v="cap" c="ink3" style={{ marginTop: 8 }}>
        {pref === 'quick' ? '보통보다 조금 짧게 머문다고 보고 시작해요' : pref === 'long' ? '보통보다 조금 길게 머문다고 보고 시작해요' : kids ? '4살 아이 가족 보통 시간으로 시작해요' : '보통 머무는 시간으로 시작해요'}
        {' · 다녀올 때마다 실제로 머문 시간을 배워 맞춰요'}
      </T>
      {!!text && <T v="cap" c="ink2" style={{ marginTop: 4, fontFamily: F.b }}>{text}</T>}
    </View>
  );
}
