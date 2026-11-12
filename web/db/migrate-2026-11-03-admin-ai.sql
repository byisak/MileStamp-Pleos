-- 관리자 대시보드 개편 · AI 입력 돕기 (11/3) — schema.sql 끝 절과 같다. 여러 번 돌려도 안전 (추가만).
-- 운영 반영: psql "$DATABASE_URL" -f web/db/migrate-2026-11-03-admin-ai.sql

-- ───────────── 관리자 대시보드 개편 · AI 입력 돕기 (11/3 — docs/장소-데이터-구조-계획.md §5·§6 A, 추가만 · 여러 번 돌려도 안전) ─────────────
-- AI 사용량: 한국 날짜 × 기능(fill = 장소·식당 칸 초안 · diary = 그날의 기록 · moderation = 함께 글 검사 · stamp-image = 도장 그림 · text = 그 밖)
-- 부를 때마다 calls +1, 실패면 failures +1, 게이트웨이가 알려 준 글 토큰·그림 장수를 더한다. 할 일 화면 '이번 주 AI 사용'과 AI 채우기 하루 한도(AI_FILL_DAILY_LIMIT)에 쓴다.
-- 개인정보 없음 (기능 이름과 숫자만). 표가 없으면 기록은 조용히 건너뛰고 화면엔 '기록 없음'.
create table if not exists ai_usage (
  day         date not null,
  feature     text not null,
  calls       int not null default 0,
  failures    int not null default 0,
  tokens_in   bigint not null default 0,
  tokens_out  bigint not null default 0,
  images      int not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (day, feature)
);
alter table ai_usage enable row level security;
-- AI 칸 초안은 새 표 없이 places.meta·restaurants.meta jsonb의 'drafts' 안에 둔다:
--   {"drafts": {"parking": {"src":"ai","conf":0.6,"at":"2026-11-03","check":true,"quote":"원문 한 조각","value":{…}}}}
--   진짜 칸은 관리자가 '맞아요'를 눌러야 바뀐다 (앱·차는 초안을 모른다).
