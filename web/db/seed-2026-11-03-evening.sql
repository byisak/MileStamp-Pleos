-- 저녁 나들이 처음 값 — 대구·경북 저녁 명소·야경 드라이브 29곳 (docs/장소-데이터-구조-계획.md §7, proto/evening-plan.html)
--   psql "$DATABASE_URL" -f web/db/migrate-2026-11-03-place-structure.sql   (1단계, 이미 했으면 건너뜀)
--   psql "$DATABASE_URL" -f web/db/migrate-2026-11-03-evening.sql
--   psql "$DATABASE_URL" -f web/db/seed-2026-11-03-evening.sql
-- 여러 번 돌려도 안전: 이미 있는 명소는 시간 특성(moments)·저녁 어울림(fit.evening)이 비어 있을 때만 채우고,
-- 새 곳은 없을 때만 넣는다(on conflict do nothing). 관리자가 고친 값은 덮어쓰지 않는다.
--
-- 값은 널리 알려진 사실로만 짐작해 넣었다. 출처 meta.src = 'seed'(조사), 짐작이 섞인 칸은 check = true(관리자 확인 필요).
--  · 쇼 시각(분수쇼 등)은 확실하지 않아 모두 비워 두었다 (shows 없음) → 관리자 화면 '시간 특성'에서 넣으면 엔진이 '7시 분수 보러'로 맞춘다.
--  · 조명 켜지는 시각을 모르면 light 칸 없음 → 엔진은 해 지는 시각을 조명 시각으로 본다.
--  · 새 곳 좌표·운영 시각은 대략값(check true). 도장 그림이 없어 stampable = false ('다녀옴'으로 남음, '밤의 ○○' 도장도 없음).
--  · 드라이브 길(kind = 'drive')의 지나갈 점은 길의 대략 위치 — 엔진은 첫 점에서 들어가 끝 점에서 나오고, 머무름 = pass_min.

begin;

-- ① 이미 있는 명소: 언제 좋은지 · 저녁 어울림 (비어 있을 때만)
with ev(id, moments, evening, chk) as (values
  ('suseongmot', '{"best": ["sunset", "night"]}'::jsonb,           '{"kids": 0.75, "couple": 0.95, "friends": 0.8, "solo": 0.8}'::jsonb, true),
  ('eworld',     '{"best": ["day", "night"]}'::jsonb,              '{"kids": 0.8, "couple": 0.95, "friends": 0.95, "solo": 0.5}'::jsonb, true),
  ('duryu',      '{"best": ["day", "night"]}'::jsonb,              '{"kids": 0.6, "couple": 0.8, "friends": 0.6, "solo": 0.75}'::jsonb, true),
  ('chimsan',    '{"best": ["sunset", "night"]}'::jsonb,           '{"kids": 0.55, "couple": 0.8, "friends": 0.6, "solo": 0.8}'::jsonb, true),
  ('unamji',     '{"best": ["day", "sunset", "night"]}'::jsonb,    '{"kids": 0.65, "couple": 0.8, "friends": 0.5, "solo": 0.75}'::jsonb, true),
  ('aayang',     '{"best": ["sunset", "night"]}'::jsonb,           '{"kids": 0.6, "couple": 0.85, "friends": 0.65, "solo": 0.8}'::jsonb, true),
  ('thearc',     '{"best": ["day", "sunset", "night"]}'::jsonb,    '{"kids": 0.5, "couple": 0.9, "friends": 0.7, "solo": 0.8}'::jsonb, true),
  ('songhae',    '{"best": ["day", "night"]}'::jsonb,              '{"kids": 0.6, "couple": 0.75, "friends": 0.6, "solo": 0.7}'::jsonb, true),
  ('bullo',      '{"best": ["day", "sunset"]}'::jsonb,             null::jsonb,                                                          true),
  ('hajungdo',   '{"best": ["day", "sunset"]}'::jsonb,             null::jsonb,                                                          true),
  ('samunjin',   '{"best": ["day", "sunset"]}'::jsonb,             null::jsonb,                                                          true),
  -- 늦게 여는 실내 (저녁 어울림만 — 밤 명소는 아님): 아쿠아리움은 평일 20:00·주말 20:30까지 (조사 원문)
  ('aquarium',   '{"best": ["day"]}'::jsonb,                       '{"kids": 0.8, "couple": 0.75, "friends": 0.6, "solo": 0.5}'::jsonb, false)
)
update places p set
  moments = coalesce(p.moments, ev.moments),
  fit = case when ev.evening is null or (p.fit ? 'evening') then p.fit else coalesce(p.fit, '{}'::jsonb) || jsonb_build_object('evening', ev.evening) end,
  meta = p.meta
    || case when p.meta ? 'moments' then '{}'::jsonb else jsonb_build_object('moments', jsonb_build_object('src', 'seed', 'conf', 0.6, 'at', to_char(current_date, 'YYYY-MM-DD'), 'check', ev.chk)) end
    || case when ev.evening is null or (p.meta ? 'fit') then '{}'::jsonb else jsonb_build_object('fit', jsonb_build_object('src', 'seed', 'conf', 0.5, 'at', to_char(current_date, 'YYYY-MM-DD'), 'check', true)) end
from ev
where p.id = ev.id and p.edited_at is null;

-- ② 새 저녁 명소 (도장 없음 · '다녀옴'). 좌표·시각은 대략값 → 확인 필요
insert into places (id, name, lat, lng, indoor, open_min, close_min, dwell_p80, kid_fit, stampable, active, region, grp, tags, hours, closed, source,
                    fit, dwell_adult, kind, moments, region_code, meta)
values
  ('apsan-view', '앞산전망대', 35.8296, 128.5860, false, 0, 1440, 50, 0.5, false, true, '대구 남구 대명동', '저녁',
   '{야경,전망,산,노을}', '전망대는 늘 열림 · 케이블카 운행 시간 확인 필요', null, 'seed-evening',
   '{"couple": 0.9, "friends": 0.75, "solo": 0.8, "evening": {"kids": 0.45, "couple": 0.95, "friends": 0.8, "solo": 0.85}}', 60, 'view',
   '{"best": ["sunset", "night"]}', '27200', '{}'),
  ('kimkwangseok', '김광석다시그리기길', 35.8601, 128.6066, false, 0, 1440, 45, 0.4, false, true, '대구 중구 대봉동', '저녁',
   '{산책,벽화,공연,야경}', '골목은 늘 열림 (가게 시간은 다름)', null, 'seed-evening',
   '{"couple": 0.85, "friends": 0.8, "solo": 0.75, "evening": {"kids": 0.4, "couple": 0.85, "friends": 0.8, "solo": 0.7}}', 45, 'spot',
   '{"best": ["day", "night"]}', '27110', '{}'),
  ('seomun-night', '서문시장 야시장', 35.8690, 128.5815, false, 1140, 1380, 50, 0.55, false, true, '대구 중구 대신동', '저녁',
   '{야시장,먹거리,야경}', '저녁에 엶 (요일·시각 확인 필요)', '확인 필요', 'seed-evening',
   '{"couple": 0.8, "friends": 0.9, "solo": 0.6, "evening": {"kids": 0.55, "couple": 0.8, "friends": 0.9, "solo": 0.6}}', 50, 'market',
   '{"best": ["night"]}', '27110', '{}'),
  ('chilseong-night', '칠성야시장', 35.8775, 128.6035, false, 1080, 1380, 45, 0.5, false, true, '대구 북구 칠성동', '저녁',
   '{야시장,먹거리,강,야경}', '저녁에 엶 (요일·시각 확인 필요)', '확인 필요', 'seed-evening',
   '{"couple": 0.8, "friends": 0.85, "solo": 0.6, "evening": {"kids": 0.5, "couple": 0.8, "friends": 0.85, "solo": 0.6}}', 45, 'market',
   '{"best": ["night"]}', '27230', '{}'),
  ('dongchon', '동촌유원지', 35.8819, 128.6533, false, 0, 1440, 45, 0.6, false, true, '대구 동구 효목동', '저녁',
   '{강,산책,다리,야경}', '늘 열림', '연중무휴', 'seed-evening',
   '{"couple": 0.8, "friends": 0.65, "solo": 0.75, "evening": {"kids": 0.6, "couple": 0.85, "friends": 0.65, "solo": 0.75}}', 40, 'spot',
   '{"best": ["day", "sunset", "night"]}', '27140', '{}'),
  ('spark', '스파크랜드', 35.8689, 128.5976, false, 660, 1320, 60, 0.6, false, true, '대구 중구 동성로', '저녁',
   '{놀이,대관람차,야경}', '저녁까지 운영 (시각 확인 필요)', '확인 필요', 'seed-evening',
   '{"couple": 0.85, "friends": 0.9, "solo": 0.4, "evening": {"kids": 0.6, "couple": 0.9, "friends": 0.9, "solo": 0.4}}', 60, 'spot',
   '{"best": ["night"]}', '27110', '{}'),
  ('apsan-cafe', '앞산 카페거리', 35.8287, 128.5895, false, 0, 1440, 60, 0.3, false, true, '대구 남구 대명동', '저녁',
   '{카페,산책}', '거리는 늘 열림 (가게 시간은 다름)', null, 'seed-evening',
   '{"couple": 0.85, "friends": 0.75, "solo": 0.7, "evening": {"couple": 0.8, "friends": 0.7, "solo": 0.6}}', 60, 'spot',
   '{"best": ["day", "night"]}', '27200', '{}'),
  ('gj-donggung', '경주 동궁과 월지', 35.8343, 129.2265, false, 540, 1320, 50, 0.6, false, true, '경북 경주시 인왕동', '저녁',
   '{야경,역사,연못,조명}', '09:00~22:00 (입장 마감 21:30, 확인 필요)', '연중무휴', 'seed-evening',
   '{"couple": 0.95, "friends": 0.8, "solo": 0.85, "evening": {"kids": 0.6, "couple": 1.0, "friends": 0.85, "solo": 0.85}}', 50, 'spot',
   '{"best": ["night"]}', '47130', '{}'),
  ('gj-cheomseong', '경주 첨성대', 35.8347, 129.2190, false, 0, 1440, 30, 0.6, false, true, '경북 경주시 인왕동', '저녁',
   '{야경,역사,조명}', '바깥에서 늘 볼 수 있음', '연중무휴', 'seed-evening',
   '{"couple": 0.85, "friends": 0.7, "solo": 0.8, "evening": {"kids": 0.6, "couple": 0.9, "friends": 0.7, "solo": 0.8}}', 30, 'spot',
   '{"best": ["day", "night"]}', '47130', '{}'),
  ('gj-woljeong', '경주 월정교', 35.8297, 129.2178, false, 0, 1440, 30, 0.55, false, true, '경북 경주시 교동', '저녁',
   '{야경,다리,조명,역사}', '늘 열림 (다리 위 출입 시각 확인 필요)', null, 'seed-evening',
   '{"couple": 0.9, "friends": 0.75, "solo": 0.8, "evening": {"kids": 0.55, "couple": 0.95, "friends": 0.75, "solo": 0.8}}', 30, 'spot',
   '{"best": ["night"]}', '47130', '{}'),
  ('gj-hwangridan', '경주 황리단길', 35.8380, 129.2100, false, 0, 1440, 60, 0.45, false, true, '경북 경주시 황남동', '저녁',
   '{산책,카페,먹거리}', '거리는 늘 열림 (가게 시간은 다름)', null, 'seed-evening',
   '{"couple": 0.9, "friends": 0.85, "solo": 0.7, "evening": {"kids": 0.4, "couple": 0.85, "friends": 0.8, "solo": 0.65}}', 60, 'spot',
   '{"best": ["day", "night"]}', '47130', '{}'),
  ('gj-bomun', '경주 보문호', 35.8436, 129.2861, false, 0, 1440, 45, 0.55, false, true, '경북 경주시 신평동', '저녁',
   '{호수,산책,야경}', '늘 열림', '연중무휴', 'seed-evening',
   '{"couple": 0.85, "friends": 0.7, "solo": 0.8, "evening": {"kids": 0.5, "couple": 0.85, "friends": 0.7, "solo": 0.8}}', 45, 'spot',
   '{"best": ["day", "sunset", "night"]}', '47130', '{}'),
  ('ad-woryeong', '안동 월영교', 36.5627, 128.7465, false, 0, 1440, 40, 0.55, false, true, '경북 안동시 상아동', '저녁',
   '{다리,강,야경,조명}', '늘 열림', '연중무휴', 'seed-evening',
   '{"couple": 0.9, "friends": 0.7, "solo": 0.8, "evening": {"kids": 0.55, "couple": 0.95, "friends": 0.7, "solo": 0.8}}', 40, 'spot',
   '{"best": ["night"]}', '47170', '{}'),
  ('ph-yeongildae', '포항 영일대 해수욕장', 36.0560, 129.3790, false, 0, 1440, 50, 0.6, false, true, '경북 포항시 북구 두호동', '저녁',
   '{바다,산책,야경}', '늘 열림', '연중무휴', 'seed-evening',
   '{"couple": 0.9, "friends": 0.8, "solo": 0.75, "evening": {"kids": 0.6, "couple": 0.9, "friends": 0.8, "solo": 0.75}}', 50, 'spot',
   '{"best": ["day", "night"]}', '47110', '{}')
on conflict (id) do nothing;

-- ③ 야경 드라이브 길 3개 (어른끼리만 추천 · 내리지 않고 지나가는 시간 = 머무름)
insert into places (id, name, lat, lng, indoor, open_min, close_min, dwell_p80, kid_fit, stampable, active, region, grp, tags, hours, closed, source,
                    fit, dwell_adult, kind, route, moments, region_code, meta)
values
  ('drive-apsan', '앞산순환로 야경 드라이브', 35.8352, 128.5560, false, 0, 1440, 25, 0.3, false, true, '대구 남구', '저녁',
   '{드라이브,야경,산}', '늘 지나갈 수 있음', null, 'seed-evening',
   '{"couple": 0.9, "friends": 0.75, "solo": 0.85, "evening": {"couple": 0.95, "friends": 0.8, "solo": 0.9}}', 25, 'drive',
   '{"points": [{"lat": 35.8352, "lng": 128.5560, "name": "앞산순환로 서쪽(대명동)"}, {"lat": 35.8290, "lng": 128.5770, "name": "앞산공원 입구"},
                {"lat": 35.8245, "lng": 128.5990, "name": "앞산 카페거리 쪽"}, {"lat": 35.8160, "lng": 128.6185, "name": "파동 쪽"}],
     "pass_min": 25, "rest_place_id": "apsan-cafe"}',
   '{"best": ["night"]}', '27200', '{}'),
  ('drive-sincheon', '신천대로 야경 드라이브', 35.8405, 128.6075, false, 0, 1440, 20, 0.3, false, true, '대구 수성구·중구·북구', '저녁',
   '{드라이브,야경,강}', '늘 지나갈 수 있음 (출퇴근 시간 막힘)', null, 'seed-evening',
   '{"couple": 0.85, "friends": 0.75, "solo": 0.85, "evening": {"couple": 0.9, "friends": 0.75, "solo": 0.9}}', 20, 'drive',
   '{"points": [{"lat": 35.8405, "lng": 128.6075, "name": "상동교 쪽"}, {"lat": 35.8620, "lng": 128.6105, "name": "수성교 쪽"},
                {"lat": 35.8790, "lng": 128.6040, "name": "칠성교 쪽"}, {"lat": 35.8935, "lng": 128.5975, "name": "침산교 쪽"}],
     "pass_min": 20, "rest_place_id": "chilseong-night"}',
   '{"best": ["night"]}', '27260', '{}'),
  ('drive-palgong', '팔공산 순환도로 야경 드라이브', 35.9420, 128.6390, false, 0, 1440, 40, 0.3, false, true, '대구 동구', '저녁',
   '{드라이브,야경,산}', '늘 지나갈 수 있음 (산길 · 겨울 결빙 주의)', null, 'seed-evening',
   '{"couple": 0.85, "friends": 0.8, "solo": 0.85, "evening": {"couple": 0.9, "friends": 0.8, "solo": 0.9}}', 40, 'drive',
   '{"points": [{"lat": 35.9420, "lng": 128.6390, "name": "팔공산 순환도로 서쪽"}, {"lat": 35.9800, "lng": 128.6700, "name": "파계사 쪽"},
                {"lat": 35.9840, "lng": 128.6985, "name": "동화사 쪽"}, {"lat": 35.9500, "lng": 128.7150, "name": "공산 쪽"}],
     "pass_min": 40, "rest_place_id": "donghwa"}',
   '{"best": ["night"]}', '27140', '{}')
on conflict (id) do nothing;

-- ④ 새 곳의 출처 표시 (모두 조사 · 확인 필요) — 이미 meta가 있으면 그대로
update places set meta = jsonb_build_object(
    'moments', jsonb_build_object('src', 'seed', 'conf', 0.5, 'at', to_char(current_date, 'YYYY-MM-DD'), 'check', true),
    'fit',     jsonb_build_object('src', 'seed', 'conf', 0.5, 'at', to_char(current_date, 'YYYY-MM-DD'), 'check', true),
    'kind',    jsonb_build_object('src', 'seed', 'conf', 0.8, 'at', to_char(current_date, 'YYYY-MM-DD')),
    'hours',   jsonb_build_object('src', 'seed', 'conf', 0.4, 'at', to_char(current_date, 'YYYY-MM-DD'), 'check', true),
    'region',  jsonb_build_object('src', 'seed', 'conf', 0.8, 'at', to_char(current_date, 'YYYY-MM-DD')))
  where source = 'seed-evening' and meta = '{}'::jsonb;

-- ⑤ 새 곳 운영 시간 줄 (매일 한 줄 = 위 open_min·close_min) — 줄이 없을 때만. 동궁과 월지는 마지막 입장 21:30
insert into entity_hours (entity_kind, entity_id, days, open_min, close_min, last_entry_min, sort)
select 'place', p.id, '{0,1,2,3,4,5,6}', p.open_min, p.close_min, case when p.id = 'gj-donggung' then 1290 end, 0
from places p
where p.source = 'seed-evening' and p.close_min > p.open_min
  and not exists (select 1 from entity_hours h where h.entity_kind = 'place' and h.entity_id = p.id);

-- 목록 버전 +1 (차·폰이 새 목록을 받게)
update catalog_meta set version = version + 1;

commit;

-- 확인용 (바꾸지 않음): 저녁 칸이 있는 곳
select id, name, kind, moments->'best' as best, fit->'evening' as evening from places
where moments ? 'best' and (moments->'best' ? 'night' or moments->'best' ? 'sunset') order by kind, id;
