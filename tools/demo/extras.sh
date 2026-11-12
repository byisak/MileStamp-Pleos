#!/usr/bin/env bash
# 시연 영상 덧붙임 장면 (day_story.sh 다음에 이어서). 장면 번호는 day_story와 겹치지 않게 20번부터.
#  20 글레오 "도장북 보여줘" → 도장북 화면 (OPEN_STAMP_BOOK, component=activity — 에뮬레이터에는 글레오가 없어 같은 인텐트를 adb로 보냄)
#  21 저녁 나들이: 새 하루 18:10 탑승 → '저녁 산책 어때요?' (해 진 뒤 · 잠자기 전까지)
#
# 사용법: ./extras.sh            (20~21)
#         ./extras.sh 21 21      (저녁만)
#         REC_DIR=/path ./extras.sh   (장면마다 녹화 → sceneNN.mp4)

set -uo pipefail
cd "$(dirname "$0")"
source ./lib.sh
START_AT="${1:-20}"
END_AT="${2:-29}"
DAY="${DAY:-$(next_dow 6)}"
FAILS=0

console_start
log "서버 $SERVER · 날짜 $DAY · 차 $SERIAL"
ensure_phone 아빠 && check_demo && phone_family || exit 1

if scene 20 "글레오: 도장북 보여줘"; then
  gear Park; speed 0; door close; nap 2
  log "VOICE OPEN_STAMP_BOOK (글레오 대신 adb)"
  $ADB shell am start --user 10 -a OPEN_STAMP_BOOK -p "$PKG" >/dev/null
  wait_text "도장북" 10 || FAILS=$((FAILS+1))
  nap 6; shot stampbook
fi

if scene 21 "저녁 나들이: 18:10 해 진 뒤 탑승"; then
  tap_text "닫기" 2>/dev/null || $ADB shell input keyevent KEYCODE_BACK   # 20번에서 연 도장북 닫기
  clear_courses
  reset_day "$HOME_LL" 18:09
  sun 06:47 17:41; wx clear
  sleep 3
  phone_plan 35.8858,128.5828 18:10 "sky=CLEAR&sunset=17:41&fresh=1" || FAILS=$((FAILS+1))
  clock 18:10; seat true
  wait_text "저녁" 25 || FAILS=$((FAILS+1))
  nap 6; shot evening
fi

log "끝 · 확인 실패 ${FAILS}개"
