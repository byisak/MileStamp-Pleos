-- 운영 반영용: 명소발굴 100x100 후보 표 (관리자 전용, 추가만 · 여러 번 돌려도 안전). schema.sql 끝 절과 같다.
--   psql "$DATABASE_URL" -f web/db/migrate-2026-11-12-spot100.sql
-- ------------------------------------------------------------------ 명소발굴 100x100 후보 (11/12)
-- 출처: 한국관광공사 시범 사이트 https://spot100x100.kr (data.js 9,883줄 → 같은 곳(이름+주소)을 합쳐 약 7,000곳).
-- 한 줄 설명은 관광공사 저작물이라 topics[].n 에 '관리자 참고용'으로만 둔다 — 폰·차·공개 API(/api/catalog, /api/car/places, /api/plan, /api/explore/*)는 이 표를 읽지 않는다.
-- key      = '이름|주소' (주소가 없으면 '이름|@위도,경도(소수 4자리)') — 같은 곳이 여러 주제에 나와도 한 줄
-- topics   = [{"t": 주제번호 0~99, "th": 테마번호 0~7, "r": 주제 안 순번, "n": 한 줄 설명}] (번호 뜻은 web/src/lib/spot100-meta.json)
-- sido     = 관광공사 시·도 코드('27' 대구…) · status = new(새것) / ok(괜찮음) / hidden(안 볼 것)
-- our_place_id = 관리자가 우리 명소와 묶은 값 (데이터를 다시 올려도 status·our_place_id는 지키고 나머지만 덮는다)
create table if not exists spot_candidates (
  key           text primary key,
  name          text not null,
  lat           double precision not null,
  lng           double precision not null,
  addr          text,
  sido          text,
  content_id    text,
  image         text,
  source_url    text,
  topics        jsonb not null default '[]'::jsonb,
  status        text not null default 'new' check (status in ('new', 'ok', 'hidden')),
  our_place_id  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists spot_candidates_sido on spot_candidates(sido);
create index if not exists spot_candidates_status on spot_candidates(status);
create index if not exists spot_candidates_topics on spot_candidates using gin (topics jsonb_path_ops);
alter table spot_candidates enable row level security;
