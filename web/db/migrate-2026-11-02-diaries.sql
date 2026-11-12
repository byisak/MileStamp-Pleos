-- 운영 반영용: '그날의 기록'(자동 일기) 표. schema.sql 끝 절과 같다 (여러 번 돌려도 안전).
--   psql "$DATABASE_URL" -f web/db/migrate-2026-11-02-diaries.sql
create table if not exists diaries (
  car_id      uuid not null references cars(id) on delete cascade,
  day         date not null,
  depart_min  smallint,
  story       jsonb,
  updated_at  timestamptz not null default now(),
  primary key (car_id, day)
);
alter table diaries enable row level security;
