import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "마일스탬프",
    short_name: "마일스탬프",
    description: "차에서 내려도 나들이가 이어지는 가족 폰",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f3f3",
    theme_color: "#f3f3f3",
    lang: "ko",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
