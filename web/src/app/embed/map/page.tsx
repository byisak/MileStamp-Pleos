// 폰 앱 WebView가 여는 지도 한 장 (카카오 지도는 등록한 주소에서만 돌아서, 앱 안 HTML 대신 우리 주소에서 연다).
// 주고받는 말은 src/lib/map-embed.ts 맨 위 설명 참고. 브라우저로 볼 땐 /embed/map#init=<JSON>
import type { Metadata, Viewport } from "next";
import { EmbedMap } from "./EmbedMap";
import "./embed.css";

export const metadata: Metadata = { title: "지도", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function EmbedMapPage() {
  return <EmbedMap />;
}
