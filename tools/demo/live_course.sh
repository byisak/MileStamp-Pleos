#!/usr/bin/env bash
# 마일스탬프 · 살아 있는 코스 장면 (docs/코스-고도화-계획.md 3절·10절) — 차 에뮬레이터 + 실제 서버 + curl '폰'
#
#  1 폰이 이야기 코스(화본역 → 테마파크 → 과학관)로 고름 (서버 코스 v1)  2 08:30 탑승 → 준비 카드 → '이 길로 출발'
#  3 화본역 도착·도장 → 출발 (서버에 Arrived·Departed)      4 테마파크 도착·도장
#  5 12:10 다시 탐 = 예정(12:41)보다 30분 일찍 → 차에 제안 카드 ('12:50에 출발' · '한 곳 더 …')
#  6 '이걸로' 누름 (화면 탭, 안 되면 ADOPT 디버그) → 서버 adopt
#  7 주행 중 폰이 '과학관 빼기'(Skip dgsm) → 차는 주행 중이라 아직 그대로 (차는 정차 중에만 서버 코스를 받음)
#  8 휴게소에 P → 15초 안에 폰 코스 반영 (칩 '아빠가 코스를 바꿨어요')
#  9 '지금 집으로' (차 버튼) → 집으로 길 안내, 서버도 HomeNow
#
# 사용법: ./live_course.sh                 (전체 약 3분)
#         SHOTS=dir ./live_course.sh       (장면마다 캡처)
#         REC=파일.mp4 ./live_course.sh    (화면 녹화 adb screenrecord, 최대 180초 한 토막)
#         SERVER=http://127.0.0.1:3200 ./live_course.sh   (로컬 개발 서버 + 기본 debug 빌드)
# 사건 JSON은 서버 PATCH /api/plan/course 의 event 와 같은 모양 (계획 10절).

set -uo pipefail
cd "$(dirname "$0")"
source ./lib.sh
START_AT="${1:-0}"; END_AT="${2:-99}"
DAY="${DAY:-$(next_dow 6)}"
REC="${REC:-}"
FAILS=0
REST_LL="128.6630 36.0010"   # 중간 휴게소 (장소 아님)

console_start
log "서버 $SERVER · 날짜 $DAY · 차 $SERIAL"
ensure_phone 아빠 && check_demo && phone_family || exit 1
[[ $START_AT -le 1 ]] && clear_courses   # 지난 리허설이 남긴 코스 치우기

if [[ $START_AT -le 1 ]]; then
  log "준비: 하루 초기화, 집 P, 해 06:47~17:41, 맑음·15시부터 비"
  reset_day "$HOME_LL" 08:29
  sun 06:47 17:41; wx clear true 15:00
  sleep 2
fi
# 녹화: screenrecord 한 번은 최대 180초 — 대본이 약 2분 30초라 한 토막 (FAST=1이면 더 짧음)
[[ -n $REC ]] && rec_start "$REC" 180

if scene 1 "폰에서 이야기 코스로 고르기 (데모 차 정한 코스)"; then
  phone_plan 35.8858,128.5828 08:30 "sky=CLEAR&rainFrom=15:00&sunset=17:41&fresh=1" || exit 1
  phone_choose_course hwabon,samguk,dgsm || exit 1
  server_course
fi

if scene 2 "08:30 탑승 → 폰에서 고른 코스 → 출발"; then
  clear_log
  clock 08:30; seat true
  wait_text "폰에서 고른 코스" 25 || FAILS=$((FAILS+1))
  nap 2; shot ready
  tap_text "이 길로 출발" || choose 0
  expect_log "길 안내" 8
  nap 2; app_front; nap 2; shot course_v1
  gear Drive; speed 60; nap 3
fi

if scene 3 "09:14 화본역 도착 → 도장 → 09:54 출발"; then
  clock 09:14; odo 38; speed 0; geo 128.69488 36.12665; sleep 1
  gear Park; expect_log "도장 No.* 화본역" 9
  door open; sleep 2; seat false; nap 2
  clock 09:54; door close; seat true; sleep 2; gear Drive; speed 40; nap 3
fi

if scene 4 "10:01 테마파크 도착 → 도장"; then
  clock 10:01; odo 6; speed 0; geo ${THEME_LL}; sleep 1
  gear Park; expect_log "도장 No.* 삼국유사테마파크" 9
  nap 2; shot stamp_theme
  door open; sleep 2; seat false
  expect_log "서버 코스 맞춤: Arrived" 10
  server_course
fi

if scene 5 "12:10 다시 탐 = 30분 일찍 → 제안 카드"; then
  clock 12:10; door close; seat true
  expect_log "코스 제안" 20 || FAILS=$((FAILS+1))
  show_app "이걸로" 15
  nap 2; shot proposal
  server_course
fi

if scene 6 "'이걸로' (제안 카드 채택)"; then
  tap_text "이걸로" || adopt 0
  expect_log "서버 코스 맞춤: 채택" 10 || FAILS=$((FAILS+1))
  nap 2; app_front; nap 2; shot adopted
  server_course
fi

if scene 7 "주행 중 폰이 '과학관 빼기' → 차는 다음 정차 때"; then
  clock 12:52; gear Drive; speed 70; nap 3
  phone_event '{"type":"Skip","place":"dgsm"}'
  nap 4; shot driving_after_phone
  log "  (주행 중: 차는 서버 코스를 받지 않음 — 아래 줄에 '폰 코스'가 없어야 정상)"
  applog 3 >&2
fi

if scene 8 "휴게소 P → 폰이 바꾼 코스 반영"; then
  clock 13:20; odo 30; speed 0; geo $REST_LL; sleep 1
  gear Park
  expect_log "폰 코스" 30 || FAILS=$((FAILS+1))
  show_app "오늘 코스" 12
  nap 2; shot phone_applied
  server_course
fi

if scene 9 "'지금 집으로' (차 버튼)"; then
  tap_text "지금 집으로" || ev '{"type":"GoHome"}'
  expect_log "집으로" 8
  nap 3; app_front; nap 2; shot go_home
  server_course
fi

[[ -n $REC ]] && rec_stop
log "끝 · 확인 실패 ${FAILS}개 · logcat: adb -s $SERIAL logcat -s MileStamp MileStampServer"
