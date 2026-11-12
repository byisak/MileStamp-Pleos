// 장소 사진 칸 (UX B2) — 결과 카드 위 큰 사진(높이 140) · 목록 줄 앞 작은 사진(52).
// 자리 크기를 먼저 잡아 두고(빈 칸 색) 그림이 오면 그 위에 그린다 → 늦게 와도 화면이 밀리지 않음.
// 사진 주소(https)가 없거나 못 받으면: 우리 명소는 도장 그림(가운데, 잘리지 않게), 축제는 한정 도장, 그 밖은 아이콘.
import { useEffect, useState } from 'react';
import { Image, type ImageSourcePropType, StyleProp, View, ViewStyle } from 'react-native';
import { ALBUM } from '../places';
import { festivalArt, festivalById, stampArt } from '../catalog';
import { Icon, IconName } from '../icon';
import { R, useTheme } from '../theme';

/** 우리 명소·축제의 도장 그림 (없으면 null) */
export function stampFor(id: string | null | undefined): ImageSourcePropType | null {
  if (!id) return null;
  const f = festivalById(id);
  if (f) return festivalArt(f);
  const a = ALBUM.find((x) => x.placeId === id && !x.rare);
  return a ? stampArt(a.key) : null;
}

const https = (u: string | null | undefined) => (u && /^https?:\/\//.test(u) ? u.replace(/^http:\/\//, 'https://') : null);

export function PlacePhoto({ uri, id, w, h, r = R.md, icon = 'map-pin', wait, style }: {
  /** 사진 주소 (포스터·TourAPI 그림·관리자 배경) */
  uri?: string | null;
  /** 장소 id — 사진이 없을 때 도장 그림 */
  id?: string | null;
  w?: number; h: number; r?: number; icon?: IconName;
  /** 사진 주소를 아직 기다리는 중이면 true (그동안 도장 그림으로 바꾸지 않아 깜빡임 없음) */
  wait?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const url = https(uri);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setFailed(false); setLoaded(false); }, [url]);
  const stamp = stampFor(id);
  const photo = url && !failed;
  const small = h < 80;
  return (
    <View style={[{ width: w ?? '100%', height: h, borderRadius: r, overflow: 'hidden', backgroundColor: t.fill, alignItems: 'center', justifyContent: 'center' }, style]}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {photo ? (
        <>
          {!loaded && <Icon name="images" size={small ? 18 : 26} color={t.ink4} />}
          {/* 작은 칸(목록 줄)은 안드로이드가 큰 포스터를 칸 크기로 줄여서 풀게(resize) — 큰 그림 수십 장을 원본 크기로 풀면 스크롤이 버벅임 */}
          <Image source={{ uri: url! }} resizeMode="cover" resizeMethod={small ? 'resize' : 'auto'} fadeDuration={small ? 0 : 150}
            onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        </>
      ) : wait ? null : stamp ? (
        <Image source={stamp} resizeMode="contain" fadeDuration={0} style={{ width: small ? h - 6 : h - 20, height: small ? h - 6 : h - 20 }} />
      ) : (
        <Icon name={icon} size={small ? 20 : 28} color={t.ink3} />
      )}
    </View>
  );
}
