# Pleos Vehicle SDK 샘플 앱 기준선(AGP 8.8.2 · Gradle 8.10.2 · Kotlin 2.0.0)에 맞춤
# release 빌드(R8 minify + shrinkResources)에서 지킬 것들.

# 오류 기록을 읽을 수 있게 줄 번호는 남기고, 원래 파일 이름은 감춘다 (mapping.txt로 되돌림)
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# --- Pleos Connect SDK (Vehicle 2.3.2 · NaviHelper 3.0.5) ---
# AIDL 바인더 인터페이스 이름(DESCRIPTOR)·Parcelable CREATOR·차 서비스가 되부르는 콜백을
# 이름 그대로 써야 해서 SDK 전체를 그대로 둔다 (SDK 자체 consumer 규칙은 일부만 지킴).
-keep class ai.pleos.playground.** { *; }
-keep interface ai.pleos.playground.** { *; }
-dontwarn ai.pleos.playground.**

# --- AAOS android.car (useLibrary, 기기에 있는 라이브러리) ---
-dontwarn android.car.**

# --- 엔진·앱 enum: 서버 JSON의 글자를 Enum.valueOf(이름)로 되살림 (ServerApi·CourseJson) ---
-keepclassmembers enum kr.milestamp.** {
    public static **[] values();
    public static ** valueOf(java.lang.String);
    **[] $VALUES;
    public *;
}

# --- 매니페스트·글레오(schema.json)가 이름으로 부르는 구성 요소 ---
# Activity/Service/Receiver는 AGP가 매니페스트에서 자동으로 지키지만, 글레오 연동은 이름이 바뀌면
# 바로 끊기므로 명시해 둔다.
-keep class kr.milestamp.car.gleo.GleoActionReceiver { *; }
-keep class kr.milestamp.car.trip.TripService
-keep class kr.milestamp.car.audio.IntroPlaybackService

# --- Media3 (MediaSessionService는 매니페스트 action으로 찾음) ---
-dontwarn androidx.media3.**

# --- org.json: 안드로이드 기본 라이브러리라 규칙 필요 없음 ---
# --- Compose · Lucide 아이콘(com.composables:icons-lucide): 반사(reflection) 없음 → 쓰는 아이콘만 남고 나머지는 R8이 지움 ---
# --- zxing core: QR 만들기만 씀, 반사 없음 ---
-dontwarn com.google.zxing.**
