import Link from "next/link";
import { CircleUserRound, UserRound } from "lucide-react";
import { AccountCollectionSync } from "@/components/collection/account-collection-sync";
import { getCurrentUser } from "@/lib/server/auth";

const LINK =
  "flex size-9 items-center justify-center rounded-full text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary";

/**
 * Header account control: a sign-in icon, or the account icon once signed in. Reads the session, so it sits behind
 * <Suspense>. Signed-in pages also move a collection saved in this browser to the account.
 */
export async function AccountLink() {
  const user = await getCurrentUser();
  if (!user) return <SignInIcon />;
  return (
    <>
      <AccountCollectionSync />
      <Link href="/account" className={`${LINK} bg-primary text-primary-foreground hover:bg-primary/90`} aria-label="Your account">
        <UserRound aria-hidden className="size-5" />
      </Link>
    </>
  );
}

/** Shown while the session loads, and to signed-out visitors. */
export function SignInIcon() {
  return (
    <Link href="/sign-in" className={LINK} aria-label="Sign in">
      <CircleUserRound aria-hidden className="size-6" />
    </Link>
  );
}
