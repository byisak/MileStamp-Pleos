import { sql } from "./db";
import { likeEscape, type SpotInput, type SpotQuery, type SpotRow, type SpotStatus } from "./spot100-shape";

/*
 * 명소발굴 100x100 후보 (표 spot_candidates, db/migrate-2026-11-12-spot100.sql) — 서버 쪽.
 * 관리자 API(/api/admin/spots)만 부른다. 폰·차·추천 엔진·공개 API에서는 절대 부르지 않는다 (한 줄 설명이 들어 있음).
 */

type Db = {
  key: string; name: string; lat: number; lng: number; addr: string | null; sido: string | null; content_id: string | null;
  image: string | null; source_url: string | null; topics: SpotRow["topics"]; status: SpotStatus; our_place_id: string | null;
};

const toRow = (r: Db): SpotRow => ({
  key: r.key, name: r.name, lat: r.lat, lng: r.lng, addr: r.addr, sido: r.sido, contentId: r.content_id, image: r.image,
  sourceUrl: r.source_url, topics: r.topics, status: r.status, ourPlaceId: r.our_place_id,
});

/** 표가 아직 없는 DB(마이그레이션 전)인가. */
export const isMissingTable = (e: unknown) => (e as { code?: string })?.code === "42P01";

export async function listSpots(q: SpotQuery) {
  const where = sql`true
    ${q.sido ? sql`and sido = ${q.sido}` : sql``}
    ${q.status ? sql`and status = ${q.status}` : sql``}
    ${q.hasCid === true ? sql`and content_id is not null` : q.hasCid === false ? sql`and content_id is null` : sql``}
    ${q.topic != null ? sql`and topics @> ${sql.json([{ t: q.topic }] as never)}` : sql``}
    ${q.theme != null ? sql`and topics @> ${sql.json([{ th: q.theme }] as never)}` : sql``}
    ${q.q ? sql`and (name ilike ${`%${likeEscape(q.q)}%`} or addr ilike ${`%${likeEscape(q.q)}%`})` : sql``}`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from spot_candidates where ${where}`;
  const rows = await sql<Db[]>`
    select key, name, lat, lng, addr, sido, content_id, image, source_url, topics, status, our_place_id
    from spot_candidates where ${where}
    order by jsonb_array_length(topics) desc, name, key
    limit ${q.size} offset ${(q.page - 1) * q.size}`;
  return { rows: rows.map(toRow), total: n };
}

/** 전체 숫자 (거르기 칩에 보이는 수): 시·도별·상태별·합계·contentId 있는 곳. */
export async function spotFacets() {
  const [bySido, byStatus, [t]] = await Promise.all([
    sql<{ k: string | null; n: number }[]>`select sido as k, count(*)::int as n from spot_candidates group by sido`,
    sql<{ k: string; n: number }[]>`select status as k, count(*)::int as n from spot_candidates group by status`,
    sql<{ total: number; cid: number }[]>`select count(*)::int as total, count(content_id)::int as cid from spot_candidates`,
  ]);
  return {
    total: t.total, withContentId: t.cid,
    sido: Object.fromEntries(bySido.map((r) => [r.k ?? "", r.n])),
    status: Object.fromEntries(byStatus.map((r) => [r.k, r.n])),
  };
}

/** 한꺼번에 올리기 (몇 번 올려도 같음). 관리자가 정한 status·our_place_id는 그대로 둔다. */
export async function importSpots(rows: SpotInput[]): Promise<number> {
  if (!rows.length) return 0;
  return sql.begin(async (tx) => {
    for (const r of rows) {
      await tx`
        insert into spot_candidates (key, name, lat, lng, addr, sido, content_id, image, source_url, topics)
        values (${r.key}, ${r.name}, ${r.lat}, ${r.lng}, ${r.addr}, ${r.sido}, ${r.cid}, ${r.img}, ${r.url}, ${sql.json(r.topics as never)})
        on conflict (key) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng, addr = excluded.addr,
          sido = excluded.sido, content_id = excluded.content_id, image = excluded.image, source_url = excluded.source_url,
          topics = excluded.topics, updated_at = now()`;
    }
    return rows.length;
  }) as Promise<number>;
}

export async function setSpotStatus(keys: string[], status: SpotStatus): Promise<number> {
  const r = await sql`update spot_candidates set status = ${status}, updated_at = now() where key = any(${keys})`;
  return r.count;
}

/** 우리 명소와 묶기(placeId) / 풀기(null). 묶으면 '괜찮음'으로, 풀면 상태는 그대로. */
export async function linkSpot(key: string, placeId: string | null): Promise<number> {
  const r = placeId
    ? await sql`update spot_candidates set our_place_id = ${placeId}, status = 'ok', updated_at = now() where key = ${key}`
    : await sql`update spot_candidates set our_place_id = null, updated_at = now() where key = ${key}`;
  return r.count;
}
