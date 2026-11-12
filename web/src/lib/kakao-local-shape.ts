/*
 * 직접 찾기 = 지도 검색 (docs/검색-거리순-계획.md ②) — 카카오 로컬 답 읽기 · 순서 · 주소처럼 보이나 · 기준 위치(from).
 * DB·네트워크 없이 (시험 kakao-local-shape.test.ts). 부르는 쪽은 kakao-local.ts, 합치는 쪽은 explore.ts exploreSuggest.
 * 카카오 REST 키는 서버에서만 쓴다 — 이 파일엔 키가 없다.
 */
import { driveMinFrom, namesMatch, normName } from "./explore-shape";
import type { LatLng } from "./planner";

// ------------------------------------------------------------------ 기준 위치 (from=lat,lng)

/** 대한민국 근처만 받는다 (엉뚱한 값이면 무시 → 집 기준). */
const inKorea = (lat: number, lng: number) => lat >= 32.5 && lat <= 39.5 && lng >= 123.5 && lng <= 132.5;

/** 'from=35.88,128.58' 모양인가 (축제 목록의 날짜 from=YYYY-MM-DD와 구별). */
export const isCoordText = (v: string | null | undefined): v is string => !!v && /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(v.trim());

/**
 * 기준 위치 'lat,lng' → 약 1km(소수 둘째 자리)로 반올림한 좌표. 모양이 틀리거나 한국 밖이면 null.
 * 반올림 = 같은 동네에서 본 목록은 같은 답(나중에 캐시 키로 써도 되게) + 정확한 위치를 서버 기록에 남기지 않게.
 */
export function parseFrom(v: string | null | undefined): LatLng | null {
  if (!isCoordText(v)) return null;
  const [a, b] = v.trim().split(",").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !inKorea(a, b)) return null;
  return { lat: Math.round(a * 100) / 100, lng: Math.round(b * 100) / 100 };
}

// ------------------------------------------------------------------ 바깥 장소 id

export const kakaoExtId = (placeId: string) => `ext:kakao:${placeId}`;

/** 지도 핀·주소 → 'ext:pin:35.88580,128.58280' (소수 다섯째 자리 ≈ 1m) */
export const pinExtId = (lat: number, lng: number) => `ext:pin:${lat.toFixed(5)},${lng.toFixed(5)}`;

/** 'ext:pin:…' → 좌표 (모양이 틀리면 null) */
export function parsePinId(id: string): LatLng | null {
  const m = /^ext:pin:(-?\d{1,3}\.\d{1,6}),(-?\d{1,3}\.\d{1,6})$/.exec(id);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

// ------------------------------------------------------------------ 주소처럼 보이나

const SIDO = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)/;

/**
 * '대구 달성군 화원읍 …'·'동대구로 123'·'산격동 1234-5'처럼 주소로 보이면 true → 주소 검색도 부른다('이 주소로' 줄).
 * '경주 박물관'처럼 이름 검색은 false (시·도로 시작해도 시·군·구 낱말이나 번지가 있어야).
 */
export function looksLikeAddress(q: string): boolean {
  const s = q.replace(/\s+/g, " ").trim();
  if (s.length < 3) return false;
  if (/[가-힣0-9]+(로|길)\s?\d+(-\d+)?(번길)?/.test(s)) return true; // 도로명 + 건물 번호
  if (/[가-힣0-9]+(동|리|가)\s?(산\s?)?\d+(-\d+)?$/.test(s)) return true; // 지번
  if (/[가-힣]+(읍|면)\s+[가-힣0-9]+(리|로|길)/.test(s)) return true;
  if (SIDO.test(s) && /\s[가-힣]+(시|군|구)(\s|$)/.test(s)) return true; // '대구 달성군', '경북 경주시 …'
  return false;
}

// ------------------------------------------------------------------ 카카오 답 읽기

/** 키워드 검색 한 줄 (/v2/local/search/keyword.json documents[]) — 쓰는 칸만 */
export type KakaoPlace = {
  id: string;
  name: string;
  /** '여행 > 관광,명소 > 테마파크' */
  category: string;
  /** AT4 관광명소 · CT1 문화시설 · FD6 음식점 · CE7 카페 · … (없으면 '') */
  group: string;
  addr: string;
  lat: number;
  lng: number;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parseKeyword(json: unknown): KakaoPlace[] {
  const docs = (json as { documents?: unknown })?.documents;
  if (!Array.isArray(docs)) return [];
  const out: KakaoPlace[] = [];
  for (const d of docs) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const lat = Number(o.y), lng = Number(o.x);
    const id = str(o.id);
    if (!/^\d{1,20}$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    out.push({
      id, name: str(o.place_name).trim(), category: str(o.category_name), group: str(o.category_group_code),
      addr: str(o.road_address_name) || str(o.address_name), lat, lng,
    });
  }
  return out.filter((x) => x.name);
}

/** 주소 검색 한 줄 (/v2/local/search/address.json) */
export type KakaoAddress = { name: string; addr: string; lat: number; lng: number };

export function parseAddress(json: unknown): KakaoAddress[] {
  const docs = (json as { documents?: unknown })?.documents;
  if (!Array.isArray(docs)) return [];
  const out: KakaoAddress[] = [];
  for (const d of docs) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const lat = Number(o.y), lng = Number(o.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const road = (o.road_address ?? null) as Record<string, unknown> | null;
    const jibun = (o.address ?? null) as Record<string, unknown> | null;
    const roadName = str(road?.address_name);
    const jibunName = str(jibun?.address_name);
    const name = str(road?.building_name).trim() || roadName || jibunName || str(o.address_name);
    if (!name) continue;
    out.push({ name, addr: roadName && jibunName && roadName !== jibunName ? `${roadName} (${jibunName})` : roadName || jibunName || str(o.address_name), lat, lng });
  }
  return out;
}

/** 좌표 → 주소 (/v2/local/geo/coord2address.json) 첫 줄. 건물 이름 → 도로명 → 지번. 없으면 null */
export function parseCoord2Address(json: unknown): { name: string; addr: string } | null {
  const docs = (json as { documents?: unknown })?.documents;
  if (!Array.isArray(docs) || !docs.length) return null;
  const o = docs[0] as Record<string, unknown>;
  const road = (o?.road_address ?? null) as Record<string, unknown> | null;
  const jibun = (o?.address ?? null) as Record<string, unknown> | null;
  const roadName = str(road?.address_name);
  const jibunName = str(jibun?.address_name);
  const addr = roadName || jibunName;
  if (!addr) return null;
  return { name: str(road?.building_name).trim() || addr, addr };
}

// ------------------------------------------------------------------ 순서

/** 아이와 갈 만한 곳 (공원·체험·키즈카페 …) — 카테고리 글에서 찾는다. 키즈카페는 카페(CE7)여도 여기. */
const KIDS = /공원|키즈|어린이|유아|체험|놀이|동물원|수목원|식물원|아쿠아리움|수족관|테마파크|캠핑|야영|휴양림|해수욕장|계곡|생태|농장|목장|박물관|미술관|과학관|도서관|전시|기념관|레저|썰매|눈썰매|워터파크/;

/**
 * 묶음 (작을수록 위, 주인 결정 10/29): 0 관광명소(AT4)·문화시설(CT1) → 1 공원·체험·키즈 → 2 그 밖 → 3 음식점(FD6)·카페(CE7).
 * 음식점·카페도 빼지 않고 맨 아래로 (키즈카페는 1).
 */
export function kakaoTier(p: Pick<KakaoPlace, "group" | "category">): 0 | 1 | 2 | 3 {
  if (p.group === "AT4" || p.group === "CT1") return 0;
  if (KIDS.test(p.category)) return 1;
  if (p.group === "FD6" || p.group === "CE7") return 3;
  return 2;
}

/** 줄에 보일 종류 글: 카테고리 끝 낱말 ('여행 > 관광,명소 > 테마파크' → '테마파크'), 없으면 묶음 이름 */
export function kakaoLabel(p: Pick<KakaoPlace, "group" | "category">): string {
  const last = p.category.split(">").map((s) => s.trim()).filter(Boolean).pop();
  if (last) return last.replace(/,/g, "·");
  return ({ AT4: "관광명소", CT1: "문화시설", FD6: "음식점", CE7: "카페" } as Record<string, string>)[p.group] ?? "장소";
}

// ------------------------------------------------------------------ 합치기

/**
 * 자동완성 한 줄. kind: 'place' 우리 명소(도장) · 'kakao' 카카오 장소 · 'address' 주소('이 주소로') · 'pin' 지도 핀.
 * id: 우리 명소 id · 'ext:kakao:<카카오 장소 id>' · 'ext:pin:<lat>,<lng>' (주소·핀)
 */
export type SuggestItem = {
  kind: "place" | "kakao" | "address" | "pin";
  id: string;
  name: string;
  /** 종류 글 ('우리 도장' · '테마파크' · '주소' …) */
  label: string;
  addr: string;
  lat: number;
  lng: number;
  /** 기준 위치에서 차로 몇 분 (모르면 null) */
  driveMin: number | null;
  ourStamp?: boolean;
  /** 우리 명소면 그 id (kind 'place'와 같음) */
  ourPlaceId?: string;
};

export type OurPlaceLite = { id: string; name: string; lat: number; lng: number; stampable: boolean; region?: string | null };

/** 우리 명소 이름 맞추기: 정규화한 이름에 검색어가 들어가거나 이름이 맞는 곳 (가까운 순) */
export function ourMatches(places: OurPlaceLite[], q: string, ref: LatLng | null): SuggestItem[] {
  const nq = normName(q);
  if (!nq) return [];
  return places
    .filter((p) => normName(p.name).includes(nq) || namesMatch(p.name, q))
    .map((p): SuggestItem => ({
      kind: "place", id: p.id, name: p.name, label: p.stampable ? "우리 도장" : "우리 명소", addr: p.region ?? "", lat: p.lat, lng: p.lng,
      driveMin: driveMinFrom(ref, p.lat, p.lng), ourStamp: p.stampable, ourPlaceId: p.id,
    }))
    .sort((a, b) => (a.driveMin ?? 1e9) - (b.driveMin ?? 1e9));
}

/** 이름이 검색어로 시작하면 2, 들어 있으면 1, 아니면 0 */
function nameHit(name: string, q: string): number {
  const n = normName(name), nq = normName(q);
  if (!nq) return 0;
  return n.startsWith(nq) ? 2 : n.includes(nq) ? 1 : 0;
}

/**
 * 자동완성 목록: 우리 명소(이름 맞는 곳) → 주소 줄('이 주소로', 주소처럼 보일 때) → 카카오 장소
 * (묶음 순 kakaoTier → 이름이 맞는 정도 → 기준에서 가까운 순 → 카카오 순서). 우리 명소와 같은 곳(이름 + 300m)은 뺀다.
 * 같은 카카오 id는 한 번. 모두 [max]줄까지.
 */
export function mergeSuggest(opts: {
  q: string;
  ref: LatLng | null;
  ours: OurPlaceLite[];
  kakao: KakaoPlace[];
  addresses: KakaoAddress[];
  max?: number;
}): SuggestItem[] {
  const max = opts.max ?? 15;
  const mine = ourMatches(opts.ours, opts.q, opts.ref).slice(0, 5);
  // 같은 곳 = 이름이 맞고 약 300m 안 (한쪽 이름이 다른 쪽에 통째로 들어 있을 때만 — '팔공산 ○○ 카페'처럼 앞말만 같은 근처 가게는 남긴다)
  const near = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    Math.abs(a.lat - b.lat) < 0.003 && Math.abs(a.lng - b.lng) < 0.0035;
  const seen = new Set<string>();
  const ranked = opts.kakao
    .map((p, i) => ({ p, i, tier: kakaoTier(p), hit: nameHit(p.name, opts.q), d: driveMinFrom(opts.ref, p.lat, p.lng) }))
    .filter(({ p }) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      const np = normName(p.name);
      return !opts.ours.some((o) => {
        const no = normName(o.name);
        return near(o, p) && np.length >= 2 && no.length >= 2 && (np.includes(no) || no.includes(np));
      });
    })
    .sort((a, b) => a.tier - b.tier || b.hit - a.hit || (a.d ?? 1e9) - (b.d ?? 1e9) || a.i - b.i);
  const kakao = ranked.map(({ p, d }): SuggestItem => ({
    kind: "kakao", id: kakaoExtId(p.id), name: p.name, label: kakaoLabel(p), addr: p.addr, lat: p.lat, lng: p.lng, driveMin: d,
  }));
  const addrs = opts.addresses.slice(0, 2).map((a): SuggestItem => ({
    kind: "address", id: pinExtId(a.lat, a.lng), name: a.name, label: "주소", addr: a.addr, lat: a.lat, lng: a.lng,
    driveMin: driveMinFrom(opts.ref, a.lat, a.lng),
  }));
  return [...mine, ...addrs, ...kakao].slice(0, max);
}

/** 지도 핀(좌표 → 주소) 한 줄. 주소를 모르면 '지도에서 고른 곳' */
export function pinItem(lat: number, lng: number, found: { name: string; addr: string } | null, ref: LatLng | null): SuggestItem {
  return {
    kind: "pin", id: pinExtId(lat, lng), name: (found?.name ?? "지도에서 고른 곳").slice(0, 40), label: "지도에서 고른 곳",
    addr: found?.addr ?? "", lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)), driveMin: driveMinFrom(ref, lat, lng),
  };
}
