import { adminGuard } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { festivalKey, presignPut, publicUrl, r2Ready, stampKey } from "@/lib/r2";
import { festivalVersions } from "@/lib/festivals";

/** 관리자: 저장소(R2)가 연결됐는지. */
export async function GET() {
  const deny = await adminGuard();
  if (deny) return deny;
  return Response.json({ ready: r2Ready() });
}

/**
 * 관리자: 도장 그림 올릴 주소 { placeId, bw } → { putUrl, publicUrl, version }.
 * 축제는 { festivalId, kind: 'poster' | 'stamp', bw } (포스터는 /api/admin/festivals/<id>/poster, 도장은 …/stamp 로 저장).
 * 판 번호는 서버가 정한다 (지금 stamp_version + 1). 브라우저는 putUrl에 Content-Type: image/webp로 PUT,
 * 컬러·흑백 둘 다 올린 뒤 /api/admin/places/<id>/stamp 로 주소를 저장한다.
 */
export async function POST(req: Request) {
  const deny = await adminGuard();
  if (deny) return deny;
  if (!r2Ready()) return Response.json({ error: "저장소(R2) 연결이 필요해요" }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { placeId?: string; bw?: boolean; festivalId?: string; kind?: string };
  if (b.festivalId) {
    // 축제: 포스터(festivals/<id>/poster-<판>.webp) 또는 한정 도장(festivals/<id>/stamp-<판>.webp · _bw)
    const fid = String(b.festivalId);
    const kind = b.kind === "poster" ? "poster" : "stamp";
    const v = await festivalVersions(fid);
    if (!v) return Response.json({ error: "그런 축제가 없어요" }, { status: 404 });
    const version = (kind === "poster" ? v.poster_version : v.stamp_version) + 1;
    const key = festivalKey(fid, kind, version, !!b.bw);
    return Response.json({ putUrl: await presignPut(key), publicUrl: publicUrl(key), version });
  }
  const id = String(b.placeId ?? "");
  const [p] = await sql<{ stamp_version: number }[]>`select stamp_version from places where id = ${id}`;
  if (!p) return Response.json({ error: "그런 명소가 없어요" }, { status: 404 });
  const version = p.stamp_version + 1;
  const key = stampKey(id, version, !!b.bw);
  return Response.json({ putUrl: await presignPut(key), publicUrl: publicUrl(key), version });
}
