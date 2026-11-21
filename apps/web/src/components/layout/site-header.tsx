import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { AccountLink, SignedOutNav } from "@/components/auth/account-link";
import { SiteSearch } from "@/components/search/site-search";

export function SiteHeader() {
  return (
    <header className="wood border-b border-(--wood-bar-rule) shadow-[0_6px_18px_-8px_var(--wood-bar)]">
      {/* One flat row, so `order-*` can seat the nav (rendered inside AccountLink) beside the logo on wide screens. */}
      <div className="page-column flex h-16 items-center sm:h-[4.5rem] gap-1 sm:gap-2">
        <Link
          href="/"
          className="group order-0 mr-auto flex min-h-11 min-w-0 items-center gap-2 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary lg:mr-6"
        >
          {/* Concept: the stacked wordmark (868×251) in place of the typed name. */}
          <Image
            src="/logo-stacked.png"
            alt="Spell Chasm"
            width={868}
            height={251}
            priority
            className="h-10 w-auto sm:h-12"
          />
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
