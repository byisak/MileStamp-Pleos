import { sql } from "./db";
import { kstToday } from "./festival-shape";
import { namesMatch } from "./explore-shape";
import { km } from "./planner";
import { cachedTour, searchTour, tourCallRaw, tourKey } from "./tourapi";
import {
  dayLabel, dowOf, feeWord, hoursFromText, infoLine, parkingWord, parseTourCommon, parseTourIntro, restsOn,
  type PlaceDetail, type TourCommon, type TourIntro,
} from "./place-detail-shape";

/*
 * 장소 운영 정보·사진 (GET /api/explore/detail). 모양·글 만들기는 place-detail-shape.ts.
 * - 우리 명소: 여는 시각·쉬는 요일·임시 휴무는 우리 표(관리자가 고친 값) → 주차·요금·사진은 TourAPI 같은 곳(이름 + 5km)이 있으면 그것
 * - 등록 축제: 기간·운영 시각·쉬는 요일 + 포스터
 * - TourAPI 장소(ext:tour)·100선(ext:kto100, 번호를 알면): detailCommon2(종류·사진) + detailIntro2(이용 시간·주차·요금)
 * - 카카오·지도 핀: 아는 게 없음 → '운영 정보 없음'
 * TourAPI 답은 tour_cache에 하루(`detail:<번호>`), 우리 명소 ↔ TourAPI 번호 짝은 30일(`ourtour:<id>`). 키 없음·한도·실패면 아는 것만.
 */

type TourDetail = { common: TourCommon | null; intro: TourIntro | null };

export async function tourDetail(contentId: string): Promise<TourDetail | null> {
  if (!tourKey() || !/^\d{1,12}$/.test(contentId)) return null;
  try {
    const r = await cachedTour<TourDetail>(`detail:${contentId}`, 24 * 60, async () => {
      const common = parseTourCommon(await tourCallRaw("detailCommon2", { contentId }));
      const type = common?.contentTypeId;
      const intro = type ? parseTourIntro(await tourCallRaw("detailIntro2", { contentId, contentTypeId: type })) : null;
      return { common, intro };
    });
    return r.data;
  } catch {
    return null;
  }
}

/** 우리 명소와 같은 TourAPI 장소 번호 (이름이 맞고 5km 안). 30일 기억, 못 찾으면 null도 기억. */
export async function ourTourId(p: { id: string; name: string; lat: number; lng: number }): Promise<string | null> {
  if (!tourKey()) return null;
  try {
    const r = await cachedTour<{ contentId: string | null }>(`ourtour:${p.id}`, 30 * 24 * 60, async () => {
      const first = p.name.replace(/\([^)]*\)/g, "").split(/[&,·]/)[0].trim();
      const found = (await searchTour(first)).data.find((x) =>
        namesMatch(x.title, p.name) && x.lat != null && x.lng != null && km({ lat: x.lat, lng: x.lng }, p) <= 5);
      return { contentId: found?.contentId ?? null };
    });
    return r.data.contentId;
  } catch {
    return null;
  }
}

function tourBits(t: TourDetail | null, dow: number) {
  const i = t?.intro;
  const hours = i?.usetime ? hoursFromText(i.usetime) : null;
  return {
    hours,
    rests: !!i?.restdate && restsOn(i.restdate, dow),
    parking: i ? parkingWord(i.parking, i.parkingFee) : null,
    fee: i ? feeWord(i.fee) : null,
    image: t?.common?.image ?? null,
    name: t?.common?.title || null,
  };
}

export async function placeDetail(id: string, day = kstToday()): Promise<PlaceDetail | null> {
  const today = kstToday();
  const label = dayLabel(day, today);
  const dow = dowOf(day);

  // 등록 축제
  if (id.startsWith("fest-")) {
    const [f] = await sql<{ name: string; starts: string; ends: string; open_min: number; close_min: number; closed_days: number[]; poster_url: string | null }[]>`
      select name, starts::text as starts, ends::text as ends, open_min, close_min, closed_days, poster_url from festivals where id = ${id}`;
    if (!f) return null;
    const closed = day < f.starts || day > f.ends || (f.closed_days ?? []).map(Number).includes(dow);
    const d = { dayLabel: label, open: f.open_min, close: f.close_min, closed, parking: null, fee: null };
    return { id, name: f.name, image: f.poster_url, open: d.open, close: d.close, closed, parking: null, fee: null, line: infoLine(d), source: "festival" };
  }

  // 바깥 장소
  if (id.startsWith("ext:")) {
    let contentId: string | null = null;
    let image: string | null = null;
    let name: string | null = null;
    const tour = /^ext:tour:(\d+)$/.exec(id);
    const kto = /^ext:kto100:(\d+)$/.exec(id);
    if (tour) contentId = tour[1];
    else if (kto) {
      const [r] = await sql<{ name: string; content_id: string | null; image: string | null }[]>`
        select name, content_id, image from curated_places where no = ${Number(kto[1])} order by list desc limit 1`;
      contentId = r?.content_id ?? null;
      image = r?.image ?? null;
      name = r?.name ?? null;
    }
    const td = contentId ? await tourDetail(contentId) : null;
    const t = td ? tourBits(td, dow) : null;
    if (!t) return { id, name, image, open: null, close: null, closed: false, parking: null, fee: null, line: infoLine({ dayLabel: label, open: null, close: null, closed: false, parking: null, fee: null }), source: "none" };
    const d = { dayLabel: label, open: t.hours?.open ?? null, close: t.hours?.close ?? null, closed: t.rests, parking: t.parking, fee: t.fee, general: true };
    return { id, name: t.name ?? name, image: t.image ?? image, open: d.open, close: d.close, closed: d.closed, parking: d.parking, fee: d.fee, line: infoLine(d), source: "tour" };
  }

  // 우리 명소
  const [p] = await sql<{ id: string; name: string; lat: number; lng: number; open_min: number; close_min: number; closed_days: number[] | null; temp_closed: string[] | null; bg_url: string | null; closed: string | null }[]>`
    select id, name, lat, lng, open_min, close_min, closed_days, closed, (select array_agg(d::text) from unnest(temp_closed) d) as temp_closed, bg_url
    from places where id = ${id}`;
  if (!p) return null;
  // 쉬는 요일 칸이 비어 있어도 쉬는 날 글이 '매주 ○요일'이면 쉰다고 본다
  const closed = (p.closed_days ?? []).map(Number).includes(dow) || (p.temp_closed ?? []).includes(day) || (!!p.closed && restsOn(p.closed, dow));
  const tid = await ourTourId(p);
  const td = tid ? await tourDetail(tid) : null;
  const t = td ? tourBits(td, dow) : null;
  const d = { dayLabel: label, open: p.open_min, close: p.close_min, closed, parking: t?.parking ?? null, fee: t?.fee ?? null };
  return { id, name: p.name, image: t?.image ?? p.bg_url, open: d.open, close: d.close, closed, parking: d.parking, fee: d.fee, line: infoLine(d), source: "ours" };
}
