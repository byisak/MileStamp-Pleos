-- 마일스탬프 서버 DB (Postgres · Supabase)
-- 모든 읽기·쓰기는 서버(Next.js API)가 DATABASE_URL로만 한다. 브라우저에서 직접 접근하지 않으므로
-- Supabase에서는 RLS를 켜고 정책을 두지 않는다(= anon/authenticated 키로는 아무것도 못 읽음).
-- 위치 최소화: 좌표·주행 궤적은 받지 않는다. 장소 ID와 숫자만.

create extension if not exists pgcrypto;

-- 차 한 대 = 가족 하나. 토큰은 해시만 저장.
create table if not exists cars (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  demo        boolean not null default false,  -- 개발자 시험용 데모 차 (DEV_PASS_CODE로 연결)
  created_at  timestamptz not null default now()
);
alter table cars add column if not exists demo boolean not null default false;

-- 차 화면 QR의 1회용 코드 (10분)
create table if not exists pair_codes (
  code        text primary key,
  car_id      uuid not null references cars(id) on delete cascade,
  expires_at  timestamptz not null
);

-- 가족 폰. push = 웹푸시 구독(JSON), 없으면 화면이 3초마다 새 소식을 확인.
create table if not exists phones (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid not null references cars(id) on delete cascade,
  token_hash  text not null unique,
  nickname    text not null default '가족',
  push        jsonb,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists phones_car on phones(car_id);

-- 차에서 생긴 일: handoff(이어 듣기) · mission · intro(쉿 모드 소개) · stamp · summary
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid not null references cars(id) on delete cascade,
  kind        text not null check (kind in ('handoff', 'mission', 'intro', 'stamp', 'summary')),
  place_id    text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_car_time on events(car_id, created_at desc);

-- 폰에서 푼 미션
create table if not exists mission_results (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  phone_id    uuid not null references phones(id) on delete cascade,
  answer      jsonb not null,
  correct     boolean,
  created_at  timestamptz not null default now(),
  unique (event_id, phone_id)
);

alter table cars enable row level security;
alter table pair_codes enable row level security;
alter table phones enable row level security;
alter table events enable row level security;
alter table mission_results enable row level security;

-- ───────────── 오늘 어디 갈까요? (추천) ─────────────

-- 우리 가족 설정 (차 1대 = 1가족). 없으면 기본값(아이 4·4살, 낮잠 13:00 90분, 해 지기 30분 전 귀가, 저녁 18:30)
-- 집은 주소를 받지 않고 약 1km 칸('35.89,128.58')만. 차가 계획을 받을 때 알려 준다.
create table if not exists families (
  car_id      uuid primary key references cars(id) on delete cascade,
  kid_ages    smallint[] not null default '{4,4}',
  nap_start   smallint,                              -- 분 (13:00 = 780). 낮잠 없으면 null
  nap_len     smallint,                              -- 분. 낮잠 없으면 null
  back_by     text not null default 'sunset-30',     -- 'sunset-30'(해 지기 30분 전) | 'at:17:30'(고정)
  dinner      smallint default 1110,                 -- 저녁 시각(분, 18:30). null이면 따지지 않음
  home_cell   text,                                  -- 집 칸 (소수 둘째 자리)
  updated_at  timestamptz not null default now()
);

-- 추천 후보 장소 (장소 조사 + 사람 검수). 씨앗: db/places.seed.json → npm run seed:places
create table if not exists places (
  id          text primary key,
  name        text not null,
  lat         double precision not null,
  lng         double precision not null,
  indoor      boolean not null default false,
  open_min    smallint not null default 540,         -- 문 여는 시각(분). 상시 개방 0
  close_min   smallint not null default 1080,        -- 문 닫는 시각(분). 상시 개방 1440
  dwell_p80   smallint not null default 60,          -- 4살 기준 머무는 시간(분, 상위 80%)
  kid_fit     double precision not null default 0.7, -- 아이 적합도 0~1
  stampable   boolean not null default false,        -- 도장 그림이 있는 곳
  popular     int not null default 0,                -- 요즘 다녀간 팀 수 (사람이 넣는 값, 서버 방문 기록과 큰 쪽을 씀)
  active      boolean not null default true,         -- false면 추천에서 뺌
  region      text,
  grp         text,                                  -- 조사 묶음 ('주말 하루' · '비 오는 날 실내' · '평일 오후 짧게' · '귀갓길 잠깐')
  tags        text[] not null default '{}',
  hours       text,                                  -- 운영 시간 원문
  closed      text,                                  -- 쉬는 날 원문
  source      text,
  updated_at  timestamptz not null default now()
);

-- 오늘 계획 (차마다 하루 여러 번 만들 수 있고 최신 1개를 폰·차가 같이 본다). 위치는 칸 글자로만.
create table if not exists plans (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid not null references cars(id) on delete cascade,
  day         date not null,                         -- 한국 날짜
  mode        text not null,                         -- MORNING | AFTERNOON
  origin_cell text not null,                         -- 계산한 위치 칸 ('35.89,128.58')
  now_at      timestamptz not null,                  -- 계산 기준 시각 (데모 차는 지정한 시각)
  options     jsonb not null,
  sky         jsonb,
  back_by     smallint,                              -- 귀가 한계(분)
  budget      smallint,                              -- 여유(분)
  chosen      smallint,                              -- 고른 카드 번호
  chosen_by   text,                                  -- '폰:엄마' | '차'
  chosen_at   timestamptz,
  stale       boolean not null default false,        -- 가족 설정이 바뀌면 다시 계산
  created_at  timestamptz not null default now()
);
create index if not exists plans_car_day on plans(car_id, day, created_at desc);

-- 살아 있는 코스 (docs/코스-고도화-계획.md 2절·10절): 고른 카드를 버전 있는 시간표로 들고 다닌다.
-- course = LiveCourse JSON(10절 모양, 장소는 id), course_version = course.version(바뀔 때마다 +1, 폰·차 충돌 판정),
-- course_proposal = 마지막 제안 카드들({options, change, voice, atMin}) — POST /api/plan/course/adopt가 쓴다. 고르기 취소면 모두 null.
alter table plans add column if not exists course jsonb;
alter table plans add column if not exists course_version int not null default 0;
alter table plans add column if not exists course_updated_at timestamptz;
alter table plans add column if not exists course_proposal jsonb;
-- 우리 가족 설정 확장 (10/26): 폰에서 정한 집(소수 셋째 자리 ≈ 100m, 좌표는 로그에 안 남김) · 즐겨찾는 도착지 [{name, lat, lng}]
-- home_cell(소수 둘째 자리 칸)은 예전 코드와 맞추려고 그대로 둔다 (집을 정하면 같이 갱신)
alter table families add column if not exists home_lat double precision;
alter table families add column if not exists home_lng double precision;
alter table families add column if not exists favorites jsonb not null default '[]'::jsonb;

-- 지역·날짜별 해 시각('sun', 0.1도 칸)·날씨('weather', 기상청 격자, 1시간)
create table if not exists sky_cache (
  cell        text not null,
  day         date not null,
  kind        text not null,
  data        jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (cell, day, kind)
);

alter table families enable row level security;
alter table places enable row level security;
alter table plans enable row level security;
alter table sky_cache enable row level security;

-- ───────────── 관리자 (/admin, 10/26) ─────────────
-- 명소를 관리자 화면에서 고치고 '저장하고 앱에 보내기' → catalog_meta.version +1 → 폰·차가 GET /api/catalog?since=N 로 바뀐 것만 받는다.
-- points    = 도착 지점(원) 여러 개 [{lat, lng, r, name}] — 어느 원 안에서든 P단이면 그 장소. 비어 있으면 lat/lng + 300m 하나.
-- album     = 도장북 묶음 key (season1 · town · home · rain · weekend). grp(조사 묶음)와 다르다.
-- mission   = {quiz:{q, options[3], answer}, find} · intro = 도착 2분 전 소개 글
-- facilities = 편의 칩('유모차 가능'·'수유실'…) · closed_days = 쉬는 요일(0=일 … 6=토) · temp_closed = 임시 휴무 날짜
-- stamp_url·stamp_bw_url = 관리자에서 올린 도장 그림(Cloudflare R2 stamps/<id>/<판>.webp, 720px). 없으면 앱에 넣어 둔 그림. stamp_version은 올릴 때마다 +1
-- edited_at = 관리자가 고친 때. 고친 장소는 seed:places가 덮어쓰지 않는다.
alter table places add column if not exists points jsonb;
alter table places add column if not exists album text;
alter table places add column if not exists intro text;
alter table places add column if not exists mission jsonb;
alter table places add column if not exists facilities text[] not null default '{}';
alter table places add column if not exists closed_days int[] not null default '{}';
alter table places add column if not exists temp_closed date[] not null default '{}';
alter table places add column if not exists stamp_url text;
alter table places add column if not exists stamp_bw_url text;
alter table places add column if not exists stamp_version int not null default 0;
alter table places add column if not exists edited_at timestamptz;
update places set points = jsonb_build_array(jsonb_build_object('lat', lat, 'lng', lng, 'r', 300, 'name', '정문·주차장'))
  where points is null;

-- 도장북 묶음 처음 값 (폰 phone/src/places.ts ALBUM과 같게, 동화사는 시즌 1)
update places set album = case
  when id in ('seokgul','samguk','dgsm','thearc','hwabon','hahoe','donghwa') then 'season1'
  when id in ('weather','eduseum','unamji','hajungdo','chimsan','dalseong','aayang','duryu','samsung') then 'town'
  when id in ('hanbam','bullo','samunjin','suseongmot') then 'home'
  when id in ('aquarium','kidsworld','nmd','safety','bangjja','gumisci','daegaya') then 'rain'
  else 'weekend' end
  where album is null;

-- 목록 버전 (한 줄). 관리자 저장마다 +1
create table if not exists catalog_meta (
  id       smallint primary key default 1 check (id = 1),
  version  int not null default 1,
  updated_at timestamptz not null default now()
);
insert into catalog_meta (id, version) values (1, 1) on conflict (id) do nothing;

-- 맛집 (코스 점심 칩은 다음 단계). facilities: '유아 의자'·'놀이방'·'수유실'·'주차'·'좌식'
create table if not exists restaurants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  place_id    text references places(id) on delete set null,
  lat         double precision,
  lng         double precision,
  facilities  text[] not null default '{}',
  hours       text,
  closed      text,
  note        text,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table catalog_meta enable row level security;
alter table restaurants enable row level security;

-- ───────────── 축제·행사 (/admin '축제·행사' 탭, 10/27 · docs/축제-안드로이드오토-계획.md ①) ─────────────
-- 기간이 정해진 축제·행사. 그 기간에만 추천 후보('이번 주말만' 칩)와 기간 한정 도장(붉은 축제 테두리)이 되고, 끝나면 저절로 빠진다.
-- id        = 'fest-…' (엔진 Place id와 같음. 명소 id와 겹치지 않게 앞에 fest-)
-- place_id  = 붙은 명소 (그 명소 자리에서 열림 — 열리는 날엔 명소 대신 축제를 추천). null이면 새 위치
-- points    = 도착 원 [{lat, lng, r, name}] (명소에 붙이면 처음엔 그 명소 것을 복사) · lat/lng = 첫 원
-- starts~ends = 한국 날짜 · open_min~close_min = 하루 운영 시각(분) · closed_days = 쉬는 요일(0=일 … 6=토)
-- weight    = 추천 가중치 1.0(보통) · 2.5(강하게, 주말 1순위 후보) · kid_fit = 아이 적합도 · crowd_note = 혼잡 예상 한 줄
-- poster_url = R2 festivals/<id>/poster-<판>.webp (1080px 이하) 또는 TourAPI 그림 주소
-- stamp_url·stamp_bw_url = 한정 도장 (R2 festivals/<id>/stamp-<판>.webp, 테두리 ring = 'festival')
-- season    = 도장 아래 글씨·도장북 '지난 축제' 칸 ('2026 가을') · source = 가져온 곳 ('tourapi:<contentid>')
-- 저장마다 catalog_meta.version +1 (명소와 같은 목록 버전)
create table if not exists festivals (
  id            text primary key,
  name          text not null,
  summary       text,
  place_id      text references places(id) on delete set null,
  points        jsonb,
  lat           double precision not null,
  lng           double precision not null,
  starts        date not null,
  ends          date not null,
  open_min      int not null default 600,
  close_min     int not null default 1080,
  closed_days   int[] not null default '{}',
  dwell_p80     int not null default 90,
  indoor        boolean not null default false,
  kid_fit       real not null default 0.8,
  weight        real not null default 1.0,
  crowd_note    text,
  season        text,
  poster_url    text,
  poster_version int not null default 0,
  stamp_url     text,
  stamp_bw_url  text,
  stamp_version int not null default 0,
  ring          text not null default 'festival',
  source        text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz not null default now(),
  check (ends >= starts)
);
create index if not exists festivals_ends on festivals(ends);
alter table festivals enable row level security;
-- 축제 도장 찾기 (같은 축제는 한 차에 해마다 한 번)
create index if not exists events_festival on events(car_id, (payload->>'festivalId')) where kind = 'stamp';

-- ───────────── 머무는 시간 맞춤 (10/27, 계획: 엔진 FamilyProfile.dwellEstimate · DwellLearning) ─────────────
-- 우리 가족 머무름: 다녀온 곳마다 (실제 머문 분 ÷ 조사값)을 EMA(α 0.3)로 섞은 배율 0.6~1.6 + 장소마다 평균·횟수.
-- dwell_pref = 가족 설정 '머무는 편'(quick 0.8 · normal 1.0 · long 1.25) — 바꾸면 배율을 그 값으로 다시 시작(배운 횟수는 둔다).
alter table families add column if not exists dwell_pref text not null default 'normal';
alter table families add column if not exists dwell_factor real not null default 1.0;
alter table families add column if not exists dwell_n int not null default 0;
alter table families add column if not exists place_dwell jsonb not null default '{}'::jsonb;  -- {placeId: {avg, n}}

-- 실제로 머문 기록 (차의 코스에서 다녀온 곳이 DONE이 될 때 · 도장 소식에 도착·출발 시각이 있을 때). 같은 날 같은 곳은 한 번만.
-- 좌표 없음. 또래 통계(place_dwell_stats)의 재료 — 데모 차는 통계에서 뺀다.
create table if not exists dwell_visits (
  car_id        uuid not null references cars(id) on delete cascade,
  day           date not null,
  place_id      text not null,
  arrive_min    smallint not null,
  depart_min    smallint not null,
  dwell_min     smallint not null,
  cut_by_close  boolean not null default false,       -- 문 닫는 시각에 걸려 나옴 (통계·배우기에서 뺌)
  weekend       boolean not null default false,
  rainy         boolean not null default false,
  age_band      text not null,                         -- '0-3' | '4-6' | '7-9' | '10+' (막내 기준)
  source        text not null default 'course',        -- 'course' | 'stamp'
  created_at    timestamptz not null default now(),
  primary key (car_id, day, place_id)
);
create index if not exists dwell_visits_place on dwell_visits(place_id, age_band);
alter table dwell_visits enable row level security;

-- 같은 또래 가족들의 머무름 (가족마다 평균 → 가족들 사이 P50·P75). 10가족 이상인 칸만 남긴다(개인 값이 드러나지 않게).
-- bucket: 'all' | 'weekend' | 'weekday' | 'rain' — 주말·비 칸은 그 칸에 10가족 이상일 때만 쓴다. 서버가 6시간마다(읽을 때) 다시 계산.
create table if not exists place_dwell_stats (
  place_id    text not null,
  age_band    text not null,
  bucket      text not null default 'all',
  n_families  int not null,
  p50         smallint not null,
  p75         smallint not null,
  updated_at  timestamptz not null default now(),
  primary key (place_id, age_band, bucket)
);
alter table place_dwell_stats enable row level security;

-- ───────────── AI 도장 그림 (/admin 명소·축제 'AI로 도장 만들기', 10/27 · docs/AI-도장-계획.md, 자동 검사 없음) ─────────────
-- 작업 하나 = 후보 4장(purpose 'stamp', 1024²) 또는 배경 1장(purpose 'background', 1024×1536, 명소만 → places.bg_url).
-- status: queued → running → done | failed. candidates = [{url, key}] (R2 ai/<kind>/<id>/<job>/<n>.<ext>, 모의는 웹 안 그림 주소)
-- mode = 실제로 쓴 길 'edit'(참고 그림) | 'generate'(글로만) | 'mock'. 다음 작업은 마지막으로 된 길부터.
-- 하루 한도(AI_DAILY_LIMIT, 기본 40장) = 한국 날짜 오늘 만든 작업의 n_images 합 (모의 빼고, 실패해서 0장이면 0).
create table if not exists ai_stamp_jobs (
  id           uuid primary key default gen_random_uuid(),
  target_kind  text not null check (target_kind in ('place', 'festival')),
  target_id    text not null,
  purpose      text not null default 'stamp' check (purpose in ('stamp', 'background')),
  scene        text not null,
  prompt       text not null,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error        text,
  candidates   jsonb not null default '[]'::jsonb,
  chosen       int,
  n_images     int not null default 0,
  mode         text,
  mock         boolean not null default false,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists ai_stamp_jobs_target on ai_stamp_jobs(target_kind, target_id, created_at desc);
create index if not exists ai_stamp_jobs_day on ai_stamp_jobs(created_at);
alter table ai_stamp_jobs enable row level security;
-- 도장 획득 화면 배경 (AI 9:16, R2 ai/place/<id>/<job>/bg.<ext>). 앱 목록엔 아직 안 보냄.
alter table places add column if not exists bg_url text;
-- AI 도장: 작업마다 쓴 그림 모델 (관리자 화면에서 게이트웨이 목록 중에 고름, 10/27)
alter table ai_stamp_jobs add column if not exists model text;

-- ───────────── 내가 고르기 · 둘러보기 (10/28, docs/직접-고르기-계획.md §6·§7 서버 C·D) ─────────────
-- 관광공사 TourAPI 답 저장 (하루 1,000회 한도 → 축제는 하루 한 번 전국 목록, 찾기는 검색어마다 7일).
-- key 예: 'festival:2026-10-28' · 'search:경주 박물관' · 'quota:2026-10-28'(그날 실제로 부른 횟수, data = {"n": 12})
create table if not exists tour_cache (
  key         text primary key,
  data        jsonb not null,
  fetched_at  timestamptz not null default now()
);
alter table tour_cache enable row level security;

-- 고른 목록 (한국관광 100선 등). list = 'kto100-2025'(2025~2026 판). 2년마다 관리자 화면에서 CSV로 새 판.
-- content_id = TourAPI contentid (모르면 null — 그땐 앱 id가 'ext:kto100:<no>') · our_place_id = 우리 명소로 직접 묶기(비면 서버가 이름·거리로 찾음)
-- 관광공사 로고·도장 그림은 쓰지 않는다. 이름 '한국관광 100선'만 (공공데이터 이용허락범위 제한 없음).
create table if not exists curated_places (
  list          text not null,
  no            int not null,
  name          text not null,
  content_id    text,
  lat           double precision,
  lng           double precision,
  area          text,
  region        text,
  addr          text,
  image         text,
  our_place_id  text,
  updated_at    timestamptz not null default now(),
  primary key (list, name)
);
create index if not exists curated_places_no on curated_places(list, no);
alter table curated_places enable row level security;

-- '다녀옴' 기록: 도장이 없는 바깥 장소(TourAPI·100선 중 미등록)에 실제로 도착했을 때. 같은 날 같은 곳은 한 번.
-- 좌표는 그 장소의 공개 좌표(가족 위치 아님). ext_id = 'ext:tour:<contentId>' | 'ext:kto100:<no>'
create table if not exists visits_ext (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references cars(id) on delete cascade,
  ext_id      text not null,
  name        text not null,
  lat         double precision,
  lng         double precision,
  day         date not null,
  visited_at  timestamptz not null default now(),
  source      text not null default 'car',
  unique (family_id, ext_id, day)
);
create index if not exists visits_ext_family on visits_ext(family_id, visited_at desc);
create index if not exists visits_ext_ext on visits_ext(ext_id);
alter table visits_ext enable row level security;

-- ───────────── 추천 '왜?'·점수 보완 · 앵커 코스 (10/28, docs/직접-고르기-계획.md 5절·3절 — A·B) ─────────────
-- 즐겨찾는 장소 id (우리 명소·축제·바깥 'ext:tour:…') — 추천 점수 +1, '왜?' 설명. POST /api/plan/favorite. 30곳까지
alter table families add column if not exists fav_places jsonb not null default '[]'::jsonb;

-- ───────────── 고르기 탭 2차 · 인기 (10/28, docs/고르기-2차-계획.html 5절) ─────────────
-- 최근 30일 장소별 가족 수 (데모 차 빼고, 같은 가족은 1): picked = 코스로 고른 가족 · visited = 실제로 간 가족(도장·다녀옴).
-- 서버가 요청 때 하루 한 번(한국 날짜) 통째로 다시 채운다 (lib/explore-popularity.ts). 표가 없으면 '인기'는 이번 주말 → 가까운 순.
create table if not exists explore_popularity (
  id          text primary key,
  picked      int not null default 0,
  visited     int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table explore_popularity enable row level security;

-- ───────────── 누구랑 가요? (11/1 — 아이와 · 연인·부부 · 친구끼리 · 혼자) ─────────────
-- companion = 'kids' | 'couple' | 'friends' | 'solo'. 가족 설정엔 마지막으로 고른 값(기본 kids), 계획엔 그 계획의 동행.
-- 아이 나이·낮잠은 kids일 때만 쓴다. 어른끼리: 낮잠 없음 · 귀가 한계 22:00 · 머무름 어른 기준 · 동행 적합도 + 분위기 가점 (엔진 GoWith)
alter table families add column if not exists companion text not null default 'kids';
alter table plans add column if not exists companion text not null default 'kids';
-- 장소·축제의 동행별 적합도 {"kids":0.9,"couple":0.7,"friends":0.6,"solo":0.5} (kids는 kid_fit과 같게 둠, null이면 kid_fit + 어른 0.6)
-- tags = 분위기 표시(야경·카페·데이트·체험·산책·전시·드라이브·액티비티·조용함 …, 장소는 예전 설명 표시와 같은 칸에 더함)
-- dwell_adult = 어른 기준 머무는 분 (null이면 dwell_p80 × 0.8). 처음 값은 tools/places/fit-seed.sql
alter table places add column if not exists fit jsonb;
alter table places add column if not exists dwell_adult smallint;
alter table festivals add column if not exists fit jsonb;
alter table festivals add column if not exists tags text[] not null default '{}';

-- ───────────── 그날의 기록 (11/2 — 메달 아래 자동 일기, proto/medal-fx/diary-plan.html 1~3단계) ─────────────
-- 하루(차·한국 날짜) 한 줄. depart_min = 그날 처음 집을 나선 시각(코스 사건 Departed, 아직 들른 곳이 없을 때 · 그날 0시부터 분).
-- story = {parent|child: {text, by: 'ai'|'facts'|'edit', at}} — 집 도착(차의 오늘 요약) 뒤 하루 한 번 만들어 저장, '다시 쓰기'·고치기만 바꿈.
-- 사실(들른 곳·시각·도장·날씨·주행)은 저장하지 않고 그때그때 코스·소식·머무름 기록에서 모은다 (lib/diary.ts).
create table if not exists diaries (
  car_id      uuid not null references cars(id) on delete cascade,
  day         date not null,
  depart_min  smallint,
  story       jsonb,
  updated_at  timestamptz not null default now(),
  primary key (car_id, day)
);
alter table diaries enable row level security;

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

-- ───────────── 장소 구조 칸 (11/3 — docs/장소-데이터-구조-계획.md 1단계, 추가만 · 여러 번 돌려도 안전) ─────────────
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

-- ------------------------------------------------------------------ 저녁 나들이 (11/3, migrate-2026-11-03-evening.sql과 같음)
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

-- ------------------------------------------------------------------ 명소발굴 100x100 후보 (11/12, migrate-2026-11-12-spot100.sql과 같음 · 추가만, 여러 번 돌려도 안전)
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
