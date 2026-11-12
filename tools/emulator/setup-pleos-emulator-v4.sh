#!/bin/bash
# 마일스탬프 · Pleos Connect 에뮬레이터 설치와 실행 (Apple Silicon 맥)
# - 필요한 것: Android Studio (안에 든 Java로 sdkmanager를 돌림)
#   없으면: brew install --cask android-studio
# - 에뮬레이터·android-34·Pleos 이미지(약 4.7GB 받음, 풀면 19GB)를 내장 SDK에 설치
# - 가상 기기: ~/.android/avd/Pleos_Connect_v2_1_0.avd
# - 다시 실행해도 안전: 이미 된 단계는 건너뜀
# 실행: bash tools/emulator/setup-pleos-emulator-v4.sh

set -uo pipefail

SDK="$HOME/Library/Android/sdk"
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
# Pleos 이미지 저장소는 cmdline-tools 'latest'(sdkmanager)로만 목록에 보였음 (11/9 새 맥)
SM="$SDK/cmdline-tools/latest/bin/sdkmanager"
AM="$SDK/cmdline-tools/latest/bin/avdmanager"
EMU="$SDK/emulator/emulator"
ADB="$SDK/platform-tools/adb"
NAME="Pleos_Connect_v2_1_0"
PKG="system-images;android-34;pleos_car_emulator;arm64-v8a"
REPO_URL='https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-arm64-sys-img.xml'
WORK="${MS_CACHE:-$HOME/Documents/dev/milestamp-cache}/emu"   # 로그 자리
mkdir -p "$WORK"

step() { printf '\n▶ %s\n' "$*"; }
fail() { printf '\n✕ %s\n' "$*"; exit 1; }

step "1/6 준비 확인"
[ -x "$SM" ] || fail "sdkmanager를 찾지 못했어요: $SM (Android Studio → SDK Manager → SDK Tools → Command-line Tools)"
[ -d "$JAVA_HOME" ] || fail "Android Studio 내장 Java를 찾지 못했어요: $JAVA_HOME"
df -h "$HOME" | sed 's/^/   /'

step "2/6 라이선스 동의 · 에뮬레이터 · android-34"
yes | "$SM" --licenses > /dev/null 2>&1 || true
for p in "platform-tools" "emulator" "platforms;android-34"; do
  dir="${p//;//}"
  if [ -e "$SDK/$dir" ]; then echo "   이미 있어요: $p"; else "$SM" --install "$p" > "$WORK/sdk-install.log" 2>&1 || fail "$p 설치 실패 (로그: $WORK/sdk-install.log)"; echo "   설치했어요: $p"; fi
done

step "3/6 Pleos 이미지 저장소 등록"
CFG="$HOME/.android/repositories.cfg"
mkdir -p "$HOME/.android"
if grep -q "crp-arm64-sys-img.xml" "$CFG" 2>/dev/null; then
  echo "   이미 등록돼 있어요"
else
  if [ -f "$CFG" ]; then
    cp "$CFG" "$CFG.bak"
    n="$(grep -E '^count=' "$CFG" | cut -d= -f2)"; n="${n:-0}"
    idx="$(printf '%02d' "$n")"
    grep -v '^count=' "$CFG.bak" > "$CFG"
    {
      echo "count=$((n + 1))"
      echo "disp$idx=Pleos Connect System Image"
      echo "dist$idx="
      echo "enabled$idx=true"
      echo "src$idx=$REPO_URL"
    } >> "$CFG"
  else
    {
      echo "### User Sources for Android SDK Manager"
      echo "count=1"
      echo "disp00=Pleos Connect System Image"
      echo "dist00="
      echo "enabled00=true"
      echo "src00=$REPO_URL"
    } > "$CFG"
  fi
  echo "   등록했어요 (Android Studio SDK Manager에도 같은 이름으로 보여요)"
fi

step "4/6 Pleos 이미지 설치 (처음엔 약 4.7GB를 받아요)"
REL="${PKG//;//}"
if [ -f "$SDK/$REL/system.img" ]; then
  echo "   이미 설치돼 있어요: $SDK/$REL"
else
  yes | "$SM" --install "$PKG" > "$WORK/pleos-install.log" 2>&1 || true
  [ -f "$SDK/$REL/system.img" ] || fail "이미지가 다 풀리지 않았어요 (로그: $WORK/pleos-install.log)"
  echo "   설치했어요"
fi

step "5/6 가상 기기 만들기: $NAME"
AVD_DIR="$HOME/.android/avd/$NAME.avd"
if [ -d "$AVD_DIR" ]; then
  echo "   이미 있어요. 그대로 써요"
else
  "$AM" list device -c > "$WORK/devices.txt" 2>&1 || true
  DEV="$(grep -iE 'pleos|crp' "$WORK/devices.txt" | head -1)"
  [ -n "$DEV" ] || DEV="$(grep -i 'automotive' "$WORK/devices.txt" | head -1)"
  [ -n "$DEV" ] || fail "Pleos 기기 정의를 찾지 못했어요. 목록: $WORK/devices.txt"
  echo "   기기 정의: $DEV"
  echo no | "$AM" create avd -n "$NAME" -k "$PKG" -d "$DEV" > /dev/null 2>&1 || true
  [ -f "$AVD_DIR/config.ini" ] || fail "가상 기기를 만들지 못했어요"
fi
CONF="$AVD_DIR/config.ini"
setkv() {
  if grep -q "^$1[ ]*=" "$CONF"; then sed -i '' "s|^$1[ ]*=.*|$1=$2|" "$CONF"; else echo "$1=$2" >> "$CONF"; fi
}
setkv hw.ramSize 4096
setkv hw.gpu.enabled yes
setkv hw.gpu.mode host
setkv fastboot.forceColdBoot yes
setkv hw.keyboard yes
echo "   설정: RAM 4GB, GPU host, 매번 새로 부팅(Cold boot)"

step "6/6 에뮬레이터 켜기"
if "$ADB" devices 2>/dev/null | grep -q '^emulator-'; then
  echo "   이미 켜진 에뮬레이터가 있어요:"; "$ADB" devices | sed 's/^/   /'
fi
nohup "$EMU" -avd "$NAME" -gpu host -no-snapshot -no-boot-anim > "$WORK/emulator.log" 2>&1 &
echo "   켜는 중이에요. 첫 부팅은 3~5분 걸려요 (로그: $WORK/emulator.log)"
# -e = 에뮬레이터만 (USB로 꽂힌 실제 폰이 있어도 헷갈리지 않게)
"$ADB" -e wait-for-device
for i in $(seq 1 60); do
  [ "$("$ADB" -e shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && { echo "   부팅 끝났어요"; break; }
  sleep 5
done
"$ADB" devices | sed 's/^/   /'
echo "   가상 콘솔: $ADB -e forward tcp:8088 tcp:8088 → http://127.0.0.1:8088"
