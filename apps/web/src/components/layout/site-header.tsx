import Link from "next/link";
import { Suspense } from "react";
import { AccountLink, SignedOutNav } from "@/components/auth/account-link";
import { SiteSearch } from "@/components/search/site-search";

export function SiteHeader() {
  return (
    <header className="border-b border-seam bg-sleeve">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-2 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        >
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_12px_color-mix(in_oklch,var(--primary)_60%,transparent)]" />
          <span className="font-heading text-xl leading-none font-semibold tracking-tight sm:text-2xl">MTG Deck Rec</span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <SiteSearch />
          <Suspense fallback={<SignedOutNav />}>
            <AccountLink />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
