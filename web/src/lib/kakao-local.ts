import { cachedTour, type Cached } from "./tourapi";
import { parseAddress, parseCoord2Address, parseKeyword, type KakaoAddress, type KakaoPlace } from "./kakao-local-shape";
import { parseKakaoCategory, type KakaoFood } from "./restaurant-shape";

/*
 * 카카오 로컬 API 부르기 + 저장 (docs/검색-거리순-계획.md ②).
 * - 키: Vercel 환경 변수 KAKAO_REST_KEY (Secret, 서버에서만 — 절대 NEXT_PUBLIC_ 으로 넣지 않는다). 헤더 'Authorization: KakaoAK <키>'
 * - 저장: TourAPI와 같은 표 tour_cache에 'kakao:' 머리 — 키워드·주소는 하루, 좌표 → 주소는 30일(오래된 저장 지우기가 30일이라 그 안).
 *   카카오에는 공식 자동완성이 없어서, 폰이 입력이 멈출 때마다 키워드 검색을 부른다 → 같은 검색어는 하루 저장으로 호출을 아낀다.
 * - 키워드 검색은 기준 위치 없이 부른다(검색어만 저장 키) — 기준에서 몇 분인지는 서버가 줄마다 계산.
 */

const TIMEOUT_MS = 5000;
const BASE = "https://dapi.kakao.com";

export class KakaoUnavailable extends Error {
  constructor(public reason: "nokey" | "error", message: string) {
    super(message);
  }
}

export const kakaoKey = () => process.env.KAKAO_REST_KEY || null;

/** 로컬 시험: KAKAO_LOCAL_MOCK=1 이고 키가 없으면 kakao-fixtures.json으로 답한다 (검색어와 상관없이 같은 줄들). */
async function mockCall(path: string, params: Record<string, string>): Promise<unknown> {
  if (path.includes("category")) return mockCategory(params);
  const fx = (await import("./kakao-fixtures.json")).default as Record<string, { documents: Record<string, unknown>[] }>;
  if (path.includes("keyword")) {
    const g = params.category_group_code;
    return { documents: fx.keyword.documents.filter((d) => !g || d.category_group_code === g) };
  }
  return path.includes("address.json") && !path.includes("coord") ? fx.address : fx.coord2address;
}

async function kakaoCall(path: string, params: Record<string, string>): Promise<unknown> {
  const key = kakaoKey();
  if (!key && process.env.KAKAO_LOCAL_MOCK === "1") return mockCall(path, params);
  if (!key) throw new KakaoUnavailable("nokey", "카카오 키(KAKAO_REST_KEY)가 없어요");
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new KakaoUnavailable("error", `카카오 로컬 오류 (${res.status})`);
  return res.json().catch(() => { throw new KakaoUnavailable("error", "카카오 답이 JSON이 아니에요"); });
}

const norm = (q: string) => q.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * 키워드 검색: 그냥 검색(15줄) + 관광명소(AT4) + 문화시설(CT1) 을 같이 불러 합친다 —
 * 그냥 검색만 하면 음식점·카페가 앞을 다 채울 때가 있어서. 하루 저장 'kakao:kw:<검색어>'.
 */
export async function kakaoKeyword(q: string): Promise<Cached<KakaoPlace[]>> {
  return cachedTour(`kakao:kw:${norm(q)}`, 24 * 60, async () => {
    const calls = [undefined, "AT4", "CT1"].map((group) =>
      kakaoCall("/v2/local/search/keyword.json", { query: q, size: "15", ...(group ? { category_group_code: group } : {}) }));
    const pages = await Promise.allSettled(calls);
    if (pages.every((p) => p.status === "rejected")) throw (pages[0] as PromiseRejectedResult).reason;
    const seen = new Set<string>();
    const out: KakaoPlace[] = [];
    for (const p of pages) {
      if (p.status !== "fulfilled") continue;
      for (const x of parseKeyword(p.value)) if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
    }
    return out;
  });
}

/** 주소 검색 (도로명·지번 둘 다, 비슷한 것도). 하루 저장 'kakao:addr:<검색어>'. */
export async function kakaoAddress(q: string): Promise<Cached<KakaoAddress[]>> {
  return cachedTour(`kakao:addr:${norm(q)}`, 24 * 60, async () =>
    parseAddress(await kakaoCall("/v2/local/search/address.json", { query: q, analyze_type: "similar", size: "5" })));
}

/** 좌표 → 주소 (지도 길게 누름). 약 10m(소수 넷째 자리)로 묶어 30일 저장 'kakao:rev:<lat>,<lng>'. */
export async function kakaoReverse(lat: number, lng: number): Promise<Cached<{ name: string; addr: string } | null>> {
  const la = lat.toFixed(4), ln = lng.toFixed(4);
  return cachedTour(`kakao:rev:${la},${ln}`, 30 * 24 * 60, async () =>
    parseCoord2Address(await kakaoCall("/v2/local/geo/coord2address.json", { x: ln, y: la })));
}

/** 로컬 시험용 가짜 근처 식당 (KAKAO_LOCAL_MOCK=1): 기준 점 둘레에 5곳, 번호는 좌표로 만들어 같은 곳은 같은 번호. */
function mockCategory(params: Record<string, string>): unknown {
  const x = Number(params.x), y = Number(params.y);
  const names = params.category_group_code === "CE7"
    ? [["숲길 카페", "음식점 > 카페"], ["빵굽는 집", "음식점 > 간식 > 제과,베이커리"]]
    : [["할매칼국수", "음식점 > 한식 > 국수 > 칼국수"], ["따로국밥 본점", "음식점 > 한식 > 해장국"], ["숯불 돼지갈비", "음식점 > 한식 > 육류,고기 > 갈비"],
       ["골목 떡볶이", "음식점 > 분식"], ["강변 파스타", "음식점 > 양식 > 이탈리안"]];
  const base = Math.abs(Math.round(x * 1000) * 7 + Math.round(y * 1000) * 13) % 1000000;
  return {
    documents: names.map(([name, cat], i) => ({
      id: String(base * 10 + i), place_name: name, category_name: cat, category_group_code: params.category_group_code,
      phone: `053-000-00${i}${i}`, road_address_name: `대구 가짜로 ${i + 1}`, address_name: "", place_url: `http://place.map.kakao.com/${base * 10 + i}`,
      x: String(x + (i - 2) * 0.002), y: String(y + (i % 2 ? 0.0015 : -0.001)), distance: String(150 + i * 230),
    })),
  };
}

/**
 * 근처 식당·카페 (카테고리 검색 FD6 음식점 · CE7 카페) — 관리자 '카카오에서 근처 식당 가져오기'. 거리순 15곳.
 * 저장 'kakao:cat:<묶음>:<약 100m 칸>:<반경>' 7일 (같은 장소를 다시 눌러도 카카오를 다시 안 부름).
 */
export async function kakaoCategory(group: "FD6" | "CE7", lat: number, lng: number, radiusM: number): Promise<Cached<KakaoFood[]>> {
  const la = lat.toFixed(3), ln = lng.toFixed(3);
  return cachedTour(`kakao:cat:${group}:${la},${ln}:${radiusM}`, 7 * 24 * 60, async () =>
    parseKakaoCategory(await kakaoCall("/v2/local/search/category.json", {
      category_group_code: group, x: String(lng), y: String(lat), radius: String(radiusM), sort: "distance", size: "15",
    })));
}
