#!/usr/bin/env bash
# 마일스탬프 · 오후 짧은 나들이 장면 — 차 에뮬레이터 + 실제 서버 + curl '폰'
#
#  1 수요일 16:10 어린이집(35.889,128.59) 앞, 오늘 첫 탑승(14시 이후) → 차에 오후 카드 3장 '지금 어디 들렀다 갈까요'
#     (폰이 먼저 같은 조건으로 계획을 받아 두어 차와 폰이 같은 계획을 봄 — 폰 개발 탭 '추천 시험 ③'과 같은 조건)
#  2 차에서 침산공원 카드 '이 길로 출발' → 서버 choose(차) → 폰에 '차에서 골랐어요'
#  3 침산공원 도착 → 도장(34곳 모두 도장) → 내림    4 다시 타고 집으로 → 귀가 요약
#
# 사용법: ./afternoon_story.sh   ·   SHOTS=dir ./afternoon_story.sh   ·   SERVER=http://127.0.0.1:3200 ./afternoon_story.sh

set -uo pipefail
cd "$(dirname "$0")"
source ./lib.sh
START_AT="${1:-0}"; END_AT="${2:-99}"
DAY="${DAY:-$(next_dow 3)}"   # 다가오는 수요일
FAILS=0
CHIMSAN_LL="128.58586 35.89523"

console_start
log "서버 $SERVER · 날짜 $DAY · 차 $SERIAL"
ensure_phone 아빠 && check_demo && phone_family || exit 1
[[ $START_AT -le 1 ]] && clear_courses   # 지난 리허설이 남긴 코스 치우기

if [[ $START_AT -le 1 ]]; then
  log "준비: 하루 초기화, 어린이집 앞 P, 해 06:50~17:43, 맑음"
  reset_day "$DAYCARE_LL" 16:09
  sun 06:50 17:43; wx clear
  sleep 2
fi

if scene 1 "16:10 첫 탑승 → 오후 카드 3장"; then
  phone_plan 35.889,128.59 16:10 "sky=CLEAR&sunset=17:43&fresh=1" || exit 1
  IDX=$(python3 -c "
import json; d = json.load(open('$STATE_DIR/plan.json'))
print(next((i for i, o in enumerate(d['plan']['options']) if any(s['id'] == 'chimsan' for s in o['stops'])), ''))")
  [[ -n $IDX ]] || { log "오후 계획에 침산공원 카드가 없어요"; FAILS=$((FAILS+1)); IDX=0; }
  clear_log
  clock 16:10; seat true
  wait_text "들렀다 갈까요" 25 || FAILS=$((FAILS+1))
  expect_log "ServerPlan AFTERNOON" 15 || FAILS=$((FAILS+1))
  nap 2; shot afternoon_cards
fi

if scene 2 "침산공원 카드 고르기 → 출발"; then
  choose "$IDX"
  expect_log "길 안내 → 침산공원" 8 || FAILS=$((FAILS+1))
  sleep 3
  log "  폰이 보는 계획: 고름=$(phone GET "/api/plan?lat=35.889&lng=128.59&at=${DAY}T16:11" | j chosenBy)"
  app_front; nap 2; shot chosen
  gear Drive; speed 40; nap 3; shot driving
fi

if scene 3 "16:20 침산공원 도착 → 도장, 구경"; then
  clock 16:20; odo 2; speed 0; geo $CHIMSAN_LL; sleep 1
  gear Park; nap 5; shot arrived
  expect_log "도장 No.* 침산공원" 9 || true      # 10/26부터 34곳 모두 도장 → 침산공원도 도장 (expect_log가 실패를 셈)
  expect_log "서버 코스 맞춤: Arrived" 10
  door open; sleep 2; seat false; nap 3
  server_course
fi

if scene 4 "17:00 다시 타고 집으로 → 요약"; then
  clock 17:00; door close; seat true; nap 4
  expect_log "코스 제안 .*바로 집으로" 15 || FAILS=$((FAILS+1))   # 코스의 마지막 곳 → '오늘 코스' 제안 ('바로 집으로', 여유 ≥ 45분이면 '한 곳 더'도)
  show_app "바로 집으로" 10 >/dev/null; shot reboard
  adopt_label "바로 집으로" || FAILS=$((FAILS+1))
  expect_log "길 안내 → 집" 8 || FAILS=$((FAILS+1))
  sleep 2; gear Drive; speed 40; sleep 3
  clock 17:12; odo 3; speed 0; geo $HOME_LL; sleep 1
  gear Park; expect_log "오늘 도장" 9 || FAILS=$((FAILS+1))
  shot home_summary
fi

log "끝 · 확인 실패 ${FAILS}개"
