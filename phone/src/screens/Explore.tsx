// 오늘 탭 '내가 고르기' — 고르는 줄 [추천 · 축제 · 100선 · 직접 찾기] + 목록 + '○○ 중심으로' 결과 카드 (docs/직접-고르기-계획.md 2·3·4절)
// - 추천 = 지금 카드 3장(PlanSection). 나머지는 한 곳(앵커)을 먼저 고르면 서버(POST /api/plan/anchor)가 앞뒤로 0~2곳을 붙여 최대 3장을 짠다.
// - 축제: 서버 /api/explore/festivals(관광공사 전국 축제 + 등록 축제, 기본 차로 2시간 안)가 있으면 그것, 없거나(404) 실패하면
//   앱이 받은 등록 축제(catalog). 아래에 우리 명소 34곳(도장) — 가까운 순, 차로 몇 분, '우리 도장' 표시.
// - 100선 · 직접 찾기: /api/explore/kto100 · /api/explore/search. 서버에 아직 없으면(404) '준비 중'.
// - 2차(docs/고르기-2차-계획.html 4~8절): 축제·100선 = 거리 칩 1·2·3시간 · 전국▾(시·도 여러 곳) · 인기 + '지도로 보기'
//   (부품 ../explore/ExploreFilters · RegionSheet · ExploreMap, 고른 값은 탭마다 이 폰에 기억).
// - 검색·거리순(docs/검색-거리순-계획.md): 칩 '거리순' + 기준 위치 줄('우리 집 기준 ▾' → RefSheet, 탭 공용·이 폰에 기억).
//   직접 찾기 = 검색창(카카오 자동완성) + 지도(길게 눌러 핀) — ../explore/SearchMap. 코스 짜기는 언제나 집에서 출발.
// - 고른 곳 결과: 같은 추천 카드(OptionCard) + 장소마다 'ⓘ 왜?'. 앵커에서 머무는 시간은 −30/+30으로 바꿔 다시 짠다.
//   귀가 한계를 넘는 카드는 고를 때 '오늘만 귀가 한계 늦추기'를 묻는다(코스 사건 SetEnd). 편도 3시간 넘으면 '1박은 아직 몰라요'.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Alert } from '../alert';
import { catalogPlaces, driveMin, festivals, festivalStatus, md, today, useCatalogRev } from '../catalog';
import { durText } from '../course';
import { anchorPlan, type AnchorIn, type AnchorRes, type ExploreItem, type PlanRes, type Stop, type PlanOption, type StopRef, span } from '../plan';
import { usePlan } from '../planStore';
import { getAskMemory } from '../ask';
import { useSession } from '../session';
import { clock, clockText } from '../timefmt';
import { usePlaceDetail } from '../placeDetail';
import { place } from '../places';
import { F, R, S } from '../theme';
import { done, Icon, IconName, Pill, plainError, Sheet, Skeleton, T, tick, useTheme } from '../ui';
import { ActionButton, Empty, ErrorRow, Row } from '../parts';
import { PlacePhoto } from '../parts/PlacePhoto';
import { OptionCard } from './PlanSection';
import { CourseMiniMap } from './CourseMap';
import { CourseEditSheet, type EditStop } from './CourseEditSheet';
import { WhySheet } from './WhySheet';
import {
  DEFAULT_FILTERS, DEFAULT_REF, getList, loadFilters, loadRef, refPoint, regionName, saveFilters, saveRef, withRef,
  type Filters, type Item, type RefLoc, type RefState,
} from '../explore/api';
import { ExploreFilters, ExploreSummary, RefRow } from '../explore/ExploreFilters';
import { RefSheet } from '../explore/RefSheet';
import { SearchMap } from '../explore/SearchMap';
import { ExploreMap } from '../explore/ExploreMap';
import { RegionSheet } from '../explore/RegionSheet';

export type ExploreTab = 'rec' | 'festival' | 'kto100' | 'search';
const TABS: { key: ExploreTab; label: string; icon: IconName }[] = [
  { key: 'rec', label: '추천', icon: 'route' },
  { key: 'festival', label: '축제', icon: 'party-popper' },
  { key: 'kto100', label: '100선', icon: 'trophy' },
  { key: 'search', label: '직접 찾기', icon: 'search' },
];

/** 이보다 멀면 '당일치기 빠듯해요' · '1박은 아직 몰라요' (거리 칩 기본 2시간은 ../explore/api DEFAULT_FILTERS) */
const TIGHT_MIN = 150;
const OVERNIGHT_MIN = 180;

/** 고르는 줄 — '오늘 어디 갈까요' 위 */
export function ExploreTabs({ tab, onChange }: { tab: ExploreTab; onChange: (t: ExploreTab) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: S.xs, marginTop: S.l, padding: S.xs, backgroundColor: t.fill, borderRadius: R.pill }}>
      {TABS.map((x) => {
        const on = x.key === tab;
        return (
          <Pressable key={x.key} onPress={() => { tick(); onChange(x.key); }} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={({ pressed }) => ({ flex: 1, minHeight: 40, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
              backgroundColor: on ? t.surface : pressed ? t.line : 'transparent' })}>
            <Icon name={x.icon} size={14} color={on ? t.accent : t.ink3} strokeWidth={on ? 2.4 : 2} />
            <T v="label" numberOfLines={1} style={{ color: on ? t.ink : t.ink3, fontFamily: on ? F.xb : F.b }}>{x.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 집(또는 시험 장면 위치) — 목록의 '차로 몇 분' 기준 */
function useHome(): { lat: number; lng: number } {
  const p = usePlan();
  const home = p.family?.home;
  return p.test?.loc ?? (home ? { lat: home[0], lng: home[1] } : { lat: 35.8858, lng: 128.5828 });
}

/** 앱이 받은 등록 축제 + 우리 명소 34곳 (서버 목록이 없을 때·명소 칸) */
function catalogItems(home: { lat: number; lng: number }): { fest: ExploreItem[]; ours: ExploreItem[] } {
  const now = today();
  const fest = festivals()
    .filter((f) => festivalStatus(f, now) !== 'ended')
    .map((f): ExploreItem => ({
      kind: 'festival', id: f.id, name: f.name, starts: f.starts, ends: f.ends, lat: f.lat, lng: f.lng, addr: '', image: f.poster,
      driveMin: driveMin(home, f), indoor: f.indoor, ourStamp: true, thisWeekend: festivalStatus(f, now) === 'running',
    }))
    .sort((a, b) => Number(!!b.thisWeekend) - Number(!!a.thisWeekend) || (a.driveMin ?? 0) - (b.driveMin ?? 0));
  const ours = catalogPlaces()
    .map((p): ExploreItem => ({ kind: 'place', id: p.id, name: p.name, lat: p.lat, lng: p.lng, addr: '', image: null, driveMin: driveMin(home, p), indoor: p.indoor, ourStamp: p.stampable }))
    .sort((a, b) => (a.driveMin ?? 0) - (b.driveMin ?? 0));
  return { fest, ours };
}

/** 목록 한 줄 → 앵커 */
export function anchorOf(it: ExploreItem): AnchorIn {
  if (it.kind === 'tour' && it.ourPlaceId) return { kind: 'place', id: it.ourPlaceId, name: it.name, lat: it.lat, lng: it.lng };
  return { kind: it.kind, id: it.id, name: it.name, lat: it.lat, lng: it.lng, ...(it.indoor != null ? { indoor: it.indoor } : {}) };
}

/** 축제는 아직 시작 전이면 시작하는 날로 짠다 */
export function dayOf(it: ExploreItem): string | undefined {
  const now = today();
  return it.starts && it.starts > now ? it.starts : undefined;
}

type Loaded = { status: 'loading' } | { status: 'soon' } | { status: 'error'; msg: string }
  | { status: 'ok'; items: Item[]; tourOk: boolean; places?: Item[]; v2?: boolean; regionCounts?: Record<string, number>; regionCountsAll?: Record<string, number>; popularReady?: boolean };

/** day = 대화형 고르기에서 '내일·주말 미리'로 고른 날 (없으면 오늘, 축제는 시작하는 날) */
export function ExploreSection({ tab, onChosen, day }: { tab: Exclude<ExploreTab, 'rec'>; onChosen: () => void; day?: string }) {
  const t = useTheme();
  const { token } = useSession();
  useCatalogRev();
  const home = useHome();
  // 기준 위치 (탭 공용, 이 폰에 기억). 목록의 '차로 ○분'·거리 칩·거리순이 이 기준
  const [refS, setRefS] = useState<RefState>(DEFAULT_REF);
  const [refOpen, setRefOpen] = useState(false);
  useEffect(() => { let live = true; loadRef().then((r) => { if (live) setRefS(r); }); return () => { live = false; }; }, []);
  const changeRef = (r: RefLoc) => { const n = withRef(refS, r); setRefS(n); saveRef(n); setRefOpen(false); };
  const from = refPoint(refS.cur);
  const fromKey = from ? `${from.lat.toFixed(4)},${from.lng.toFixed(4)}` : 'home';
  const center = from ?? home;
  /** 앵커 시트의 '차로 ○분'은 집 기준일 때만 (코스는 집에서 출발 — 기준이 다르면 서버가 준 편도로) */
  const pickDrive = (m: number | null) => (from ? null : m);
  const [list, setList] = useState<Loaded>({ status: 'loading' });
  const [pick, setPick] = useState<{ anchor: AnchorIn; day?: string; driveMin: number | null } | null>(null);
  // 거리·지역·인기 (탭마다 이 폰에 기억). 읽기 전엔 목록을 안 부른다(두 번 부르지 않게)
  const ftab = tab === 'search' ? null : tab;
  const [filters, setFilters] = useState<Filters | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setFilters(null);
    if (ftab) loadFilters(ftab).then((f) => { if (live) setFilters(f); });
    return () => { live = false; };
  }, [ftab]);
  const changeFilters = (f: Filters) => {
    setFilters(f);
    if (ftab) saveFilters(ftab, f);
  };

  const load = useCallback(async () => {
    if (!token) return;
    if (tab === 'search') { setList({ status: 'ok', items: [], tourOk: true }); return; }
    if (!filters) { setList({ status: 'loading' }); return; }
    setList({ status: 'loading' });
    try {
      const r = await getList(token, tab === 'festival' ? 'festivals' : 'kto100', filters!, { places: tab === 'festival', from, day });
      setList(r.status === 'soon' ? { status: 'soon' } : r);
    } catch (e) {
      setList({ status: 'error', msg: plainError(e, '목록을 불러오지 못했어요') });
    }
  }, [token, tab, filters, fromKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const local = useMemo(() => catalogItems(center), [center.lat, center.lng, festivals().length]); // eslint-disable-line react-hooks/exhaustive-deps
  // 축제: 서버 목록 → 없거나 실패하면 앱에 있는 등록 축제. 기본은 차로 2시간 안
  const f = filters ?? DEFAULT_FILTERS;
  const near = (xs: Item[]) => {
    const ys = f.maxMin == null ? xs : xs.filter((x) => x.driveMin == null || x.driveMin <= f.maxMin!);
    return f.distance ? [...ys].sort((a, b) => (a.driveMin ?? 1e9) - (b.driveMin ?? 1e9)) : ys;
  };
  let items: Item[] = [];
  let note: string | null = null;
  if (tab === 'festival') {
    if (list.status === 'ok') items = list.items;
    else if (list.status !== 'loading') { items = near(local.fest); note = '등록된 축제만 보여 드려요'; }
    if (list.status === 'ok' && !list.tourOk) note = '전국 축제 목록을 잠깐 못 받았어요 · 등록 축제만';
  } else if (list.status === 'ok') items = list.items;
  const v2 = list.status === 'ok' && !!list.v2;
  if (tab !== 'search' && f.popular && list.status === 'ok' && !note) {
    note = !v2 ? '인기 순은 서버 새 판에서 열려요' : !list.popularReady ? '아직 고른 가족이 적어서 이번 주말 → 가까운 순이에요' : null;
  }
  if (tab !== 'search' && f.regions.length && list.status === 'ok' && !v2 && !note) note = '지역 고르기는 서버 새 판에서 열려요';
  // 축제 칸 아래 우리 명소: 서버가 같은 거르기로 준 것 → 없으면 앱 목록(거리만)
  const ours: Item[] = list.status === 'ok' && list.places ? list.places : near(local.ours);
  const mapTitle = tab === 'festival' ? '축제 지도' : '100선 지도';

  const title = tab === 'festival' ? '축제에서 고르기' : tab === 'kto100' ? '한국관광 100선에서 고르기' : '직접 찾아 고르기';
  const sub = '한 곳을 고르면 그곳 중심으로 앞뒤를 짜 드려요';

  return (
    <View>
      <T v="title" accessibilityRole="header" style={{ fontSize: 20, lineHeight: 27, letterSpacing: -0.4, marginTop: S.sec, paddingHorizontal: S.xxs }}>{title}</T>
      <T v="cap" c="ink3" style={{ marginTop: S.xxs, paddingHorizontal: S.xxs }}>{sub}</T>

      {tab === 'search' && (
        <>
          <RefRow value={refS.cur} onPress={() => setRefOpen(true)} />
          <SearchMap token={token ?? null} refLoc={refS.cur} home={home} onSetRef={changeRef}
            onAnchor={(anchor, driveMin) => setPick({ anchor, driveMin, day })} />
        </>
      )}
      {tab !== 'search' && list.status !== 'soon' && (
        <>
          <ExploreFilters value={f} onChange={changeFilters} onRegions={() => setRegionOpen(true)} />
          <RefRow value={refS.cur} onPress={() => setRefOpen(true)} />
          <ExploreSummary value={f} count={list.status === 'loading' ? null : items.length} note={note}
            onMap={list.status === 'loading' || !items.length ? undefined : () => setMapOpen(true)} />
        </>
      )}

      {list.status === 'loading' && tab !== 'festival' && <ListSkeleton />}
      {list.status === 'soon' && tab !== 'festival' && (
        <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg }}>
          <Empty compact icon="hourglass" title="준비 중이에요" sub={tab === 'kto100' ? '한국관광 100선 목록을 곧 넣을게요' : '이름으로 찾기는 곧 열려요'} />
        </View>
      )}
      {list.status === 'error' && tab !== 'festival' && <ErrorRow title={list.msg} onRetry={load} style={{ marginTop: S.l }} />}

      {tab === 'festival' && list.status === 'loading' && <ListSkeleton rows={2} />}
      {tab === 'kto100' && list.status === 'ok' && items.length === 0 && (
        <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg }}>
          <Empty compact icon="trophy" title="이 조건에 맞는 100선이 없어요" sub="거리 칩을 넓히거나 지역을 바꿔 보세요" />
        </View>
      )}
      {(tab !== 'festival' || list.status !== 'loading') && items.length > 0 && (
        <ItemList items={items} onPick={(it) => setPick({ anchor: anchorOf(it), day: dayOf(it), driveMin: pickDrive(it.driveMin) })} />
      )}
      {tab === 'festival' && list.status !== 'loading' && items.length === 0 && (
        <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg }}>
          <Empty compact icon="party-popper" title={f.maxMin != null ? `차로 ${f.maxMin / 60}시간 안에 열리는 축제가 없어요` : '열리는 축제가 없어요'}
            sub={f.maxMin != null && f.maxMin < 180 ? '거리 칩을 넓히거나 아래 우리 명소에서 골라도 돼요' : '아래 우리 명소에서 골라도 돼요'} />
        </View>
      )}
      {/* 축제 칸 아래: 우리 명소 34곳 (도장) */}
      {tab === 'festival' && list.status !== 'loading' && ours.length > 0 && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, marginTop: S.sec, paddingHorizontal: S.xs }}>
            <Icon name="stamp" size={16} color={t.ink} />
            <T v="h" accessibilityRole="header" style={{ flex: 1 }}>우리 명소 {ours.length}곳</T>
          </View>
          <ItemList items={ours} onPick={(it) => setPick({ anchor: anchorOf(it), driveMin: pickDrive(it.driveMin) })} />
        </>
      )}

      {filters && (
        <RegionSheet open={regionOpen} onClose={() => setRegionOpen(false)} value={filters}
          counts={list.status === 'ok' && list.v2 ? list.regionCounts ?? null : null}
          countsAll={list.status === 'ok' && list.v2 ? list.regionCountsAll ?? null : null}
          onApply={(nf) => { setRegionOpen(false); changeFilters(nf); }} />
      )}
      <ExploreMap open={mapOpen} onClose={() => setMapOpen(false)} title={mapTitle} items={items} home={home}
        korea={tab !== 'search' && f.maxMin == null && !f.regions.length}
        onPick={(it) => {
          setMapOpen(false);
          // 지도 시트가 닫힌 뒤 코스 시트를 연다 (모달 두 개가 겹쳐 뜨지 않게)
          setTimeout(() => setPick({ anchor: anchorOf(it), day: dayOf(it), driveMin: pickDrive(it.driveMin) }), 260);
        }} />
      <RefSheet open={refOpen} onClose={() => setRefOpen(false)} value={refS} token={token ?? null} onChange={changeRef} />

      <AnchorSheet target={pick} onClose={() => setPick(null)} onChosen={() => { setPick(null); onChosen(); }} />
    </View>
  );
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg, padding: S.l + 2, gap: S.l }}>
      {Array.from({ length: rows }, (_, k) => <Skeleton key={k} h={36} r={R.sm} />)}
    </View>
  );
}

/** '차로 1시간 20분' */
const driveText = (m: number | null) => (m == null ? null : `차로 ${span(m)}`);

/** 목록은 20곳씩 — 더 보려면 '20곳 더 보기' (오늘 탭·대화 화면 스크롤 안에 놓여서 FlatList 대신 나눠 그림) */
export const PAGE = 20;

function ItemList({ items, onPick }: { items: ExploreItem[]; onPick: (it: ExploreItem) => void }) {
  const t = useTheme();
  // 거르기·정렬이 바뀌면(첫·끝 곳이나 수가 달라짐) 다시 20곳부터
  const listKey = `${items.length}:${items[0]?.id ?? ''}:${items[items.length - 1]?.id ?? ''}`;
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setShown(PAGE); }, [listKey]);
  // 줄은 memo — 부모가 다시 그려져도(시트 열기 등) 줄·사진은 그대로. 누름은 늘 최신 onPick으로
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pick = useCallback((it: ExploreItem) => pickRef.current(it), []);
  const rest = items.length - shown;
  return (
    <>
      <View style={{ marginTop: S.m, backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.l + 2 }}>
        {items.slice(0, shown).map((it, i) => <ItemRow key={it.id} it={it} first={i === 0} onPick={pick} />)}
      </View>
      {rest > 0 && (
        <ActionButton label={`${Math.min(PAGE, rest)}곳 더 보기 · 남은 ${rest}곳`} icon="chevron-down" tone="plain" size="row"
          onPress={() => setShown((n) => n + PAGE)} style={{ marginTop: S.s }} />
      )}
    </>
  );
}

const ItemRow = memo(function ItemRow({ it, first, onPick }: { it: ExploreItem; first: boolean; onPick: (it: ExploreItem) => void }) {
  const t = useTheme();
  const far = it.driveMin != null && it.driveMin > OVERNIGHT_MIN ? '1박은 아직 몰라요' : it.driveMin != null && it.driveMin > TIGHT_MIN ? '당일치기 빠듯해요' : null;
  const sub = [
    // 100선 탭에선 '한국관광 100선'이 겹치니 시·도 이름으로
    it.starts && it.ends ? `${md(it.starts)}~${md(it.ends)}` : it.type === '한국관광 100선' && (it as Item).region ? regionName((it as Item).region!) : it.type ?? null,
    driveText(it.driveMin),
    it.indoor == null ? null : it.indoor ? '실내' : '야외',
    far,
    // 동행에 덜 맞으면 흐린 글로만 ('어른 위주 행사')
    it.fitNote && (it.fitSign ?? 0) <= 0 ? it.fitNote : null,
  ].filter(Boolean).join(' · ') + ((it as Item).popular ? `\n${(it as Item).popular}가족이 골랐어요` : '');
  const icon: IconName = it.kind === 'festival' || (it.starts && it.ends) ? 'party-popper' : (place(it.ourPlaceId ?? it.id)?.icon ?? 'map-pin');
  const ours = it.ourStamp || !!it.ourPlaceId;
  return (
    <View style={first ? undefined : { borderTopWidth: 1, borderTopColor: t.line }}>
      <Row leading={<PlacePhoto uri={it.image} id={it.ourPlaceId ?? it.id} w={52} h={52} r={R.sm} icon={icon} />} title={it.name} sub={sub || undefined} lines={(it as Item).popular ? 2 : 1}
        onPress={() => onPick(it)}
        trailing={(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
            {/* 동행에 잘 맞으면 작은 이름표 ('연인과 좋아요') */}
            {it.fitNote && (it.fitSign ?? 0) > 0 && !ours && <Pill text={it.fitNote} tone="ok" />}
            {ours && <Pill text="우리 도장" tone="accent" icon="stamp" />}
            {it.thisWeekend && !ours && <Pill text="이번 주말" tone="red" />}
            <Icon name="chevron-right" size={18} color={t.ink3} />
          </View>
        )} />
    </View>
  );
});

// ---------- '○○ 중심으로' 결과 ----------

/** 앵커 답 → 추천 카드가 읽는 계획 모양 */
function asPlanRes(r: AnchorRes): PlanRes {
  return { planId: r.planId, day: r.day, reused: false, plan: r.plan, sky: r.sky, backBy: r.backBy, chosen: null, chosenBy: null, createdAt: '' };
}

export function AnchorSheet({ target, onClose, onChosen }: { target: { anchor: AnchorIn; day?: string; driveMin: number | null } | null; onClose: () => void; onChosen: () => void }) {
  const t = useTheme();
  const { token } = useSession();
  const p = usePlan();
  const [dwell, setDwell] = useState<number | undefined>(undefined);
  const [res, setRes] = useState<AnchorRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [whyOf, setWhyOf] = useState<{ o: PlanOption; st: Stop } | null>(null);
  // '코스 고치기' 중인 카드 번호 (순서 바꾸기·빼기·더하기·머무름 — 중심 곳은 못 뺌)
  const [editOf, setEditOf] = useState<number | null>(null);
  const key = target ? `${target.anchor.kind}:${target.anchor.id}:${target.day ?? ''}` : '';
  useEffect(() => { setDwell(undefined); setRes(null); setErr(null); setEditOf(null); }, [key]);
  useEffect(() => {
    if (!token || !target) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    // 누구랑 (대화형 고르기에서 고른 동행 — 새 서버만 씀)
    anchorPlan(token, { ...target.anchor, ...(dwell != null ? { dwell } : {}) }, target.day, getAskMemory().companion ?? undefined)
      .then((r) => { if (alive) setRes(r); })
      .catch((e) => { if (alive) setErr(plainError(e, '코스를 짜지 못했어요')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, key, dwell]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = res?.anchor;
  const cur = dwell ?? a?.dwell;
  const step = (d: number) => { if (cur != null) setDwell(Math.min(360, Math.max(30, cur + d))); };
  const go = async (i: number, extend: boolean) => {
    if (!res) return;
    setBusy(i);
    try { await p.chooseAnchor(res, i, extend); done(); onChosen(); }
    catch (e) { Alert.alert('보내지 못했어요', plainError(e, '잠시 뒤 다시 눌러 주세요')); }
    finally { setBusy(null); }
  };
  const pick = (i: number) => {
    const o = res!.plan.options[i];
    if (!o.overLimit) { go(i, false); return; }
    const canExtend = o.arriveHomeMin + 10 < 24 * 60;
    Alert.alert('귀가 한계를 넘어요', `이 코스는 집에 ${clock(o.arriveHomeMin)} 도착이에요.${canExtend ? ' 오늘만 귀가 한계를 늦출까요?' : ' 자정을 넘겨서 한계를 늦출 수 없어요.'}`, [
      ...(canExtend ? [{ text: '오늘만 늦추기', onPress: () => go(i, true) }] : []),
      { text: '그대로 고르기', onPress: () => go(i, false) },
      { text: '취소', style: 'cancel' as const },
    ]);
  };
  const name = target?.anchor.name ?? '';
  const info = usePlaceDetail(target?.anchor.id, target?.day);
  const d = res ? asPlanRes(res) : null;
  const futureDay = res && target?.day && res.day !== today() ? `${md(res.day)} 기준으로 짰어요 · ` : '';

  return (
    <Sheet open={!!target} onClose={onClose} full>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: S.l }} showsVerticalScrollIndicator={false}>
        <T v="title" accessibilityRole="header">{name} 중심으로</T>
        {/* 운영 정보 한 줄 (B3) — 받기 전엔 자리만 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.xs, minHeight: 18 }}>
          <Icon name="clock" size={13} color={t.ink3} />
          <T v="cap" c="ink3" numberOfLines={1} style={{ flex: 1 }}>{info ? clockText(info.line) : ' '}</T>
        </View>
        <T v="sub" c="ink3" style={{ marginTop: S.xxs }}>
          {futureDay}{[driveText(target?.driveMin ?? null), a ? `편도 약 ${span(a.oneWayMin)}` : null].filter(Boolean)[0] ?? '코스를 짜는 중이에요'}
        </T>

        {/* 앵커에서 머무는 시간 */}
        {cur != null && (
          <View style={{ marginTop: S.l, flexDirection: 'row', alignItems: 'center', gap: S.m, backgroundColor: t.fill, borderRadius: R.md + 2, paddingVertical: S.s, paddingHorizontal: S.l }}>
            <Icon name="clock" size={18} color={t.ink2} />
            <View style={{ flex: 1 }}>
              <T v="h">여기서 {durText(cur)} 놀아요</T>
              <T v="cap" c="ink3">{dwell != null ? '직접 정했어요' : a?.kind === 'festival' ? '축제는 기본 2시간' : '평소 머무는 시간'}</T>
            </View>
            <ActionButton label="−30분" tone="surface" size="sm" disabled={loading || cur <= 30} onPress={() => step(-30)} />
            <ActionButton label="+30분" tone="surface" size="sm" disabled={loading || cur >= 360} onPress={() => step(30)} />
          </View>
        )}
        {a?.overnight && (
          <View style={{ marginTop: S.m, flexDirection: 'row', alignItems: 'center', gap: S.s, backgroundColor: t.fill, borderRadius: R.md + 2, padding: S.l }}>
            <Icon name="triangle-alert" size={18} color={t.red} />
            <T v="cap" c="redText" style={{ flex: 1, fontFamily: F.b }}>편도 {span(a.oneWayMin)} · 1박 여행은 아직 몰라요. 당일로만 짰어요</T>
          </View>
        )}

        {loading && !res && (
          <View style={{ marginTop: S.l, gap: S.m }}>
            <Skeleton h={18} w="60%" />
            <Skeleton h={120} r={R.lg} />
          </View>
        )}
        {err && <ErrorRow title={err} sub="잠시 뒤 다시 해 주세요" style={{ marginTop: S.l }} />}
        {a?.closed && (
          <Empty compact icon="moon" title="오늘은 문 닫기 전에 못 가요" sub="다른 날이나 다른 곳을 골라 주세요" />
        )}
        {/* 첫 코스 작은 지도 + 들렀다 오면/바로 오면 (편도는 서버 oneWayMin) */}
        {d && d.plan.options[0]?.stops.length > 0 && !a?.closed && (
          <CourseMiniMap o={d.plan.options[0]} oneWayMin={a?.oneWayMin} start={d.day === today() ? p.hereNow() : null} day={d.day}
            home={p.family?.home ? { lat: p.family.home[0], lng: p.family.home[1] } : null} />
        )}
        {d && d.plan.options.map((o, i) => (
          <OptionCard key={`${i}:${o.stops.map((x) => x.id).join()}`} d={d} o={o} i={i} dinner={p.family?.dinner ?? null}
            strong={i === 0} chosen={false} anyChosen={false} busy={busy === i} disabled={busy != null || loading} firstLabel={false}
            onPick={() => pick(i)}
            editLabel="코스 고치기" onEdit={o.stops.length && !a?.closed ? () => setEditOf(i) : undefined}
            onWhy={o.why?.length ? (st) => setWhyOf({ o, st }) : undefined} />
        ))}
      </ScrollView>
      {res && editOf != null && res.plan.options[editOf] && (() => {
        const o = res.plan.options[editOf];
        // 바깥 장소(ext)는 이름·좌표째 보낸다 (고르기 chooseAnchorCourse와 같은 모양)
        const ref = (id: string): StopRef => { const st = o.stops.find((x) => x.id === id); return st?.ext ? { id, ...st.ext } : id; };
        return (
          <CourseEditSheet open onClose={() => setEditOf(null)} day={res.day} planId={res.planId} anchorId={o.anchorId ?? undefined} stopRef={ref}
            initial={o.stops.map((st): EditStop => ({ id: st.id, name: st.name, indoor: st.indoor, dwell: st.dwell?.minutes ?? 60 }))}
            // 중심 곳 머무름(정한 값)도 같이 — '이대로 보내기'(chooseAnchor)와 같게
            initialDwell={o.anchorId ? { [o.anchorId]: res.anchor.dwell } : {}}
            onApply={async (stops, dw) => {
              await p.choosePlanned(res.planId, { stops: stops.map(ref), ...(o.anchorId && stops.includes(o.anchorId) ? { anchor: o.anchorId } : {}) }, dw);
              setEditOf(null);
              onChosen();
            }} />
        );
      })()}
      <WhySheet stop={whyOf?.st ?? null} why={whyOf?.o.why?.find((w) => w.placeId === whyOf.st.id) ?? null} onClose={() => setWhyOf(null)} />
    </Sheet>
  );
}
