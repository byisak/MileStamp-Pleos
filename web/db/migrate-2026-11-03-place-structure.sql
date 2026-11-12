-- 운영 반영용: 장소 구조 칸 (entity_hours·tag_vocab 표 + places 칸 8개). schema.sql 끝 절과 같다 (여러 번 돌려도 안전).
--   psql "$DATABASE_URL" -f web/db/migrate-2026-11-03-place-structure.sql
--   그다음 web/db/backfill-2026-11-03-place-structure.sql (예전 칸 → 새 칸 옮기기)
-- 추천에 쓰는 정보는 정해진 칸으로. 자유 글(hours·closed·note)은 화면 표시용으로만 남긴다. 모양 검사는 web/src/lib/place-attrs-shape.ts.
-- 운영 시간 줄: 한 곳에 여러 줄(평일/주말/여름 야간). 엔진은 그날 요일·날짜에 맞는 줄 하나를 고른다 (공휴일 줄 → 요일 줄,
--   같은 무리에선 기간(valid_from~valid_to, 'MM-DD' 해마다, 해를 넘겨도 됨) 있는 줄이 먼저). 맞는 줄이 없으면 그날 쉰다.
--   시각은 0시부터 분, 자정 넘김은 1440 이상(최대 2160). breaks = [{fromMin, toMin}] (식당 브레이크타임).
--   places.open_min·close_min은 저장 때 평일 대표값으로 다시 채운다 (옛 앱용, representativeHours).
create table if not exists entity_hours (
  id              bigserial primary key,
  entity_kind     text not null check (entity_kind in ('place', 'restaurant', 'festival')),
  entity_id       text not null,
  days            smallint[] not null default '{}',
  holiday         boolean not null default false,
  open_min        smallint not null check (open_min >= 0 and open_min < 1440),
  close_min       smallint not null check (close_min <= 2160),
  last_entry_min  smallint,
  breaks          jsonb not null default '[]'::jsonb,
  valid_from      text check (valid_from is null or valid_from ~ '^\d{2}-\d{2}$'),
  valid_to        text check (valid_to is null or valid_to ~ '^\d{2}-\d{2}$'),
  note            text,
  sort            smallint not null default 0,
  check (close_min > open_min),
  check (last_entry_min is null or (last_entry_min > open_min and last_entry_min <= close_min)),
  check ((valid_from is null) = (valid_to is null))
);
create index if not exists entity_hours_entity on entity_hours(entity_kind, entity_id, sort);
alter table entity_hours enable row level security;

-- parking  = {has: yes|no|limited, kind: own|public|street, fee: free|paid|partial, fee_note, size: S|M|L, weekend_full, walk_min, ev}
-- price    = {free, adult, child, child_free_under, level: 0 무료 · 1 1만 원 안쪽(가족) · 2 3만 원 안쪽 · 3 그 이상}
-- moments  = {best: [day|sunset|night], light: {on: 'sunset+15'|'HH:MM', off}, shows: [{name, times[], days[], months[]}], season: [{what, months[]}]}
-- closed_rules = 정해진 말만 (newyear · seollal · seollal_all · chuseok · chuseok_all · holiday · holiday_next · holiday_shift) — 서버가 날짜로 펴서 closedDates에 더한다
-- region_code  = 법정동 시군구 5자리 (관광공사 lDongRegnCd + lDongSignguCd, 대구 북구 27230). 자유 글 region은 표시용
-- meta     = 칸마다 출처 {hours: {src: admin|tourapi|ai|tip|seed, conf: 0~1, at: 'YYYY-MM-DD', check?: true}, …} — check = 관리자 확인 필요
-- kind     = spot(일반) · view(전망대) · market(시장·야시장) · drive(야경 드라이브 길 — route = {points: [{lat,lng,name}], pass_min, rest_place_id})
-- fit jsonb는 그대로 두고 kid_age {"0-3","4-6","7-9","10+"}·evening {kids,couple,friends,solo} 칸을 더해 쓴다 (0~1)
alter table places add column if not exists parking jsonb;
alter table places add column if not exists price jsonb;
alter table places add column if not exists moments jsonb;
alter table places add column if not exists closed_rules text[] not null default '{}';
alter table places add column if not exists region_code text;
alter table places add column if not exists meta jsonb not null default '{}'::jsonb;
alter table places add column if not exists kind text not null default 'spot';
alter table places add column if not exists route jsonb;
do $$ begin
  alter table places add constraint places_kind_check check (kind in ('spot', 'view', 'market', 'drive'));
exception when duplicate_object then null; end $$;

-- 태그 단어장: 추천은 여기 있는 말만 쓴다 (예전 자유 태그는 표시용으로 남김). 관리자 화면은 단어장에서만 고르고, 새 말은 단어장에 더한다.
-- 같은 말이 두 묶음에 있을 수 있다 (야경: 경치·저녁). '엔진' 묶음 = 지금 추천 가점에 쓰는 말(드라이브·액티비티).
create table if not exists tag_vocab (
  tag       text not null,
  category  text not null,
  sort      smallint not null default 0,
  primary key (tag, category)
);
alter table tag_vocab enable row level security;
insert into tag_vocab (tag, category, sort) values
  ('야경', '경치', 10), ('노을', '경치', 11), ('호수', '경치', 12), ('강', '경치', 13), ('숲', '경치', 14), ('산', '경치', 15), ('전망', '경치', 16), ('꽃', '경치', 17), ('단풍', '경치', 18),
  ('체험', '할 것', 30), ('놀이', '할 것', 31), ('산책', '할 것', 32), ('자전거', '할 것', 33), ('물놀이', '할 것', 34), ('만들기', '할 것', 35), ('동물', '할 것', 36),
  ('박물관', '배움', 50), ('과학', '배움', 51), ('역사', '배움', 52), ('전시', '배움', 53), ('공연', '배움', 54),
  ('조용함', '분위기', 70), ('데이트', '분위기', 71), ('사진 명소', '분위기', 72), ('활동적', '분위기', 73), ('카페', '분위기', 74),
  ('야경', '저녁', 90), ('야시장', '저녁', 91), ('분수쇼', '저녁', 92), ('조명', '저녁', 93),
  ('드라이브', '엔진', 110), ('액티비티', '엔진', 111)
on conflict (tag, category) do nothing;
