/*
 * 명소발굴 100x100 후보 (표 spot_candidates) — 모양 검사·거르기 값 읽기 (DB 없이, 시험은 spot100.test.ts).
 *
 * 관리자만 보는 후보 목록이다. 한 줄 설명(topics[].n)은 관광공사 저작물이라 '관리자 참고용'으로만 두고,
 * 폰·차·공개 API는 이 표를 읽지 않는다 (추천 엔진·/api/catalog·/api/car/places·/api/plan·/api/explore/* 와 이어지지 않음).
 * 원본은 https://spot100x100.kr/data.js — 변환은 tools/spot100/convert.py (칸 뜻은 그 파일 맨 위에 적어 둠).
 */
import meta from "./spot100-meta.json";
import { normRegionCode, regionFromText } from "./explore-region";

export const SPOT_META = meta as { themes: { name: string; icon: string }[]; topics: { th: number; name: string }[] };
export const SPOT_STATUSES = ["new", "ok", "hidden"] as const;
export type SpotStatus = (typeof SPOT_STATUSES)[number];
export const SPOT_IMPORT_MAX = 500;
export const SPOT_PAGE_MAX = 100;

export type SpotTopic = { t: number; th: number; r: number; n: string };

/** 올리는 한 줄 (tools/spot100/spot100-2026.json 의 rows 한 칸과 같음). */
export type SpotInput = {
  key: string; name: string; lat: number; lng: number; addr: string | null; sido: string | null;
  cid: string | null; img: string | null; url: string | null; topics: SpotTopic[];
};

/** 관리자 화면으로 나가는 한 줄. */
export type SpotRow = {
  key: string; name: string; lat: number; lng: number; addr: string | null; sido: string | null;
  contentId: string | null; image: string | null; sourceUrl: string | null; topics: SpotTopic[];
  status: SpotStatus; ourPlaceId: string | null;
};

const httpsOrNull = (v: unknown, max = 500): string | null => {
  const s = typeof v === "string" ? v.trim().replace(/^http:\/\//, "https://") : "";
  return /^https:\/\//.test(s) && s.length <= max ? s : null;
};

/** 주소 → 시·도 코드. data.js는 광주·전남을 '전남광주'로 합쳐 적으므로 둘째 말이 '구'면 광주(29), 시·군이면 전남(46). */
export function spotSidoFromAddr(addr: string | null | undefined): string | null {
  const toks = String(addr ?? "").trim().split(/\s+/);
  if (toks[0] === "전남광주") return toks[1]?.endsWith("구") ? "29" : "46";
  return regionFromText(addr);
}

/** 올리는 글(JSON) → 줄 목록. 이상한 줄은 건너뛰고 errors에 (몇 번째인지). 한 번에 SPOT_IMPORT_MAX줄까지. */
export function parseSpotRows(input: unknown): { rows: SpotInput[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(input)) return { rows: [], errors: ["rows가 목록이 아니에요"] };
  if (input.length > SPOT_IMPORT_MAX) return { rows: [], errors: [`한 번에 ${SPOT_IMPORT_MAX}곳까지만 올려요`] };
  const nT = SPOT_META.topics.length;
  const rows: SpotInput[] = [];
  const seen = new Set<string>();
  input.forEach((x, i) => {
    const at = `${i + 1}번째`;
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 120) : "";
    const lat = Number(o.lat), lng = Number(o.lng);
    const key = typeof o.key === "string" ? o.key.trim().slice(0, 300) : "";
    if (!name || !key) { errors.push(`${at}: 이름·key가 비었어요`); return; }
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180) || (lat === 0 && lng === 0)) { errors.push(`${at}(${name}): 좌표가 이상해요`); return; }
    if (seen.has(key)) { errors.push(`${at}(${name}): key가 두 번 있어요`); return; }
    const topics: SpotTopic[] = [];
    for (const t of Array.isArray(o.topics) ? o.topics : []) {
      const tt = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
      const id = Number(tt.t);
      if (!Number.isInteger(id) || id < 0 || id >= nT) continue;
      topics.push({ t: id, th: SPOT_META.topics[id].th, r: Math.max(0, Math.min(1000, Math.trunc(Number(tt.r)) || 0)), n: typeof tt.n === "string" ? tt.n.trim().slice(0, 300) : "" });
    }
    if (!topics.length) { errors.push(`${at}(${name}): 주제가 없어요`); return; }
    seen.add(key);
    const addr = typeof o.addr === "string" && o.addr.trim() ? o.addr.trim().slice(0, 200) : null;
    const cid = typeof o.cid === "string" && /^\d{1,12}$/.test(o.cid.trim()) ? o.cid.trim() : null;
    rows.push({
      key, name, lat, lng, addr,
      // 시·도: 올린 코드 → 주소 앞머리 (둘 다 모르면 null)
      sido: normRegionCode(o.sido) ?? spotSidoFromAddr(addr),
      cid, img: httpsOrNull(o.img), url: httpsOrNull(o.url), topics,
    });
  });
  return { rows, errors };
}

export type SpotQuery = {
  sido: string | null; theme: number | null; topic: number | null; hasCid: boolean | null;
  status: SpotStatus | null; q: string; page: number; size: number;
};

/** 주소줄 값 → 거르기. 틀린 값은 없는 것으로. */
export function parseSpotQuery(p: URLSearchParams): SpotQuery {
  const int = (k: string, lo: number, hi: number) => {
    const v = p.get(k);
    if (v == null || !/^\d+$/.test(v)) return null;
    const n = Number(v);
    return n >= lo && n <= hi ? n : null;
  };
  const status = p.get("status");
  const cid = p.get("cid");
  return {
    sido: normRegionCode(p.get("sido")),
    theme: int("theme", 0, SPOT_META.themes.length - 1),
    topic: int("topic", 0, SPOT_META.topics.length - 1),
    hasCid: cid === "1" ? true : cid === "0" ? false : null,
    status: (SPOT_STATUSES as readonly string[]).includes(status ?? "") ? (status as SpotStatus) : null,
    q: (p.get("q") ?? "").trim().slice(0, 60),
    page: Math.max(1, int("page", 1, 10000) ?? 1),
    size: Math.max(1, Math.min(SPOT_PAGE_MAX, int("size", 1, 1_000_000) ?? 30)),
  };
}

/** LIKE 검색어의 % _ \ 를 글자 그대로 찾게 막기. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** 지도 보기 주소 (카카오·네이버, 이름 + 좌표). */
export function spotMapLinks(name: string, lat: number, lng: number): { kakao: string; naver: string } {
  return {
    kakao: `https://map.kakao.com/link/map/${encodeURIComponent(name.replace(/[,/]/g, " "))},${lat},${lng}`,
    naver: `https://map.naver.com/p/search/${encodeURIComponent(name)}`,
  };
}

/** 한 곳의 대표 설명 (주제 순번이 가장 앞선 것). 관리자 화면 참고용. */
export function spotNote(topics: SpotTopic[]): string {
  return [...topics].sort((a, b) => (a.r || 999) - (b.r || 999)).find((t) => t.n)?.n ?? "";
}
