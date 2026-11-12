// '함께' 탭 (커뮤니티 1단계, 시안 proto/community-plan.html): 대구·경북 가족들의 도장 자랑 · 오늘 다녀왔어요 · 장소 한줄팁 · 운영팀 글.
// 아이·집 지키기: 별명만, 장소 이름만(지도·경로·시각 없음), 내 글은 집에 도착한 뒤(또는 2시간 뒤) 보임. 반응은 버튼 셋(댓글은 2단계).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { Alert } from '../alert';
import { catalogPlace } from '../catalog';
import {
  blockAuthor, deletePost, getFeed, getSaved, putCommunityMe, reactPost, useTogetherStore,
  type FeedPost, type FeedRes, type ReactionKind,
} from '../community';
import type { AnchorIn } from '../plan';
import { useSession } from '../session';
import { F, R, S, TYPE } from '../theme';
import { Btn, Icon, Page, plainError, Segmented, SkeletonList, T, tap, tick, useTheme } from '../ui';
import { Empty, ErrorRow, MoreSheet, type MoreItem } from '../parts';
import { AnchorSheet } from './Explore';
import { artFor, authorLine, PlaceChip, ProfileSheet, ReportSheet, setProfile, STARS, TermsSheet, useCommunityMe } from './TogetherSheets';

type Seg = 'feed' | 'saved';

export function TogetherTab() {
  const t = useTheme();
  const { token, me: phoneMe } = useSession();
  const cm = useCommunityMe();
  const store = useTogetherStore();
  const [seg, setSeg] = useState<Seg>('feed');
  const [data, setData] = useState<FeedRes | null>(null);
  const [saved, setSaved] = useState<FeedPost[] | null>(null);
  const [err, setErr] = useState('');
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [menu, setMenu] = useState<FeedPost | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ anchor: AnchorIn; driveMin: number | null } | null>(null);
  const profile = cm.me?.profile ?? null;
  const hidden = !!profile?.hidden;

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await getFeed(token)); setErr(''); }
    catch (e) { setErr(plainError(e, '함께를 불러오지 못했어요')); }
  }, [token]);
  const loadSaved = useCallback(async () => {
    if (!token) return;
    try { setSaved((await getSaved(token)).posts); setErr(''); }
    catch (e) { setErr(plainError(e, '저장한 곳을 불러오지 못했어요')); }
  }, [token]);
  useEffect(() => { if (profile && !hidden) load(); }, [load, !!profile, hidden, store.feedRev]);
  useEffect(() => { if (seg === 'saved' && profile) loadSaved(); }, [seg, loadSaved, !!profile, store.feedRev]);
  // '함께에서 보기'로 오면 목록 칸으로
  useEffect(() => { if (store.goTab) setSeg('feed'); }, [store.goTab]);
  // 처음 들어오면 이용 규칙 + 별명
  const asked = useRef(false);
  useEffect(() => { if (cm.me && !profile && !asked.current) { asked.current = true; setTermsOpen(true); } }, [cm.me, profile]);

  const refresh = async () => { setRefreshing(true); cm.reload(); await (seg === 'feed' ? load() : loadSaved()); setRefreshing(false); };
  const loadMore = async () => {
    if (!token || !data?.nextCursor || more) return;
    setMore(true);
    try { const r = await getFeed(token, data.nextCursor); setData((d) => d && { ...d, posts: [...d.posts, ...r.posts.filter((p) => !d.posts.some((x) => x.id === p.id))], nextCursor: r.nextCursor }); }
    catch (e) { setErr(plainError(e, '더 불러오지 못했어요')); } finally { setMore(false); }
  };
  /** 한 글만 바꿔 끼우기 (반응) — 목록·저장한 곳 둘 다 */
  const patch = (p: FeedPost) => {
    setData((d) => d && { ...d, posts: d.posts.map((x) => (x.id === p.id ? p : x)) });
    setSaved((s) => s && (p.my.save ? s.map((x) => (x.id === p.id ? p : x)) : s.filter((x) => x.id !== p.id)));
  };
  const drop = (id: string) => {
    setData((d) => d && { ...d, posts: d.posts.filter((x) => x.id !== id) });
    setSaved((s) => s && s.filter((x) => x.id !== id));
  };
  const react = useCallback(async (p: FeedPost, kind: ReactionKind) => {
    if (!token) return;
    tick();
    const on = !p.my[kind];
    // 바로 바꿔 보이고(낙관적), 실패하면 되돌린다
    patch({ ...p, my: { ...p.my, [kind]: on }, reactions: { ...p.reactions, [kind]: Math.max(0, p.reactions[kind] + (on ? 1 : -1)) } });
    try { patch((await reactPost(token, p.id, kind, on)).post); }
    catch (e) { patch(p); Alert.alert('반영하지 못했어요', plainError(e, '잠시 뒤 다시 해 주세요')); }
  }, [token]);
  const openPlace = useCallback((id: string | null, name: string) => {
    const c = id ? catalogPlace(id) : undefined;
    if (!c) { Alert.alert(name, '이 곳은 아직 코스로 짤 수 없어요'); return; }
    tap();
    setAnchor({ anchor: { kind: 'place', id: c.id, name: c.name, lat: c.lat, lng: c.lng }, driveMin: null });
  }, []);

  const menuItems = (p: FeedPost): MoreItem[][] => {
    if (p.mine) return [[{ icon: 'trash-2', title: '이 글 지우기', sub: '함께에서 바로 사라져요', danger: true, onPress: () => Alert.alert('이 글을 지울까요?', undefined, [
      { text: '취소', style: 'cancel' },
      { text: '지우기', style: 'destructive', onPress: async () => { try { if (token) { await deletePost(token, p.id); drop(p.id); } } catch (e) { Alert.alert('지우지 못했어요', plainError(e, '잠시 뒤 다시 해 주세요')); } } },
    ]) }]];
    const items: MoreItem[] = [{ icon: 'flag', title: '신고하기', sub: '아이 안전·개인정보·욕설·광고', onPress: () => setReport(p.id) }];
    if (!p.author.operator) items.push({ icon: 'circle-minus', title: '이 가족 가리기', sub: `${p.author.handle}의 글이 더는 안 보여요`, onPress: () => Alert.alert(`${p.author.handle}의 글을 가릴까요?`, '이 가족의 글이 함께 어디에서도 안 보여요.', [
      { text: '취소', style: 'cancel' },
      { text: '가리기', style: 'destructive', onPress: async () => {
        try { if (token) { await blockAuthor(token, p.id); setData((d) => d && { ...d, posts: d.posts.filter((x) => x.author.handle !== p.author.handle || x.author.operator) }); setSaved((s) => s && s.filter((x) => x.author.handle !== p.author.handle)); } }
        catch (e) { Alert.alert('가리지 못했어요', plainError(e, '잠시 뒤 다시 해 주세요')); }
      } },
    ]) });
    return [items];
  };

  const chip = profile ? (
    <Pressable onPress={() => { tick(); setProfileOpen(true); }} accessibilityRole="button" accessibilityLabel={`우리 가족 별명 ${profile.handle}, 바꾸기`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: pressed ? t.fill2 : t.fill, maxWidth: 210 })}>
      <Text style={{ fontSize: 16 }}>{profile.icon}</Text>
      <Text numberOfLines={1} style={[TYPE.chip, { color: t.ink, flexShrink: 1 }]}>{authorLine(profile.handle, phoneMe?.me.nickname ?? null)}</Text>
    </Pressable>
  ) : undefined;

  const regionLabel = data?.region.label ?? cm.me?.region.label ?? '대구·경북';
  return (
    <Page title="함께" right={chip} refresh={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[t.accent]} progressBackgroundColor={t.surface} />}>
      {cm.error && !cm.me ? <ErrorRow title={cm.error} sub="잠시 뒤 다시 해 주세요" onRetry={cm.reload} style={{ marginTop: S.l }} />
        : !cm.me ? <View style={{ marginTop: S.l }}><SkeletonList rows={3} /></View>
        : !profile ? (
          <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg }}>
            <Empty compact icon="users" title={`${regionLabel} 가족들과 나들이를 나눠요`} sub="도장 자랑 · 다녀온 곳 · 장소 한줄팁을 별명으로 올리고, 다른 가족의 기록에 반응해요"
              action={<Btn title="이용 규칙 보고 시작하기" kind="accent" onPress={() => setTermsOpen(true)} />} />
          </View>
        ) : hidden ? (
          <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg }}>
            <Empty compact icon="circle-minus" title="함께를 숨겨 두었어요" sub="우리 가족 글이 다른 가족에게 안 보이고, 함께 탭도 쉬고 있어요"
              action={<Btn title="다시 보이기" kind="accent" onPress={async () => { if (token) { try { setProfile((await putCommunityMe(token, { hidden: false })).profile); } catch (e) { Alert.alert('바꾸지 못했어요', plainError(e, '잠시 뒤 다시 해 주세요')); } } }} />} />
          </View>
        ) : (
          <>
            <View style={{ marginTop: S.l, marginBottom: S.l }}>
              <Segmented value={seg} onChange={setSeg} options={[{ key: 'feed', label: regionLabel }, { key: 'saved', label: '저장한 곳 📌' }]} />
            </View>
            {!!err && <ErrorRow title={err} sub="잠시 뒤 다시 해 주세요" onRetry={seg === 'feed' ? load : loadSaved} style={{ marginBottom: S.l }} />}
            {seg === 'feed' ? (
              data === null ? (err ? null : <SkeletonList rows={3} />) : (
                <View style={{ gap: S.l }}>
                  <PulseCard data={data} />
                  {data.posts.length === 0 ? (
                    <View style={{ backgroundColor: t.surface, borderRadius: R.lg }}>
                      <Empty compact icon="users" title="아직 올라온 글이 없어요" sub="도장을 받으면 메달 화면에서 '함께에 자랑하기'로 첫 글을 올려 보세요" />
                    </View>
                  ) : data.posts.map((p) => <PostCard key={p.id} p={p} onReact={react} onMenu={setMenu} onPlace={openPlace} />)}
                  {data.nextCursor && <Btn title="더 보기" kind="soft" busy={more} onPress={loadMore} />}
                </View>
              )
            ) : saved === null ? (err ? null : <SkeletonList rows={2} />) : saved.length === 0 ? (
              <View style={{ backgroundColor: t.surface, borderRadius: R.lg }}>
                <Empty compact icon="map-pin" title="아직 담은 곳이 없어요" sub="글 아래 📌 담기를 누르면 여기에 모여요. 장소를 누르면 그곳 중심으로 코스를 짜요" />
              </View>
            ) : (
              <View style={{ gap: S.l }}>
                {saved.map((p) => <SavedCard key={p.id} p={p} onPlace={openPlace} onUnsave={() => react(p, 'save')} />)}
              </View>
            )}
          </>
        )}
      <MoreSheet open={!!menu} onClose={() => setMenu(null)} title={menu ? authorLine(menu.author.handle, menu.author.phone) : undefined} groups={menu ? menuItems(menu) : []} />
      <ReportSheet postId={report} onClose={() => setReport(null)} onDone={(hiddenNow) => {
        Alert.alert('신고했어요', hiddenNow ? '이 글은 숨겨졌고 운영팀이 살펴볼게요.' : '운영팀이 살펴볼게요. 고마워요.');
        if (hiddenNow && report) drop(report);
      }} />
      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
      <TermsSheet open={termsOpen} onClose={() => setTermsOpen(false)} />
      <AnchorSheet target={anchor} onClose={() => setAnchor(null)} onChosen={() => setAnchor(null)} />
    </Page>
  );
}

// ---------- 이번 주 우리 지역 ----------
/** 받침 있으면 '이에요', 없으면 '예요' */
const ieyo = (w: string) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '이에요' : '예요'; };
function PulseCard({ data }: { data: FeedRes }) {
  const t = useTheme();
  const p = data.pulse;
  const n = (x: number) => (p?.approx && x >= 10 ? `${x}+` : `${x}`);
  return (
    <View style={{ backgroundColor: t.accentSoft, borderRadius: R.lg, padding: S.xl }} accessible>
      <T v="cap" c="accentInk">이번 주 {data.region.label}</T>
      {p ? (
        <>
          <T v="h" c="accentInk" style={{ marginTop: 2 }}>{n(p.families)}가족이 도장 {n(p.stamps)}개를 받았어요</T>
          {!!p.top[0] && <T v="sub" c="accentInk" style={{ marginTop: 2 }}>가장 많이 간 곳은 {p.top[0].name}{ieyo(p.top[0].name)}</T>}
          <View style={{ marginTop: S.l, gap: S.s }}>
            {p.top.map((x, i) => (
              <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.m }}>
                <Text style={[TYPE.label, { width: 18, color: t.accentInk }]}>{i + 1}</Text>
                <Text numberOfLines={1} style={[TYPE.body, { flex: 1, color: t.accentInk, fontFamily: F.sb }]}>{x.name}</Text>
                <Text style={[TYPE.cap, { color: t.accentInk }]}>{x.families}가족</Text>
              </View>
            ))}
          </View>
          <T v="cap" c="accentInk" style={{ marginTop: S.m, opacity: 0.8 }}>지난 7일 · 하루 늦게 모아요</T>
        </>
      ) : (
        <T v="sub" c="accentInk" style={{ marginTop: 2 }}>이번 주 소식을 모으는 중이에요. 세 가족 넘게 도장을 받으면 보여요</T>
      )}
    </View>
  );
}

// ---------- 글 카드 ----------
const PostCard = memo(function PostCard({ p, onReact, onMenu, onPlace }: {
  p: FeedPost; onReact: (p: FeedPost, k: ReactionKind) => void; onMenu: (p: FeedPost) => void; onPlace: (id: string | null, name: string) => void;
}) {
  const t = useTheme();
  const tipLike = p.kind === 'tip';
  const course = p.kind === 'trip' || (p.kind === 'notice' && !!p.trip?.places.length);
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: R.lg, padding: S.xl, borderWidth: p.pending ? 1 : 0, borderColor: t.line, borderStyle: 'dashed' }}>
      {/* 머리: 아이콘 · 별명 · 폰 이름 · 대충 시각 · ⋯ */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: p.author.operator ? t.accentSoft : t.fill, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 20 }}>{p.author.icon}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text numberOfLines={1} style={[TYPE.label, { color: t.ink, flexShrink: 1 }]}>{p.author.handle}</Text>
            {p.author.operator && <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: R.pill, backgroundColor: t.accent }}><Text style={{ fontFamily: F.b, fontSize: 11.5, lineHeight: 16, color: t.onAccent }}>운영팀</Text></View>}
          </View>
          <Text numberOfLines={1} style={[TYPE.cap, { color: t.ink3 }]}>
            {[p.author.phone, p.author.operator ? '이번 주 추천' : p.when, p.kind === 'tip' ? '장소 한줄팁' : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pressable onPress={() => { tap(); onMenu(p); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="글 메뉴"
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.fill : 'transparent' })}>
          <Icon name="ellipsis" size={20} color={t.ink3} />
        </Pressable>
      </View>

      {p.pending && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: S.l, backgroundColor: t.fill, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Icon name="house" size={15} color={t.ink2} />
          <T v="cap" c="ink2" style={{ flex: 1 }}>집에 도착하면 함께에 보여요 · 지금은 우리 가족만 봐요</T>
        </View>
      )}

      {/* 한줄팁 머리: 장소 · 👍 아이랑 좋아요 */}
      {tipLike && p.place && (
        <Text style={[TYPE.h, { color: t.ink, marginTop: S.l }]}>{p.place.name} · {p.tip?.good ? '👍 아이랑 좋아요' : '👎 아이랑은 아쉬워요'}</Text>
      )}
      {!!p.text && <Text style={[TYPE.body, { color: t.ink, marginTop: tipLike ? S.xs : S.l }]}>{p.text}</Text>}
      {p.kind === 'trip' && !p.text && <Text style={[TYPE.body, { color: t.ink, marginTop: S.l }]}>오늘 이렇게 다녀왔어요{p.trip?.stamps ? ` · 도장 ${p.trip.stamps}개 쾅!` : ''}</Text>}
      {p.kind === 'trip' && !!p.text && !!p.trip?.stamps && <T v="cap" c="ink3" style={{ marginTop: 2 }}>도장 {p.trip.stamps}개</T>}

      {/* 도장 자랑: 메달 그림 · 이름 · 별 */}
      {p.stamp && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.l, marginTop: S.l, backgroundColor: t.fill, borderRadius: R.md, padding: S.l }}>
          <Image fadeDuration={0} source={artFor(p.stamp.artKey, p.stamp.festivalId)} style={{ width: 64, height: 64, borderRadius: 32 }} accessibilityIgnoresInvertColors />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[TYPE.h, { color: t.ink }]}>{p.stamp.name}</Text>
            <Text style={[TYPE.cap, { color: p.stamp.tier === 'common' ? t.ink3 : t.accentInk }]}>
              <Text style={{ color: '#D4A017' }}>{STARS(p.stamp.stars)}</Text> {p.stamp.tier === 'legend' ? '축제 도장' : p.stamp.tier === 'rare' ? `희귀 도장${p.stamp.rare ? ` · ${p.stamp.rare}만` : ''}` : '도장'}
            </Text>
          </View>
        </View>
      )}
      {/* 다녀온 곳·운영팀 코스: 장소 이름 칩 (누르면 그곳 중심으로 코스) */}
      {!!p.trip?.places.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.s, marginTop: S.l }}>
          {p.trip.places.map((x, i) => <PlaceChip key={`${x.name}${i}`} n={i + 1} name={x.name} onPress={x.id ? () => onPlace(x.id, x.name) : undefined} />)}
        </View>
      )}
      {tipLike && !!p.tip?.tags.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.s, marginTop: S.m }}>
          {p.tip.tags.map((x) => <View key={x} style={{ paddingHorizontal: 10, minHeight: 26, justifyContent: 'center', borderRadius: R.pill, backgroundColor: t.accentSoft }}><Text style={[TYPE.chip, { color: t.accentInk }]}>{x}</Text></View>)}
        </View>
      )}

      {/* 반응 버튼 셋 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.s, marginTop: S.l }}>
        {p.kind !== 'notice' && <ReactBtn p={p} k="clap" label={tipLike ? '👍 도움돼요' : '👏 축하해요'} onReact={onReact} disabled={p.mine} />}
        {p.kind !== 'notice' && !tipLike && <ReactBtn p={p} k="want" label="😍 가보고 싶어요" onReact={onReact} disabled={p.mine} />}
        <ReactBtn p={p} k="save" label={course ? '📌 이 코스 담기' : '📌 담기'} onReact={onReact} />
      </View>
    </View>
  );
});

function ReactBtn({ p, k, label, onReact, disabled }: { p: FeedPost; k: ReactionKind; label: string; onReact: (p: FeedPost, k: ReactionKind) => void; disabled?: boolean }) {
  const t = useTheme();
  const on = p.my[k];
  const n = p.reactions[k];
  return (
    <Pressable onPress={() => onReact(p, k)} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !!disabled }}
      accessibilityLabel={`${label.replace(/^\S+\s/, '')}${n ? ` ${n}` : ''}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 12, borderRadius: R.pill,
        backgroundColor: on ? t.accentSoft : pressed ? t.fill2 : t.fill, borderWidth: on ? 1 : 0, borderColor: t.accent })}>
      <Text style={[TYPE.chip, { color: on ? t.accentInk : t.ink2 }]}>{label}</Text>
      {n > 0 && k !== 'save' && <Text style={[TYPE.chip, { color: on ? t.accentInk : t.ink3, fontVariant: ['tabular-nums'] }]}>{n}</Text>}
    </Pressable>
  );
}

// ---------- 저장한 곳 ----------
function SavedCard({ p, onPlace, onUnsave }: { p: FeedPost; onPlace: (id: string | null, name: string) => void; onUnsave: () => void }) {
  const t = useTheme();
  const places = p.trip?.places.length ? p.trip.places : p.place ? [{ id: p.place.id, name: p.place.name }] : [];
  const title = p.kind === 'trip' || p.kind === 'notice' ? (p.author.operator ? '운영팀 추천 코스' : `${p.author.handle}의 코스`)
    : p.kind === 'tip' ? `${p.author.handle}의 한줄팁` : `${p.author.handle}의 도장`;
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: R.lg, padding: S.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m }}>
        <Text style={{ fontSize: 18 }}>📌</Text>
        <T v="label" style={{ flex: 1 }} numberOfLines={1}>{title}</T>
        <Pressable onPress={onUnsave} hitSlop={8} accessibilityRole="button" accessibilityLabel="담기 빼기"
          style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 10, justifyContent: 'center', borderRadius: R.pill, backgroundColor: pressed ? t.fill : 'transparent' })}>
          <T v="cap" c="ink3">빼기</T>
        </Pressable>
      </View>
      {!!p.text && <T v="sub" c="ink2" numberOfLines={2} style={{ marginTop: S.xs }}>{p.text}</T>}
      <View style={{ marginTop: S.m }}>
        {places.map((x, i) => (
          <Pressable key={`${x.name}${i}`} onPress={() => onPlace(x.id, x.name)} accessibilityRole="button" accessibilityLabel={`${x.name} 중심으로 코스 짜기`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.m, minHeight: 48, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, opacity: pressed ? 0.6 : 1 })}>
            <Icon name="map-pin" size={16} color={t.accent} />
            <T v="body" style={{ flex: 1 }} numberOfLines={1}>{x.name}</T>
            <T v="cap" c="accent">코스 짜기</T>
            <Icon name="chevron-right" size={16} color={t.ink3} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
