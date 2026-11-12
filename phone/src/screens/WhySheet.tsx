// 'ⓘ 왜?' 시트 — 추천 카드의 장소 하나가 왜 들어갔는지 쉬운 말 몇 줄 (서버가 엔진 explainChoice로 만든 줄 그대로, AI 문장 아님).
// 줄마다 이유 칩과 같은 색 아이콘(공용 Row). 글 속 시각은 12/24시간 설정대로. 맨 아래 '즐겨찾는 곳' 켜기·끄기(다음 추천부터 점수 +1).
// 계획: docs/직접-고르기-계획.md 5절
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { getFavPlaces, reasonIcon, setFavPlace, type Stop, type StopWhy, type WhyLine } from '../plan';
import { useSession } from '../session';
import { clockText } from '../timefmt';
import { R, S } from '../theme';
import { Btn, IconName, Sheet, T, useTheme } from '../ui';
import { Row } from '../parts';
import { toneOf } from './PlanBits';

/** 줄 아이콘: 이유 칩 규칙(reasonIcon) → 없으면 글로 고른다 */
function lineIcon(l: WhyLine): IconName {
  const r = reasonIcon({ text: l.text, tone: l.tone });
  if (r) return r;
  if (/아이/.test(l.text)) return 'baby';
  if (/분 놀아요|기다려요/.test(l.text)) return 'clock';
  if (/다녀/.test(l.text)) return 'map-pin';
  if (/즐겨찾/.test(l.text)) return 'heart';
  if (/처음/.test(l.text)) return 'flag';
  if (/에서 \d+분/.test(l.text)) return 'route';
  return 'circle-check';
}

export function WhySheet({ stop, why, onClose }: { stop: Stop | null; why: StopWhy | null; onClose: () => void }) {
  const t = useTheme();
  const { token } = useSession();
  const [fav, setFav] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const id = stop?.id;
  useEffect(() => {
    setFav(null);
    if (!token || !id) return;
    let alive = true;
    getFavPlaces(token).then((r) => { if (alive) setFav(r.placeIds.includes(id)); }).catch(() => {});
    return () => { alive = false; };
  }, [token, id]);
  const toggle = async () => {
    if (!token || !id || fav == null) return;
    setBusy(true);
    try { setFav((await setFavPlace(token, id, !fav)).placeIds.includes(id)); } catch { /* 예전 서버: 그대로 */ } finally { setBusy(false); }
  };
  return (
    <Sheet open={!!stop} onClose={onClose}>
      <T v="title" accessibilityRole="header">왜 {stop?.name}?</T>
      <T v="sub" c="ink3" style={{ marginTop: S.xxs }}>점수에 들어간 것을 그대로 옮겼어요</T>
      <View style={{ marginTop: S.l, backgroundColor: t.fill, borderRadius: R.md + 2, paddingHorizontal: S.l + 2 }}>
        {(why?.lines ?? []).map((l, i) => (
          <View key={l.text} style={i ? { borderTopWidth: 1, borderTopColor: t.line } : undefined}>
            <Row icon={lineIcon(l)} tone={toneOf(l.tone)} title={clockText(l.text)} lines={2} />
          </View>
        ))}
        {!why?.lines.length && <Row icon="circle-alert" tone="surface" title="이 카드는 설명이 아직 없어요" sub="추천을 새로 받으면 보여요" />}
      </View>
      {fav != null && (
        <View style={{ marginTop: S.m, backgroundColor: t.fill, borderRadius: R.md + 2, paddingHorizontal: S.l + 2 }}>
          <Row icon="heart" tone={fav ? 'accent' : 'surface'} title={fav ? '즐겨찾는 곳이에요' : '즐겨찾는 곳으로'} sub={fav ? '누르면 뺄게요' : '다음 추천부터 조금 더 자주 나와요'}
            trailing={fav ? 'check' : undefined} disabled={busy} onPress={toggle} />
        </View>
      )}
      <Btn title="닫기" kind="soft" onPress={onClose} style={{ marginTop: S.l }} />
    </Sheet>
  );
}
