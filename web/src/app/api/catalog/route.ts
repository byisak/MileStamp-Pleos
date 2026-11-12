import { loadCatalog } from "@/lib/catalog";
import { loadCatalogFestivals } from "@/lib/festivals";

/**
 * 앱(폰·차)용 명소 목록. 공개 (좌표는 명소 것뿐, 가족 정보 없음).
 * GET /api/catalog?since=N → since가 지금 버전과 같으면 { version, unchanged: true }, 아니면 전체
 * { version, places[], groups[], restaurants[], festivals[] }. 앱은 받은 것을 저장해 두고 다음에 since로 묻는다.
 * festivals = 켜진 축제 중 끝난 지 1년 안 (진행 중·예정 + 도장북 '지난 축제'), status는 오늘(한국) 기준 — 앱도 날짜로 다시 본다.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("since");
  const since = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
  const body = await loadCatalog(since);
  if ("unchanged" in body) return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  const festivals = await loadCatalogFestivals();
  return Response.json({ ...body, festivals }, { headers: { "Cache-Control": "no-store" } });
}
