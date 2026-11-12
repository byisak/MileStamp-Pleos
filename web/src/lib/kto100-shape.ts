/*
 * 한국관광 100선 표 (curated_places) — 파일 읽기·SQL 만들기 (DB 없이, 시험은 kto100-shape.test.ts).
 *
 * 출처: 공공데이터포털 15003416 '한국관광공사_국내 관광지 정보(한국관광 100선)' (이용허락범위 제한 없음, 무료).
 *   2025-07-28 판은 표가 아니라 그림(PNG) 6장(2015~2026 판)이라, 2025~2026 판 그림을 사람이 옮겨 적은 표가
 *   tools/kto100/kto100-2025.tsv (좌표는 대표 지점 근사 — TourAPI 키가 있으면 tools/kto100/make-sql.mts가 채움).
 * 앱에 보이는 것은 이름 '한국관광 100선'과 우리 그림체 배지 '100선'뿐. 관광공사 로고·인증 도장 그림은 쓰지 않는다.
 */

export const KTO100_LIST = "kto100-2025";
export const KTO100_LABEL = "한국관광 100선";

export type CuratedRow = {
  no: number;
  name: string;
  area: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  addr: string | null;
  content_id: string | null;
  image: string | null;
  our_place_id: string | null;
};

/** 칸 이름 (한글·영문 둘 다 받음). */
const HEADERS: Record<string, keyof CuratedRow> = {
  no: "no", 순번: "no", 번호: "no", 연번: "no",
  name: "name", 이름: "name", 관광지: "name", 관광지명: "name", 명칭: "name",
  area: "area", 권역: "area",
  region: "region", 지역: "region", 시도: "region",
  lat: "lat", 위도: "lat", mapy: "lat",
  lng: "lng", 경도: "lng", mapx: "lng",
  addr: "addr", 주소: "addr",
  content_id: "content_id", contentid: "content_id", 콘텐츠id: "content_id",
  image: "image", 이미지: "image", 대표이미지: "image",
  our_place_id: "our_place_id", 명소id: "our_place_id",
};

/** CSV(쉼표, 따옴표 허용) 또는 TSV 한 줄씩 → 칸 목록. */
export function splitTable(text: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = src.split("\n", 1)[0] ?? "";
  const sep = firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ""));
}

/**
 * 표 글 → 줄 목록. 첫 줄은 칸 이름(이름/관광지 칸은 꼭). 순번이 없으면 줄 순서.
 * 이상한 줄은 errors에 (몇 번째 줄인지).
 */
export function parseCuratedTable(text: string): { rows: CuratedRow[]; errors: string[] } {
  const table = splitTable(text);
  const errors: string[] = [];
  if (table.length < 2) return { rows: [], errors: ["줄이 없어요 (첫 줄은 칸 이름)"] };
  const cols = table[0].map((h) => HEADERS[h.replace(/\s/g, "").toLowerCase()] ?? HEADERS[h.replace(/\s/g, "")] ?? null);
  if (!cols.includes("name")) return { rows: [], errors: ["'이름'(또는 관광지·name) 칸이 없어요"] };
  const rows: CuratedRow[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (k: keyof CuratedRow) => {
      const j = cols.indexOf(k);
      return j >= 0 ? (cells[j] ?? "").trim() : "";
    };
    const name = get("name");
    if (!name) { errors.push(`${line}번째 줄: 이름이 비었어요`); return; }
    if (seen.has(name)) { errors.push(`${line}번째 줄: '${name}'이 두 번 있어요`); return; }
    seen.add(name);
    const numOr = (s: string) => (s === "" ? null : Number(s));
    const lat = numOr(get("lat")), lng = numOr(get("lng"));
    if ((lat != null && !(Math.abs(lat) <= 90 && Number.isFinite(lat))) || (lng != null && !(Math.abs(lng) <= 180 && Number.isFinite(lng)))) {
      errors.push(`${line}번째 줄: 좌표가 이상해요`);
      return;
    }
    const no = Number(get("no"));
    const cid = get("content_id");
    rows.push({
      no: Number.isInteger(no) && no > 0 ? no : rows.length + 1,
      name: name.slice(0, 120),
      area: get("area") || null,
      region: get("region") || null,
      lat: lat != null && lng != null ? lat : null,
      lng: lat != null && lng != null ? lng : null,
      addr: get("addr") || null,
      content_id: /^\d+$/.test(cid) ? cid : null,
      image: /^https?:\/\//.test(get("image")) ? get("image").replace(/^http:\/\//, "https://") : null,
      our_place_id: /^[a-z][a-z0-9_]{1,23}$/.test(get("our_place_id")) ? get("our_place_id") : null,
    });
  });
  return { rows, errors };
}

const lit = (v: string | number | null) =>
  v == null ? "null" : typeof v === "number" ? String(v) : `'${v.replaceAll("'", "''")}'`;

/**
 * 같은 판을 몇 번 돌려도 같은 결과가 되는 SQL (insert … on conflict do update). 표에 없는 이름은 그 판에서 지운다.
 * our_place_id는 사람이 관리자에서 정한 값을 지우지 않게 새 값이 있을 때만 덮는다.
 */
export function curatedSql(list: string, rows: CuratedRow[]): string {
  const values = rows.map((r) =>
    `  (${[lit(list), r.no, lit(r.name), lit(r.content_id), r.lat ?? "null", r.lng ?? "null", lit(r.area), lit(r.region), lit(r.addr), lit(r.image), lit(r.our_place_id)].join(", ")})`);
  return [
    `-- ${list}: ${rows.length}곳 (tools/kto100/make-sql.mts가 만듦, 여러 번 돌려도 같음)`,
    "begin;",
    "insert into curated_places (list, no, name, content_id, lat, lng, area, region, addr, image, our_place_id) values",
    values.join(",\n"),
    "on conflict (list, name) do update set no = excluded.no,",
    "  content_id = coalesce(excluded.content_id, curated_places.content_id),",
    "  -- 서버에서 TourAPI로 채운 좌표(content_id 있음)는 근사값으로 되돌리지 않는다",
    "  lat = case when excluded.content_id is null and curated_places.content_id is not null then curated_places.lat else excluded.lat end,",
    "  lng = case when excluded.content_id is null and curated_places.content_id is not null then curated_places.lng else excluded.lng end,",
    "  addr = case when excluded.content_id is null and curated_places.content_id is not null then curated_places.addr else excluded.addr end,",
    "  area = excluded.area, region = excluded.region, image = coalesce(excluded.image, curated_places.image),",
    "  our_place_id = coalesce(excluded.our_place_id, curated_places.our_place_id), updated_at = now();",
    `delete from curated_places where list = ${lit(list)} and name not in (${rows.map((r) => lit(r.name)).join(", ")});`,
    "commit;",
    "",
  ].join("\n");
}

/** 표로 다시 쓰기 (TSV, 관리자 '지금 표 받기'와 도구가 씀). */
export function curatedTsv(rows: CuratedRow[]): string {
  const cols: (keyof CuratedRow)[] = ["no", "area", "region", "name", "lat", "lng", "addr", "content_id", "image", "our_place_id"];
  return [cols.join("\t"), ...rows.map((r) => cols.map((c) => (r[c] == null ? "" : String(r[c]).replace(/[\t\n]/g, " "))).join("\t"))].join("\n") + "\n";
}
