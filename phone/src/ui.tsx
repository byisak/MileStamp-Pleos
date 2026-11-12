// 공통 부품 — 전부 평평하게(그림자·elevation 없음)
import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Keyboard, Modal, Platform, Pressable, ScrollView, StyleProp, Text, TextInput,
  TextProps, TextStyle, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tap, tick } from './haptics';
import { Icon, IconName } from './icon';
import { F, H, R, TYPE, Theme, TypeName, useTheme } from './theme';
import { Chip } from './parts/Chip';
import { clockHM, getTimeFmt } from './timefmt';

export { useTheme, Icon };
export type { IconName };

// 넓은 화면(폴드 펼침·태블릿)에서 본문 폭 상한. 가운데 정렬, 좌우 여백 20은 따로
export const MAX_W = 600;
/** 스크롤 본문 틀: 폭 MAX_W(+여백)까지, 가운데 */
export const wide = { width: '100%' as const, maxWidth: MAX_W + 40, alignSelf: 'center' as const };

// 진동 (haptics.ts) — 예전처럼 ui에서도 부른다
export { tap, tick, thud, done } from './haptics';

// ---------- 글자 ----------
export type TColor = 'ink' | 'ink2' | 'ink3' | 'accent' | 'ok' | 'red' | 'blue' | 'onInk' | 'onAccent' | 'accentInk' | 'redText' | 'okText';
/** 글자에 쓰면 c='red'·'ok'도 글자용 진한 색(redText·okText)으로 — 면 색 red·ok는 흰 바탕 위 4.5 미달 */
const TEXT_COLOR: Partial<Record<TColor, keyof Theme>> = { red: 'redText', ok: 'okText' };
export function T({ v = 'body', c = 'ink', style, ...p }: TextProps & { v?: TypeName; c?: TColor; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text {...p} style={[TYPE[v], { color: t[TEXT_COLOR[c] ?? c] as string }, style]} />;
}

/** 검색어를 강조한 글 */
export function Highlight({ text, q, v = 'sub', c = 'ink2', lines }: { text: string; q: string; v?: TypeName; c?: TColor; lines?: number }) {
  const t = useTheme();
  const k = q.trim();
  if (!k) return <T v={v} c={c} numberOfLines={lines}>{text}</T>;
  const parts = text.split(new RegExp(`(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <T v={v} c={c} numberOfLines={lines}>
      {parts.map((s, i) => (s.toLowerCase() === k.toLowerCase()
        ? <Text key={i} style={{ backgroundColor: t.accentSoft, color: t.accentInk, fontFamily: F.b }}>{s}</Text> : s))}
    </T>
  );
}

// ---------- 면 ----------
export function Surface({ children, style, pad = 16 }: { children: ReactNode; style?: StyleProp<ViewStyle>; pad?: number }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.surface, borderRadius: R.surface, padding: pad }, style]}>{children}</View>;
}
export function Fill({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.fill, borderRadius: R.md, padding: 12 }, style]}>{children}</View>;
}
export function Section({ title, right, color }: { title: string; right?: ReactNode; color?: TColor }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 8, paddingHorizontal: 4 }}>
      <T v="label" c={color || 'ink3'}>{title}</T>
      {right}
    </View>
  );
}
export function Divider({ inset = 0 }: { inset?: number }) {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.line, marginLeft: inset }} />;
}

/** 한 면 안의 행 목록 — 카드 더미 대신 */
export function List<I>({ items, render, keyOf, inset = 0 }: { items: I[]; render: (i: I, k: number) => ReactNode; keyOf: (i: I) => string | number; inset?: number }) {
  return (
    <Surface pad={0} style={{ paddingHorizontal: 16 }}>
      {items.map((it, k) => (
        <View key={keyOf(it)}>
          {k > 0 && <Divider inset={inset} />}
          {render(it, k)}
        </View>
      ))}
    </Surface>
  );
}

// ---------- 버튼 ----------
export function Btn({ title, onPress, busy, disabled, kind = 'ink', icon, small, style }: {
  title: string; onPress: () => void; busy?: boolean; disabled?: boolean; kind?: 'ink' | 'accent' | 'soft' | 'line'; icon?: IconName; small?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = { ink: t.ink, accent: t.accent, soft: t.fill, line: 'transparent' }[kind];
  const fg = kind === 'ink' ? t.onInk : kind === 'accent' ? t.onAccent : t.ink;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} disabled={disabled || busy}
      accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [{
        backgroundColor: bg, borderRadius: R.btn, height: small ? H.touch : 52, paddingHorizontal: small ? 14 : 18,
        alignItems: 'center', justifyContent: 'center', borderWidth: kind === 'line' ? 1 : 0, borderColor: t.line,
        opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }],
      }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {icon && <Icon name={icon} size={small ? 16 : 18} color={fg} />}
          <Text style={[TYPE.btn, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}
/** 아이콘만 있는 버튼 — label(화면 읽기 이름표)은 꼭. 보이는 크기 40, 누르는 칸 44 이상(hitSlop) */
export function IconBtn({ icon, label, onPress, color, size = 22, disabled }: { icon: IconName; label: string; onPress: () => void; color?: string; size?: number; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.fill : 'transparent', opacity: disabled ? 0.4 : 1 })}>
      <Icon name={icon} size={size} color={color || t.ink} />
    </Pressable>
  );
}

// ---------- 작은 것 ----------
/** 작은 알약 — 공용 칩(parts/Chip)의 옛 이름. tone: neutral·accent·ok·blue·red → plain·stamp·ok·nap·warn */
export function Pill({ text, tone = 'neutral', icon }: { text: string; tone?: 'neutral' | 'accent' | 'ok' | 'blue' | 'red'; icon?: IconName }) {
  const map = { neutral: 'plain', accent: 'stamp', ok: 'ok', blue: 'nap', red: 'warn' } as const;
  return <Chip text={text} tone={map[tone]} icon={icon} />;
}

export function Check({ on, onPress, late }: { on: boolean; onPress: () => void; late?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={12}
      style={{ width: 24, height: 24, borderRadius: 12, borderWidth: on ? 0 : 1.8, borderColor: late ? t.red : t.fill2, backgroundColor: on ? t.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {on && <Icon name="check" size={15} color={t.onInk} strokeWidth={2.8} />}
    </Pressable>
  );
}

export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.fill, borderRadius: 12, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => { tick(); onChange(o.key); }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 38, paddingVertical: 8, borderRadius: 9, backgroundColor: on ? t.surface : 'transparent' }}>
            <Text style={[TYPE.cap, { fontFamily: F.b, fontSize: 13, color: on ? t.ink : t.ink3 }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Input({ value, onChange, placeholder, icon, secure, onSubmit, autoFocus, right, style }: {
  value: string; onChange: (v: string) => void; placeholder?: string; icon?: IconName; secure?: boolean; onSubmit?: () => void; autoFocus?: boolean; right?: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.fill, borderRadius: R.input, paddingHorizontal: 14, minHeight: 50 }, style]}>
      {icon && <Icon name={icon} size={18} color={t.ink3} />}
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={t.ink3} secureTextEntry={secure}
        onSubmitEditing={onSubmit} autoFocus={autoFocus} autoCapitalize="none" autoCorrect={false} returnKeyType={onSubmit ? 'done' : 'default'}
        style={[TYPE.body, { flex: 1, color: t.ink, paddingVertical: 12 }]} />
      {right}
    </View>
  );
}
export function Label({ children }: { children: string }) {
  return <T v="label" c="ink2" style={{ marginBottom: 7, marginTop: 4 }}>{children}</T>;
}

export function Skeleton({ h = 16, w = '100%', r = 8, style }: { h?: number; w?: any; r?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const a = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(a, { toValue: 0.5, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[{ height: h, width: w, borderRadius: r, backgroundColor: t.fill, opacity: a }, style]} />;
}
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <Surface style={{ gap: 18 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ gap: 8 }}><Skeleton w="55%" h={16} /><Skeleton h={12} /><Skeleton w="30%" h={12} /></View>
      ))}
    </Surface>
  );
}

// 빈 화면(Empty)·오류 줄(ErrorRow)은 공용 부품 parts/ 로 옮김

/** 네트워크·서버 오류를 쉬운 말로 (원래 글은 개발 탭·로그에서만) */
export const friendlyError = (e: unknown, what = '불러오지 못했어요'): string => {
  const m = String((e as any)?.message ?? e ?? '');
  if (/Network request failed|timeout|시간|응답 없음|fetch/i.test(m)) return '인터넷이 잠깐 끊겼어요';
  return what;
};

/** 서버가 준 한글 안내(예: '코드가 맞지 않거나 10분이 지났어요')는 그대로, 영어·기술 말이면 쉬운 말로 */
export const plainError = (e: unknown, what: string): string => {
  const m = String((e as any)?.message ?? '');
  return /[가-힣]/.test(m) && !/[{}]|https?:|Error/.test(m) ? m : friendlyError(e, what);
};

/** 키보드가 올라와 있으면 그 윗변(화면 y)과 높이. 안드로이드 edge-to-edge에선 창이 줄지 않아서 직접 피해야 한다 */
export function useKeyboard() {
  const [kb, setKb] = useState({ height: 0, top: 0 });
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
      setKb({ height: e.endCoordinates.height, top: e.endCoordinates.screenY }));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb({ height: 0, top: 0 }));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return kb;
}

/** 화면 아래에 붙은 입력줄 — 키보드가 올라오면 키보드 바로 위로 */
export function BottomBar({ children, gap = 12, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  const kb = useKeyboard();
  const ref = useRef<any>(null);
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!kb.height) { setLift(0); return; }
    // 이 줄의 원래 아랫변(탭 바 위)이 키보드 윗변보다 아래면 그만큼 올린다
    ref.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => setLift(Math.max(0, y + lift + h + gap - kb.top)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kb.height, kb.top]);
  return (
    <View ref={ref} style={[{ position: 'absolute', left: 16, right: 16, bottom: gap + lift }, style]}>
      {children}
    </View>
  );
}

/** 아래에서 올라오는 시트 — 배경은 제자리에서 어두워지고(페이드), 판만 아래에서 올라온다 */
export function Sheet({ open, onClose, children, full }: { open: boolean; onClose: () => void; children: ReactNode; full?: boolean }) {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const kb = useKeyboard();
  const [shown, setShown] = useState(open);
  const [panelH, setPanelH] = useState(600);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (open) {
      setShown(true);
      Animated.timing(v, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else if (shown) {
      Animated.timing(v, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setShown(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const y = v.interpolate({ inputRange: [0, 1], outputRange: [panelH + 40, 0] });
  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.dim, opacity: v }} />
      <View style={{ flex: 1, paddingBottom: kb.height }}>
        <Pressable style={{ flex: 1, minHeight: ins.top + 40 }} onPress={onClose} />
        <Animated.View onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}
          style={[{ width: '100%', maxWidth: MAX_W + 40, alignSelf: 'center', backgroundColor: t.surface, borderTopLeftRadius: R.sheet, borderTopRightRadius: R.sheet, paddingHorizontal: 20, paddingTop: 10,
            paddingBottom: (kb.height ? 0 : ins.bottom) + 14, transform: [{ translateY: y }] }, full && { maxHeight: '92%' }]}>
          <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: t.fill2, alignSelf: 'center', marginBottom: 14 }} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** 탭 화면 공통 틀: 큰 제목 + 스크롤 */
export function Page({ title, right, children, refresh, scroll = true }: { title?: string; right?: ReactNode; children: ReactNode; refresh?: ReactNode; scroll?: boolean }) {
  const head = title ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 4, minHeight: 40 }}>
      <T v="display">{title}</T>{right}
    </View>
  ) : null;
  if (!scroll) return <View style={[{ flex: 1, paddingHorizontal: 20 }, wide]}>{head}{children}</View>;
  return (
    <ScrollView contentContainerStyle={[{ paddingHorizontal: 20, paddingBottom: 40 }, wide]} keyboardShouldPersistTaps="handled" refreshControl={refresh as any}>
      {head}{children}
    </ScrollView>
  );
}

export function useT(): Theme { return useTheme(); }

// ---------- 날짜 ----------
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
/** 시각 (우리 차 탭 '시간 표시'를 따름): '오후 9:54' / '21:54' */
export function hm(d: Date) { return clockHM(d.getHours(), d.getMinutes()); }
/** 짧게: 12시간이면 오전/오후 없이 '9:54', 24시간이면 '21:54' */
export function hmShort(d: Date) {
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  return getTimeFmt() === '24' ? `${String(h).padStart(2, '0')}:${m}` : `${h % 12 || 12}:${m}`;
}
export function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function weekday(d: Date) { return WD[d.getDay()]; }
export function dayLabel(d: Date) {
  const today = new Date();
  if (ymd(d) === ymd(today)) return '오늘';
  if (ymd(d) === ymd(addDays(today, -1))) return '어제';
  if (ymd(d) === ymd(addDays(today, 1))) return '내일';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}
export function dur(s: number) {
  s = Math.round(s || 0);
  return s >= 60 ? `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ''}` : `${s}초`;
}
export function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
}
export function until(d: Date) {
  const m = Math.round((d.getTime() - Date.now()) / 60000);
  if (m < 0) return '지남';
  if (m < 60) return `${m}분 뒤`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 뒤`;
  return `${Math.round(m / 1440)}일 뒤`;
}
