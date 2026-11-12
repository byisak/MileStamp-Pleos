plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "kr.milestamp.car"
    compileSdk = 34
    // AAOS 표준 차량 API(CarPropertyManager·CarUxRestrictionsManager)
    useLibrary("android.car")

    // release 서명: 키는 저장소 밖(~/.milestamp/release.keystore). 값은 ~/.gradle/gradle.properties 또는 환경 변수
    // MILESTAMP_STORE_FILE · MILESTAMP_STORE_PASSWORD · MILESTAMP_KEY_ALIAS · MILESTAMP_KEY_PASSWORD
    // 없으면 release는 서명 없이(app-release-unsigned.apk) 만들어진다.
    fun signProp(name: String): String? =
        (project.findProperty(name) as String?) ?: System.getenv(name)
    val releaseStore = signProp("MILESTAMP_STORE_FILE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (releaseStore != null) {
            create("release") {
                storeFile = releaseStore
                storePassword = signProp("MILESTAMP_STORE_PASSWORD")
                keyAlias = signProp("MILESTAMP_KEY_ALIAS") ?: "milestamp"
                keyPassword = signProp("MILESTAMP_KEY_PASSWORD") ?: signProp("MILESTAMP_STORE_PASSWORD")
            }
        }
    }

    defaultConfig {
        applicationId = "kr.milestamp.car"
        minSdk = 28          // 공모전·Pleos 요구: API 28 이상
        targetSdk = 34
        versionCode = 5
        versionName = "0.3.2"
    }
    buildTypes {
        debug {
            // 에뮬레이터 → 맥의 개발 서버 (web/: npx next dev -p 3200)
            // 시연(운영 서버에 붙은 디버그 빌드): ./gradlew :app:assembleDebug -PserverUrl=https://milestamp.vercel.app
            val serverUrl = (project.findProperty("serverUrl") as String?) ?: "http://10.0.2.2:3200"
            buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
        }
        release {
            buildConfigField("String", "SERVER_URL", "\"https://milestamp.vercel.app\"")
            // R8 줄이기(코드) + 안 쓰는 리소스 빼기. 지킬 규칙은 proguard-rules.pro
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfigs.findByName("release")?.let { signingConfig = it }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
}

dependencies {
    implementation(project(":engine"))
    implementation(libs.pleos.vehicle)
    implementation(libs.pleos.navihelper)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.service)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.session)
    implementation(libs.coroutines.android)
    implementation(libs.zxing.core)   // 차 화면 '폰 연결' QR
    implementation(libs.lucide.icons) // 화면 아이콘 (Lucide, ISC · 묶음 라이브러리 MIT — app/NOTICE)

    testImplementation(libs.junit)
    testImplementation("org.json:json:20240303") // 단위 시험에서 진짜 org.json (안드로이드 것은 빈 껍데기)
}
