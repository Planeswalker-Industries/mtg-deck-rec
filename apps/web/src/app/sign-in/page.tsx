import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <div className="flex max-w-md flex-col gap-5">
      <div>
        <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight">Sign in</h1>
        <p className="mt-2 text-muted-foreground">We&apos;ll email you a 6-digit code. There&apos;s no password to remember.</p>
      </div>
      <Suspense fallback={null}>
        <SignInForm googleEnabled={process.env.NEXT_PUBLIC_AUTH_GOOGLE === "1"} />
      </Suspense>
    </div>
  );
}
