import { kst } from "@/lib/kst";
import { cellOf, DEMO_HOME_CELL, familyHome, loadFamily, whoFromRequest } from "@/lib/plan";
import { cachedTour } from "@/lib/tourapi";
import { fetchUltraSrtNcst, latLngToGrid, type SkyNow } from "@/lib/weather";

/**
 * 지금 기온·강수 (폰 오늘 탭 머리 '☁ 12°' 칩). 인증은 /api/plan과 같음(폰 Bearer·웹 쿠키, 차 Bearer).
 *   GET /api/sky/now?lat=&lng=   — 위치가 없으면 가족 집(폰에서 정한 집 → 집 칸 → 데모 차는 북구청)
 * 답 { tempC, sky: 'clear'|'rain'|'snow'|'sleet'|'drizzle', at } · 모르면 503 { error } (폰은 칩을 그냥 숨김)
 * - 기상청 초단기실황(getUltraSrtNcst), 키 DATA_GO_KR_KEY. 같은 격자(5km)는 10분 동안 tour_cache 'sky:now:g<nx>,<ny>'를 쓴다
 * - 좌표는 소수 둘째 자리(약 1km)로 깎아 격자만 계산하고, 저장·로그에는 격자 번호만 남긴다
 */
const KEEP_MIN = 10;
/** 새로 못 받았을 때 오래된 값을 이만큼까지는 보여 준다 */
const STALE_OK_MS = 2 * 3600_000;

export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const key = (process.env.DATA_GO_KR_KEY ?? "").trim();
  if (!key) return Response.json({ error: "날씨 키가 없어요" }, { status: 503 });

  const q = new URL(req.url).searchParams;
  const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
  let here = q.get("lat") && q.get("lng") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? cellOf(lat, lng).at : null;
  if (!here) {
    const { family, homeCell } = await loadFamily(who.carId);
    here = familyHome(family, homeCell, who.demo ? DEMO_HOME_CELL : null);
  }
  if (!here) return Response.json({ error: "위치를 몰라요" }, { status: 503 });

  const { nx, ny } = latLngToGrid(here.lat, here.lng);
  // 한반도 격자(대략 1~149 × 1~253) 밖이면 기상청이 모름
  if (nx < 1 || nx > 149 || ny < 1 || ny > 253) return Response.json({ error: "우리나라 밖이에요" }, { status: 503 });

  try {
    const r = await cachedTour<SkyNow>(`sky:now:g${nx},${ny}`, KEEP_MIN, async () => {
      const { day, min } = kst(new Date());
      const got = await fetchUltraSrtNcst(key, nx, ny, day, min);
      if (!got) throw new Error("기상청 실황 실패");
      return got;
    });
    if (r.stale && Date.now() - new Date(r.data.at).getTime() > STALE_OK_MS) {
      return Response.json({ error: "날씨를 못 받았어요" }, { status: 503 });
    }
    return Response.json({ tempC: r.data.tempC, sky: r.data.sky, at: r.data.at });
  } catch (e) {
    console.error(`지금 날씨 실패 g${nx},${ny}`, e instanceof Error ? e.message : e);
    return Response.json({ error: "날씨를 못 받았어요" }, { status: 503 });
  }
}
