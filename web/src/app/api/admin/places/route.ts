import { adminGuard } from "@/lib/admin-auth";
import { catalogVersion, createPlace, loadAdminPlaces } from "@/lib/catalog";
import { ALBUM_GROUPS } from "@/lib/catalog-shape";

/** 관리자: 명소 전체(추천에서 뺀 곳 포함) + 목록 버전. */
export async function GET() {
  const deny = await adminGuard();
  if (deny) return deny;
  const [places, version] = await Promise.all([loadAdminPlaces(), catalogVersion()]);
  return Response.json({ places, version });
}

/** 관리자: 새 명소 { id, name, lat, lng, album } — 처음엔 추천에서 빠진 상태. */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(b.id ?? "").trim();
  const name = String(b.name ?? "").trim();
  const lat = Number(b.lat), lng = Number(b.lng);
  const album = ALBUM_GROUPS.some((g) => g.key === b.album) ? String(b.album) : "weekend";
  if (!/^[a-z][a-z0-9_]{1,23}$/.test(id)) return Response.json({ error: "id는 영문 소문자·숫자 2~24자예요" }, { status: 400 });
  if (!name) return Response.json({ error: "이름을 적어 주세요" }, { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Response.json({ error: "좌표가 필요해요" }, { status: 400 });
  const version = await createPlace(id, name, lat, lng, album);
  if (version === null) return Response.json({ error: "같은 id가 이미 있어요" }, { status: 409 });
  const places = await loadAdminPlaces();
  return Response.json({ place: places.find((p) => p.id === id), version });
}
