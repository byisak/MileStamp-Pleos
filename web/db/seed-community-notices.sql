-- '함께' 운영팀 글 씨앗 3개 (가짜 사용자 아님 — car_id 없음 + operator 표시, 화면엔 '운영팀' 배지).
-- 여러 번 돌려도 같은 id라 한 번만 들어간다. 관리자 '신고' 탭의 '운영팀 글 올리기'로도 쓸 수 있다.
--   psql "$DATABASE_URL" -f web/db/seed-community-notices.sql
insert into posts (id, car_id, kind, operator, text, places, region, visible_at, created_at) values
  ('00000000-0000-4000-8000-00000000c001', null, 'notice', true,
   '비 오는 주말엔 실내 3곳 코스 — 박물관에서 옛 물건 보고, 과학관에서 실컷 만지고, 아쿠아리움으로 마무리해요',
   '[{"id":"nmd","name":"국립대구박물관"},{"id":"dgsm","name":"국립대구과학관"},{"id":"aquarium","name":"대구아쿠아리움"}]'::jsonb,
   'dg-gb', now(), now()),
  ('00000000-0000-4000-8000-00000000c002', null, 'notice', true,
   '단풍이 절정이에요. 케이블카는 오전 10시 전에 가면 덜 기다려요',
   '[{"id":"cablecar","name":"팔공산 케이블카"},{"id":"donghwa","name":"팔공산 동화사"}]'::jsonb,
   'dg-gb', now() - interval '1 day', now() - interval '1 day'),
  ('00000000-0000-4000-8000-00000000c003', null, 'notice', true,
   '함께에 오신 걸 환영해요! 아이 얼굴·이름·학교는 올리지 말아 주세요. 도장 자랑, 다녀온 곳, 한줄팁으로 서로 나들이를 도와요',
   null, 'dg-gb', now() - interval '2 days', now() - interval '2 days')
on conflict (id) do nothing;
