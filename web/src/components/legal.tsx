import Link from "next/link";

/*
 * 공개 약관 화면(/privacy · /location-terms · /community-rules) 공용 틀.
 * 가족 폰 공개 화면(/e/[id])과 같은 색·글꼴, 좁은 폭. 로그인 없이 누구나 본다.
 */

export const OPERATOR = "큐비온(Cubion)";
export const CONTACT_EMAIL = "beatbbak@gmail.com";
export const EFFECTIVE_DATE = "2026년 11월 15일";

const DOCS = [
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/location-terms", label: "위치기반서비스 이용약관" },
  { href: "/community-rules", label: "함께 이용 규칙" },
] as const;

export function LegalPage({ title, lead, current, children }: { title: string; lead: string; current: (typeof DOCS)[number]["href"]; children: React.ReactNode }) {
  return (
    <article className="pt-2 pb-6 space-y-5 text-[15px] leading-relaxed break-keep">
      <nav aria-label="약관 문서" className="flex flex-wrap gap-2 text-sm">
        {DOCS.map((d) =>
          d.href === current ? (
            <span key={d.href} aria-current="page" className="rounded-full bg-primary text-white px-3 py-1">{d.label}</span>
          ) : (
            <Link key={d.href} href={d.href} className="rounded-full bg-card border border-line px-3 py-1 text-sub">{d.label}</Link>
          ),
        )}
      </nav>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sub">{lead}</p>
        <p className="text-sm text-sub">시행일 {EFFECTIVE_DATE} · 운영 {OPERATOR}</p>
      </header>
      {children}
      <footer className="pt-2 text-sm text-sub border-t border-line">
        궁금한 점은 <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>로 보내 주세요.
      </footer>
    </article>
  );
}

/** 조(條) 하나 = 흰 카드 한 장 */
export function Clause({ n, title, children }: { n?: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card border border-line p-5 space-y-3">
      <h2 className="text-lg font-bold">{n != null ? `제${n}조 ` : ""}{title}</h2>
      {children}
    </section>
  );
}

export function Items({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1.5 marker:text-sub">{children}</ul>;
}

/** 좁은 화면에서도 보이도록 표 대신 '이름 — 설명' 줄 묶음 */
export function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([k, v]) => (
        <div key={k} className="py-2.5 first:pt-0 last:pb-0">
          <dt className="font-semibold">{k}</dt>
          <dd className="text-sub mt-0.5">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
