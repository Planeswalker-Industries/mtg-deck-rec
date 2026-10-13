import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { PageHero } from "@/components/ui/page-hero";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <PageHero
      id="sign-in-heading"
      heading="Sign in"
      aside="Your cards and decks, on every device."
      intro={
        <p>
          We&apos;ll email you a 6-digit code. There&apos;s no password to remember. Signing in keeps your collection and
          saved decks with your account instead of this browser.
        </p>
      }
    >
      <Suspense fallback={null}>
        <SignInForm googleEnabled={process.env.NEXT_PUBLIC_AUTH_GOOGLE === "1"} />
      </Suspense>
    </PageHero>
  );
}
