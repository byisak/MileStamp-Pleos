#!/usr/bin/env bash
# 심사위원 빠른 체험 — release 차 앱 + Pleos 에뮬레이터 가상 콘솔만으로 (debug 빌드·폰 없이)
#
#   대구 집에서 탑승 → 추천 카드 → 출발 → 디아크 도착 '쾅' 도장 → 집 도착 요약·뒷좌석 확인 → 위치만 옮긴 위조 '보류'
#
# 준비: Pleos Connect Emulator v2.1.0이 켜져 있고 apk/큐비온_마일스탬프_release.apk가 깔려 있을 것
# 실행: bash tools/demo/judge_tour.sh            (단계마다 Enter)
#       AUTO=1 bash tools/demo/judge_tour.sh     (기다리지 않고 끝까지, SHOTS=폴더 면 단계마다 캡처)
#
# - 지금 시각 그대로 추천합니다(아침·낮·저녁마다 카드가 다름). 추천 카드는 오후 7시 30분까지 — 아이와 기본 설정
#   (잠자는 시간 오후 9시의 90분 전). 그 뒤엔 '오늘은 늦었어요 · 내일 코스' 안내가 나오고 나머지 단계는 그대로입니다.
# - 명소가 대구·경북에 있어서 위치를 대구로 옮겨 시작합니다(에뮬레이터 기본 위치는 판교).

set -u
SERIAL="${SERIAL:-$(adb devices | awk '/^emulator-/{print $1; exit}')}"
[[ -n $SERIAL ]] || { echo "켜진 에뮬레이터를 찾지 못했어요 (adb devices)"; exit 1; }
ADB="adb -s $SERIAL"
V="http://127.0.0.1:8088"
PKG="kr.milestamp.car"
SHOTS="${SHOTS:-}"

# 좌표 (경도 위도 — adb emu geo fix 순서)
HOME_LL="128.5828 35.8858"   # 시연 '집' = 대구 북구청 (앱의 기본 집과 같음)
ARC_LL="128.46817 35.83908"  # 디아크 (도장 명소, 집에서 직선 약 12km)
FAKE_LL="128.5180 36.5390"   # 위조 시험: 약 70km 떨어진 곳

say()  { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
step() { if [[ ${AUTO:-0} == 1 ]]; then sleep "${1:-2}"; else read -r -p "   (화면을 보고 Enter) " _; fi; }
shot() { [[ -n $SHOTS ]] || return 0; mkdir -p "$SHOTS"; $ADB exec-out screencap -p > "$SHOTS/$1.png"; echo "   캡처 $SHOTS/$1.png"; }
# adb가 다시 켜지면 포트 연결이 사라지므로, 실패하면 다시 붙여 한 번 더
put()  { curl -s -m 5 -o /dev/null -X PUT "$V/vehicle/$1" && return 0
         $ADB forward tcp:8088 tcp:8088 >/dev/null 2>&1; sleep 1
         curl -s -m 5 -o /dev/null -X PUT "$V/vehicle/$1" || echo "   (가상 콘솔 실패: $1 — adb forward tcp:8088 tcp:8088 확인)"; }
gear() { put "gear?gear=$1"; }
speed(){ put "controls?speed=$1&brake=0&steering=0"; }
seats(){ put "seat?area=rear_left&kind=occupied&value=$1"; sleep 1; put "seat?area=rear_right&kind=occupied&value=$1"; }
door() { put "body?door_fl=$1"; }
geo()  { $ADB emu geo fix $1 >/dev/null; }
ODO=""
odo_now(){ curl -s -m 5 "$V/vehicle/state" | python3 -c 'import json,sys;print(int(json.load(sys.stdin)["odometer"]["traveled_distance_km"]))' 2>/dev/null; }
odo()  { [[ -n $ODO ]] || ODO=$(odo_now || { $ADB forward tcp:8088 tcp:8088 >/dev/null 2>&1; sleep 1; odo_now; })
         [[ -n $ODO ]] || { echo "   (가상 콘솔에서 주행거리를 못 읽었어요)"; return 1; }
         ODO=$(( ODO + $1 )); put "odometer?traveled_distance_km=$ODO"; }
front(){ $ADB shell am start --user 10 -n "$PKG/.ui.MainActivity" >/dev/null 2>&1 || $ADB shell monkey -p "$PKG" 1 >/dev/null 2>&1; }

# 가상 콘솔 연결 + 세션 유지(끊기면 콘솔 값이 차에 안 들어감)
$ADB forward tcp:8088 tcp:8088 >/dev/null
( while true; do curl -s -m 2 -o /dev/null -X POST "$V/browser/session?client=judge"; sleep 0.8; done ) &
HB=$!; trap 'kill $HB 2>/dev/null' EXIT
# 권한 (처음 실행 때 창으로 물어보지만, 잘 안 눌리면 이걸로)
for p in android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION android.car.permission.CAR_SPEED; do
  $ADB shell pm grant --user 10 "$PKG" "$p" >/dev/null 2>&1
done

say "0. 준비: 대구 집(북구청)에 세운 차 · 기어 P · 빈 좌석"
gear Park; speed 0; door false; seats false
front; sleep 3
geo "$HOME_LL"; sleep 6; geo "$HOME_LL"   # 내비가 켜질 때 기본 위치(판교)를 한 번 보내므로 두 번
sleep 3; shot 0-waiting
echo "   차 화면: '차에 타면 오늘 추천을 보여 드려요' 대기 화면"
step 2

say "1. 탑승: 2열에 아이 둘이 앉음 → 지금 시각·해 지는 시각·귀가 한계로 추천 카드"
seats true; sleep 15; shot 1-plan
echo "   차 화면: '오늘 어디 갈까요 / 어디 들렀다 갈까요 / 저녁 산책 어때요?' + 카드(코스·이유 칩·하루 막대)"
echo "   (오후 7시 30분이 지났으면 '오늘은 늦었어요 · 내일 코스' 안내 — 정상)"
echo "   카드의 '이 길로 출발'을 누르면 내비가 경유지까지 한 번에 안내합니다(눌러 보셔도 되고 넘어가도 됩니다)"
step 3

say "2. 출발: 기어 D · 50km/h → 주행 중엔 버튼 없는 화면(주행 제한)"
front; gear Drive; speed 50; sleep 6; shot 2-driving
echo "   시스템이 '주행 중에는 사용할 수 없습니다'로 덮을 수 있습니다(정상 — 주행 중 화면 제한)"
step 2

say "3. 디아크 도착: 실제로 달린 만큼 주행거리 +16km → 반경 안에서 P 3초 → '쾅' 도장"
odo 16; speed 0; geo "$ARC_LL"; sleep 7
gear Park; sleep 8; front; sleep 2; shot 3-stamp
echo "   차 화면: 도장 획득 메달(누적 주행거리로 검증한 도장)"
step 3

say "4. 집으로: 주행거리 +16km → 집에서 P → 오늘 요약, 아이가 앉은 채 문을 열면 뒷좌석 확인"
front; gear Drive; speed 50; sleep 4
odo 16; speed 0; geo "$HOME_LL"; sleep 7
gear Park; sleep 8; front; sleep 2; shot 4-summary
door true; sleep 4; shot 5-rear
echo "   차 화면: '오늘 하루' 요약 → 문 열림 + 2열 착좌 = 빨간 '뒷좌석 확인'"
step 3

say "5. 위조 시도: 주행거리는 그대로 두고 위치만 70km 밖 명소 근처로 → P → '보류'"
door false; front; gear Drive; speed 0; sleep 2
geo "$FAKE_LL"; sleep 7
gear Park; sleep 8; front; sleep 2; shot 6-held
echo "   차 화면: 주행거리가 이동거리와 맞지 않아 도장 '보류'"
step 2

say "끝. 처음부터 다시 하려면 앱을 강제 종료하고(adb shell am force-stop --user 10 $PKG) 다시 실행하세요."
