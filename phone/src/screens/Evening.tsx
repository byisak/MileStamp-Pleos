// 오늘 탭 저녁 화면 (proto/evening-plan.html · docs/장소-데이터-구조-계획.md §7)
// 서버 저녁 계획(evening: 해 진 뒤 ~ 귀가 한계 90분 전)일 때 대화 대신 먼저 보인다:
//   밤 풍경 머리 '해는 졌지만, 아직 1시간 반 있어요 🌙' · '저녁에 잠깐 나가 볼까요?'(동행마다) · 지금 시각·날씨·귀가 한계
//   → 저녁 카드 2~3장(야경 산책·따뜻한 실내·야경 드라이브 …, 누르면 '차로 보내기') → 해 질 녘 전망 '내일 추천' → 내일 코스 미리 정하기
// 카드 글은 서버(엔진) 이유 칩 그대로 — 차 화면과 같은 말.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Alert } from '../alert';
import { companionNow, EVENING_Q, eveningLeftText, optionShape, useAskMemory } from '../ask';
import { durText } from '../course';
import { PlanOption, PlanRes, reasonIcon, toMin } from '../plan';
import { usePlan } from '../planStore';
import { useSession } from '../session';
import { useSkyNow } from '../skyNow';
import { clock, clockText } from '../timefmt';
import { F, R, S } from '../theme';
import { done, Icon, IconName, plainError, T, tick, useTheme } from '../ui';
import { ActionButton, Header } from '../parts';
import { Chip } from './PlanBits';

/** 저녁 카드 머리 그림·이름: 서버 label '저녁 · 야경 산책' → '야경 산책' */
function kicker(o: PlanOption): { icon: IconName; text: string } {
  const name = o.label.replace(/^저녁 · /, '');
  const shape = optionShape(o);
  const icon: IconName = shape === 'drive' ? 'car' : /실내/.test(name) ? 'house' : /노을/.test(name) ? 'sunset' : 'moon';
  return { icon, text: name };
}

/** 저녁 계획인가 (오늘 계획 · 내일 안내가 아님) */
export const isEveningPlan = (d: PlanRes | null | undefined): d is PlanRes => !!d?.evening && !d.tomorrowHint;

export function EveningToday({ data, onAsk, onTomorrow }: { data: PlanRes; onAsk: () => void; onTomorrow: () => void }) {
  const t = useTheme();
  const p = usePlan();
  const { token } = useSession();
  const sky = useSkyNow(token);
  const mem = useAskMemory();
  const comp = companionNow(data.companion ?? mem.companion ?? p.family?.companion);
  const kids = comp === 'kids';
  const [busy, setBusy] = useState<number | null>(null);
  const now = p.test?.extra.at ? new Date(p.test.extra.at) : new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const limit = data.plan.backByMin;
  const cards = data.plan.options.map((o, i) => ({ o, i })).filter(({ o }) => o.stops.length > 0).slice(0, 3);
  const tip = data.sky?.sunsetTip ?? null;
  const tempC = data.sky?.temp ?? (sky ? Math.round(sky.tempC) : null);
  const skyWord = data.sky?.sky === 'RAIN' ? '비' : data.sky?.sky === 'SNOW' ? '눈' : data.sky?.sky === 'CLEAR' ? '맑음' : null;
  const line = [`지금 ${clock(nowMin)}`, [skyWord, tempC != null ? `${tempC}°` : null].filter(Boolean).join(' ') || null,
    `${kids ? '아이 잠자기 전' : '늦어도'}(${clock(limit)})까지`].filter(Boolean).join(' · ');

  const send = (i: number, o: PlanOption) => {
    tick();
    Alert.alert('이 코스로 갈까요?', `${o.stops.map((s) => s.name).join(' → ')} · 집 ${clock(o.arriveHomeMin)} 도착`, [
      { text: '아니요', style: 'cancel' },
      { text: '차로 보내기', onPress: async () => {
        setBusy(i);
        try { await p.choosePlanned(data.planId, { idx: i }); done(); }
        catch (e) { Alert.alert('보내지 못했어요', plainError(e, '잠시 뒤 다시 눌러 주세요')); }
        finally { setBusy(null); }
      } },
    ]);
  };

  return (
    <View style={{ flexGrow: 1 }}>
      {/* 밤 풍경 머리 (늘 밤 장면 — 달은 오늘 모양) */}
      <Header scene="night" date={`${eveningLeftText(nowMin, limit - 90)} 🌙`} greeting={EVENING_Q[comp]} height={210} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.s, marginTop: -S.l, marginBottom: S.l, paddingLeft: S.xs }}>
        <T v="sub" c="ink3" style={{ flex: 1 }}>{line}</T>
        <ActionButton label="대화로" icon="smile" tone="ghost" size="sm" onPress={() => { tick(); onAsk(); }} />
      </View>

      <View style={{ gap: S.m }}>
        {cards.map(({ o, i }) => {
          const k = kicker(o);
          const dur = durText(o.arriveHomeMin - data.plan.nowMin);
          // 첫 줄 = 시각 맞춤·드라이브 이유 + 집 도착, 나머지 칩은 아래
          const main = o.reasons.filter((r) => r.tone === 'SUN').slice(0, 1).map((r) => clockText(r.text));
          const rest = o.reasons.filter((r) => !(r.tone === 'SUN' && clockText(r.text) === main[0]) && !/귀가/.test(r.text));
          return (
            <Pressable key={i} onPress={() => send(i, o)} disabled={busy != null} accessibilityRole="button"
              accessibilityLabel={`${k.text}, ${o.stops.map((s) => s.name).join(', ')}, 집 ${clock(o.arriveHomeMin)} 도착, 차로 보내기`}
              style={({ pressed }) => ({ backgroundColor: t.surface, borderRadius: R.lg + 2, padding: S.l + 2, gap: 4, opacity: busy != null && busy !== i ? 0.6 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name={k.icon} size={15} color={t.accent} />
                <T v="cap" c="accent" style={{ fontFamily: F.b }}>{k.text} · {dur}</T>
              </View>
              <T v="h" style={{ fontSize: 17.5, lineHeight: 24, fontFamily: F.xb, letterSpacing: -0.4 }}>{o.stops.map((s) => s.name).join(' → ')}</T>
              <T v="cap" c="ink3">{[...main, `${clock(o.arriveHomeMin)} 집`].join(' · ')}</T>
              {rest.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {rest.slice(0, 3).map((r) => <Chip key={r.text} tone={r.tone} parts={[{ icon: reasonIcon(r), text: r.text }]} />)}
                </View>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
                <T v="cap" c="ink2" style={{ fontFamily: F.b }}>{busy === i ? '보내는 중…' : '차로 보내기 ›'}</T>
              </View>
            </Pressable>
          );
        })}
        {cards.length === 0 && (
          <View style={{ backgroundColor: t.surface, borderRadius: R.lg, padding: S.l + 2 }}>
            <T v="h">지금 가기 좋은 저녁 명소가 없어요</T>
            <T v="cap" c="ink3" style={{ marginTop: 2 }}>오늘은 쉬고 내일 코스를 정해 두면 아침에 차에 떠 있어요</T>
          </View>
        )}
        {/* 해 질 녘 전망 — 해가 이미 졌으면 내일 노을 시각 */}
        {tip && (
          <View style={{ backgroundColor: t.surface, borderRadius: R.lg + 2, padding: S.l + 2, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="sunset" size={15} color={t.ink3} />
              <T v="cap" c="ink3" style={{ fontFamily: F.b }}>해 질 녘 전망 · 내일 추천</T>
            </View>
            <T v="h" style={{ fontSize: 17, lineHeight: 24 }}>{tip.name}</T>
            <T v="cap" c="ink3">오늘은 해가 이미 졌어요 · 내일 {clock(toMin(tip.arriveBy) ?? 0)}에 가면 노을</T>
          </View>
        )}
        <Pressable onPress={() => { tick(); onTomorrow(); }} accessibilityRole="button"
          style={({ pressed }) => ({ backgroundColor: t.fill, borderRadius: R.lg, paddingHorizontal: S.l + 2, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}>
          <T v="h" style={{ fontSize: 15.5 }}>내일 코스 미리 정하기</T>
          <Icon name="chevron-right" size={18} color={t.ink2} />
        </Pressable>
      </View>
    </View>
  );
}
