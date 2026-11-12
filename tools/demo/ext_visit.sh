#!/usr/bin/env bash
# 마일스탬프 · 바깥 장소 '다녀옴' 장면 (내가 고르기 C단계) — 차 에뮬레이터 + 실제 서버 + curl '폰'
#
#  0 (준비) 폰이 한국관광 100선 '사유원'(ext:kto100:73 — 우리 명소 목록 밖, 도장 없음) 중심 코스를 고른다.
#     가족 폰 앱에서 이미 골랐으면(오늘 탭 100선 → 사유원 → 차로 보내기) 그 코스를 그대로 쓰고, 없으면 curl '폰'이 앵커 코스를 고른다
#  1 08:30 탑승 → 차에 '아빠가 폰에서 고른 코스' 카드 (사유원 → …)     2 '이 길로 출발' → 주행 화면 '도착하면 다녀옴으로 기록'
#  3 사유원 도착(P) → 메달 대신 '사유원 다녀옴 · 기록했어요' 화면 → 서버 코스 Arrived → 가족 '다녀온 곳'(GET /api/family/visited-ext)에 사유원
#
# 사용법: SERVER=http://127.0.0.1:3215 SERIAL=emulator-5554 DAY=2026-10-31 SHOTS=dir ./ext_visit.sh
#   (차 APK는 같은 서버로 빌드: ./gradlew :app:clean :app:assembleDebug -PserverUrl=http://10.0.2.2:3215 · 데모 차여야 함)

set -uo pipefail
cd "$(dirname "$0")"
source ./lib.sh
START_AT="${1:-0}"; END_AT="${2:-99}"
DAY="${DAY:-$(next_dow 6)}"
FAILS=0
EXT_ID="${EXT_ID:-ext:kto100:73}"; EXT_NAME="${EXT_NAME:-사유원}"; EXT_LAT="${EXT_LAT:-36.033}"; EXT_LNG="${EXT_LNG:-128.68}"

console_start
log "서버 $SERVER · 날짜 $DAY · 차 $SERIAL · 바깥 장소 $EXT_NAME($EXT_ID)"
ensure_phone 아빠 && check_demo || exit 1

has_ext_course() { phone GET /api/plan/course | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
sys.exit(0 if any(s.get('placeId')=='$EXT_ID' and s.get('status') in ('PLANNED','NEXT') for s in (d.get('course') or {}).get('stops',[])) else 1)"; }

if scene 0 "준비: $EXT_NAME 중심 코스 (폰)"; then
  if has_ext_course; then log "  가족 폰이 고른 코스를 그대로 씀"
  else
    clear_courses; phone_family
    phone_plan 35.8858,128.5828 08:30 "sky=CLEAR&sunset=17:41&fresh=1" || exit 1
    out=$(phone POST /api/plan/anchor "{\"anchor\":{\"kind\":\"tour\",\"id\":\"$EXT_ID\",\"name\":\"$EXT_NAME\",\"lat\":$EXT_LAT,\"lng\":$EXT_LNG},\"day\":\"$DAY\"}")
    [[ $(status) == 200 ]] || { log "앵커 실패 $(status): $(head -c 200 <<<"$out")"; exit 1; }
    body=$(python3 -c "
import json,sys; d=json.loads(sys.argv[1]); o=d['plan']['options'][0]
stops=[{'id':s['id'], **({k:s[k] for k in ('name','lat','lng')} | (s.get('ext') or {}))} if s['id'].startswith('ext:') else s['id'] for s in o['stops']]
print(json.dumps({'planId':d['planId'],'stops':stops,'anchor':'$EXT_ID'}, ensure_ascii=False))" "$out")
    phone POST /api/plan/choose "$body" >/dev/null; log "  curl 폰 앵커 고르기 → $(status)"
  fi
  server_course
fi

if scene 1 "08:30 탑승 → 폰에서 고른 코스"; then
  reset_day "$HOME_LL" 08:29
  sun 06:47 17:41; wx clear; sleep 3
  clear_log
  clock 08:30; seat true
  wait_text "폰에서 고른 코스" 25 || FAILS=$((FAILS+1))
  nap 2; shot ready
fi

if scene 2 "이 길로 출발 → 주행"; then
  tap_text "이 길로 출발" || choose 0
  expect_log "길 안내 → " 10 || FAILS=$((FAILS+1))
  sleep 2; app_front; nap 2; shot course
  gear Drive; speed 60; nap 3; shot driving
fi

if scene 3 "08:59 $EXT_NAME 도착 → 다녀옴 (도장 없음)"; then
  clock 08:59; odo 31; speed 0; geo "$EXT_LNG" "$EXT_LAT"; sleep 1
  gear Park
  expect_log "다녀옴 $EXT_NAME" 12 || FAILS=$((FAILS+1))
  if $ADB logcat -d -s MileStamp | grep -q "도장 No.* $EXT_NAME"; then log "  (실패: 바깥 장소에 도장이 찍힘)"; FAILS=$((FAILS+1)); fi
  show_app "다녀옴" 10 >/dev/null; nap 2; shot visit
  expect_log "서버 코스 맞춤: Arrived" 15 || FAILS=$((FAILS+1))
  sleep 2; server_course
  v=$(phone GET /api/family/visited-ext | python3 -c "
import json,sys; d=json.load(sys.stdin); print(next((x['name'] for x in d.get('places', d.get('items', [])) if x.get('extId')=='$EXT_ID'), ''))" 2>/dev/null)
  if [[ $v == "$EXT_NAME" ]]; then log "  가족 '다녀온 곳'에 $EXT_NAME 있음"; else log "  (실패: '다녀온 곳'에 $EXT_NAME 없음 · $(status))"; FAILS=$((FAILS+1)); fi
  sleep 12; shot after_visit   # 12초 뒤 '다녀옴' 화면이 저절로 닫히고 오늘 코스로
fi

log "끝 · 확인 실패 ${FAILS}개"
