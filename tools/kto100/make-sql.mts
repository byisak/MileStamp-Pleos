/*
 * 한국관광 100선 표 → 여러 번 돌려도 같은 SQL (curated_places).
 *
 *   cd web && node --env-file-if-exists=.env.local --import tsx ../tools/kto100/make-sql.mts
 *   → tools/kto100/kto100-2025.sql  (운영: psql "$DATABASE_URL" -f tools/kto100/kto100-2025.sql)
 *
 * 입력 tools/kto100/kto100-2025.tsv = 공공데이터포털 15003416 2025~2026 판 그림(source-2025-2026.png)을 옮겨 적은 100곳.
 * 좌표는 대표 지점 근사. 환경 변수 DATA_GO_KR_KEY가 있으면 TourAPI searchKeyword2로 contentid·좌표·주소·사진을 채우고
 * TSV도 채운 값으로 다시 쓴다(이름이 맞는 관광지·문화시설만, 못 찾으면 근사값 그대로). 키가 없으면 그대로 SQL만.
 * 서버에 올린 뒤에는 관리자 '100선' 칸의 'TourAPI로 채우기'로도 같은 일을 할 수 있다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { namesMatch } from "../../web/src/lib/explore-shape";
import { curatedSql, curatedTsv, KTO100_LIST, parseCuratedTable } from "../../web/src/lib/kto100-shape";
import { parseTourPage, SEARCH_TYPES, tourError, tourUrl, type TourItem } from "../../web/src/lib/tourapi-shape";

const here = dirname(fileURLToPath(import.meta.url));
const tsvPath = join(here, "kto100-2025.tsv");
const { rows, errors } = parseCuratedTable(readFileSync(tsvPath, "utf8"));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (rows.length !== 100) console.warn(`주의: ${rows.length}곳 (100곳이 아님)`);

async function lookup(key: string, name: string): Promise<TourItem | null> {
  const first = name.replace(/\([^)]*\)/g, "").split(/[&,]/)[0].trim();
  for (const t of SEARCH_TYPES) {
    const res = await fetch(tourUrl("searchKeyword2", key, { keyword: first, contentTypeId: t, arrange: "A", numOfRows: "30", pageNo: "1" }));
    const json = JSON.parse(await res.text());
    const err = tourError(json);
    if (err) throw new Error(err);
    const hit = parseTourPage(json).items.find((x) => namesMatch(x.title, name) && x.lat != null);
    if (hit) return hit;
  }
  return null;
}

const key = process.env.DATA_GO_KR_KEY;
if (key) {
  let n = 0;
  for (const r of rows) {
    if (r.content_id) continue;
    try {
      const t = await lookup(key, r.name);
      if (t) {
        Object.assign(r, { content_id: t.contentId, lat: t.lat, lng: t.lng, addr: t.addr || r.addr, image: t.image ?? r.image });
        n++;
      } else console.warn(`못 찾음: ${r.name}`);
    } catch (e) {
      console.error(`TourAPI 실패 (${r.name}): ${(e as Error).message}`);
      break;
    }
  }
  writeFileSync(tsvPath, curatedTsv(rows));
  console.log(`TourAPI로 ${n}곳 채움 → ${tsvPath}`);
} else {
  console.log("DATA_GO_KR_KEY 없음 → 근사 좌표 그대로 (contentid 없음 → 앱 id 'ext:kto100:<순번>')");
}
const out = join(here, "kto100-2025.sql");
writeFileSync(out, curatedSql(KTO100_LIST, rows));
console.log(`${rows.length}곳 → ${out}`);
