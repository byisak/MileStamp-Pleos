// 도장북: 모은 도장 원형 그리드 (흑백 = 아직, 컬러 = 찍음). 누르면 크게.
// 데모 차(개발 모드)에서는 아직 안 찍은 도장에 노란 고리가 돌고, 누르면 바로 찍혀 메달 연출 → 칸으로 날아와 꽂힌다.
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, RefreshControl, useWindowDimensions, View } from 'react-native';
import { Alert } from '../alert';
import { call, clearDemo, getStamps, sendDemo, StampRow } from '../api';
import { useEvents } from '../events';
import { MedalEnd, MedalInfo, MedalOverlay, medalShareTarget, medalTipTarget, Rect, storyEvent } from '../medal';
import { askTipOnce, openComposer, resetTipAsked } from '../community';
import { MissionsSection } from './Missions';
import { ALBUM, ALBUM_SECTIONS, albumKeyOf, RARE_NIGHT } from '../places';
import { useSession } from '../session';
import { useDevUi } from '../devclean';
import { F, R, S } from '../theme';
import { Btn, done, friendlyError, Icon, MAX_W, Page, Pill, Segmented, Sheet, Skeleton, T, dayLabel, hm, tap, tick, useTheme } from '../ui';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { Chip, ErrorRow, IconBadge, Landscape, Row, useReducedMotion } from '../parts';
import { CatalogFestival, festivals, festivalStatus, stampArt, useCatalogRev } from '../catalog';
import { FestivalCell, FestivalSheet } from './Festival';
import { PlaceDwell } from './PlaceDwell';
import { stampNo } from '../words';
import { isCompanion } from '../plan';
import { dayOf } from '../diary';
import { COMPANION_INFO } from '../ask';

/** 칸마다 찍은 기록 (비 오는 날 디아크·밤의 ○○는 장소 칸도 채운다) */
export function stampsByKey(rows: StampRow[]) {
  const m: Record<string, StampRow[]> = {};
  for (const r of rows) {
    const key = albumKeyOf(r.place_id, r.payload.rare);
    (m[key] ??= []).push(r);
    if (key !== r.place_id) (m[r.place_id] ??= []).push(r);
  }
  return m;
}
export const gotCount = (rows: StampRow[]) => { const m = stampsByKey(rows); return ALBUM.filter((a) => m[a.key]?.length).length; };

// 칸 위치를 재는 데 쓰는 것만 (RN 0.88의 View 참조 타입이 함수 컴포넌트라 직접 적는다)
type Box = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type StampsSection = 'stamps' | 'missions';

/** 도장북 탭. section = 위 칸(도장 · 미션) — 미션은 11/2부터 탭 대신 여기 (오늘 탭 '완료 미션' 숫자도 이리로) */
export function StampsTab({ section = 'stamps', onSection }: { section?: StampsSection; onSection?: (s: StampsSection) => void }) {
  const t = useTheme();
  const { token, me } = useSession();
  const demo = !!me?.demo;
  // 개발 표시(노란 고리·안내 띠·모두 찍기·초기화): 시연용 깔끔 보기면 숨기고, 찍기는 칸 길게 누르기로만
  const devUi = useDevUi();
  const ev = useEvents();
  const [rows, setRows] = useState<StampRow[] | null>(null);
  const rowsRef = useRef<StampRow[] | null>(null);
  rowsRef.current = rows;
  const [open, setOpen] = useState<string | null>(null);
  // 한 줄 칸 수는 폭으로: 본문 폭(넓은 화면은 MAX_W까지) 380 미만 3칸 · 520 미만 4칸 · 그 이상 5칸. 좌우 여백 20×2
  const { width } = useWindowDimensions();
  const { cell, gap } = gridSize(width);

  const [err, setErr] = useState('');
  const load = useCallback(async () => { if (token) { try { setRows((await getStamps(token)).stamps); setErr(''); } catch (e: any) { setErr(friendlyError(e, '도장북을 불러오지 못했어요')); } } }, [token]);
  const [missionKey, setMissionKey] = useState(0);
  // 새 도장 소식이 오면 다시 불러온다 (찍는 중에는 기다렸다가 끝나고)
  const stampCount = (ev.events ?? []).filter((e) => e.kind === 'stamp').length;
  const busyRef = useRef(false);
  useEffect(() => { if (!busyRef.current) load(); }, [load, stampCount]);

  const byKey = useMemo(() => stampsByKey(rows ?? []), [rows]);
  // 축제 한정 도장: 진행 중은 맨 위 '축제 도장', 끝난 것(받은 것·목록에 남은 것)은 맨 아래 '지난 축제'
  useCatalogRev();
  const festRows = useMemo(() => {
    const m: Record<string, StampRow> = {};
    for (const r of rows ?? []) { const fid = (r.payload as { festivalId?: string }).festivalId; if (fid && !m[fid]) m[fid] = r; }
    return m;
  }, [rows]);
  const fests = festivals();
  const running = fests.filter((f) => festivalStatus(f) === 'running');
  const past = fests.filter((f) => festivalStatus(f) === 'ended').sort((a, b) => b.ends.localeCompare(a.ends));
  const [festOpen, setFestOpen] = useState<CatalogFestival | null>(null);
  const got = ALBUM.filter((a) => byKey[a.key]?.length).length;
  const total = rows?.length ?? 0;
  const ready = ALBUM.length - got;

  // ---------- 개발 모드: 눌러서 바로 찍기 ----------
  const [medal, setMedal] = useState<MedalInfo | null>(null);
  const [short, setShort] = useState(false);
  const [busy, setBusy] = useState<'' | 'one' | 'all'>('');
  const [pop, setPop] = useState<Record<string, number>>({});
  const finished = useRef<(() => void) | null>(null);
  const cells = useRef<Record<string, Box | null>>({});

  // 하나 찍기: 연출은 바로 시작하고, 서버 저장은 뒤에서 (서버가 잠에서 깨는 몇 초를 기다리지 않게)
  const stampOne = async (key: string, quick: boolean): Promise<boolean> => {
    if (!token) return false;
    const a = ALBUM.find((x) => x.key === key)!;
    const before = rowsRef.current ?? [];
    const guess: StampRow = {
      id: `local-${Date.now()}`, place_id: a.placeId,
      // No.는 서버가 정한다 (이 차의 앞선 도장 수 + 1) — 답이 오면 서버 번호로 바꿈
      payload: { number: before.length + 1, rare: a.rare ?? null, silent: false }, created_at: new Date().toISOString(),
    };
    const saved = sendDemo(token, { kind: 'stamp', placeId: a.placeId, rare: a.rare ?? false, push: false })
      .then((r) => {
        // 예전 서버(장소를 무시)면 응답에 placeId가 없다 → 일단 고른 칸으로 두고 나중에 다시 불러와 맞춘다
        const row: StampRow = r.placeId ? { id: r.id, place_id: r.placeId, payload: r.payload ?? guess.payload, created_at: guess.created_at } : { ...guess, id: r.id };
        setRows((rs) => [...(rs ?? []), row]);
        setMedal((md) => (md && md.key === key && row.payload.number ? { ...md, number: row.payload.number } : md));
        return true;
      })
      .catch((e: any) => { Alert.alert('도장을 찍지 못했어요', e?.message); return false; });
    setShort(quick);
    await new Promise<void>((res) => {
      finished.current = res;
      // 이미 모은 칸인지는 No.가 아니라 칸(장소)으로 — 다시 찍으면 'N번째 방문'
      const visit = (stampsByKey(before)[key]?.length ?? 0) + 1;
      setMedal({ key, number: guess.payload.number, before: gotCount(before), after: gotCount([...before, guess]), visit, day: dayOf(new Date()) });
    });
    return saved;
  };
  // 모은 도장 다시 보기: 메달(심플) + 아래 그날의 기록. 여러 번 찍었으면 가장 최근 날
  const viewMedal = (key: string, list: StampRow[], festival?: CatalogFestival) => {
    if (!list.length) return;
    const last = [...list].sort((x, y) => x.created_at.localeCompare(y.created_at))[list.length - 1];
    const n = gotCount(rowsRef.current ?? []);
    setShort(false);
    setMedal({
      key, number: last.payload.number ?? null, before: n, after: n, view: true, day: dayOf(last.created_at),
      festival: festival ? { id: festival.id, name: festival.name, season: festival.season, placeId: festival.placeId } : null,
    });
  };
  const medalDone = (how: MedalEnd) => {
    const key = medal?.key;
    const fest = medal?.festival ? fests.find((f) => f.id === medal.festival!.id) ?? null : null;
    setMedal(null);
    if (key && how === 'info') { if (fest) setFestOpen(fest); else setOpen(key); }
    const base = ALBUM.find((a) => a.key === key)?.placeId;
    if (key && how === 'keep') { tick(); setPop((p) => ({ ...p, [key]: (p[key] ?? 0) + 1, ...(base && base !== key ? { [base]: (p[base] ?? 0) + 1 } : {}) })); }
    if (key && how === 'listen') ev.open(storyEvent(key)); // 그 장소 이야기를 처음부터
    if (medal && how === 'share') openComposer(medalShareTarget(medal));
    // 새 도장(다시 보기·모두 찍기 말고)을 넣은 뒤 한 번만 '이 곳 아이랑 어땠어요?'
    if (medal && !medal.view && !short && how !== 'share') { const tip = medalTipTarget(medal); if (tip) setTimeout(() => askTipOnce(tip), 450); }
    finished.current?.();
    finished.current = null;
  };
  const target = (key: string) => new Promise<Rect | null>((res) => {
    const v = cells.current[key];
    if (!v) return res(null);
    v.measureInWindow((x, y, w, h) => res({ x, y, w, h }));
  });

  const pressReady = async (key: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('one');
    await stampOne(key, false);
    busyRef.current = false; setBusy('');
    ev.reload(); load();
  };
  // 개발 모드: 진행 중 축제 칸을 누르면 한정 도장을 바로 찍기
  const stampFestival = async (f: CatalogFestival) => {
    if (!token || busyRef.current) return;
    busyRef.current = true; setBusy('one');
    const before = rowsRef.current ?? [];
    const saved = sendDemo(token, { kind: 'stamp', festivalId: f.id, push: false })
      .then((r) => { setMedal((md) => (md && md.key === f.id && r.payload?.number ? { ...md, number: r.payload.number } : md)); return true; })
      .catch((e: any) => { Alert.alert('도장을 찍지 못했어요', e?.message); return false; });
    setShort(false);
    await new Promise<void>((res) => {
      finished.current = res;
      setMedal({ key: f.id, number: before.length + 1, before: gotCount(before), after: gotCount(before), festival: { id: f.id, name: f.name, season: f.season, placeId: f.placeId }, day: dayOf(new Date()) });
    });
    await saved;
    busyRef.current = false; setBusy('');
    ev.reload(); load();
  };
  const stampAll = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('all');
    // 남은 칸을 차례로 (비 오는 날 디아크는 디아크 칸도 채우므로 매번 다시 본다)
    for (let i = 0; i < ALBUM.length; i++) {
      const m = stampsByKey(rowsRef.current ?? []);
      const next = ALBUM.find((a) => !m[a.key]?.length);
      if (!next) break;
      if (!(await stampOne(next.key, true))) break;
      await sleep(450);
    }
    busyRef.current = false; setBusy('');
    ev.reload(); load();
  };
  const reset = () => Alert.alert('도장을 처음으로 돌릴까요?', '데모 차의 도장·미션·오늘 흐름이 모두 비워져요.', [
    { text: '취소', style: 'cancel' },
    { text: '처음으로', style: 'destructive', onPress: async () => { if (token) { await clearDemo(token).catch(() => {}); resetTipAsked(); setRows([]); ev.reload(); } } },
  ]);

  // 묶음 완성 축하: 보고 있는 동안 한 묶음이 막 다 찼을 때만 (처음 불러올 때 이미 찬 묶음은 조용히 '완성' 표시만)
  const doneSecs = useMemo(() => (rows ? ALBUM_SECTIONS.filter((sec) => ALBUM.filter((a) => a.section === sec.key).every((a) => byKey[a.key]?.length)).map((x) => x.key) : null), [rows, byKey]);
  const prevDone = useRef<string[] | null>(null);
  const [cheer, setCheer] = useState<string | null>(null);
  useEffect(() => {
    // 메달이 떠 있는 동안은 기다렸다가, 메달을 닫은 뒤(도장북에 꽂힌 뒤) 축하
    if (!doneSecs || medal) return;
    const before = prevDone.current;
    prevDone.current = doneSecs;
    if (!before) return;
    const fresh = doneSecs.find((k) => !before.includes(k));
    if (fresh) { done(); setCheer(fresh); }
  }, [doneSecs, medal]);

  const rareAll = ALBUM.filter((a) => a.rare);
  const rareGot = rareAll.filter((a) => byKey[a.key]?.length).length;
  const festAll = [...running, ...past];
  const festGot = festAll.filter((f) => festRows[f.id]).length;
  const visited = useVisitedPlaces();
  const scene = t.dark ? 'night' : 'day';

  return (
    <Page title="도장북" right={devUi ? <Pill text="개발 모드" tone="blue" icon="flask-conical" /> : undefined}
      refresh={<RefreshControl refreshing={false} onRefresh={() => { if (section === 'missions') setMissionKey((k) => k + 1); else load(); }} colors={[t.accent]} progressBackgroundColor={t.surface} />}>
      {/* 위 칸: 도장 · 미션 (미션 탭을 도장북 안으로 옮김) */}
      <View style={{ marginTop: S.l }}>
        <Segmented value={section} onChange={(k) => onSection?.(k)} options={[{ key: 'stamps', label: '도장' }, { key: 'missions', label: '미션' }]} />
      </View>
      {section === 'missions' ? <View style={{ marginTop: S.l }}><MissionsSection reloadKey={missionKey} /></View> : (<>
      {/* 머리: 오늘 탭과 같은 수채 풍경 띠 위에 모은 칸 + 막대, 오른쪽 희귀·축제 */}
      <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg, overflow: 'hidden' }}>
        <View style={{ height: 92 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Landscape scene={scene} height={92} bg={t.surface} />
        </View>
        <View style={{ paddingHorizontal: S.xl, paddingBottom: S.xl, marginTop: -40 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: S.l }}>
            <View accessible accessibilityLabel={`도장북 ${ALBUM.length}칸 중 ${rows ? got : 0}칸 모음`}>
              <T v="cap" c="ink2">모은 도장</T>
              <T v="display">{rows ? got : '–'}<T v="title" c="ink3"> / {ALBUM.length}칸</T></T>
            </View>
            <View style={{ flexDirection: 'row', gap: S.m, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {rareAll.length > 0 && <Chip icon="gem" tone="stamp" text={`희귀 ${rows ? rareGot : '–'}/${rareAll.length}`} />}
              {festAll.length > 0 && <Chip icon="party-popper" tone="festival" text={`축제 ${rows ? festGot : '–'}/${festAll.length}`} />}
            </View>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.fill, marginTop: S.l, overflow: 'hidden' }}>
            <View style={{ height: 6, width: `${(got / ALBUM.length) * 100}%`, backgroundColor: t.accent, borderRadius: 3 }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.m }}>
            {devUi && rows && ready === 0 && <Icon name="party-popper" size={14} color={t.accent} />}
            <T v="cap" c={devUi && rows && ready === 0 ? 'accent' : 'ink3'} style={{ flexShrink: 1 }}>
              {!rows ? ' ' : devUi ? (ready === 0 ? '도장북 완성!' : `지금 찍을 수 있는 도장 ${ready}개`)
                : total === 0 ? '차를 세우고 P에 두면 차가 도장을 찍어 줘요' : `지금까지 ${total}번 찍었어요`}
            </T>
          </View>
        </View>
      </View>

      {devUi && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.blueSoft, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12, marginTop: 10 }}>
          <Icon name="flask-conical" size={16} color={t.blue} />
          <T v="cap" c="blue" style={{ flex: 1, fontFamily: F.b, lineHeight: 18 }}>개발 모드 · 노란 고리 도장을 누르면 바로 찍혀요 (실제 차에서는 주차하면 찍힘)</T>
        </View>
      )}

      {!!err && <ErrorRow title={err} sub={rows ? '전에 받은 도장을 보여 드려요' : '잠시 뒤 다시 해 주세요'} onRetry={() => { tick(); load(); }} style={{ marginTop: 12 }} />}
      {running.length > 0 && (
        <View>
          <GroupHead title="축제 도장" sub="기간 한정" n={rows ? running.filter((f) => festRows[f.id]).length : null} total={running.length} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: gap, rowGap: S.l + 6 }}>
            {running.map((f) => (
              <FestivalCell key={f.id} f={f} size={cell} has={!!festRows[f.id]} ready={devUi && !festRows[f.id]}
                onPress={() => { tap(); if (devUi && !festRows[f.id] && rows) stampFestival(f); else if (festRows[f.id]) viewMedal(f.id, [festRows[f.id]], f); else setFestOpen(f); }} />
            ))}
          </View>
        </View>
      )}
      {ALBUM_SECTIONS.map((sec, i) => {
        const items = ALBUM.filter((a) => a.section === sec.key);
        const n = items.filter((a) => byKey[a.key]?.length).length;
        return (
          <View key={sec.key}>
            <GroupHead title={sec.title} n={rows ? n : null} total={items.length}
              right={i === 0 && devUi && rows && ready > 0
                ? <Btn title="모두 찍기" kind="soft" small busy={busy === 'all'} disabled={!!busy} onPress={stampAll} style={{ height: 36, paddingHorizontal: 12, borderRadius: R.sm }} />
                : undefined} />
            {rows === null ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: gap, rowGap: S.l + 6 }}>
                {items.map((a) => <Skeleton key={a.key} w={cell} h={cell} r={cell / 2} />)}
              </View>
            ) : (
              <Grid items={items} cell={cell} gap={gap} byKey={byKey} demo={devUi} pop={pop} cells={cells}
                onPress={(key, has) => { tap(); if (devUi && !has) pressReady(key); else if (has) viewMedal(key, byKey[key] ?? []); else setOpen(key); }}
                onLongPress={demo && !devUi ? (key, has) => { if (!has && rows) { tick(); pressReady(key); } } : undefined} />
            )}
            {cheer === sec.key && <Cheer title={`${sec.title} 완성!`} onDone={() => setCheer(null)} />}
          </View>
        );
      })}

      {past.length > 0 && (
        <View>
          <GroupHead title="지난 축제" n={rows ? past.filter((f) => festRows[f.id]).length : null} total={past.length} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: gap, rowGap: S.l + 6 }}>
            {past.map((f) => <FestivalCell key={f.id} f={f} size={cell} has={!!festRows[f.id]} onPress={() => { tap(); if (festRows[f.id]) viewMedal(f.id, [festRows[f.id]], f); else setFestOpen(f); }} />)}
          </View>
        </View>
      )}

      <VisitedSection items={visited} />

      {devUi && rows && total > 0 && (
        <Btn title="도장 처음으로 (시험 초기화)" kind="line" small icon="refresh-cw" onPress={reset} disabled={!!busy} style={{ marginTop: 22 }} />
      )}

      </>)}

      <FestivalSheet festival={festOpen} stamped={festOpen ? festRows[festOpen.id] ?? null : null} onClose={() => setFestOpen(null)} />
      <StampSheet albumKey={open} rows={open ? byKey[open] ?? [] : []} onClose={() => setOpen(null)} />
      <MedalOverlay medal={medal} short={short} target={target} onDone={medalDone} />
    </Page>
  );
}

/** 칸 크기: 본문 폭 380 미만 3칸 · 520 미만 4칸 · 그 이상 5칸, 칸 사이 14(5칸이면 12) */
export function gridSize(width: number) {
  const avail = Math.min(width - S.page * 2, MAX_W);
  const cols = avail < 380 ? 3 : avail < 520 ? 4 : 5;
  const gap = cols === 5 ? S.l : S.l + 2;
  return { cols, gap, cell: Math.floor((avail - gap * (cols - 1)) / cols) };
}

/** 묶음 머리: 이름(잘리지 않게 줄어듦) · 작은 진행 고리 + '3 / 9' — 다 차면 초록 '완성' */
function GroupHead({ title, sub, n, total, right }: { title: string; sub?: string; n: number | null; total: number; right?: ReactNode }) {
  const t = useTheme();
  const full = n != null && n >= total && total > 0;
  return (
    <View accessibilityRole="header" accessibilityLabel={`${title}${n != null ? `, ${total}칸 중 ${n}칸${full ? ', 완성' : ''}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: S.m, marginTop: S.sec + 2, marginBottom: S.l, paddingHorizontal: S.xs, minHeight: 28 }}>
      <T v="h" style={{ flexShrink: 1, color: full ? t.accentInk : t.ink }}>{title}</T>
      {!!sub && <T v="cap" c="ink3">{sub}</T>}
      <View style={{ flex: 1 }} />
      {right ?? (n == null ? null : full ? (
        <Chip icon="check" tone="stamp" text="완성" />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s }}>
          <Ring frac={n / Math.max(1, total)} />
          <T v="cap" c="ink2" style={{ fontVariant: ['tabular-nums'] }}>{n} / {total}</T>
        </View>
      ))}
    </View>
  );
}

/** 작은 진행 고리 (지름 18) */
function Ring({ frac }: { frac: number }) {
  const t = useTheme();
  const r = 7, c = 2 * Math.PI * r;
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <SvgCircle cx={9} cy={9} r={r} stroke={t.fill2} strokeWidth={3} fill="none" />
      <SvgCircle cx={9} cy={9} r={r} stroke={t.accent} strokeWidth={3} fill="none" strokeLinecap="round"
        strokeDasharray={`${c * Math.min(1, frac)} ${c}`} transform="rotate(-90 9 9)" />
    </Svg>
  );
}

/** 묶음 완성 축하 — 묶음 머리 아래 띠가 톡 튀어나왔다가 몇 초 뒤 사라짐 (움직임 줄이기면 그냥 나타남) */
function Cheer({ title, onDone }: { title: string; onDone: () => void }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (!reduce) Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 12 }).start();
    const id = setTimeout(onDone, 4500);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View accessibilityRole="alert" accessibilityLabel={title}
      style={{ marginTop: S.l + 2, opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        flexDirection: 'row', alignItems: 'center', gap: S.l, backgroundColor: t.accentSoft, borderRadius: R.md, paddingVertical: S.l, paddingHorizontal: S.l + 2 }}>
      <IconBadge icon="party-popper" tone="surface" size="sm" />
      <View style={{ flex: 1 }}>
        <T v="h" c="accentInk">{title}</T>
        <T v="cap" c="accentInk">이 묶음 도장을 모두 모았어요</T>
      </View>
    </Animated.View>
  );
}

/** 다녀온 곳 — 도장 칸은 없지만 다녀온 곳 ({name, visitedAt}). 데이터는 '내가 고르기'(직접 찾기) 작업에서 들어온다. 비면 아무것도 안 그림 */
export type VisitedPlace = { name: string; visitedAt: string };
/** 서버 GET /api/family/visited-ext (바깥 장소 '다녀옴', 최근 순). 서버에 아직 없거나(404) 실패하면 빈 목록 */
export function useVisitedPlaces(): VisitedPlace[] {
  const { token } = useSession();
  const [items, setItems] = useState<VisitedPlace[]>([]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    call<{ items?: { name: string; last: string }[] }>(token, 'GET', '/api/family/visited-ext')
      .then((r) => { if (alive) setItems((r.items ?? []).map((x) => ({ name: x.name, visitedAt: x.last }))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [token]);
  return items;
}

export function VisitedSection({ items }: { items: VisitedPlace[] }) {
  const t = useTheme();
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
  return (
    <View>
      <GroupHead title="다녀온 곳" sub="도장 없는 곳" n={null} total={items.length} right={<T v="cap" c="ink2">{items.length}곳</T>} />
      <View style={{ backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.l + 2 }}>
        {sorted.map((v, i) => {
          const d = new Date(v.visitedAt);
          return (
            <View key={`${v.name}-${v.visitedAt}`} style={i ? { borderTopWidth: 1, borderTopColor: t.line } : undefined}>
              <Row icon="map-pin" title={v.name} trailing={isNaN(d.getTime()) ? undefined : dayLabel(d)} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Grid({ items, cell, gap, byKey, demo, pop, cells, onPress, onLongPress }: {
  items: typeof ALBUM; cell: number; gap: number; byKey: Record<string, StampRow[]>; demo: boolean; pop: Record<string, number>;
  cells: { current: Record<string, Box | null> }; onPress: (key: string, has: boolean) => void; onLongPress?: (key: string, has: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: gap, rowGap: S.l + 6 }}>
      {items.map((a) => {
        const has = !!byKey[a.key]?.length;
        return (
          <Cell key={a.key} k={a.key} label={a.label} rare={a.rare} size={cell} has={has} ready={demo && !has}
            pop={pop[a.key] ?? 0} setRef={(v) => { cells.current[a.key] = v as Box | null; }} onPress={() => onPress(a.key, has)}
            onLongPress={onLongPress ? () => onLongPress(a.key, has) : undefined} />
        );
      })}
    </View>
  );
}

function Cell({ k, label, rare, size, has, ready, pop, setRef, onPress, onLongPress }: {
  k: string; label: string; rare?: string; size: number; has: boolean; ready: boolean; pop: number;
  setRef: (v: unknown) => void; onPress: () => void; onLongPress?: () => void;
}) {
  useCatalogRev(); // 서버 도장 그림을 받으면 다시 그림
  const t = useTheme();
  // 도장북에 꽂힐 때 톡
  const s = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pop) return;
    s.setValue(0.6);
    Animated.spring(s, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 }).start();
  }, [pop, s]);
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button"
      accessibilityLabel={`${label}${rare ? ', 희귀 도장' : ''}, ${has ? '찍었어요' : '아직'}`}
      style={({ pressed }) => ({ width: size, alignItems: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Animated.View ref={setRef} collapsable={false} style={{ width: size, height: size, transform: [{ scale: s }] }}>
        <Image source={has ? stampArt(k) : stampArt(k, true)} style={{ width: size, height: size, opacity: has ? 1 : ready ? 0.7 : 0.45 }} />
        {/* 희귀: 칸 오른쪽 위 작은 보석 배지 (알약은 칸 높이를 들쑥날쑥하게 해서 뺌) */}
        {rare && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0 }}>
            <View style={{ borderRadius: R.pill, borderWidth: 2, borderColor: t.bg }}>
              <IconBadge icon="gem" tone={has ? 'accent' : 'mute'} size="sm" />
            </View>
          </View>
        )}
        {ready && (
          <View pointerEvents="none" style={{ position: 'absolute', top: -6, left: -20, right: -20, alignItems: 'center' }}>
            <View style={{ backgroundColor: t.point, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
              <T v="cap" style={{ color: t.onPoint, fontFamily: F.xb, fontSize: 12.5, lineHeight: 16 }}>찍기 가능</T>
            </View>
          </View>
        )}
      </Animated.View>
      <T v="cap" c={has ? 'ink' : 'ink3'} numberOfLines={2} style={{ marginTop: S.s, textAlign: 'center' }}>{label}</T>
    </Pressable>
  );
}

export function StampSheet({ albumKey, rows, onClose }: { albumKey: string | null; rows: StampRow[]; onClose: () => void }) {
  useCatalogRev(); // 서버 도장 그림을 받으면 다시 그림
  const a = ALBUM.find((x) => x.key === albumKey);
  const has = rows.length > 0;
  return (
    <Sheet open={!!a} onClose={onClose}>
      {a && (
        <View style={{ alignItems: 'center', paddingBottom: 8 }}>
          <Image source={has ? stampArt(a.key) : stampArt(a.key, true)} style={{ width: 240, height: 240, opacity: has ? 1 : 0.5 }} />
          <T v="title" style={{ marginTop: 10 }}>{a.label}</T>
          {has ? (
            <>
              <T v="sub" c="ink3" style={{ marginTop: 4 }}>
                {rows[0].payload.number ? `${stampNo(rows[0].payload.number)} · ` : ''}{dayLabel(new Date(rows[0].created_at))} {hm(new Date(rows[0].created_at))}
              </T>
              {/* 누구랑 (새 서버가 도장에 동행을 실어 주면) */}
              {(() => { const w = (rows[0].payload as { companion?: unknown; with?: unknown }).companion ?? (rows[0].payload as { with?: unknown }).with; return isCompanion(w) ? <T v="cap" c="ink2" style={{ marginTop: 2 }}>{COMPANION_INFO[w].label} 함께</T> : null; })()}
              {rows.length > 1 && <T v="cap" c="ink3" style={{ marginTop: 2 }}>모두 {rows.length}번 찍었어요</T>}
              {a.rare && <View style={{ marginTop: 10 }}><Pill text={`희귀 도장 · ${a.rare}`} tone="accent" icon="gem" /></View>}
            </>
          ) : (
            <T v="sub" c="ink3" style={{ marginTop: 4, textAlign: 'center' }}>
              {a.rare === RARE_NIGHT ? '해가 진 뒤 여기에 주차하면 찍혀요' : a.rare ? '비 오는 날 디아크에 주차하면 찍혀요' : '여기에 주차하면 차가 도장을 찍어 줘요'}
            </T>
          )}
          <PlaceDwell placeId={a.placeId} />
        </View>
      )}
    </Sheet>
  );
}
