import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "마일스탬프", template: "%s · 마일스탬프" },
  description: "가족 나들이마다 차가 알아서 도장을 찍어 주는 앱 — 가족 폰",
  appleWebApp: { capable: true, title: "마일스탬프", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f3f3f3",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// 바깥 틀만. 가족 폰 화면 머리·폭은 (phone)/layout.tsx, 관리자는 admin/layout.tsx
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
