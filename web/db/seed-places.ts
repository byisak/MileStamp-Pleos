/*
 * 장소 씨앗(db/places.seed.json)을 DB places 표에 넣는다. 같은 id면 덮어쓴다(씨앗이 기준).
 * 실행: cd web && npm run seed:places   (.env.local의 DATABASE_URL, 없으면 로컬 postgres://localhost/milestamp)
 * 운영(Neon)에 넣을 때: DATABASE_URL='<Neon 주소>' npm run seed:places
 * 씨앗 만들기: python3 tools/places/make_seed.py
 * 관리자(/admin)에서 고친 장소(edited_at 있음)는 덮어쓰지 않는다 — 새 장소만 들어간다.
 */
import { COMPANION_TAG_CHOICES } from "../src/lib/planner";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../src/lib/db";

type Seed = {
  id: string; name: string; lat: number; lng: number; indoor: boolean; dwell: number; kidFit: number;
  open: string; close: string; popular: number; stampable: boolean;
  region?: string; group?: string; tags?: string[]; hours?: string; closed?: string | null; source?: string;
};

/** "09:30" → 570, "24:00" → 1440 (상시 개방의 닫는 시각). */
function clock(t: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  const v = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  if (!(v >= 0 && v <= 1440)) throw new Error(`시각 형식: ${t}`);
  return v;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const seeds = JSON.parse(readFileSync(join(here, "places.seed.json"), "utf8")) as Seed[];
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "postgres://localhost/milestamp";
  console.log(`대상 DB: ${url.replace(/\/\/[^@]*@/, "//***@")}`);

  for (const p of seeds) {
    await sql`
      insert into places (id, name, lat, lng, indoor, open_min, close_min, dwell_p80, kid_fit, stampable, popular,
                          region, grp, tags, hours, closed, source, active, updated_at)
      values (${p.id}, ${p.name}, ${p.lat}, ${p.lng}, ${p.indoor}, ${clock(p.open)}, ${clock(p.close)}, ${p.dwell}, ${p.kidFit},
              ${p.stampable}, ${p.popular}, ${p.region ?? null}, ${p.group ?? null}, ${p.tags ?? []}, ${p.hours ?? null},
              ${p.closed ?? null}, ${p.source ?? null}, true, now())
      on conflict (id) do update set
        name = excluded.name, lat = excluded.lat, lng = excluded.lng, indoor = excluded.indoor,
        open_min = excluded.open_min, close_min = excluded.close_min, dwell_p80 = excluded.dwell_p80, kid_fit = excluded.kid_fit,
        stampable = excluded.stampable, popular = excluded.popular, region = excluded.region, grp = excluded.grp,
        -- 동행 분위기 표시(tools/places/fit-seed.sql·관리자)는 남긴다: 씨앗 표시 + 예전 칸에만 있던 분위기 표시
        tags = excluded.tags || array(select t from unnest(places.tags) t
          where t = any(${COMPANION_TAG_CHOICES as unknown as string[]}) and not (t = any(excluded.tags))),
        hours = excluded.hours, closed = excluded.closed, source = excluded.source,
        active = true, updated_at = now()
      where places.edited_at is null`;
  }
  const ids = seeds.map((p) => p.id);
  const extra = await sql<{ id: string }[]>`select id from places where active and id <> all(${ids})`;
  const [{ n, stamps }] = await sql<{ n: number; stamps: number }[]>`
    select count(*)::int as n, count(*) filter (where stampable)::int as stamps from places where active`;
  console.log(`넣음 ${seeds.length}곳 → 추천 후보 ${n}곳 (도장 ${stamps}곳)`);
  if (extra.length) console.log(`씨앗에 없는 장소(그대로 둠): ${extra.map((r) => r.id).join(", ")}`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
