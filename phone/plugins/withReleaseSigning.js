// release 빌드를 debug 키 대신 마일스탬프 release 키로 서명하게 만드는 Expo 설정 플러그인.
// `npx expo prebuild`가 android/를 매번 새로 만들어도 이 플러그인이 다시 적용된다.
//
// 키와 비밀번호는 저장소에 두지 않는다. 다음 중 한 곳에 넣는다 (차 앱과 같은 이름):
//   ~/.gradle/gradle.properties  또는  환경 변수
//   MILESTAMP_STORE_FILE=/Users/<나>/.milestamp/release.keystore
//   MILESTAMP_STORE_PASSWORD=…  MILESTAMP_KEY_ALIAS=milestamp  MILESTAMP_KEY_PASSWORD=…
// 값이 없으면 지금처럼 debug 키로 서명한다(빌드는 깨지지 않음).
const { withAppBuildGradle } = require("@expo/config-plugins");

const MARK = "// milestamp-release-signing";

const SIGNING = `
        ${MARK}
        def msProp = { String n -> (findProperty(n) ?: System.getenv(n)) as String }
        if (msProp('MILESTAMP_STORE_FILE') && file(msProp('MILESTAMP_STORE_FILE')).exists()) {
            release {
                storeFile file(msProp('MILESTAMP_STORE_FILE'))
                storePassword msProp('MILESTAMP_STORE_PASSWORD')
                keyAlias(msProp('MILESTAMP_KEY_ALIAS') ?: 'milestamp')
                keyPassword(msProp('MILESTAMP_KEY_PASSWORD') ?: msProp('MILESTAMP_STORE_PASSWORD'))
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;
    // signingConfigs { debug { … } } 끝에 release 를 덧붙인다
    const re = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
    if (!re.test(src)) throw new Error("withReleaseSigning: signingConfigs.debug 블록을 못 찾음");
    src = src.replace(re, `$1${SIGNING}`);
    // release 빌드 형식의 서명을 release 키(있으면)로
    const rel = /(release\s*\{[^{}]*?)signingConfig signingConfigs\.debug/;
    if (!rel.test(src)) throw new Error("withReleaseSigning: buildTypes.release 의 signingConfig 줄을 못 찾음");
    src = src.replace(rel, "$1signingConfig(signingConfigs.findByName('release') ?: signingConfigs.debug)");
    cfg.modResults.contents = src;
    return cfg;
  });
};
