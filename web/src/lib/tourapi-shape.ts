/*
 * 관광공사 TourAPI(KorService2) 답 → 우리 모양 (DB·네트워크 없이, 시험은 tourapi-shape.test.ts).
 * 부르는 곳(저장·한도)은 tourapi.ts.
 *
 * 답 모양: { response: { header: { resultCode: "0000" }, body: { items: { item: [...] } | "", numOfRows, pageNo, totalCount } } }
 * 줄 하나: contentid · contenttypeid · title · addr1 · addr2 · mapx(경도) · mapy(위도) · firstimage · lDongRegnCd(시도) · eventstartdate·eventenddate(축제)
 */

export const TOUR_BASE = "https://apis.data.go.kr/B551011/KorService2";

/** 직접 찾기에 쓰는 종류: 12 관광지 · 14 문화시설.
 * 28 레포츠는 넣지 않는다 — 골프장·스키장·수상레저·사격장처럼 4살 아이 가족에 맞지 않는 곳이 많고,
 * 아이가 놀 만한 레포츠(썰매장 등)는 대개 관광지(12)로도 올라 있다. 음식점(39)·숙박(32)·쇼핑(38)도 뺀다(주인 결정 10/28). */
export const SEARCH_TYPES = ["12", "14"] as const;
export const TYPE_LABEL: Record<string, string> = { "12": "관광지", "14": "문화시설", "15": "축제·행사", "28": "레포츠" };

export type TourItem = {
  contentId: string;
  contentTypeId: string;
  title: string;
  addr: string;
  lat: number | null;
  lng: number | null;
  image: string | null;
  /** 축제만: 'YYYY-MM-DD' */
  starts?: string;
  ends?: string;
  /** 법정동 시도 코드 (대구 27 · 경북 47 …). 없으면 ''. */
  region: string;
};

export type TourPage = { items: TourItem[]; totalCount: number; pageNo: number; numOfRows: number };

/** '20261020' → '2026-10-20' (모양이 다르면 ''). */
export function ymd(s: unknown): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s ?? "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== "" && v != null && Number.isFinite(n) && n !== 0 ? n : null;
};

/** 그림 주소는 https로 (폰 앱·웹이 섞인 내용 막힘을 피하려고). */
export function httpsImage(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().replace(/^http:\/\//, "https://") : null;
}

/** TourAPI 답이 오류인지 (키 틀림·한도 넘음은 JSON이 아니거나 resultCode가 0000이 아님). */
export function tourError(json: unknown): string | null {
  if (!json || typeof json !== "object") return "답이 JSON이 아니에요";
  const r = (json as { response?: { header?: { resultCode?: string; resultMsg?: string } } }).response;
  if (!r) {
    // 오류 답 모양 { resultCode, resultMsg } 도 있다
    const top = json as { resultCode?: string; resultMsg?: string };
    return top.resultCode && top.resultCode !== "0000" ? `${top.resultCode} ${top.resultMsg ?? ""}`.trim() : "답 모양이 이상해요";
  }
  const code = r.header?.resultCode;
  return code && code !== "0000" && code !== "00" ? `${code} ${r.header?.resultMsg ?? ""}`.trim() : null;
}

/** 한 페이지 → 줄 목록 (이름·좌표 없는 줄은 뺀다). 답이 이상하면 빈 목록. */
export function parseTourPage(json: unknown): TourPage {
  const body = (json as { response?: { body?: { items?: { item?: unknown } | ""; totalCount?: unknown; pageNo?: unknown; numOfRows?: unknown } } })
    ?.response?.body;
  const raw = body?.items && typeof body.items === "object" ? body.items.item : undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const items: TourItem[] = [];
  for (const it of list as Record<string, unknown>[]) {
    const title = String(it?.title ?? "").trim();
    const contentId = String(it?.contentid ?? "").trim();
    if (!title || !/^\d+$/.test(contentId)) continue;
    const item: TourItem = {
      contentId,
      contentTypeId: String(it.contenttypeid ?? "").trim(),
      title,
      addr: [it.addr1, it.addr2].map((x) => String(x ?? "").trim()).filter(Boolean).join(" "),
      lat: num(it.mapy),
      lng: num(it.mapx),
      image: httpsImage(it.firstimage) ?? httpsImage(it.firstimage2),
      region: String(it.lDongRegnCd ?? "").trim(),
    };
    const s = ymd(it.eventstartdate), e = ymd(it.eventenddate);
    if (s && e) { item.starts = s; item.ends = e; }
    items.push(item);
  }
  return {
    items,
    totalCount: Number(body?.totalCount) || items.length,
    pageNo: Number(body?.pageNo) || 1,
    numOfRows: Number(body?.numOfRows) || items.length,
  };
}

/** 주소 만들기 (키는 따로 — 이미 %가 있으면 그대로). */
export function tourUrl(op: string, key: string, params: Record<string, string>): string {
  const k = key.includes("%") ? key : encodeURIComponent(key);
  const q = new URLSearchParams({ MobileOS: "ETC", MobileApp: "milestamp", _type: "json", ...params });
  return `${TOUR_BASE}/${op}?serviceKey=${k}&${q}`;
}

/** 앱에서 쓰는 바깥 장소 id. */
export const tourExtId = (contentId: string) => `ext:tour:${contentId}`;
export const kto100ExtId = (no: number) => `ext:kto100:${no}`;
