-- 운영 반영용: '함께'(커뮤니티 1단계) 표 5개. schema.sql 끝 절과 같다 (여러 번 돌려도 안전).
--   psql "$DATABASE_URL" -f web/db/migrate-2026-11-02-community.sql
--   운영팀 글 씨앗(선택): psql "$DATABASE_URL" -f web/db/seed-community-notices.sql
-- ───────────── 함께 (커뮤니티 1단계, 11/2 — proto/community-plan.html) ─────────────
-- 가족(차 1대) 별명·아이콘·지역·이용 규칙 동의. 실명·아이 이름 칸은 없다. 좌표·집·차/폰 id는 글 응답에 절대 안 나감.
-- hidden_from_community = 함께 숨기기(내 글도 다른 가족에게 안 보임), banned_at = 관리자 정지(올리기 막힘 + 글 안 보임).
create table if not exists community_profiles (
  car_id      uuid primary key references cars(id) on delete cascade,
  handle      text not null unique,
  icon        text not null default '🌱',
  region      text not null default 'dg-gb',            -- 'dg-gb' = 대구·경북 (전국은 나중에)
  terms_at    timestamptz,
  banned_at   timestamptz,
  hidden_from_community boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table community_profiles enable row level security;

-- 글: stamp(도장 자랑) · trip(오늘 다녀왔어요, 장소 이름만) · tip(장소 한줄팁) · notice(운영팀, car_id 없음)
-- visible_at = 다른 가족에게 보이기 시작하는 때: 그날 집 도착(summary)이 이미 있으면 바로, 아니면 올린 때 + 2시간
--   (집 도착 소식이 오면 그때로 당김 — lib/community.ts releasePending). 지금 어디 있는지 드러나지 않게.
create table if not exists posts (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid references cars(id) on delete cascade,  -- null = 운영팀 글
  phone_id    uuid references phones(id) on delete set null,
  kind        text not null check (kind in ('stamp', 'trip', 'tip', 'notice')),
  operator    boolean not null default false,
  place_id    text,                                         -- 명소 id 또는 축제 id (좌표 없음)
  event_id    uuid references events(id) on delete set null, -- 도장·오늘 요약 소식
  medal       jsonb,                                        -- {name, tier, rare, number?, festivalId?}
  places      jsonb,                                        -- trip·notice: [{id?, name}] 이름만
  text        text not null default '' check (char_length(text) <= 140),
  tip         jsonb,                                        -- {good: boolean, tags: []}
  region      text not null default 'dg-gb',
  visible_at  timestamptz not null default now(),
  status      text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  hidden_reason text,
  created_at  timestamptz not null default now()
);
create index if not exists posts_feed on posts(region, visible_at desc, id desc);
create index if not exists posts_car on posts(car_id, created_at desc);
alter table posts enable row level security;

-- 반응: clap 👏 축하해요(한줄팁은 👍 도움돼요) · want 😍 가보고 싶어요 · save 📌 담기. 가족마다 종류별 한 번
create table if not exists reactions (
  post_id     uuid not null references posts(id) on delete cascade,
  car_id      uuid not null references cars(id) on delete cascade,
  kind        text not null check (kind in ('clap', 'want', 'save')),
  created_at  timestamptz not null default now(),
  primary key (post_id, car_id, kind)
);
create index if not exists reactions_car on reactions(car_id, kind, created_at desc);
alter table reactions enable row level security;

-- 신고: 글(post_id) 또는 가족 별명(target_car_id). 서로 다른 가족 3번 또는 아이 안전 1번이면 글 자동 숨김
create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references posts(id) on delete cascade,
  target_car_id uuid references cars(id) on delete cascade,
  reporter_car_id uuid not null references cars(id) on delete cascade,
  reason      text not null check (reason in ('spam', 'abuse', 'privacy', 'child_safety', 'other')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists reports_once on reports(post_id, reporter_car_id) where post_id is not null;
create index if not exists reports_open on reports(created_at desc) where resolved_at is null;
alter table reports enable row level security;

-- 이 가족 가리기: 가린 가족의 글은 가린 쪽에 어디서도 안 보인다
create table if not exists blocks (
  car_id          uuid not null references cars(id) on delete cascade,
  blocked_car_id  uuid not null references cars(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (car_id, blocked_car_id)
);
alter table blocks enable row level security;
