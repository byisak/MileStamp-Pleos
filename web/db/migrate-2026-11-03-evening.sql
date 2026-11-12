-- 운영 반영용: 저녁 나들이 (docs/장소-데이터-구조-계획.md §7). schema.sql 끝 절과 같다 (추가만, 여러 번 돌려도 안전).
--   psql "$DATABASE_URL" -f web/db/migrate-2026-11-03-evening.sql
--   그다음 (선택) web/db/seed-2026-11-03-evening.sql — 대구·경북 저녁 칸 처음 값
-- 가족 설정에 귀가 기준 두 개 (분, 0시부터). 비어 있으면(null) 기본값으로 계산한다.
--   bedtime_min     아이 잠자는 시간 — 아이와 저녁 나들이는 이 시각 전에 집 도착 (기본 21:00 = 1260)
--   late_return_min 어른끼리 '늦어도 몇 시 귀가' — 어른끼리 낮·저녁 귀가 한계 (기본 23:00 = 1380, 예전 22:00 고정 대신)
-- 저녁 카드는 해 진 뒤 ~ 이 시각 90분 전까지. 그 뒤는 '내일 미리'.
alter table families add column if not exists bedtime_min smallint;
alter table families add column if not exists late_return_min smallint;
do $$ begin
  alter table families add constraint families_bedtime_check check (bedtime_min is null or bedtime_min between 1080 and 1380);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table families add constraint families_late_return_check check (late_return_min is null or late_return_min between 1140 and 1439);
exception when duplicate_object then null; end $$;
