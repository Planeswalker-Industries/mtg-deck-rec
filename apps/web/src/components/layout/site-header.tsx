import Link from "next/link";
import { Suspense } from "react";
import { AccountLink, SignInIcon } from "@/components/auth/account-link";
import { SiteSearch } from "@/components/search/site-search";

// Quiet until you reach for them: gold is the lamp, and it belongs on the one action that matters.
const NAV_LINK =
  "whitespace-nowrap rounded-md px-1.5 py-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-3";

export function SiteHeader() {
  return (
    <header className="border-b border-seam bg-sleeve">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="group flex items-center gap-2 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        >
          <span aria-hidden className="size-2.5 rounded-full bg-primary shadow-[0_0_12px_color-mix(in_oklch,var(--primary)_60%,transparent)]" />
          <span className="font-heading text-xl leading-none font-semibold tracking-tight sm:text-2xl">MTG Deck Rec</span>
        </Link>
        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          <SiteSearch />
          <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
            <Link href="/decks" className={NAV_LINK}>
            Decks
          </Link>
          <Link href="/collection" className={NAV_LINK}>
              <span className="sm:hidden">Collection</span>
              <span className="hidden sm:inline">My collection</span>
            </Link>
            <Link href="/deck" className={NAV_LINK}>
              <span className="sm:hidden">Deck tool</span>
              <span className="hidden sm:inline">Upgrade a deck</span>
            </Link>
            <Link href="/rate" className={NAV_LINK}>
              <span className="sm:hidden">Rate</span>
              <span className="hidden sm:inline">Rate cards</span>
            </Link>
            <Suspense fallback={<SignInIcon />}>
              <AccountLink />
            </Suspense>
          </nav>
        </div>
      </div>
    </header>
  );
}
