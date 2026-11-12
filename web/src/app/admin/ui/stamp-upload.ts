import { api } from "./AdminApp";

/**
 * 완성 도장 컬러·흑백 webp → R2 (서버가 판 번호·5분 PUT 주소를 정해 줌) → 명소/축제 도장 주소 저장.
 * '도장 올리기' 탭과 'AI로 도장 만들기' 카드가 같이 쓴다.
 */
export async function uploadStamp(o: { id: string; festival: boolean; color: Blob; bw: Blob }) {
  const put = async (body: Blob, bw: boolean) => {
    const u = await api<{ putUrl: string; publicUrl: string }>("POST", "/api/admin/upload-url",
      o.festival ? { festivalId: o.id, kind: "stamp", bw } : { placeId: o.id, bw });
    const r = await fetch(u.putUrl, { method: "PUT", body, headers: { "Content-Type": "image/webp" } });
    if (!r.ok) throw new Error(`저장소에 못 올렸어요 (${r.status})`);
    return u.publicUrl;
  };
  const url = await put(o.color, false);
  const bwUrl = await put(o.bw, true);
  const res = await api<{ stampVersion: number; version: number }>("POST", `/api/admin/${o.festival ? "festivals" : "places"}/${o.id}/stamp`, { url, bwUrl });
  return { url, bwUrl, stampVersion: res.stampVersion, version: res.version };
}
