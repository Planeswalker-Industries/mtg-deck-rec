import Link from "next/link";
import { CircleUserRound, UserRound } from "lucide-react";
import { getCurrentUser } from "@/lib/server/auth";

const LINK =
  "flex size-9 items-center justify-center rounded-full text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary";

/** Header account control: a sign-in icon, or the account icon once signed in. Reads the session, so it sits behind <Suspense>. */
export async function AccountLink() {
  const user = await getCurrentUser();
  if (!user) return <SignInIcon />;
  return (
    <Link href="/account" className={`${LINK} bg-primary text-primary-foreground hover:bg-primary/90`} aria-label="Your account">
      <UserRound aria-hidden className="size-5" />
    </Link>
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
