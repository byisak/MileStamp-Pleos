// 지도 스크립트 불러오기 (브라우저 전용). 카카오 → 안 되면 Leaflet(OpenStreetMap)으로 물러선다.
// 카카오 키가 없거나, 등록 안 된 주소에서 열렸거나(SDK가 401), 인터넷이 끊겼으면 → Leaflet.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { kakaoKeyOk, kakaoSdkUrl } from "./map-embed";

/** Vercel 환경 변수 NEXT_PUBLIC_KAKAO_JS_KEY (빌드할 때 박힘 → 키를 넣거나 바꾸면 다시 배포) */
export const KAKAO_JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "";

const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
let leafletPromise: Promise<any> | null = null;
let kakaoPromise: Promise<any> | null = null;

function addScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error("지도를 못 불러왔어요")); };
    document.head.appendChild(s);
  });
}

/** Leaflet을 unpkg에서 한 번만 (npm 의존성 없이) */
export function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletPromise) return leafletPromise;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `${LEAFLET}.css`;
  document.head.appendChild(css);
  leafletPromise = addScript(`${LEAFLET}.js`).then(() => {
    w.L.Icon.Default.imagePath = "https://unpkg.com/leaflet@1.9.4/dist/images/";
    return w.L;
  }).catch((e) => { leafletPromise = null; throw e; });
  return leafletPromise;
}

/** 카카오 지도 SDK (autoload=false → kakao.maps.load). 키가 없거나 timeoutMs 안에 준비 안 되면 실패 */
export function loadKakao(key: string = KAKAO_JS_KEY, timeoutMs = 8000): Promise<any> {
  const w = window as any;
  if (!kakaoKeyOk(key)) return Promise.reject(new Error("카카오 지도 키 없음"));
  if (w.kakao?.maps?.LatLng) return Promise.resolve(w.kakao);
  if (kakaoPromise) return kakaoPromise;
  kakaoPromise = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("카카오 지도 시간 초과")), timeoutMs);
    addScript(kakaoSdkUrl(key)).then(() => {
      const maps = w.kakao?.maps;
      if (!maps?.load) throw new Error("카카오 지도 SDK 모양이 달라요");
      maps.load(() => { clearTimeout(timer); resolve(w.kakao); });
    }).catch((e) => { clearTimeout(timer); reject(e); });
  }).catch((e) => { kakaoPromise = null; throw e; });
  return kakaoPromise;
}

/** 카카오 먼저, 안 되면 Leaflet. 어느 쪽인지 같이 돌려준다 */
export async function loadMapLib(): Promise<{ engine: "kakao"; kakao: any } | { engine: "leaflet"; L: any }> {
  try {
    return { engine: "kakao", kakao: await loadKakao() };
  } catch {
    return { engine: "leaflet", L: await loadLeaflet() };
  }
}
