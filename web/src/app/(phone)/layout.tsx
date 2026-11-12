import Link from "next/link";
import { SwRegister } from "@/components/sw-register";

/** 가족 폰 웹 화면 틀 (머리 + 좁은 폭). */
export default function PhoneLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-10 bg-bg/90 backdrop-blur px-5 pt-[max(env(safe-area-inset-top),14px)] pb-3">
        <Link href="/" className="inline-flex items-center gap-2 font-bold text-lg">
          <Logo />
          마일스탬프
        </Link>
      </header>
      <main className="flex-1 w-full max-w-lg mx-auto px-5 pb-[max(env(safe-area-inset-bottom),24px)]">{children}</main>
      <SwRegister />
    </>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 108 108" aria-hidden>
      <rect width="108" height="108" rx="24" fill="#18181B" />
      <circle cx="54" cy="54" r="20" fill="none" stroke="#fff" strokeWidth="6" />
      <circle cx="70" cy="35" r="6" fill="#F2B230" />
    </svg>
  );
}
