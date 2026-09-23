import Link from "next/link";
import { CircleUserRound, UserRound } from "lucide-react";
import { AccountCollectionSync } from "@/components/collection/account-collection-sync";
import { getCurrentUser } from "@/lib/server/auth";
import { MainNav } from "@/components/layout/main-nav";

const LINK =
  "flex size-9 items-center justify-center rounded-full text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary";

/**
 * Header navigation that depends on the session: account-only links and the account control. Reads the session, so
 * it sits behind <Suspense> with `SignedOutNav` as its fallback. Signed-in pages also move a collection saved in
 * this browser to the account.
 */
export async function AccountLink() {
  const user = await getCurrentUser();
  if (!user) return <SignedOutNav />;
  return (
    <MainNav signedIn>
      <AccountCollectionSync />
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
