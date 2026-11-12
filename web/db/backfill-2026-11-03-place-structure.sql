-- 장소 구조 칸 처음 값 채우기 (docs/장소-데이터-구조-계획.md 1단계). migrate-2026-11-03-place-structure.sql 다음에 돌린다.
--   psql "$DATABASE_URL" -f web/db/backfill-2026-11-03-place-structure.sql
-- 여러 번 돌려도 안전: 이미 값이 있는 칸·운영 시간 줄이 있는 곳은 건드리지 않는다. 예전 칸(open_min·close_min·tags·facilities)은 그대로 둔다.
-- 출처는 meta에 src 'seed'(조사)로, 짐작이 섞인 값은 check true(관리자 확인 필요)로 남긴다.

begin;

-- ① 운영 시간 줄: 예전 하루 시각 → 매일 한 줄 (계산 결과는 예전과 같다). 조사 원문이 요일·계절·마감을 말하면 '확인 필요'.
insert into entity_hours (entity_kind, entity_id, days, open_min, close_min, sort)
select 'place', p.id, '{0,1,2,3,4,5,6}', p.open_min, p.close_min, 0
from places p
where p.close_min > p.open_min and p.open_min < 1440
  and not exists (select 1 from entity_hours h where h.entity_kind = 'place' and h.entity_id = p.id);

update places set meta = meta || jsonb_build_object('hours', jsonb_build_object(
    'src', 'seed', 'conf', 0.6, 'at', to_char(current_date, 'YYYY-MM-DD'),
    'check', coalesce(hours ~ '(월|평일|주말|토|하절기|동절기|춘추기|마감|시즌|상이|미확인)', false)))
  where not (meta ? 'hours');

-- ② 쉬는 날: 예전 쉬는 요일이 있거나 원문이 '연중무휴'면 확인된 값으로, 원문에 설·추석·1월 1일·공휴일 말이 있으면 규칙은 비워 두고 '확인 필요'
--    (규칙 고르기는 관리자 화면 '조사 원문에서 채우기'가 읽어 준다)
update places set meta = meta || jsonb_build_object('closed', jsonb_build_object(
    'src', 'seed', 'conf', 0.6, 'at', to_char(current_date, 'YYYY-MM-DD'),
    'check', coalesce(closed ~ '(설|추석|1월\s*1일|공휴일|미확인|상이)', true)))
  where not (meta ? 'closed') and (closed is not null or cardinality(closed_days) > 0);

-- ③ 무료 태그 → price.free (태그는 남긴다)
update places set price = '{"free": true, "level": 0}'::jsonb,
                  meta = meta || jsonb_build_object('price', jsonb_build_object('src', 'seed', 'conf', 0.6, 'at', to_char(current_date, 'YYYY-MM-DD'), 'check', true))
  where price is null and '무료' = any(tags);

-- ④ 시설 칩 '주차장' → parking.has yes (요금·크기는 모름)
update places set parking = '{"has": "yes"}'::jsonb,
                  meta = meta || jsonb_build_object('parking', jsonb_build_object('src', 'seed', 'conf', 0.5, 'at', to_char(current_date, 'YYYY-MM-DD'), 'check', true))
  where parking is null and '주차장' = any(facilities);

-- ⑤ 지역 글 '대구 북구 침산동' → region_code (법정동 시군구 5자리, place-attrs-shape.ts REGION_CODES와 같은 표).
--    지역 글이 없고 태그에 '북구' 같은 구 이름만 있으면 대구로 본다 (장소가 모두 대구·경북).
with codes(name, code) as (values
  ('대구 중구', '27110'), ('대구 동구', '27140'), ('대구 서구', '27170'), ('대구 남구', '27200'), ('대구 북구', '27230'),
  ('대구 수성구', '27260'), ('대구 달서구', '27290'), ('대구 달성군', '27710'), ('대구 군위군', '27720'),
  ('경북 포항시', '47110'), ('경북 경주시', '47130'), ('경북 김천시', '47150'), ('경북 안동시', '47170'), ('경북 구미시', '47190'),
  ('경북 영주시', '47210'), ('경북 영천시', '47230'), ('경북 상주시', '47250'), ('경북 문경시', '47280'), ('경북 경산시', '47290'),
  ('경북 의성군', '47730'), ('경북 청송군', '47750'), ('경북 영양군', '47760'), ('경북 영덕군', '47770'), ('경북 청도군', '47820'),
  ('경북 고령군', '47830'), ('경북 성주군', '47840'), ('경북 칠곡군', '47850'), ('경북 예천군', '47900'), ('경북 봉화군', '47920'),
  ('경북 울진군', '47930'), ('경북 울릉군', '47940')
)
update places p set region_code = c.code,
                    meta = p.meta || jsonb_build_object('region', jsonb_build_object('src', 'seed', 'conf', 0.9, 'at', to_char(current_date, 'YYYY-MM-DD')))
  from codes c
  where p.region_code is null
    and (c.name = split_part(p.region, ' ', 1) || ' ' || split_part(p.region, ' ', 2)
         or (p.region is null and ('대구 ' || (select t from unnest(p.tags) t where t ~ '^(중|동|서|남|북|수성|달서)구$' limit 1)) = c.name));

commit;

-- 확인용 (바꾸지 않음): 태그 '실내'인데 indoor가 아닌 곳 — 관리자 화면에서 실내·야외를 골라 주세요
select id, name, indoor, tags from places where '실내' = any(tags) and not indoor;
