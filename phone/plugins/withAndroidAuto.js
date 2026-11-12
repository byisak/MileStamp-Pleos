// 안드로이드 오토(Car App Library) 설정 플러그인 — `npx expo prebuild`가 android/를 새로 만들 때마다 적용된다.
//  - 차 앱 서비스(modules/milestamp-auto의 MilestampCarAppService): intent-filter androidx.car.app.CarAppService
//    + 범주 androidx.car.app.category.POI (관심 장소)
//  - meta-data com.google.android.gms.car.application → res/xml/automotive_app_desc.xml (<uses name="template"/>)
//  - androidx.car.app.minCarApiLevel (2: 메시지·격자 템플릿·ConstraintManager. 알림창(5)·주 버튼(4)은 코드에서 확인)
//  - 차량 속도·주행거리 권한 (안드로이드 오토 투사: com.google.android.gms.permission.CAR_SPEED·CAR_MILEAGE — 지원 차만 값이 옴)
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SERVICE = "kr.milestamp.phone.auto.MilestampCarAppService";
const MIN_CAR_API = "2";
const PERMISSIONS = [
  // 지도 템플릿(PlaceListMapTemplate)을 쓰려면 꼭 필요 — 없으면 차에서 앱을 열자마자 꺼진다
  "androidx.car.app.MAP_TEMPLATES",
  "com.google.android.gms.permission.CAR_SPEED",
  "com.google.android.gms.permission.CAR_MILEAGE",
  "android.permission.ACCESS_FINE_LOCATION",
];

const DESC = `<?xml version="1.0" encoding="utf-8"?>
<!-- 안드로이드 오토: 이 앱은 템플릿(Car App Library) 앱이다. withAndroidAuto.js가 만든다 -->
<automotiveApp>
    <uses name="template" />
</automotiveApp>
`;

function withManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    for (const p of PERMISSIONS) {
      if (!manifest["uses-permission"].some((u) => u.$["android:name"] === p)) {
        manifest["uses-permission"].push({ $: { "android:name": p } });
      }
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service || []).filter((s) => s.$["android:name"] !== SERVICE);
    app.service.push({
      $: { "android:name": SERVICE, "android:exported": "true" },
      "intent-filter": [
        {
          action: [{ $: { "android:name": "androidx.car.app.CarAppService" } }],
          category: [{ $: { "android:name": "androidx.car.app.category.POI" } }],
        },
      ],
    });
    app["meta-data"] = (app["meta-data"] || []).filter(
      (m) => !["com.google.android.gms.car.application", "androidx.car.app.minCarApiLevel"].includes(m.$["android:name"])
    );
    app["meta-data"].push(
      { $: { "android:name": "com.google.android.gms.car.application", "android:resource": "@xml/automotive_app_desc" } },
      { $: { "android:name": "androidx.car.app.minCarApiLevel", "android:value": MIN_CAR_API } }
    );
    return cfg;
  });
}

function withDescXml(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "automotive_app_desc.xml"), DESC);
      return cfg;
    },
  ]);
}

module.exports = function withAndroidAuto(config) {
  return withDescXml(withManifest(config));
};
