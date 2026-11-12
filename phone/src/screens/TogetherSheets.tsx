// '함께' 시트들: 처음 쓸 때 이용 규칙 + 별명 고르기 · 내 별명(프로필) · 올리기(도장 자랑·오늘 다녀왔어요) · '아이랑 어땠어요?'(한줄팁) · 신고
// 올리기·한줄팁 창은 앱 어디서나 연다(community.ts openComposer·askTipOnce) → App의 <TogetherHosts />가 그린다.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Image, Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../alert';
import { BASE } from '../api';
import { festivalArt, festivalById, stampArt } from '../catalog';
import {
  bumpFeed, closeTip, createPost, getCommunityMe, goTogether, openComposer, putCommunityMe, reportPost, textWarning, TEXT_MAX,
  TIP_TAGS, useTogetherStore, type CommunityMe, type ComposeTarget, type Profile, type ReportReason, type TipTarget,
} from '../community';
import { useSession } from '../session';
import { F, R, S, TYPE } from '../theme';
import { Btn, Icon, plainError, Sheet, T, done, tick, useTheme } from '../ui';

// ---------- 내 함께 정보 (앱 안에서 하나만 기억) ----------
type MeState = { me: CommunityMe | null; error: string | null; loading: boolean };
let meState: MeState = { me: null, error: null, loading: false };
const meSubs = new Set<() => void>();
const setMe = (p: Partial<MeState>) => { meState = { ...meState, ...p }; meSubs.forEach((f) => f()); };
let loadingP: Promise<void> | null = null;
export function loadCommunityMe(token: string, force = false): Promise<void> {
  if (loadingP && !force) return loadingP;
  setMe({ loading: true });
  loadingP = getCommunityMe(token)
    .then((me) => setMe({ me, error: null }))
    .catch((e) => setMe({ error: plainError(e, '함께를 불러오지 못했어요') }))
    .finally(() => { setMe({ loading: false }); loadingP = null; });
  return loadingP;
}
export function setProfile(p: Profile) { if (meState.me) setMe({ me: { ...meState.me, profile: p, suggestion: null } }); }
export function useCommunityMe(): MeState & { reload: () => void } {
  const { token } = useSession();
  const s = useSyncExternalStore((f) => { meSubs.add(f); return () => meSubs.delete(f); }, () => meState);
  useEffect(() => { if (token && !s.me && !s.loading && !s.error) loadCommunityMe(token); }, [token, s.me, s.loading, s.error]);
  return { ...s, reload: () => { if (token) loadCommunityMe(token, true); } };
}

/** 가족 이름표: '{별명} · {폰 이름}' */
export const authorLine = (handle: string, phone: string | null) => (phone ? `${handle} · ${phone}` : handle);

// ---------- 이용 규칙 + 별명 고르기 ----------
const RULES: { icon: 'baby' | 'smile' | 'flag' | 'house'; title: string; sub: string }[] = [
  { icon: 'baby', title: '아이 얼굴·이름·학교는 올리지 않아요', sub: '유치원·어린이집 이름, 전화번호도 빼 주세요' },
  { icon: 'house', title: '집·지금 있는 곳은 안 나가요', sub: '장소 이름만 보이고, 글은 집에 도착한 뒤(또는 2시간 뒤)에 보여요' },
  { icon: 'smile', title: '고운 말로 이야기해요', sub: '욕설·비하·광고는 안 돼요' },
  { icon: 'flag', title: '이상한 글은 신고해 주세요', sub: '여러 가족이 신고하거나 아이 안전 신고가 오면 바로 숨기고 운영팀이 살펴요' },
];

export function TermsForm({ onDone, compact }: { onDone: (p: Profile) => void; compact?: boolean }) {
  const t = useTheme();
  const { token } = useSession();
  const { me } = useCommunityMe();
  const [handle, setHandle] = useState('');
  const [icon, setIcon] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (me?.suggestion && !handle) { setHandle(me.suggestion.handle); setIcon(me.suggestion.icon); } }, [me?.suggestion]);
  const start = async () => {
    if (!token) return;
    setBusy(true); setErr('');
    try {
      const r = await putCommunityMe(token, { acceptTerms: true, handle: handle.trim(), icon: icon || undefined });
      setProfile(r.profile); done(); onDone(r.profile);
    } catch (e) { setErr(plainError(e, '시작하지 못했어요')); } finally { setBusy(false); }
  };
  return (
    <View>
      <T v="title" accessibilityRole="header">함께 이용 규칙</T>
      <T v="sub" c="ink3" style={{ marginTop: S.xxs }}>{me?.region.label ?? '대구·경북'} 가족들과 다녀온 곳·도장을 나눠요. 아이를 지키는 규칙 네 가지예요.</T>
      <View style={{ marginTop: S.l, backgroundColor: t.fill, borderRadius: R.md + 2, paddingHorizontal: S.l + 2, paddingVertical: S.xs }}>
        {RULES.map((r, i) => (
          <View key={r.title} style={{ flexDirection: 'row', gap: S.l, paddingVertical: compact ? S.m : S.l - 2, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
            <Icon name={r.icon} size={20} color={t.accent} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <T v="label">{r.title}</T>
              <T v="cap" c="ink3" style={{ marginTop: 2, fontFamily: F.m }}>{r.sub}</T>
            </View>
          </View>
        ))}
      </View>
      <T v="cap" c="ink3" style={{ marginTop: S.m }}>
        {/* TODO(문의 연락처): 서버 COMMUNITY_CONTACT_EMAIL이 정해지면 여기 그대로 보인다 */}
        문의 · {me?.contact ?? '연락처 준비 중이에요'}
      </T>
      <View style={{ flexDirection: 'row', gap: S.l, marginTop: S.xs }}>
        <T v="cap" c="ink2" accessibilityRole="link" style={{ textDecorationLine: 'underline' }}
          onPress={() => { Linking.openURL(`${BASE}/community-rules`).catch(() => {}); }}>자세한 이용 규칙</T>
        <T v="cap" c="ink2" accessibilityRole="link" style={{ textDecorationLine: 'underline' }}
          onPress={() => { Linking.openURL(`${BASE}/privacy`).catch(() => {}); }}>개인정보처리방침</T>
      </View>

      <T v="label" c="ink2" style={{ marginTop: S.xl }}>우리 가족 별명</T>
      <HandleField handle={handle} icon={icon} icons={me?.icons ?? []} onHandle={setHandle} onIcon={setIcon} />
      {!!err && <T v="cap" c="redText" style={{ marginTop: S.s }}>{err}</T>}
      <Btn title="동의하고 시작하기" kind="accent" busy={busy} disabled={!me || handle.trim().length < 2} onPress={start} style={{ marginTop: S.l }} />
    </View>
  );
}

function HandleField({ handle, icon, icons, onHandle, onIcon }: { handle: string; icon: string; icons: string[]; onHandle: (s: string) => void; onIcon: (s: string) => void }) {
  const t = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.fill, borderRadius: R.input, paddingHorizontal: 12, minHeight: 50, marginTop: S.s }}>
        <Text style={{ fontSize: 22 }}>{icon || '🌱'}</Text>
        <TextInput value={handle} onChangeText={(s) => onHandle(s.slice(0, 10))} placeholder="별빛가족" placeholderTextColor={t.ink3} maxLength={10}
          accessibilityLabel="우리 가족 별명" style={[TYPE.body, { flex: 1, color: t.ink, paddingVertical: 12 }]} />
        <T v="cap" c="ink3">{[...handle].length}/10</T>
      </View>
      <T v="cap" c="ink3" style={{ marginTop: S.xs }}>실명·아이 이름 말고 별명으로 지어 주세요 (2~10자)</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: S.m }} contentContainerStyle={{ gap: S.s }}>
        {icons.map((x) => (
          <Pressable key={x} onPress={() => { tick(); onIcon(x); }} accessibilityRole="button" accessibilityLabel={`아이콘 ${x}`} accessibilityState={{ selected: x === icon }}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: x === icon ? t.accentSoft : t.fill, borderWidth: x === icon ? 2 : 0, borderColor: t.accent }}>
            <Text style={{ fontSize: 22 }}>{x}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** 처음 쓸 때 (프로필이 없으면 함께 탭이 연다) */
export function TermsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} full><ScrollView keyboardShouldPersistTaps="handled"><TermsForm onDone={onClose} /></ScrollView></Sheet>;
}

// ---------- 내 별명 (머리 칩) ----------
export function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTheme();
  const { token, me: phoneMe } = useSession();
  const { me } = useCommunityMe();
  const p = me?.profile;
  const [handle, setHandle] = useState('');
  const [icon, setIcon] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && p) { setHandle(p.handle); setIcon(p.icon); setErr(''); } }, [open, p?.handle, p?.icon]);
  const save = async (body: { handle?: string; icon?: string; hidden?: boolean }, close = true) => {
    if (!token) return;
    setBusy(true); setErr('');
    try { const r = await putCommunityMe(token, body); setProfile(r.profile); bumpFeed(); if (close) onClose(); }
    catch (e) { setErr(plainError(e, '저장하지 못했어요')); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <T v="title" accessibilityRole="header">우리 가족 별명</T>
      <T v="sub" c="ink3" style={{ marginTop: S.xxs }}>함께에서는 '{authorLine(handle || p?.handle || '', phoneMe?.me.nickname ?? null)}'처럼 보여요</T>
      <View style={{ marginTop: S.l }}>
        <HandleField handle={handle} icon={icon} icons={me?.icons ?? []} onHandle={setHandle} onIcon={setIcon} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.l, marginTop: S.xl, backgroundColor: t.fill, borderRadius: R.md + 2, padding: S.l + 2 }}>
        <View style={{ flex: 1 }}>
          <T v="label">함께 숨기기</T>
          <T v="cap" c="ink3" style={{ marginTop: 2, fontFamily: F.m }}>켜면 우리 가족 글이 다른 가족에게 안 보이고, 함께 탭도 쉬어요</T>
        </View>
        <Switch value={!!p?.hidden} disabled={busy} onValueChange={(v) => save({ hidden: v }, false)}
          trackColor={{ true: t.accent, false: t.fill2 }} thumbColor="#fff" accessibilityLabel="함께 숨기기" />
      </View>
      <T v="cap" c="ink3" style={{ marginTop: S.m }}>문의 · {me?.contact ?? '연락처 준비 중이에요'}</T>
      {!!err && <T v="cap" c="redText" style={{ marginTop: S.s }}>{err}</T>}
      <Btn title="저장" kind="accent" busy={busy} disabled={handle.trim().length < 2 || (handle.trim() === p?.handle && icon === p?.icon)}
        onPress={() => save({ handle: handle.trim(), icon })} style={{ marginTop: S.l }} />
      <Btn title="닫기" kind="soft" onPress={onClose} style={{ marginTop: S.m }} />
    </Sheet>
  );
}

// ---------- 올리기 ----------
const TIER_TEXT = { common: '도장', rare: '희귀 도장', legend: '축제 도장' } as const;
export const STARS = (n: number) => '★'.repeat(Math.max(1, Math.min(3, n)));
export function artFor(artKey: string, festivalId?: string | null) {
  if (festivalId) { const f = festivalById(festivalId); return festivalArt({ id: festivalId, placeId: f?.placeId ?? null }); }
  return stampArt(artKey);
}

function Composer({ target, onClose }: { target: ComposeTarget; onClose: () => void }) {
  const t = useTheme();
  const { token } = useSession();
  const { me } = useCommunityMe();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const warn = textWarning(text);
  const needTerms = !!me && !me.profile?.termsAt;
  if (needTerms) return <TermsForm compact onDone={() => {}} />;
  const send = async () => {
    if (!token) return;
    setBusy(true); setErr('');
    try {
      const body = target.kind === 'stamp'
        ? { kind: 'stamp' as const, placeId: target.placeId, rare: target.rare, festivalId: target.festivalId ?? null, text }
        : { kind: 'trip' as const, eventId: target.eventId, text };
      const r = await createPost(token, body);
      done(); bumpFeed(); onClose();
      Alert.alert(r.post.pending ? '올렸어요 · 집에 도착하면 함께에 보여요' : '함께에 올렸어요',
        r.post.pending ? '지금 있는 곳이 드러나지 않게, 집에 도착한 뒤(또는 2시간 뒤)에 다른 가족에게 보여요.' : undefined,
        [{ text: '확인', style: 'cancel' }, { text: '함께에서 보기', onPress: goTogether }]);
    } catch (e) { setErr(plainError(e, '올리지 못했어요')); } finally { setBusy(false); }
  };
  return (
    <View>
      <T v="title" accessibilityRole="header">{target.kind === 'stamp' ? '함께에 자랑하기' : '함께에 올리기'}</T>
      <T v="sub" c="ink3" style={{ marginTop: S.xxs }}>{me?.profile ? `${me.profile.icon} ${me.profile.handle}` : ''} · {me?.region.label ?? '대구·경북'} 가족들에게 보여요</T>
      {/* 올라가는 모양 미리 보기 — 장소 이름만, 지도·경로·시각 없음 */}
      <View style={{ marginTop: S.l, backgroundColor: t.fill, borderRadius: R.md + 2, padding: S.l + 2 }}>
        {target.kind === 'stamp' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.l }}>
            <Image fadeDuration={0} source={artFor(target.artKey, target.festivalId)} style={{ width: 60, height: 60, borderRadius: 30 }} />
            <View style={{ flex: 1 }}>
              <T v="h" numberOfLines={1}>{target.name}</T>
              <T v="cap" c="ink3">{STARS(target.tier === 'legend' ? 3 : target.tier === 'rare' ? 2 : 1)} {TIER_TEXT[target.tier]}</T>
            </View>
          </View>
        ) : (
          <View style={{ gap: S.s }}>
            <T v="label">오늘 이렇게 다녀왔어요{target.stamps ? ` · 도장 ${target.stamps}개` : ''}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.s }}>
              {target.places.map((n, i) => <PlaceChip key={`${n}${i}`} n={i + 1} name={n} />)}
            </View>
            <T v="cap" c="ink3">지도·경로·시각은 올라가지 않아요</T>
          </View>
        )}
      </View>
      <View style={{ marginTop: S.l, backgroundColor: t.fill, borderRadius: R.input, paddingHorizontal: 14, paddingVertical: 6 }}>
        <TextInput value={text} onChangeText={(s) => setText(s.slice(0, TEXT_MAX))} placeholder="한마디 (안 적어도 돼요)" placeholderTextColor={t.ink3}
          multiline maxLength={TEXT_MAX} accessibilityLabel="한마디" style={[TYPE.body, { color: t.ink, minHeight: 64, textAlignVertical: 'top' }]} />
        <T v="cap" c="ink3" style={{ alignSelf: 'flex-end' }}>{[...text].length}/{TEXT_MAX}</T>
      </View>
      {warn ? <Warn text={warn} /> : <T v="cap" c="ink3" style={{ marginTop: S.s }}>아이 얼굴·이름·학교는 빼 주세요 · 집에 도착하면 보여요</T>}
      {!!err && <T v="cap" c="redText" style={{ marginTop: S.s }}>{err}</T>}
      <Btn title="함께에 올리기" icon="send" kind="accent" busy={busy} disabled={!me} onPress={send} style={{ marginTop: S.l }} />
      <Btn title="다음에" kind="soft" onPress={onClose} style={{ marginTop: S.m }} />
    </View>
  );
}

function Warn({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, marginTop: S.s }}>
      <Icon name="triangle-alert" size={14} color={t.redText} />
      <T v="cap" c="redText" style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

export function PlaceChip({ n, name, onPress }: { n?: number; name: string; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 30, borderRadius: R.pill, backgroundColor: pressed ? t.fill2 : t.surface, borderWidth: 1, borderColor: t.line })}>
      {n != null && <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.b, fontSize: 11, lineHeight: 14, color: t.onAccent }}>{n}</Text></View>}
      <Text style={[TYPE.chip, { color: t.ink }]}>{name}</Text>
      {onPress && <Icon name="chevron-right" size={14} color={t.ink3} />}
    </Pressable>
  );
}

// ---------- 이 곳 아이랑 어땠어요? (한줄팁) ----------
function TipPrompt({ target, onClose }: { target: TipTarget; onClose: () => void }) {
  const t = useTheme();
  const { token } = useSession();
  const { me } = useCommunityMe();
  const [good, setGood] = useState<boolean | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState(false);
  const warn = textWarning(text);
  if (terms) return <TermsForm compact onDone={() => setTerms(false)} />;
  const send = async () => {
    if (!token || good === null) return;
    if (!me?.profile?.termsAt) { setTerms(true); return; }
    setBusy(true); setErr('');
    try {
      const r = await createPost(token, { kind: 'tip', placeId: target.placeId, good, tags, text });
      done(); bumpFeed(); onClose();
      Alert.alert('고마워요! 한줄팁을 남겼어요', r.post.pending ? '집에 도착하면 함께에 보여요' : undefined);
    } catch (e) { setErr(plainError(e, '남기지 못했어요')); } finally { setBusy(false); }
  };
  const tagList = me?.tipTags?.length ? me.tipTags : TIP_TAGS;
  return (
    <View>
      <T v="cap" c="ink3">{target.name}</T>
      <T v="title" accessibilityRole="header" style={{ marginTop: 2 }}>이 곳 아이랑 어땠어요?</T>
      <View style={{ flexDirection: 'row', gap: S.m, marginTop: S.l }}>
        {([true, false] as const).map((g) => (
          <Pressable key={String(g)} onPress={() => { tick(); setGood(g); }} accessibilityRole="button" accessibilityState={{ selected: good === g }}
            style={{ flex: 1, minHeight: 64, borderRadius: R.md + 2, alignItems: 'center', justifyContent: 'center', gap: 2,
              backgroundColor: good === g ? t.accentSoft : t.fill, borderWidth: good === g ? 2 : 0, borderColor: t.accent }}>
            <Text style={{ fontSize: 24 }}>{g ? '👍' : '👎'}</Text>
            <T v="label" c={good === g ? 'accentInk' : 'ink2'}>{g ? '아이랑 좋아요' : '아쉬웠어요'}</T>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.s, marginTop: S.l }}>
        {tagList.map((x) => {
          const on = tags.includes(x);
          return (
            <Pressable key={x} onPress={() => { tick(); setTags((xs) => (on ? xs.filter((y) => y !== x) : [...xs, x])); }} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: R.pill, justifyContent: 'center', backgroundColor: on ? t.accent : t.fill }}>
              <Text style={[TYPE.chip, { color: on ? t.onAccent : t.ink2 }]}>{x}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ marginTop: S.l, backgroundColor: t.fill, borderRadius: R.input, paddingHorizontal: 14 }}>
        <TextInput value={text} onChangeText={(s) => setText(s.slice(0, TEXT_MAX))} placeholder="한 줄 (예: 주차는 지하가 넓어요)" placeholderTextColor={t.ink3}
          maxLength={TEXT_MAX} accessibilityLabel="한 줄 팁" style={[TYPE.body, { color: t.ink, paddingVertical: 12 }]} />
      </View>
      {warn ? <Warn text={warn} /> : <T v="cap" c="ink3" style={{ marginTop: S.s }}>함께에 '장소 한줄팁'으로 올라가요 · 집에 도착하면 보여요</T>}
      {!!err && <T v="cap" c="redText" style={{ marginTop: S.s }}>{err}</T>}
      <Btn title="함께에 남기기" kind="accent" busy={busy} disabled={good === null} onPress={send} style={{ marginTop: S.l }} />
      <Btn title="다음에" kind="soft" onPress={onClose} style={{ marginTop: S.m }} />
    </View>
  );
}

/** 앱 어디서나 연 올리기·한줄팁 창 (Shell에 하나) */
export function TogetherHosts() {
  const s = useTogetherStore();
  const { token } = useSession();
  // 창을 열 때 내 함께 정보(동의 여부·별명)를 새로
  useEffect(() => { if (token && (s.compose || s.tip)) loadCommunityMe(token, true); }, [token, !!s.compose, !!s.tip]);
  const closeC = useCallback(() => openComposer(null), []);
  return (
    <>
      <Sheet open={!!s.compose} onClose={closeC} full>
        <ScrollView keyboardShouldPersistTaps="handled">{s.compose && <Composer target={s.compose} onClose={closeC} />}</ScrollView>
      </Sheet>
      <Sheet open={!!s.tip} onClose={closeTip} full>
        <ScrollView keyboardShouldPersistTaps="handled">{s.tip && <TipPrompt target={s.tip} onClose={closeTip} />}</ScrollView>
      </Sheet>
    </>
  );
}

// ---------- 신고 ----------
const REASONS: { key: ReportReason; title: string; sub: string }[] = [
  { key: 'child_safety', title: '아이 안전이 걱정돼요', sub: '바로 숨기고 운영팀이 살펴요' },
  { key: 'privacy', title: '개인정보가 보여요', sub: '이름·연락처·학교·집 같은 것' },
  { key: 'abuse', title: '욕설·비하', sub: '' },
  { key: 'spam', title: '광고·도배', sub: '' },
  { key: 'other', title: '그 밖의 이유', sub: '' },
];
export function ReportSheet({ postId, onClose, onDone }: { postId: string | null; onClose: () => void; onDone: (hidden: boolean) => void }) {
  const t = useTheme();
  const { token } = useSession();
  const [busy, setBusy] = useState<ReportReason | null>(null);
  const send = async (r: ReportReason) => {
    if (!token || !postId) return;
    setBusy(r);
    try { const x = await reportPost(token, postId, r); done(); onClose(); onDone(x.hidden); }
    catch (e) { Alert.alert('신고하지 못했어요', plainError(e, '잠시 뒤 다시 해 주세요')); }
    finally { setBusy(null); }
  };
  return (
    <Sheet open={!!postId} onClose={onClose}>
      <T v="title" accessibilityRole="header">신고하기</T>
      <T v="sub" c="ink3" style={{ marginTop: S.xxs }}>어떤 점이 문제인가요? 누가 신고했는지는 알리지 않아요.</T>
      <View style={{ marginTop: S.l, backgroundColor: t.fill, borderRadius: R.md + 2, paddingHorizontal: S.l + 2 }}>
        {REASONS.map((r, i) => (
          <Pressable key={r.key} onPress={() => send(r.key)} disabled={!!busy} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.l, minHeight: 56, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, opacity: pressed ? 0.6 : 1 })}>
            <Icon name={r.key === 'child_safety' ? 'baby' : 'flag'} size={18} color={r.key === 'child_safety' ? t.redText : t.ink2} />
            <View style={{ flex: 1, paddingVertical: S.s }}>
              <T v="label" c={r.key === 'child_safety' ? 'redText' : 'ink'}>{r.title}</T>
              {!!r.sub && <T v="cap" c="ink3" style={{ fontFamily: F.m }}>{r.sub}</T>}
            </View>
            {busy === r.key ? <T v="cap" c="ink3">보내는 중…</T> : <Icon name="chevron-right" size={18} color={t.ink3} />}
          </Pressable>
        ))}
      </View>
      <Btn title="닫기" kind="soft" onPress={onClose} style={{ marginTop: S.l }} />
    </Sheet>
  );
}
