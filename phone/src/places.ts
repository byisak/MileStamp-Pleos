// 장소 이름·아이콘·미션 — 서버 web/src/lib/places.ts 와 같은 내용 (차 엔진 SeedPlaces.kt와 같은 ID). 아이콘은 Lucide (서버는 이모지)
import { CLIPS, Clip } from './clips';
import type { IconName } from './icon';

export type Mission = {
  quiz: { q: string; options: string[]; answer: number };
  find: string; // 현장에서 찾아보기 (사진은 다음 단계)
};

/** mission: 미션(퀴즈·찾아보기)이 있는 곳만 (지금은 처음 6곳). 서버 web/src/lib/places.ts와 같이 맞춘다 */
export type PlaceInfo = { id: string; name: string; icon: IconName; mission?: Mission };

export const PLACES: Record<string, PlaceInfo> = {
  seokgul: {
    id: "seokgul",
    name: "군위 삼존석굴",
    icon: "mountain",
    mission: {
      quiz: {
        q: "가운데 부처님 양옆에 서 계신 두 분은 누구일까요?",
        options: ["보살님 두 분", "해님과 달님", "장군 두 명"],
        answer: 0,
      },
      find: "석굴 안 부처님이 모두 몇 분인지 세어 보기",
    },
  },
  samguk: {
    id: "samguk",
    name: "삼국유사테마파크",
    icon: "castle",
    mission: {
      quiz: {
        q: "옛이야기 책 '삼국유사'를 쓴 스님은 누구일까요?",
        options: ["원효 스님", "일연 스님", "의상 스님"],
        answer: 1,
      },
      find: "해룡 미끄럼틀에서 용의 머리 찾기",
    },
  },
  dgsm: {
    id: "dgsm",
    name: "국립대구과학관",
    icon: "telescope",
    mission: {
      quiz: {
        q: "둥근 천장에 별이 가득 뜨는 곳의 이름은?",
        options: ["수족관", "천체투영관", "도서관"],
        answer: 1,
      },
      find: "디지털로 되살린 성덕대왕신종 찾기",
    },
  },
  thearc: {
    id: "thearc",
    name: "디아크",
    icon: "waves",
    mission: {
      quiz: {
        q: "디아크 앞에서 만나는 두 강은?",
        options: ["한강과 임진강", "낙동강과 금호강", "섬진강과 영산강"],
        answer: 1,
      },
      find: "물고기를 닮은 은빛 건물의 '꼬리' 찾기",
    },
  },
  hwabon: {
    id: "hwabon",
    name: "화본역",
    icon: "train-front",
    mission: {
      quiz: {
        q: "역 옆의 높은 탑은 옛날에 무엇을 하던 곳일까요?",
        options: ["증기기관차에 물 주기", "종 치기", "배 불 밝히기"],
        answer: 0,
      },
      find: "역 이름이 적힌 간판 앞에서 가족 모두 모이기",
    },
  },
  hahoe: {
    id: "hahoe",
    name: "안동 하회마을",
    icon: "drama",
    mission: {
      quiz: {
        q: "'하회'라는 이름은 왜 붙었을까요?",
        options: ["강물이 마을을 휘돌아 흘러서", "탈이 많아서", "산이 높아서"],
        answer: 0,
      },
      find: "웃는 얼굴 하회탈 찾기",
    },
  },
  // 새 도장 27곳 (tools/places/candidates.json, 그림 design/stamps/chatgpt-sheet-A~D) — 미션은 아직 없음
  weather: { id: "weather", name: "국립대구기상과학관", icon: "cloud-sun" },
  eduseum: { id: "eduseum", name: "교육역사관", icon: "school" },
  unamji: { id: "unamji", name: "운암지 수변공원", icon: "bird" },
  hajungdo: { id: "hajungdo", name: "금호꽃섬(하중도)", icon: "flower" },
  chimsan: { id: "chimsan", name: "침산공원", icon: "sunset" },
  dalseong: { id: "dalseong", name: "달성공원", icon: "paw-print" },
  aayang: { id: "aayang", name: "아양기찻길", icon: "train-track" },
  duryu: { id: "duryu", name: "두류공원", icon: "trees" },
  samsung: { id: "samsung", name: "대구삼성창조캠퍼스", icon: "factory" },
  hanbam: { id: "hanbam", name: "한밤마을 돌담길", icon: "fence" },
  bullo: { id: "bullo", name: "대구 불로동 고분군", icon: "tree-deciduous" },
  samunjin: { id: "samunjin", name: "사문진나루터", icon: "ship" },
  suseongmot: { id: "suseongmot", name: "수성못", icon: "sailboat" },
  aquarium: { id: "aquarium", name: "대구아쿠아리움", icon: "fish" },
  kidsworld: { id: "kidsworld", name: "대구어린이세상", icon: "traffic-cone" },
  nmd: { id: "nmd", name: "국립대구박물관", icon: "landmark" },
  safety: { id: "safety", name: "대구시민안전테마파크", icon: "siren" },
  bangjja: { id: "bangjja", name: "대구방짜유기박물관", icon: "soup" },
  gumisci: { id: "gumisci", name: "구미과학관", icon: "orbit" },
  daegaya: { id: "daegaya", name: "대가야박물관", icon: "crown" },
  naturepark: { id: "naturepark", name: "네이처파크", icon: "rabbit" },
  eworld: { id: "eworld", name: "이월드", icon: "ferris-wheel" },
  suppia: { id: "suppia", name: "가산수피아", icon: "tree-pine" },
  songhae: { id: "songhae", name: "옥연지 송해공원", icon: "wind" },
  arboretum: { id: "arboretum", name: "대구수목원", icon: "sprout" },
  honeybee: { id: "honeybee", name: "꿀벌나라테마공원", icon: "hexagon" },
  cablecar: { id: "cablecar", name: "팔공산 케이블카", icon: "cable-car" },
};

export function place(id: string | null | undefined): PlaceInfo | null {
  return id ? (PLACES[id] ?? null) : null;
}

export function clipFor(placeId: string, variant?: string): Clip | null {
  const v = (variant || 'FULL_60S') === 'PHONE_ONLY' ? 'full_60s' : (variant || 'FULL_60S').toLowerCase();
  return CLIPS[`${placeId}_${v}`] ?? CLIPS[`${placeId}_full_60s`] ?? null;
}

/** 차의 재생 위치(ms)가 속한 문장의 시작(초) */
export function resumeAt(c: Clip, positionMs: number): number {
  const pos = positionMs / 1000;
  let at = c.starts[0] ?? 0;
  for (const s of c.starts) if (s <= pos) at = s;
  return at;
}

/** 도장북 묶음 (차례대로 보여 준다). 시즌 1 = 처음 6곳 + 희귀 '비 오는 날 디아크' */
export const ALBUM_SECTIONS: { key: string; title: string }[] = [
  { key: 'season1', title: '대구·경북 시즌 1' },
  { key: 'town', title: '우리 동네 평일 오후' },
  { key: 'home', title: '귀갓길 잠깐' },
  { key: 'rain', title: '비 오는 날' },
  { key: 'weekend', title: '주말 나들이' },
];

/** 조건 도장 '밤' (엔진 RareStamp.NIGHT) — 해 진 뒤 밤 명소에 주차하면 */
export const RARE_NIGHT = '밤';

/**
 * 도장 → 도장북 칸: 비 오는 날 디아크 = 'thearc_rain' · 밤의 ○○ = '<id>_night'(칸이 있을 때) · 그 밖 = 장소 칸
 * (차 StampAlbum.keyOf · 서버 arrive.ts albumKeyOf와 같음)
 */
export function albumKeyOf(placeId: string, rare: unknown): string {
  if (rare === RARE_NIGHT) return ALBUM.some((a) => a.key === `${placeId}_night`) ? `${placeId}_night` : placeId;
  return placeId === 'thearc' && rare ? 'thearc_rain' : placeId;
}

/** 도장북 칸 (section = ALBUM_SECTIONS의 key) */
export const ALBUM: { key: string; placeId: string; label: string; section: string; rare?: string }[] = [
  { key: 'seokgul', placeId: 'seokgul', label: '군위 삼존석굴', section: 'season1' },
  { key: 'samguk', placeId: 'samguk', label: '삼국유사테마파크', section: 'season1' },
  { key: 'dgsm', placeId: 'dgsm', label: '국립대구과학관', section: 'season1' },
  { key: 'thearc', placeId: 'thearc', label: '디아크', section: 'season1' },
  { key: 'hwabon', placeId: 'hwabon', label: '화본역', section: 'season1' },
  { key: 'hahoe', placeId: 'hahoe', label: '안동 하회마을', section: 'season1' },
  { key: 'thearc_rain', placeId: 'thearc', label: '비 오는 날 디아크', section: 'season1', rare: '비 오는 날' },
  { key: 'weather', placeId: 'weather', label: '기상과학관', section: 'town' },
  { key: 'eduseum', placeId: 'eduseum', label: '교육역사관', section: 'town' },
  { key: 'unamji', placeId: 'unamji', label: '운암지', section: 'town' },
  { key: 'hajungdo', placeId: 'hajungdo', label: '금호꽃섬', section: 'town' },
  { key: 'chimsan', placeId: 'chimsan', label: '침산공원', section: 'town' },
  { key: 'chimsan_night', placeId: 'chimsan', label: '밤의 침산공원', section: 'town', rare: '밤' },
  { key: 'dalseong', placeId: 'dalseong', label: '달성공원', section: 'town' },
  { key: 'aayang', placeId: 'aayang', label: '아양기찻길', section: 'town' },
  { key: 'duryu', placeId: 'duryu', label: '두류공원', section: 'town' },
  { key: 'samsung', placeId: 'samsung', label: '삼성창조캠퍼스', section: 'town' },
  { key: 'hanbam', placeId: 'hanbam', label: '한밤마을 돌담길', section: 'home' },
  { key: 'bullo', placeId: 'bullo', label: '불로동 고분군', section: 'home' },
  { key: 'samunjin', placeId: 'samunjin', label: '사문진나루터', section: 'home' },
  { key: 'suseongmot', placeId: 'suseongmot', label: '수성못', section: 'home' },
  { key: 'suseongmot_night', placeId: 'suseongmot', label: '밤의 수성못', section: 'home', rare: '밤' },
  { key: 'aquarium', placeId: 'aquarium', label: '대구아쿠아리움', section: 'rain' },
  { key: 'kidsworld', placeId: 'kidsworld', label: '어린이세상', section: 'rain' },
  { key: 'nmd', placeId: 'nmd', label: '국립대구박물관', section: 'rain' },
  { key: 'safety', placeId: 'safety', label: '시민안전테마파크', section: 'rain' },
  { key: 'bangjja', placeId: 'bangjja', label: '방짜유기박물관', section: 'rain' },
  { key: 'gumisci', placeId: 'gumisci', label: '구미과학관', section: 'rain' },
  { key: 'daegaya', placeId: 'daegaya', label: '대가야박물관', section: 'rain' },
  { key: 'naturepark', placeId: 'naturepark', label: '네이처파크', section: 'weekend' },
  { key: 'eworld', placeId: 'eworld', label: '이월드', section: 'weekend' },
  { key: 'eworld_night', placeId: 'eworld', label: '밤의 이월드', section: 'weekend', rare: '밤' },
  { key: 'suppia', placeId: 'suppia', label: '가산수피아', section: 'weekend' },
  { key: 'songhae', placeId: 'songhae', label: '송해공원', section: 'weekend' },
  { key: 'arboretum', placeId: 'arboretum', label: '대구수목원', section: 'weekend' },
  { key: 'honeybee', placeId: 'honeybee', label: '꿀벌나라', section: 'weekend' },
  { key: 'cablecar', placeId: 'cablecar', label: '팔공산 케이블카', section: 'weekend' },
];

export const STAMP_ART_BW: Record<string, number> = {
  seokgul: require('../assets/stamps/seokgul_bw.webp'),
  samguk: require('../assets/stamps/samguk_bw.webp'),
  dgsm: require('../assets/stamps/dgsm_bw.webp'),
  thearc: require('../assets/stamps/thearc_bw.webp'),
  thearc_rain: require('../assets/stamps/thearc_rain_bw.webp'),
  hwabon: require('../assets/stamps/hwabon_bw.webp'),
  hahoe: require('../assets/stamps/hahoe_bw.webp'),
  weather: require('../assets/stamps/weather_bw.webp'),
  eduseum: require('../assets/stamps/eduseum_bw.webp'),
  unamji: require('../assets/stamps/unamji_bw.webp'),
  hajungdo: require('../assets/stamps/hajungdo_bw.webp'),
  chimsan: require('../assets/stamps/chimsan_bw.webp'),
  dalseong: require('../assets/stamps/dalseong_bw.webp'),
  aayang: require('../assets/stamps/aayang_bw.webp'),
  duryu: require('../assets/stamps/duryu_bw.webp'),
  samsung: require('../assets/stamps/samsung_bw.webp'),
  hanbam: require('../assets/stamps/hanbam_bw.webp'),
  bullo: require('../assets/stamps/bullo_bw.webp'),
  samunjin: require('../assets/stamps/samunjin_bw.webp'),
  suseongmot: require('../assets/stamps/suseongmot_bw.webp'),
  aquarium: require('../assets/stamps/aquarium_bw.webp'),
  kidsworld: require('../assets/stamps/kidsworld_bw.webp'),
  nmd: require('../assets/stamps/nmd_bw.webp'),
  safety: require('../assets/stamps/safety_bw.webp'),
  bangjja: require('../assets/stamps/bangjja_bw.webp'),
  gumisci: require('../assets/stamps/gumisci_bw.webp'),
  daegaya: require('../assets/stamps/daegaya_bw.webp'),
  naturepark: require('../assets/stamps/naturepark_bw.webp'),
  eworld: require('../assets/stamps/eworld_bw.webp'),
  suppia: require('../assets/stamps/suppia_bw.webp'),
  songhae: require('../assets/stamps/songhae_bw.webp'),
  arboretum: require('../assets/stamps/arboretum_bw.webp'),
  honeybee: require('../assets/stamps/honeybee_bw.webp'),
  cablecar: require('../assets/stamps/cablecar_bw.webp'),
};

export const STAMP_ART: Record<string, number> = {
  seokgul: require('../assets/stamps/seokgul.webp'),
  samguk: require('../assets/stamps/samguk.webp'),
  dgsm: require('../assets/stamps/dgsm.webp'),
  thearc: require('../assets/stamps/thearc.webp'),
  thearc_rain: require('../assets/stamps/thearc_rain.webp'),
  hwabon: require('../assets/stamps/hwabon.webp'),
  hahoe: require('../assets/stamps/hahoe.webp'),
  weather: require('../assets/stamps/weather.webp'),
  eduseum: require('../assets/stamps/eduseum.webp'),
  unamji: require('../assets/stamps/unamji.webp'),
  hajungdo: require('../assets/stamps/hajungdo.webp'),
  chimsan: require('../assets/stamps/chimsan.webp'),
  dalseong: require('../assets/stamps/dalseong.webp'),
  aayang: require('../assets/stamps/aayang.webp'),
  duryu: require('../assets/stamps/duryu.webp'),
  samsung: require('../assets/stamps/samsung.webp'),
  hanbam: require('../assets/stamps/hanbam.webp'),
  bullo: require('../assets/stamps/bullo.webp'),
  samunjin: require('../assets/stamps/samunjin.webp'),
  suseongmot: require('../assets/stamps/suseongmot.webp'),
  aquarium: require('../assets/stamps/aquarium.webp'),
  kidsworld: require('../assets/stamps/kidsworld.webp'),
  nmd: require('../assets/stamps/nmd.webp'),
  safety: require('../assets/stamps/safety.webp'),
  bangjja: require('../assets/stamps/bangjja.webp'),
  gumisci: require('../assets/stamps/gumisci.webp'),
  daegaya: require('../assets/stamps/daegaya.webp'),
  naturepark: require('../assets/stamps/naturepark.webp'),
  eworld: require('../assets/stamps/eworld.webp'),
  suppia: require('../assets/stamps/suppia.webp'),
  songhae: require('../assets/stamps/songhae.webp'),
  arboretum: require('../assets/stamps/arboretum.webp'),
  honeybee: require('../assets/stamps/honeybee.webp'),
  cablecar: require('../assets/stamps/cablecar.webp'),
};
