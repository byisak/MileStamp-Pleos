// 이어 듣기 시트: 차에서 끊긴 문장부터 같은 목소리로. 화면을 꺼도·잠금 화면에서도 계속
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { TripEvent } from '../api';
import { clipFor, place, resumeAt } from '../places';
import { F, TYPE } from '../theme';
import { Icon, Pill, Sheet, T, tap, useTheme } from '../ui';

export function ListenSheet({ event, onClose }: { event: TripEvent | null; onClose: () => void }) {
  const open = !!event && (event.kind === 'handoff' || event.kind === 'intro');
  return (
    <Sheet open={open} onClose={onClose} full>
      {open && event && <Player event={event} />}
    </Sheet>
  );
}

function Player({ event }: { event: TripEvent }) {
  const t = useTheme();
  const p = place(event.place_id)!;
  const clip = clipFor(p.id, event.payload.variant)!;
  const start = event.kind === 'handoff' ? resumeAt(clip, Number(event.payload.positionMs ?? 0)) : 0;
  const player = useAudioPlayer(clip.src);
  const st = useAudioPlayerStatus(player);
  const begun = useRef(false);

  useEffect(() => {
    setAudioModeAsync({ shouldPlayInBackground: true, playsInSilentMode: true, interruptionMode: 'doNotMix' }).catch(() => {});
    return () => { try { player.pause(); player.setActiveForLockScreen(false); } catch {} };
  }, [player]);

  useEffect(() => {
    if (begun.current || !st.isLoaded) return;
    begun.current = true;
    player.seekTo(start).then(() => {
      player.play();
      player.setActiveForLockScreen(true, { title: `${p.name} 이야기`, artist: '마일스탬프' });
    });
  }, [st.isLoaded]);

  // 대본을 문장으로 나눠 지금 문장을 진하게. 문장 시작 시각(무음 구간)과 문장 수가 같으면 그걸 쓰고,
  // 다르면 글자 위치 비율로 시작 시각을 어림한다 (MindNest '원문 문장 눌러 듣기'와 같은 방식)
  const sentences = useMemo(() => clip.text.split(/(?<=[.!?])\s+/), [clip.text]);
  const dur = st.duration || clip.duration;
  const starts = useMemo(() => {
    if (sentences.length === clip.starts.length) return clip.starts;
    const head = clip.starts[0] ?? 0, total = clip.text.length;
    let pos = 0;
    return sentences.map((s) => { const at = head + (pos / total) * (clip.duration - head - 0.3); pos += s.length + 1; return at; });
  }, [sentences, clip]);
  const now = st.currentTime ?? 0;
  let cur = -1;
  starts.forEach((s, i) => { if (s <= now + 0.05) cur = i; });

  return (
    <View style={{ paddingBottom: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={p.icon} size={22} color={t.accent} />
        <T v="title" style={{ flexShrink: 1 }}>{p.name}</T>
      </View>
      <View style={{ marginTop: 8 }}>
        <Pill text={event.kind === 'handoff' ? '차에서 듣던 문장부터' : event.payload.story ? '처음부터 들어요' : '조용히 가는 중이라 폰으로'} tone="accent" icon={event.kind === 'handoff' ? 'fast-forward' : event.payload.story ? 'headphones' : 'moon'} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 22 }}>
        <Pressable onPress={() => { tap(); st.playing ? player.pause() : (now >= dur - 0.2 ? player.seekTo(0).then(() => player.play()) : player.play()); }}
          style={({ pressed }) => ({ width: 64, height: 64, borderRadius: 32, backgroundColor: t.ink, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
          <Icon name={st.playing ? 'pause' : 'play'} size={26} color={t.onInk} style={{ marginLeft: st.playing ? 0 : 3 }} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.fill, overflow: 'hidden' }}>
            <View style={{ height: 6, width: `${Math.min(100, (now / dur) * 100)}%`, backgroundColor: t.accent }} />
          </View>
          <T v="cap" c="ink3" style={{ marginTop: 6, fontVariant: ['tabular-nums'] }}>{fmt(now)} / {fmt(dur)}</T>
        </View>
      </View>

      <Text style={[TYPE.body, { marginTop: 22, lineHeight: 27 }]}>
        {sentences.map((s, i) => (
          <Text key={i} style={{ color: cur === -1 || i === cur ? t.ink : t.ink3, fontFamily: i === cur ? F.b : F.m }}>{s}{i < sentences.length - 1 ? ' ' : ''}</Text>
        ))}
      </Text>
    </View>
  );
}

function fmt(s: number) { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
