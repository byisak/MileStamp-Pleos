/*
 * AI 도장 그림 프롬프트 (docs/AI-도장-계획.md · docs/도장-그림-프롬프트.md).
 * 명소·축제 → 장면 문장(한·영) + 원 하나짜리 공통 스타일 + 지금까지 다시 그리며 배운 금지 목록.
 * 관리자는 장면 문장만 고친다 (스타일·금지 목록은 여기서만). 서버·관리자 화면이 같이 쓰는 순수 함수.
 */
import visuals from "./stamp-visuals.json";

/** 조사 묘사 (tools/places/candidates.json의 visualKo/visualEn — 바뀌면 stamp-visuals.json 다시 뽑기). */
export const VISUALS = visuals as Record<string, { ko: string; en: string }>;

export type PromptPlace = { id: string; name: string; region?: string | null; tags?: string[]; indoor?: boolean };
export type PromptFestival = {
  id: string; name: string; season?: string | null; starts?: string | null; indoor?: boolean;
  /** 붙은 명소 (있으면 그 명소 묘사 위에 축제 장식) */
  place?: PromptPlace | null;
};
export type PromptTarget = { kind: "place"; place: PromptPlace } | { kind: "festival"; festival: PromptFestival };

/** 잉크 초록 (stampcraft INK와 같은 값, 대문자). */
export const RING_INK = "#2C4A3E";

/** 배운 금지 사항 — 다시 그린 도장(시트 E·F)에서 나온 것. 한 줄씩. */
export const BANS: string[] = [
  "No text, letters, numbers, signs with writing, logos, or watermarks anywhere — not even tiny or blurred ones.",
  "No engraved, carved, or painted patterns that look like writing (no inscriptions on stones, plaques, banners, or buildings).",
  "No people at all: no human figures, no family silhouettes, no parent holding hands with children.",
  "Do not add Namsan Tower (N Seoul Tower) or any red-and-white striped tower, antenna, or chimney; draw only landmarks named in the scene.",
  "Keep every important detail well inside the circle and away from its edge, because a ring of text will be added around the circle later; nothing crosses the outline.",
  "Exactly one circle; nothing drawn outside it except plain white.",
];

/** 기존 34종 도장(시트 A~F)과 같은 그림체 설명. */
const STYLE =
  "soft, muted flat gouache illustration like a vintage travel poster, gentle pastel greens and teals, a pale sky with a soft yellow sun (or soft clouds), " +
  "layered blue-green mountains or hills in the distance, subtle paper texture";

/** 참고 그림 없이(글로만) 그릴 때 더 붙이는 그림체 설명 — 게이트웨이가 images/edits를 못 받을 때. */
const STYLE_TEXT_ONLY =
  "Painterly but simplified shapes with soft edges and no hard black outlines; a limited harmonious palette of sage green, teal, muted blue, warm cream, " +
  "and soft peach or golden accents; gentle atmospheric perspective with hazy blue distant ridges; flat even light, no dramatic shadows, no glossy 3D rendering, " +
  "no photorealism, no anime look; visible fine paper grain over the whole painting; calm, nostalgic, child-friendly mood; a slightly elevated three-quarter view " +
  "with the main subject in the middle third, sky in the top third and soft green foreground at the bottom.";

const TAG_EN: Record<string, string> = {
  강: "a river", 강변: "a riverside", 공원: "a park", 과학: "science exhibits", 기차: "an old train", 꽃: "flowers", 다리: "a bridge",
  단풍: "autumn foliage", 돌담: "stone walls", 동물: "friendly animals", 마을: "a village", 박물관: "a museum building", 벚꽃: "cherry blossoms",
  분수: "a fountain", 사찰: "a Buddhist temple", 산: "mountains", 산책: "a walking path", 섬: "a river island", 숲: "a forest",
  수족관: "an aquarium tank with fish", 식물원: "a botanical garden", 언덕: "a hill", 역사: "historic architecture", 정원: "a garden",
  정자: "a traditional pavilion", 한옥: "hanok houses", 호수: "a lake", 놀이터: "a playground", 놀이공원: "amusement rides",
  테마파크: "a theme park", 케이블카: "cable cars", 풍차: "a windmill", 잔디: "a lawn", 전통: "traditional Korean buildings",
};

/** '2026 가을' · 시작 날짜 → spring/summer/autumn/winter. */
export function seasonEn(season?: string | null, starts?: string | null): string {
  const s = season ?? "";
  if (s.includes("봄")) return "spring";
  if (s.includes("여름")) return "summer";
  if (s.includes("가을")) return "autumn";
  if (s.includes("겨울")) return "winter";
  const m = Number((starts ?? "").slice(5, 7));
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return m ? "winter" : "autumn";
}
const SEASON_KO: Record<string, string> = { spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };
const SEASON_DECOR: Record<string, string> = {
  spring: "blossoming trees and pastel paper lanterns",
  summer: "lush green trees, strings of small paper lanterns, and a bright summer sky",
  autumn: "red and golden autumn leaves, strings of warm paper lanterns, and small blank pennant flags",
  winter: "a light dusting of snow, warm glowing lanterns, and bare trees",
};

/** 조사 묘사가 없는 명소: 이름·태그·실내/야외로 무난한 장면. */
function fallbackScene(p: PromptPlace): { ko: string; en: string } {
  const feats = (p.tags ?? []).map((t) => TAG_EN[t]).filter(Boolean).slice(0, 3);
  const en = p.indoor
    ? `A bright, airy indoor scene of a family-friendly place in Daegu, Korea${feats.length ? `, featuring ${feats.join(", ")}` : ""}, seen through a large arched glass window with hills outside.`
    : `A scenic outdoor view of a family-friendly place in Daegu, Korea${feats.length ? `, featuring ${feats.join(", ")}` : ""}, under a pale sky with distant blue-green hills.`;
  const ko = `${p.name}의 ${p.indoor ? "실내" : "야외"} 풍경${p.tags?.length ? ` (${p.tags.slice(0, 3).join("·")})` : ""} — 조사 묘사가 없어 태그로 만들었어요. 장면 문장을 고쳐 주세요.`;
  return { ko, en };
}

function placeScene(p: PromptPlace): { ko: string; en: string; fromResearch: boolean } {
  const v = VISUALS[p.id];
  if (v?.en) return { ko: v.ko, en: v.en, fromResearch: true };
  return { ...fallbackScene(p), fromResearch: false };
}

/** 처음 채워 넣을 장면 문장. 관리자가 sceneEn을 고친다 (한국어로 써도 그림 AI가 알아듣는다). */
export function defaultScene(t: PromptTarget): { sceneKo: string; sceneEn: string; fromResearch: boolean } {
  if (t.kind === "place") {
    const s = placeScene(t.place);
    return { sceneKo: s.ko, sceneEn: s.en, fromResearch: s.fromResearch };
  }
  const f = t.festival;
  const se = seasonEn(f.season, f.starts);
  const decor = SEASON_DECOR[se];
  if (f.place) {
    const s = placeScene(f.place);
    return {
      sceneKo: `${s.ko} — ${SEASON_KO[se]} 축제 장식(글자 없는 등·깃발)`,
      sceneEn: `${s.en.replace(/\.\s*$/, "")}, decorated for ${se === "autumn" ? "an" : "a"} ${se} festival with ${decor} (all blank, no writing).`,
      fromResearch: s.fromResearch,
    };
  }
  return {
    sceneKo: `${f.name} — ${SEASON_KO[se]} 축제 풍경(글자 없는 등·깃발·작은 천막). 장면 문장을 고쳐 주세요.`,
    sceneEn: f.indoor
      ? `A cheerful indoor ${se} festival hall in Daegu, Korea, with ${decor} hanging from the ceiling and small activity booths (all blank, no writing).`
      : `A cheerful outdoor ${se} festival in a park in Daegu, Korea, with ${decor}, small white tents, and a path winding toward distant blue-green hills (all blank, no writing).`,
    fromResearch: false,
  };
}

/** 관리자가 고친 장면 문장 다듬기: 공백 정리, 너무 길면 자름. */
export function cleanScene(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 600);
}

/**
 * 도장 그림 프롬프트 (원 하나, 정사각 1024).
 * withRefs = 참고 그림(기존 도장)을 같이 보낼 때 — 아니면 그림체를 글로 더 자세히 쓴다.
 */
export function buildStampPrompt(scene: string, opts: { withRefs: boolean }): string {
  const style = opts.withRefs
    ? `Match the attached reference stamps exactly in style: ${STYLE}. Use the references only for style, not for content.`
    : `Style: ${STYLE}. ${STYLE_TEXT_ONLY}`;
  return [
    `Create ONE image: a single round stamp illustration, centered, filling a square canvas — one circle whose diameter is about 92% of the canvas width, ` +
      `with a thin dark-green outline ring (${RING_INK}), a narrow white gap just inside the ring, and a plain pure-white background outside the circle.`,
    style,
    `Scene inside the circle: ${cleanScene(scene)}`,
    `Rules:\n${BANS.map((b) => `- ${b}`).join("\n")}`,
  ].join("\n\n");
}

/** 도장 획득 화면 배경 (세로 9:16 근처, 1024×1536). */
export function buildBackgroundPrompt(scene: string, opts: { withRefs: boolean }): string {
  const style = opts.withRefs ? `Using the same style as the attached stamps (${STYLE}),` : `In this style — ${STYLE}. ${STYLE_TEXT_ONLY} —`;
  return [
    `${style} draw ONE vertical full-bleed background illustration of this place: ${cleanScene(scene)}`,
    "Wider view than a stamp, no circle frame, no border. Keep the upper-middle area calm and simple (a round stamp will be placed over it), " +
      "and keep the lower third softer and darker (an information card will sit there).",
    `Rules:\n${BANS.filter((_, i) => i < 4).map((b) => `- ${b}`).join("\n")}`,
  ].join("\n\n");
}

/** 한 번에 만드는 후보 수 · 그림 크기. */
export const STAMP_CANDIDATES = 4;
export const STAMP_SIZE = "1024x1024";
export const BG_SIZE = "1024x1536";
