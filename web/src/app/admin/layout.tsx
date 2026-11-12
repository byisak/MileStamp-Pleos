import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: "관리자",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" precedence="default" />
      <div className="adm">
        {children}
        {/* 공개 약관 화면 (가족 폰 웹과 같은 서버) */}
        <footer style={{ padding: "20px 16px 28px", textAlign: "center", fontSize: 12, color: "#71717a" }}>
          <a href="/privacy" target="_blank" rel="noopener" style={{ color: "inherit" }}>개인정보처리방침</a>
          {" · "}
          <a href="/location-terms" target="_blank" rel="noopener" style={{ color: "inherit" }}>위치기반서비스 이용약관</a>
          {" · "}
          <a href="/community-rules" target="_blank" rel="noopener" style={{ color: "inherit" }}>함께 이용 규칙</a>
        </footer>
      </div>
    </>
  );
}
