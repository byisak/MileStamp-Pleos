import introData from "./intro-data.json";

// 차 엔진·서버 places 표(web/db/places.seed.json, 34곳 모두 도장)와 같은 장소 ID. 좌표는 폰에 필요 없어 두지 않는다.
export type Mission = {
  quiz: { q: string; options: string[]; answer: number };
  find: string; // 현장에서 찾아보기 (사진은 다음 단계)
};

/** mission: 미션(퀴즈·찾아보기)이 있는 곳만 (지금은 처음 6곳). 폰 앱 phone/src/places.ts와 같이 맞춘다. */
export type PlaceInfo = { id: string; name: string; emoji: string; mission?: Mission };

export const PLACES: Record<string, PlaceInfo> = {
  seokgul: {
    id: "seokgul",
    name: "군위 삼존석굴",
    emoji: "🪨",
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
    emoji: "🐉",
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
    emoji: "🔭",
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
    emoji: "🐟",
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
    emoji: "🚂",
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
    emoji: "🎭",
    mission: {
      quiz: {
        q: "'하회'라는 이름은 왜 붙었을까요?",
        options: ["강물이 마을을 휘돌아 흘러서", "탈이 많아서", "산이 높아서"],
        answer: 0,
      },
      find: "웃는 얼굴 하회탈 찾기",
    },
  },
  // 10/26 새 도장 27종 + 동화사 — 미션은 아직 없음
  donghwa: { id: "donghwa", name: "팔공산 동화사", emoji: "🛕" },
  aquarium: { id: "aquarium", name: "대구아쿠아리움", emoji: "🐠" },
  naturepark: { id: "naturepark", name: "네이처파크", emoji: "🐰" },
  eworld: { id: "eworld", name: "이월드", emoji: "🎡" },
  suppia: { id: "suppia", name: "가산수피아", emoji: "🌲" },
  daegaya: { id: "daegaya", name: "대가야박물관", emoji: "👑" },
  songhae: { id: "songhae", name: "옥연지 송해공원", emoji: "🌬️" },
  arboretum: { id: "arboretum", name: "대구수목원", emoji: "🌱" },
  honeybee: { id: "honeybee", name: "꿀벌나라테마공원", emoji: "🐝" },
  cablecar: { id: "cablecar", name: "팔공산 케이블카", emoji: "🚡" },
  kidsworld: { id: "kidsworld", name: "대구어린이세상", emoji: "🧸" },
  nmd: { id: "nmd", name: "국립대구박물관", emoji: "🏛️" },
  weather: { id: "weather", name: "국립대구기상과학관", emoji: "⛅" },
  safety: { id: "safety", name: "대구시민안전테마파크", emoji: "🚒" },
  eduseum: { id: "eduseum", name: "대구광역시교육청교육역사관", emoji: "🏫" },
  bangjja: { id: "bangjja", name: "대구방짜유기박물관", emoji: "🥣" },
  gumisci: { id: "gumisci", name: "구미과학관", emoji: "🪐" },
  unamji: { id: "unamji", name: "운암지 수변공원", emoji: "🦆" },
  hajungdo: { id: "hajungdo", name: "금호강 하중도", emoji: "🌼" },
  chimsan: { id: "chimsan", name: "침산공원", emoji: "🌇" },
  dalseong: { id: "dalseong", name: "달성공원", emoji: "🐾" },
  aayang: { id: "aayang", name: "아양기찻길", emoji: "🛤️" },
  duryu: { id: "duryu", name: "두류공원", emoji: "🌳" },
  samsung: { id: "samsung", name: "대구삼성창조캠퍼스", emoji: "🏭" },
  hanbam: { id: "hanbam", name: "한밤마을 돌담길", emoji: "🧱" },
  bullo: { id: "bullo", name: "대구 불로동 고분군", emoji: "⛰️" },
  samunjin: { id: "samunjin", name: "사문진나루터", emoji: "⛴️" },
  suseongmot: { id: "suseongmot", name: "수성못", emoji: "⛵" },
};

export function place(id: string | null | undefined): PlaceInfo | null {
  return id ? (PLACES[id] ?? null) : null;
}

export type Clip = { src: string; text: string; duration: number; starts: number[] };

export function clip(placeId: string, variant: string): Clip | null {
  const key = `${placeId}_${variant.toLowerCase()}`;
  return (introData.clips as Record<string, Clip>)[key] ?? null;
}

/** 차의 재생 위치(ms)에서 끊긴 문장의 시작(초). */
export function resumeAt(c: Clip, positionMs: number): number {
  const pos = positionMs / 1000;
  let at = c.starts[0] ?? 0;
  for (const s of c.starts) if (s <= pos) at = s;
  return at;
}
