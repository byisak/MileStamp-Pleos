#!/usr/bin/env bash
# 마일스탬프 시연 대본 공용 도구 (day_story.sh · live_course.sh · afternoon_story.sh 가 source 한다)
#
#  - 차 신호: 가상 콘솔 REST(포트 8088, 기어·속도·주행거리·문·좌석) + adb emu geo fix(위치)
#  - 디버그 입력: 앱 debug 빌드 브로드캐스트 (시계·날씨·내비 남은 시간·코스 사건·카드 고르기)
#  - '폰': curl + 폰 토큰 (가족 폰 대신). 토큰은 /tmp/milestamp-demo/ 에만 두고 화면에 찍지 않는다
#
# 환경 변수
#   SERIAL  차 에뮬레이터 (기본 emulator-5556)
#   SERVER  차 앱이 붙은 서버 (기본 https://milestamp.vercel.app — 차 APK의 BuildConfig.SERVER_URL과 같아야 함.
#           로컬 개발 서버면 SERVER=http://127.0.0.1:3200, 차 APK는 기본 debug 빌드(10.0.2.2:3200))
#   SHOTS   폴더를 주면 장면마다 screencap PNG
#   FAST    1이면 기다림을 조금 줄인다 (리허설용)

# adb 서버의 mDNS(같은 네트워크 기기 찾기)가 Wi-Fi 폰 이름을 읽다 죽는 일이 있어(macOS · adb 37, Name::try_from) 끈다.
# 서버가 다시 켜질 때도 이 값을 물려받는다. 이미 켜진 서버에는 안 먹으니 문제가 나면 adb kill-server 뒤 다시.
export ADB_MDNS="${ADB_MDNS:-0}"
SERIAL="${SERIAL:-emulator-5556}"
SERVER="${SERVER:-https://milestamp.vercel.app}"
V="${V:-http://127.0.0.1:8088}"
PKG="kr.milestamp.car"
ADB="adb -s $SERIAL"
SHOTS="${SHOTS:-}"
STATE_DIR="/tmp/milestamp-demo"
mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
LOG="${LOG:-$STATE_DIR/commands.log}"

# ---- 좌표 (경도 위도 — adb emu geo fix 순서. 장소 조사 tools/places/candidates.json 기준) ----
HOME_LL="128.5828 35.8858"       # 데모 '집' = 대구 북구청 (실제 집 아님)
HOME_NEAR_LL="128.5831 35.8860"  # 집에서 약 30m
SEOKGUL_LL="128.64090 36.04890"  # 군위 아미타여래삼존석굴
THEME_LL="128.69592 36.16429"    # 삼국유사테마파크
SCIENCE_LL="128.46642 35.68620"  # 국립대구과학관
ARC_LL="128.46817 35.83908"      # 디아크
DAYCARE_LL="128.5900 35.8890"    # 오후 장면 출발점 (어린이집 칸 35.889,128.59)
FAKE_LL="128.5180 36.5390"       # 위조 시도용: 약 70km 떨어진 곳

t0=$(date +%s)
log()  { printf '[%4ss] %s\n' "$(( $(date +%s) - t0 ))" "$*" | tee -a "$LOG" >&2; }
nap()  { if [[ "${FAST:-0}" == 1 ]]; then sleep "$(python3 -c "print(max(0.5, $1*0.6))")"; else sleep "$1"; fi; }

# ---- 다음 요일 날짜 (1=월 … 6=토 7=일, 오늘 포함) — 서버는 지난 날 코스를 버리므로 늘 오늘 이후로 ----
next_dow() { python3 -c "
import datetime as d; t=d.date.today(); w=$1
print((t + d.timedelta(days=(w - t.isoweekday()) % 7)).isoformat())"; }

# ---- 가상 콘솔 REST -------------------------------------------------------------
put()  { log "PUT $1"; curl -s -m 5 -o /dev/null -X PUT "$V/$1" || log "  (콘솔 실패: $1)"; }
gear() { put "vehicle/gear?gear=$1"; }               # Park | Drive | Reverse | Neutral
speed(){ local before=""; [[ $1 == 0 ]] && before=$(stopped)
         put "vehicle/controls?speed=$1&brake=0&steering=0"
         [[ $1 == 0 ]] || return 0
         [[ $(last_speed) == 0.0 ]] && return 0   # 이미 서 있으면 새 신호가 안 옴
         # 콘솔 속도는 몇 초 늦게 차에 들어올 때가 있다 → 0이 앱에 들어올 때까지(최대 10초) 기다림.
         # 안 기다리고 P를 넣으면 엔진이 '달리는 중 P'로 보고 정차로 안 바꿈 (메모리가 빠듯할 때 day_story 장면 12에서 귀가 요약이 안 뜸)
         for _ in $(seq 1 20); do [[ $(stopped) -gt $before ]] && return 0; sleep 0.5; done
         log "  (경고: 속도 0이 10초 안에 앱에 안 들어옴)"; }
stopped(){ $ADB logcat -d -s MileStamp | grep -c "Speed(kmh=0.0"; }
last_speed(){ $ADB logcat -d -s MileStamp | sed -nE 's/.*Speed\(kmh=([0-9.]+).*/\1/p' | tail -1; }
seat() { put "vehicle/seat?area=rear_left&kind=occupied&value=$1"; sleep 1
         put "vehicle/seat?area=rear_right&kind=occupied&value=$1"; }
door() { case $1 in open) put "vehicle/body?door_fl=true" ;; close) put "vehicle/body?door_fl=false" ;; esac; }
# 주행거리: 콘솔 값(누적 km)을 실제로 올린다 (Pleos SDK가 몇 초마다 콘솔 값을 다시 보내 디버그 ODO는 덮어써짐)
ODO=""
odo()  { [[ -n $ODO ]] || ODO=$(curl -s -m 5 "$V/vehicle/state" | python3 -c 'import json,sys;print(int(json.load(sys.stdin)["odometer"]["traveled_distance_km"]))' 2>/dev/null || echo 1000)
         ODO=$(( ODO + $1 )); put "vehicle/odometer?traveled_distance_km=$ODO"; }
# 콘솔 세션 하트비트 (끊기면 콘솔 값이 차에 안 들어감)
HB=""
console_start() {
  $ADB forward tcp:8088 tcp:8088 >/dev/null
  $ADB logcat -G 16M >/dev/null 2>&1   # Pleos 시스템 로그가 많아 기본 2MB면 앱 줄이 금방 밀려남 (geo·expect_log가 logcat을 봄)
  ( while true; do curl -s -m 2 -o /dev/null -X POST "$V/browser/session?client=demo"; sleep 0.8; done ) &
  HB=$!; trap 'kill $HB 2>/dev/null; if [[ -n ${REC_DIR:-} ]]; then rec_stop; elif [[ -n ${REC_PID:-} ]]; then kill $REC_PID 2>/dev/null; fi' EXIT
}

# ---- 위치 ------------------------------------------------------------------------
# 앱은 5초 간격으로 위치를 받는다. 순간이동 직후 P를 넣으면 옛 위치로 판정하므로 logcat에 새 위치가 찍힐 때까지(최대 12초) 기다린다.
seen() { $ADB logcat -d -s MileStamp | python3 -c "
import sys, re
print(sum(1 for l in sys.stdin for m in [re.search(r'lat=([0-9.]+)', l)] if m and abs(float(m.group(1)) - $1) < 0.0005))"; }
geo()  { log "GEO $1 $2"
         local before; before=$(seen "$2")
         $ADB emu geo fix "$1" "$2" >/dev/null
         for _ in $(seq 1 24); do
           [[ $(seen "$2") -gt $before ]] && return 0
           sleep 0.5
         done
         log "  (경고: 위치가 12초 안에 앱에 안 들어옴)"; }

# ---- 디버그 입력 (debug 빌드) ---------------------------------------------------
# adb shell은 인자를 한 줄로 이어 기기 셸에 넘겨서 따옴표가 벗겨진다(JSON이 깨짐) → 인자마다 작은따옴표로 감싸 보낸다
shq()  { local a out=""; for a in "$@"; do out+=" '$(printf %s "$a" | sed "s/'/'\\\\''/g")'"; done; printf %s "$out"; }
dbg()  { log "DEBUG $*"; $ADB shell "am broadcast -p $PKG -a kr.milestamp.DEBUG$(shq "$@")" >/dev/null; }
DAY="${DAY:-}"   # 시연 날짜 (서버 계획 at= 날짜). 대본이 정한다
clock(){ if [[ -n $DAY ]]; then dbg --es type CLOCK --es now "$1" --es day "$DAY"; else dbg --es type CLOCK --es now "$1"; fi; }
eta()  { dbg --es type ETA --ei remain_s "$1" --ei remain_m "$2"; }
wx()   { dbg --es type WEATHER --es sky "$1" --es soon "${2:-false}" ${3:+--es rain_from "$3"}; }   # clear|rain, 곧 비, 비 시작 시각
sun()  { dbg --es type SUN --es rise "$1" --es set "$2"; }
choose(){ dbg --es type CHOOSE --ei i "${1:-0}"; }    # 추천 카드 n번째 고르기 (0 = 1순위)
adopt(){ dbg --es type ADOPT --ei i "${1:-0}"; }      # 제안 카드 n번째 '이걸로'
ev()   { dbg --es type COURSE_EVENT --es json "$1"; } # 살아 있는 코스 사건 (계획 10절 JSON, now 없으면 차 시계)
plan_sync(){ dbg --es type PLAN_SYNC; }

# ---- 화면 ------------------------------------------------------------------------
SCENE=0
shot() { [[ -n $SHOTS ]] || return 0; mkdir -p "$SHOTS"; sleep 1
         local f; f="$SHOTS/scene$(printf %02d "$SCENE")-$1.png"
         $ADB exec-out screencap -p > "$f"; log "  캡처 $f"; }
# 화면에서 글자를 찾아 그 가운데를 누른다 (Compose 글자는 uiautomator에 보임). 못 찾으면 1 반환
tap_text() {
  $ADB shell uiautomator dump /sdcard/ms_ui.xml >/dev/null 2>&1 || return 1
  local xy; xy=$($ADB shell cat /sdcard/ms_ui.xml | python3 -c "
import sys, re
want = sys.argv[1]
for m in re.finditer(r'<node [^>]*?text=\"([^\"]*)\"[^>]*?bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', sys.stdin.read()):
    if want in m.group(1):
        x1, y1, x2, y2 = map(int, m.groups()[1:]); print((x1 + x2) // 2, (y1 + y2) // 2); break" "$1")
  [[ -n $xy ]] || { log "  (화면에 '$1' 없음)"; return 1; }
  log "TAP '$1' @ $xy"; $ADB shell input tap $xy
}
# 제안 카드 중 제목에 $1이 든 카드를 채택 (로그 '코스 제안 A, B · …' 순서 = 화면 카드 순서) → ADOPT 디버그
adopt_label() {
  local line; line=$($ADB logcat -d -s MileStamp | grep "코스 제안 " | tail -1)
  local idx; idx=$(python3 -c "
import sys
l = sys.argv[1].split('코스 제안 ', 1)[-1]
opts = [o.strip() for o in l.split(', ')]
print(next((i for i, o in enumerate(opts) if sys.argv[2] in o.split(' · 해')[0]), ''))" "$line" "$1")
  [[ -n $idx ]] || { log "  (제안에 '$1' 없음: ${line##*코스 제안 })"; return 1; }
  log "제안 ${idx}번 '$1' 채택"; adopt "$idx"
}
# 화면에 글자가 보일 때까지 기다림 (최대 $2초)
wait_text() {
  local until=$(( $(date +%s) + ${2:-20} ))
  while (( $(date +%s) < until )); do
    $ADB shell uiautomator dump /sdcard/ms_ui.xml >/dev/null 2>&1 && $ADB shell cat /sdcard/ms_ui.xml | grep -q "$1" && return 0
    sleep 1
  done
  log "  (경고: '$1' 이 ${2:-20}초 안에 안 보임)"; return 1
}
# 마일스탬프 창에 글자가 보일 때까지 3초마다 앱을 앞으로 (재탑승 직후 내비가 늦게 앞에 뜨는 것을 이김)
show_app() {
  local until=$(( $(date +%s) + ${2:-20} ))
  while (( $(date +%s) < until )); do
    sleep 3; app_front
    $ADB shell uiautomator dump /sdcard/ms_ui.xml >/dev/null 2>&1 && $ADB shell cat /sdcard/ms_ui.xml | grep -q "$1" && return 0
  done
  log "  (경고: '$1' 이 ${2:-20}초 안에 안 보임)"; return 1
}
app_front() { $ADB shell am start -W -n "$PKG/.ui.MainActivity" >/dev/null; }
# 엔진 기록(logcat MileStamp) 중 마지막 n줄 — 대본 판정용
applog() { $ADB logcat -d -s MileStamp MileStampServer | tail -n "${1:-20}"; }
expect_log() {   # $1 = 찾을 글자, $2 = 최대 초 — logcat에 새로 나오면 통과
  local until=$(( $(date +%s) + ${2:-15} ))
  while (( $(date +%s) < until )); do
    $ADB logcat -d -s MileStamp MileStampServer | tail -n 200 | grep -q -- "$1" && { log "  ✓ $1"; return 0; }
    sleep 1
  done
  log "  ✗ 안 나옴: $1"; FAILS=$(( ${FAILS:-0} + 1 )); return 1
}
clear_log() { $ADB logcat -c; }

# ---- 서버 · '폰'(curl) -----------------------------------------------------------
HOST_KEY=$(printf %s "$SERVER" | sed -E 's#^https?://##; s#[^A-Za-z0-9]+#_#g')
PHONE_TOKEN_FILE="$STATE_DIR/phone-$HOST_KEY.token"

# 차 토큰 (앱 shared_prefs — 찍지 않는다)
car_token() { $ADB shell "run-as $PKG --user 10 cat shared_prefs/server.xml" 2>/dev/null | sed -nE 's/.*car_token">([^<]+)<.*/\1/p' | tr -d '\r\n'; }

# HTTP: $1 메서드, $2 경로, $3 JSON 본문(선택), 토큰은 $TOKEN — 본문을 stdout, 상태 코드를 $STATUS_FILE
STATUS_FILE="$STATE_DIR/last_status"
http() {
  local m=$1 p=$2 body=${3:-} tok=${TOKEN:-}
  local args=(-s -m 20 -X "$m" -o "$STATE_DIR/last_body" -w '%{http_code}' -H 'Content-Type: application/json')
  [[ -n $tok ]] && args+=(-H "Authorization: Bearer $tok")
  [[ -n $body ]] && args+=(--data "$body")
  curl "${args[@]}" "$SERVER$p" > "$STATUS_FILE" || echo 000 > "$STATUS_FILE"
  cat "$STATE_DIR/last_body"
}
status() { cat "$STATUS_FILE"; }
phone() { TOKEN=$(cat "$PHONE_TOKEN_FILE" 2>/dev/null) http "$@"; }
car()   { TOKEN=$(car_token) http "$@"; }
j()     { python3 -c "import json,sys
d=json.load(sys.stdin)
for k in sys.argv[1].split('.'):
    d = d[int(k)] if isinstance(d, list) else (d or {}).get(k)
print(d if not isinstance(d,(dict,list)) else json.dumps(d, ensure_ascii=False))" "$1"; }

# 차가 서버에 등록돼 있게 (앱이 처음 서버를 부를 때 등록) — 토큰이 없으면 앱을 앞으로 띄워 등록을 기다림
ensure_car() {
  local t; t=$(car_token)
  if [[ -z $t ]]; then app_front; for _ in $(seq 1 20); do t=$(car_token); [[ -n $t ]] && break; sleep 1; done; fi
  [[ -n $t ]] || { log "차 토큰이 없어요 (앱이 서버에 등록 못 함: $SERVER)"; return 1; }
  car GET /api/car/status >/dev/null
  [[ $(status) == 200 ]] || { log "차 토큰이 $SERVER 에서 안 통해요 ($(status)) — 차 APK의 서버 주소 확인"; return 1; }
}
# curl '폰'을 이 차에 연결 (차 화면 QR과 같은 /api/car/pair 코드 → /api/phone/join app:true). 이미 연결돼 있으면 그대로
ensure_phone() {
  local nick=${1:-아빠}
  if [[ -s $PHONE_TOKEN_FILE ]]; then
    phone GET /api/phone/me >/dev/null
    [[ $(status) == 200 ]] && return 0
  fi
  ensure_car || return 1
  local code; code=$(car POST /api/car/pair | j code)
  [[ -n $code && $code != None ]] || { log "pair 코드 실패 ($(status))"; return 1; }
  local tok; tok=$(TOKEN= http POST /api/phone/join "{\"code\":\"$code\",\"nickname\":\"$nick\",\"app\":true}" | j token)
  [[ -n $tok && $tok != None ]] || { log "join 실패 ($(status))"; return 1; }
  (umask 077; printf %s "$tok" > "$PHONE_TOKEN_FILE")
  log "폰(curl, $nick) 연결됨 → 토큰은 $PHONE_TOKEN_FILE"
}
# 데모 차인지 (at= 시각 지정은 데모 차만)
check_demo() {
  local d; d=$(phone GET /api/phone/me | j demo)
  [[ $d == True ]] && return 0
  log "이 차는 데모 차가 아니에요 (cars.demo=false) — at= 시각 지정이 403. README '시연 대본' 절 참고"; return 1
}
# 가족 설정을 시연 기준으로 (아이 4·4살, 낮잠 13:00부터 90분, 해 지기 30분 전 귀가, 저녁 18:30)
# — 차가 /api/plan?home= 을 처음 보낼 때 서버가 families 행을 낮잠 null로 만들어 '낮잠 없음'이 되는 문제를 피함
phone_family() {
  phone PUT /api/family '{"kidAges":[4,4],"napStart":780,"napLen":90,"backBy":"sunset-30","dinner":1110}' >/dev/null
  log "가족 설정 (낮잠 13:00·90분) → $(status)"
}
# 폰이 오늘 계획 받기: $1 lat,lng  $2 HH:MM  $3 추가 쿼리(sky=…&fresh=1 등)
PLAN_ID=""
phone_plan() {
  local ll=$1 at="$DAY"T$2 extra=${3:-}
  local out; out=$(phone GET "/api/plan?lat=${ll%,*}&lng=${ll#*,}&home=35.8858,128.5828&at=$at${extra:+&$extra}")
  [[ $(status) == 200 ]] || { log "폰 /api/plan 실패 $(status): $(head -c 200 <<<"$out")"; return 1; }
  PLAN_ID=$(j planId <<<"$out")
  printf %s "$out" > "$STATE_DIR/plan.json"
  python3 - "$STATE_DIR/plan.json" >&2 <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
p = d["plan"]
print(f"  폰 계획 {d['planId'][:8]} {p['mode']} {p['now']} 고름={d.get('chosen')} {d.get('chosenBy') or ''}")
for i, o in enumerate(p["options"]):
    print(f"   {i}. {o.get('label','')} : {' → '.join(s['name'] for s in o['stops']) or '-'} · 귀가 {o.get('arriveHome','')}")
EOF
}
# 폰이 카드 고르기 (idx 없으면 취소)
phone_choose() {
  local idx=${1:-null}
  local out; out=$(phone POST /api/plan/choose "{\"planId\":\"$PLAN_ID\",\"idx\":$idx}")
  log "폰 고르기 idx=$idx → $(status) $(j chosenBy <<<"$out") 코스 v$(j courseVersion <<<"$out")"
}
# 데모 차만: 정한 장소 순서로 고르기 ($1 = "hwabon,samguk,dgsm"). 서버가 '고른 코스' 카드를 계획 끝에 붙이고(같은 순서가 있으면 그 카드) 고른다
# — 34곳 모두 도장이라 계획 3장에 이야기 코스가 안 나올 수 있어서 (폰 개발 탭 '이야기 코스로 고르기'와 같음)
phone_choose_course() {
  local stops; stops=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1].split(',')))" "$1")
  local out; out=$(phone POST /api/plan/choose "{\"planId\":\"$PLAN_ID\",\"stops\":$stops}")
  [[ $(status) == 200 ]] || { log "폰 코스 고르기 실패 $(status): $(head -c 200 <<<"$out")"; return 1; }
  log "폰 코스 고르기 $1 → 카드 $(j chosen <<<"$out")번 $(j chosenBy <<<"$out") 코스 v$(j courseVersion <<<"$out")"
}
# 폰이 코스 사건 보내기 (PATCH, 최신 버전으로). $1 사건 JSON
phone_event() {
  local cur; cur=$(phone GET /api/plan/course)
  local v; v=$(j version <<<"$cur")
  # now가 없으면 코스가 마지막으로 짠 시각 (폰 앱 시험 장면과 같음 — 서버 벽시계는 시연 날짜·시각과 다름)
  local evj; evj=$(python3 -c "
import json, sys
e = json.loads(sys.argv[1]); c = json.loads(sys.argv[2]).get('course') or {}
if 'now' not in e and isinstance(c.get('nowMin'), int): e['now'] = '%02d:%02d' % divmod(c['nowMin'], 60)
print(json.dumps(e, ensure_ascii=False))" "$1" "$cur")
  local out; out=$(phone PATCH /api/plan/course "{\"version\":$v,\"event\":$evj}")
  log "폰 사건 $evj (v$v) → $(status) $(j kind <<<"$out") v$(j version <<<"$out") · $(j change.text <<<"$out")"
}
# 서버 코스 한 줄 요약
server_course() {
  phone GET /api/plan/course | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('  서버 코스 없음'); sys.exit()
c=d.get('course') or {}
hm=lambda m: '%02d:%02d'%(m//60,m%60) if isinstance(m,int) else '-'
print('  서버 코스 v%s 귀가 %s 여유 %s분 · %s · 제안 %s' % (d.get('version'), hm(c.get('arriveHomeMin')), c.get('slackMin'),
  ' '.join('%s(%s)'%(s['placeId'],s['status'][:4]) for s in c.get('stops',[])), len((d.get('proposal') or {}).get('options') or [])))" >&2
}
# 이 차에 남은 '살아 있는 코스'를 모두 취소 (지난 리허설이 다른 날짜·차가 고른 계획에 코스를 남겨 두면
# GET /api/plan/course가 그 코스를 돌려줘 차가 엉뚱한 코스를 받음). 서버는 최신 코스부터 하나씩 돌려준다
clear_courses() {
  local pid n=0
  for _ in $(seq 1 10); do
    pid=$(phone GET /api/plan/course | j planId 2>/dev/null)
    [[ $(status) == 200 && -n $pid && $pid != None ]] || break
    phone POST /api/plan/choose "{\"planId\":\"$pid\",\"idx\":null}" >/dev/null; n=$((n+1))
  done
  log "남은 코스 취소 ${n}개 (서버 코스 $(phone GET /api/plan/course >/dev/null; status))"
}
# 폰(curl) 정리: 고른 것 취소 + 연결 끊기
phone_cleanup() {
  [[ -s $PHONE_TOKEN_FILE ]] || return 0
  [[ -n $PLAN_ID ]] && phone_choose null
  clear_courses
  phone DELETE /api/phone/me >/dev/null; log "폰(curl) 연결 끊음 ($(status))"
  rm -f "$PHONE_TOKEN_FILE"
}

# ---- 공통 준비: 하루 초기화 + 집에서 P·빈 좌석 ------------------------------------
reset_day() {   # $1 = 시작 위치(경도 위도), $2 = 시각
  gear Park; seat false; speed 0; door close
  $ADB emu geo fix ${1:-$HOME_LL} >/dev/null
  app_front   # 앱이 앞에 있어야 디버그 입력이 서비스를 띄울 수 있음 (뒤에서는 포그라운드 서비스 시작 금지)
  dbg --es type RESET_DAY
  clock "${2:-08:29}"
  # 에뮬레이터 내비는 연결 직후 자기 기본 위치(판교)를 한 번 보낸다 → 출발점을 다시 넣는다 (20m 필터 때문에 약 30m 옆)
  sleep 4
  local lon=${1%% *} lat=${1##* }
  geo "$(python3 -c "print(round($lon+0.0003,5))")" "$(python3 -c "print(round($lat+0.0002,5))")"
}

# ---- 녹화 (adb shell screenrecord, 한 토막 최대 180초) ------------------------------
REC_PID=""
rec_start() { $ADB shell rm -f /sdcard/ms_rec.mp4; ( $ADB shell screenrecord --time-limit "${2:-180}" --bit-rate 6000000 /sdcard/ms_rec.mp4 ) & REC_PID=$!; sleep 1; log "녹화 시작 → $1"; REC_OUT=$1; }
rec_stop()  { [[ -n $REC_PID ]] || return 0; $ADB shell pkill -INT screenrecord 2>/dev/null; wait "$REC_PID" 2>/dev/null; REC_PID=""; sleep 2
              mkdir -p "$(dirname "$REC_OUT")"; $ADB pull /sdcard/ms_rec.mp4 "$REC_OUT" >/dev/null && log "녹화 저장 $REC_OUT"; }

# REC_DIR를 주면 장면마다 녹화를 새로 시작한다 → $REC_DIR/sceneNN.mp4 (시연 영상 tools/video/)
scene(){ SCENE=$1; shift; [[ $SCENE -ge ${START_AT:-0} && $SCENE -le ${END_AT:-99} ]] || return 1
         log "== 장면 $SCENE: $*"
         if [[ -n ${REC_DIR:-} ]]; then rec_stop; rec_start "$REC_DIR/scene$(printf %02d "$SCENE").mp4"; fi
         return 0; }
