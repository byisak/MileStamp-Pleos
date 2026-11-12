-- 운영 반영용: 식당 구조 + 식사 넣기 (docs/장소-데이터-구조-계획.md §2.3·§4·§5.3). schema.sql 끝 절과 같다 (추가만, 여러 번 돌려도 안전).
--   먼저 migrate-2026-11-03-place-structure.sql (entity_hours·tag_vocab 표)이 돌아 있어야 한다.
--   psql "$DATABASE_URL" -f web/db/migrate-2026-11-03-restaurants.sql
-- ------------------------------------------------------------------ 식당 구조 + 식사 넣기 (11/3, docs/장소-데이터-구조-계획.md §2.3·§4 — migrate-2026-11-03-restaurants.sql과 같음)
-- 추가만, 여러 번 돌려도 안전. 모양 검사는 web/src/lib/restaurant-shape.ts, 엔진 쓰임은 engine Meals.kt = web planner.ts planMeal.
-- restaurants 새 칸:
--   cuisine   음식 종류 1~2개 (한식·분식·면·고기·국밥·해물·카페·베이커리·양식·중식·일식·뷔페)
--   price     {level: 0~3} (1인) · kid {kids_menu, high_chair, play_room, floor_seat, stroller_ok, spicy_free_menu: true}
--   parking   장소와 같은 모양 {has, kind, fee, fee_note, size, weekend_full, walk_min, ev}
--   wait      {weekday, weekend_lunch, weekend_dinner: 0 바로 · 1 조금 · 2 오래}
--   reserve   none·phone·app · meal 식사 자리 [lunch, dinner, snack] (비면 카페·베이커리는 snack, 그 밖은 점심·저녁)
--   dwell_min 머무름(분, 비면 50 · 카페 30) · fit {kids, couple, friends, solo: 0~1} · tags 단어장 '식당' 묶음
--   meta      칸마다 출처 {location|hours|parking|…: {src: admin|kakao|ai|tip|seed, conf, at, check?}} — check = 관리자 확인 필요
--   kakao_id  카카오 장소 번호 (근처 식당 가져오기 — 같은 번호는 한 번만) · phone · address · url(카카오 지도)
-- 운영 시간은 entity_hours (entity_kind 'restaurant', entity_id = 식당 id 글자) — 브레이크(breaks)·마지막 주문(last_order_min).
-- 새로 넣는 식당은 좌표가 꼭 있어야 한다 (예전 줄은 그대로 두려고 not valid).
alter table restaurants add column if not exists cuisine text[] not null default '{}';
alter table restaurants add column if not exists price jsonb;
alter table restaurants add column if not exists kid jsonb;
alter table restaurants add column if not exists parking jsonb;
alter table restaurants add column if not exists wait jsonb;
alter table restaurants add column if not exists reserve text;
alter table restaurants add column if not exists meal text[] not null default '{}';
alter table restaurants add column if not exists dwell_min smallint;
alter table restaurants add column if not exists fit jsonb;
alter table restaurants add column if not exists tags text[] not null default '{}';
alter table restaurants add column if not exists meta jsonb not null default '{}'::jsonb;
alter table restaurants add column if not exists kakao_id text;
alter table restaurants add column if not exists phone text;
alter table restaurants add column if not exists address text;
alter table restaurants add column if not exists url text;
create unique index if not exists restaurants_kakao_id on restaurants(kakao_id) where kakao_id is not null;
create index if not exists restaurants_place on restaurants(place_id);
do $$ begin
  alter table restaurants add constraint restaurants_latlng_required check (lat is not null and lng is not null) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table restaurants add constraint restaurants_reserve_check check (reserve is null or reserve in ('none', 'phone', 'app'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table restaurants add constraint restaurants_dwell_check check (dwell_min is null or dwell_min between 15 and 120);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table restaurants add constraint restaurants_cuisine_check check (cardinality(cuisine) <= 2);
exception when duplicate_object then null; end $$;

-- 운영 시간 줄에 마지막 주문 (식당만 씀, 분)
alter table entity_hours add column if not exists last_order_min smallint;
do $$ begin
  alter table entity_hours add constraint entity_hours_last_order_check
    check (last_order_min is null or (last_order_min > open_min and last_order_min <= close_min));
exception when duplicate_object then null; end $$;

-- 식당 태그 단어장 (묶음 '식당'). 동행 가점: 아이랑(아이와) · 뷰 맛집(연인) · 노포(친구) · 혼밥(혼자)
insert into tag_vocab (tag, category, sort) values
  ('아이랑', '식당', 130), ('뷰 맛집', '식당', 131), ('노포', '식당', 132), ('혼밥', '식당', 133), ('주차 쉬움', '식당', 134),
  ('데이트', '식당', 135), ('단체', '식당', 136)
on conflict (tag, category) do nothing;

-- 가족 설정 '밥도 같이 짜기' (기본 끔 — 사용자 결정 11/3). 계획마다 켤 수도 있다 (/api/plan?meal=1).
alter table families add column if not exists meal_plan boolean not null default false;
-- 이 계획을 밥 켬으로 짰나 (같은 조건일 때만 계획을 다시 쓴다)
alter table plans add column if not exists meal boolean not null default false;
