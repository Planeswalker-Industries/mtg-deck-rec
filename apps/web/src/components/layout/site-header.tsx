import Link from "next/link";
import { Suspense } from "react";
import { AccountLink, SignedOutNav } from "@/components/auth/account-link";
import { SiteSearch } from "@/components/search/site-search";

export function SiteHeader() {
  return (
    <header className="border-b border-seam bg-sleeve">
      {/* One flat row, so `order-*` can seat the nav (rendered inside AccountLink) beside the logo on wide screens. */}
      <div className="page-column flex h-16 items-center gap-1 sm:gap-2">
        <Link
          href="/"
          className="group order-0 mr-auto flex min-w-0 items-center gap-2 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary lg:mr-6"
        >
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_12px_color-mix(in_oklch,var(--primary)_60%,transparent)]" />
          <span className="font-heading text-xl leading-none font-semibold tracking-tight sm:text-2xl">MTG Deck Rec</span>
        </Link>
        <div className="order-2 shrink-0 lg:ml-auto">
          <SiteSearch />
        </div>
        <Suspense fallback={<SignedOutNav />}>
          <AccountLink />
        </Suspense>
      </div>
    </header>
  );
}
