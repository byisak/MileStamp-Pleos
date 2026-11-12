#!/usr/bin/env bash
# 마일스탬프 · "가족의 하루" 3분 시연 자동화 (Pleos Connect Emulator v2.1.0 + 실제 서버 + curl '폰')
# 기획서 9장 '시연 영상 대본' 표 순서. 공용 도구는 lib.sh.
#
# 실제 차 신호로 넣는 것 : 기어 · 속도 · 주행거리 · 운전석 문 · 2열 착좌 (가상 콘솔 REST, 포트 8088), 위치 (adb emu geo fix)
# 디버그 입력인 것       : 시계(+날짜) · 날씨 · 내비 남은 시간 (앱 debug 빌드 브로드캐스트) → 영상 구석에 "시뮬레이션 입력" 표시
# 가족 폰 대신          : curl + 폰 토큰 (차 pair 코드로 연결, /tmp/milestamp-demo/ 에 보관). 실제 폰을 같이 연결해 두면 알림도 감
#
# 하루 (토요일 · 맑음, 15시부터 비 · 해 짐 17:41 — 폰 개발 탭 '추천 시험 ①'과 같은 조건)
#   0 탑승 전: 폰이 오늘 계획을 받고 이야기 코스(화본역 → 삼국유사테마파크 → 국립대구과학관)를 고름(데모 차 '정한 코스 고르기') → 서버에 살아 있는 코스 v1
#   1 08:30 탑승 → 차에 '아빠가 폰에서 고른 코스' 준비 카드   2 '이 길로 출발' → 내비 경유지 안내 + 오늘 코스
#   3 주행 칩   4 화본역 도장   5 테마파크 도착 전 소개   6 테마파크 도장 → 문 열면 폰 이어 듣기
#   7 (폰 사진 미션)   8 12:50 재탑승 → 오늘 코스(늦게 출발 · 낮잠 이동)   9 쉿 모드 과학관 무음 도장
#  10 15:30 비 · 일찍 나섬 → '오늘 코스' 제안('한 곳 더 · …'·'바로 집으로') → 고르지 않고 출발 → 폰이 '디아크 들렀다 가자'(들르기, 서버 코스)   11 디아크 비 오는 날 희귀 도장
#  12 귀가 요약 + 뒷좌석 확인   13 위조 시도(위치만 이동) → 보류
#
# 준비: 차 debug 빌드(서버 주소 = $SERVER, README '시연 대본' 절), 권한 허락, 데모 차(cars.demo=true)
# 사용법: ./day_story.sh            (전체 약 4분)
#         ./day_story.sh 6          (6번 장면부터, 리허설용 — 0번을 건너뛰면 서버 계획은 이미 고른 상태여야 함)
#         ./day_story.sh 0 4        (0~4번 장면만)
#         SHOTS=/tmp/shots ./day_story.sh   (장면 끝마다 화면 캡처)
#         SERVER=http://127.0.0.1:3200 ./day_story.sh   (로컬 개발 서버 + 기본 debug 빌드)

set -uo pipefail
cd "$(dirname "$0")"
source ./lib.sh
START_AT="${1:-0}"
END_AT="${2:-99}"
DAY="${DAY:-$(next_dow 6)}"   # 다가오는 토요일 (서버는 지난 날 코스를 버림)
FAILS=0

console_start
log "서버 $SERVER · 날짜 $DAY · 차 $SERIAL"
ensure_phone 아빠 && check_demo && phone_family || exit 1
[[ $START_AT -le 1 ]] && clear_courses   # 지난 리허설이 남긴 코스 치우기

# ---- 준비 -------------------------------------------------------------------
if [[ $START_AT -le 1 ]]; then
  log "준비: 하루 초기화, P, 빈 좌석, 집 위치, 해 06:47~17:41, 맑음·15시부터 비"
  reset_day "$HOME_LL" 08:29
  sun 06:47 17:41; wx clear true 15:00
  sleep 3
fi

# ---- 장면 ---------------------------------------------------------------------
if scene 0 "탑승 전: 폰에서 오늘 코스 고르기"; then
  # 폰 개발 탭 '추천 시험 ①'과 같은 조건으로 새로 계산 → 이야기 코스로 고르기 (34곳 모두 도장이라 1순위가 이야기 코스가 아님,
  # 데모 차만 순서를 정해 고름 = 개발 탭 '이야기 코스로 고르기'. 서버가 살아 있는 코스 v1을 만듦)
  phone_plan 35.8858,128.5828 08:30 "sky=CLEAR&rainFrom=15:00&sunset=17:41&fresh=1" || exit 1
  phone_choose_course hwabon,samguk,dgsm || exit 1
  server_course
fi

if scene 1 "08:30 탑승 → 폰에서 고른 코스 준비 카드"; then
  clear_log
  clock 08:30; seat true
  wait_text "폰에서 고른 코스" 25 || FAILS=$((FAILS+1))
  nap 2; shot ready
fi

if scene 2 "이 길로 출발 → 내비 경유지 + 오늘 코스"; then
  tap_text "이 길로 출발" || choose 0
  expect_log "길 안내" 8
  nap 6; shot route
fi

if scene 3 "주행: 정적 칩"; then
  gear Drive; speed 60; nap 8; shot driving
fi

if scene 4 "09:14 화본역 도착 쾅"; then
  clock 09:13; eta 150 1800; sleep 2
  odo 38; speed 0; geo 128.69488 36.12665; sleep 2
  gear Park; nap 12; shot stamp                 # 영상: P 3초 → 메달 연출까지 담기
  expect_log "도장 No.* 화본역" 5
fi

if scene 5 "테마파크 도착 전 소개"; then
  clock 09:55; door open; sleep 1; door close; gear Drive; speed 50; sleep 2
  # HANDOFF_EARLY=1 (폰 이어 듣기 녹화용): 소개가 15초짜리라 기본 흐름(주행 11초 → 도장 → 문)이면 폰엔 마지막 한 문장만 남는다.
  # → 주행 3초 뒤 도착, P 1.5초 만에 문을 열어 소개 6~7초째에 끊는다(도장은 문이 열려도 P 3초 뒤 찍힘). 차 영상 합성은 기본값으로.
  clock 09:58; eta 150 2000; if [[ ${HANDOFF_EARLY:-0} == 1 ]]; then nap 3; else nap 11; fi   # 남은 시간 → 소개 음성 시작
fi

if scene 6 "10:01 빨리 내림 → 폰 이어듣기 (핵심)"; then
  clock 10:01; odo 6; speed 0; geo ${THEME_LL}; sleep 1
  if [[ ${HANDOFF_EARLY:-0} == 1 ]]; then
    gear Park; sleep 1.5; door open                 # 세우자마자 내림 → 차 페이드아웃 → 폰 알림 → 끊긴 문장부터
    expect_log "도장 No.* 삼국유사테마파크" 9; shot stamp; nap 7
  else
    gear Park; expect_log "도장 No.* 삼국유사테마파크" 9; shot stamp; nap 5             # 쾅(P 3초 뒤 + 색 입히기 0.8초) + 소개 낭독 12초째
    door open; nap 7                                  # 차 페이드아웃 → 폰 알림 → 끊긴 문장부터
  fi
  seat false
fi

if scene 7 "구경: 폰 사진 미션"; then
  log "(폰에서 직접 사진 미션 완료)"; nap 5
fi

if scene 8 "12:50 재탑승 → 오늘 코스 (낮잠 이동)"; then
  clock 12:50; door close; seat true
  show_app "오늘 코스" 20 || FAILS=$((FAILS+1))   # 재탑승하면 남은 코스로 내비가 앞에 뜬다 → 마일스탬프 창으로 (운전자가 앱 아이콘을 누른 것)
  nap 4; shot course
  server_course
fi

if scene 9 "쉿 모드 → 과학관 무음 도장"; then
  clock 12:52; gear Drive; speed 80; nap 4
  clock 14:09; eta 150 2200; sleep 3
  odo 78; speed 0; geo ${SCIENCE_LL}; sleep 1
  gear Park; expect_log "도장 No.* 국립대구과학관" 9; nap 6; shot stamp
  door open; sleep 2; seat false
fi

if scene 10 "15:30 비 · 일찍 나섬 → 코스 제안(한 곳 더·바로 집으로) → 출발 → 폰에서 '디아크 들렀다 가자'"; then
  clock 15:30; wx rain; seat true; door close    # 과학관(코스의 마지막 곳)에서 다시 타도 코스를 버리지 않음 → '오늘 코스' 제안 카드
  expect_log "코스 제안 .*바로 집으로" 20 || FAILS=$((FAILS+1))
  show_app "바로 집으로" 15 || FAILS=$((FAILS+1))
  nap 2; shot last_stop_proposal
  gear Drive; speed 60                           # 예정(16:10)보다 40분 일찍 출발 → 차가 서버에 Departed
  expect_log "서버 코스 맞춤: Departed" 10
  phone_event '{"type":"Insert","place":"thearc"}'   # 폰 코스 화면 '들르기' 시트와 같은 사건 (now = 서버가 아는 코스 시각)
  nap 3; shot driving_insert
  server_course
fi

if scene 11 "디아크: 비 오는 날 희귀 도장 → 폰이 넣은 코스와 맞춤"; then
  clock 15:50; odo 19; speed 0; geo ${ARC_LL}; sleep 1
  gear Park; expect_log "도장 No.* 디아크 · 희귀" 9; nap 7; shot stamp
  server_course
fi

if scene 12 "16:50 귀가 → 요약 + 뒷좌석 확인"; then
  gear Drive; speed 50; sleep 3
  clock 16:50; odo 22; speed 0; geo ${HOME_LL}; sleep 1
  gear Park; expect_log "오늘 도장" 8; shot summary
  door open; nap 3; shot rear                       # 착좌 유지 상태 → "뒷자리 아이들 먼저"
fi

if scene 13 "위조 시도: 위치만 이동"; then
  door close; gear Drive; sleep 1
  speed 0; geo ${FAKE_LL}; sleep 1                  # 주행거리는 그대로
  gear Park; expect_log "도장 보류" 9; shot held                       # "인증 보류: 주행거리가 이동거리와 맞지 않아요"
fi

log "끝 (아웃트로는 편집에서) · 확인 실패 ${FAILS}개"
[[ ${KEEP_PHONE:-1} == 1 ]] || phone_cleanup
