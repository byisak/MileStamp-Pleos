// 우리 차 탭 (디자인 개편 4단계, docs/디자인-점검/2-other-screens.md 2-5절)
// 위→아래: 연결 카드 → (알림이 꺼져 있으면) 알림 켜기 띠 → ① 우리 가족 → ② 가족 폰 → ③ 이 폰 설정(알림 · 시간 표시 · 쉿 모드 · 이 폰 이름)
// (+ 화면 모드: 시스템 설정 따름·밝게·어둡게)
// → 맨 아래 '연결 끊기' 빨간 글자 줄. 줄은 모두 공용 Row(동그란 아이콘 · 이름 · 오른쪽 값 · 화살표), 누르면 작은 시트.
import Constants from 'expo-constants';
import { ReactNode, useEffect, useState } from 'react';
import { Linking, RefreshControl, View } from 'react-native';
import { Alert } from '../alert';
import { BASE, renameMe, unlink } from '../api';
import { hasAuto, loadQuietMode, QuietMode, setAutoTimeFmt, setQuietMode } from '../auto';
import { askAndSync } from '../notify';
import { kidsText } from '../plan';
import { COMPANION_INFO, companionNow, useAskMemory } from '../ask';
import { usePlan } from '../planStore';
import { useSession } from '../session';
import { useDevUi } from '../devclean';
import { R, S, setThemeMode, ThemeMode, useTheme, useThemeMode } from '../theme';
import { clock, clockText, setTimeFmt, TimeFmt, useTimeFmt } from '../timefmt';
import { Btn, Icon, Input, Page, Section, Sheet, SkeletonList, T, ago } from '../ui';
import { Chip, IconBadge, PrimaryCTA, Row } from '../parts';
import { W } from '../words';
import { FamilySheet } from './FamilySheet';

const QUIET_TEXT: Record<QuietMode, string> = { auto: '자동 (낮잠 시간)', on: '늘 켜기', off: '끄기' };
const THEME_TEXT: Record<ThemeMode, string> = { system: '시스템 설정 따름', light: '밝게', dark: '어둡게' };
const THEME_SUB: Record<ThemeMode, string> = { system: '휴대폰의 다크 모드를 따라가요', light: '늘 밝은 화면', dark: '늘 어두운 화면' };
const DWELL_TEXT = { quick: '빨리 둘러봐요', normal: '보통', long: '오래 놀아요' } as const;

/** 흰 판 하나에 줄 여러 개 — 줄 사이 얇은 선 */
function Group({ children }: { children: ReactNode[] }) {
  const t = useTheme();
  const items = children.filter(Boolean);
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.l + 2 }}>
      {items.map((c, i) => <View key={i} style={i ? { borderTopWidth: 1, borderTopColor: t.line } : undefined}>{c}</View>)}
    </View>
  );
}

export function CarTab() {
  const t = useTheme();
  const s = useSession();
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'' | 'name' | 'time' | 'quiet' | 'theme'>('');
  const [name, setName] = useState('');
  const [famOpen, setFamOpen] = useState(false);
  const plan = usePlan();
  // 데모 차 표시는 개발 표시 — 시연용 깔끔 보기면 보통 차처럼
  const dev = useDevUi();
  const fam = plan.family;
  const askMem = useAskMemory();
  const comp = companionNow(askMem.companion ?? fam?.companion);
  // 안드로이드 오토 쉿 모드 (안드로이드만): 자동(낮잠 시간) · 켜기 · 끄기
  const [quiet, setQuiet] = useState<QuietMode>('auto');
  const [quietNow, setQuietNow] = useState<boolean | null>(null);
  useEffect(() => { if (hasAuto) loadQuietMode().then(setQuiet); }, []);
  const pickQuiet = async (m: QuietMode) => { setQuiet(m); setQuietNow(await setQuietMode(m)); };
  // 시간 표시: 12시간(오후 9:54, 기본) · 24시간(21:54). 이 폰에만 저장, 안드로이드 오토 화면도 같이
  const timeFmt = useTimeFmt();
  // 화면 모드: 이 폰에만 저장, 앱 전체에 바로
  const themeMode = useThemeMode();
  const pickTimeFmt = (f: TimeFmt) => { setTimeFmt(f); setAutoTimeFmt(f); };
  const napLine = !fam ? '' : fam.napStart != null && fam.napLen != null && fam.napLen > 0
    ? `낮잠 ${clock(fam.napStart - 20)}~${clock(fam.napStart + fam.napLen)}에 저절로 쉿 (잠들기 20분 전부터)`
    : '낮잠 없음으로 정해 둬서 자동으로는 켜지지 않아요';
  const pushOn = !!s.me?.me.hasPush;
  const phones = s.me?.family ?? [];
  const meIdx = phones.findIndex((f) => f.me);
  const myName = s.me ? phoneName(s.me.me.nickname, Math.max(0, meIdx)) : '';

  const turnOnPush = async () => {
    if (!s.token) return;
    setBusy(true);
    const ok = await askAndSync(s.token);
    setBusy(false);
    await s.refresh();
    if (!ok) Alert.alert('알림을 켜지 못했어요', '휴대폰 설정 → 앱 → 마일스탬프 → 알림에서 허용해 주세요.');
  };

  const leave = () => Alert.alert('이 폰의 연결을 끊을까요?', '다시 연결하려면 차 화면의 QR을 한 번 더 찍으면 돼요.', [
    { text: '취소', style: 'cancel' },
    { text: '연결 끊기', style: 'destructive', onPress: async () => {
      if (s.token) await unlink(s.token).catch(() => {});
      await s.signOut();
    } },
  ]);

  const save = async () => {
    if (!s.token || !name.trim()) return;
    setBusy(true);
    try { await renameMe(s.token, name.trim()); await s.refresh(); setSheet(''); }
    catch (e: any) { Alert.alert('이름을 바꾸지 못했어요', e.message); }
    finally { setBusy(false); }
  };
  const openFam = () => setFamOpen(true);

  return (
    <Page title="우리 차" refresh={<RefreshControl refreshing={false} onRefresh={s.refresh} colors={[t.accent]} progressBackgroundColor={t.surface} />}>
      {/* 연결 카드: 연한 초록 동그라미 + 차 */}
      <View style={{ marginTop: S.l, backgroundColor: t.surface, borderRadius: R.lg, padding: S.xl, flexDirection: 'row', alignItems: 'center', gap: S.l + 2 }}>
        <IconBadge icon="car-front" tone="accent" size="lg" />
        <View style={{ flex: 1 }}>
          <T v="h">{dev ? '데모 차와 연결됨' : '우리 차와 연결됨'}</T>
          <T v="cap" c="ink3" style={{ marginTop: 1 }}>
            {dev ? '개발자 시험용 — 개발 탭에서 소식을 보내요' : s.me ? `가족 폰 ${phones.length}대 · 차에서 생긴 일이 이 폰으로 와요` : '차에서 생긴 일이 이 폰으로 와요'}
          </T>
        </View>
        {dev ? <Chip text="데모" tone="nap" icon="flask-conical" /> : <Chip text="연결" tone="ok" icon="check" />}
      </View>

      {/* 알림이 꺼져 있을 때만: 큰 버튼 하나 */}
      {s.me && !pushOn && (
        <View style={{ marginTop: S.l, backgroundColor: t.accentSoft, borderRadius: R.lg, padding: S.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.l }}>
            <IconBadge icon="bell" tone="surface" size="md" />
            <T v="sub" c="accentInk" style={{ flex: 1 }}>알림을 켜면 차 문이 열릴 때 듣던 이야기를 폰에서 이어 들을 수 있어요</T>
          </View>
          <PrimaryCTA title="알림 켜기" icon="bell" busy={busy} onPress={turnOnPush} style={{ marginTop: S.l }} />
        </View>
      )}

      {/* ① 함께 가는 사람: 기본 동행 + (아이와면) 아이·낮잠 */}
      <Section title="함께 가는 사람" />
      {!fam ? <SkeletonList rows={3} /> : (
        <Group>{[
          <Row key="with" icon={COMPANION_INFO[comp].icon} title="기본 동행" trailing={<Val text={COMPANION_INFO[comp].label} />} onPress={openFam} />,
          comp === 'kids' ? <Row key="kid" icon="baby" title="아이" trailing={<Val text={kidsText(fam.kidAges)} />} onPress={openFam} /> : null,
          comp === 'kids' ? <Row key="nap" icon="moon" tone="nap" title="낮잠" trailing={<Val text={clockText(fam.text.nap)} />} onPress={openFam} /> : null,
          <Row key="back" icon="sunset" tone="sun" title={W.limit} trailing={<Val text={clockText(fam.text.backBy)} />} onPress={openFam} />,
          // 저녁 나들이 귀가 기준: 아이와 = 잠자는 시간 · 어른끼리 = 늦어도 몇 시 귀가 (새 서버 — 옛 서버면 기본값)
          comp === 'kids'
            ? <Row key="bed" icon="moon" title="아이 잠자는 시간" trailing={<Val text={clock(fam.bedtime ?? 21 * 60)} />} onPress={openFam} />
            : <Row key="late" icon="moon" title="늦어도 몇 시 귀가" trailing={<Val text={clock(fam.lateReturn ?? 23 * 60)} />} onPress={openFam} />,
          <Row key="dinner" icon="utensils" title="저녁 시각" trailing={<Val text={fam.dinner != null ? clock(fam.dinner) : clockText(fam.text.dinner)} />} onPress={openFam} />,
          // 밥도 같이 짜기 (새 서버 — 옛 서버면 '밥은 따로')
          <Row key="meal" icon="utensils" title="밥도 같이 짜기" trailing={<Val text={fam.mealPlan ? '켬 · 식당도 넣어요' : '끔 · 밥은 따로'} accent={!!fam.mealPlan} />} onPress={openFam} />,
          <Row key="dwell" icon="hourglass" title="머무는 편" trailing={<Val text={DWELL_TEXT[fam.dwellPref ?? 'normal']} />} onPress={openFam} />,
          <Row key="home" icon="house" title="집 위치" trailing={<Val text={fam.home ? '정했어요' : '아직 안 정했어요'} accent={!fam.home} />} onPress={openFam} />,
        ]}</Group>
      )}
      <T v="cap" c="ink3" style={{ marginTop: S.m, paddingHorizontal: S.xs }}>오늘 추천·코스 시간과 차의 길 안내에 써요. 차도 켤 때 받아 가요</T>
      <FamilySheet open={famOpen} onClose={() => setFamOpen(false)} />

      {/* ② 가족 폰 */}
      <Section title="가족 폰" right={s.me ? <T v="cap" c="ink3">{phones.length}대</T> : undefined} />
      {!s.me ? <SkeletonList rows={2} /> : (
        <Group>{[
          ...phones.map((f, k) => {
            const nm = phoneName(f.nickname, k);
            const avatar = (
              <View style={{ width: 40, height: 40, borderRadius: R.pill, backgroundColor: f.me ? t.accent : t.fill, alignItems: 'center', justifyContent: 'center' }}>
                <T v="label" c={f.me ? 'onAccent' : 'ink2'} style={{ fontSize: 15 }}>{nm.slice(0, 1)}</T>
              </View>
            );
            return (
              <Row key={f.since + f.nickname} leading={avatar} title={f.me ? `${nm} (이 폰)` : nm}
                sub={`${ago(new Date(f.since).getTime())} 연결 · ${f.hasPush ? '알림 켜짐' : '알림 꺼짐'}`}
                trailing={f.me ? 'chevron' : undefined}
                onPress={f.me ? () => { setName(s.me?.me.nickname === '가족' ? '' : s.me?.me.nickname ?? ''); setSheet('name'); } : undefined} />
            );
          }),
          <Row key="add" icon="qr-code" tone="mute" title="가족 폰 더하기" sub="차 화면의 '폰 연결' QR을 다른 폰으로 찍으면 돼요" lines={2} />,
        ]}</Group>
      )}

      {/* ③ 이 폰 설정 */}
      <Section title="이 폰 설정" />
      <Group>{[
        <Row key="push" icon="bell" title="알림" trailing={<Val text={!s.me ? '' : pushOn ? '켜짐' : '꺼짐'} accent={!!s.me && !pushOn} />}
          onPress={() => pushOn
            ? Alert.alert('알림이 켜져 있어요', '차 문이 열리면 듣던 이야기가 이 폰으로 와요. 끄려면 휴대폰 설정 → 앱 → 마일스탬프 → 알림에서 꺼 주세요.')
            : turnOnPush()} />,
        <Row key="time" icon="clock" title="시간 표시" trailing={<Val text={timeFmt === '12' ? '오후 9:54' : '21:54'} />} onPress={() => setSheet('time')} />,
        <Row key="theme" icon={t.dark ? 'moon' : 'sun'} title="화면 모드" trailing={<Val text={THEME_TEXT[themeMode]} />} onPress={() => setSheet('theme')} />,
        hasAuto ? <Row key="quiet" icon="volume-x" tone="nap" title="쉿 모드" sub="안드로이드 오토" trailing={<Val text={QUIET_TEXT[quiet]} />} onPress={() => setSheet('quiet')} /> : null,
        <Row key="name" icon="pencil-line" title="이 폰 이름" trailing={<Val text={myName} />}
          onPress={() => { setName(s.me?.me.nickname === '가족' ? '' : s.me?.me.nickname ?? ''); setSheet('name'); }} />,
        // 약관·개인정보: 서버 공개 화면을 브라우저로 (개인정보처리방침 → 위치기반서비스 약관·함께 규칙으로 이어짐)
        <Row key="legal" icon="book-open" tone="mute" title="약관·개인정보" trailing="chevron"
          onPress={() => { Linking.openURL(`${BASE}/privacy`).catch(() => {}); }} />,
      ]}</Group>

      {/* 맨 아래: 연결 끊기 (빨간 글자 줄, 작게) */}
      <View style={{ marginTop: S.sec + 4 }}>
        <Group>{[<Row key="unlink" title="이 폰 연결 끊기" danger onPress={leave} style={{ minHeight: 52 }} />]}</Group>
      </View>

      {/* 앱 정보: 버전 (문의·업데이트 확인용) */}
      <T v="cap" c="ink3" style={{ textAlign: 'center', marginTop: S.l }}>
        마일스탬프 {Constants.expoConfig?.version ?? '?'}{Constants.expoConfig?.android?.versionCode ? ` (${Constants.expoConfig.android.versionCode})` : ''}
      </T>

      {/* 시트: 이름 바꾸기 */}
      <Sheet open={sheet === 'name'} onClose={() => setSheet('')}>
        <T v="title">이 폰 이름</T>
        <T v="sub" c="ink3" style={{ marginTop: S.xs, marginBottom: S.l + 2 }}>차 화면과 가족 폰 목록에 보이는 이름이에요</T>
        <Input value={name} onChange={setName} placeholder="예: 엄마" autoFocus onSubmit={save} />
        <Btn title="저장" onPress={save} busy={busy} disabled={!name.trim()} style={{ marginTop: S.l }} />
      </Sheet>

      {/* 시트: 시간 표시 */}
      <Sheet open={sheet === 'time'} onClose={() => setSheet('')}>
        <T v="title">시간 표시</T>
        <T v="sub" c="ink3" style={{ marginTop: S.xs, marginBottom: S.s }}>오늘 추천·코스{hasAuto ? '·안드로이드 오토 화면' : ''}에 같이 써요. 이 폰에만 저장돼요</T>
        {([['12', '오후 9:54', '12시간 · 오전·오후로'], ['24', '21:54', '24시간으로']] as const).map(([k, title, sub]) => (
          <Row key={k} title={title} sub={sub} selected={timeFmt === k} trailing={timeFmt === k ? 'check' : undefined}
            onPress={() => { pickTimeFmt(k); setSheet(''); }} style={{ paddingHorizontal: S.xs }} />
        ))}
      </Sheet>

      {/* 시트: 화면 모드 */}
      <Sheet open={sheet === 'theme'} onClose={() => setSheet('')}>
        <T v="title">화면 모드</T>
        <T v="sub" c="ink3" style={{ marginTop: S.xs, marginBottom: S.s }}>이 폰에만 저장돼요. 오늘 탭 그림은 어느 모드든 지금 시각(낮·노을·밤)을 따라가요</T>
        {(['system', 'light', 'dark'] as ThemeMode[]).map((k) => (
          <Row key={k} title={THEME_TEXT[k]} sub={THEME_SUB[k]} selected={themeMode === k} trailing={themeMode === k ? 'check' : undefined}
            onPress={() => { setThemeMode(k); setSheet(''); }} style={{ paddingHorizontal: S.xs }} />
        ))}
      </Sheet>

      {/* 시트: 쉿 모드 (세로 목록 — 좁은 폭에서 줄바꿈 없게) */}
      {hasAuto && (
        <Sheet open={sheet === 'quiet'} onClose={() => setSheet('')}>
          <T v="title">쉿 모드</T>
          <T v="sub" c="ink3" style={{ marginTop: S.xs, marginBottom: S.s }}>아이가 자는 동안 안드로이드 오토에서 도장 소리·음성을 끄고 화면만 보여 줘요</T>
          {(['auto', 'on', 'off'] as QuietMode[]).map((k) => (
            <Row key={k} title={QUIET_TEXT[k]} sub={k === 'auto' ? napLine : undefined} lines={2} selected={quiet === k}
              trailing={quiet === k ? 'check' : undefined} onPress={() => { pickQuiet(k); }} style={{ paddingHorizontal: S.xs }} />
          ))}
          {quietNow != null && (
            <View style={{ marginTop: S.m, alignSelf: 'flex-start' }}>
              <Chip text={quietNow ? '지금 쉿' : '지금 소리 켬'} tone={quietNow ? 'nap' : 'plain'} />
            </View>
          )}
        </Sheet>
      )}
    </Page>
  );
}

/** 줄 오른쪽 값 + 화살표 */
function Val({ text, accent }: { text: string; accent?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, flexShrink: 1, maxWidth: '55%' }}>
      <T v="cap" c={accent ? 'accent' : 'ink2'} numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>{text}</T>
      <Icon name="chevron-right" size={18} color={t.ink3} />
    </View>
  );
}

/** 가족 폰 이름: 처음 연결 때 이름을 건너뛰면 서버엔 '가족'으로 남는다 → '가족 폰 2'처럼 번호로 (목록 순서 = 연결한 순서) */
export const phoneName = (nickname: string, idx: number) => (nickname === '가족' ? `가족 폰 ${idx + 1}` : nickname);
