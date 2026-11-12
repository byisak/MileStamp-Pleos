import { Suspense } from "react";
import { JoinForm } from "./join-form";

export const metadata = { title: "가족 연결" };

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinForm />
    </Suspense>
  );
}
