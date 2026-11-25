import Link from "next/link";
import { CircleAlert, CircleUserRound, Inbox, UserRound } from "lucide-react";
import { AccountCollectionSync } from "@/components/collection/account-collection-sync";
import { createAuthClient, getCurrentUser } from "@/lib/server/auth";
import { openAdminCounts } from "@/lib/server/feedback";
import { MainNav } from "@/components/layout/main-nav";

const LINK =
  "flex size-11 items-center justify-center rounded-full text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary";

/**
 * Header navigation that depends on the session: account-only links and the account control. Reads the session, so
 * it sits behind <Suspense> with `SignedOutNav` as its fallback. Signed-in pages also move a collection saved in
 * this browser to the account.
 *
 * Platform admins also get the open feedback report and error ticket counts (T077). They cost every signed-in page one
 * small read, which answers null for anyone else; it streams behind the same <Suspense>, so the page never waits for it.
 */
export async function AccountLink() {
  const user = await getCurrentUser();
  if (!user) return <SignedOutNav />;
  const counts = await openAdminCounts(await createAuthClient());
  const openReports = counts?.reports ?? 0;
  const openErrors = counts?.errors ?? 0;
  return (
    <MainNav signedIn openReports={openReports} openErrors={openErrors}>
      <AccountCollectionSync />
      {/* Wide screens only: a phone's header has no room for it, so there the menu button carries the count. */}
      {openReports > 0 && (
        <Link
          href="/admin/reports"
          className={`${LINK} hidden w-auto gap-1 px-2.5 lg:flex`}
          aria-label={`${openReports} open feedback report${openReports === 1 ? "" : "s"}`}
        >
          <Inbox aria-hidden className="size-5" />
          <span aria-hidden className="font-mono text-sm">
            {openReports}
          </span>
        </Link>
      )}
      {openErrors > 0 && (
        <Link
          href="/admin/errors"
          className={`${LINK} hidden w-auto gap-1 px-2.5 lg:flex`}
          aria-label={`${openErrors} open error ticket${openErrors === 1 ? "" : "s"}`}
        >
          <CircleAlert aria-hidden className="size-5" />
          <span aria-hidden className="font-mono text-sm">
            {openErrors}
          </span>
        </Link>
      )}
      <Link href="/account" className={`${LINK} bg-primary text-primary-foreground hover:bg-primary/90`} aria-label="Your account">
        <UserRound aria-hidden className="size-5" />
      </Link>
    </MainNav>
  );
}

/** Shown while the session loads, and to signed-out visitors. */
export function SignedOutNav() {
  return (
    <MainNav signedIn={false}>
      <Link href="/sign-in" className={LINK} aria-label="Sign in">
        <CircleUserRound aria-hidden className="size-6" />
      </Link>
    </MainNav>
  );
}
