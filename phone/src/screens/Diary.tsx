// '그날의 기록' — 메달 아래로 내리면 나오는 일기 한 장 (시안 proto/medal-fx/diary-plan.html, 1~3단계: 자동 일기).
// 종이 색은 화면 모드와 상관없이 늘 같다(메달 화면이 늘 어두운 것처럼). 사진·한마디·목소리·카드 공유는 다음 단계.
// - DiaryCard: 날짜·날씨 → 이야기(부모 기록 / 아이 일기, 누르면 고치기) → 숫자 칩 → 작은 길 지도(집은 안 그림) → 하루 흐름
// - DiaryScreen: 일정 탭 '지난 나들이'·알림에서 여는 전체 화면 (그날 도장들을 위에 나란히 + 일기)
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapWeb } from '../MapWeb';
import { legColor, type MapDot, type MapInit, type MapLine } from '../mapEmbed';
import { festivalArt, festivalById, stampArt, useCatalogRev } from '../catalog';
import { ALBUM } from '../places';
import { useSession } from '../session';
import { clock, useTimeFmt } from '../timefmt';
import { F } from '../theme';
import { durText, useDiary, type DiaryFacts, type Tone } from '../diary';
import { Icon, MAX_W, tap, tick, type IconName } from '../ui';

// 종이 색 (시안 그대로)
const P = {
  paper: '#F7F3EA', ink: '#2A2823', ink2: '#4A463D', ink3: '#7A7568', line: 'rgba(120,100,60,0.10)',
  chip: '#FFFFFF', chipLine: '#EBE5D6', gold: '#C9A65A', mark: 'rgba(240,200,110,0.45)', soft: '#EFE8D8',
};
/** 이 폰에서 마지막으로 고른 말투 (앱이 켜진 동안) */
let lastTone: Tone = 'parent';

const STORY_LINE = 30;

/** 메달 화면 아래 · 일정 탭에서 같이 쓰는 일기 한 장. top = 위 모서리를 둥글게(메달 화면 아래에 붙을 때) */
export function DiaryCard({ day, style, bottomPad = 26, footer }: { day: string; style?: object; bottomPad?: number; footer?: React.ReactNode }) {
  const { token } = useSession();
  useTimeFmt();
  const d = useDiary(token, day);
  const [tone, setTone] = useState<Tone>(lastTone);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const pick = (t: Tone) => { tap(); lastTone = t; setTone(t); setEditing(false); };

  const f = d.data?.facts ?? null;
  const story = d.data ? (tone === 'parent' ? d.data.story.parent : d.data.story.child) : null;
  const done = d.data?.done ?? false;

  return (
    <View style={[{ backgroundColor: P.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 22, paddingBottom: bottomPad }, style]}>
      <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center' }}>
        {/* 날짜 · 날씨 */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <Text accessibilityRole="header" style={{ fontFamily: F.xb, fontSize: 19, lineHeight: 26, letterSpacing: -0.3, color: P.ink }}>{f?.dateText ?? dayTitle(day)}</Text>
          {f?.weather && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name={WEATHER_ICON[f.weather.sky]} size={15} color={P.ink3} />
              <Text style={{ fontFamily: F.m, fontSize: 13, color: P.ink3 }}>{f.weather.label}</Text>
            </View>
          )}
        </View>

        {d.unsupported ? (
          <Text style={{ fontFamily: F.m, fontSize: 14, lineHeight: 22, color: P.ink3, marginTop: 12 }}>그날의 기록은 서버를 새로 올리면 보여요</Text>
        ) : !d.data ? (
          d.error ? (
            <Pressable onPress={() => { tick(); d.reload(); }} accessibilityRole="button" style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="refresh-cw" size={15} color={P.ink3} />
              <Text style={{ fontFamily: F.m, fontSize: 14, color: P.ink3 }}>기록을 불러오지 못했어요 · 다시 불러오기</Text>
            </Pressable>
          ) : <ActivityIndicator color={P.ink3} style={{ marginVertical: 24 }} />
        ) : (
          <>
            {/* 말투: 부모 기록 / 아이 일기 */}
            {done && (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }} accessibilityRole="tablist">
                {(['parent', 'child'] as const).map((k) => {
                  const on = tone === k;
                  return (
                    <Pressable key={k} onPress={() => pick(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                      style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: on ? P.ink : 'transparent', borderWidth: 1, borderColor: on ? P.ink : P.chipLine }}>
                      <Text style={{ fontFamily: F.b, fontSize: 13, color: on ? '#fff' : P.ink2 }}>{k === 'parent' ? '부모 기록' : '아이 일기'}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* 이야기 */}
            {!done ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: P.soft, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }}>
                <Icon name="pencil-line" size={17} color={P.ink3} />
                <Text style={{ flex: 1, fontFamily: F.sb, fontSize: 14.5, lineHeight: 21, color: P.ink2 }}>오늘 기록 중… 집에 도착하면 완성돼요</Text>
              </View>
            ) : editing ? (
              <View style={{ marginTop: 10 }}>
                <TextInput value={draft} onChangeText={setDraft} multiline autoFocus maxLength={800} textAlignVertical="top"
                  accessibilityLabel={tone === 'parent' ? '부모 기록 고치기' : '아이 일기 고치기'}
                  style={{ minHeight: STORY_LINE * 4, fontFamily: F.m, fontSize: 15.5, lineHeight: STORY_LINE - 4, color: P.ink, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: P.chipLine, padding: 12 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <SmallBtn label="취소" onPress={() => { tap(); setEditing(false); }} />
                  <SmallBtn label="저장" dark busy={d.busy} onPress={async () => { tick(); if (await d.save(tone, draft)) setEditing(false); }} />
                </View>
              </View>
            ) : (
              <Pressable onPress={() => { if (!story) return; tap(); setDraft(story); setEditing(true); }} accessibilityRole="button" accessibilityHint="눌러서 고칠 수 있어요"
                style={{ marginTop: 10 }}>
                <Lined>
                  <Text style={{ fontFamily: F.m, fontSize: 15.5, lineHeight: STORY_LINE, color: '#2F2C26' }}>{story ?? '이날은 쓸 만한 기록이 없어요'}</Text>
                </Lined>
                {story && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Icon name="pencil" size={13} color={P.ink3} />
                      <Text style={{ fontFamily: F.m, fontSize: 12.5, color: P.ink3 }}>눌러서 고치기</Text>
                    </View>
                    <Pressable onPress={() => { tick(); d.regen(tone); }} disabled={d.busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="이 말투로 다시 쓰기"
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: d.busy ? 0.5 : 1 }}>
                      {d.busy ? <ActivityIndicator size="small" color={P.ink3} /> : <Icon name="refresh-cw" size={13} color={P.ink3} />}
                      <Text style={{ fontFamily: F.m, fontSize: 12.5, color: P.ink3 }}>다시 쓰기</Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            )}
            {!!d.error && <Text style={{ fontFamily: F.m, fontSize: 13, color: '#A33B2B', marginTop: 6 }}>{d.error}</Text>}

            {f && <Chips f={f} />}
            {f && <RouteMap f={f} />}
            {f && <Flow f={f} />}
          </>
        )}
        {footer}
      </View>
    </View>
  );
}

const WEATHER_ICON: Record<'RAIN' | 'SNOW' | 'CLEAR', IconName> = { RAIN: 'cloud-rain', SNOW: 'snowflake', CLEAR: 'sun' };
const WD = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
function dayTitle(day: string) {
  const d = new Date(`${day}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}`;
}

/** 줄 공책 무늬 (글 줄 높이마다 옅은 선) */
function Lined({ children }: { children: React.ReactNode }) {
  const [h, setH] = useState(0);
  const n = Math.floor(h / STORY_LINE);
  return (
    <View onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
        {Array.from({ length: n }, (_, i) => (
          <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: (i + 1) * STORY_LINE - 2, height: 1, backgroundColor: P.line }} />
        ))}
      </View>
      {children}
    </View>
  );
}

function SmallBtn({ label, onPress, dark, busy }: { label: string; onPress: () => void; dark?: boolean; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button"
      style={({ pressed }) => ({ height: 38, minWidth: 64, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        backgroundColor: dark ? P.ink : '#fff', borderWidth: dark ? 0 : 1, borderColor: P.chipLine, opacity: pressed || busy ? 0.7 : 1 })}>
      {busy ? <ActivityIndicator size="small" color={dark ? '#fff' : P.ink} /> : <Text style={{ fontFamily: F.b, fontSize: 14, color: dark ? '#fff' : P.ink }}>{label}</Text>}
    </Pressable>
  );
}

/** 숫자 칩: 거리·운전 · 들른 곳 · 도장 · 낮잠 · 귀가 */
function Chips({ f }: { f: DiaryFacts }) {
  const items: { icon: IconName; text: string }[] = [];
  if (f.drive) {
    const bits = [f.drive.km != null ? `${f.drive.km}km` : '', f.drive.min != null ? `${f.drive.approx ? '약 ' : ''}${durText(f.drive.min)}` : ''].filter(Boolean);
    if (bits.length) items.push({ icon: 'car', text: bits.join(' · ') });
  }
  if (f.stops.length) items.push({ icon: 'map-pin', text: `${f.stops.length}곳` });
  if (f.stamps.length) items.push({ icon: 'stamp', text: `도장 ${f.stamps.length}개` });
  if (f.nap) items.push({ icon: 'moon', text: `차에서 낮잠 ${durText(f.nap.min)}` });
  if (f.homeMin != null) items.push({ icon: 'house', text: `${clock(f.homeMin)} 귀가` });
  if (!items.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
      {items.map((x) => (
        <View key={x.icon} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: P.chip, borderWidth: 1, borderColor: P.chipLine, borderRadius: 99, paddingHorizontal: 10, height: 30 }}>
          <Icon name={x.icon} size={14} color={P.ink2} />
          <Text style={{ fontFamily: F.sb, fontSize: 13, color: P.ink2 }}>{x.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** 작은 길 지도: 그날 들른 곳만 순서대로 (집은 그리지 않음 — 집 근처를 드러내지 않게). 만지지 않음 */
function RouteMap({ f }: { f: DiaryFacts }) {
  const pts = f.stops.filter((s) => s.lat != null && s.lng != null);
  const init = useMemo<MapInit | null>(() => {
    if (!pts.length) return null;
    const dots: MapDot[] = pts.map((s, i) => ({ id: `${s.placeId}:${i}`, lat: s.lat!, lng: s.lng!, c: 'g', label: String(i + 1) }));
    const polylines: MapLine[] = pts.slice(1).map((s, i) => ({
      points: [[pts[i].lat!, pts[i].lng!], [s.lat!, s.lng!]], style: 'go', leg: i + 1,
    }));
    return { mode: 'route', theme: 'light', dots, polylines, home: null, compact: true };
  }, [pts.map((s) => `${s.placeId}${s.lat}${s.lng}`).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!init) return null;
  return (
    <View style={{ height: 130, borderRadius: 16, overflow: 'hidden', marginTop: 14, backgroundColor: '#E8E4D8' }}
      accessible accessibilityLabel={`그날 들른 곳 지도: ${pts.map((s) => s.name).join(', ')}`}>
      <View pointerEvents="none" style={{ flex: 1 }}><MapWeb init={init} /></View>
    </View>
  );
}

/** 하루 흐름: 시각마다 한 줄 */
function Flow({ f }: { f: DiaryFacts }) {
  const rows: { key: string; time: string; text: string; color: string }[] = [];
  const grey = '#9A958A';
  if (f.depart) rows.push({ key: 'out', time: `${f.depart.approx ? '약 ' : ''}${clock(f.depart.min)}`, text: `집에서 출발${f.weather ? ` · ${f.weather.label}` : ''}`, color: grey });
  f.stops.forEach((s, i) => {
    const st = f.stamps.filter((x) => s.stamps.includes(x.id));
    const stamp = st.length ? (st.some((x) => x.festivalId) ? '축제 도장' : st.some((x) => x.rare) ? '희귀 도장' : '도장') : '';
    rows.push({
      key: `${s.placeId}:${i}`, time: s.arriveMin != null ? clock(s.arriveMin) : '',
      text: [s.name, s.stayMin != null ? durText(s.stayMin) : '', stamp].filter(Boolean).join(' · '),
      color: legColor(i, false),
    });
  });
  if (f.nap) rows.push({ key: 'nap', time: f.nap.fromMin != null ? clock(f.nap.fromMin) : '', text: `돌아오는 길 · 차에서 낮잠 ${durText(f.nap.min)}`, color: legColor(0, true) });
  if (f.homeMin != null) rows.push({ key: 'home', time: clock(f.homeMin), text: '집 도착', color: grey });
  if (!rows.length) return null;
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontFamily: F.b, fontSize: 12.5, color: '#9A8F72', letterSpacing: 0.6 }}>하루 흐름</Text>
      <View style={{ marginTop: 6 }}>
        {rows.map((r) => (
          <View key={r.key} style={{ flexDirection: 'row', gap: 10, paddingVertical: 6 }}>
            <Text numberOfLines={1} style={{ width: 74, fontFamily: F.m, fontSize: 13, lineHeight: 20, color: '#8A8475', fontVariant: ['tabular-nums'] }}>{r.time}</Text>
            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: r.color }} />
            <Text style={{ flex: 1, fontFamily: F.m, fontSize: 13.5, lineHeight: 20, color: '#3A372F' }}>{r.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 그날 도장 그림 (도장북 칸 key 또는 축제) */
function medalArt(key: string) {
  if (ALBUM.some((a) => a.key === key)) return stampArt(key);
  const fest = festivalById(key);
  return festivalArt(fest ?? { id: key, placeId: null });
}

/**
 * 일정 탭 '지난 나들이'·일기 완성 알림에서 여는 전체 화면: 그날 받은 도장을 위에 나란히 + 일기.
 * 도장을 누르면 onMedal(key, stampId)로 메달 화면(같은 일기가 아래에 붙음)을 열 수 있다.
 */
export function DiaryScreen({ day, onClose }: { day: string | null; onClose: () => void }) {
  return (
    <Modal visible={!!day} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {day && <DiaryScreenBody day={day} onClose={onClose} />}
    </Modal>
  );
}

function DiaryScreenBody({ day, onClose }: { day: string; onClose: () => void }) {
  useCatalogRev();
  const ins = useSafeAreaInsets();
  const { token } = useSession();
  const d = useDiary(token, day); // 같은 날을 카드도 부르지만 앱 메모리를 같이 씀
  const stamps = d.data?.facts.stamps ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: '#0D1110' }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: ins.top + 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 52 }}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="닫기"
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <Icon name="x" size={20} color="#fff" />
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', marginRight: 44, fontFamily: F.b, fontSize: 16, color: '#fff' }}>그날의 기록</Text>
        </View>
        {/* 그날 도장 (같은 날 여럿이면 일기는 하나, 메달은 나란히) */}
        {stamps.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: 20, paddingVertical: 18, flexGrow: 1, justifyContent: 'center' }}>
            {stamps.map((s) => (
              <View key={s.id} style={{ alignItems: 'center', width: 84 }} accessible accessibilityLabel={`${s.name} ${s.festivalId ? '축제 도장' : s.rare ? '희귀 도장' : '도장'}`}>
                <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', borderWidth: 2, borderColor: s.festivalId ? '#d4b46c' : s.rare ? '#e3c178' : '#c9d0d4' }}>
                  <Image source={medalArt(s.key)} style={{ width: 92, height: 92, marginLeft: -12, marginTop: -12 }} />
                </View>
                <Text numberOfLines={1} style={{ marginTop: 6, fontFamily: F.sb, fontSize: 12.5, color: 'rgba(255,255,255,0.82)' }}>{s.name}</Text>
              </View>
            ))}
          </ScrollView>
        )}
        <View style={{ flex: 1, marginTop: stamps.length ? 0 : 12 }}>
          <DiaryCard day={day} style={{ flexGrow: 1 }} bottomPad={ins.bottom + 32} />
        </View>
      </ScrollView>
    </View>
  );
}
