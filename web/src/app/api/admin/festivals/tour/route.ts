import { adminGuard } from "@/lib/admin-auth";
import { parseTourFestivals } from "@/lib/festival-shape";
import { serviceKeyParam } from "@/lib/sun";

/**
 * 관리자: 한국관광공사 TourAPI 축제 찾기 (searchFestival2) → 폼 처음 값 목록. 사람이 검수 후 저장한다.
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&area=4|35 (4 = 대구, 35 = 경북). 공공데이터 키(DATA_GO_KR_KEY)가 없으면 { ready: false }.
 * KorService2는 지역을 법정동 시도 코드(lDongRegnCd: 대구 27, 경북 47)로 찾는다. 옛 areaCode는 거의 비어 와서 비었을 때만 다시 묻는다.
 */
export async function GET(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return Response.json({ ready: false, items: [] });
  const q = new URL(req.url).searchParams;
  const ymd = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replaceAll("-", "") : "");
  const from = ymd(q.get("from"));
  if (!from) return Response.json({ error: "시작 날짜가 필요해요" }, { status: 400 });
  const to = ymd(q.get("to"));
  const area = q.get("area") === "35" ? "35" : "4";
  const base = { MobileOS: "ETC", MobileApp: "milestamp", _type: "json", arrange: "A", numOfRows: "100", pageNo: "1", eventStartDate: from };
  const ask = async (region: Record<string, string>) => {
    const params = new URLSearchParams({ ...base, ...region });
    if (to) params.set("eventEndDate", to);
    const url = `https://apis.data.go.kr/B551011/KorService2/searchFestival2?serviceKey=${serviceKeyParam(key)}&${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    const text = await res.text();
    try { return parseTourFestivals(JSON.parse(text)); } catch { return null; }
  };
  try {
    let items = await ask({ lDongRegnCd: area === "35" ? "47" : "27" });
    if (!items?.length) items = (await ask({ areaCode: area })) ?? items;
    if (items === null) return Response.json({ error: "TourAPI 답이 JSON이 아니에요 (키·주소 확인)" }, { status: 502 });
    return Response.json({ ready: true, items });
  } catch {
    return Response.json({ error: "TourAPI에 연결하지 못했어요" }, { status: 502 });
  }
}
