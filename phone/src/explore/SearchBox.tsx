// 검색창 + 자동완성 (docs/검색-거리순-계획.md ②) — 직접 찾기 지도 · 기준 위치 시트 공용.
// 2글자 이상 치고 0.3초 쉬면 서버 /api/explore/suggest (카카오 키는 서버에만), 새로 치면 앞 요청은 취소.
// 줄 순서는 서버가 정함: 우리 명소 → '이 주소로' → 관광명소·문화시설 → 공원·체험·키즈 → 그 밖 → 음식점·카페
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, View } from 'react-native';
import { ApiError } from '../api';
import { span } from '../plan';
import { F, R, S } from '../theme';
import { Icon, IconName, Input, Pill, T, tick, useTheme } from '../ui';
import { Row } from '../parts';
import { getSuggest, type RefPoint, type Suggest } from './api';

export const suggestIcon = (s: Suggest): IconName =>
  s.kind === 'place' ? 'stamp' : s.kind === 'address' ? 'map' : s.kind === 'pin' ? 'map-pin' : /키즈|어린이|놀이/.test(s.label) ? 'baby' : /음식|카페/.test(s.label) ? 'utensils' : 'landmark';

export const suggestSub = (s: Suggest) =>
  [s.label, s.driveMin != null ? `차로 ${span(s.driveMin)}` : null, s.addr || null].filter(Boolean).join(' · ');

const enough = (q: string) => q.replace(/\s/g, '').length >= 2;

type St = { s: 'idle' } | { s: 'loading' } | { s: 'ok'; items: Suggest[]; kakaoOk: boolean } | { s: 'soon' } | { s: 'error'; msg: string };

export function SearchBox({ token, from, placeholder, onPick, max = 8, onFocusChange }: {
  token: string | null; from: RefPoint | null; placeholder: string; onPick: (s: Suggest) => void; max?: number;
  onFocusChange?: (open: boolean) => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [st, setSt] = useState<St>({ s: 'idle' });
  const ctrl = useRef<AbortController | null>(null);
  const fromKey = from ? `${from.lat.toFixed(3)},${from.lng.toFixed(3)}` : '';

  useEffect(() => {
    ctrl.current?.abort();
    if (!token || !enough(q)) { setSt({ s: 'idle' }); return; }
    const timer = setTimeout(() => {
      const c = new AbortController();
      ctrl.current = c;
      setSt((p) => (p.s === 'ok' ? p : { s: 'loading' }));
      getSuggest(token, q.trim(), from, c.signal)
        .then((r) => { if (!c.signal.aborted) setSt(r.status === 'soon' ? { s: 'soon' } : { s: 'ok', items: r.items, kakaoOk: r.kakaoOk }); })
        .catch((e) => {
          if (c.signal.aborted || (e instanceof ApiError && e.status === -1)) return;
          setSt({ s: 'error', msg: e instanceof Error ? e.message : '찾지 못했어요' });
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [token, q, fromKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => ctrl.current?.abort(), []);
  const open = st.s !== 'idle';
  useEffect(() => { onFocusChange?.(open); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (s: Suggest) => { tick(); Keyboard.dismiss(); setQ(''); setSt({ s: 'idle' }); onPick(s); };
  const items = st.s === 'ok' ? st.items.slice(0, max) : [];

  return (
    <View>
      <Input value={q} onChange={setQ} placeholder={placeholder} icon="search"
        right={q ? (
          <Pressable onPress={() => { setQ(''); setSt({ s: 'idle' }); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="지우기">
            <Icon name="circle-x" size={18} color={t.ink3} />
          </Pressable>
        ) : undefined} />
      {open && (
        <View style={{ marginTop: S.s, backgroundColor: t.surface, borderRadius: R.lg, paddingHorizontal: S.l, borderWidth: 1, borderColor: t.line }}>
          {st.s === 'loading' && <T v="cap" c="ink3" style={{ paddingVertical: S.l }}>찾는 중이에요…</T>}
          {st.s === 'soon' && <T v="cap" c="ink3" style={{ paddingVertical: S.l }}>지도 검색은 서버 새 판에서 열려요</T>}
          {st.s === 'error' && <T v="cap" c="redText" style={{ paddingVertical: S.l }}>{st.msg}</T>}
          {st.s === 'ok' && !items.length && (
            <T v="cap" c="ink3" style={{ paddingVertical: S.l }}>{st.kakaoOk ? `'${q.trim()}'로 찾은 곳이 없어요` : '지금은 카카오 검색을 못 해요 · 우리 명소만 찾아요'}</T>
          )}
          {items.map((s, i) => (
            <View key={s.id} style={i ? { borderTopWidth: 1, borderTopColor: t.line } : undefined}>
              <Row icon={suggestIcon(s)} tone={s.kind === 'place' ? 'accent' : 'plain'} title={s.name} sub={suggestSub(s)} onPress={() => pick(s)}
                trailing={s.kind === 'place' ? <Pill text="우리 도장" tone="accent" icon="stamp" />
                  : s.kind === 'address' ? <Pill text="이 주소로" tone="neutral" /> : undefined} />
            </View>
          ))}
          {st.s === 'ok' && items.length > 0 && !st.kakaoOk && (
            <T v="cap" c="ink3" style={{ paddingBottom: S.m, fontFamily: F.m }}>카카오 검색을 잠깐 못 해서 우리 명소만 보여요</T>
          )}
        </View>
      )}
    </View>
  );
}
