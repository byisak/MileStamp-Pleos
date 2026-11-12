// 오늘 탭 코스 카드(CourseSection)와 코스 진행 화면(CourseScreen)이 같이 쓰는 것:
// 조종 묶음(CourseCtl) 모양 · 토스트 · 머무름 칩 · 제안 카드 · 장소 고르기 시트 · 글 도우미.
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { CourseEventIn, durText, Explanation, LiveCourse, LiveStop, Outcome, ro } from '../course';
import type { PlanOption } from '../plan';
import { clock, clockText } from '../timefmt';
import { place } from '../places';
import { F, R, S } from '../theme';
import { Btn, Icon, IconName, Sheet, T, tick, useTheme } from '../ui';
import { DayBar, Mark, Row } from '../parts';
import { W } from '../words';
import { CourseTitle } from './PlanBits';
import type { BigAction, Stage } from './courseStage';

export const CONFLICT_TEXT = '차가 먼저 바꿨어요 · 최신으로 보여 드려요';

export type CourseSheet = null | 'replace' | 'skip' | 'insert' | 'end' | 'family' | 'edit' | 'more';

/** CourseSection이 들고 있는 상태·할 일 — 오늘 탭 카드와 코스 진행 화면이 같이 쓴다 */
export type CourseCtl = {
  c: LiveCourse;
  o: Outcome | null;
  ex: Explanation;
  nowMin: number;
  stage: Stage;
  big: BigAction;
  dest: string;
  rem: LiveStop[];
  candidates: { id: string; name: string }[];
  busy: boolean;
  proposal: PlanOption[] | null;
  toast: string;
  clearToast: () => void;
  act: (e: CourseEventIn) => Promise<void>;
  goHome: (end?: boolean) => void;
  adopt: (idx: number) => Promise<void>;
  dismiss: () => Promise<void>;
  openSheet: (s: CourseSheet) => void;
  editDwell: (s: LiveStop) => void;
  /** 코스 편집을 쓸 수 있나 (계획이 있고 모의가 아님) */
  canEdit: boolean;
  placeName: (id: string) => string;
};

/** 막대 눈금: 지금(조금 앞) ~ 귀가 예정·한계(조금 뒤). 표시선은 지금·귀가 한계 */
export function barRange(c: LiveCourse, nowMin: number): { from: number; to: number; marks: Mark[] } {
  const first = c.legs[0]?.fromMin ?? nowMin;
  const start = Math.min(nowMin, first);
  const from = start - 15;
  const to = Math.max(c.arriveHomeMin, c.limitMin, start + 45) + 25;
  const marks: Mark[] = [{ min: nowMin, label: '지금', tone: 'now' }];
  if (c.limitMin > from && c.limitMin < to) marks.push({ min: c.limitMin, label: `${W.limit} ${clock(c.limitMin, true)}`, tone: 'sun' });
  return { from, to, marks };
}

/** 바꾸면 도착이 지금 코스보다 얼마나 늦거나 이른지 */
export function diffText(d: number): string {
  if (Math.abs(d) < 1) return '지금과 같아요';
  return d > 0 ? `지금보다 ${durText(d)} 늦게` : `지금보다 ${durText(-d)} 일찍`;
}

/**
 * 설명 끝 문장 '○○에는 HH:MM쯤 와요/도착해요'(해 지기 … 포함)가 지금 코스 도착 시각(homeMin)과 같으면 화면 글에서 뺀다 —
 * 도착 시각은 한 곳에만 보이게. 시각이 다르면(다른 기준) 그대로 둔다.
 */
export function dropHomeSentence(body: string, dest: string, homeMin: number): string {
  const esc = dest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = body.match(new RegExp(`\\s*${esc}에는 (\\d{1,2}):(\\d{2})쯤[^.]*\\.$`));
  if (!m) return body;
  const at = Number(m[1]) * 60 + Number(m[2]);
  return at === ((homeMin % 1440) + 1440) % 1440 ? body.slice(0, m.index).trim() : body;
}

// ---------- 조용한 토스트 (사건 결과 한 줄) ----------
export function Toast({ toast, onDone }: { toast: string; onDone: () => void }) {
  const t = useTheme();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    a.setValue(0);
    Animated.timing(a, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timer = setTimeout(() => Animated.timing(a, { toValue: 0, duration: 260, useNativeDriver: true }).start(onDone), 3200);
    return () => clearTimeout(timer);
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflict = toast === CONFLICT_TEXT;
  return (
    <Animated.View accessibilityLiveRegion="polite"
      style={{ marginTop: S.m, opacity: a, flexDirection: 'row', alignItems: 'center', gap: S.s, alignSelf: 'flex-start', paddingVertical: S.s, paddingHorizontal: S.l - 1, borderRadius: R.sm, backgroundColor: conflict ? t.blueSoft : t.ink }}>
      <Icon name={conflict ? 'car-front' : 'check'} size={14} color={conflict ? t.blue : t.onInk} strokeWidth={2.4} />
      <T v="cap" style={{ color: conflict ? t.blue : t.onInk, fontFamily: F.b, flexShrink: 1 }}>{clockText(toast)}</T>
    </Animated.View>
  );
}

// ---------- 머무름 칩: '머무름 1시간 30분 · 오늘만' + 연필 (누르면 머무는 시간 시트) ----------
export function DwellChip({ s, busy, onPress }: { s: LiveStop; busy?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tick(); onPress(); }} disabled={busy} hitSlop={6}
      accessibilityRole="button" accessibilityLabel={`머무름 ${durText(s.dwellGuessMin)} 바꾸기`}
      style={({ pressed }) => ({ marginTop: S.s, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: S.xs + 1, minHeight: 32, paddingHorizontal: S.l - 2, borderRadius: R.pill, backgroundColor: t.fill, opacity: busy ? 0.5 : pressed ? 0.6 : 1 })}>
      <Icon name="hourglass" size={13} color={t.ink2} />
      <T v="cap" c="ink2" style={{ fontFamily: F.b, fontVariant: ['tabular-nums'] }}>
        머무름 {durText(s.dwellGuessMin)}{s.dwellSet ? ' · 오늘만' : ''}
      </T>
      <Icon name="pencil" size={12} color={t.ink3} />
    </Pressable>
  );
}

// ---------- 제안 카드 (비교: 카드마다 코스·도착·하루 막대) ----------
export function ProposalCards({ options, dest, nowHome, from, to, marks, busy, onAdopt, onDismiss }: {
  options: PlanOption[]; dest: string; nowHome: number; from: number; to: number; marks: Mark[]; busy: boolean;
  onAdopt: (idx: number) => void; onDismiss: () => void;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState<number | null>(null);
  useEffect(() => { if (!busy) setPicking(null); }, [busy]);
  return (
    <View>
      {options.map((o, i) => (
        <View key={i} style={{ marginTop: S.m, backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.xl, paddingTop: S.l + 2, paddingBottom: S.l + 2, borderWidth: 1.5, borderColor: i === 0 ? t.accent : t.line }}>
          <T v="label" c="accent">{`${i + 1}번 · ${clockText(o.label)}`}</T>
          <View style={{ marginTop: 3 }}>
            <CourseTitle names={o.stops.length ? o.stops.map((x) => x.name) : [`바로 ${ro(dest)}`]} />
          </View>
          {/* 이 안대로 바꾸면의 도착 — 지금 코스 도착과의 차이로 */}
          <T v="cap" c="ink2" style={{ marginTop: 3 }}>{`바꾸면 ${dest} ${clock(o.arriveHomeMin)} 도착 · ${diffText(o.arriveHomeMin - nowHome)}`}</T>
          <DayBar legs={o.legs} from={from} to={to} marks={marks} />
          <Btn title={W.adopt} icon="check" kind={i === 0 ? 'accent' : 'soft'} busy={busy && picking === i} disabled={busy && picking !== i}
            onPress={() => { setPicking(i); onAdopt(i); }} style={{ marginTop: S.l, height: 48, borderRadius: R.md }} />
        </View>
      ))}
      <Pressable disabled={busy} onPress={onDismiss} accessibilityRole="button"
        style={({ pressed }) => ({ alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: S.xl, opacity: pressed ? 0.6 : 1 })}>
        <T v="cap" c="ink2" style={{ fontFamily: F.b, textDecorationLine: 'underline' }}>{W.keep}</T>
      </Pressable>
    </View>
  );
}

// ---------- 장소 고르기 시트 (다음 바꾸기 · 빼기 · 들르기) ----------
export function PickSheet({ open, onClose, title, sub, items, icon, onPick }: {
  open: boolean; onClose: () => void; title: string; sub: string; items: { id: string; name: string; note?: string }[]; icon?: IconName; onPick: (id: string) => void;
}) {
  const t = useTheme();
  return (
    <Sheet open={open} onClose={onClose} full>
      <T v="title">{title}</T>
      <T v="sub" c="ink3" style={{ marginTop: S.xs, marginBottom: S.l - 2 }}>{sub}</T>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: S.m }} showsVerticalScrollIndicator={false}>
        <View style={{ backgroundColor: t.fill, borderRadius: R.md + 2, paddingHorizontal: S.l + 2 }}>
          {items.map((it, i) => (
            <View key={it.id} style={i ? { borderTopWidth: 1, borderTopColor: t.line } : undefined}>
              <Row icon={place(it.id)?.icon ?? 'map-pin'} tone="surface" title={it.name} sub={it.note}
                trailing={icon ? <Icon name={icon} size={18} color={t.accent} /> : 'chevron'} onPress={() => onPick(it.id)} />
            </View>
          ))}
          {!items.length && <T v="sub" c="ink3" style={{ paddingVertical: S.xl, textAlign: 'center' }}>고를 곳이 없어요</T>}
        </View>
      </ScrollView>
      <Btn title="닫기" kind="soft" onPress={onClose} style={{ marginTop: S.l }} />
    </Sheet>
  );
}
