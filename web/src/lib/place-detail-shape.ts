/*
 * 장소 운영 정보 한 줄 ('오늘 9:00~18:00 · 주차 가능 · 입장 무료') + 사진 — DB·네트워크 없이 (시험 place-detail.test.ts).
 * 부르는 쪽(우리 명소·축제 표, TourAPI detailCommon2·detailIntro2 + tour_cache)은 place-detail.ts.
 * 원칙: 모르는 건 짐작하지 않는다. 글이 애매하면 그 칸은 빼고, 아무것도 없으면 '운영 정보 없음'.
 */
import { httpsImage } from "./tourapi-shape";

/** 폰이 받는 모양 (GET /api/explore/detail). */
export type PlaceDetail = {
  id: string;
  name: string | null;
  /** 사진 (https). 우리 명소는 TourAPI 사진 → 관리자 배경 그림, 축제는 포스터. 없으면 null(폰이 도장 그림·빈 칸) */
  image: string | null;
  /** 그날 여는 시각(분). 늘 열려 있으면 0·1440, 모르면 null */
  open: number | null;
  close: number | null;
  /** 그날 쉬는 날이면 true (우리 표의 쉬는 요일·임시 휴무, 축제 기간 밖) */
  closed: boolean;
  parking: string | null;
  fee: string | null;
  /** 화면에 그대로 쓰는 한 줄 */
  line: string;
  source: "ours" | "festival" | "tour" | "none";
};

export const NO_INFO = "운영 정보 없음";

/** 540 → '9:00' */
export const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

/** TourAPI 글의 <br>·태그·HTML 엔티티를 풀고 공백을 하나로. */
export function plain(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .split("\n").map((s) => s.trim()).filter(Boolean).join("\n")
    .trim();
}

/** '09:00~18:00' · '9시~18시' · '09:00 - 17:30' 처럼 처음 나오는 시간 범위 → 분. 없으면 null. */
export function hoursFromText(text: string): { open: number; close: number } | null {
  const t = text.replace(/[∼〜~～]/g, "~");
  if (/24\s*시간|상시\s*개방|연중\s*개방/.test(t) && !/\d{1,2}\s*[:시]\s*\d{0,2}\s*[~-]/.test(t)) return { open: 0, close: 1440 };
  const m = /(\d{1,2})\s*(?::|시)\s*(\d{2})?\s*분?\s*[~-]\s*(\d{1,2})\s*(?::|시)\s*(\d{2})?/.exec(t);
  if (!m) return null;
  const a = Number(m[1]) * 60 + Number(m[2] ?? 0);
  const b = Number(m[3]) * 60 + Number(m[4] ?? 0);
  if (a > 24 * 60 || b > 24 * 60 || b <= a) return null;
  return { open: a, close: b };
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** 쉬는 날 글에 그 요일이 '매주 ○요일' 꼴로 있으면 true ('연중무휴'·'없음'이면 false, 애매하면 false). */
export function restsOn(text: string, dow: number): boolean {
  const t = text.replace(/\s+/g, "");
  if (!t || (/연중무휴|없음|무휴/.test(t) && !/매주/.test(t))) return false;
  return new RegExp(`매주[^,\\n(]*${DOW[dow]}요일`).test(t);
}

/** 주차 글 → '주차 가능'·'주차 무료'·'주차 어려움' / 애매하면 null. */
export function parkingWord(parking: string, fee = ""): string | null {
  const p = parking.replace(/\s+/g, "");
  const f = fee.replace(/\s+/g, "");
  if (!p && !f) return null;
  if (/불가|없음|불가능|주차장없/.test(p)) return "주차 어려움";
  if (/^무료/.test(f) || /무료/.test(p) && !/유료/.test(p + f)) return "주차 무료";
  if (/가능|있음|있습니다|\d+\s*대|주차장|유료|무료/.test(p) || /유료|\d+원/.test(f)) return "주차 가능";
  return null;
}

/** 입장료 글 → '입장 무료'·'입장 3,000원' / 애매하면 null. */
export function feeWord(fee: string): string | null {
  const f = fee.replace(/\s+/g, " ").trim();
  if (!f) return null;
  if (/^(무료|없음)/.test(f) || /입장\s*(료)?\s*:?\s*무료/.test(f) || (/무료/.test(f) && !/\d[\d,]*\s*원/.test(f))) return "입장 무료";
  const won = /(\d{1,3}(?:,\d{3})+|\d+)\s*원/.exec(f);
  if (won) return `입장 ${Number(won[1].replace(/,/g, "")).toLocaleString("en-US")}원~`;
  return null;
}

/** 한 줄 만들기. dayLabel = '오늘' 또는 '11/3(화)'. */
export function infoLine(d: { dayLabel: string; open: number | null; close: number | null; closed: boolean; parking: string | null; fee: string | null; general?: boolean }): string {
  const parts: string[] = [];
  if (d.closed) parts.push(`${d.dayLabel} 쉬어요`);
  else if (d.open != null && d.close != null) {
    if (d.open <= 0 && d.close >= 1440) parts.push(`${d.dayLabel} 언제나 열려 있어요`);
    // TourAPI 시각은 요일·계절을 가리지 않은 보통 시각이라 '보통'
    else parts.push(`${d.general ? "보통" : d.dayLabel} ${hm(d.open)}~${hm(d.close)}`);
  }
  if (d.parking) parts.push(d.parking);
  if (d.fee) parts.push(d.fee);
  return parts.length ? parts.join(" · ") : NO_INFO;
}

/** '2026-11-03' (한국 날짜) → '11/3(화)', 오늘이면 '오늘'. */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "오늘";
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}(${DOW[dow]})`;
}

export const dowOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

// ------------------------------------------------------------------ TourAPI 답

const items = (json: unknown): Record<string, unknown>[] => {
  const body = (json as { response?: { body?: { items?: { item?: unknown } | "" } } })?.response?.body;
  const raw = body?.items && typeof body.items === "object" ? body.items.item : undefined;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
};

export type TourCommon = { contentTypeId: string; title: string; image: string | null };

/** detailCommon2 → 종류·이름·사진. 모양이 이상하면 null. */
export function parseTourCommon(json: unknown): TourCommon | null {
  const it = items(json)[0];
  if (!it) return null;
  return {
    contentTypeId: String(it.contenttypeid ?? "").trim(),
    title: plain(it.title),
    image: httpsImage(it.firstimage) ?? httpsImage(it.firstimage2),
  };
}

/** babycarriage·pet = 유모차 대여·반려동물 동반 글 (chkbabycarriage*·chkpet*, 예전에 저장한 답엔 없을 수 있다). */
export type TourIntro = { usetime: string; restdate: string; parking: string; parkingFee: string; fee: string; babycarriage?: string; pet?: string };

/**
 * detailIntro2 → 이용 시간·쉬는 날·주차·요금. 칸 이름이 종류(contentTypeId)마다 달라서 이름 모양으로 찾는다:
 *  12 관광지 usetime·restdate·parking / 14 문화시설 usetimeculture·restdateculture·parkingculture·parkingfee·usefee /
 *  15 축제 playtime·usetimefestival(요금) / 28 레포츠 usetimeleports·restdateleports·parkingleports·usefeeleports·parkingfeeleports /
 *  38 쇼핑 opentime·restdateshopping·parkingshopping / 39 음식점 opentimefood·restdatefood·parkingfood
 */
export function parseTourIntro(json: unknown): TourIntro | null {
  const it = items(json)[0];
  if (!it) return null;
  const keys = Object.keys(it);
  const pick = (test: (k: string) => boolean) => {
    for (const k of keys) if (test(k)) { const v = plain(it[k]); if (v) return v; }
    return "";
  };
  const contentType = String(it.contenttypeid ?? "");
  return {
    usetime: pick((k) => contentType === "15" ? k === "playtime" : /^(usetime(?!festival)|opentime|playtime)/.test(k) && !/fee/.test(k)),
    restdate: pick((k) => /^restdate/.test(k)),
    parking: pick((k) => /^parking/.test(k) && !/fee/.test(k)),
    parkingFee: pick((k) => /^parkingfee/.test(k)),
    fee: pick((k) => /^usefee/.test(k) || k === "usetimefestival"),
    babycarriage: pick((k) => /^chkbabycarriage/.test(k)),
    pet: pick((k) => /^chkpet/.test(k)),
  };
}
