// 미션: [진행 중 · 완료 미션] 목록 → 시트에서 퀴즈 + 찾아보기.
// 11/2부터 탭이 아니라 도장북 안 '미션' 칸(Stamps.tsx)에 들어간다 — 탭 자리는 '함께'.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { answerMission, getMissions, MissionRow } from '../api';
import { useEvents } from '../events';
import { place } from '../places';
import { useSession } from '../session';
import { Btn, Check, friendlyError, Icon, Pill, Segmented, Sheet, SkeletonList, T, dayLabel, done, hm, tick, useTheme } from '../ui';
import { Empty, ErrorRow, IconBadge, Landscape, PrimaryCTA, Row } from '../parts';
import { R, S } from '../theme';
import { W } from '../words';

/** 완료 미션: 퀴즈를 풀었고(정답 여부가 정해짐) 찾아보기도 함 — 오늘 탭 숫자 카드도 같은 기준 */
export const isDone = (m: MissionRow) => m.correct !== null && !!m.answer?.found;

/** 도장북 '미션' 칸. reloadKey가 바뀌면(도장북 당겨서 새로 고침) 다시 불러온다 */
export function MissionsSection({ reloadKey = 0 }: { reloadKey?: number }) {
  const t = useTheme();
  const { token } = useSession();
  const ev = useEvents();
  const [k, setK] = useState<'open' | 'done'>('open');
  const [rows, setRows] = useState<MissionRow[] | null>(null);
  const [open, setOpen] = useState<MissionRow | null>(null);

  const [err, setErr] = useState('');
  const load = useCallback(async () => { if (token) { try { setRows((await getMissions(token)).missions); setErr(''); } catch (e: any) { setErr(friendlyError(e, '미션을 불러오지 못했어요')); } } }, [token]);
  const missionCount = (ev.events ?? []).filter((e) => e.kind === 'mission').length;
  useEffect(() => { load(); }, [load, missionCount, reloadKey]);

  const list = (rows ?? []).filter((m) => (k === 'done') === isDone(m));
  const openCount = (rows ?? []).filter((m) => !isDone(m)).length;
  return (
    <View>
      <View style={{ marginBottom: S.l + 2 }}>
        <Segmented value={k} onChange={setK} options={[{ key: 'open', label: openCount ? `진행 중 ${openCount}` : '진행 중' }, { key: 'done', label: W.missionsDone }]} />
      </View>
      {!!err && <ErrorRow title={err} sub={rows ? '전에 받은 미션을 보여 드려요' : '잠시 뒤 다시 해 주세요'} onRetry={() => { tick(); load(); }} style={{ marginBottom: 12 }} />}
      {rows === null ? (err ? null : <SkeletonList rows={2} />) : list.length === 0 ? <MissionEmpty kind={k} hasAny={rows.length > 0} /> : (
        // 줄 모양은 오늘 탭 '오늘의 기록'과 같게: 동그란 장소 아이콘 · 장소 이름 · 남은 것 · 시각 · >
        <View style={{ backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.l + 2 }}>
          {list.map((m, i) => {
            const p = place(m.place_id);
            const ready = !!p?.mission;
            const left = (m.correct !== null ? 0 : 1) + (m.answer?.found ? 0 : 1);
            const doneRow = isDone(m);
            const sub = !ready ? '이곳 미션은 준비 중이에요'
              : doneRow ? `퀴즈 · 찾아보기 끝냄${m.correct ? ' · 정답' : ''}`
              : left === 2 ? '퀴즈 · 찾아보기 2개 남음' : m.correct === null ? '퀴즈 1개 남음' : '찾아보기 1개 남음';
            return (
              <View key={m.id} style={i ? { borderTopWidth: 1, borderTopColor: t.line } : undefined}>
                <Row icon={p?.icon ?? 'flag'} tone={doneRow ? 'ok' : 'accent'} title={p?.name ?? '미션'} sub={sub}
                  onPress={ready ? () => setOpen(m) : undefined}
                  trailing={(
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
                      <T v="cap" c="ink3" style={{ fontVariant: ['tabular-nums'] }}>{dayLabel(new Date(m.created_at)) === '오늘' ? hm(new Date(m.created_at)) : dayLabel(new Date(m.created_at))}</T>
                      {ready && <Icon name="chevron-right" size={18} color={t.ink3} />}
                    </View>
                  )} />
              </View>
            );
          })}
        </View>
      )}
      <MissionSheet mission={open} onClose={() => setOpen(null)} onSaved={load} />
    </View>
  );
}

/** 빈 화면: 작은 수채 풍경 + 무엇이 언제 오는지. 할 게 없으니 버튼은 없다 */
function MissionEmpty({ kind, hasAny }: { kind: 'open' | 'done'; hasAny: boolean }) {
  const t = useTheme();
  const title = kind === 'open' ? (hasAny ? '진행 중인 미션을 다 끝냈어요' : '아직 받은 미션이 없어요') : '아직 끝낸 미션이 없어요';
  const sub = kind === 'open'
    ? '도장을 찍고 차에서 내리면 그곳 퀴즈와 찾아보기가 이 폰으로 와요'
    : '진행 중 미션에서 퀴즈를 풀고 찾아보기를 하면 여기로 옮겨 와요';
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: R.lg, overflow: 'hidden' }}>
      <View style={{ height: 96 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Landscape scene={t.dark ? 'night' : 'day'} height={96} bg={t.surface} />
      </View>
      <Empty compact icon={kind === 'open' && !hasAny ? 'flag' : 'circle-check'} title={title} sub={sub} style={{ paddingTop: S.xs }} />
    </View>
  );
}

export function MissionSheet({ mission, onClose, onSaved }: { mission: { id: string; place_id: string | null; answer?: MissionRow['answer']; correct?: boolean | null } | null; onClose: () => void; onSaved?: () => void }) {
  const t = useTheme();
  const { token } = useSession();
  // 미션이 있는 장소만 (새 도장 장소는 아직 미션 없음)
  const pl = place(mission?.place_id);
  const p = pl?.mission ? { ...pl, mission: pl.mission } : null;
  const [choice, setChoice] = useState<number | null>(null);
  const [answer, setAnswer] = useState<number | null>(null);
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  // 답 저장 실패 (조용히 넘기지 않는다)
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    setSaveErr('');
    setChoice(mission?.answer?.choice ?? null);
    setFound(!!mission?.answer?.found);
    setAnswer(mission?.correct != null && mission?.answer?.choice != null && p ? p.mission.quiz.answer : null);
  }, [mission?.id]);

  const send = async (c: number | null, f: boolean) => {
    if (!token || !mission) return;
    setBusy(true); setSaveErr('');
    try {
      const r = await answerMission(token, mission.id, c, f);
      if (c !== null) { setAnswer(r.answer); if (r.correct) done(); }
      onSaved?.();
    } catch (e) {
      // 고른 것을 되돌려 다시 누를 수 있게
      if (c !== null) setChoice(mission.answer?.choice ?? null);
      else setFound(!f);
      setSaveErr(friendlyError(e, '저장하지 못했어요') === '인터넷이 잠깐 끊겼어요' ? '인터넷이 잠깐 끊겨 저장하지 못했어요. 다시 눌러 주세요' : '저장하지 못했어요. 다시 눌러 주세요');
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={!!mission && !!p} onClose={onClose} full>
      {p && (
        <View style={{ paddingBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.l }}>
            <IconBadge icon={p.icon} tone="accent" size="lg" />
            <View style={{ flex: 1 }}>
              <T v="title">{p.name}</T>
              <T v="sub" c="ink3">여기서 해 볼 것 2가지 · 퀴즈와 찾아보기</T>
            </View>
          </View>

          <T v="label" c="ink3" style={{ marginTop: 20 }}>퀴즈</T>
          <T v="h" style={{ marginTop: 4, fontSize: 17, lineHeight: 25 }}>{p.mission.quiz.q}</T>
          <View style={{ gap: 8, marginTop: 12 }}>
            {p.mission.quiz.options.map((o, i) => {
              const decided = answer !== null;
              const right = decided && i === answer;
              const wrong = decided && i === choice && i !== answer;
              return (
                <Pressable key={o} disabled={decided || busy} onPress={() => { tick(); setChoice(i); send(i, found); }}
                  style={({ pressed }) => ({ minHeight: 54, borderRadius: R.md, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: right ? t.accent : wrong ? t.redSoft : t.fill, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <T v="btn" style={{ color: right ? t.onAccent : wrong ? t.redText : t.ink }}>{o}</T>
                  {right && <Icon name="circle-check" size={20} color={t.onAccent} />}
                  {wrong && <Icon name="circle-x" size={20} color={t.red} />}
                </Pressable>
              );
            })}
          </View>
          {answer !== null && (
            <View style={{ marginTop: 10 }}>
              <Pill text={choice === answer ? '정답이에요!' : '아쉬워요. 다음 장소에서 또 해 봐요'} tone={choice === answer ? 'ok' : 'neutral'} icon={choice === answer ? 'smile' : 'frown'} />
            </View>
          )}

          <T v="label" c="ink3" style={{ marginTop: 22 }}>찾아보기</T>
          <Pressable onPress={() => { const f = !found; setFound(f); if (f) done(); else tick(); send(null, f); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.fill, borderRadius: R.md, padding: 16, marginTop: 6 }}>
            <Check on={found} onPress={() => { const f = !found; setFound(f); if (f) done(); else tick(); send(null, f); }} />
            <T v="body" style={{ flex: 1 }}>{p.mission.find}</T>
          </Pressable>

          {!!saveErr && <View style={{ marginTop: 14 }}><Pill text={saveErr} tone="red" icon="circle-alert" /></View>}
          {answer !== null && found
            ? <PrimaryCTA title="끝냈어요" icon="check" onPress={() => { done(); onClose(); }} style={{ marginTop: S.xl }} />
            : <Btn title="닫기" kind="line" onPress={onClose} style={{ marginTop: 18 }} />}
        </View>
      )}
    </Sheet>
  );
}
